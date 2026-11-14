// ARK, the Apocalypse Reference Kit — one app for two places:
//  * "drive" mode: served by the Library Assistant program on the laptop (searches every PDF and
//    the Kiwix archives on the drive; the AI is the laptop's llama-server)
//  * "public" mode: a static website; search runs in the browser, the AI runs in the browser
//    (WebLLM / WebGPU), Wikipedia is searched online, and everything can be saved for offline use.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } },
                set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
const BASE = new URL('./', location.href).href;
// older phones (Safari before iOS 16) lack AbortSignal.timeout
if (!AbortSignal.timeout) AbortSignal.timeout = ms => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };

let mode = 'public', server = {}, manifest = null, worker = null, workerReady = false, workerSearchable = false, workerInfo = {};
const ai = { kind: 'none', engine: null, label: '', loading: false, error: '' };

// ------------------------------------------------------------------ line icons (drawn here: nothing to fetch)
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  book: '<path d="M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5z"/><path d="M12 6v13"/>',
  page: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>',
  chat: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  right: '<path d="m9 6 6 6-6 6"/>', alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v5M12 17.6v.4"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L3 18l3 3 6.2-6.2a4 4 0 0 0 5.3-5.3l-2.7 2.7-2.5-.5-.5-2.5z"/>',
  down: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  usb: '<rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 13V6h8v7M10.5 9h.01M13.5 9h.01"/>',
  wifi: '<path d="M5 12a10 10 0 0 1 14 0M8 15a6 6 0 0 1 8 0"/><circle cx="12" cy="18.5" r="1"/>',
  box: '<rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M7 8V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M10 13h4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17v.4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.4v.4"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  ruler: '<path d="M3 16 16 3l5 5L8 21z"/><path d="m7 12 2 2M10 9l2 2M13 6l2 2"/>',
  morse: '<path d="M3 12h3M9 12h1M13 12h3M19 12h2"/>',
  pill: '<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="m9.5 9.5 5 5"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14"/><path d="M5 19 13 11"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m4 17 5-4 4 3 3-2 4 3"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>', cross: '<path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5z"/>',
  drop: '<path d="M12 3c3.5 4.2 6 7.3 6 10.5a6 6 0 0 1-12 0C6 10.3 8.5 7.2 12 3z"/>', bowl: '<path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M9 7c0-1.5 1-1.5 1-3M14 7c0-1.5 1-1.5 1-3"/>',
  tree: '<path d="M12 3 6 11h3l-4 6h14l-4-6h3z"/><path d="M12 17v4"/>', paw: '<circle cx="7.5" cy="9" r="1.7"/><circle cx="12" cy="6.5" r="1.7"/><circle cx="16.5" cy="9" r="1.7"/><path d="M8 17c0-2.5 2-4.5 4-4.5s4 2 4 4.5c0 1.5-1.3 2-4 2s-4-.5-4-2z"/>',
  bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>', folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  draft: '<path d="M4 20V5l15 15z"/><path d="M8 20v-5.5l5.5 5.5"/>' };
const ic = (n, size = 22) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ICONS.page}</svg>`;
const noPic = t => t.replace(/^[^\w(&]+\s*/u, '');   // a title without the little picture in front of it
const SHELF_ICON = { start: 'compass', health: 'cross', water: 'drop', food: 'bowl', wild: 'tree', animals: 'paw', shelter: 'home', power: 'bolt', making: 'wrench', travel: 'route', comms: 'wifi', disaster: 'alert', fun: 'book', library: 'usb', other: 'folder' };
const TOOL_ICON = { map: 'pin', calc: 'calc', sci: 'calc', conv: 'ruler', morse: 'morse', pill: 'pill', plantid: 'leaf', walk: 'route', cad: 'draft' };

// ------------------------------------------------------------------ the screens
// Each is a <section> of the page. nav: the button it lights up. back: the screen above it (it then gets a Back
// button). sec + page: one of the cards kept in the #setup section. The old addresses still mean what they did:
// #ask, #tools (Guides), #library (Books), #kit (Tools), #setup (now Offline & downloads), #tools:food, #photos.
const VIEWS = {
  welcome: { bare: true },
  home: { nav: 'home', title: 'Home' },
  ask: { nav: 'ask', title: 'Ask ARK' },
  tools: { nav: 'tools', title: 'Library' },
  library: { nav: 'tools', title: 'Library' },
  maps: { nav: 'maps', title: 'Maps & Routes' },
  kit: { nav: 'kit', title: 'Tools' },
  photos: { nav: 'kit', title: 'Family photos & videos', back: 'kit' },
  more: { nav: 'more', title: 'More' },
  help: { nav: 'more', title: 'Help', back: 'more' },
  setup: { nav: 'more', title: 'Offline & downloads', back: 'more', page: 'offline' },
  ai: { nav: 'more', title: 'Offline AI', back: 'setup', sec: 'setup', page: 'ai' },
  usb: { nav: 'more', title: 'Complete offline library (USB)', back: 'setup', sec: 'setup', page: 'usb' },
  sharing: { nav: 'more', title: 'Share with nearby devices', back: 'more', sec: 'setup', page: 'sharing' },
  vault: { nav: 'more', title: 'ARK Vault', back: 'more', sec: 'setup', page: 'vault' },
  status: { nav: 'more', title: 'System status', back: 'more', sec: 'setup', page: 'status' },
  about: { nav: 'more', title: 'About', back: 'more', sec: 'setup', page: 'about' } };
const NAV = [['home', 'Home', 'home'], ['tools', 'Library', 'book'], ['ask', 'Ask', 'chat'], ['maps', 'Maps', 'map'], ['kit', 'Tools', 'wrench'], ['more', 'More', 'more']];
const SIDE = [['home', 'Home', 'home'], ['ask', 'Ask ARK', 'chat'], ['tools', 'Guides', 'page'], ['library', 'Books', 'book'], ['maps', 'Maps & Routes', 'map'], ['kit', 'Tools', 'wrench'], ['setup', 'Offline & downloads', 'down'], ['more', 'Settings & help', 'sliders']];
let view = '', pushed = 0, SAVED = {};

// ------------------------------------------------------------------ start-up
init();
screenKeyboard();
async function init() {
  bindUI();
  // the drive edition is served by the Library Assistant: on this device, or shared over Wi-Fi from another
  if (location.protocol !== 'file:') try {
    const r = await fetch('api/status', { signal: AbortSignal.timeout(1500) });
    if (r.ok) { const s = await r.json(); if (s && 'docs' in s) { mode = 'drive'; server = s; } }
  } catch {}
  if (mode === 'drive') {
    $('tagline').textContent = 'Searches every manual, guide and offline encyclopedia on this drive, then has the offline AI answer from what it finds. Everything runs on this device (or the one sharing it with you) — no internet.';
    $('wikilabel').textContent = 'Wikipedia & archives';
    setInterval(refreshServer, 5000);
    const pr = document.createElement('script'); pr.src = '/print.js'; pr.defer = true; document.head.appendChild(pr); // receipt printer (print.go)
  } else {
    try { manifest = await (await fetch('data/manifest.json', { cache: 'no-cache' })).json(); } catch {}
    startWorker();
    addEventListener('pagehide', stopWorker);
    addEventListener('pageshow', e => { if (e.persisted && !worker) { startWorker(); renderStatus(); } });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    addEventListener('pagehide', stopAI);   // leaving the page frees the AI's memory; it starts again at the next question
    addEventListener('online', renderStatus); addEventListener('offline', renderStatus);
  }
  renderNav(); renderStatus(); renderTools(); renderKit(); renderSetup(); loadLibrary(); restoreAnswers();
  openFromHash(); restoreScroll(location.hash.slice(1).split(':')[0] || 'home');
  addEventListener('pagehide', saveScroll);
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) { $('q').value = q0; ask(); }
}

async function refreshServer() {
  try { server = await (await fetch('api/status')).json(); } catch {}
  renderStatus(); renderHealth();
}

// More > Offline & downloads on the drive: sharp satellite photos for the map's Satellite switch. The map's own files have
// them only from far out; this keeps the close-up ones on the drive (mapsat.go), so they are sharp with no internet.
let satTimer = 0;
async function loadSat(act) {
  const card = $('satmap'); if (!card || mode !== 'drive') return;
  if (act === 'remove' && !confirm('Remove the sharp satellite photos from the drive? The map keeps the less sharp ones.')) return;
  let j; try { j = await (await fetch('api/mapsat', act ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ do: act }) } : {})).json(); } catch { return; }
  card.hidden = !j.offer || !j.local;
  if (card.hidden) return;
  const st = j.state || {}, gbs = (j.offer.detail_mb / 1024).toFixed(1), size = mb => mb < 1000 ? Math.round(mb) + ' MB' : (mb / 1024).toFixed(1) + ' GB';
  $('sattext').innerHTML = j.have && !st.running
    ? `Sharp satellite photos of the area are on the drive (${size(j.haveMB)}). The map's <b>Satellite photo</b> switch (Layers) shows them close up with no internet.`
    : `The map's <b>Satellite photo</b> switch (Layers) shows the area from the air. With no internet the photos are blurry close up. This keeps sharp ones on the drive, enough to see houses and tracks: about ${gbs} GB. It needs the internet and can take an hour or more, so do it on a computer, before the drive goes into an ARK Vault. If it stops part way, press Download again: it carries on.`;
  $('satgo').hidden = st.running || j.have; $('satgo').textContent = 'Download them';
  $('satstop').hidden = !st.running;
  $('satdel').hidden = st.running || !j.have;
  $('satbarw').hidden = !st.running;
  if (st.running) $('satbar').style.width = (st.total ? Math.round(st.done / st.total * 100) : 0) + '%';
  $('satprog').textContent = st.running ? `${st.step || ''}${st.total ? ` — ${st.done.toLocaleString()} of ${st.total.toLocaleString()} (${size(st.mb)} so far)` : ''}. Keep this window open.`
    : st.error || (st.step === 'Done' ? 'Done. The sharp photos are on the drive.' : st.step === 'Removed' ? 'Removed.' : '');
  clearTimeout(satTimer);
  if (st.running) satTimer = setTimeout(loadSat, 2000);
}

// More > Offline & downloads on the drive: a detailed map for the browser map (roads and topo lines for a wide area around the local
// one). The Library Assistant cuts it out of the public world maps, so it needs the internet: once, on a computer.
let wideTimer = 0;
async function loadWide(act) {
  const card = $('widemap'); if (!card || mode !== 'drive') return;
  let j; try { j = await (await fetch('api/mapwide', act ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ do: act }) } : {})).json(); } catch { return; }
  card.hidden = !j.offer || !j.local;
  if (card.hidden) return;
  const st = j.state || {}, gbs = (j.offer.mb / 1024).toFixed(1);
  $('widetext').innerHTML = j.have && !st.running
    ? `The map (Tools → Map) has roads and topo lines for <b>${esc(j.offer.label)}</b>${j.offer.note ? ' (' + esc(j.offer.note) + ')' : ''}. Property lines and the other layers cover the local area.`
    : `The map (Tools → Map) covers the local area. This adds roads and topo lines for <b>${esc(j.offer.label)}</b>${j.offer.note ? ' (' + esc(j.offer.note) + ')' : ''}: about ${gbs} GB. It needs the internet and can take some hours, so do it on a computer, before the drive goes into an ARK Vault. If it stops part way, press Download again and it carries on.`;
  $('widego').hidden = st.running; $('widego').textContent = j.have ? 'Download it again (a newer map)' : 'Download it';
  $('widestop').hidden = !st.running;
  $('widebarw').hidden = !st.running;
  if (st.running) $('widebar').style.width = (st.totalMB ? Math.round(st.doneMB / st.totalMB * 100) : 0) + '%';
  $('wideprog').textContent = st.running ? `${st.step || ''}${st.totalMB ? ` — ${Math.round(st.doneMB)} of ${Math.round(st.totalMB)} MB` : ''}. Keep this window open.`
    : st.error || (st.step === 'Done' ? 'Done. The bigger map is on the drive.' : '');
  clearTimeout(wideTimer);
  if (st.running) wideTimer = setTimeout(loadWide, 2000);
}

// More > Vault system status, on a Raspberry Pi: what slows the AI down, in plain words (from /api/status, every 5 seconds)
let lastPace = null;   // how fast the AI read and wrote in the last answer (llama-server's timings)
function renderHealth() {
  const box = $('pihealth');
  if (!box) return;
  const th = server.throttled;
  box.hidden = !(mode === 'drive' && (typeof th === 'number' && th >= 0 || server.tempC));
  if (box.hidden) return;
  $('pihtitle').textContent = server.ark ? 'Vault system status' : 'Raspberry Pi status';
  const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
  let h = '<table class="health">';
  if (th >= 0) h += row('Power', th & 0x1 ? '⚠️ <b>Too weak right now</b>'
    : th & 0x10000 ? '⚠️ <b>Dipped</b> at least once since it was switched on' : '✅ OK since it was switched on');
  if (th >= 0) h += row('Slowed down?', th & 0x6 ? '⚠️ <b>Yes, right now</b>: the Pi has cut its own speed, so the AI is very slow'
    : th & 0x60000 ? '⚠️ Not now, but it has since it was switched on' : '✅ No, not since it was switched on');
  if (server.tempC) h += row('Temperature', `${server.tempC} °C — ` + (server.tempC >= 80 ? '⚠️ <b>too hot</b>: it slows itself down'
    : server.tempC >= 60 ? 'warm (the fan comes on at 60 °C)' : 'fine'));
  if (server.cpuMHz) h += row('Processor speed', `${server.cpuMHz} MHz` + (server.cpuMaxMHz ? ` of ${server.cpuMaxMHz} MHz at most` : '')
    + (server.cpuMaxMHz && server.cpuMHz < server.cpuMaxMHz ? ' (low is normal when it has nothing to do)' : ''));
  if (server.memFreeMB != null) h += row('Free memory', `${server.memFreeMB} MB` + (server.memFreeMB < 300 ? ' — ⚠️ low: the AI slows right down' : ''));
  h += row('AI', esc(server.model || 'off'));
  if (lastPace) h += row('Last answer', `read about ${lastPace.read} words a second, wrote about ${lastPace.wrote} a second`);
  box.querySelector('#pihbody').innerHTML = h + '</table>';
}

// The search loads in two steps to spare phones' memory (a page that runs short of it crashes):
// guides and book titles when the page opens, the text of every book page once someone starts a
// question (wantFull). Leaving the page stops it, which frees the memory for the next page.
let fullAsked = false;
function startWorker() {
  fullAsked = false; workerReady = workerSearchable = false; workerInfo = {};
  worker = new Worker('search-worker.js');
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'light') { workerSearchable = true; workerInfo.light = m.docs; workerInfo.progress = `${m.loaded}/${m.total}`; renderStatus(); }
    else if (m.type === 'progress') { workerSearchable = true; workerInfo.progress = `${m.loaded}/${m.total}`; if (fullAsked) renderStatus(); }
    else if (m.type === 'ready') { workerReady = workerSearchable = true; workerInfo = m; renderStatus(); }
    else if (m.type === 'error') { workerInfo.error = m.message; renderStatus(); }
    else if (m.type === 'results' && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.type === 'docs' && docsWaiter) { docsWaiter(m.docs); docsWaiter = null; }
  };
  worker.postMessage({ type: 'load', base: BASE });
}
// Low-memory mode: after an answer was cut off by a crash, or on an iPhone/iPad while the AI is on (the AI
// alone takes about 1 GB there), the search stays on the guides and book titles; one tap loads the rest.
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const lowMem = () => { let f = null; try { f = sessionStorage.getItem('so-lowmem'); } catch {} return f === '1' || (f !== '0' && isIOS && (ai.kind === 'webllm' || ai.loading || !!store.get('aiModel'))); };
function setLowMem(on) { try { sessionStorage.setItem('so-lowmem', on ? '1' : '0'); } catch {} }
// The in-browser AI takes about 1 GB, so it starts only when someone starts a question (wantAI) and stops
// when the page is left: reading guides never loads it.
let aiStart = null;
function wantAI() { if (mode === 'public' && store.get('aiModel') && ai.kind === 'none' && !ai.loading && !aiStart) aiStart = initWebLLM(store.get('aiModel'), true).finally(() => { aiStart = null; }); return aiStart; }
function stopAI() { if (!ai.engine) return; try { ai.engine.unload?.(); } catch {} ai.engine = null; ai.kind = 'none'; }
const booksOn = () => !$('usebooks') || $('usebooks').checked;
function wantFull(force) { if (mode === 'public' && worker && !fullAsked && (force === true || (!lowMem() && booksOn()))) { fullAsked = true; worker.postMessage({ type: 'more' }); renderStatus(); } }
function stopWorker() {
  if (!worker) return;
  worker.terminate(); worker = null; workerReady = workerSearchable = false; fullAsked = false;
  for (const [, res] of pending) res({ results: [], notReady: true }); pending.clear();
}
const pending = new Map(); let reqId = 0, docsWaiter = null;
// Resolves { results, partial, loaded, total } or { results: [], notReady: true }.
function workerSearch(q, n, only) {
  if (!worker) { startWorker(); wantFull(); }   // stopped when the page was left (see stopWorker)
  return new Promise(res => {
    if (!workerSearchable) {   // first part of the library still downloading: wait for it (never fail silently)
      const t0 = Date.now();
      const t = setInterval(() => {
        if (workerSearchable) { clearInterval(t); workerSearch(q, n, only).then(res); }
        else if (workerInfo.error || Date.now() - t0 > 90000) { clearInterval(t); res({ results: [], notReady: true }); }
      }, 300);
      return;
    }
    const id = ++reqId; pending.set(id, res); worker.postMessage({ type: 'search', q, n, id, only });
  });
}

