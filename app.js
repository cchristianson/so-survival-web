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
    $('wikilabel').textContent = 'Include Wikipedia & archives';
    document.querySelector('#tabs [data-tab=setup]').textContent = '⚙️ Settings';
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
  renderStatus(); renderTools(); renderKit(); renderSetup(); loadLibrary(); restoreAnswers();
  openFromHash(); restoreScroll(location.hash.slice(1).split(':')[0] || 'ask');
  addEventListener('pagehide', saveScroll);
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) { $('q').value = q0; ask(); }
}

async function refreshServer() {
  try { server = await (await fetch('api/status')).json(); } catch {}
  renderStatus();
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
function wantFull(force) { if (mode === 'public' && worker && !fullAsked && (force === true || !lowMem())) { fullAsked = true; worker.postMessage({ type: 'more' }); renderStatus(); } }
function stopWorker() {
  if (!worker) return;
  worker.terminate(); worker = null; workerReady = workerSearchable = false; fullAsked = false;
  for (const [, res] of pending) res({ results: [], notReady: true }); pending.clear();
}
const pending = new Map(); let reqId = 0, docsWaiter = null;
// Resolves { results, partial, loaded, total } or { results: [], notReady: true }.
function workerSearch(q, n) {
  if (!worker) { startWorker(); wantFull(); }   // stopped when the page was left (see stopWorker)
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
    // a Raspberry Pi that has slowed itself down (weak power or heat): everything, the AI most, runs slower
    const th = server.throttled > 0 ? server.throttled : 0;
    if (th & 0x10001) h += pill('off', '⚠️ Power too weak', '— the Pi is slowing down. Use a stronger power supply or a shorter, thicker cable');
    else if (th & 0x8000e) h += pill('off', '⚠️ Too hot', '— the Pi is slowing down. Keep the lid open and the can in the shade');
  } else {
    h += pill(navigator.onLine ? 'ready' : 'starting', navigator.onLine ? 'Online' : 'Offline', navigator.onLine ? '' : '— using saved copy');
    h += pill(workerReady || (workerSearchable && !fullAsked) ? 'ready' : 'starting', 'Search', workerReady ? `${workerInfo.docs} documents`
      : workerInfo.error ? 'failed to load' : workerSearchable && !fullAsked ? 'guides ready' : workerSearchable ? `ready, still loading ${workerInfo.progress}` : 'loading…');
    const chosen = store.get('aiModel') && MODELS[store.get('aiModel')];
    h += pill(ai.kind === 'webllm' || chosen ? 'ready' : ai.loading ? 'starting' : 'off', 'AI', ai.kind === 'webllm' ? esc(ai.label) : ai.loading ? 'loading…'
      : chosen ? esc(chosen[2]) + ' — starts when you ask' : 'off — turn on in ⚙️');
  }
  $('status').innerHTML = h;
}

