// SO Survival Library — one app for two places:
//  * "drive" mode: served by the Library Assistant program on the laptop (searches every PDF and
//    the Kiwix archives on the drive; the AI is the laptop's llama-server)
//  * "public" mode: a static website; search runs in the browser, the AI runs in the browser
//    (WebLLM / WebGPU), Wikipedia is searched online, and everything can be saved for offline use.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } },
                set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
const BASE = new URL('./', location.href).href;

let mode = 'public', server = {}, manifest = null, worker = null, workerReady = false, workerSearchable = false, workerInfo = {};
const ai = { kind: 'none', engine: null, label: '', loading: false, error: '' };

// ------------------------------------------------------------------ start-up
init();
async function init() {
  bindUI();
  // the drive edition is always served by the Library Assistant on this computer
  if (['127.0.0.1', 'localhost'].includes(location.hostname)) try {
    const r = await fetch('api/status', { signal: AbortSignal.timeout(1500) });
    if (r.ok) { const s = await r.json(); if (s && 'docs' in s) { mode = 'drive'; server = s; } }
  } catch {}
  if (mode === 'drive') {
    $('tagline').textContent = 'Searches every manual, guide and offline encyclopedia on this drive, then has the offline AI answer from what it finds. Everything runs on this computer — no internet.';
    $('wikilabel').textContent = 'Include Wikipedia & archives';
    setInterval(refreshServer, 5000);
  } else {
    try { manifest = await (await fetch('data/manifest.json', { cache: 'no-cache' })).json(); } catch {}
    startWorker();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (store.get('aiModel')) setTimeout(() => initWebLLM(store.get('aiModel'), true), 1500);
    addEventListener('online', renderStatus); addEventListener('offline', renderStatus);
  }
  renderStatus(); renderTools(); renderSetup(); loadLibrary();
  const tab = location.hash.slice(1); if (tab) document.querySelector(`#tabs [data-tab="${CSS.escape(tab)}"]`)?.click();
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) { $('q').value = q0; ask(); }
}

async function refreshServer() {
  try { server = await (await fetch('api/status')).json(); } catch {}
  renderStatus();
}

function startWorker() {
  worker = new Worker('search-worker.js');
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'progress') { workerSearchable = true; workerInfo.progress = `${m.loaded}/${m.total}`; renderStatus(); }
    else if (m.type === 'ready') { workerReady = workerSearchable = true; workerInfo = m; renderStatus(); }
    else if (m.type === 'error') { workerInfo.error = m.message; renderStatus(); }
    else if (m.type === 'results' && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.type === 'docs' && docsWaiter) { docsWaiter(m.docs); docsWaiter = null; }
  };
  worker.postMessage({ type: 'load', base: BASE });
}
const pending = new Map(); let reqId = 0, docsWaiter = null;
// Resolves { results, partial, loaded, total } or { results: [], notReady: true }.
function workerSearch(q, n) {
  return new Promise(res => {
    if (!workerSearchable) {   // first part of the library still downloading: wait for it (never fail silently)
      const t0 = Date.now();
      const t = setInterval(() => {
        if (workerSearchable) { clearInterval(t); workerSearch(q, n).then(res); }
        else if (workerInfo.error || Date.now() - t0 > 90000) { clearInterval(t); res({ results: [], notReady: true }); }
      }, 300);
      return;
    }
    const id = ++reqId; pending.set(id, res); worker.postMessage({ type: 'search', q, n, id });
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
  } else {
    h += pill(navigator.onLine ? 'ready' : 'starting', navigator.onLine ? 'Online' : 'Offline', navigator.onLine ? '' : '— using saved copy');
    h += pill(workerReady ? 'ready' : 'starting', 'Search', workerReady ? `${workerInfo.docs} documents` : workerInfo.error ? 'failed to load' : workerSearchable ? `ready, still loading ${workerInfo.progress}` : 'loading…');
    h += pill(ai.kind === 'webllm' ? 'ready' : ai.loading ? 'starting' : 'off', 'AI', ai.kind === 'webllm' ? esc(ai.label) : ai.loading ? 'loading…' : 'off — turn on in ⚙️');
  }
  $('status').innerHTML = h;
}

// ------------------------------------------------------------------ tabs & bindings
function bindUI() {
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('section').forEach(s => s.hidden = s.id !== b.dataset.tab);
  });
  const EX = ['How do I purify creek water?', 'Signs of milk fever in a goat', 'How far is Grants Pass on foot?', 'How do I stop bleeding from a deep cut?',
    'How do I can venison safely?', 'How much power can a small creek make?', 'What plants here are poisonous?', 'How do I make soap from wood ash?',
    'How long should I shelter after fallout?', 'How do I tell a chanterelle from a look-alike?'];
  $('examples').innerHTML = EX.map(x => `<button class="ex" type="button">${esc(x)}</button>`).join('');
  $('examples').addEventListener('click', e => { if (e.target.classList.contains('ex')) { $('q').value = e.target.textContent; ask(); } });
  $('f').addEventListener('submit', e => { e.preventDefault(); ask(); });
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } });
  $('libq').addEventListener('input', () => renderLibrary());
  $('aion').addEventListener('click', () => initWebLLM(document.querySelector('input[name=model]:checked').value, false));
  $('aioff').addEventListener('click', async () => { store.set('aiModel', null); try { await ai.engine?.unload?.(); } catch {} ai.engine = null; ai.kind = 'none'; renderSetup(); renderStatus(); });
  $('savelib').addEventListener('click', () => saveOffline('library'));
  $('saveroutes').addEventListener('click', () => saveOffline('routes'));
}