// ------------------------------------------------------------------ status bar
function renderStatus() {
  const pill = (state, label, detail) => `<span class="pill"><span class="dot ${state}"></span><b>${label}</b> ${detail}</span>`;
  let h = '';
  if (mode === 'drive') {
    const w = s => s === 'ready' ? 'ready' : s === 'starting' ? 'starting…' : 'not available';
    h += pill(server.llm, 'AI', w(server.llm) + (server.model ? ' — ' + esc(server.model) : ''));
    h += pill(server.kiwix, 'Encyclopedias', server.kiwix === 'off' ? 'not available' : w(server.kiwix) + (server.zims ? ` (${server.zims})` : ''));
    h += pill(server.docs ? 'ready' : 'off', 'Documents', server.docs ? `${server.docs} files` : 'index missing');
    // a Raspberry Pi that has slowed itself down (weak power or heat): everything, the AI most, runs slower
    const slow = piSlow();
    if (slow) h += pill('off', slow.label, '— ' + slow.detail);
  } else {
    h += pill(navigator.onLine ? 'ready' : 'starting', navigator.onLine ? 'Online' : 'Offline', navigator.onLine ? '' : '— using saved copy');
    h += pill(workerReady || (workerSearchable && !fullAsked) ? 'ready' : 'starting', 'Search', workerReady ? `${workerInfo.docs} documents`
      : workerInfo.error ? 'failed to load' : workerSearchable && !fullAsked ? 'guides ready' : workerSearchable ? `ready, still loading ${workerInfo.progress}` : 'loading…');
    const chosen = store.get('aiModel') && MODELS[store.get('aiModel')];
    h += pill(ai.kind === 'webllm' || chosen ? 'ready' : ai.loading ? 'starting' : 'off', 'AI', ai.kind === 'webllm' ? esc(ai.label) : ai.loading ? 'loading…'
      : chosen ? esc(chosen[2]) + ' — starts when you ask' : 'off — turn on under More');
  }
  $('status').innerHTML = h;
  const chip = $('netchip'); chip.hidden = false;   // the one word in the header: where this library is, or whether there is a signal
  if (mode === 'drive') { chip.textContent = server.ark ? 'On a Vault' : 'On this drive'; chip.classList.remove('off'); }
  else { chip.textContent = navigator.onLine ? 'Online' : 'Offline'; chip.classList.toggle('off', !navigator.onLine); }
  if (view === 'home') renderHomeOff();
}

// A Raspberry Pi's own record (server.throttled, the firmware's get_throttled): 0x1 the power is too weak now,
// 0x2/0x4 it has slowed its processor down now, 0x8 it's hot enough to start doing that; 0x10000, 0x20000/0x40000
// and 0x80000 the same at some point since it was switched on. Weak power doesn't always slow it down (0x10001 is
// "too weak, but running at full speed"); slowed down, a Pi 4 runs at about a third of its speed, and the AI takes
// minutes instead of seconds. null when all is well (or it isn't a Pi). now: slowed down at this moment.
function piSlow() {
  const th = mode === 'drive' && server.throttled > 0 ? server.throttled : 0;
  if (!th) return null;
  const power = server.ark ? 'Charge the battery, then check the 5 V wires to the Pi (ARK Vault guide, "If something goes wrong").'
    : 'Use the official Raspberry Pi power supply and its own cable.';
  const heat = server.ark ? 'Keep the lid open and the can in the shade.' : 'Give it more air, or a cooler with a fan.';
  const slowNow = !!(th & 0x6), hot = !!(th & 0x80008), weak = !!(th & 0x10001);
  const why = hot && !weak ? 'the Pi is too hot' : 'the Pi is short of power';
  if (slowNow) return { now: true, why, label: hot && !weak ? '⚠️ Too hot' : '⚠️ Power too weak',
    detail: 'the Pi has slowed itself down, so the AI is very slow. ' + (hot && !weak ? heat : power) };
  if (th & 0x1) return { now: false, why, label: '⚠️ Power too weak', detail: 'right now. The Pi may slow itself down, and the AI with it. ' + power };
  if (th & 0x10000) return { now: false, why, label: '⚠️ Power dipped', detail: 'since the Pi was switched on. It may slow itself down when it does. ' + power };
  return { now: false, why, label: '⚠️ Got too hot', detail: 'since the Pi was switched on. It slows itself down when it does. ' + heat };
}

// An app saved to the home screen has no browser around it: a book (a PDF) would fill the screen with no way
// back and no way to print. There it opens in a window of its own instead (on an iPhone: Done to come back,
// and Share > Print to print).
if (window.matchMedia && matchMedia('(display-mode: standalone)').matches || navigator.standalone)
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (a && !a.target && /\.pdf(?![a-z0-9])/i.test(a.getAttribute('href'))) { a.target = '_blank'; a.rel = 'noopener'; }
  }, true);

// ------------------------------------------------------------------ tabs & bindings
function bindUI() {
  document.addEventListener('click', e => {   // anything that goes to a screen says which: data-go, or data-tab on the two bars
    const th = e.target.closest('[data-theme-set]'); if (th) { setTheme(th.dataset.themeSet); renderMore(); return; }
    const b = e.target.closest('[data-go],#tabs button,#side button'); if (!b || e.defaultPrevented) return;
    e.preventDefault();
    if (b.closest('#welcome')) store.set('ark-welcomed', '1');
    go(b.dataset.go || b.dataset.tab, { grp: b.dataset.grp, ask: b.dataset.ask });
  });
  $('backbtn').addEventListener('click', goBack);
  $('openark').addEventListener('click', () => { store.set('ark-welcomed', '1'); go('home'); });
  $('showwelcome').addEventListener('click', () => go('welcome'));
  $('hq').addEventListener('input', homeSearch);
  $('hq').addEventListener('keydown', e => { const q = $('hq').value.trim(); if (e.key === 'Enter' && q) { e.preventDefault(); go('ask', { ask: q }); } });
  $('guideq').addEventListener('input', filterGuides);
  document.addEventListener('click', onLinkClick, true);
  const EX = ['How do I purify creek water?', 'Signs of milk fever in a goat', 'How far is Grants Pass on foot?', 'How do I stop bleeding from a deep cut?',
    'How do I can venison safely?', 'How much power can a small creek make?', 'What plants here are poisonous?', 'How do I make soap from wood ash?',
    'How long should I shelter after fallout?', 'How do I tell a chanterelle from a look-alike?',
    'How do I signal a plane for help?', 'How much food does a family need for a year?'];
  $('examples').innerHTML = EX.map(x => `<button class="ex" type="button">${esc(x)}</button>`).join('');
  $('examples').addEventListener('click', e => { if (e.target.classList.contains('ex')) { $('q').value = e.target.textContent; ask(); } });
  // Search in: Guides, Books, Wikipedia. Remembered on this device; at least one stays ticked.
  let si = {}; try { si = JSON.parse(store.get('ask-in') || '{}') || {}; } catch {}
  for (const [id, k] of [['useguides', 'g'], ['usebooks', 'b'], ['usewiki', 'w']]) {
    if (si[k] === false) $(id).checked = false;
    $(id).addEventListener('change', e => {
      if (!$('useguides').checked && !$('usebooks').checked && !$('usewiki').checked) e.target.checked = true;
      store.set('ask-in', JSON.stringify({ g: $('useguides').checked, b: $('usebooks').checked, w: $('usewiki').checked }));
      if (id === 'usebooks' && e.target.checked) wantFull();
    });
  }
  $('f').addEventListener('submit', e => { e.preventDefault(); ask(); });
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } });
  // the example questions are only for an empty page: they go as soon as you type (and stay gone once there are answers)
  $('q').addEventListener('input', () => { $('examples').hidden = !!$('q').value.trim() || !!$('out').children.length; wantFull(); wantAI(); });
  $('q').addEventListener('focus', () => { wantFull(); wantAI(); });
  $('out').addEventListener('click', e => {   // Try again (a cut-off answer), and "search every book page too"
    const r = e.target.closest('button.retry'), f = e.target.closest('button[data-full]');
    if (r) { const box = r.closest('.qa'), q = box?.querySelector('.q')?.textContent || ''; box?.remove(); saveAnswers(); if (q) { $('q').value = q; ask(); } }
    if (f) { setLowMem(false); wantFull(true); f.replaceWith(document.createTextNode('Loading every book page now; ask again in a minute.')); saveAnswers(); }
  });
  $('out').addEventListener('click', e => {   // [1] in an answer: scroll to that source without changing the address
    const a = e.target.closest('a.cite'); if (!a) return;
    const t = document.getElementById(a.getAttribute('href').slice(1)); if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });
  $('libq').addEventListener('input', () => renderLibrary());
  for (const id of ['libout', 'toolgrid']) {
    $(id).addEventListener('toggle', rememberOpen, true);
    $(id).addEventListener('click', e => { const b = e.target.closest('button[data-all]'); if (b) setAllOpen($(id), b.dataset.all === '1'); });
  }
  $('aion').addEventListener('click', () => initWebLLM(document.querySelector('input[name=model]:checked').value, false));
  $('aioff').addEventListener('click', async () => { store.set('aiModel', null); try { await ai.engine?.unload?.(); } catch {} ai.engine = null; ai.kind = 'none'; renderSetup(); renderStatus(); });
  $('savelib').addEventListener('click', () => saveOffline('library'));
  $('saveroutes').addEventListener('click', () => saveOffline('routes'));
  $('savemap').addEventListener('click', () => saveOffline('map'));
  $('widego').addEventListener('click', () => loadWide('start'));
  $('widestop').addEventListener('click', () => loadWide('stop'));
  $('satgo').addEventListener('click', () => loadSat('start'));
  $('satstop').addEventListener('click', () => loadSat('stop'));
  $('satdel').addEventListener('click', () => loadSat('remove'));
  $('shareon').addEventListener('click', () => setShare(true));
  $('shareoff').addEventListener('click', () => setShare(false));
  bindPhotos();
}

// ------------------------------------------------------------------ asking
let counter = 0;
async function ask() { wantFull(); wantAI(); writing++; try { await askOnce(); } finally { writing--; } }
async function askOnce() {
  const q = $('q').value.trim(); if (!q) return;
  const id = ++counter, n = +$('nsrc').value, useAI = $('useai').checked, useWiki = $('usewiki').checked;
  const useGuides = $('useguides').checked, useBooks = $('usebooks').checked, useLib = useGuides || useBooks;
  const only = useGuides && !useBooks ? 'guides' : useBooks && !useGuides ? 'books' : '';
  const box = document.createElement('div'); box.className = 'qa';
  box.innerHTML = `<div class="q">${esc(q)}</div><div class="meta" id="m${id}"><span class="spin"></span>Searching the library…</div><div class="answer" id="a${id}"></div><div class="sources" id="s${id}" hidden></div>`;
  $('out').prepend(box); $('q').value = ''; $('examples').hidden = true;
  if (view !== 'ask') go('ask');
  if (box.getBoundingClientRect().top > innerHeight * 0.5) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  saveAnswers();

  // Ask for a few extra encyclopedia articles and keep only those whose title has one of the question's
  // key words and whose text has two (a search for "small creek power" also turns up cartoon characters,
  // and one for bleach in water a fake cure); the library fills any gap.
  const nWiki = !useWiki ? 0 : useLib ? Math.max(1, Math.round(n / 3)) : n, qt = qterms(q), need = Math.min(2, qt.size);
  const shared = s => { let k = 0; for (const x of qt) if (qterms(s).has(x)) k++; return k; };
  const onTopic = s => shared(s.title) >= 1 && shared(s.title + ' ' + (s.text || s.snippet || '')) >= need;
  let docs = [], wiki = [], note = '';
  if (mode === 'drive') {
    [docs, wiki] = await Promise.all([
      useLib ? fetch('api/search?q=' + encodeURIComponent(q) + '&n=' + n + (only ? '&in=' + only : '')).then(r => r.json()).catch(() => []) : [],
      nWiki ? fetch('api/kiwix?q=' + encodeURIComponent(q) + '&n=' + (nWiki + 2)).then(r => r.json()).catch(() => []) : [],
    ]);
  } else {
    let ws; [ws, wiki] = await Promise.all([useLib ? workerSearch(q, n, only) : { results: [] }, nWiki && navigator.onLine ? wikiSearch(keywords(q) || q, nWiki + 2) : []]);
    docs = ws.results;
    if (ws.notReady) note = ' ⚠️ The library search is still downloading — try again in a minute (needs a connection the first time).';
    else if (ws.partial && lowMem()) note = ' To save this phone\'s memory, only the guides and book titles were searched. <button class="link" data-full="1">Search every book page too</button>';
    else if (ws.partial) note = ` ⏳ Library still loading (${ws.loaded} of ${ws.total} parts): guides and book titles were searched; ask again in a minute to search inside every page.`;
  }
  // the library first (its guides are written for exactly this), then the encyclopedia articles that fit
  const z = (Array.isArray(wiki) ? wiki : []).filter(onTopic).slice(0, nWiki), d = Array.isArray(docs) ? docs : [];
  const srcs = d.slice(0, Math.max(n - z.length, n - nWiki)).concat(z);
  renderSources(id, srcs);
  const meta = $('m' + id);
  const where = [useGuides && 'the guides', useBooks && 'the books', useWiki && 'Wikipedia'].filter(Boolean).join(' or ');
  if (!srcs.length) meta.textContent = note ? '' : `Nothing in ${where} matched. Try other words (e.g. "bleeding" instead of "cut")` +
    (useGuides && useBooks && useWiki ? '.' : ', or tick more boxes under "Search in".');
  else meta.textContent = `${srcs.length} sources found.`;
  meta.innerHTML = esc(meta.textContent) + note;
  const mc = morseAsk(q);
  if (mc) { showMorse(id, mc); meta.textContent = 'Answered from the standard Morse code table (no AI needed).'; saveAnswers(); return; }
  if (!useAI) { showBest(id, srcs, q); saveAnswers(); return; }
  if (mode === 'drive') {
    if (server.llm === 'off') { showBest(id, srcs, q); saveAnswers(); meta.innerHTML += ' <span>' + esc(server.llmError || 'The AI is turned off on this device.') + ' You can change the AI in <a href="#ai" data-go="ai">Offline AI settings</a>.</span>'; return; }
    if (server.llm !== 'ready') { meta.innerHTML = '<span class="spin"></span>Waiting for the AI to finish loading…'; await waitFor(() => server.llm === 'ready' || server.llm === 'off'); }
    if (server.llm === 'ready') await answer(id, q, srcs, 'server');
  } else {
    if (ai.loading || aiStart) { meta.innerHTML = '<span class="spin"></span>Starting the AI (the first answer after opening takes a little longer)…'; await (aiStart || waitFor(() => !ai.loading)); }
    if (ai.kind === 'webllm') await answer(id, q, srcs, 'webllm');
    else showBest(id, srcs, q), meta.innerHTML += ' <span>To get written answers, turn on the AI in <a href="#ai" data-go="ai">Offline AI settings</a>.</span>';
  }
  saveAnswers();
}

// A copy of the answers lives in sessionStorage (this browser tab only), so if the page reloads in the
// middle of an answer - phones do that when memory runs short while the AI is working - the answers come
// back, and one that was cut off says so instead of just vanishing.
let saveTimer = 0;
function saveAnswers(soon) {
  if (soon) { if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = 0; saveAnswers(); }, 1500); return; }
  try { sessionStorage.setItem('so-answers', JSON.stringify({ n: counter, html: $('out').innerHTML })); } catch {}
}
function restoreAnswers() {
  let s = null; try { s = JSON.parse(sessionStorage.getItem('so-answers') || 'null'); } catch {}
  if (!s || !s.html || $('out').children.length) return;
  $('out').innerHTML = s.html; counter = Math.max(counter, s.n || 0); $('examples').hidden = true;
  $('out').querySelectorAll('.meta').forEach(m => {   // still had a spinner = the page restarted mid-answer
    if (!m.querySelector('.spin')) return;
    setLowMem(true);
    m.innerHTML = '⚠️ This answer was cut off: the phone ran short of memory and restarted the page.<br>' +
      '<button class="retry" type="button">Try again</button><br><small>The next tries search the guides and book titles only, which uses much less memory.</small>';
  });
}
function waitFor(cond) { return new Promise(res => { const t = setInterval(() => { if (cond()) { clearInterval(t); res(); } }, 500); }); }

async function wikiSearch(q, n) {
  try {
    const u = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=' + n +
      '&gsrsearch=' + encodeURIComponent(q) + '&prop=extracts&exintro=1&explaintext=1&exchars=1200';
    const j = await (await fetch(u, { signal: AbortSignal.timeout(8000) })).json();
    return Object.values(j.query?.pages || {}).sort((a, b) => a.index - b.index).map(p => ({
      kind: 'zim', title: p.title, where: 'Wikipedia (online)', link: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(p.title.replace(/ /g, '_')),
      snippet: (p.extract || '').slice(0, 280) + ((p.extract || '').length > 280 ? ' …' : ''), text: p.extract || '' }));
  } catch { return []; }
}

function renderSources(id, srcs) {
  if (!srcs.length) return;
  const el = $('s' + id); el.hidden = false;
  el.innerHTML = '<h4>Sources</h4>' + srcs.map((s, i) => `<div class="src" id="src${id}-${i + 1}"><div class="num">${i + 1}</div><div>
    <a href="${esc(s.link)}">${esc(noPic(s.title))}</a> <span class="where">${esc(s.where)}</span>
    ${mode === 'public' && s.kind === 'doc' && !s.open ? '<span class="tag">title only — opens the original</span>' : ''}
    <div class="snip">${esc(s.snippet)}</div></div></div>`).join('');
}

// Short, plain rules work best for the small AIs that run on phones and the Pi.
const SYSTEM = 'You are an offline survival and reference assistant for a household in the Illinois Valley, southern Oregon, ' +
  'possibly after normal services have broken down. Answer the question from the numbered sources.\n' +
  '- Start with the direct answer in one or two sentences, then give practical steps if they help.\n' +
  '- Copy numbers, amounts, times, temperatures, doses and formulas exactly as the sources give them, with their units. ' +
  'Do not make up formulas or do your own calculations; if a source has a worked example, use it.\n' +
  '- Cite the source right after each fact, like [1] or [2][4].\n' +
  '- If the sources do not answer the question, say "The library does not cover this", then give your best general ' +
  'knowledge and put "(not from the library)" after it.\n' +
  '- For medical, electrical, chemical or structural topics, include the key safety warnings.\n' +
  '- Keep it under about 200 words.';