// ------------------------------------------------------------------ tabs & bindings
function bindUI() {
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('section').forEach(s => s.hidden = s.id !== b.dataset.tab);
    try { if (location.hash.slice(1).split(':')[0] !== b.dataset.tab) history.replaceState(history.state, '', '#' + b.dataset.tab); } catch {}
    const top = document.querySelector('header').getBoundingClientRect().bottom + scrollY; if (scrollY > top) scrollTo(0, top);   // the new tab starts at its top (the bar itself stays put)
  });
  document.addEventListener('click', onLinkClick, true);
  const EX = ['How do I purify creek water?', 'Signs of milk fever in a goat', 'How far is Grants Pass on foot?', 'How do I stop bleeding from a deep cut?',
    'How do I can venison safely?', 'How much power can a small creek make?', 'What plants here are poisonous?', 'How do I make soap from wood ash?',
    'How long should I shelter after fallout?', 'How do I tell a chanterelle from a look-alike?',
    'How do I signal a plane for help?', 'How much food does a family need for a year?'];
  $('examples').innerHTML = EX.map(x => `<button class="ex" type="button">${esc(x)}</button>`).join('');
  $('examples').addEventListener('click', e => { if (e.target.classList.contains('ex')) { $('q').value = e.target.textContent; ask(); } });
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
  const box = document.createElement('div'); box.className = 'qa';
  box.innerHTML = `<div class="q">${esc(q)}</div><div class="meta" id="m${id}"><span class="spin"></span>Searching the library…</div><div class="answer" id="a${id}"></div><div class="sources" id="s${id}" hidden></div>`;
  $('out').prepend(box); $('q').value = ''; $('examples').hidden = true;
  document.querySelector('#tabs [data-tab=ask]').click();
  if (box.getBoundingClientRect().top > innerHeight * 0.5) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  saveAnswers();

  // Ask for a few extra encyclopedia articles and keep only those whose title has one of the question's
  // key words and whose text has two (a search for "small creek power" also turns up cartoon characters,
  // and one for bleach in water a fake cure); the library fills any gap.
  const nWiki = useWiki ? Math.max(1, Math.round(n / 3)) : 0, qt = qterms(q), need = Math.min(2, qt.size);
  const shared = s => { let k = 0; for (const x of qt) if (qterms(s).has(x)) k++; return k; };
  const onTopic = s => shared(s.title) >= 1 && shared(s.title + ' ' + (s.text || s.snippet || '')) >= need;
  let docs = [], wiki = [], note = '';
  if (mode === 'drive') {
    [docs, wiki] = await Promise.all([
      fetch('api/search?q=' + encodeURIComponent(q) + '&n=' + n).then(r => r.json()).catch(() => []),
      nWiki ? fetch('api/kiwix?q=' + encodeURIComponent(q) + '&n=' + (nWiki + 2)).then(r => r.json()).catch(() => []) : [],
    ]);
  } else {
    let ws; [ws, wiki] = await Promise.all([workerSearch(q, n), nWiki && navigator.onLine ? wikiSearch(keywords(q) || q, nWiki + 2) : []]);
    docs = ws.results;
    if (ws.notReady) note = ' ⚠️ The library search is still downloading — try again in a minute (needs a connection the first time).';
    else if (ws.partial && lowMem()) note = ' 📱 To save this phone\'s memory, only the guides and book titles were searched. <button class="link" data-full="1">Search every book page too</button>';
    else if (ws.partial) note = ` ⏳ Library still loading (${ws.loaded} of ${ws.total} parts): guides and book titles were searched; ask again in a minute to search inside every page.`;
  }
  // the library first (its guides are written for exactly this), then the encyclopedia articles that fit
  const z = (Array.isArray(wiki) ? wiki : []).filter(onTopic).slice(0, nWiki), d = Array.isArray(docs) ? docs : [];
  const srcs = d.slice(0, Math.max(n - z.length, n - nWiki)).concat(z);
  renderSources(id, srcs);
  const meta = $('m' + id);
  if (!srcs.length) meta.textContent = note ? '' : 'Nothing in the library matched. Try other words (e.g. "bleeding" instead of "cut").';
  else meta.textContent = `${srcs.length} sources found.`;
  meta.innerHTML = esc(meta.textContent) + note;
  const mc = morseAsk(q);
  if (mc) { showMorse(id, mc); meta.textContent = 'Answered from the standard Morse code table (no AI needed).'; saveAnswers(); return; }
  if (!useAI) { showBest(id, srcs, q); saveAnswers(); return; }
  if (mode === 'drive') {
    if (server.llm === 'off') { showBest(id, srcs, q); saveAnswers(); meta.innerHTML += ' <span>' + esc(server.llmError || 'The AI is turned off on this device.') + ' You can change the AI in <a href="#" onclick="document.querySelector(\'[data-tab=setup]\').click();return false">⚙️ Settings</a>.</span>'; return; }
    if (server.llm !== 'ready') { meta.innerHTML = '<span class="spin"></span>Waiting for the AI to finish loading…'; await waitFor(() => server.llm === 'ready' || server.llm === 'off'); }
    if (server.llm === 'ready') await answer(id, q, srcs, 'server');
  } else {
    if (ai.loading || aiStart) { meta.innerHTML = '<span class="spin"></span>Starting the AI (the first answer after opening takes a little longer)…'; await (aiStart || waitFor(() => !ai.loading)); }
    if (ai.kind === 'webllm') await answer(id, q, srcs, 'webllm');
    else showBest(id, srcs, q), meta.innerHTML += ' <span>To get written answers, turn on the AI in <a href="#" onclick="document.querySelector(\'[data-tab=setup]\').click();return false">⚙️ Offline</a>.</span>';
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
      '<button class="retry" type="button">🔄 Try again</button><br><small>The next tries search the guides and book titles only, which uses much less memory.</small>';
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
    <a href="${esc(s.link)}">${s.kind === 'zim' ? '🌐' : '📄'} ${esc(s.title)}</a> <span class="where">${esc(s.where)}</span>
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
  const more = (P.morse ? ` <a href="${P.morse}">📡 Play it as beeps or flashes, or practise sending it</a>.` : '') +
    (P.signals ? ` <a href="${P.signals}#morse-quick-reference-print-this">The whole table, and how to send it by light or sound</a>.` : '');
  $('a' + id).innerHTML = `<div class="best"><div class="bh">📡 “${esc(mc.text)}” in Morse code</div>` +
    `<p style="font:bold 1.35em/1.4 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;overflow-wrap:anywhere">${esc(code)}</p>` +
    `<p>${letters}</p><p class="meta">A dot is short and a dash is three dots long. Leave a short pause between letters, a longer one between words (shown as /).${more}</p></div>`;
}

