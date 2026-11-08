// Service worker: keeps the app and the saved library available offline.
// - "shell" cache: the app itself, replaced on each new version
// - "content" cache: search data, guides, tools, walking routes — kept across versions
const BUILD = '831785f757';
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
  const fresh = req.mode === 'navigate' || url.pathname.endsWith('/data/manifest.json') || shellPaths.has(url.pathname);
  e.respondWith(fresh ? networkFirst(req, url) : cacheFirst(req, url));
});
const cacheFor = url => shellPaths.has(url.pathname) ? SHELL : CONTENT;
async function networkFirst(req, url) {
  try {
    const r = await fetch(req);
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