// ------------------------------------------------------------------ choosing what the AI reads
// The AI reads only a few hundred words, so what it gets matters most: the part of each passage that
// matches the question (not just its opening lines), more of the best sources, the book-page
// references taken out, and nothing off-topic.
const STOPW = new Set(`a about after again all also am an and any are as at be been before being both but by can could did do
does doing down during each few for from get got had has have having how i if in into is it its just like make made many may me
might more most much must my need no nor not now of off on once only or other our out over own please same shall she should so
some such than that the their them then there these they thing things this those through to too under until up use used using very
want was way ways we were what when where which while who why will with would you your tell know`.split(/\s+/));
function stemw(w) {   // the same rough word endings the search uses
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}
const qwords = s => String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2 && !STOPW.has(w));
const qterms = s => new Set(qwords(s).map(stemw));
const keywords = q => qwords(q).join(' ');
// questions that want a number: favor the part of a passage that has numbers in it
const QUANTITY = /\b(how (much|many|long|far|often|big|deep|hot|cold|warm|high|low|fast|heavy|old|wide|thick)|what (size|temperature|temp|dose|dosage|amount|ratio|gauge|depth|distance|spacing))\b/i;
// drop "(NCAT, p. 6)", "(🖼️ what head means)", "(see Start Here)": page references the AI can't use
function tidy(t) {
  // a picture's description is for search and screen readers; the AI can't see the picture, and the words
  // crowd out the steps around it
  let s = String(t || '').replace(/\s*\(picture: (?:[^()]|\([^()]*\))*\)/g, '');
  for (let i = 0; i < 2; i++) s = s.replace(/\s*\([^()]*(?:\bpp?\.\s?\d|🖼️|📖|📷|\bsee\b)[^()]*\)/g, '');
  return s.replace(/🖼️\s*/g, '').replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}
// a passage with the ones just before and after it (same page or guide section): the best stretch can be anywhere
const around = s => tidy([s.prev, s.text, s.more].filter(Boolean).join(' '));
// The guides' "Old advice in the library to ignore" tables list treatments now known to be wrong
// (suction for snakebite, tourniquet bands...). Say so, or a small AI may pass them on as advice.
const OLD_ADVICE = '[WARNING: this part lists OLD advice from older books that is now known to be WRONG. Do not recommend it; say it is outdated if it comes up.] ';
// a guide's list of picture links: useful to a person, nothing for the AI to read
const linkList = s => /#pictures/.test(s.link || '');
// the n-word stretch of text that covers the most of the question's words (and numbers, when it asks for one)
function focus(text, qt, n, wantNum) {
  const w = String(text).split(/\s+/).filter(Boolean); if (w.length <= n) return w.join(' ');
  const term = w.map(x => { for (const t of qterms(x)) if (qt.has(t)) return t; return ''; });
  const num = w.map(x => wantNum && /\d/.test(x) ? 1 : 0);
  // two of the question's words side by side ("milk fever") mark the spot better than either alone
  const pair = w.map((x, j) => j + 1 < w.length && term[j] && term[j + 1] && term[j] !== term[j + 1] ? 1 : 0);
  let best = 0, bestScore = -1;
  for (let i = 0; ; i = Math.min(i + 3, w.length - n)) {
    const seen = new Set(); let sc = 0, nums = 0, pairs = 0;
    for (let j = i; j < i + n; j++) { if (term[j]) { sc += 1; seen.add(term[j]); } nums += num[j]; if (j + 1 < i + n) pairs += pair[j]; }
    sc += 3 * seen.size + 0.5 * Math.min(nums, 6) + 3 * Math.min(pairs, 2);   // a few numbers help; a whole table of them shouldn't win
    if (sc > bestScore) { bestScore = sc; best = i; }
    if (i >= w.length - n) break;
  }
  for (let k = best; k > Math.max(0, best - 30); k--) if (/[.!?:]$/.test(w[k - 1])) { best = k; break; }   // start at a sentence
  return (best > 0 ? '… ' : '') + w.slice(best, best + n).join(' ') + (best + n < w.length ? ' …' : '');
}
// With the AI off: show the best-matching stretch of the top source, question words highlighted.
// "How do I say court in Morse code?": an exact answer from the International Morse table (the Signals &
// Morse guide's), not the AI, which is poor at spelling things out letter by letter
const MORSE = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..',
  m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.', '-': '-....-', "'": '.----.', '!': '-.-.--', '(': '-.--.', ')': '-.--.-',
  ':': '---...', '=': '-...-', '+': '.-.-.', '@': '.--.-.' };
