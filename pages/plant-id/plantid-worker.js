/* The plant and mushroom identifier, running in the page instead of in the Library Assistant.
 *
 * This is a Web Worker: the picture takes about twenty seconds, and the page has to stay alive
 * while it works. It loads plantid.wasm - the SAME Go the Library Assistant runs, built for the
 * browser - hands it the three files once, then a photo at a time.
 *
 * Messages in:  {cmd:'load'} | {cmd:'id', photo: ArrayBuffer}
 * Messages out: {step:'...'}  progress, in words
 *               {loaded:{...}} | {id:{...}} | {error:'...'}
 */
importScripts('wasm_exec.js');

var started = false, ready = false, queue = [], URLS = null;

function say(m) { postMessage(m); }

function boot() {
  if (started) return;
  started = true;
  var go = new Go();
  say({ step: 'Starting the identifier' });
  WebAssembly.instantiateStreaming(fetch(URLS.wasm), go.importObject).then(function (r) {
    go.run(r.instance);          // never returns: the program waits for work
  }).catch(function (e) {
    // some servers send the wrong type for .wasm; fall back to the slower way
    fetch(URLS.wasm).then(function (r) { return r.arrayBuffer(); }).then(function (b) {
      return WebAssembly.instantiate(b, go.importObject);
    }).then(function (r) { go.run(r.instance); }).catch(function (e2) {
      say({ error: 'the identifier could not start: ' + (e2 && e2.message || e2) });
    });
  });
}

function whenUp(fn) {            // the Go side sets these once it is running
  if (typeof arkPlantLoad === 'function') return fn();
  setTimeout(function () { whenUp(fn); }, 50);
}

function load() {
  boot();
  whenUp(function () {
    say({ step: 'Fetching the picture model (83 MB, once)' });
    var urls = [URLS.model, URLS.emb, URLS.tsv];
    Promise.all(urls.map(function (u) { return fetch(u).then(function (r) {
      if (!r.ok) throw new Error(u + ' is not on this copy of the library');
      return r.arrayBuffer();
    }); })).then(function (b) {
      say({ step: 'Unpacking it' });
      var out = JSON.parse(arkPlantLoad(new Uint8Array(b[0]), new Uint8Array(b[1]), new Uint8Array(b[2])));
      ready = !out.error;
      say({ loaded: out });
      queue.splice(0).forEach(run);
    }).catch(function (e) { say({ error: (e && e.message) || String(e) }); });
  });
}

function run(photo) {
  if (!ready) { queue.push(photo); return; }
  say({ step: 'Looking at the picture' });
  try {
    say({ id: JSON.parse(arkPlantID(new Uint8Array(photo))) });
  } catch (e) {
    say({ error: 'the identifier stopped: ' + ((e && e.message) || e) });
  }
}

onmessage = function (e) {
  if (!e.data) return;
  if (e.data.cmd === 'load') { URLS = e.data.urls; load(); }
  else if (e.data.cmd === 'id') run(e.data.photo);
};