function showBest(id, srcs, q) {
  const s = srcs.find(x => x.kind === 'doc' && !linkList(x)) || srcs[0]; if (!s) return;
  const qt = qterms(q), i = srcs.indexOf(s) + 1;
  const text = focus(around(s), qt, 110, QUANTITY.test(q));
  const marked = text.split(/([\p{L}\p{N}][\p{L}\p{N}'’-]*)/u)
    .map((p, k) => k % 2 && [...qterms(p)].some(t => qt.has(t)) ? `<mark>${esc(p)}</mark>` : esc(p)).join('');
  $('a' + id).innerHTML = `<div class="best"><div class="bh">📖 Best match: <a href="${esc(s.link)}">${esc(s.title)}</a> <a class="cite" href="#src${id}-${i}">[${i}]</a></div><p>${marked}</p></div>`;
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
  const t0 = Date.now(); let text = '', stopped = false, ctrl = new AbortController();
  const setMeta = (label) => { meta.innerHTML = `<span class="spin"></span>${label} <button class="sec" type="button">Stop</button> <span class="t"></span>`; meta.querySelector('button').onclick = () => { stopped = true; ctrl.abort(); try { ai.engine?.interruptGenerate?.(); } catch {} }; };
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
      const r = await fetch('llm/v1/chat/completions', { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, stream: true, temperature: 0.2, max_tokens: server.tier === 'quick' ? 400 : 700,
          repeat_penalty: 1.1, dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 2 }) });
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
      const stream = await ai.engine.chat.completions.create({ messages, stream: true, temperature: 0.2, max_tokens: 600 });
      for await (const ch of stream) { const piece = ch.choices?.[0]?.delta?.content; if (piece) add(piece); if (stopped) break; }
    }
    meta.textContent = looped ? loopMsg : stopped ? 'Stopped.' : `Answered in ${Math.round((Date.now() - t0) / 1000)} seconds from ${srcs.length} sources. Check the sources before relying on it.`;
  } catch (e) {
    meta.innerHTML = (looped ? esc(loopMsg) : stopped || e.name === 'AbortError' ? 'Stopped.' : esc('The AI could not answer (' + e.message + '). The sources below are still the search results.')) +
      ' <button class="retry" type="button">🔄 Try again</button>';
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
  { const P = guidePaths(); if (P.ammocan) $('vaultguide').href = P.ammocan;   // the ARK Vault card: the guide and 3D model, here or on the drive
    $('vaultmodel').href = mode === 'drive' ? '/lib/AMMO-CAN-MODEL.html' : 'pages/AMMO-CAN-MODEL.html'; }
  if (mode === 'drive') {
    $('webai').hidden = true; $('driveai').hidden = false; $('getkit').hidden = true; loadTiers();
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
  $('libnote').innerHTML = mode === 'drive' ? 'Every book, manual, map and program on this drive, on the same shelves as the guides. Tap a title to open it; Back brings you here.'
    : 'Documents marked <span class="tag">full text</span> are searchable inside; the rest are searchable by title and open on the original publisher’s website (they can’t be republished here). The drive edition has every file.';
  renderLibrary();
}
// The books and the guides share one set of "shelves", in the order you'd reach for them.
// The same groups, in the same order, are in docs/START-HERE.md ("Guides by subject"), which the guide
// pages use for their "Guides › group" bar and Previous / Next links; tools/guide_nav.py --check keeps them in step.
const SHELVES = [
  ['start', '🧭', 'Start here', 'Emergency finder, A–Z index, Illinois Valley quick reference'],
  ['health', '🩹', 'Health & medicine', 'Injuries, recovering from injuries, medicines, childbirth and children, sanitation, garbage and disease'],
  ['water', '💧', 'Water', 'Purifying water, wells, pumps, springs and cisterns'],
  ['food', '🍞', 'Food', 'Food when it is scarce, cooking from scratch, preserving, milk, butter and cheese, root cellars, seeds'],
  ['wild', '🌲', 'Living off the land', 'Hunting, trapping and fishing, wild plants and mushrooms, skills of the valley’s first peoples'],
  ['animals', '🐐', 'Animals', 'Chickens, rabbits, goats, bees, horses and draft animals'],
  ['shelter', '🏠', 'Shelter & building', 'Repairs and building, natural building, mortar, concrete and roads'],
  ['power', '💡', 'Heat, light & power', 'Firewood, fuel, off-grid power, storing energy, candles and lamps, engines and generators'],
  ['making', '🛠️', 'Making & repair', 'Practical math, household make-do, blacksmithing, clothing and leather, paper and ink, electronics'],
  ['travel', '🥾', 'Getting around', 'Travel on foot, bicycles and carts, maps, navigation and weather'],
  ['comms', '📡', 'Radio, community & protection', 'Radio, signals and Morse, organizing neighbors and barter, protecting your home'],
  ['disaster', '🚨', 'Disasters', 'What to expect, wildfire, earthquakes, nuclear fallout, EMP and solar storms'],
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
  const doc = d => `<div class="doc"><a href="${esc(d.u)}">${esc(d.t)}</a>${mode === 'public' && d.o ? '<span class="tag">full text</span>' : ''}<div class="d">${esc(d.d)}</div></div>`;
  const filtering = words.length > 0;
  const html = SHELVES.map(([k, icon, name, blurb]) => {
    const subs = [...shelves.get(k)].sort((a, b) => (rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])));
    if (!subs.length) return '';
    const n = subs.reduce((t, [, ds]) => t + ds.length, 0);
    const inner = subs.length === 1 && !filtering ? subs[0][1].map(doc).join('')
      : subs.map(([g, ds]) => `<details class="sub" data-k="lib:${esc(k)}:${esc(g)}"${filtering || isOpen('lib:' + k + ':' + g, false) ? ' open' : ''}><summary>${esc(g)} <span class="n">${ds.length}</span></summary>${ds.map(doc).join('')}</details>`).join('');
    return `<details class="shelf" data-k="lib:${k}"${filtering || isOpen('lib:' + k, false) ? ' open' : ''}><summary><span class="ic">${icon}</span><span class="nm">${esc(name)} <span class="n">${n}</span><small>${esc(blurb)}</small></span></summary><div class="shelfbody">${inner}</div></details>`;
  }).join('');
  $('libout').innerHTML = html ? `<div class="openall"><button class="link" data-all="1">Open all</button> · <button class="link" data-all="0">Close all</button>${filtering ? ` <span class="meta">${items.length} match${items.length === 1 ? '' : 'es'}</span>` : ''}</div>` + html
    : '<p class="meta">Nothing matches. Try fewer or shorter words.</p>';
  if (filtering) $('libout').querySelectorAll('details').forEach(d => d.dataset.filtering = '1');
  restoreScroll('library');
}
// the Tools tab: calculators and other things you use rather than read
const TOOL_CARDS = [['calc', '🧮 Calculator', 'Everyday sums on a big screen: + − × ÷, percent, and a history of your answers.'],
  ['sci', '🔬 Scientific calculator', 'Sine, cosine and tangent, logs, powers and roots, π, n!, degrees or radians.'],
  ['conv', '🔢 Unit converter & calculators', 'Any measurement converted; area, concrete, roof pitch, tanks, rainwater, water pressure, volts and watts, batteries, wire size, recipes, fuel mix, doses.'],
  ['morse', '📡 Morse code', 'Words into Morse and back, played as beeps or as flashes of the screen at any speed, a key to practise sending, and the whole code.'],
  ['pill', '🔍 Pill identifier', 'Identify a loose pill by the code printed on it — about 32,000 US pills.'],
  ['plantid', '📷 Identify a plant or mushroom', 'Take a photo: the offline AI names it from the plants and mushrooms of the area, marks the poisonous ones, and opens the guides about it.'],
  ['walk', '🥾 Routes: walk, bike, drive', 'From Cave Junction to 359 Oregon and N. California cities: walking days, bicycle riding hours and normal driving times, with turn-by-turn directions and GPS tracks.']];