function morseAsk(q) {
  if (!/\bmorse\b/i.test(q)) return null;
  const tidy = t => t.replace(/^\s*(?:the\s+(?:word|words|name|letters?)\s+|my\s+name,?\s+)/i, '').trim();
  let t = (q.match(/["“”'‘’]([^"“”‘’]{1,30})["“”'‘’]/) || [])[1]
    || (q.match(/\b(?:say|spell|write|send|signal|tap|sign|translate|type|key|flash|is)\s+(.+?)\s+(?:in|into|using|with)\s+morse\b/i) || [])[1]
    || (q.match(/\bmorse(?:\s+code)?\s+(?:for|of)\s+(.+?)\s*[?.!]*\s*$/i) || [])[1]
    || (q.match(/^\s*(?:what(?:'s|\s+is)\s+)?(.+?)\s+in\s+morse(?:\s+code)?\s*[?.!]*\s*$/i) || [])[1];
  if (!t) return null;
  t = tidy(t);
  if (!t || t.length > 30 || t.split(/\s+/).length > 4 || /^(how|what|why|when|where|which|who|is|are|can|do|does|should)\b/i.test(t)) return null;
  const words = t.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.every(w => [...w].every(ch => MORSE[ch]))) return null;
  return { text: t, words };
}
function showMorse(id, mc) {
  const P = guidePaths(), code = mc.words.map(w => [...w].map(ch => MORSE[ch]).join(' ')).join('  /  ');
  const letters = mc.words.map(w => [...w].map(ch => `<b>${esc(ch.toUpperCase())}</b> <code>${MORSE[ch]}</code>`).join(' · ')).join(' &nbsp;/&nbsp; ');
  const more = (P.morse ? ` <a href="${P.morse}">Play it as beeps or flashes, or practise sending it</a>.` : '') +
    (P.signals ? ` <a href="${P.signals}#morse-quick-reference-print-this">The whole table, and how to send it by light or sound</a>.` : '');
  $('a' + id).innerHTML = `<div class="best"><div class="bh">“${esc(mc.text)}” in Morse code</div>` +
    `<p style="font:bold 1.35em/1.4 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;overflow-wrap:anywhere">${esc(code)}</p>` +
    `<p>${letters}</p><p class="meta">A dot is short and a dash is three dots long. Leave a short pause between letters, a longer one between words (shown as /).${more}</p></div>`;
}

function showBest(id, srcs, q) {
  const s = srcs.find(x => x.kind === 'doc' && !linkList(x)) || srcs[0]; if (!s) return;
  const qt = qterms(q), i = srcs.indexOf(s) + 1;
  const text = focus(around(s), qt, 110, QUANTITY.test(q));
  const marked = text.split(/([\p{L}\p{N}][\p{L}\p{N}'’-]*)/u)
    .map((p, k) => k % 2 && [...qterms(p)].some(t => qt.has(t)) ? `<mark>${esc(p)}</mark>` : esc(p)).join('');
  $('a' + id).innerHTML = `<div class="best"><div class="bh">Best match: <a href="${esc(s.link)}">${esc(s.title)}</a> <a class="cite" href="#src${id}-${i}">[${i}]</a></div><p>${marked}</p></div>`;
}

async function answer(id, q, srcs, kind) {
  const meta = $('m' + id), out = $('a' + id);
  // How much the AI reads in all: the in-browser models have a 4k-token window (about 1,100 words of
  // sources leaves room for the answer); on the drive the AI chosen for this device decides (the Quick AI
  // reads less). The best sources get the biggest share; each gives the stretch that fits the question.
  if (kind === 'server' && server.sources) srcs = srcs.slice(0, server.sources);
  const budget = kind === 'webllm' ? 1100 : (server.words || 220) * srcs.length;
  const weight = srcs.map((s, i) => linkList(s) ? 0 : i === 0 ? 3 : i === 1 ? 2 : s.kind === 'zim' ? 1 : 1.4), wsum = weight.reduce((a, b) => a + b, 0) || 1;
  const qt = qterms(q), wantNum = QUANTITY.test(q);
  const ctx = srcs.map((s, i) => `[${i + 1}] ${s.title} (${s.where})\n` + (weight[i]
    ? (/#old-advice/.test(s.link || '') ? OLD_ADVICE : '') + focus(around(s), qt, Math.max(60, Math.round(budget * weight[i] / wsum)), wantNum)
    : '(a list of picture links)')).join('\n\n');
  const messages = [{ role: 'system', content: SYSTEM },
    { role: 'user', content: `Question: ${q}\n\nSources:\n\n${ctx || '(no matching sources)'}\n\nQuestion: ${q}` }];
  const t0 = Date.now(); let text = '', stopped = false, ctrl = new AbortController(), speed = null;
  const setMeta = (label) => {
    // on a Pi that has slowed itself down, say why the wait is long (the sources are there to read meanwhile)
    const slow = kind === 'server' ? piSlow() : null;
    const why = slow && slow.now ? `<br><small>⚠️ This will be slow: ${slow.why}. The sources below are ready to read now.</small>` : '';
    meta.innerHTML = `<span class="spin"></span>${label} <button class="sec" type="button">Stop</button> <span class="t"></span>${why}`; meta.querySelector('button').onclick = () => { stopped = true; ctrl.abort(); try { ai.engine?.interruptGenerate?.(); } catch {} }; };
  setMeta('The AI is reading the sources…');
  if (srcs.length) showBest(id, srcs, q);   // something to read straight away; the AI's answer takes its place
  const tick = setInterval(() => { const t = meta.querySelector('.t'); if (t) t.textContent = Math.round((Date.now() - t0) / 1000) + 's'; }, 1000);
  let looped = false;
  const add = piece => {
    if (looped) return;
    if (!text) setMeta('Writing…');
    text += piece;
    const cut = loopAt(text);   // a small AI can get stuck saying the same thing over and over: stop it there
    if (cut >= 0) { looped = stopped = true; text = text.slice(0, cut).trimEnd(); ctrl.abort(); try { ai.engine?.interruptGenerate?.(); } catch {} }
    out.innerHTML = render(text, id, srcs.length); saveAnswers(true);
  };
  const loopMsg = 'Stopped: the AI started repeating itself. Check the sources below.';
  try {
    if (kind === 'server') {
      // The connection to the AI can drop without a word: a phone that locks its screen during a long wait
      // usually loses it, and the answer would sit on "Writing…" for ever. Then it starts again by itself,
      // which is quick: the AI keeps what it has already read, so it goes straight to writing.
      let tries = 0, dropped = false, hiddenAt = 0, lastData = Date.now();
      const restart = () => { dropped = true; ctrl.abort(); };
      const onVis = () => {
        if (document.hidden) { hiddenAt = Date.now(); return; }
        if (hiddenAt && Date.now() - hiddenAt > 15000) restart();   // back after the screen was off
        hiddenAt = 0;
      };
      document.addEventListener('visibilitychange', onVis);
      // once writing has begun the words keep coming, even on a slow Pi: a minute of silence is a lost connection
      const dog = setInterval(() => { if (text && !document.hidden && Date.now() - lastData > 60000) restart(); }, 5000);
      try {
        for (;;) {
          let finished = false, err = null;
          dropped = false; lastData = Date.now();
          try {
            const r = await fetch('llm/v1/chat/completions', { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ messages, stream: true, temperature: 0.2, max_tokens: server.tier === 'quick' ? 400 : 700, cache_prompt: true,
                repeat_penalty: 1.1, dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 2 }) });
            if (!r.ok) { const e = new Error('AI error ' + r.status); e.fatal = true; throw e; }
            const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '';
            for (;;) {
              const { value, done } = await reader.read(); if (done) break;
              lastData = Date.now();
              buf += dec.decode(value, { stream: true }); let i;
              while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
                if (!line.startsWith('data:')) continue; const data = line.slice(5).trim(); if (data === '[DONE]') { finished = true; continue; }
                try { const j = JSON.parse(data); if (j.timings) speed = j.timings; if (j.choices?.[0]?.finish_reason) finished = true;
                  const piece = j.choices?.[0]?.delta?.content; if (piece) add(piece); } catch {}
              }
            }
          } catch (e) { err = e; }
          if (stopped) { if (err) throw err; break; }          // Stop pressed, or the AI was going round in circles
          if (finished && !err) break;
          if (err && err.fatal) throw err;
          if (++tries > 3) throw err || new Error('the connection to the AI kept dropping');
          // dropped: ask again (the old words stay on screen until the new ones come)
          ctrl = new AbortController(); text = ''; looped = false;
          setMeta('The connection to the AI dropped. Picking up again…');
        }
      } finally { clearInterval(dog); document.removeEventListener('visibilitychange', onVis); }
    } else {
      const stream = await ai.engine.chat.completions.create({ messages, stream: true, temperature: 0.2, max_tokens: 600 });
      for await (const ch of stream) { const piece = ch.choices?.[0]?.delta?.content; if (piece) add(piece); if (stopped) break; }
    }
    // how fast the AI read and wrote (about 3 words to 4 tokens): a slow device, or one slowing itself down, shows here
    const pace = speed && speed.prompt_per_second && speed.predicted_per_second
      ? ` It read about ${Math.round(speed.prompt_per_second * 0.75)} words a second and wrote about ${Math.round(speed.predicted_per_second * 7.5) / 10}.` : '';
    if (pace) { lastPace = { read: Math.round(speed.prompt_per_second * 0.75), wrote: Math.round(speed.predicted_per_second * 7.5) / 10 }; renderHealth(); }
    meta.textContent = looped ? loopMsg : stopped ? 'Stopped.' : `Answered in ${Math.round((Date.now() - t0) / 1000)} seconds from ${srcs.length} sources.${pace} Check the sources before relying on it.`;
  } catch (e) {
    meta.innerHTML = (looped ? esc(loopMsg) : stopped || e.name === 'AbortError' ? 'Stopped.' : esc('The AI could not answer (' + e.message + '). The sources below are still the search results.')) +
      ' <button class="retry" type="button">Try again</button>';
  } finally { clearInterval(tick); }
}

// where an answer starts going round in circles: the last 60 characters already said twice before (the
// third time round), or -1. The answer is cut where the second time round starts, so one full pass is kept.
function loopAt(t) {
  const n = 60; if (t.length < 3 * n) return -1;
  const tail = t.slice(-n), seen = [];
  for (let i = t.indexOf(tail); i >= 0 && i < t.length - n; i = t.indexOf(tail, i + 1)) seen.push(i);
  if (seen.length < 2) return -1;
  const end = Math.max(t.lastIndexOf('. ', seen[1]), t.lastIndexOf('.\n', seen[1]));   // at the end of a sentence if there is one
  return end > seen[0] ? end + 1 : seen[1];
}

// minimal Markdown: paragraphs, lists, **bold**, [n] citations -> links
function render(md, id, nsrc) {
  const lines = esc(md).split('\n'); let html = '', list = null;
  const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[(\d{1,2})\]/g, (m, n) => +n >= 1 && +n <= nsrc ? `<a class="cite" href="#src${id}-${n}">[${n}]</a>` : m);
  for (const raw of lines) {
    const l = raw.trim(), ul = l.match(/^[-*•]\s+(.*)/), ol = l.match(/^\d+[.)]\s+(.*)/);
    if (ul || ol) { const t = ul ? 'ul' : 'ol'; if (list !== t) { if (list) html += `</${list}>`; html += `<${t}>`; list = t; } html += `<li>${inline((ul || ol)[1])}</li>`; continue; }
    if (list) { html += `</${list}>`; list = null; }
    if (l) html += `<p>${inline(l.replace(/^#+\s*/, ''))}</p>`;
  }
  if (list) html += `</${list}>`;
  return html;
}

// ------------------------------------------------------------------ in-browser AI (WebLLM)
const MODELS = { small: ['Llama-3.2-1B-Instruct-q4f16_1-MLC', 'Llama-3.2-1B-Instruct-q4f32_1-MLC', 'Llama 3.2 1B (small)'],
                 medium: ['Llama-3.2-3B-Instruct-q4f16_1-MLC', 'Llama-3.2-3B-Instruct-q4f32_1-MLC', 'Llama 3.2 3B (medium)'] };
async function initWebLLM(key, auto) {
  if (ai.loading || !MODELS[key]) return;
  ai.error = '';
  const testLib = window.__webllmTest;   // automated tests plug in a stand-in engine here
  if (!testLib && !('gpu' in navigator)) { ai.error = 'This browser can’t run the AI (it needs WebGPU: a recent Chrome, Edge, or Safari on iOS/macOS 26+). Search still works.'; renderSetup(); return; }
  let adapter = testLib ? { features: new Set(['shader-f16']) } : null;
  if (!testLib) try { adapter = await navigator.gpu.requestAdapter(); } catch {}
  if (!adapter) { ai.error = 'No usable graphics adapter was found, so the AI can’t run here. Search still works.'; renderSetup(); return; }
  if (!auto && !navigator.onLine) { ai.error = 'Connect to the internet once to download the AI model; after that it works offline.'; renderSetup(); return; }
  const [f16id, f32id, label] = MODELS[key], id = adapter.features.has('shader-f16') ? f16id : f32id;
  ai.loading = true; renderSetup(); renderStatus();
  try {
    const webllm = testLib || await import('./vendor/web-llm-0.2.85.js');
    ai.engine = await webllm.CreateMLCEngine(id, { initProgressCallback: p => {
      $('aibarw').hidden = false; $('aibar').style.width = Math.round((p.progress || 0) * 100) + '%'; $('aiprog').textContent = p.text || '';
    } });
    ai.kind = 'webllm'; ai.label = label; store.set('aiModel', key);
    $('aiprog').textContent = 'The AI is ready and saved on this device — it works offline from now on.';
  } catch (e) {
    ai.error = 'The AI could not start: ' + (e.message || e) + (auto ? '' : ' — try the Small model, close other tabs, or use a laptop.');
    if (auto) store.set('aiModel', null);
  } finally { ai.loading = false; renderSetup(); renderStatus(); }
}

// ------------------------------------------------------------------ setup tab
function mb(bytes) { return bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + ' GB' : Math.round(bytes / 1e6) + ' MB'; }
async function renderSetup() {
  $('savecard').hidden = mode === 'drive'; $('ondrive').hidden = mode !== 'drive'; $('aboutwelcome').hidden = mode === 'drive';
  renderOffLinks(); renderShareHelp();
  { const P = guidePaths(); if (P.ammocan) $('vaultguide').href = P.ammocan;   // the ARK Vault card: the guide and 3D model, here or on the drive
    $('vaultmodel').href = mode === 'drive' ? '/lib/AMMO-CAN-MODEL.html' : 'pages/AMMO-CAN-MODEL.html'; }
  if (mode === 'drive') {
    $('webai').hidden = true; $('driveai').hidden = false; $('getkit').hidden = true; loadTiers(); renderHealth(); loadWide(); loadSat();
  } else {
    const chosen = store.get('aiModel') && MODELS[store.get('aiModel')];
    $('aiinfo').textContent = ai.error || (ai.kind === 'webllm' ? `On: ${ai.label}. Saved on this device.` : ai.loading ? 'Loading…' :
      chosen ? `On: ${chosen[2]}. Saved on this device; it starts when you ask a question, which saves memory while you read.` :
      'The AI runs entirely inside your browser and is saved on this device after one download. It needs a recent browser with WebGPU.');
  }
  const aiOn = ai.kind === 'webllm' || (mode !== 'drive' && !!store.get('aiModel'));
  $('aion').hidden = aiOn || mode === 'drive'; $('aion').disabled = ai.loading; $('aioff').hidden = !aiOn;
  $('aichoices').hidden = mode === 'drive';
  if (manifest) {
    $('savelibsize').textContent = `≈ ${mb(manifest.offline.library.bytes)}`;
    $('saveroutessize').textContent = `≈ ${mb(manifest.offline.routes.bytes)}`;
    if (manifest.offline.map) $('savemapsize').textContent = `≈ ${mb(manifest.offline.map.bytes)}`;
  }
  $('savemaprow').hidden = !(manifest && manifest.offline.map) || mode === 'drive';
  if (mode === 'drive') { $('savelib').disabled = $('saveroutes').disabled = $('savemap').disabled = true; $('saveprog').textContent = 'Not needed on the drive — everything is already here.'; }
  if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); $('storage').textContent = `This site is using ${mb(e.usage || 0)} of storage on this device.`; }
  renderSaved();
  $('about').innerHTML = `Free survival and self-reliance knowledge for the Illinois Valley and southern Oregon. Search runs on your device; the AI runs in your browser.
    Documents that are public domain or openly licensed are searchable in full; others are listed by title and open on the publisher's website.
    Map and route data © OpenStreetMap contributors (ODbL); pill data: US National Library of Medicine Pillbox (ODbL); AI: Meta Llama 3.2 via WebLLM (Apache-2.0).
    ${manifest ? 'Library version ' + esc(manifest.built) + '.' : ''}`;
}

// ------------------------------------------------------------------ drive: which AI this device runs
async function loadTiers() {
  try { renderTiers(await (await fetch('api/settings')).json()); } catch {}
}
function renderTiers(st) {
  const d = st.device || {}, speed = st.wordsPerSecond || {};
  $('devinfo').textContent = `This device: ${d.name || 'computer'}` + (d.ramGB ? ` · ${Math.round(d.ramGB)} GB memory` : '') + (d.cores ? ` · ${d.cores} cores` : '') + '.';
  const rec = (st.tiers || []).find(t => t.key === st.recommended);
  const opt = (value, title, body, ok = true) =>
    `<label class="radio${ok ? '' : ' off'}"><input type="radio" name="tier" value="${value}"${st.mode === value ? ' checked' : ''}${ok ? '' : ' disabled'}>${title}<br><small>${body}</small></label>`;
  let h = opt('auto', `<b>Automatic</b> <span class="rec">— recommended</span>`,
    `Picks the best AI for this device${rec ? ` (now: <b>${esc(rec.name)}</b>)` : ''}, then steps down if it turns out too slow.`);
  for (const t of st.tiers || []) {
    const sp = speed[t.key] ? ` Measured here: about ${speed[t.key]} words a second.` : '';
    const missing = t.have ? '' : ' <b>Not on this drive.</b>';
    h += opt(t.key, `<b>${esc(t.name)}</b> — ${esc(t.model)}${t.key === st.recommended ? ' <span class="rec">✓ fits this device</span>' : ''}`, esc(t.hint) + sp + missing, t.have);
  }
  $('tierlist').innerHTML = h;
  $('tierlist').querySelectorAll('input[name=tier]').forEach(r => { r.onchange = () => chooseTier(r.value); if (!st.local) r.disabled = true; });
  $('remotenote').hidden = st.local !== false;
  renderShare(st.share || {});
  const cur = (st.tiers || []).find(t => t.key === st.tier);
  const words = { starting: 'loading… (this can take a minute or two)', ready: 'ready', off: 'off — search only', failed: 'could not start' }[st.state] || st.state;
  $('tierstate').innerHTML = `Running now: <b>${esc(cur ? cur.name : st.tier)}</b> — ${esc(words)}`;
  $('tiernote').hidden = !st.note; $('tiernote').textContent = st.note || '';
  if (st.state === 'starting') setTimeout(loadTiers, 3000);
}
function renderShare(sh) {
  $('sharecard').hidden = !sh.local; renderShareHelp();
  if (!sh.local) return;
  $('shareon').hidden = !!sh.on; $('shareoff').hidden = !sh.on;
  $('sharelinks').innerHTML = sh.on
    ? (sh.links && sh.links.length
        ? '<p class="meta">On the other phone or tablet, connect to the same Wi-Fi, open the web browser and type:</p>' +
          sh.links.map(l => `<p style="font-size:21px;margin:4px 0"><b>${esc(l.replace(/\/$/, ''))}</b></p>`).join('') +
          '<p class="meta">Then tap <b>Share → Add to Home Screen</b> (iPhone) or <b>⋮ → Add to Home screen</b> (Android) so it has an icon.</p>'
        : '<p class="meta">Sharing is on, but this device isn\'t connected to a Wi-Fi network yet. Connect it (or turn on its hotspot), then open this screen again.</p>')
    : (sh.error ? `<p class="meta">${esc(sh.error)}</p>` : '');
}
async function setShare(on) {
  try {
    const r = await fetch('api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) });
    renderShare(await r.json());
  } catch {}
}

async function chooseTier(m) {
  $('tierstate').innerHTML = '<span class="spin"></span>Switching the AI…';
  try {
    const r = await fetch('api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: m }) });
    renderTiers(await r.json()); refreshServer();
  } catch { $('tierstate').textContent = 'Could not change the AI. Is the Library Assistant still running?'; }
}

async function saveOffline(which) {
  if (!manifest || !('serviceWorker' in navigator)) { $('saveprog').textContent = 'This browser can’t save websites for offline use.'; return; }
  await navigator.serviceWorker.ready;
  try { await navigator.storage?.persist?.(); } catch {}
  const files = manifest.offline[which].files; let done = 0, failed = 0;
  SAVED[which] = 'busy'; { const p = $('st-' + which); if (p) { p.className = 'pill busy'; p.textContent = 'Downloading'; } }
  $('savebarw').hidden = false; $('savelib').disabled = $('saveroutes').disabled = $('savemap').disabled = true;
  const queue = files.slice(), workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const f = queue.shift();
      try { const r = await fetch(f); if (!r.ok) failed++; await r.arrayBuffer(); } catch { failed++; }
      done++; $('savebar').style.width = Math.round(done / files.length * 100) + '%'; $('saveprog').textContent = `Saving… ${done} of ${files.length} files`;
    }
  });
  await Promise.all(workers);
  $('saveprog').textContent = failed ? `Saved, but ${failed} files failed — try again with a better connection.` : `Saved ${files.length} files. They now work offline on this device.`;
  $('savelib').disabled = $('saveroutes').disabled = $('savemap').disabled = false; store.set('saved-' + which, manifest.built); renderSetup();
}

// ------------------------------------------------------------------ library & tools tabs
let LIB = null;
async function loadLibrary() {
  if (mode === 'drive') { try { LIB = (await (await fetch('api/docs')).json()).map(d => ({ t: d.title, f: d.folder, d: d.desc, u: '/lib/' + d.path.split('/').map(encodeURIComponent).join('/'), o: 1 })); } catch { LIB = []; } }
  else { await waitFor(() => workerSearchable || workerInfo.error); LIB = await new Promise(res => { docsWaiter = res; worker.postMessage({ type: 'docs' }); }); }
  $('libnote').innerHTML = mode === 'drive' ? 'Every book, manual, map and program on this drive, on the same shelves as the guides. Tap a title to open it; Back brings you here.'
    : 'Documents marked <span class="tag">full text</span> are searchable inside; the rest are searchable by title and open on the original publisher’s website (they can’t be republished here). The drive edition has every file.';
  renderLibrary();
}
// The books and the guides share one set of "shelves", in the order you'd reach for them.
// The same groups, in the same order, are in docs/START-HERE.md ("Guides by subject"), which the guide
// pages use for their "Guides › group" bar and Previous / Next links; tools/guide_nav.py --check keeps them in step.
const SHELVES = [
  ['start', '🧭', 'Start here', 'Emergency finder, A–Z index, Illinois Valley quick reference'],
  ['health', '🩹', 'Health & medicine', 'Injuries, recovering from injuries, medicines, making medicines, childbirth and children, chronic illness, sanitation, garbage and disease'],
  ['water', '💧', 'Water', 'Purifying water, wells, pumps, springs and cisterns, town water and sewer, dams, ponds and ditches'],
  ['food', '🍞', 'Food', 'Food when it is scarce, cooking from scratch, preserving, milk, butter and cheese, root cellars, seeds, building soil'],
  ['wild', '🌲', 'Living off the land', 'Hunting, trapping and fishing, wild plants and mushrooms, skills of the valley’s first peoples'],
  ['animals', '🐐', 'Animals', 'Chickens, rabbits, goats, bees, horses and draft animals'],
  ['shelter', '🏠', 'Shelter & building', 'Repairs and building, natural building, mortar, concrete and roads'],
  ['power', '💡', 'Heat, light & power', 'Firewood, fuel, off-grid power, the power grid, vehicles and tractors, storing energy, candles and lamps, engines and generators'],
  ['making', '🛠️', 'Making & repair', 'Practical math, household make-do, blacksmithing, woodworking, knots and rope, salvage, clothing and leather, paper and ink, electronics'],
  ['travel', '🥾', 'Getting around', 'Travel on foot, bicycles and carts, maps, navigation and weather'],
  ['comms', '📡', 'Radio, community & protection', 'Radio, signals and Morse, organizing neighbors and barter, protecting your home'],
  ['disaster', '🚨', 'Disasters', 'What to expect, wildfire, earthquakes, floods, ice storms and heat waves, nuclear fallout, EMP and solar storms'],
  ['fun', '📖', 'Stories & fun', 'Classic books for every age, picture books and rhymes, games, songs and things to make'],
  ['library', '💾', 'Using this library', 'Starting it on any device, the ARK Vault (ammo-can computer), getting the whole library, Wikipedia, apps and the offline AI'],
  ['other', '📁', 'Programs & other files', 'Everything else on the drive']];
const FOLDER_SHELF = { Guides: 'start', 'Southern-Oregon': 'start', 'Local-Contacts': 'start',
  Medical: 'health', 'Sanitation-Hygiene': 'health', 'Children-Learning': 'health',
  Water: 'water', 'Water-Purification': 'water', 'Water-Wells-Pumps': 'water',
  'Food-Security': 'food', 'Food-From-Scratch': 'food', 'Food-Storage': 'food', 'Gardening-Food': 'food',
  'Wild-Plants': 'wild', Mushrooms: 'wild', Hunting: 'wild', Trapping: 'wild', Fishing: 'wild', 'Native-Skills': 'wild',
  Animals: 'animals', 'Small-Livestock': 'animals', 'Horses-Draft-Animals': 'animals',
  'Shelter-Building': 'shelter', 'Natural-Building': 'shelter',
  Firewood: 'power', 'Off-Grid-Power': 'power', Fuel: 'power', 'Engines-Motors': 'power',
  'Homestead-Skills': 'making', 'Math-Measuring': 'making', 'Blacksmithing-Tools': 'making', 'Clothing-Leather': 'making', 'Electronics-Repair': 'making',
  'Travel-On-Foot': 'travel', 'Bicycles-Carts': 'travel', 'Navigation-Weather': 'travel', Maps: 'travel', OsmAnd: 'travel', 'Walking-Routes': 'travel',
  'Comms-Signals': 'comms', 'Home-Security': 'comms', 'Radio-Weather': 'comms', 'Community-Barter': 'comms', 'Radio-Communications': 'comms',
  Wildfire: 'disaster', 'Disaster-Scenarios': 'disaster', 'Earthquake-Tsunami': 'disaster', 'Nuclear-Radiation': 'disaster', 'EMP-Solar-Storms': 'disaster',
  Stories: 'fun',
  Manuals: 'library', 'AI-Offline': 'library', 'Kiwix-Reader': 'library', 'Phone-Apps': 'library', Wikipedia: 'library' };
const OUR_GUIDES = 'Our guides';
let guideShelf = null;              // guide page file name -> shelf key
function shelfOf(folder, url) {     // -> [shelf key, sub-group label]
  if (!guideShelf) { const P = guidePaths(); guideShelf = {}; for (const [k, list] of Object.entries(GUIDE_CARDS)) for (const [g] of list) if (P[g]) guideShelf[P[g]] = k; }
  let u = url || ''; try { u = decodeURIComponent(u); } catch {}
  if (guideShelf[u]) return [guideShelf[u], OUR_GUIDES];
  const seg = folder.split('\\').filter(Boolean);
  if (!seg.length || (seg.length === 1 && /^(\(top folder\)|AI-Offline|Kiwix-Reader|Phone-Apps|Manuals)$/.test(seg[0]))) return ['library', 'How to use this drive'];
  if (seg[0] === 'Southern-Oregon' && seg.length === 1) return ['start', 'Local reference'];
  if (seg[0] === 'Southern-Oregon') seg.shift();
  if (seg[0] === 'Stories' && seg[1]) return ['fun', STORY_GROUPS[seg[1]] || seg[1].replace(/-/g, ' ')];   // by age, youngest first
  if (seg[0] === 'Guides') return ['start', OUR_GUIDES];
  if ((seg[0] === 'Medical' || seg[0] === 'Manuals') && seg[1]) {
    const k = FOLDER_SHELF[seg[1]] || FOLDER_SHELF[seg[0]];
    return [k, seg[1].replace(/-/g, ' ').replace(/^ArmyFieldManuals$/, 'Army field manuals').replace(/^Manuals PDF$/, 'Medical manuals')];
  }
  return [FOLDER_SHELF[seg[0]] || 'other', seg[0] === 'Manuals' ? 'Manuals' : seg[0].replace(/-/g, ' ')];
}
const openState = (() => { try { return JSON.parse(localStorage.getItem('so-open') || '{}'); } catch { return {}; } })();
function rememberOpen(e) {
  const d = e.target; if (!(d instanceof HTMLDetailsElement) || !d.dataset.k || d.dataset.filtering) return;
  openState[d.dataset.k] = d.open; try { localStorage.setItem('so-open', JSON.stringify(openState)); } catch {}
}
function setAllOpen(box, open) { box.querySelectorAll('details[data-k]').forEach(d => { d.open = open; openState[d.dataset.k] = open; }); try { localStorage.setItem('so-open', JSON.stringify(openState)); } catch {} }
const isOpen = (k, dflt) => (k in openState ? openState[k] : dflt);

const STORY_GROUPS = { 'Picture-Books-and-Rhymes': '1. Picture books & rhymes (ages 2–6)', 'Read-Aloud-and-Early-Readers': '2. Read-aloud & early readers (ages 5–9)',
  'Ages-9-to-13': '3. Chapter books (ages 9–13)', 'Teens-and-Adults': '4. Teens & adults', 'Games-and-Things-to-Make': '5. Games, songs & things to make' };
const rank = g => (g === OUR_GUIDES ? 0 : g === 'How to use this drive' ? 1 : 2);
function renderLibrary() {
  if (!LIB) return;
  const f = $('libq').value.trim().toLowerCase();
  const words = f.split(/\s+/).filter(Boolean);
  const items = LIB.filter(d => !d.t.startsWith('Walk to ') && (!words.length || words.every(w => (d.t + ' ' + d.d + ' ' + d.f).toLowerCase().includes(w))));
  const shelves = new Map(SHELVES.map(s => [s[0], new Map()]));
  for (const d of items) {
    const [k, g] = shelfOf(d.f || '', d.u);
    const sub = shelves.get(k) || shelves.get('other');
    if (!sub.has(g)) sub.set(g, []); sub.get(g).push(d);
  }
  const doc = d => `<div class="doc"><a href="${esc(d.u)}">${esc(noPic(d.t))}</a>${mode === 'public' && d.o ? '<span class="tag">full text</span>' : ''}<div class="d">${esc(d.d)}</div></div>`;
  const filtering = words.length > 0;
  const html = SHELVES.map(([k, icon, name, blurb]) => {
    const subs = [...shelves.get(k)].sort((a, b) => (rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])));
    if (!subs.length) return '';
    const n = subs.reduce((t, [, ds]) => t + ds.length, 0);
    const inner = subs.length === 1 && !filtering ? subs[0][1].map(doc).join('')
      : subs.map(([g, ds]) => `<details class="sub" data-k="lib:${esc(k)}:${esc(g)}"${filtering || isOpen('lib:' + k + ':' + g, false) ? ' open' : ''}><summary>${esc(g)} <span class="n">${ds.length}</span></summary>${ds.map(doc).join('')}</details>`).join('');
    return `<details class="shelf" data-k="lib:${k}"${filtering || isOpen('lib:' + k, false) ? ' open' : ''}><summary><span class="ic0">${ic(SHELF_ICON[k] || 'page', 20)}</span><span class="nm">${esc(name)} <span class="n">${n}</span><small>${esc(blurb)}</small></span></summary><div class="shelfbody">${inner}</div></details>`;
  }).join('');
  $('libout').innerHTML = html ? `<div class="openall"><button class="link" data-all="1">Open all</button> · <button class="link" data-all="0">Close all</button>${filtering ? ` <span class="meta">${items.length} match${items.length === 1 ? '' : 'es'}</span>` : ''}</div>` + html
    : '<p class="meta">Nothing matches. Try fewer or shorter words.</p>';
  if (filtering) $('libout').querySelectorAll('details').forEach(d => d.dataset.filtering = '1');
  restoreScroll('library');
}
// the Tools screen: calculators and other things you use rather than read
const TOOL_CARDS = [['map', '🗺️ Map', 'A topo map with property lines and layers to switch on: springs and wells, good growing ground, wild food, mines, past fires, flood zones, useful places. Measure, drop pins, print, and see where you are. No signal needed.'],
  ['calc', '🧮 Calculator', 'Everyday sums on a big screen: + − × ÷, percent, and a history of your answers.'],
  ['sci', '🔬 Scientific calculator', 'Sine, cosine and tangent, logs, powers and roots, π, n!, degrees or radians.'],
  ['conv', '🔢 Unit converter & calculators', 'Any measurement converted; area, concrete, roof pitch, tanks, rainwater, water pressure, volts and watts, batteries, wire size, recipes, fuel mix, doses.'],
  ['morse', '📡 Morse code', 'Words into Morse and back, played as beeps or as flashes of the screen at any speed, a key to practise sending, and the whole code.'],
  ['pill', '🔍 Pill identifier', 'Identify a loose pill by the code printed on it — about 32,000 US pills.'],
  ['plantid', '📷 Identify a plant or mushroom', 'Take a photo: the offline AI names it from the plants and mushrooms of the area, marks the poisonous ones, and opens the guides about it.'],
  ['cad', '📐 CAD', 'Draw to scale: a plan, a part, a pattern to cut out. Type in sizes, add dimensions, print at true size, or save a DXF for a laser or CNC machine.'],
  ['walk', '🥾 Routes: walk, bike, drive', 'From Cave Junction to 359 Oregon and N. California cities: walking days, bicycle riding hours and normal driving times, with turn-by-turn directions and GPS tracks.']];
