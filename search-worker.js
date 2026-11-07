// In-browser search: loads the passage shards listed in data/manifest.json and ranks
// passages with BM25. Runs in a Web Worker so the page stays responsive.
const STOP = new Set(`a about above after again against all am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has have having he her here
hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once
only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves
then there these they this those through to too under until up very was we were what when where which while who whom
why will with would you your yours yourself yourselves also may might must shall get got use used using one two way ways
thing things like make made tell know need want please much many`.split(/\s+/));
function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}
function tokenize(s) {
  const out = [];
  for (const w of s.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w.length >= 2 && !STOP.has(w)) out.push(stem(w));
  return out;
}
let docs = [], chunks = [], post = new Map(), lens = [], avg = 0, titleTok = [], ready = false, full = false;
let shardsLoaded = 0, shardsTotal = 0, totalToks = 0;
// Index each shard as soon as it arrives, so search works after the first one. The first shards
// ("light" in the manifest) hold our guides plus every document's title and description; page text
// follows. The page asks only for the light part when it opens, and for the rest ('more') when someone
// starts a question: the full index takes hundreds of MB, and phones crash a page that runs short.
// Each posting is one number, passage * 256 + count, which keeps the index about half the size.
let man = null, base = '', loading = null, moreP = null;
async function loadShards(upto) {
  while (shardsLoaded < upto) {
    const arr = await (await fetch(base + 'data/' + man.shards[shardsLoaded])).json();
    for (const c of arr) {
      const i = chunks.length; chunks.push(c);
      const toks = tokenize(c[2]); const tf = new Map();
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      for (const [t, n] of tf) { let p = post.get(t); if (!p) post.set(t, p = []); p.push(i * 256 + Math.min(n, 255)); }
      lens[i] = toks.length; totalToks += toks.length;
    }
    avg = totalToks / Math.max(1, chunks.length);
    shardsLoaded++; ready = true;
    postMessage({ type: 'progress', loaded: shardsLoaded, total: shardsTotal, docs: docs.length, light: shardsLoaded <= lightN });
  }
}
let lightN = 1;
async function load(b) {
  base = b;
  man = await (await fetch(base + 'data/manifest.json', { cache: 'no-cache' })).json();
  docs = await (await fetch(base + 'data/' + man.docs)).json();
  titleTok = docs.map(d => new Set(tokenize(d.t + ' ' + d.f)));
  shardsTotal = man.shards.length; lightN = Math.min(man.light || shardsTotal, shardsTotal);
  await loadShards(lightN);
  postMessage({ type: 'light', docs: docs.length, loaded: shardsLoaded, total: shardsTotal });
}
async function loadMore() {
  await loadShards(shardsTotal);
  full = true;
  postMessage({ type: 'ready', docs: docs.length, chunks: chunks.length, built: man.built });
}
function snippet(text, terms, width = 45) {
  const w = text.split(/\s+/); if (w.length <= width) return text;
  let best = 0, bestN = -1;
  for (let i = 0; i + width <= w.length; i += 5) {
    let n = 0; for (const x of w.slice(i, i + width)) for (const t of tokenize(x)) if (terms.has(t)) n++;
    if (n > bestN) { best = i; bestN = n; }
  }
  return (best > 0 ? '… ' : '') + w.slice(best, best + width).join(' ') + (best + width < w.length ? ' …' : '');
}
// Other forms of a word that the library uses: purify ~ purification, wire ~ wiring (stem "wir").
// They count for less than the word itself.
function isVariant(v, t) {
  if (v === t + 'e' || t === v + 'e') return true;
  if (v[0] !== t[0] || v.length < 5 || t.length < 5) return false;
  let k = 0; while (k < v.length && k < t.length && v[k] === t[k]) k++;
  return k >= 5 && t.length - k <= 1 && v.length - k <= 7;   // the asked word nearly all there: not starter ~ start
}
// Everyday words people ask with -> the words the library uses. They count for less than the asked word.
const SAID = {
  purify: 'purification disinfect disinfection boil filter germ', purification: 'disinfect disinfection boil germ',
  cut: 'wound laceration bleeding', wound: 'cut laceration', bleed: 'hemorrhage tourniquet pressure',
  vomit: 'vomiting nausea rehydration', puke: 'vomiting nausea', diarrhea: 'dysentery rehydration', dehydration: 'rehydration ors',
  poop: 'feces latrine toilet', toilet: 'latrine outhouse privy sanitation', bathroom: 'latrine toilet', pee: 'urine',
  wire: 'awg gauge wiring', panel: 'array pv module', creek: 'stream brook', stream: 'creek',
  fallout: 'radiation', radiation: 'fallout', medicine: 'drug medication', pill: 'drug medication tablet',
  deer: 'venison', venison: 'deer', snakebite: 'rattlesnake snake bite venom antivenom', snake: 'rattlesnake', baby: 'infant newborn', birth: 'delivery labor childbirth',
  chicken: 'hen poultry', hen: 'chicken poultry', gas: 'gasoline fuel', emp: 'electromagnetic pulse', faraday: 'shield shielding',
  fridge: 'refrigerator cooler', flu: 'influenza', tooth: 'dental teeth', teeth: 'dental tooth',
};
const SYN = new Map(Object.entries(SAID).map(([k, v]) => [stem(k), tokenize(v)]));
function variants(t) { const out = []; for (const v of post.keys()) if (v !== t && isVariant(v, t)) out.push(v); return out; }
const headTok = new Map();   // guide section id -> its heading's words
const headWords = id => { let h = headTok.get(id); if (!h) headTok.set(id, h = new Set(tokenize(id.replace(/-/g, ' ')))); return h; };
function search(q, n) {
  const terms = [...new Set(tokenize(q))]; if (!terms.length || !ready) return [];
  const N = chunks.length, scores = new Map(), k1 = 1.2, b = 0.75;
  const weighted = terms.map(t => [t, 1]), have = new Set(terms);
  const add = v => { if (!have.has(v)) { have.add(v); weighted.push([v, 0.4]); } };
  for (const t of terms) { for (const v of variants(t)) add(v); for (const v of SYN.get(t) || []) add(v); }
  const also = [...have];   // the asked words plus their other forms and everyday equivalents
  for (const [t, wt] of weighted) {
    const p = post.get(t); if (!p) continue;
    const df = p.length, idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (let i = 0; i < p.length; i++) {
      const c = p[i] >>> 8, tf = p[i] & 255;
      scores.set(c, (scores.get(c) || 0) + wt * idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * lens[c] / avg)));
    }
  }
  const set = new Set(terms), all = [];
  // a word of the question (or another form of it) in a title or a guide section's heading
  const hitsIn = h => { let k = 0; for (const t of terms) if (h.has(t) || [...h].some(x => isVariant(x, t) || (SYN.get(t) || []).includes(x))) k++; return k; };
  const titleHits = new Map();
  for (const [c, s] of scores) {
    const d = chunks[c][0]; let hits = titleHits.get(d); if (hits === undefined) titleHits.set(d, hits = hitsIn(titleTok[d]));
    // a guide section whose heading has the question's words ("How long to stay in" for "how long ... fallout")
    const sec = chunks[c][3], head = sec ? hitsIn(headWords(sec)) : 0;
    all.push([c, s * (1 + 0.25 * hits) * (1 + 0.3 * head) * (docs[d].w || 1)]);
  }
  all.sort((a, b) => b[1] - a[1]);
  // the passage that follows (same document, page and guide section), minus the words the two share,
  // so the AI can read on when the answer runs past the end of this one
  const same = (x, y) => y && y[0] === x[0] && y[1] === x[1] && (y[3] || '') === (x[3] || '');
  const overlap = (a, b) => { for (let k = Math.min(60, a.length, b.length); k >= 5; k--) if (a.slice(-k).join(' ') === b.slice(0, k).join(' ')) return k; return 0; };
  const after = c => { const x = chunks[c], y = chunks[c + 1]; if (!same(x, y)) return ''; const b = y[2].split(' '); return b.slice(overlap(x[2].split(' '), b)).join(' '); };
  const before = c => { const x = chunks[c], y = chunks[c - 1]; if (!same(x, y)) return ''; const a = y[2].split(' '); return a.slice(0, a.length - overlap(a, x[2].split(' '))).join(' '); };
  const per = new Map(), seen = new Set(), out = [], later = [];
  for (const [c, s] of all) {
    if (out.length >= n) break;
    const [d, page, text, sec] = chunks[c], key = d + '|' + (sec || page);
    if ((per.get(d) || 0) >= 2 || seen.has(key)) continue;
    if (later.length < n && notReading(text)) { later.push([c, s]); continue; }
    per.set(d, (per.get(d) || 0) + 1); seen.add(key);
    const doc = docs[d];
    out.push({ kind: 'doc', title: doc.t, where: doc.f.replace(/\\/g, ' / ') + (page > 0 ? ' — page ' + page : ''),
      link: doc.u + (sec ? '#' + sec : page > 0 && doc.pdf ? '#page=' + page : ''), snippet: snippet(text, set), text, more: after(c), prev: before(c),
      open: doc.o ? 1 : 0, score: s });
  }
  for (const [c, s] of later) {   // only if nothing better was found
    if (out.length >= n) break;
    const [d, page, text] = chunks[c], doc = docs[d];
    out.push({ kind: 'doc', title: doc.t, where: doc.f.replace(/\\/g, ' / ') + (page > 0 ? ' — page ' + page : ''),
      link: doc.u + (page > 0 && doc.pdf ? '#page=' + page : ''), snippet: snippet(text, set), text, more: '', open: doc.o ? 1 : 0, score: s });
  }
  return out;
}
// A book's back-of-book index ("cat hole, 2-30, A-38 ...") or a paper's reference list ("Chippaux J-P.
// ... 2017;23:38. doi:...") matches every word but answers nothing.
function notReading(text) {
  const w = text.split(' '); if (w.length < 40) return false;
  let refs = 0, cites = 0;
  for (const x of w) { if (/^[A-Z]?-?\d[\d-]*[,;]$/.test(x)) refs++; if (/^doi:|^\d{4};\d|^\(\d{4}\)[.;,]?$|^al\.,?$/.test(x)) cites++; }
  return refs / w.length > 0.12 || cites / w.length > 0.04;
}
onmessage = async e => {
  const m = e.data;
  if (m.type === 'load') { try { loading = load(m.base); await loading; } catch (err) { postMessage({ type: 'error', message: String(err) }); } }
  else if (m.type === 'more') { try { if (!moreP) moreP = loading.then(loadMore); await moreP; } catch (err) { postMessage({ type: 'error', message: String(err) }); } }
  else if (m.type === 'search') postMessage({ type: 'results', id: m.id, results: search(m.q, m.n), partial: !full, loaded: shardsLoaded, total: shardsTotal });
  else if (m.type === 'docs') postMessage({ type: 'docs', docs });
};