// ------------------------------------------------------------------ asking
let counter = 0;
async function ask() {
  const q = $('q').value.trim(); if (!q) return;
  const id = ++counter, n = +$('nsrc').value, useAI = $('useai').checked, useWiki = $('usewiki').checked;
  const box = document.createElement('div'); box.className = 'qa';
  box.innerHTML = `<div class="q">${esc(q)}</div><div class="meta" id="m${id}"><span class="spin"></span>Searching the library…</div><div class="answer" id="a${id}"></div><div class="sources" id="s${id}" hidden></div>`;
  $('out').prepend(box); $('q').value = ''; $('examples').hidden = true;
  document.querySelector('#tabs [data-tab=ask]').click();

  const nWiki = useWiki ? Math.max(1, Math.round(n / 3)) : 0, nDoc = n - nWiki;
  let docs = [], wiki = [], note = '';
  if (mode === 'drive') {
    [docs, wiki] = await Promise.all([
      fetch('api/search?q=' + encodeURIComponent(q) + '&n=' + nDoc).then(r => r.json()).catch(() => []),
      nWiki ? fetch('api/kiwix?q=' + encodeURIComponent(q) + '&n=' + nWiki).then(r => r.json()).catch(() => []) : [],
    ]);
  } else {
    let ws; [ws, wiki] = await Promise.all([workerSearch(q, nDoc), nWiki && navigator.onLine ? wikiSearch(q, nWiki) : []]);
    docs = ws.results;
    if (ws.notReady) note = ' ⚠️ The library search is still downloading — try again in a minute (needs a connection the first time).';
    else if (ws.partial) note = ` ⏳ Library still loading (${ws.loaded} of ${ws.total} parts): guides and book titles were searched; ask again in a minute to search inside every page.`;
  }
  const srcs = [], d = docs.slice(), z = wiki.slice();
  while (d.length || z.length) { if (d.length) srcs.push(d.shift()); if (d.length) srcs.push(d.shift()); if (z.length) srcs.push(z.shift()); }
  renderSources(id, srcs);
  const meta = $('m' + id);
  if (!srcs.length) meta.textContent = note ? '' : 'Nothing in the library matched. Try other words (e.g. "bleeding" instead of "cut").';
  else meta.textContent = `${srcs.length} sources found.`;
  meta.textContent += note;
  if (!useAI) return;
  if (mode === 'drive') {
    if (server.llm === 'off') { meta.textContent += ' The AI is not available on this computer.'; return; }
    if (server.llm !== 'ready') { meta.innerHTML = '<span class="spin"></span>Waiting for the AI to finish loading…'; await waitFor(() => server.llm === 'ready' || server.llm === 'off'); }
    if (server.llm === 'ready') await answer(id, q, srcs, 'server');
  } else {
    if (ai.loading) { meta.innerHTML = '<span class="spin"></span>Waiting for the AI to finish loading…'; await waitFor(() => !ai.loading); }
    if (ai.kind === 'webllm') await answer(id, q, srcs, 'webllm');
    else meta.innerHTML += ' <span>To get written answers, turn on the AI in <a href="#" onclick="document.querySelector(\'[data-tab=setup]\').click();return false">⚙️ Offline</a>.</span>';
  }
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
    <a href="${esc(s.link)}" target="_blank" rel="noopener">${s.kind === 'zim' ? '🌐' : '📄'} ${esc(s.title)}</a> <span class="where">${esc(s.where)}</span>
    ${mode === 'public' && s.kind === 'doc' && !s.open ? '<span class="tag">title only — opens the original</span>' : ''}
    <div class="snip">${esc(s.snippet)}</div></div></div>`).join('');
}

const SYSTEM = 'You are an offline survival and reference assistant for a household in the Illinois Valley, southern Oregon, ' +
  'possibly after normal services have broken down. Answer the question using the numbered sources. Cite sources in square ' +
  'brackets like [1] or [2][4] right after the facts they support. Be practical and give clear steps. If the sources do not ' +
  'answer the question, say so plainly, then give your best general knowledge and label it "(not from the library)". For ' +
  'medical, electrical, chemical or structural topics, include the key safety warnings. Keep it under about 250 words.';

async function answer(id, q, srcs, kind) {
  const meta = $('m' + id), out = $('a' + id);
  const words = kind === 'webllm' ? 110 : 220;   // the in-browser models have a 4k-token window
  const ctx = srcs.map((s, i) => `[${i + 1}] ${s.title} (${s.where})\n${String(s.text).split(/\s+/).slice(0, words).join(' ')}`).join('\n\n');
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Sources:\n\n${ctx || '(no matching sources)'}\n\nQuestion: ${q}` }];
  const t0 = Date.now(); let text = '', stopped = false, ctrl = new AbortController();
  const setMeta = (label) => { meta.innerHTML = `<span class="spin"></span>${label} <button class="sec" type="button">Stop</button> <span class="t"></span>`; meta.querySelector('button').onclick = () => { stopped = true; ctrl.abort(); try { ai.engine?.interruptGenerate?.(); } catch {} }; };
  setMeta('The AI is reading the sources…');
  const tick = setInterval(() => { const t = meta.querySelector('.t'); if (t) t.textContent = Math.round((Date.now() - t0) / 1000) + 's'; }, 1000);
  const add = piece => { if (!text) setMeta('Writing…'); text += piece; out.innerHTML = render(text, id, srcs.length); };
  try {
    if (kind === 'server') {
      const r = await fetch('llm/v1/chat/completions', { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, stream: true, temperature: 0.3, max_tokens: 700 }) });
      if (!r.ok) throw new Error('AI error ' + r.status);
      const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue; const data = line.slice(5).trim(); if (data === '[DONE]') continue;
          try { const piece = JSON.parse(data).choices?.[0]?.delta?.content; if (piece) add(piece); } catch {}
        }
      }
    } else {
      const stream = await ai.engine.chat.completions.create({ messages, stream: true, temperature: 0.3, max_tokens: 600 });
      for await (const ch of stream) { const piece = ch.choices?.[0]?.delta?.content; if (piece) add(piece); if (stopped) break; }
    }
    meta.textContent = stopped ? 'Stopped.' : `Answered in ${Math.round((Date.now() - t0) / 1000)} seconds from ${srcs.length} sources. Check the sources before relying on it.`;
  } catch (e) {
    meta.textContent = stopped || e.name === 'AbortError' ? 'Stopped.' : 'The AI could not answer (' + e.message + '). The sources below are still the search results.';
  } finally { clearInterval(tick); }
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
  if (mode === 'drive') {
    $('aiinfo').textContent = 'On the drive, the AI runs as a program on this computer (chosen when you started the Library Assistant). The in-browser AI below is only needed on phones and tablets.';
  } else {
    $('aiinfo').textContent = ai.error || (ai.kind === 'webllm' ? `On: ${ai.label}. Saved on this device.` : ai.loading ? 'Loading…' :
      'The AI runs entirely inside your browser and is saved on this device after one download. It needs a recent browser with WebGPU.');
  }
  $('aion').hidden = ai.kind === 'webllm' || mode === 'drive'; $('aion').disabled = ai.loading; $('aioff').hidden = ai.kind !== 'webllm';
  $('aichoices').hidden = mode === 'drive';
  if (manifest) {
    $('savelibsize').textContent = `≈ ${mb(manifest.offline.library.bytes)}`;
    $('saveroutessize').textContent = `≈ ${mb(manifest.offline.routes.bytes)}`;
  }
  if (mode === 'drive') { $('savelib').disabled = $('saveroutes').disabled = true; $('saveprog').textContent = 'Not needed on the drive — everything is already here.'; }
  if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); $('storage').textContent = `This site is using ${mb(e.usage || 0)} of storage on this device.`; }
  $('about').innerHTML = `Free survival and self-reliance knowledge for the Illinois Valley and southern Oregon. Search runs on your device; the AI runs in your browser.
    Documents that are public domain or openly licensed are searchable in full; others are listed by title and open on the publisher's website.
    Map and route data © OpenStreetMap contributors (ODbL); pill data: US National Library of Medicine Pillbox (ODbL); AI: Meta Llama 3.2 via WebLLM (Apache-2.0).
    ${manifest ? 'Library version ' + esc(manifest.built) + '.' : ''}`;
}