function renderKit() {
  const P = guidePaths();
  $('kitgrid').innerHTML = (mode === 'drive' ? PHOTO_CARD : '') +   // family photos: only where the library program runs
    TOOL_CARDS.filter(([k]) => P[k]).map(([k, t, d]) => `<a class="tool" href="${P[k]}"><b>${t}</b><span>${d}</span></a>`).join('');
}
const GUIDE_CARDS = { // guide cards, by shelf (same groups and order as SHELVES and docs/START-HERE.md)
  start: [['sos', '🆘 Emergency finder', 'Something happening right now? Bleeding, not breathing, snakebite, a baby coming, fire, fallout — straight to the right page.'],
    ['az', '📇 Subject index A–Z', 'Look anything up like the index at the back of a book — no search or AI needed.'],
    ['iv', '🏔️ Illinois Valley quick reference', 'Alerts, weather radio, ham repeaters, local contacts, evacuation levels, frost dates, hunting units, key distances.']],
  health: [['fieldcare', '🩹 Injuries, no help coming', 'Bleeding, wounds, burns, fractures, snakebite, nursing someone for weeks'],
    ['rehab', '🦵 Recovering from injuries', 'Rehab without a clinic: when to move, exercises for every joint, sprains, backs and shoulders, getting up after bed rest, crutches and walkers you can make.'],
    ['med', '💊 Medical & found medicines', 'What medical books there are and how to use found or expired medicines safely.'],
    ['birth', '👶 Childbirth & small kids', 'Birth with no hospital, newborn care, child illness, teaching kids at home'],
    ['sanit', '🧼 Sanitation, waste & disease', 'Toilets with no sewer, handwashing, laundry, garbage and compost, stopping outbreaks, safe burial']],
  water: [['purify', '🚰 Water purification', 'Settling, cloth, alum and ash, biosand and clay-pot filters, charcoal done right, boiling, bleach and pool shock, sunlight, solar stills, tests.'],
    ['wells', '💧 Wells, pumps, springs & cisterns', 'Your well records, running the well pump on a generator or solar, hand and rope pumps, ram pumps, spring boxes, cisterns, testing.']],
  food: [['scarce', '🥫 Food when it is scarce', 'A year of food, fair rationing, deficiency diseases, babies, foraging calendar'],
    ['food', '🌾 Food from scratch', 'Acorn and grain flour, masa, sourdough, salt, maple syrup, lard — then bread, tortillas, pasta, hardtack and beans.'],
    ['preserve', '🫙 Preserving food', 'Safe canning at our elevation, drying, smoking, curing, fermenting, eggs'],
    ['cellar', '🥔 Root cellars & food storage', 'Cellars, pits and buried barrels for our warm ground, what each crop needs, cooling without power, sun drying, curing meat, kraut and eggs.'],
    ['dairy', '🧀 Milk, butter & cheese', 'Clean milk, cooling with no fridge, butter and ghee, yogurt and kefir, soft and hard cheeses, homemade rennet.'],
    ['seeds', '🌱 Your seed bank', 'Planting calendar for all 39 kit varieties, storing and testing seed, which varieties cross, saving seed from fruits, grafting fruit trees.']],
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
    ['storage', '🔋 Storing energy without batteries', 'Why gravity batteries hold so little, and what works: water tanks, hot water, masonry heaters, ice and cold water, timing the work.'],
    ['heatpower', '♨️ Heat into work & power', 'Stove-top generators for phones and lights, small steam engines and boiler safety, hot-air engines, fridges that run on a flame, and the honest numbers.'],
    ['light', '🕯️ Candles, lamps & lamp oil', 'Dipped and moulded candles, wicks, rushlights, which oils burn, homemade lamps, more light from a small flame, and fire safety.'],
    ['eng', '🔧 Engines, motors & generators', 'Why a small engine will not start, carburetors, chainsaw filing, generator care, testing and rewinding motors, turning motors into generators, and reusing a generator for water or wind when the fuel is gone.']],
  making: [['math', '📐 Practical math & measuring', 'Measuring with no tools, square corners, area and volume, slopes and roof pitch, heights and distances, levers, electricity and water math.'],
    ['md', '🧰 Make-Do household guide', 'Cleaners, laundry soap, tooth powder, fire starters, oil lamps, glue, mending, plumbing, electronics repair and salvage.'],
    ['smith', '⚒️ Blacksmithing & hand tools', 'A simple forge, which scrap steel to use, heat colors, hardening and tempering, making chisels, tongs and knives, axe handles and sharpening.'],
    ['clothing', '🧵 Clothing, leather & shoes', 'Dressing for wet winters, mending, wool to yarn, tanning, shoe repair'],
    ['paper', '📜 Paper, ink & toilet paper', 'Making paper by hand, iron-gall and soot inks, pens, pencils and slates, and toilet paper alternatives with safe washing.']],
  travel: [['onfoot', '🎒 On foot: backpacking & travel', 'Planning a trip, how much to carry, packs, feet and blisters, water and food on the move, safe camps, river crossings, snow, and staying safe on the road.'],
    ['bikes', '🚲 Bicycles & carts', 'Hauling without fuel: loads, trailers, handcarts, bike repair with few tools'],
    ['nav', '🧭 Navigation & weather', 'Map and compass, finding north without one, reading the sky, lightning']],
  comms: [['radio', '📻 Emergency radio guide', 'How ham, CB, GMRS and shortwave work, and emergency communication.'],
    ['signals', '📡 Signals & Morse code', 'Morse by ear, signal mirrors, ground-to-air codes, runners and message forms'],
    ['community', '🤝 Community & barter', 'Organizing neighbors, fair trade, keeping watch, settling disputes'],
    ['defense', '🛡️ Home & property protection', 'Defensive only: not being a target, doors and locks, barriers and fences, early warning, a safe room, watch rosters, the law on self-defense.']],
  disaster: [['expect', '⏳ What to expect: scenarios & timelines', 'Wildfire, the big quake, storms, heat, long blackouts, pandemic, shortages, EMP, fallout — what happens hour by hour, week by week, and what to do.'],
    ['wildfire', '🔥 Wildfire with no fire department', 'Reading fire danger, hardening the house, clearing with hand tools, water with no power, stay or go, the fire front, and the days after.'],
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
  fieldcare: 'FIELD-CARE-GUIDE', rehab: 'REHAB-GUIDE', med: 'Medical-READ-ME-FIRST', birth: 'CHILDBIRTH-CHILDREN-GUIDE', sanit: 'SANITATION-GUIDE',
  purify: 'WATER-PURIFICATION-GUIDE', wells: 'WATER-WELLS-GUIDE',
  scarce: 'FOOD-SECURITY-GUIDE', food: 'FOOD-FROM-SCRATCH-GUIDE', preserve: 'PRESERVING-FOOD-GUIDE', cellar: 'ROOT-CELLAR-GUIDE', seeds: 'SEED-BANK-GUIDE',
  huntfish: 'HUNTING-TRAPPING-FISHING-GUIDE', mush: 'MUSHROOM-GUIDE', native: 'NATIVE-SKILLS-GUIDE',
  rabbits: 'RABBITS-GUIDE', chickens: 'CHICKENS-GUIDE', goats: 'GOATS-GUIDE', bees: 'BEES-GUIDE', horse: 'HORSE-GUIDE', dairy: 'DAIRY-GUIDE',
  ducks: 'DUCKS-GUIDE', geese: 'GEESE-GUIDE', turkeys: 'TURKEYS-GUIDE', sheep: 'SHEEP-GUIDE', pigs: 'PIGS-GUIDE', cattle: 'CATTLE-GUIDE', dogs: 'DOGS-GUIDE',
  shelter: 'SHELTER-BUILDING-GUIDE', natural: 'NATURAL-BUILDING-GUIDE', masonry: 'MASONRY-ROADS-GUIDE',
  firewood: 'FIREWOOD-GUIDE', fuel: 'FUEL-GUIDE', offgrid: 'OFF-GRID-POWER-GUIDE', storage: 'STORING-ENERGY-GUIDE', heatpower: 'HEAT-INTO-POWER-GUIDE', light: 'LIGHTING-GUIDE', eng: 'ENGINES-AND-MOTORS-GUIDE',
  math: 'PRACTICAL-MATH-GUIDE', md: 'MAKE-DO-HOUSEHOLD-GUIDE', smith: 'BLACKSMITHING-GUIDE', clothing: 'CLOTHING-LEATHER-GUIDE', paper: 'PAPER-INK-GUIDE',
  onfoot: 'ON-FOOT-GUIDE', bikes: 'BICYCLES-CARTS-GUIDE', nav: 'NAVIGATION-WEATHER-GUIDE',
  radio: 'RADIO-GUIDE', signals: 'SIGNALS-MORSE-GUIDE', community: 'COMMUNITY-BARTER-GUIDE', defense: 'HOME-DEFENSE-GUIDE',
  expect: 'WHAT-TO-EXPECT-GUIDE', wildfire: 'WILDFIRE-GUIDE', nuke: 'NUCLEAR-FALLOUT-GUIDE', emp: 'EMP-GUIDE',
  stories: 'STORIES-GAMES-GUIDE',
  device: 'START-ON-ANY-DEVICE', ammocan: 'AMMO-CAN-COMPUTER-GUIDE', get: 'GET-THE-LIBRARY', all: 'README',
  calc: 'CALCULATOR', sci: 'CALCULATOR', conv: 'UNIT-CONVERTER', morse: 'MORSE-CODE', pill: 'PILL-IDENTIFIER', walk: 'WALKING-ROUTES', plantid: 'PLANT-ID' };