// the map is there when its files are: on the drive the Library Assistant says so, on the website the list of files does
const hasMap = () => mode === 'drive' ? !!server.map : !!(manifest && manifest.offline && manifest.offline.map);
function renderKit() {
  const P = guidePaths();
  $('kitgrid').innerHTML = (mode === 'drive' ? PHOTO_CARD : '') +   // family photos: only where the library program runs
    TOOL_CARDS.filter(([k]) => P[k] && (k !== 'map' || hasMap())).map(([k, t, d]) => `<a class="tool withic" href="${P[k]}">${ic(TOOL_ICON[k] || 'wrench')}<span><b>${noPic(t)}</b><span>${d}</span></span></a>`).join('');
}
const GUIDE_CARDS = { // guide cards, by shelf (same groups and order as SHELVES and docs/START-HERE.md)
  start: [['sos', '🆘 Emergency finder', 'Something happening right now? Bleeding, not breathing, snakebite, a baby coming, fire, fallout — straight to the right page.'],
    ['az', '📇 Subject index A–Z', 'Look anything up like the index at the back of a book — no search or AI needed.'],
    ['iv', '🏔️ Illinois Valley quick reference', 'Alerts, weather radio, ham repeaters, local contacts, evacuation levels, frost dates, hunting units, key distances.']],
  health: [['fieldcare', '🩹 Injuries, no help coming', 'Bleeding, wounds, burns, fractures, snakebite, nursing someone for weeks'],
    ['rehab', '🦵 Recovering from injuries', 'Rehab without a clinic: when to move, exercises for every joint, sprains, backs and shoulders, getting up after bed rest, crutches and walkers you can make.'],
    ['med', '💊 Medical & found medicines', 'What medical books there are and how to use found or expired medicines safely.'],
    ['birth', '👶 Childbirth & small kids', 'Birth with no hospital, newborn care, child illness, teaching kids at home'],
    ['chronic', '🩺 Chronic illness with no pharmacy', 'Diabetes, blood pressure, heart, asthma, seizures, thyroid and mental illness when the pills run out: emergencies, doses from the books, and medicines never to stop suddenly.'],
    ['meds', '🌿 Making medicines with no pharmacy', 'What works and what does not: the rehydration drink, honey and Dakin\u2019s solution for wounds, willow bark, the plants with real evidence, and what is dangerous to try.'],
    ['medhist', '🧫 How antibiotics came to be', 'What life was like before them, how penicillin, the sulfa drugs, streptomycin and insulin were found and made, what restarting would take, and why they stop working.'],
    ['sanit', '🧼 Sanitation, waste & disease', 'Toilets with no sewer, handwashing, laundry, garbage and compost, stopping outbreaks, safe burial']],
  water: [['purify', '🚰 Water purification', 'Settling, cloth, alum and ash, biosand and clay-pot filters, charcoal done right, boiling, bleach and pool shock, sunlight, solar stills, tests.'],
    ['wells', '💧 Wells, pumps, springs & cisterns', 'Your well records, running the well pump on a generator or solar, hand and rope pumps, ram pumps, spring boxes, cisterns, testing.'],
    ['townwater', '🚿 How town water & sewer work', 'From river intake to tap and drain to river, how long the water lasts with no power, keeping a small system going by hand, and never going into a manhole.'],
    ['dams', '🏞️ Dams, weirs, ditches & ponds', 'How dams work and fail, farm ponds, measuring a creek with a weir, diversions and ditches, water power, salmon passage, and the low-dam drowning machine.']],
  food: [['scarce', '🥫 Food when it is scarce', 'A year of food, fair rationing, deficiency diseases, babies, foraging calendar'],
    ['food', '🌾 Food from scratch', 'Acorn and grain flour, masa, sourdough, salt, maple syrup, lard — then bread, tortillas, pasta, hardtack and beans.'],
    ['preserve', '🫙 Preserving food', 'Safe canning at our elevation, drying, smoking, curing, fermenting, eggs'],
    ['cellar', '🥔 Root cellars & food storage', 'Cellars, pits and buried barrels for our warm ground, what each crop needs, cooling without power, sun drying, curing meat, kraut and eggs.'],
    ['dairy', '🧀 Milk, butter & cheese', 'Clean milk, cooling with no fridge, butter and ghee, yogurt and kefir, soft and hard cheeses, homemade rennet.'],
    ['seeds', '🌱 Your seed bank', 'Planting calendar for all 39 kit varieties, storing and testing seed, which varieties cross, saving seed from fruits, grafting fruit trees.'],
    ['soil', '🪱 Building soil: permaculture, hugelkultur & more', 'What the research backs: compost, mulch and no-dig beds, cover crops, biochar, hugelkultur, swales and keeping water in the soil, food forests and the three sisters.']],
  wild: [['huntfish', '🦌 Hunting, trapping & fishing', 'Local game, field dressing in hot weather, snares, nets, game diseases'],
    ['mush', '🍄 Mushrooms', 'Local deadly mushrooms and their look-alikes, spore prints, what to do after a bad meal, good edibles, drying, and growing shiitake and oysters.'],
    ['native', '🌰 Skills of the valley’s first peoples', 'How the Takelma and their neighbors lived here year-round: acorns, camas, salmon, cordage and baskets, houses, and tending the land with fire.']],
  animals: [['chickens', '🐔 Chickens', 'Eggs and meat year after year: breeds, coops, feeding with no feed store, broody hens and chicks, health with no vet, butchering.'],
    ['ducks', '🦆 Ducks', 'Eggs, meat and slug control: hardy breeds, simple houses, water without mud, foraging, hatching ducklings, health, butchering.'],
    ['geese', '🪿 Geese', 'Grazing, guarding, meat and down: geese on grass, nests and goslings, the noisy watch at night, fattening and plucking.'],
    ['turkeys', '🦃 Turkeys', 'Meat for a household: heritage breeds that breed on their own, roosts, range, poults, blackhead and predators, harvest.'],
    ['rabbits', '🐇 Rabbits', 'Meat and fur on little feed: hutches and colonies, forage, breeding and kits, health with no vet, butchering and pelts.'],
    ['goats', '🐐 Goats', 'Milk, meat and brush control: fencing, browse and poisonous plants, kidding, milking, hooves and worms, health with no vet.'],
    ['sheep', '🐑 Sheep', 'Meat, wool and milk: hardy breeds, fences against coyotes, grazing, lambing, shearing and handling wool, worms and feet, butchering.'],
    ['pigs', '🐖 Pigs', 'Meat, lard and leftovers: pens and pasture, feeding on scraps and acorns, farrowing, health, butchering, scalding and rendering lard.'],
    ['cattle', '🐄 Cattle', 'A family milk cow, beef and oxen: choosing, pasture and hay, calving, milking, training a team of oxen, health, butchering.'],
    ['horse', '🐴 Horses, mules & draft animals', 'Choosing, feeding and watering, teeth and worms, hoof care and shoeing, saddling and riding, packing, and harness work.'],
    ['bees', '🐝 Bees', 'Honey, wax and pollination: hives you can build, swarms, the bee year here, varroa, harvesting honey and wax, bears and stings.'],
    ['dogs', '🐕 Dogs', 'Guarding stock, herding and hunting: choosing and raising pups, guardian dogs, training, feeding with no store, health, parvo and rabies.']],
  shelter: [['shelter', '🏠 Shelter & building', 'Roof leaks, one warm room, rot, log and earth building, quake and fire hardening'],
    ['natural', '🧱 Natural building', 'Cob, straw bale, light clay, hempcrete, earth and lime plasters, making lime, thatch'],
    ['masonry', '🏗️ Mortar, concrete & roads', 'Making lime, mortar and concrete by hand, curing, concrete without store cement, why asphalt cannot be made at home, and keeping gravel roads and driveways good.']],
  power: [['firewood', '🪵 Firewood', 'Heat value of local trees, how much you need, felling and bucking safely, splitting, drying in a wet climate, chimneys, ashes, coppicing.'],
    ['fuel', '⛽ Fuel: storing, reviving, finding', 'How long gas and diesel keep, testing and rescuing old fuel, diesel care, and pumping fuel from station tanks, drums and vehicles with no power.'],
    ['offgrid', '☀️ Off-grid power', 'Solar sizing for our sun, salvaged panels and batteries, wiring safely, creek hydro'],
    ['grid', '🗼 How the power grid works', 'From power plant to plug, why one fault blacks out a region and restarting takes months, downed-line dangers, and running a small neighborhood grid.'],
    ['storage', '🔋 Storing energy without batteries', 'Why gravity batteries hold so little, and what works: water tanks, hot water, masonry heaters, ice and cold water, timing the work.'],
    ['heatpower', '♨️ Heat into work & power', 'Stove-top generators for phones and lights, small steam engines and boiler safety, hot-air engines, fridges that run on a flame, and the honest numbers.'],
    ['light', '🕯️ Candles, lamps & lamp oil', 'Dipped and moulded candles, wicks, rushlights, which oils burn, homemade lamps, more light from a small flame, and fire safety.'],
    ['eng', '🔧 Engines, motors & generators', 'Why a small engine will not start, carburetors, chainsaw filing, generator care, testing and rewinding motors, turning motors into generators, and reusing a generator for water or wind when the fuel is gone.'],
    ['vehicles', '🚜 Vehicles, tractors & heavy equipment', 'Keeping cars, pickups and tractors going with no shop: batteries, brakes, cooling and tires; tractor rollovers and the PTO; hydraulics and injected oil; air brakes; electric cars.']],
  making: [['math', '📐 Practical math & measuring', 'Measuring with no tools, square corners, area and volume, slopes and roof pitch, heights and distances, levers, electricity and water math.'],
    ['md', '🧰 Make-Do household guide', 'Cleaners, laundry soap, tooth powder, fire starters, oil lamps, glue, mending, plumbing, electronics repair and salvage.'],
    ['smith', '⚒️ Blacksmithing & hand tools', 'A simple forge, which scrap steel to use, heat colors, hardening and tempering, making chisels, tongs and knives, axe handles and sharpening.'],
    ['wood', '🪚 Woodworking with hand tools', 'Sharpening, choosing and drying wood, splitting green wood, joints with no glue or nails, handles, a bench, stools, a ladder, and mending furniture.'],
    ['knots', '🪢 Knots, rope & cordage', 'The dozen knots that do nearly every job, what rope can hold, lashing, blocks and tackle, and making cord.'],
    ['salvage', '♻️ Salvage: useful things from broken things', 'What to take from dead washers, freezers, cars and more, what to make with it, and what never to cut, burn or open.'],
    ['clothing', '🧵 Clothing, leather & shoes', 'Dressing for wet winters, mending, wool to yarn, tanning, clothes from furs and buckskin, shoe repair'],
    ['paper', '📜 Paper, ink & toilet paper', 'Making paper by hand, iron-gall and soot inks, pens, pencils and slates, and toilet paper alternatives with safe washing.']],
  travel: [['onfoot', '🎒 On foot: backpacking & travel', 'Planning a trip, how much to carry, packs, feet and blisters, water and food on the move, safe camps, river crossings, snow, and staying safe on the road.'],
    ['bikes', '🚲 Bicycles & carts', 'Hauling without fuel: loads, trailers, handcarts, bike repair with few tools'],
    ['nav', '🧭 Navigation & weather', 'Map and compass, finding north without one, reading the sky, lightning']],
  comms: [['radio', '📻 Emergency radio guide', 'How ham, CB, GMRS and shortwave work, and emergency communication.'],
    ['mesh', '📶 Mesh radio (Meshtastic)', 'Texting with no phone service: small radios that pass messages along. What to buy, setting up, private channels, range, a neighborhood mesh.'],
    ['signals', '📡 Signals & Morse code', 'Morse by ear, signal mirrors, ground-to-air codes, runners and message forms'],
    ['community', '🤝 Community & barter', 'Organizing neighbors, fair trade, keeping watch, settling disputes'],
    ['defense', '🛡️ Home & property protection', 'Defensive only: not being a target, doors and locks, barriers and fences, early warning, a safe room, watch rosters, the law on self-defense.']],
  disaster: [['expect', '⏳ What to expect: scenarios & timelines', 'Wildfire, the big quake, storms, heat, long blackouts, pandemic, shortages, EMP, fallout — what happens hour by hour, week by week, and what to do.'],
    ['wildfire', '🔥 Wildfire with no fire department', 'Reading fire danger, hardening the house, clearing with hand tools, water with no power, stay or go, the fire front, and the days after.'],
    ['floods', '🌊 Floods, ice storms & heat waves', 'The first hour of a flood, reading rising water, cleaning up, ice storms and frozen pipes, carbon monoxide, keeping cool with no power.'],
    ['nuke', '☢️ Nuclear fallout', 'Where to shelter, how long (the 7-10 rule), shielding, potassium iodide doses, decontamination, food, water and livestock.'],
    ['emp', '⚡ EMP, solar storms & Faraday cages', 'What tests really showed, unplugging, building and testing a Faraday container, solar-storm warnings, checking and repairing gear after.']],
  fun: [['stories', '📖 Stories, games & fun', 'Classic books for every age to read aloud or alone, games with no power, string figures, songs and things to make — for long evenings and kids.']],
  library: [['device', '📱 Start on any device', 'Run the library on a computer, an old phone or tablet, or share it to iPhones over Wi-Fi.'],
    ['ammocan', '🧰 ARK Vault (ammo-can computer)', 'The library, the AI, a battery, a printer and a radio in a sealed steel ammo can, safe from EMP. Open the lid and flip its power switch on, and every phone nearby gets the library and the AI over its own Wi-Fi.'],
    ['get', '💾 Get the whole library', 'Put every book, all of Wikipedia, offline maps and an AI that needs no internet on a USB drive. Point-and-click installer for Windows, Mac and Linux.'],
    ['all', '📚 Everything on the drive', 'The full index of every file, archive and program.']],
};
// Every page the cards link to: key -> the guide's file name. On the website it is pages/NAME.html; on the
// drive Southern-Oregon/NAME.html, unless DRIVE_AT / WEB_AT say otherwise (null = not in that edition).
const PAGES = { sos: 'EMERGENCY-FINDER', az: 'SUBJECT-INDEX', iv: 'ILLINOIS-VALLEY-START-HERE',
  fieldcare: 'FIELD-CARE-GUIDE', rehab: 'REHAB-GUIDE', med: 'Medical-READ-ME-FIRST', birth: 'CHILDBIRTH-CHILDREN-GUIDE', chronic: 'CHRONIC-ILLNESS-GUIDE', meds: 'MAKING-MEDICINES-GUIDE', medhist: 'MEDICINE-HISTORY-GUIDE', sanit: 'SANITATION-GUIDE',
  purify: 'WATER-PURIFICATION-GUIDE', wells: 'WATER-WELLS-GUIDE', townwater: 'TOWN-WATER-SEWER-GUIDE', dams: 'DAMS-DITCHES-GUIDE',
  scarce: 'FOOD-SECURITY-GUIDE', food: 'FOOD-FROM-SCRATCH-GUIDE', preserve: 'PRESERVING-FOOD-GUIDE', cellar: 'ROOT-CELLAR-GUIDE', seeds: 'SEED-BANK-GUIDE', soil: 'GROWING-SOIL-GUIDE',
  huntfish: 'HUNTING-TRAPPING-FISHING-GUIDE', mush: 'MUSHROOM-GUIDE', native: 'NATIVE-SKILLS-GUIDE',
  rabbits: 'RABBITS-GUIDE', chickens: 'CHICKENS-GUIDE', goats: 'GOATS-GUIDE', bees: 'BEES-GUIDE', horse: 'HORSE-GUIDE', dairy: 'DAIRY-GUIDE',
  ducks: 'DUCKS-GUIDE', geese: 'GEESE-GUIDE', turkeys: 'TURKEYS-GUIDE', sheep: 'SHEEP-GUIDE', pigs: 'PIGS-GUIDE', cattle: 'CATTLE-GUIDE', dogs: 'DOGS-GUIDE',
  shelter: 'SHELTER-BUILDING-GUIDE', natural: 'NATURAL-BUILDING-GUIDE', masonry: 'MASONRY-ROADS-GUIDE',
  firewood: 'FIREWOOD-GUIDE', fuel: 'FUEL-GUIDE', offgrid: 'OFF-GRID-POWER-GUIDE', grid: 'POWER-GRID-GUIDE', storage: 'STORING-ENERGY-GUIDE', heatpower: 'HEAT-INTO-POWER-GUIDE', light: 'LIGHTING-GUIDE', eng: 'ENGINES-AND-MOTORS-GUIDE', vehicles: 'VEHICLES-EQUIPMENT-GUIDE',
  math: 'PRACTICAL-MATH-GUIDE', md: 'MAKE-DO-HOUSEHOLD-GUIDE', smith: 'BLACKSMITHING-GUIDE', wood: 'WOODWORKING-GUIDE', knots: 'KNOTS-ROPE-GUIDE', salvage: 'SALVAGE-GUIDE', clothing: 'CLOTHING-LEATHER-GUIDE', paper: 'PAPER-INK-GUIDE',
  onfoot: 'ON-FOOT-GUIDE', bikes: 'BICYCLES-CARTS-GUIDE', nav: 'NAVIGATION-WEATHER-GUIDE',
  radio: 'RADIO-GUIDE', mesh: 'MESH-RADIO-GUIDE', signals: 'SIGNALS-MORSE-GUIDE', community: 'COMMUNITY-BARTER-GUIDE', defense: 'HOME-DEFENSE-GUIDE',
  expect: 'WHAT-TO-EXPECT-GUIDE', wildfire: 'WILDFIRE-GUIDE', floods: 'FLOODS-STORMS-HEAT-GUIDE', nuke: 'NUCLEAR-FALLOUT-GUIDE', emp: 'EMP-GUIDE',
  stories: 'STORIES-GAMES-GUIDE',
  device: 'START-ON-ANY-DEVICE', ammocan: 'AMMO-CAN-COMPUTER-GUIDE', get: 'GET-THE-LIBRARY', all: 'README',
  calc: 'CALCULATOR', sci: 'CALCULATOR', conv: 'UNIT-CONVERTER', morse: 'MORSE-CODE', pill: 'PILL-IDENTIFIER', walk: 'WALKING-ROUTES', plantid: 'PLANT-ID', map: 'MAP', cad: 'CAD' };
