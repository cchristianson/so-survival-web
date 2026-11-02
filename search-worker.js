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
let docs = [], chunks = [], post = new Map(), lens = [], avg = 0, titleTok = [], ready = false;
async function load(base) {
  const man = await (await fetch(base + 'data/manifest.json', { cache: 'no-cache' })).json();
  docs = await (await fetch(base + 'data/' + man.docs)).json();
  let loaded = 0;
  for (const f of man.shards) {
    const arr = await (await fetch(base + 'data/' + f)).json();
    for (const c of arr) chunks.push(c);
    loaded++; postMessage({ type: 'progress', loaded, total: man.shards.length });
  }
  let total = 0;
  chunks.forEach((c, i) => {
    const toks = tokenize(c[2]); const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, n] of tf) { let p = post.get(t); if (!p) post.set(t, p = []); p.push(i, n); }
    lens[i] = toks.length; total += toks.length;
  });
  avg = total / Math.max(1, chunks.length);
  titleTok = docs.map(d => new Set(tokenize(d.t + ' ' + d.f)));
  ready = true;
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
function search(q, n) {
  const terms = [...new Set(tokenize(q))]; if (!terms.length || !ready) return [];
  const N = chunks.length, scores = new Map(), k1 = 1.2, b = 0.75;
  for (const t of terms) {
    const p = post.get(t); if (!p) continue;
    const df = p.length / 2, idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (let i = 0; i < p.length; i += 2) {
      const c = p[i], tf = p[i + 1];
      scores.set(c, (scores.get(c) || 0) + idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * lens[c] / avg)));
    }
  }
  const set = new Set(terms), all = [];
  for (const [c, s] of scores) {
    const d = chunks[c][0]; let hits = 0; for (const t of terms) if (titleTok[d].has(t)) hits++;
    all.push([c, s * (1 + 0.25 * hits) * (docs[d].w || 1)]);
  }
  all.sort((a, b) => b[1] - a[1]);
  const per = new Map(), out = [];
  for (const [c, s] of all) {
    if (out.length >= n) break;
    const [d, page, text] = chunks[c]; if ((per.get(d) || 0) >= 2) continue; per.set(d, (per.get(d) || 0) + 1);
    const doc = docs[d];
    out.push({ kind: 'doc', title: doc.t, where: doc.f.replace(/\\/g, ' / ') + (page > 0 ? ' — page ' + page : ''),
      link: doc.u + (page > 0 && doc.pdf ? '#page=' + page : ''), snippet: snippet(text, set), text, open: doc.o ? 1 : 0, score: s });
  }
  return out;
}
onmessage = async e => {
  const m = e.data;
  if (m.type === 'load') { try { await load(m.base); } catch (err) { postMessage({ type: 'error', message: String(err) }); } }
  else if (m.type === 'search') postMessage({ type: 'results', id: m.id, results: search(m.q, m.n) });
  else if (m.type === 'docs') postMessage({ type: 'docs', docs });
};