const DRIVE_AT = { sos: 'EMERGENCY-FINDER.html', az: 'SUBJECT-INDEX.html', med: 'Medical/READ-ME-FIRST.html', radio: 'Manuals/Radio-Communications/RADIO-GUIDE.html',
  device: 'START-ON-ANY-DEVICE.html', ammocan: 'AMMO-CAN-COMPUTER-GUIDE.html', get: null, all: 'README.html',
  calc: 'CALCULATOR.html#basic', sci: 'CALCULATOR.html#sci', conv: 'UNIT-CONVERTER.html', morse: 'MORSE-CODE.html', plantid: 'PLANT-ID.html',
  pill: 'Medical/Pill-Identifier/PILL-IDENTIFIER.html', walk: 'Southern-Oregon/Walking-Routes/WALKING-ROUTES.html' };
const WEB_AT = { all: null, calc: 'pages/CALCULATOR.html#basic', sci: 'pages/CALCULATOR.html#sci',
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
  const card = k => ([g, t, d]) => `<a class="tool" href="${P[g]}" data-shelf="${k}"><b>${t}</b><span>${d}</span></a>`;
  const groups = SHELVES.filter(([k]) => T[k] && T[k].some(([g]) => P[g]));
  $('toolgrid').innerHTML = `<p class="meta">Plain-English guides in ${groups.length} groups. Tap a group to open it; each guide links to the next one in its group. <button class="link" data-all="1">Open all</button> · <button class="link" data-all="0">Close all</button></p>` +
    groups.map(([k, icon, name]) => {
      const list = T[k].filter(([g]) => P[g]);
      return `<details class="shelf" id="g-${k}" data-k="tools:${k}"${isOpen('tools:' + k, k === 'start') ? ' open' : ''}><summary><span class="ic">${icon}</span><span class="nm">${esc(name)} <span class="n">${list.length}</span><small>${list.map(c => esc(c[1].replace(/^\S+\s/, ''))).join(' · ')}</small></span></summary><div class="grid shelfbody">${list.map(card(k)).join('')}</div></details>`;
    }).join('');
}