const DRIVE_AT = { sos: 'EMERGENCY-FINDER.html', az: 'SUBJECT-INDEX.html', med: 'Medical/READ-ME-FIRST.html', radio: 'Manuals/Radio-Communications/RADIO-GUIDE.html', mesh: 'Manuals/Radio-Communications/MESH-RADIO-GUIDE.html',
  device: 'START-ON-ANY-DEVICE.html', ammocan: 'AMMO-CAN-COMPUTER-GUIDE.html', get: null, all: 'README.html',
  calc: 'CALCULATOR.html#basic', sci: 'CALCULATOR.html#sci', conv: 'UNIT-CONVERTER.html', morse: 'MORSE-CODE.html', plantid: 'PLANT-ID.html', map: 'Map/MAP.html', cad: 'CAD.html',
  pill: 'Medical/Pill-Identifier/PILL-IDENTIFIER.html', walk: 'Southern-Oregon/Walking-Routes/WALKING-ROUTES.html' };
const WEB_AT = { all: null, calc: 'pages/CALCULATOR.html#basic', sci: 'pages/CALCULATOR.html#sci', map: 'tools/map/MAP.html',
  pill: 'tools/pill-identifier/PILL-IDENTIFIER.html', walk: 'tools/walking-routes/WALKING-ROUTES.html' };
let pathCache = null;
function guidePaths() {
  if (pathCache && pathCache.mode === mode) return pathCache.P;
  const P = {};
  for (const [k, name] of Object.entries(PAGES)) {
    const at = mode === 'drive' ? (k in DRIVE_AT ? DRIVE_AT[k] : 'Southern-Oregon/' + name + '.html') : (k in WEB_AT ? WEB_AT[k] : 'pages/' + name + '.html');
    if (at) P[k] = (mode === 'drive' ? '/lib/' : '') + at;
  }
  pathCache = { mode, P }; return P;
}
function renderTools() {
  const P = guidePaths(), T = GUIDE_CARDS;
  const card = k => ([g, t, d]) => `<a class="tool" href="${P[g]}" data-shelf="${k}"><b>${noPic(t)}</b><span>${d}</span></a>`;
  const groups = SHELVES.filter(([k]) => T[k] && T[k].some(([g]) => P[g]));
  $('guidequick').innerHTML = (P.sos ? `<a class="sec sos" href="${P.sos}">${ic('alert', 18)}Emergency finder</a>` : '') + (P.az ? `<a class="sec" href="${P.az}">Subject index A–Z</a>` : '');
  $('toolgrid').innerHTML = `<p class="meta">Plain-English guides in ${groups.length} groups. Tap a group to open it; each guide links to the next one in its group. <button class="link" data-all="1">Open all</button> · <button class="link" data-all="0">Close all</button></p>` +
    groups.map(([k, icon, name]) => {
      const list = T[k].filter(([g]) => P[g]);
      return `<details class="shelf" id="g-${k}" data-k="tools:${k}"${isOpen('tools:' + k, k === 'start') ? ' open' : ''}><summary><span class="ic0">${ic(SHELF_ICON[k] || 'page', 20)}</span><span class="nm">${esc(name)} <span class="n">${list.length}</span><small>${list.map(c => esc(c[1].replace(/^\S+\s/, ''))).join(' · ')}</small></span></summary><div class="grid shelfbody">${list.map(card(k)).join('')}</div></details>`;
    }).join('');
}

// ------------------------------------------------------------------ family photos & videos (drive only)
// Pictures and home videos from a USB drive plugged into the device that runs the library (photos.go).
// A card under Tools opens it. #photos is the list of drives (straight into the drive when there is
// only one) and #photos:<drive>:<folder> a folder, so the phone's Back button goes back up the folders.
// The grid shows a few hundred at a time; small previews load as they come into view and are let go
// far out of view, so a folder of thousands doesn't fill a phone's memory. A tap opens the viewer:
// swipe or arrow keys, pinch to zoom, swipe down or tap beside the picture to close, and a slideshow.
const PHOTO_CARD = `<a class="tool withic" href="#photos">${ic('photo')}<span><b>Family photos &amp; videos</b><span>Look through the pictures and home videos on a USB drive plugged into the library: folder by folder, full screen, or as a slideshow.</span></span></a>`;
const PH = { info: null, drives: null, drive: null, path: '', key: '', data: null, shown: 0, seq: 0, lists: new Map(), scroll: new Map() };
const PH_CHUNK = 240;
const phJoin = (a, b) => a ? a + '/' + b : b;
const phHash = (id, p) => '#photos:' + id + ':' + (p || '').split('/').map(encodeURIComponent).join('/');
const phURL = (what, f) => `api/photos/${what}?d=${encodeURIComponent(PH.drive.id)}&p=${encodeURIComponent(phJoin(PH.path, f.name))}&v=${f.mod}-${f.size}`;
const phHeic = n => /\.hei[cf]$/i.test(n);
const phCount = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const phLabel = f => `<span class="phlab"><span class="phic">${f.kind === 'video' ? '▶' : ic('photo', 30)}</span><span class="phnm">${esc(f.name)}</span></span>`;

async function showPhotos(raw) {
  const was = !$('photos').hidden;
  if (was && PH.key) PH.scroll.set(PH.key, scrollY);   // to come back to the same place in this folder
  setView('photos'); if (!was) scrollTo(0, 0);
  const seq = ++PH.seq;
  if (mode !== 'drive') {
    PH.drive = null; phCrumbs('');
    $('phbody').innerHTML = '<p class="note">Family photos work in the drive edition of the library: on the ARK Vault, or a computer that runs the library from its drive.</p>';
    return;
  }
  const m = /^photos:([^:]+):?(.*)$/.exec(raw);
  if (!m) return phDrivesView(seq);
  const path = m[2].split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } }).join('/');
  return phFolder(m[1], path, seq);
}

async function phLoadDrives() {
  const r = await fetch('api/photos/drives', { cache: 'no-store' });
  if (!r.ok) throw new Error('status ' + r.status);
  PH.info = await r.json(); PH.drives = PH.info.drives || [];
  return PH.drives;
}

async function phDrivesView(seq) {
  PH.drive = null; PH.key = ''; phCrumbs('');
  $('phbody').innerHTML = '<p class="meta"><span class="spin"></span>Looking for drives…</p>';
  try { await phLoadDrives(); } catch { if (seq === PH.seq) phTrouble(); return; }
  if (seq !== PH.seq) return;
  const ds = PH.drives;
  if (ds.length === 1) {   // one drive: straight in, in place of this step (so Back goes back to Tools)
    try { history.replaceState(history.state, '', phHash(ds[0].id, '')); } catch {}
    return phFolder(ds[0].id, '', seq);
  }
  if (!ds.length) return phNoDrive();
  phCrumbs('');
  $('phbody').innerHTML = '<p class="meta">Which drive are the photos on?</p><div class="phlist">' + ds.map(d =>
    `<a class="phfold" href="${phHash(d.id, '')}"><span class="phfi">${ic('usb', 24)}</span><span class="phdn">${esc(d.name)}${d.size ? `<small>${esc(d.size)}</small>` : ''}</span></a>`).join('') +
    '</div><p><button class="sec" type="button" data-ph="again">Look again</button> <span class="meta">after plugging in another drive</span></p>';
}

function phNoDrive() {
  const s = PH.info || {}, pi = s.pi, here = s.local;
  const where = pi ? 'one of the Pi’s USB ports' : here ? 'this computer' : 'the computer the library runs on';
  const reader = pi ? 'the Pi' : here ? 'this computer' : 'that computer';
  $('phbody').innerHTML = `<div class="card"><h3 style="margin-top:0">No photo drive found</h3>
    <p>Plug the drive with the photos into ${where}, wait a few seconds, then tap <b>Look again</b>.</p>
    <p><button class="main" type="button" data-ph="again">Look again</button></p>
    ${s.os === 'darwin' ? '' : `<p class="meta">Still not there? A drive set up on a Mac in the Mac’s own format (APFS) can’t be read by ${reader}. Copy the photos onto a drive formatted as exFAT: Windows, Macs and the Pi can all read that.</p>`}
    <p class="meta">The library’s own drive isn’t listed here, so keep the photos on a drive of their own.</p></div>`;
}

function phTrouble() {
  $('phbody').innerHTML = '<div class="note">Couldn’t reach the library program. Is it still running? <button class="sec" type="button" data-ph="again">Look again</button></div>';
}

async function phLookAgain() {
  PH.lists.clear();
  const m = /^#photos:([^:]+)/.exec(location.hash);
  if (m) {
    try { await phLoadDrives(); } catch {}
    if (!(PH.drives || []).some(d => d.id === m[1])) { location.hash = '#photos'; return; }   // that drive was unplugged
  }
  showPhotos(location.hash.slice(1) || 'photos');
}

async function phFolder(id, path, seq) {
  if (!PH.drives) try { await phLoadDrives(); } catch {}
  if (seq !== PH.seq) return;
  PH.drive = (PH.drives || []).find(d => d.id === id) || { id, name: 'Drive' };
  phCrumbs(path);
  const key = id + ':' + path;
  let data = PH.lists.get(key);
  if (!data || Date.now() - data.at > 60000) {
    $('phbody').innerHTML = '<p class="meta"><span class="spin"></span>Opening the folder…</p>';
    let r, j;
    try { r = await fetch(`api/photos/list?d=${encodeURIComponent(id)}&p=${encodeURIComponent(path)}`, { cache: 'no-store' }); j = await r.json().catch(() => ({})); }
    catch { if (seq === PH.seq) phTrouble(); return; }
    if (seq !== PH.seq) return;
    if (!r.ok) {
      PH.key = '';
      $('phbody').innerHTML = `<div class="note">${esc(j.error || 'That folder couldn’t be opened.')} <button class="sec" type="button" data-ph="again">Look again</button>${path ? ` <a href="${phHash(id, '')}">Top of the drive</a>` : ''}</div>`;
      return;
    }
    data = j; data.at = Date.now(); PH.lists.set(key, data);
    if (PH.lists.size > 8) PH.lists.delete(PH.lists.keys().next().value);
  }
  PH.path = path; PH.key = key; PH.data = data; if (data.drive) PH.drive = data.drive;
  phCrumbs(path); phRender();
  const y = PH.scroll.get(key);   // back up to a folder: where you were in it
  if (y) { while (document.documentElement.scrollHeight < y + innerHeight && PH.shown < data.files.length) phMore(); scrollTo(0, y); }
}

// where you are: 🖼️ Photos › drive › folder › folder, and ‹ Back up one folder
function phCrumbs(path) {
  const many = (PH.drives || []).length > 1, d = PH.drive, segs = path ? path.split('/') : [];
  const step = (href, label, here) => here ? `<span>${label}</span>` : `<a href="${href}">${label}</a>`;
  const parts = [];
  if (!d || many) parts.push(step('#photos', 'Photos', !d));
  if (d) parts.push(step(phHash(d.id, ''), esc(d.name), !segs.length));
  segs.forEach((s, i) => parts.push(step(phHash(d.id, segs.slice(0, i + 1).join('/')), esc(s), i === segs.length - 1)));
  $('phcrumbs').innerHTML = parts.join('<span class="sep">›</span>');
  const up = $('phup');
  up.hidden = !(d && (segs.length || many));
  if (d) up.href = segs.length ? phHash(d.id, segs.slice(0, -1).join('/')) : '#photos';
}

function phRender() {
  const d = PH.data, files = d.files || [], folders = d.folders || [];
  const nImg = files.filter(f => f.kind === 'image').length, nVid = files.length - nImg;
  const said = [folders.length && phCount(folders.length, 'folder'), nImg && phCount(nImg, 'photo'), nVid && phCount(nVid, 'video')].filter(Boolean).join(' · ');
  let h = '';
  if (said) h += `<div class="phinfo"><p class="meta">${said}</p>${nImg > 1 ? '<button class="sec" type="button" data-ph="slides">▶ Slideshow</button>' : ''}</div>`;
  if (folders.length) h += '<div class="phlist">' + folders.map(f => `<a class="phfold" href="${phHash(PH.drive.id, phJoin(PH.path, f.name))}"><span class="phfi">${ic('folder', 24)}</span><span class="phfn">${esc(f.name)}</span></a>`).join('') + '</div>';
  if (!files.length && !folders.length) h += `<div class="note">There are no photos or videos in this folder${d.other ? ` (only ${phCount(d.other, 'other file')})` : ''}.</div>`;
  if (d.more) h += '<p class="meta">This folder has a great many files: the first 50,000 photos and videos are shown.</p>';
  h += '<div class="phgrid" id="phgrid"></div><button class="sec phmore" type="button" id="phmore" hidden></button>';
  $('phbody').innerHTML = h;
  PH.shown = 0; phWatch(); phMore();
}

// a tile: the server's small preview; a small WebP or BMP as it is; otherwise an icon and the name
function phTile(f, i) {
  const vid = f.kind === 'video';
  const src = f.thumb ? phURL('thumb', f) : !vid && !phHeic(f.name) && f.size < 1.5e6 ? phURL('file', f) : '';
  return `<button type="button" class="phtile${vid ? ' vid' : ''}" data-i="${i}" title="${esc(f.name)}" aria-label="${vid ? 'Video' : 'Photo'} ${esc(f.name)}">` +
    (src ? `<img alt="" data-src="${esc(src)}">` : phLabel(f)) + '</button>';
}

let phNear = null, phFar = null;
function phWatch() {
  phNear?.disconnect(); phFar?.disconnect(); phNear = phFar = null;
  if (!('IntersectionObserver' in window)) return;
  phNear = new IntersectionObserver(es => es.forEach(e => {   // coming into view: load (and the next few hundred)
    if (!e.isIntersecting) return;
    const t = e.target;
    if (t.id === 'phmore') phMore(); else if (!t.getAttribute('src')) t.src = t.dataset.src;
  }), { rootMargin: '600px 0px' });
  phFar = new IntersectionObserver(es => es.forEach(e => {     // far out of view: let the picture go
    if (!e.isIntersecting && e.target.getAttribute('src')) e.target.removeAttribute('src');
  }), { rootMargin: '2500px 0px' });
  phNear.observe($('phmore'));
}

