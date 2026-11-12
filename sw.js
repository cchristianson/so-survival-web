// Service worker: keeps the app and the saved library available offline.
// - "shell" cache: the app itself, replaced on each new version
// - "content" cache: search data, guides, tools, walking routes — kept across versions
const BUILD = 'b537693d3a';
const SHELL = 'shell-' + BUILD, CONTENT = 'content-v1';
const SHELL_FILES = ['./', 'index.html', 'app.js', 'search-worker.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'data/manifest.json'];
const shellPaths = new Set(SHELL_FILES.map(f => new URL(f, self.registration.scope).pathname));

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // Wikipedia, AI model downloads: handled elsewhere
  if (url.pathname.includes('/download/')) return; // the installer kit zip: straight from the network, never stored
  if (url.pathname.includes('/media/')) return;    // the video: straight from the network (it asks for a piece at a time), never stored
  if (url.pathname.endsWith('.pmtiles')) { e.respondWith(mapFile(req)); return; }   // the map's files: read a piece at a time
  // asked for afresh each time (the saved copy is for when there is no network): pages, the app, and the map's lists
  // (which files the map has, the place names, the addresses), so a newer map is seen as soon as there is one
  const fresh = req.mode === 'navigate' || url.pathname.endsWith('/data/manifest.json') || (url.pathname.includes('/maps/') && url.pathname.endsWith('.json')) || shellPaths.has(url.pathname);
  e.respondWith(fresh ? networkFirst(req, url) : cacheFirst(req, url));
});
const cacheFor = url => shellPaths.has(url.pathname) ? SHELL : CONTENT;
async function networkFirst(req, url) {
  try {
    // with a saved copy to fall back on, a signal too weak to answer in a few seconds counts as none
    const saved = await caches.match(req, { ignoreSearch: true });
    const r = await (saved ? Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 7000))]) : fetch(req));
    // a page that was redirected (e.g. a folder without its last /): let the browser follow the redirect itself;
    // Safari and every iPhone browser refuse to show a redirected page handed over by a service worker
    if (req.mode === 'navigate' && r.redirected) return Response.redirect(r.url, 302);
    if (r.ok && r.status === 200) (await caches.open(cacheFor(url))).put(req, r.clone());
    return r;
  } catch (err) {
    return (await caches.match(req, { ignoreSearch: true })) || (await caches.match('index.html')) || Response.error();
  }
}
async function cacheFirst(req, url) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok && r.status === 200) (await caches.open(cacheFor(url))).put(req, r.clone());
  return r;
}

// A map file (.pmtiles) is read a piece at a time (Range requests). Once it has been saved whole ("Also save the
// map"), the pieces are cut from the saved copy, so the map works offline; until then they come from the network.
const mapBlobs = new Map();   // url -> the saved file, kept open while this worker lives
async function mapFile(req) {
  const range = req.headers.get('range'), key = req.url;   // with its ?v=version
  let blob = mapBlobs.get(key);
  if (!blob) {
    const hit = await caches.match(key);
    if (hit) { blob = await hit.blob(); mapBlobs.set(key, blob); }
  }
  if (!blob) {
    if (range) return fetch(req);                       // a piece, straight from the network
    const r = await fetch(req);                         // the whole file: this is the save
    if (r.ok && r.status === 200) {
      const c = await caches.open(CONTENT), path = new URL(key).pathname;
      for (const old of await c.keys()) if (new URL(old.url).pathname === path && old.url !== key) await c.delete(old);   // an older version of this map
      await c.put(key, r.clone());
    }
    return r;
  }
  const m = range && /bytes=(\d+)-(\d*)/.exec(range);
  if (!m) return new Response(blob, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(blob.size) } });
  const start = +m[1], end = Math.min(m[2] ? +m[2] : blob.size - 1, blob.size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
  return new Response(blob.slice(start, end + 1), { status: 206, headers: { 'Content-Type': 'application/octet-stream',
    'Content-Range': `bytes ${start}-${end}/${blob.size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
}