// ------------------------------------------------------------------ family photos & videos (drive only)
// Pictures and home videos from a USB drive plugged into the device that runs the library (photos.go).
// A card under Tools opens it. #photos is the list of drives (straight into the drive when there is
// only one) and #photos:<drive>:<folder> a folder, so the phone's Back button goes back up the folders.
// The grid shows a few hundred at a time; small previews load as they come into view and are let go
// far out of view, so a folder of thousands doesn't fill a phone's memory. A tap opens the viewer:
// swipe or arrow keys, pinch to zoom, swipe down or tap beside the picture to close, and a slideshow.
const PHOTO_CARD = '<a class="tool" href="#photos"><b>🖼️ Family photos &amp; videos</b><span>Look through the pictures and home videos on a USB drive plugged into the library: folder by folder, full screen, or as a slideshow.</span></a>';
const PH = { info: null, drives: null, drive: null, path: '', key: '', data: null, shown: 0, seq: 0, lists: new Map(), scroll: new Map() };
const PH_CHUNK = 240;
const phJoin = (a, b) => a ? a + '/' + b : b;
const phHash = (id, p) => '#photos:' + id + ':' + (p || '').split('/').map(encodeURIComponent).join('/');
const phURL = (what, f) => `api/photos/${what}?d=${encodeURIComponent(PH.drive.id)}&p=${encodeURIComponent(phJoin(PH.path, f.name))}&v=${f.mod}-${f.size}`;
const phHeic = n => /\.hei[cf]$/i.test(n);
const phCount = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const phLabel = f => `<span class="phlab"><span class="phic">${f.kind === 'video' ? '▶' : '🖼️'}</span><span class="phnm">${esc(f.name)}</span></span>`;