function phMore() {
  const g = $('phgrid'), files = PH.data?.files || []; if (!g) return;
  const from = PH.shown, to = Math.min(files.length, from + PH_CHUNK);
  if (to > from) {
    g.insertAdjacentHTML('beforeend', files.slice(from, to).map((f, k) => phTile(f, from + k)).join(''));
    for (let k = from; k < to; k++) {
      const img = g.children[k]?.querySelector('img'); if (!img) continue;
      if (phNear) { phNear.observe(img); phFar.observe(img); } else { img.loading = 'lazy'; img.src = img.dataset.src; }
    }
    PH.shown = to;
  }
  const b = $('phmore'), left = files.length - to;
  b.hidden = left <= 0; b.textContent = `Show more (${left.toLocaleString()} left)`;
  if (!b.hidden && phNear && b.offsetParent && b.getBoundingClientRect().top < innerHeight + 600) requestAnimationFrame(phMore);   // still in view
}

// ---- the full-screen viewer
const PV = { i: -1, kbd: false, slide: false, timer: 0, wake: null, pre: null, x: 0, y: 0, t: 0, multi: false, swiped: false, onVideoBar: false };
const PV_HEIC = '<b>This photo is in the iPhone’s HEIC format</b>, which this web browser can’t show. It opens in Safari on an iPhone, iPad or Mac.';
const PV_PIC = 'This picture couldn’t be shown. The file may be damaged, or the drive was unplugged.';
const PV_MOV = '<b>This video can’t play in this web browser.</b> Videos from iPhones (.mov) play in Safari on an iPhone, iPad or Mac.';
const PV_VID = '<b>This video can’t play in this web browser.</b> Try another browser, or the file may be damaged.';

function pvOpen(i, slide, kbd) {
  if (!PH.data?.files?.[i]) return;
  PV.kbd = !!kbd;   // opened from the keyboard: the focus comes back to the photo afterwards
  $('phview').hidden = false; document.documentElement.classList.add('pv-open');
  const page = document.querySelector('.wrap'); if (page) page.inert = true;
  try { if (!history.state?.pv) history.pushState({ ...(history.state || {}), pv: 1 }, ''); } catch {}   // Back closes the viewer
  pvShow(i); pvSlide(!!slide);
  if (PV.kbd) $('pvclose').focus({ preventScroll: true });
}

function pvClose(fromHistory) {
  if ($('phview').hidden) return;
  pvSlide(false); pvStop(); $('pvstage').innerHTML = ''; PV.pre = null;
  $('phview').hidden = true; document.documentElement.classList.remove('pv-open');
  const page = document.querySelector('.wrap'); if (page) page.inert = false;
  if (!fromHistory && history.state?.pv) try { history.back(); } catch {}
  const files = PH.data?.files || [];   // back in the grid at the last one seen
  while ($('phgrid') && PV.i >= PH.shown && PH.shown < files.length) phMore();
  const t = document.querySelector(`#phgrid .phtile[data-i="${PV.i}"]`);
  if (t) { t.scrollIntoView({ block: 'nearest' }); if (PV.kbd) t.focus({ preventScroll: true }); }
}

function pvShow(i) {
  const files = PH.data?.files || [], f = files[i]; if (!f) return;
  pvStop(); PV.i = i;
  $('pvcount').textContent = `${(i + 1).toLocaleString()} / ${files.length.toLocaleString()}`;
  $('pvname').textContent = f.name;
  $('pvprev').hidden = i <= 0; $('pvnext').hidden = i >= files.length - 1;
  const st = $('pvstage');
  if (f.kind === 'video') {
    $('pvload').hidden = true;
    st.innerHTML = '<video controls playsinline preload="metadata"></video>';
    const v = st.firstChild;
    v.onerror = () => pvMsg(/\.mov$/i.test(f.name) ? PV_MOV : PV_VID);
    v.src = phURL('file', f);
    return;
  }
  st.innerHTML = '<img alt="">';
  const img = st.firstChild;
  if (f.thumb) img.style.backgroundImage = `url("${phURL('thumb', f)}")`;   // the small preview at once, the photo over it when it comes
  $('pvload').hidden = false;
  img.onload = () => { $('pvload').hidden = true; img.style.backgroundImage = 'none'; if (PV.slide) pvLater(); pvPreload(i); };
  img.onerror = () => { $('pvload').hidden = true; pvMsg(phHeic(f.name) ? PV_HEIC : PV_PIC); if (PV.slide) pvLater(1500); };
  img.src = phURL('file', f);
}

function pvMsg(html) { $('pvstage').innerHTML = `<div class="pvmsg">${html}</div>`; }

function pvStop() {   // stop the video (and any download) of the one being left
  clearTimeout(PV.timer);
  const st = $('pvstage'), v = st.querySelector('video'), img = st.querySelector('img');
  if (v) { v.pause(); v.removeAttribute('src'); try { v.load(); } catch {} }
  if (img) { img.onload = img.onerror = null; img.removeAttribute('src'); }
}

// one step; the slideshow (auto) goes round and round the photos, leaving out the videos
function pvStep(dir, auto) {
  const files = PH.data?.files || [], n = files.length; let i = PV.i;
  for (let k = 0; k < n; k++) {
    i += dir;
    if (auto) i = (i + n) % n; else if (i < 0 || i >= n) return;
    if (!auto || files[i].kind === 'image') return pvShow(i);
  }
}
function pvLater(ms = 5000) { clearTimeout(PV.timer); PV.timer = setTimeout(() => pvStep(1, true), ms); }
function pvPreload(i) {   // the next photo, so the next swipe (or slide) is quick
  const files = PH.data?.files || [];
  for (let k = i + 1; k < files.length && k < i + 4; k++) if (files[k].kind === 'image') { PV.pre = new Image(); PV.pre.src = phURL('file', files[k]); return; }
}

function pvSlide(on) {
  PV.slide = on; clearTimeout(PV.timer);
  $('pvplay').textContent = on ? '⏸ Pause' : '▶ Slideshow';
  pvWake(on);
  if (!on) return;
  const f = PH.data?.files?.[PV.i], img = $('pvstage').querySelector('img');
  if (!f || f.kind !== 'image' || !img) pvStep(1, true);
  else if (img.complete && img.naturalWidth) pvLater();
}
async function pvWake(on) {   // a slideshow keeps the screen on
  try {
    if (on && !PV.wake && navigator.wakeLock) PV.wake = await navigator.wakeLock.request('screen');
    else if (!on && PV.wake) { const w = PV.wake; PV.wake = null; await w.release(); }
  } catch { PV.wake = null; }
}

function bindPhotos() {
  $('phbody').addEventListener('click', e => {
    const t = e.target.closest('.phtile'); if (t) { pvOpen(+t.dataset.i, false, e.detail === 0); return; }
    if (e.target.id === 'phmore') { phMore(); return; }
    const a = e.target.closest('[data-ph]')?.dataset.ph;
    if (a === 'slides') { const i = (PH.data?.files || []).findIndex(f => f.kind === 'image'); if (i >= 0) pvOpen(i, true); }
    else if (a === 'again') phLookAgain();
  });
  $('phbody').addEventListener('error', e => {   // a preview that couldn't be made: the icon and name instead
    const img = e.target; if (img.tagName !== 'IMG' || !img.getAttribute('src')) return;
    const t = img.closest('.phtile'), f = t && PH.data?.files?.[+t.dataset.i]; if (!f) return;
    phNear?.unobserve(img); phFar?.unobserve(img); img.outerHTML = phLabel(f);
  }, true);
  addEventListener('hashchange', () => {
    if (!$('phview').hidden) pvClose(true);
    openFromHash();   // the Back button, a link back from a guide, a photo folder: show what the address says
  });

  $('pvclose').onclick = () => pvClose();
  $('pvprev').onclick = () => pvStep(-1);
  $('pvnext').onclick = () => pvStep(1);
  $('pvplay').onclick = () => pvSlide(!PV.slide);
  const st = $('pvstage'), zoomed = () => !!window.visualViewport && visualViewport.scale > 1.05;
  st.addEventListener('touchstart', e => {
    const t = e.touches[0];
    PV.multi = e.touches.length > 1; PV.swiped = false; PV.x = t.clientX; PV.y = t.clientY; PV.t = Date.now();
    const v = e.target.closest('video');   // a video's own controls (along its bottom) take their own swipes
    PV.onVideoBar = !!v && t.clientY > v.getBoundingClientRect().bottom - 90;
  }, { passive: true });
  st.addEventListener('touchmove', e => { if (e.touches.length > 1) PV.multi = true; }, { passive: true });
  st.addEventListener('touchend', e => {
    const multi = PV.multi; if (!e.touches.length) PV.multi = false;
    if (multi || e.touches.length || zoomed() || PV.onVideoBar || Date.now() - PV.t > 900) return;   // pinching, or looking round a zoomed photo
    const t = e.changedTouches[0], dx = t.clientX - PV.x, dy = t.clientY - PV.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) { PV.swiped = true; pvStep(dx < 0 ? 1 : -1); }
    else if (dy > 100 && dy > 2 * Math.abs(dx)) { PV.swiped = true; pvClose(); }   // swipe down: back to the folder
  });
  st.addEventListener('click', e => {   // a tap beside the picture closes the viewer; on it, nothing
    if (PV.swiped) { PV.swiped = false; return; }
    if (e.target.closest('video, .pvmsg')) return;
    const img = e.target.closest('img');
    if (img && img.naturalWidth) {
      const r = img.getBoundingClientRect(), k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
      const w = img.naturalWidth * k, h = img.naturalHeight * k, x = e.clientX - r.left - (r.width - w) / 2, y = e.clientY - r.top - (r.height - h) / 2;
      if (x >= 0 && y >= 0 && x <= w && y <= h) return;
    }
    pvClose();
  });
  document.addEventListener('keydown', e => {
    if ($('phview').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); pvClose(); }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.target.closest?.('video')) { e.preventDefault(); pvStep(e.key === 'ArrowRight' ? 1 : -1); }
  });
  addEventListener('popstate', () => { if (!$('phview').hidden && !history.state?.pv) pvClose(true); });
  document.addEventListener('visibilitychange', () => { if (PV.slide && document.visibilityState === 'visible') { PV.wake = null; pvWake(true); } });
}

// ------------------------------------------------------------------ getting around
// Our own pages (guides, tools, the A-Z index) open right here: the browser's Back button, or the
// "Guides" link at the top of every guide, brings you back to where you were. Other websites open in a
// new tab so you keep your place. Two exceptions: on a phone's home-screen app there is no Back button,
// so books and Wikipedia open in a new tab there; and so does anything tapped while an answer is still
// being written, so the answer isn't cut off.
const standalone = (() => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; } })();
let writing = 0;
function linkFor(a) {
  const href = a.getAttribute('href') || '';
  if (!href || href.startsWith('#') || href.startsWith('javascript:') || a.hasAttribute('download')) return 'same';
  let u; try { u = new URL(a.href, location.href); } catch { return 'same'; }
  if (u.origin !== location.origin) return 'new';
  const ourPage = /\.html?$/i.test(u.pathname) || u.pathname === location.pathname;
  if (writing && $('out').contains(a)) return 'new';
  return standalone && !ourPage ? 'new' : 'same';
}
function onLinkClick(e) {
  const a = e.target.closest && e.target.closest('a[href]'); if (!a || e.defaultPrevented) return;
  if (linkFor(a) === 'new') { a.target = '_blank'; a.rel = 'noopener'; } else a.removeAttribute('target');
  // leaving for a guide from the Guides tab: remember its group, so Back (or the guide's "Guides" link) reopens it
  const shelf = a.dataset.shelf;
  if (shelf && !a.target) try { history.replaceState(history.state, '', '#tools:' + shelf); } catch {}
}
// "#tools:food" opens the Guides tab at the Food group; "#library" the Books tab, "#photos:…" a photo folder, and so on
function openFromHash() {
  if (/^#photos(:|$)/.test(location.hash)) { showPhotos(location.hash.slice(1)); return; }
  let tab = '', grp = ''; try { [tab, grp] = decodeURIComponent(location.hash.slice(1)).split(':'); } catch {}
  if (!VIEWS[tab] || tab === 'photos') tab = firstView();
  if (tab === 'maps' && mapPage()) { location.replace(mapPage()); return; }   // Maps is the map itself (a button on a guide page brought us here)
  setView(tab);
  if (tab === 'tools' && grp) { openShelf(grp); try { history.replaceState(history.state, '', '#tools:' + grp); } catch {} }
}
const mapPage = () => { const P = guidePaths(); return P.map && hasMap() ? P.map : ''; };   // '' where this library has no map: then Maps is a screen of its own
function openShelf(grp) { const d = document.getElementById('g-' + grp); if (d) { d.open = true; requestAnimationFrame(() => d.scrollIntoView({ block: 'start' })); } }
// The first screen: Home. Someone new to the website sees one short welcome first (not on a drive or a Vault, and
// not when they came by a link to something particular).
const firstView = () => mode !== 'drive' && !store.get('ark-welcomed') && !new URLSearchParams(location.search).get('q') ? 'welcome' : 'home';
const sideOn = (tab, name) => tab === name || (tab === 'setup' && ['ai', 'usb'].includes(name)) || (tab === 'more' && ['help', 'sharing', 'vault', 'status', 'about'].includes(name)) || (tab === 'kit' && name === 'photos');
function setView(name) {   // show a screen (what the address says is go's business)
  if (!VIEWS[name]) name = 'home';
  const v = VIEWS[name], sec = v.sec || name; view = name;
  document.body.classList.toggle('bare', !!v.bare);
  document.querySelectorAll('#wrap > section').forEach(s => s.hidden = s.id !== sec);
  $('libseg').hidden = !(name === 'tools' || name === 'library');
  $('libseg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.go === name));
  if (v.page) document.querySelectorAll('#setup [data-page]').forEach(c => c.classList.toggle('pg-off', !c.dataset.page.split(' ').includes(v.page)));
  $('wrap').classList.toggle('wide', name === 'home' || name === 'kit');
  $('top').classList.toggle('home', name === 'home');
  $('viewtitle').textContent = name === 'status' && $('pihtitle') ? $('pihtitle').textContent : v.title || '';
  $('backbtn').hidden = !v.back;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === v.nav));
  document.querySelectorAll('#side button').forEach(b => b.classList.toggle('on', sideOn(b.dataset.tab, name)));
  if (name === 'welcome') $('welcome').querySelectorAll('img[data-src]').forEach(i => { i.src = i.dataset.src; i.removeAttribute('data-src'); });
  if (name === 'home') renderHome(); else if (name === 'maps') renderMaps(); else if (name === 'more') renderMore(); else if (name === 'help') renderHelp();
}
// Go to a screen and put it in the address. Going into a screen that has a Back button is a step of its own, so
// the phone's Back button comes back out of it; the six main screens take each other's place, as the tabs always did.
function go(name, o = {}) {
  if (!VIEWS[name]) name = 'home';
  if (name === 'photos') { location.hash = '#photos'; return; }
  if (name === 'maps' && mapPage()) { location.href = mapPage(); return; }   // Maps opens the map itself; its own top row has the walking routes
  const hash = '#' + name + (o.grp ? ':' + o.grp : ''), child = !!VIEWS[name].back && !!view && view !== name && view !== 'welcome';
  try { if (location.hash !== hash) { history[child ? 'pushState' : 'replaceState'](history.state, '', hash); if (child) pushed++; } } catch {}
  setView(name); scrollTo(0, 0);
  if (name === 'tools' && o.grp) openShelf(o.grp);
  if (o.ask) { $('q').value = o.ask; ask(); }
}
function goBack() { const up = VIEWS[view] && VIEWS[view].back; if (!up) return; if (pushed > 0) { pushed--; history.back(); } else go(up); }
function setTheme(v) { try { localStorage.setItem('so-theme', v); } catch {} const r = document.documentElement; if (v === 'dark' || v === 'light') r.setAttribute('data-theme', v); else r.removeAttribute('data-theme'); }
function renderNav() {
  $('tabs').innerHTML = NAV.map(([t, label, i]) => `<button type="button" data-tab="${t}"><i>${ic(i)}</i>${label}</button>`).join('');
  $('side').innerHTML = `<a class="brand" href="#home" data-go="home"><img class="logo" src="icon.svg" alt="" width="40" height="40"><span><b>ARK</b><small>Illinois Valley</small></span></a>` +
    SIDE.map(([t, label, i]) => `<button type="button" data-tab="${t}">${ic(i, 20)}${label}</button>`).join('');
}