async function saveOffline(which) {
  if (!manifest || !('serviceWorker' in navigator)) { $('saveprog').textContent = 'This browser can’t save websites for offline use.'; return; }
  await navigator.serviceWorker.ready;
  try { await navigator.storage?.persist?.(); } catch {}
  const files = manifest.offline[which].files; let done = 0, failed = 0;
  $('savebarw').hidden = false; $('savelib').disabled = $('saveroutes').disabled = true;
  const queue = files.slice(), workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const f = queue.shift();
      try { const r = await fetch(f); if (!r.ok) failed++; await r.arrayBuffer(); } catch { failed++; }
      done++; $('savebar').style.width = Math.round(done / files.length * 100) + '%'; $('saveprog').textContent = `Saving… ${done} of ${files.length} files`;
    }
  });
  await Promise.all(workers);
  $('saveprog').textContent = failed ? `Saved, but ${failed} files failed — try again with a better connection.` : `Saved ${files.length} files. They now work offline on this device.`;
  $('savelib').disabled = $('saveroutes').disabled = false; store.set('saved-' + which, manifest.built); renderSetup();
}

// ------------------------------------------------------------------ library & tools tabs
let LIB = null;
async function loadLibrary() {
  if (mode === 'drive') { try { LIB = (await (await fetch('api/docs')).json()).map(d => ({ t: d.title, f: d.folder, d: d.desc, u: '/lib/' + d.path.split('/').map(encodeURIComponent).join('/'), o: 1 })); } catch { LIB = []; } }
  else { await waitFor(() => workerSearchable || workerInfo.error); LIB = await new Promise(res => { docsWaiter = res; worker.postMessage({ type: 'docs' }); }); }
  $('libnote').innerHTML = mode === 'drive' ? 'Everything here is on this drive. Click a title to open it.'
    : 'Documents marked <span class="tag">full text</span> are searchable inside; the rest are searchable by title and open on the original publisher’s website (they can’t be republished here). The drive edition has every file.';
  renderLibrary();
}
function renderLibrary() {
  if (!LIB) return;
  const f = $('libq').value.trim().toLowerCase();
  const items = LIB.filter(d => !d.t.startsWith('Walk to ') && (!f || (d.t + ' ' + d.d + ' ' + d.f).toLowerCase().includes(f)));
  const groups = new Map();
  for (const d of items) { const g = d.f.replace(/^Southern-Oregon\\/, '').split('\\')[0] || 'Other'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(d); }
  $('libout').innerHTML = [...groups].sort((a, b) => a[0].localeCompare(b[0])).map(([g, ds]) => `<div class="cat"><h3>${esc(g.replace(/-/g, ' '))} <span class="meta">(${ds.length})</span></h3>` +
    ds.map(d => `<div class="doc"><a href="${esc(d.u)}" target="_blank" rel="noopener">${esc(d.t)}</a>${mode === 'public' && d.o ? '<span class="tag">full text</span>' : ''}<div class="d">${esc(d.d)}</div></div>`).join('') + '</div>').join('')
    || '<p class="meta">Nothing matches.</p>';
}
function renderTools() {
  const P = mode === 'drive'
    ? { iv: '/lib/Southern-Oregon/ILLINOIS-VALLEY-START-HERE.html', md: '/lib/Southern-Oregon/MAKE-DO-HOUSEHOLD-GUIDE.html', food: '/lib/Southern-Oregon/FOOD-FROM-SCRATCH-GUIDE.html', firewood: '/lib/Southern-Oregon/FIREWOOD-GUIDE.html', purify: '/lib/Southern-Oregon/WATER-PURIFICATION-GUIDE.html', wells: '/lib/Southern-Oregon/WATER-WELLS-GUIDE.html', emp: '/lib/Southern-Oregon/EMP-GUIDE.html', seeds: '/lib/Southern-Oregon/SEED-BANK-GUIDE.html', cellar: '/lib/Southern-Oregon/ROOT-CELLAR-GUIDE.html', horse: '/lib/Southern-Oregon/HORSE-GUIDE.html', fuel: '/lib/Southern-Oregon/FUEL-GUIDE.html', smith: '/lib/Southern-Oregon/BLACKSMITHING-GUIDE.html', mush: '/lib/Southern-Oregon/MUSHROOM-GUIDE.html', nuke: '/lib/Southern-Oregon/NUCLEAR-FALLOUT-GUIDE.html', eng: '/lib/Southern-Oregon/ENGINES-AND-MOTORS-GUIDE.html', med: '/lib/Medical/READ-ME-FIRST.html', radio: '/lib/Manuals/Radio-Communications/RADIO-GUIDE.html', pill: '/lib/Medical/Pill-Identifier/PILL-IDENTIFIER.html', walk: '/lib/Southern-Oregon/Walking-Routes/WALKING-ROUTES.html', all: '/lib/README.html' }
    : { iv: 'pages/ILLINOIS-VALLEY-START-HERE.html', md: 'pages/MAKE-DO-HOUSEHOLD-GUIDE.html', food: 'pages/FOOD-FROM-SCRATCH-GUIDE.html', firewood: 'pages/FIREWOOD-GUIDE.html', purify: 'pages/WATER-PURIFICATION-GUIDE.html', wells: 'pages/WATER-WELLS-GUIDE.html', emp: 'pages/EMP-GUIDE.html', seeds: 'pages/SEED-BANK-GUIDE.html', cellar: 'pages/ROOT-CELLAR-GUIDE.html', horse: 'pages/HORSE-GUIDE.html', fuel: 'pages/FUEL-GUIDE.html', smith: 'pages/BLACKSMITHING-GUIDE.html', mush: 'pages/MUSHROOM-GUIDE.html', nuke: 'pages/NUCLEAR-FALLOUT-GUIDE.html', eng: 'pages/ENGINES-AND-MOTORS-GUIDE.html', med: 'pages/Medical-READ-ME-FIRST.html', radio: 'pages/RADIO-GUIDE.html', pill: 'tools/pill-identifier/PILL-IDENTIFIER.html', walk: 'tools/walking-routes/WALKING-ROUTES.html' };
  const T = [['iv', '🏔️ Illinois Valley quick reference', 'Alerts, weather radio, ham repeaters, local contacts, evacuation levels, frost dates, hunting units, key distances.'],
    ['md', '🧰 Make-Do household guide', 'Cleaners, laundry soap, tooth powder, fire starters, oil lamps, glue, mending, plumbing, electronics repair and salvage.'],
    ['food', '🌾 Food from scratch', 'Acorn and grain flour, masa, sourdough, salt, maple syrup, lard — then bread, tortillas, pasta, hardtack and beans.'],
    ['eng', '🔧 Engines, motors & generators', 'Why a small engine will not start, carburetors, chainsaw filing, generator care, testing and rewinding motors, and turning motors into generators.'],
    ['nuke', '☢️ Nuclear fallout', 'Where to shelter, how long (the 7-10 rule), shielding, potassium iodide doses, decontamination, food, water and livestock.'],
    ['mush', '🍄 Mushrooms', 'Local deadly mushrooms and their look-alikes, spore prints, what to do after a bad meal, good edibles, drying, and growing shiitake and oysters.'],
    ['smith', '⚒️ Blacksmithing & hand tools', 'A simple forge, which scrap steel to use, heat colors, hardening and tempering, making chisels, tongs and knives, axe handles and sharpening.'],
    ['fuel', '⛽ Fuel: storing, reviving, finding', 'How long gas and diesel keep, testing and rescuing old fuel, diesel care, and pumping fuel from station tanks, drums and vehicles with no power.'],
    ['horse', '🐴 Horses, mules & draft animals', 'Choosing, feeding and watering, teeth and worms, hoof care and shoeing, saddling and riding, packing, and harness work.'],
    ['cellar', '🥔 Root cellars & food storage', 'Cellars, pits and buried barrels for our warm ground, what each crop needs, cooling without power, sun drying, curing meat, kraut and eggs.'],
    ['seeds', '🌱 Your seed bank', 'Planting calendar for all 39 kit varieties, storing and testing seed, which varieties cross, saving seed from fruits, grafting fruit trees.'],
    ['emp', '⚡ EMP, solar storms & Faraday cages', 'What tests really showed, unplugging, building and testing a Faraday container, solar-storm warnings, checking and repairing gear after.'],
    ['wells', '💧 Wells, pumps, springs & cisterns', 'Your well records, running the well pump on a generator or solar, hand and rope pumps, ram pumps, spring boxes, cisterns, testing.'],
    ['purify', '🚰 Water purification', 'Settling, cloth, alum and ash, biosand and clay-pot filters, charcoal done right, boiling, bleach and pool shock, sunlight, solar stills, tests.'],
    ['firewood', '🪵 Firewood', 'Heat value of local trees, how much you need, felling and bucking safely, splitting, drying in a wet climate, chimneys, ashes, coppicing.'],
    ['med', '💊 Medical & found medicines', 'What medical books there are and how to use found or expired medicines safely.'],
    ['pill', '🔍 Pill identifier', 'Identify a loose pill by the code printed on it — about 32,000 US pills.'],
    ['walk', '🥾 Walking routes', 'On-foot routes from Cave Junction to 359 Oregon and N. California cities, with GPS tracks.'],
    ['radio', '📻 Emergency radio guide', 'How ham, CB, GMRS and shortwave work, and emergency communication.'],
    ['all', '📚 Everything on the drive', 'The full index of every file, archive and program.']];
  $('toolgrid').innerHTML = T.filter(([k]) => P[k]).map(([k, t, d]) => `<a class="tool" href="${P[k]}" target="_blank" rel="noopener"><b>${t}</b><span>${d}</span></a>`).join('');
}
