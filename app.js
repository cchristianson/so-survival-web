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
// older phones (Safari before iOS 16) lack AbortSignal.timeout
if (!AbortSignal.timeout) AbortSignal.timeout = ms => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };

let mode = 'public', server = {}, manifest = null, worker = null, workerReady = false, workerSearchable = false, workerInfo = {};
const ai = { kind: 'none', engine: null, label: '', loading: false, error: '' };

// ------------------------------------------------------------------ start-up
init();
async function init() {
  bindUI();
  // the drive edition is served by the Library Assistant: on this device, or shared over Wi-Fi from another
  if (location.protocol !== 'file:') try {
    const r = await fetch('api/status', { signal: AbortSignal.timeout(1500) });
    if (r.ok) { const s = await r.json(); if (s && 'docs' in s) { mode = 'drive'; server = s; } }
  } catch {}
  if (mode === 'drive') {
    $('tagline').textContent = 'Searches every manual, guide and offline encyclopedia on this drive, then has the offline AI answer from what it finds. Everything runs on this device (or the one sharing it with you) — no internet.';
    $('wikilabel').textContent = 'Include Wikipedia & archives';
    document.querySelector('#tabs [data-tab=setup]').textContent = '⚙️ Settings';
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
    'How long should I shelter after fallout?', 'How do I tell a chanterelle from a look-alike?',
    'How do I signal a plane for help?', 'How much food does a family need for a year?'];
  $('examples').innerHTML = EX.map(x => `<button class="ex" type="button">${esc(x)}</button>`).join('');
  $('examples').addEventListener('click', e => { if (e.target.classList.contains('ex')) { $('q').value = e.target.textContent; ask(); } });
  $('f').addEventListener('submit', e => { e.preventDefault(); ask(); });
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } });
  $('libq').addEventListener('input', () => renderLibrary());
  for (const id of ['libout', 'toolgrid']) {
    $(id).addEventListener('toggle', rememberOpen, true);
    $(id).addEventListener('click', e => { const b = e.target.closest('button[data-all]'); if (b) setAllOpen($(id), b.dataset.all === '1'); });
  }
  $('aion').addEventListener('click', () => initWebLLM(document.querySelector('input[name=model]:checked').value, false));
  $('aioff').addEventListener('click', async () => { store.set('aiModel', null); try { await ai.engine?.unload?.(); } catch {} ai.engine = null; ai.kind = 'none'; renderSetup(); renderStatus(); });
  $('savelib').addEventListener('click', () => saveOffline('library'));
  $('saveroutes').addEventListener('click', () => saveOffline('routes'));
  $('shareon').addEventListener('click', () => setShare(true));
  $('shareoff').addEventListener('click', () => setShare(false));
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
  const srcs = [], d = Array.isArray(docs) ? docs.slice() : [], z = Array.isArray(wiki) ? wiki.slice() : [];
  while (d.length || z.length) { if (d.length) srcs.push(d.shift()); if (d.length) srcs.push(d.shift()); if (z.length) srcs.push(z.shift()); }
  renderSources(id, srcs);
  const meta = $('m' + id);
  if (!srcs.length) meta.textContent = note ? '' : 'Nothing in the library matched. Try other words (e.g. "bleeding" instead of "cut").';
  else meta.textContent = `${srcs.length} sources found.`;
  meta.textContent += note;
  if (!useAI) return;
  if (mode === 'drive') {
    if (server.llm === 'off') { meta.innerHTML += ' <span>' + esc(server.llmError || 'The AI is turned off on this device.') + ' You can change the AI in <a href="#" onclick="document.querySelector(\'[data-tab=setup]\').click();return false">⚙️ Settings</a>.</span>'; return; }
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
  // how much the AI reads: the in-browser models have a 4k-token window; on the drive the size of
  // the AI chosen for this device decides (the Quick AI reads fewer, shorter passages)
  const words = kind === 'webllm' ? 110 : (server.words || 220);
  if (kind === 'server' && server.sources) srcs = srcs.slice(0, server.sources);
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
    $('webai').hidden = true; $('driveai').hidden = false; loadTiers();
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
  $('sharecard').hidden = !sh.local;
  if (!sh.local) return;
  $('shareon').hidden = !!sh.on; $('shareoff').hidden = !sh.on;
  $('sharelinks').innerHTML = sh.on
    ? (sh.links && sh.links.length
        ? '<p class="meta">On the other phone or tablet, connect to the same Wi-Fi, open the web browser and type:</p>' +
          sh.links.map(l => `<p style="font-size:21px;margin:4px 0"><b>${esc(l.replace(/\/$/, ''))}</b></p>`).join('') +
          '<p class="meta">Then tap <b>Share → Add to Home Screen</b> (iPhone) or <b>⋮ → Add to Home screen</b> (Android) so it has an icon.</p>'
        : '<p class="meta">Sharing is on, but this device isn\'t connected to a Wi-Fi network yet. Connect it (or turn on its hotspot), then reopen Settings.</p>')
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
// The library and the guides share one set of "shelves", in the order you'd reach for them.
const SHELVES = [
  ['start', '🧭', 'Start here', 'Emergency finder, A–Z index, unit converter, the local quick reference, starting the library on any device, walking routes'],
  ['health', '🩹', 'Health & medicine', 'Injuries, medicines, childbirth and children, sanitation and disease'],
  ['water', '💧', 'Water', 'Purifying water, wells, pumps, springs and cisterns'],
  ['food', '🍞', 'Food', 'Food when it is scarce, cooking from scratch, preserving, storing, seeds, mushrooms, hunting and fishing'],
  ['animals', '🐐', 'Animals', 'Rabbits, chickens, goats, dairy, bees, horses and draft animals'],
  ['shelter', '🏠', 'Shelter, heat & power', 'Building and repair, natural building, firewood, off-grid power, fuel, engines'],
  ['making', '🛠️', 'Making & repair', 'Practical math and measuring, household make-do, blacksmithing, clothing and leather, bicycles and carts, electronics'],
  ['comms', '📡', 'Communication, community & protection', 'Radio, signals and Morse, maps, navigation and weather, organizing neighbors and barter, protecting your home'],
  ['disaster', '🔥', 'Disasters', 'What to expect in each disaster, wildfire, earthquakes, nuclear fallout, EMP and solar storms'],
  ['other', '📁', 'Programs & other files', 'Apps, readers and everything else on the drive']];
const FOLDER_SHELF = { Guides: 'start', 'Southern-Oregon': 'start', Manuals: 'start', 'Local-Contacts': 'start',
  Medical: 'health', 'Sanitation-Hygiene': 'health', 'Children-Learning': 'health',
  Water: 'water', 'Water-Purification': 'water', 'Water-Wells-Pumps': 'water',
  'Food-Security': 'food', 'Food-From-Scratch': 'food', 'Food-Storage': 'food', 'Gardening-Food': 'food', 'Wild-Plants': 'food', Mushrooms: 'food', Hunting: 'food', Trapping: 'food', Fishing: 'food',
  Animals: 'animals', 'Small-Livestock': 'animals', 'Horses-Draft-Animals': 'animals',
  'Shelter-Building': 'shelter', 'Natural-Building': 'shelter', Firewood: 'shelter', 'Off-Grid-Power': 'shelter', Fuel: 'shelter', 'Engines-Motors': 'shelter',
  'Homestead-Skills': 'making', 'Math-Measuring': 'making', 'Blacksmithing-Tools': 'making', 'Clothing-Leather': 'making', 'Bicycles-Carts': 'making', 'Electronics-Repair': 'making',
  'Comms-Signals': 'comms', 'Home-Security': 'comms', 'Radio-Weather': 'comms', 'Navigation-Weather': 'comms', 'Community-Barter': 'comms', Maps: 'comms', 'Radio-Communications': 'comms',
  Wildfire: 'disaster', 'Disaster-Scenarios': 'disaster', 'Earthquake-Tsunami': 'disaster', 'Nuclear-Radiation': 'disaster', 'EMP-Solar-Storms': 'disaster' };
const OUR_GUIDES = 'Our guides';
let guideShelf = null;              // guide page file name -> shelf key
function shelfOf(folder, url) {     // -> [shelf key, sub-group label]
  if (!guideShelf) { const P = guidePaths(); guideShelf = {}; for (const [k, list] of Object.entries(GUIDE_CARDS)) for (const [g] of list) if (P[g]) guideShelf[P[g]] = k; }
  let u = url || ''; try { u = decodeURIComponent(u); } catch {}
  if (guideShelf[u]) return [guideShelf[u], OUR_GUIDES];
  const seg = folder.split('\\').filter(Boolean);
  if (!seg.length || (seg.length === 1 && /^(\(top folder\)|AI-Offline|Kiwix-Reader|OsmAnd|Phone-Apps|Manuals|Medical)$/.test(seg[0]))) return ['start', 'How to use this drive'];
  if (seg[0] === 'Southern-Oregon' && seg.length === 1) return ['start', 'Local reference'];
  if (seg[0] === 'Southern-Oregon') seg.shift();
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
  const doc = d => `<div class="doc"><a href="${esc(d.u)}" target="_blank" rel="noopener">${esc(d.t)}</a>${mode === 'public' && d.o ? '<span class="tag">full text</span>' : ''}<div class="d">${esc(d.d)}</div></div>`;
  const filtering = words.length > 0;
  const html = SHELVES.map(([k, icon, name, blurb]) => {
    const subs = [...shelves.get(k)].sort((a, b) => (rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])));
    if (!subs.length) return '';
    const n = subs.reduce((t, [, ds]) => t + ds.length, 0);
    const inner = subs.length === 1 && !filtering ? subs[0][1].map(doc).join('')
      : subs.map(([g, ds]) => `<details class="sub" data-k="lib:${esc(k)}:${esc(g)}"${filtering || isOpen('lib:' + k + ':' + g, false) ? ' open' : ''}><summary>${esc(g)} <span class="n">${ds.length}</span></summary>${ds.map(doc).join('')}</details>`).join('');
    return `<details class="shelf" data-k="lib:${k}"${filtering || isOpen('lib:' + k, false) ? ' open' : ''}><summary><span class="ic">${icon}</span><span class="nm">${esc(name)} <span class="n">${n}</span><small>${esc(blurb)}</small></span></summary><div class="shelfbody">${inner}</div></details>`;
  }).join('');
  const P = guidePaths();
  const jump = `<p class="meta">No search needed: <a href="${P.az}" target="_blank" rel="noopener"><b>📇 Subject index A–Z</b></a> · <a href="${P.sos}" target="_blank" rel="noopener"><b>🆘 Emergency finder</b></a></p>`;
  $('libout').innerHTML = html ? jump + `<div class="openall"><button class="link" data-all="1">Open all</button> · <button class="link" data-all="0">Close all</button>${filtering ? ` <span class="meta">${items.length} match${items.length === 1 ? '' : 'es'}</span>` : ''}</div>` + html
    : '<p class="meta">Nothing matches. Try fewer or shorter words.</p>';
  if (filtering) $('libout').querySelectorAll('details').forEach(d => d.dataset.filtering = '1');
}
const GUIDE_CARDS = { // guide cards, by shelf (same order as the Library tab)
  start: [['sos', '🆘 Emergency finder', 'Something happening right now? Bleeding, not breathing, snakebite, a baby coming, fire, fallout — straight to the right page.'],
    ['az', '📇 Subject index A–Z', 'Look anything up like the index at the back of a book — no search or AI needed.'],
    ['conv', '🔢 Unit converter & calculators', 'Any measurement converted; area, concrete, roof pitch, tanks, rainwater, water pressure, volts and watts, batteries, wire size, recipes, fuel mix, doses.'],
    ['iv', '🏔️ Illinois Valley quick reference', 'Alerts, weather radio, ham repeaters, local contacts, evacuation levels, frost dates, hunting units, key distances.'],
    ['device', '📱 Start on any device', 'Run the library on a computer, an old phone or tablet, or share it to iPhones over Wi-Fi.'],
    ['walk', '🥾 Routes: walk, bike, drive', 'From Cave Junction to 359 Oregon and N. California cities: walking days, bicycle riding hours and normal driving times, with turn-by-turn directions and GPS tracks.'],
    ['all', '📚 Everything on the drive', 'The full index of every file, archive and program.']],
  health: [['fieldcare', '🩹 Injuries, no help coming', 'Bleeding, wounds, burns, fractures, snakebite, nursing someone for weeks'],
    ['med', '💊 Medical & found medicines', 'What medical books there are and how to use found or expired medicines safely.'],
    ['birth', '👶 Childbirth & small kids', 'Birth with no hospital, newborn care, child illness, teaching kids at home'],
    ['sanit', '🧼 Sanitation & disease', 'Toilets with no sewer, handwashing, laundry, stopping outbreaks, safe burial'],
    ['pill', '🔍 Pill identifier', 'Identify a loose pill by the code printed on it — about 32,000 US pills.']],
  water: [['purify', '🚰 Water purification', 'Settling, cloth, alum and ash, biosand and clay-pot filters, charcoal done right, boiling, bleach and pool shock, sunlight, solar stills, tests.'],
    ['wells', '💧 Wells, pumps, springs & cisterns', 'Your well records, running the well pump on a generator or solar, hand and rope pumps, ram pumps, spring boxes, cisterns, testing.']],
  food: [['scarce', '🥫 Food when it is scarce', 'A year of food, fair rationing, deficiency diseases, babies, foraging calendar'],
    ['food', '🌾 Food from scratch', 'Acorn and grain flour, masa, sourdough, salt, maple syrup, lard — then bread, tortillas, pasta, hardtack and beans.'],
    ['preserve', '🫙 Preserving food', 'Safe canning at our elevation, drying, smoking, curing, fermenting, eggs'],
    ['cellar', '🥔 Root cellars & food storage', 'Cellars, pits and buried barrels for our warm ground, what each crop needs, cooling without power, sun drying, curing meat, kraut and eggs.'],
    ['seeds', '🌱 Your seed bank', 'Planting calendar for all 39 kit varieties, storing and testing seed, which varieties cross, saving seed from fruits, grafting fruit trees.'],
    ['mush', '🍄 Mushrooms', 'Local deadly mushrooms and their look-alikes, spore prints, what to do after a bad meal, good edibles, drying, and growing shiitake and oysters.'],
    ['huntfish', '🦌 Hunting, trapping & fishing', 'Local game, field dressing in hot weather, snares, nets, game diseases']],
  animals: [['smallstock', '🐇 Rabbits & chickens', 'Meat and eggs on little bought feed: housing, breeding, hatching, butchering'],
    ['dairy', '🐐 Goats, dairy & bees', 'Milk goats, butter, cheese and homemade rennet, beekeeping and swarms'],
    ['horse', '🐴 Horses, mules & draft animals', 'Choosing, feeding and watering, teeth and worms, hoof care and shoeing, saddling and riding, packing, and harness work.']],
  shelter: [['shelter', '🏠 Shelter & building', 'Roof leaks, one warm room, rot, log and earth building, quake and fire hardening'],
    ['natural', '🧱 Natural building', 'Cob, straw bale, light clay, hempcrete, earth and lime plasters, making lime, thatch'],
    ['firewood', '🪵 Firewood', 'Heat value of local trees, how much you need, felling and bucking safely, splitting, drying in a wet climate, chimneys, ashes, coppicing.'],
    ['offgrid', '☀️ Off-grid power', 'Solar sizing for our sun, salvaged panels and batteries, wiring safely, creek hydro'],
    ['fuel', '⛽ Fuel: storing, reviving, finding', 'How long gas and diesel keep, testing and rescuing old fuel, diesel care, and pumping fuel from station tanks, drums and vehicles with no power.'],
    ['eng', '🔧 Engines, motors & generators', 'Why a small engine will not start, carburetors, chainsaw filing, generator care, testing and rewinding motors, and turning motors into generators.']],
  making: [['math', '📐 Practical math & measuring', 'Measuring with no tools, square corners, area and volume, slopes and roof pitch, heights and distances, levers, electricity and water math.'],
    ['md', '🧰 Make-Do household guide', 'Cleaners, laundry soap, tooth powder, fire starters, oil lamps, glue, mending, plumbing, electronics repair and salvage.'],
    ['smith', '⚒️ Blacksmithing & hand tools', 'A simple forge, which scrap steel to use, heat colors, hardening and tempering, making chisels, tongs and knives, axe handles and sharpening.'],
    ['clothing', '🧵 Clothing, leather & shoes', 'Dressing for wet winters, mending, wool to yarn, tanning, shoe repair'],
    ['bikes', '🚲 Bicycles & carts', 'Hauling without fuel: loads, trailers, handcarts, bike repair with few tools']],
  comms: [['radio', '📻 Emergency radio guide', 'How ham, CB, GMRS and shortwave work, and emergency communication.'],
    ['signals', '📡 Signals & Morse code', 'Morse by ear, signal mirrors, ground-to-air codes, runners and message forms'],
    ['nav', '🧭 Navigation & weather', 'Map and compass, finding north without one, reading the sky, lightning'],
    ['community', '🤝 Community & barter', 'Organizing neighbors, fair trade, keeping watch, settling disputes'],
    ['defense', '🛡️ Home & property protection', 'Defensive only: not being a target, doors and locks, lighting and fences, early warning, a safe room, watch rosters, the law on self-defense.']],
  disaster: [['expect', '⏳ What to expect: scenarios & timelines', 'Wildfire, the big quake, storms, heat, long blackouts, pandemic, shortages, EMP, fallout — what happens hour by hour, week by week, and what to do.'],
    ['nuke', '☢️ Nuclear fallout', 'Where to shelter, how long (the 7-10 rule), shielding, potassium iodide doses, decontamination, food, water and livestock.'],
    ['emp', '⚡ EMP, solar storms & Faraday cages', 'What tests really showed, unplugging, building and testing a Faraday container, solar-storm warnings, checking and repairing gear after.']],
};
function guidePaths() {
  return mode === 'drive'
    ? { iv: '/lib/Southern-Oregon/ILLINOIS-VALLEY-START-HERE.html', md: '/lib/Southern-Oregon/MAKE-DO-HOUSEHOLD-GUIDE.html', food: '/lib/Southern-Oregon/FOOD-FROM-SCRATCH-GUIDE.html', clothing: '/lib/Southern-Oregon/CLOTHING-LEATHER-GUIDE.html', birth: '/lib/Southern-Oregon/CHILDBIRTH-CHILDREN-GUIDE.html', dairy: '/lib/Southern-Oregon/GOATS-DAIRY-BEES-GUIDE.html', huntfish: '/lib/Southern-Oregon/HUNTING-TRAPPING-FISHING-GUIDE.html', preserve: '/lib/Southern-Oregon/PRESERVING-FOOD-GUIDE.html', offgrid: '/lib/Southern-Oregon/OFF-GRID-POWER-GUIDE.html', sanit: '/lib/Southern-Oregon/SANITATION-GUIDE.html', natural: '/lib/Southern-Oregon/NATURAL-BUILDING-GUIDE.html', smallstock: '/lib/Southern-Oregon/RABBITS-CHICKENS-GUIDE.html', shelter: '/lib/Southern-Oregon/SHELTER-BUILDING-GUIDE.html', bikes: '/lib/Southern-Oregon/BICYCLES-CARTS-GUIDE.html', community: '/lib/Southern-Oregon/COMMUNITY-BARTER-GUIDE.html', fieldcare: '/lib/Southern-Oregon/FIELD-CARE-GUIDE.html', scarce: '/lib/Southern-Oregon/FOOD-SECURITY-GUIDE.html', nav: '/lib/Southern-Oregon/NAVIGATION-WEATHER-GUIDE.html', signals: '/lib/Southern-Oregon/SIGNALS-MORSE-GUIDE.html', firewood: '/lib/Southern-Oregon/FIREWOOD-GUIDE.html', purify: '/lib/Southern-Oregon/WATER-PURIFICATION-GUIDE.html', wells: '/lib/Southern-Oregon/WATER-WELLS-GUIDE.html', emp: '/lib/Southern-Oregon/EMP-GUIDE.html', seeds: '/lib/Southern-Oregon/SEED-BANK-GUIDE.html', cellar: '/lib/Southern-Oregon/ROOT-CELLAR-GUIDE.html', horse: '/lib/Southern-Oregon/HORSE-GUIDE.html', fuel: '/lib/Southern-Oregon/FUEL-GUIDE.html', smith: '/lib/Southern-Oregon/BLACKSMITHING-GUIDE.html', mush: '/lib/Southern-Oregon/MUSHROOM-GUIDE.html', nuke: '/lib/Southern-Oregon/NUCLEAR-FALLOUT-GUIDE.html', eng: '/lib/Southern-Oregon/ENGINES-AND-MOTORS-GUIDE.html', med: '/lib/Medical/READ-ME-FIRST.html', radio: '/lib/Manuals/Radio-Communications/RADIO-GUIDE.html', pill: '/lib/Medical/Pill-Identifier/PILL-IDENTIFIER.html', walk: '/lib/Southern-Oregon/Walking-Routes/WALKING-ROUTES.html', device: '/lib/START-ON-ANY-DEVICE.html', expect: '/lib/Southern-Oregon/WHAT-TO-EXPECT-GUIDE.html', defense: '/lib/Southern-Oregon/HOME-DEFENSE-GUIDE.html', conv: '/lib/UNIT-CONVERTER.html', math: '/lib/Southern-Oregon/PRACTICAL-MATH-GUIDE.html', sos: '/lib/EMERGENCY-FINDER.html', az: '/lib/SUBJECT-INDEX.html', all: '/lib/README.html' }
    : { iv: 'pages/ILLINOIS-VALLEY-START-HERE.html', md: 'pages/MAKE-DO-HOUSEHOLD-GUIDE.html', food: 'pages/FOOD-FROM-SCRATCH-GUIDE.html', clothing: 'pages/CLOTHING-LEATHER-GUIDE.html', birth: 'pages/CHILDBIRTH-CHILDREN-GUIDE.html', dairy: 'pages/GOATS-DAIRY-BEES-GUIDE.html', huntfish: 'pages/HUNTING-TRAPPING-FISHING-GUIDE.html', preserve: 'pages/PRESERVING-FOOD-GUIDE.html', offgrid: 'pages/OFF-GRID-POWER-GUIDE.html', sanit: 'pages/SANITATION-GUIDE.html', natural: 'pages/NATURAL-BUILDING-GUIDE.html', smallstock: 'pages/RABBITS-CHICKENS-GUIDE.html', shelter: 'pages/SHELTER-BUILDING-GUIDE.html', bikes: 'pages/BICYCLES-CARTS-GUIDE.html', community: 'pages/COMMUNITY-BARTER-GUIDE.html', fieldcare: 'pages/FIELD-CARE-GUIDE.html', scarce: 'pages/FOOD-SECURITY-GUIDE.html', nav: 'pages/NAVIGATION-WEATHER-GUIDE.html', signals: 'pages/SIGNALS-MORSE-GUIDE.html', firewood: 'pages/FIREWOOD-GUIDE.html', purify: 'pages/WATER-PURIFICATION-GUIDE.html', wells: 'pages/WATER-WELLS-GUIDE.html', emp: 'pages/EMP-GUIDE.html', seeds: 'pages/SEED-BANK-GUIDE.html', cellar: 'pages/ROOT-CELLAR-GUIDE.html', horse: 'pages/HORSE-GUIDE.html', fuel: 'pages/FUEL-GUIDE.html', smith: 'pages/BLACKSMITHING-GUIDE.html', mush: 'pages/MUSHROOM-GUIDE.html', nuke: 'pages/NUCLEAR-FALLOUT-GUIDE.html', eng: 'pages/ENGINES-AND-MOTORS-GUIDE.html', med: 'pages/Medical-READ-ME-FIRST.html', radio: 'pages/RADIO-GUIDE.html', pill: 'tools/pill-identifier/PILL-IDENTIFIER.html', walk: 'tools/walking-routes/WALKING-ROUTES.html', device: 'pages/START-ON-ANY-DEVICE.html', expect: 'pages/WHAT-TO-EXPECT-GUIDE.html', defense: 'pages/HOME-DEFENSE-GUIDE.html', conv: 'pages/UNIT-CONVERTER.html', math: 'pages/PRACTICAL-MATH-GUIDE.html', sos: 'pages/EMERGENCY-FINDER.html', az: 'pages/SUBJECT-INDEX.html' };
}
function renderTools() {
  const P = guidePaths(), T = GUIDE_CARDS;
  const card = ([k, t, d]) => `<a class="tool" href="${P[k]}" target="_blank" rel="noopener"><b>${t}</b><span>${d}</span></a>`;
  const n = Object.values(T).flat().filter(([k]) => P[k]).length;
  $('toolgrid').innerHTML = `<p class="meta">${n} guides and tools, grouped like the library. Tap a heading to open it. <button class="link" data-all="1">Open all</button> · <button class="link" data-all="0">Close all</button></p>` +
    SHELVES.filter(([k]) => T[k] && T[k].some(([g]) => P[g])).map(([k, icon, name, blurb]) => {
      const list = T[k].filter(([g]) => P[g]);
      return `<details class="shelf" data-k="tools:${k}"${isOpen('tools:' + k, k === 'start') ? ' open' : ''}><summary><span class="ic">${icon}</span><span class="nm">${esc(name)} <span class="n">${list.length}</span><small>${list.map(c => esc(c[1].replace(/^\S+\s/, ''))).join(' · ')}</small></span></summary><div class="grid shelfbody">${list.map(card).join('')}</div></details>`;
    }).join('');
}