// ---- Home: search, the emergency finder, the four big doors, the tools, and what is saved on this device
const SAVE_WORD = { saved: ['ok', 'Saved'], none: ['', 'Not saved'], update: ['busy', 'Update available'], gone: ['busy', 'Needs saving again'], busy: ['busy', 'Downloading'] };
const savePill = k => { const [c, w] = SAVE_WORD[SAVED[k] || 'none']; return `<span class="pill ${c}">${w}</span>`; };
function aiWord() {
  if (mode === 'drive') return server.llm === 'ready' ? 'On' + (server.model ? ': ' + esc(server.model) : '') : server.llm === 'starting' ? 'Starting…' : 'Off: search only';
  const chosen = store.get('aiModel') && MODELS[store.get('aiModel')];
  return ai.kind === 'webllm' ? 'On: ' + esc(ai.label) : ai.loading ? 'Loading…' : chosen ? 'On: ' + esc(chosen[2]) : 'Off';
}
function renderHome() {
  const P = guidePaths();
  if (P.sos) $('homesos').href = P.sos;
  $('homecards').innerHTML = `<a class="big go" href="#ask" data-go="ask">${ic('chat')}<b>Ask ARK</b><span>An answer, with its sources</span></a>` +
    `<a class="big" href="#tools" data-go="tools">${ic('page')}<b>Guides</b><span>Plain-English how-to, by subject</span></a>` +
    `<a class="big" href="#library" data-go="library">${ic('book')}<b>Books</b><span>Manuals and references</span></a>` +
    `<a class="big" href="#maps" data-go="maps">${ic('map')}<b>Maps &amp; Routes</b><span>Works with no signal</span></a>`;
  const SHORT = { map: 'Map', calc: 'Calculator', conv: 'Converter', plantid: 'Plant ID', morse: 'Morse code', pill: 'Pill ID' };
  const four = TOOL_CARDS.filter(c => c && SHORT[c[0]] && P[c[0]] && (c[0] !== 'map' || hasMap())).sort((a, b) => Object.keys(SHORT).indexOf(a[0]) - Object.keys(SHORT).indexOf(b[0])).slice(0, 4);
  $('hometools').innerHTML = four.map(([k]) => `<a href="${P[k]}">${ic(TOOL_ICON[k] || 'wrench')}${SHORT[k]}</a>`).join('');
  renderHomeOff(); homeSearch();
}
function renderHomeOff() {
  let h = '<div class="row"><span class="tx"><b style="font-size:16px">Offline content</b></span></div>';
  if (mode === 'drive') h += '<div class="row"><span class="tx">Whole library</span><span class="pill ok">On this drive</span></div>';
  else {
    h += `<div class="row"><span class="tx">Guides and tools</span>${savePill('library')}</div>`;
    if (hasMap()) h += `<div class="row"><span class="tx">Illinois Valley map</span>${savePill('map')}</div>`;
    h += `<div class="row"><span class="tx">Walking routes</span>${savePill('routes')}</div>`;
  }
  const on = mode === 'drive' ? server.llm === 'ready' : ai.kind === 'webllm' || !!(store.get('aiModel') && MODELS[store.get('aiModel')]);
  h += `<div class="row"><span class="tx">Offline AI</span><span class="pill ${on ? 'ok' : ''}">${on ? 'On' : (mode === 'drive' ? server.llm === 'starting' : ai.loading) ? 'Starting' : 'Off'}</span></div>`;
  $('homeoff').innerHTML = h + `<a class="row" href="#setup" data-go="setup"><span class="tx" style="font-weight:600;color:var(--accent)">Manage offline downloads</span><span class="chev">${ic('right', 18)}</span></a>`;
}
// What you type on Home is looked for in the names of the guides, the tools and the books, as you type. The first
// line hands the same words to Ask, which searches inside every page and answers with its sources.
function homeSearch() {
  const q = $('hq').value.trim(), box = $('hres'); if (q.length < 2) { box.hidden = true; return; }
  const ws = q.toLowerCase().split(/\s+/).filter(Boolean), has = s => { s = s.toLowerCase(); return ws.every(w => s.includes(w)); }, P = guidePaths();
  let h = `<button type="button" class="row" data-go="ask" data-ask="${esc(q)}">${ic('chat')}<span class="tx"><b>Ask ARK: “${esc(q)}”</b><small>Searches inside every guide and book, and answers with its sources</small></span></button>`;
  const gs = [], ours = new Set(Object.values(P));
  for (const list of Object.values(GUIDE_CARDS)) for (const c of list) if (c && P[c[0]] && has(c[1] + ' ' + c[2])) gs.push(c);
  if (gs.length) h += '<h4>Guides</h4>' + gs.slice(0, 6).map(([g, t]) => `<a class="row" href="${P[g]}"><span class="tx"><b>${noPic(t)}</b></span></a>`).join('');
  const ts = TOOL_CARDS.filter(c => c && P[c[0]] && has(c[1] + ' ' + c[2]));
  if (ts.length) h += '<h4>Tools</h4>' + ts.slice(0, 4).map(([k, t]) => `<a class="row" href="${P[k]}"><span class="tx"><b>${noPic(t)}</b></span></a>`).join('');
  const bs = (LIB || []).filter(d => !d.t.startsWith('Walk to ') && !ours.has(d.u) && has(d.t + ' ' + (d.d || ''))).slice(0, 8);
  if (bs.length) h += '<h4>Books</h4>' + bs.map(d => `<a class="row" href="${esc(d.u)}"><span class="tx"><b>${esc(noPic(d.t))}</b><small>${esc(d.d || '')}</small></span></a>`).join('');
  box.innerHTML = h; box.hidden = false;
}
// The box above the guides: only the guides whose name or description has every word stay
function filterGuides() {
  const ws = $('guideq').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  $('toolgrid').querySelectorAll('details.shelf').forEach(d => {
    let n = 0; d.querySelectorAll('a.tool').forEach(a => { const t = a.textContent.toLowerCase(), ok = ws.every(w => t.includes(w)); a.hidden = !ok; if (ok) n++; });
    d.hidden = !n;
    if (ws.length) { d.dataset.filtering = '1'; d.open = true; }
    else if (d.dataset.filtering) { delete d.dataset.filtering; d.open = isOpen(d.dataset.k, d.dataset.k === 'tools:start'); }
  });
}

// ---- Maps & Routes: the two doors, and whether each is saved on this device
function renderMaps() {
  const P = guidePaths(), card = k => (TOOL_CARDS.find(c => c && c[0] === k) || [])[2] || '';
  const here = (k, yes, no) => mode === 'drive' ? '' : `<div class="saverow" style="padding-bottom:0"><span class="tx"><b>On this device</b><small>${SAVED[k] === 'saved' ? yes : no}</small></span>${savePill(k)}${SAVED[k] === 'saved' ? '' : '<a class="sec" href="#setup" data-go="setup">Save it</a>'}</div>`;
  let h = '';
  if (P.map && hasMap()) h += `<div class="card"><h3>Illinois Valley map</h3><p class="meta">${card('map').replace(/\s*No signal needed\.$/, '')}</p><p><a class="btn" href="${P.map}">${ic('map', 20)}Open the map</a></p>` +
    (mode === 'drive' ? '<p class="meta">The map is on this drive. A <a href="#setup" data-go="setup">detailed map of a far wider area</a> can be added to it.</p>' : here('map', 'Saved: the map works with no signal.', 'Not saved yet: until it is, the map needs a signal.')) + '</div>';
  if (P.walk) h += `<div class="card"><h3>Walking routes</h3><p class="meta">${card('walk')}</p><p><a class="btn" href="${P.walk}">${ic('route', 20)}Open the routes</a></p>` +
    here('routes', 'Saved: the directions work with no signal.', 'Not saved yet: until they are, the directions need a signal.') + '</div>';
  $('mapsbody').innerHTML = h || '<p class="note">This library has no map or routes yet.</p>';
}

// ---- More: everything that is not one of the five other buttons
function renderMore() {
  const drive = mode === 'drive', theme = (() => { try { return localStorage.getItem('so-theme') || 'dark'; } catch { return 'dark'; } })();
  const r = (to, icn, t, sub) => `<button type="button" class="row" data-go="${to}">${ic(icn)}<span class="tx"><b>${t}</b>${sub ? `<small>${sub}</small>` : ''}</span><span class="chev">${ic('right', 18)}</span></button>`;
  $('morebody').innerHTML = '<p class="label" style="margin-top:0">Offline</p><div class="card rows">' +
    r('setup', 'down', 'Offline &amp; downloads', drive ? 'What is on this drive, and the detailed map' : 'Save guides, routes and the map to this device') +
    r('ai', 'chip', 'Offline AI settings', aiWord()) +
    (drive ? '' : r('usb', 'usb', 'Complete offline library (USB)', 'Every book, Wikipedia, maps and an AI, on a drive')) + '</div>' +
    '<p class="label">Share and build</p><div class="card rows">' +
    r('sharing', 'wifi', 'Share with nearby devices', drive ? 'Let phones on the same Wi-Fi use this library' : 'From a library on a drive or an ARK Vault') +
    r('vault', 'box', 'ARK Vault', 'Build guide, parts, 3D view, wiring') +
    ($('pihealth').hidden ? '' : r('status', 'chip', server.ark ? 'Vault system status' : 'Raspberry Pi status', 'Power, heat and speed, right now')) + '</div>' +
    '<p class="label">Settings and help</p><div class="card rows">' +
    `<div class="row"><span class="tx"><b>Display</b></span><div class="seg small" role="group" aria-label="Display">${['auto', 'light', 'dark'].map(t => `<button type="button" data-theme-set="${t}"${theme === t ? ' class="on"' : ''}>${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>` +
    r('help', 'help', 'Help', 'Getting started, installing, troubleshooting') + r('about', 'info', 'About') + '</div>';
}
function renderHelp() {
  const P = guidePaths(), end = `<span class="chev">${ic('right', 18)}</span>`;
  const a = (href, icn, t, sub) => href ? `<a class="row" href="${href}">${ic(icn)}<span class="tx"><b>${t}</b>${sub ? `<small>${sub}</small>` : ''}</span>${end}</a>` : '';
  const b = (to, icn, t, sub) => `<button type="button" class="row" data-go="${to}">${ic(icn)}<span class="tx"><b>${t}</b>${sub ? `<small>${sub}</small>` : ''}</span>${end}</button>`;
  $('helpbody').innerHTML = '<div class="card rows">' +
    a(P.device, 'help', 'Getting started', 'Run the library on a computer, an old phone or a tablet') +
    a(P.sos, 'alert', 'Emergency finder', 'Something happening right now? Straight to the right page') +
    a(P.az, 'page', 'Subject index A–Z', 'Look anything up, like the index at the back of a book') +
    b('setup', 'down', 'Using ARK offline', 'What to save, and how') + b('ai', 'chip', 'The offline AI', 'Turning it on, and what it needs') +
    b('maps', 'map', 'Maps and routes') + b('sharing', 'wifi', 'Sharing with nearby devices') +
    a(P.get, 'usb', 'Installation help', 'The USB setup tool: drive sizes and troubleshooting') +
    a(P.ammocan, 'box', 'ARK Vault guide', 'Building it, and what to do when something goes wrong') +
    a(P.all, 'folder', 'Everything on the drive', 'The full index of every file, archive and program') + '</div>';
}
// the rows under Offline & downloads that lead on to the other ways of going offline
function renderOffLinks() {
  const P = guidePaths(), end = `<span class="chev">${ic('right', 18)}</span>`;
  const b = (to, icn, t, sub) => `<button type="button" class="row" data-go="${to}">${ic(icn)}<span class="tx"><b>${t}</b><small>${sub}</small></span>${end}</button>`;
  $('offlinks').innerHTML = b('ai', 'chip', 'Offline AI', aiWord()) +
    (mode === 'drive' ? b('sharing', 'wifi', 'Share with nearby devices', 'Let phones on the same Wi-Fi use this library') : b('usb', 'usb', 'Complete offline library (USB)', 'Download the setup tool, choose a drive, and select the library content you want')) +
    b('vault', 'box', 'ARK Vault', 'A battery-powered library that nearby devices can use without internet') +
    (P.get ? `<a class="row" href="${P.get}">${ic('help')}<span class="tx"><b>Installation help</b><small>Drive sizes and troubleshooting</small></span>${end}</a>` : '');
}
// Sharing, where this copy cannot do it: the website (a library on a drive or a Vault shares, not a website), or a
// phone that is itself using a library shared from another device
function renderShareHelp() {
  const box = $('sharehelp'), P = guidePaths(); box.hidden = !$('sharecard').hidden;
  if (box.hidden) return;
  box.innerHTML = '<h3>Share with nearby devices</h3>' + (mode === 'drive'
    ? '<p class="note" style="margin:0">This library is hosted on another device. Change AI and sharing settings on that device.</p>'
    : '<p class="meta">Other phones, tablets, and computers on the same local network can open a library in a browser. Internet is not required.</p><p class="meta">Sharing starts from a library on a USB drive or an ARK Vault. This website cannot share itself.</p>' +
      (P.device ? `<p style="margin-bottom:0"><a class="sec" href="${P.device}">How to run and share a library</a></p>` : ''));
}
// Is it really saved? The note that it was saved is checked against three of its files: phones clear saved
// websites they have not seen for a while. A newer library than the one saved shows as "Update available".
async function savedState(which) {
  const set = manifest && manifest.offline && manifest.offline[which], flag = store.get('saved-' + which);
  if (!set || !flag) return 'none';
  if (flag !== manifest.built) return 'update';
  try {
    const fs = set.files.filter(f => f !== './');
    for (const f of [fs[0], fs[fs.length >> 1], fs[fs.length - 1]]) if (f && !(await caches.match(new URL(f, BASE).href, { ignoreSearch: !f.includes('.pmtiles') }))) return 'gone';
  } catch {}
  return 'saved';
}
async function renderSaved() {
  if (mode === 'drive' || !manifest) return;
  for (const k of ['library', 'routes', 'map']) if (SAVED[k] !== 'busy' || !$('savelib').disabled) SAVED[k] = await savedState(k);
  for (const [k, btn] of [['library', 'savelib'], ['routes', 'saveroutes'], ['map', 'savemap']]) {
    const [c, w] = SAVE_WORD[SAVED[k]], p = $('st-' + k); p.className = 'pill ' + c; p.textContent = w;
    $(btn).textContent = SAVED[k] === 'saved' ? 'Save again' : SAVED[k] === 'update' ? 'Update' : 'Save';
  }
  if (view === 'home') renderHomeOff(); else if (view === 'maps') renderMaps();
}
// coming back to the app (Back button, or a reload by the phone): put the page where it was
function saveScroll() { try { sessionStorage.setItem('so-scroll', JSON.stringify({ h: location.hash, y: scrollY })); } catch {} }
const scrollDone = {};
function restoreScroll(tab) {
  if (scrollDone[tab]) return; scrollDone[tab] = 1;
  let s = null; try { s = JSON.parse(sessionStorage.getItem('so-scroll') || 'null'); } catch {}
  if (!s || !s.y || s.h.slice(1).split(':')[0] !== tab || location.hash !== s.h) return;
  requestAnimationFrame(() => scrollTo(0, s.y));
}

// The Pi's own touchscreen: the Pi setup opens the library there with ?touch=1. A screen in a case has
// no keyboard, and the system's own on-screen keyboard doesn't show up for every browser, so the page
// brings its own (and tells the system's one to stay away, so the two never cover the screen together).
function screenKeyboard() {
  let on = false;
  try {
    const u = new URLSearchParams(location.search);
    if (u.has('touch')) localStorage.setItem('so-touch', u.get('touch') === '0' ? '' : '1');
    on = !!localStorage.getItem('so-touch');
  } catch {}
  if (!on) return;
  const typable = el => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && ['text', 'search', 'number', ''].includes(el.getAttribute('type') || '')));
  const quiet = el => { if (typable(el)) el.setAttribute('inputmode', 'none'); };
  document.querySelectorAll('input,textarea').forEach(quiet);
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
    if (n.nodeType === 1) { quiet(n); n.querySelectorAll('input,textarea').forEach(quiet); }
  }))).observe(document.body, { childList: true, subtree: true });

  const key = (k, label, cls = '') => `<button type="button" data-k="${esc(k)}"${cls ? ` class="${cls}"` : ''}>${esc(label)}</button>`;
  const kb = document.createElement('div');
  kb.id = 'osk'; kb.hidden = true; kb.setAttribute('aria-label', 'On-screen keyboard');
  kb.innerHTML = ['1234567890', 'qwertyuiop', "asdfghjkl'", 'zxcvbnm,.?'].map(r => `<div class="r">${[...r].map(c => key(c, c)).join('')}</div>`).join('') +
    `<div class="r">${key('hide', '⌄ Hide', 'w')}${key('shift', '⇧ ABC', 'w')}${key(' ', 'space', 'sp')}${key('back', '⌫', 'w')}${key('enter', '⏎ Go', 'w go')}</div>`;
  document.body.appendChild(kb);

  let target = null, shift = false, physical = false;   // a real keyboard (a TV with a USB keyboard): ours steps aside
  const setShift = v => { shift = v; kb.querySelector('[data-k=shift]').classList.toggle('on', v);
    kb.querySelectorAll('[data-k]').forEach(b => { const k = b.dataset.k; if (/^[a-z]$/.test(k)) b.textContent = v ? k.toUpperCase() : k; }); };
  const show = el => {
    target = el; kb.hidden = false; document.body.classList.add('osk-open');
    requestAnimationFrame(() => {   // lift the text box (and the button beside it) above the keyboard
      const r = (el.closest('form') || el).getBoundingClientRect(), top = kb.getBoundingClientRect().top;
      if (r.bottom > top - 6) scrollBy(0, r.bottom - top + 6);
    });
  };
  const hide = () => { kb.hidden = true; document.body.classList.remove('osk-open'); setShift(false); };
  const changed = el => el.dispatchEvent(new Event('input', { bubbles: true }));
  const put = (el, s) => {
    if (el.type === 'number') el.value += s;
    else { const a = el.selectionStart ?? el.value.length, z = el.selectionEnd ?? a; el.setRangeText(s, a, z, 'end'); }
    changed(el);
  };
  const back = el => {
    if (el.type === 'number') el.value = el.value.slice(0, -1);
    else { let a = el.selectionStart ?? el.value.length; const z = el.selectionEnd ?? a; if (a === z && a > 0) a--; el.setRangeText('', a, z, 'end'); }
    changed(el);
  };
  document.addEventListener('focusin', e => { if (typable(e.target) && !physical) show(e.target); });
  document.addEventListener('keydown', e => { if (e.isTrusted && !kb.contains(e.target)) { physical = true; hide(); } }, true);
  document.addEventListener('focusout', e => { if (e.target === target) setTimeout(() => { if (!typable(document.activeElement)) hide(); }, 0); });
  kb.addEventListener('pointerdown', e => e.preventDefault());   // a key press mustn't take the focus out of the text box
  kb.addEventListener('mousedown', e => e.preventDefault());
  kb.addEventListener('click', e => {
    const b = e.target.closest('button[data-k]'); if (!b || !target) return;
    const k = b.dataset.k, el = target;
    if (k === 'hide') { hide(); el.blur(); }
    else if (k === 'shift') setShift(!shift);
    else if (k === 'back') back(el);
    else if (k === 'enter') {
      if (el.form && el.form.id === 'f') { hide(); el.blur(); el.form.requestSubmit(); }   // ask the question
      else { hide(); el.blur(); }
    } else { put(el, shift ? k.toUpperCase() : k); if (shift) setShift(false); }
  });
}