async function showPhotos(raw) {
  const was = !$('photos').hidden;
  if (was && PH.key) PH.scroll.set(PH.key, scrollY);   // to come back to the same place in this folder
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === 'kit'));
  document.querySelectorAll('section').forEach(s => s.hidden = s.id !== 'photos');
  const top = document.querySelector('header').getBoundingClientRect().bottom + scrollY; if (scrollY > top) scrollTo(0, top);
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
    `<a class="phfold" href="${phHash(d.id, '')}"><span class="phfi">💽</span><span class="phdn">${esc(d.name)}${d.size ? `<small>${esc(d.size)}</small>` : ''}</span></a>`).join('') +
    '</div><p><button class="sec" type="button" data-ph="again">🔄 Look again</button> <span class="meta">after plugging in another drive</span></p>';
}

function phNoDrive() {
  const s = PH.info || {}, pi = s.pi, here = s.local;
  const where = pi ? 'one of the Pi’s USB ports' : here ? 'this computer' : 'the computer the library runs on';
  const reader = pi ? 'the Pi' : here ? 'this computer' : 'that computer';
  $('phbody').innerHTML = `<div class="card"><h3 style="margin-top:0">🔌 No photo drive found</h3>
    <p>Plug the drive with the photos into ${where}, wait a few seconds, then tap <b>Look again</b>.</p>
    <p><button class="main" type="button" data-ph="again">🔄 Look again</button></p>
    ${s.os === 'darwin' ? '' : `<p class="meta">Still not there? A drive set up on a Mac in the Mac’s own format (APFS) can’t be read by ${reader}. Copy the photos onto a drive formatted as exFAT: Windows, Macs and the Pi can all read that.</p>`}
    <p class="meta">The library’s own drive isn’t listed here, so keep the photos on a drive of their own.</p></div>`;
}

function phTrouble() {
  $('phbody').innerHTML = '<div class="note">Couldn’t reach the library program. Is it still running? <button class="sec" type="button" data-ph="again">🔄 Look again</button></div>';
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
      $('phbody').innerHTML = `<div class="note">${esc(j.error || 'That folder couldn’t be opened.')} <button class="sec" type="button" data-ph="again">🔄 Look again</button>${path ? ` <a href="${phHash(id, '')}">Top of the drive</a>` : ''}</div>`;
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
  if (!d || many) parts.push(step('#photos', '🖼️ Photos', !d));
  if (d) parts.push(step(phHash(d.id, ''), (many ? '' : '🖼️ ') + esc(d.name), !segs.length));
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
  if (folders.length) h += '<div class="phlist">' + folders.map(f => `<a class="phfold" href="${phHash(PH.drive.id, phJoin(PH.path, f.name))}"><span class="phfi">📁</span><span class="phfn">${esc(f.name)}</span></a>`).join('') + '</div>';
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
    const toPhotos = /^#photos(:|$)/.test(location.hash);
    if (!toPhotos && $('photos').hidden) return;   // the other tabs work as before
    if (!toPhotos && !location.hash.slice(1)) document.querySelector('#tabs [data-tab=ask]').click();
    else openFromHash();
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
  const [tab, grp] = decodeURIComponent(location.hash.slice(1)).split(':');
  if (!tab) return;
  document.querySelector(`#tabs [data-tab="${CSS.escape(tab)}"]`)?.click();
  if (tab === 'tools' && grp) {
    const d = document.getElementById('g-' + grp);
    if (d) { d.open = true; requestAnimationFrame(() => d.scrollIntoView({ block: 'start' })); }
    try { history.replaceState(history.state, '', '#tools:' + grp); } catch {}
  }
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

