// The library's map (MAP.html): streets, topo lines, property lines and a stack of layers to switch on and off,
// drawn by MapLibre GL from the map files next to it (see README.md). Works on a phone and on a wide screen:
// one panel does everything (layers, what's here, measuring, pins, printing), a sheet from the bottom on a phone
// and a column on the left on a wide screen.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var http = location.protocol.indexOf('http') === 0;
  // through the Library Assistant (on this device, or shared over Wi-Fi) the page is under /lib/; otherwise it's the website
  var drive = http && location.pathname.indexOf('/lib/') === 0;
  if (drive) document.querySelectorAll('a[data-app]').forEach(function (a) { a.href = a.getAttribute('data-app'); });
  var DATA = new URL(drive ? 'data/' : '../../maps/', location.href).href;
  var say = function (html) { $('msg').innerHTML = html; $('msg').hidden = !html; };
  var store = { get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  if (!http) {
    say('<b>The map needs the library to be running.</b><br>Start the library first (the <b>START</b> file for your device), then open <b>🔧 Tools → 🗺️ Map</b>. A page opened straight from the drive can\'t read the map files.');
    $('tools').hidden = true; return;
  }
  if (!window.maplibregl || !window.WebGLRenderingContext) { say('This browser can\'t draw the map. Try a newer browser (Chrome, Safari, Firefox or Edge).'); return; }

  // Who manages the land (BLM's own codes), in the colours BLM's maps use
  var OWN = { BLM: ['BLM (Bureau of Land Management)', '#fee679'], USFS: ['National Forest', '#a9d18e'], NPS: ['National Park Service', '#b9a3d8'],
    FWS: ['Fish & Wildlife Service', '#7fd1b9'], BIA: ['Tribal / Bureau of Indian Affairs', '#fdb46c'], DOD: ['Military', '#f4b6c2'], COE: ['Army Corps of Engineers', '#f4b6c2'],
    BR: ['Bureau of Reclamation', '#ffd9a0'], ST: ['State of Oregon', '#9fd0ff'], STF: ['State forest', '#9fd0ff'], STP: ['State park', '#9fd0ff'], STL: ['State lands', '#9fd0ff'],
    STW: ['State wildlife area', '#9fd0ff'], LG: ['County or city', '#d7b5e8'], PV: ['Private', ''], PVI: ['Private (timber company)', ''], PVN: ['Private', ''], PVU: ['Private', ''],
    UND: ['Not recorded', ''], WATER: ['Water', ''] };
  var ownName = function (c) { return OWN[c] ? OWN[c][0] : c; };

  // ---- the little round signs for places (drawn from the device's own emoji, so they need no picture files)
  var BADGE = { spring: '💧', fall: '🌊', dam: '🧱', med: '🏥', vet: '🐾', fuel: '⛽', food: '🛒', supply: '🔧', fire: '🚒', police: '🚓', school: '🏫', hall: '🏛️',
    camp: '⛺', air: '✈️', tap: '🚰', wc: '🚻', evac: '🚩', bridge: '🌉', pin: '📌', shared: '📍', gate: '🚧', block: '⛔', tower: '📡', lookout: '🔭' };
  var PLACE = { med: 'Medical', vet: 'Vet', fuel: 'Fuel', food: 'Food store', supply: 'Hardware, feed or repair', fire: 'Fire station', police: 'Police or ranger', school: 'School',
    hall: 'Hall, church, library or post office', camp: 'Camp or recreation site', air: 'Airstrip', tap: 'Drinking water', wc: 'Toilets', evac: 'Evacuation point', bridge: 'Bridge' };
  function addBadge(m, id) {
    var em = BADGE[id.replace(/^b-/, '')]; if (!em || m.hasImage(id)) return;
    var c = document.createElement('canvas'); c.width = c.height = 56; var g = c.getContext('2d');
    g.beginPath(); g.arc(28, 28, 25, 0, 7); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#4a5565'; g.stroke();
    g.font = '30px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(em, 28, 30);
    m.addImage(id, g.getImageData(0, 0, 56, 56), { pixelRatio: 2 });
  }

  // ---- the layers: what the panel lists, in this order. "src" is the layer in the map files it needs (left out of
  // the panel when the area's files don't have it), "layers" the drawn layers it switches, "legend" [colour, words, shape].
  var WF = { nut: ['#8d6e63', 'Nuts and acorns'], berry: ['#7b1fa2', 'Berries'], fruit: ['#d81b60', 'Fruit'], root: ['#ef6c00', 'Roots and bulbs'], green: ['#2e7d32', 'Greens'], mushroom: ['#b08d57', 'Mushrooms'] };
  var MINE = { gold: ['#f5b301', 'Gold'], chrome: ['#607d8b', 'Chromite'], copper: ['#bf5b17', 'Copper'], lime: ['#e0e0e0', 'Limestone (lime)'], clay: ['#a1543f', 'Clay'],
    stone: ['#9e9e9e', 'Stone, sand, gravel'], coal: ['#212121', 'Coal'], metal: ['#455a64', 'Other metals'], mineral: ['#ec407a', 'Other minerals'] };
  var ROAD = { car: ['#2b8a3e', 'open: an ordinary car can drive it'], high: ['#f08c00', 'open, but rough: high clearance'], season: ['#1c7ed6', 'closed part of the year'],
    closed: ['#c92a2a', 'gated or closed to vehicles'], unk: ['#868e96', 'not recorded'] };
  var HAB = { winter: ['#1d4ed8', 'winter gathering ground'], summer: ['#f59e0b', 'summer gathering ground'], major: ['#65a30d', 'here all year, in good numbers'],
    edge: ['#bfe37a', 'here all year, fewer'], town: ['#9ca3af', 'around farms and towns'] };
  var GAME = { deer: ['#a16207', 'Deer'], elk: ['#7c2d12', 'Elk'], bear: ['#111827', 'Black bear'], bird: ['#0e7490', 'Game birds'], small: ['#9333ea', 'Rabbits, hares, squirrels'] };
  var ROCK = { serp: ['#2a9d8f', 'Serpentine and peridotite', 'Thin red soil where little grows. Chromite and nickel are found in it. Dust from some of it holds asbestos: don\'t crush or grind it.'],
    lime: ['#4ea8de', 'Limestone or marble', 'Burned in a kiln it makes lime for mortar, plaster and sweetening soil. Caves and sinkholes form in it.'],
    gravel: ['#f4d35e', 'River sand, gravel and clay', 'Loose ground laid down by rivers: building sand and gravel, clay for bricks and pots, the best ground for wells and gardens, and where placer gold settles.'],
    granite: ['#e56b6f', 'Granite-like rock', 'Hard, even stone for building and millstones. It weathers to coarse sand that drains fast.'],
    volcanic: ['#8e44ad', 'Lava rock (basalt, andesite)', 'Hard, dark rock: good crushed rock for roads, and tough building stone.'],
    sand: ['#d4a373', 'Sandstone', 'Easy to cut for building, and good for sharpening stones. Often carries springs.'],
    mud: ['#8d99ae', 'Mudstone, shale or slate', 'Soft rock that breaks down into clay. Slopes on it slide when wet, and springs are few.'],
    meta: ['#b5838d', 'Schist and mixed hard rock', 'Hard, folded rock of mixed kinds. Quartz veins in rock like this are where lode gold was mined.'], other: ['#cccccc', 'Other rock', ''] };
  var VEG = { fir: ['Fir, Douglas-fir, hemlock', 'Straight softwood for building; fair firewood.'], mixed: ['Douglas-fir with tanoak and madrone', 'Douglas-fir for building; tanoak and madrone for acorns and hot-burning firewood.'],
    pine: ['Pine', 'Easy-to-work building wood, pitch for starting fires, and pine nuts from some kinds.'], oak: ['Oak', 'Acorns for food, and the best firewood.'],
    cedar: ['Cedar or redwood', 'Wood that resists rot: posts, shakes, boats.'], hard: ['Alder, maple, other broadleaf trees', 'Firewood, smoking wood, tool handles.'],
    wet: ['Streamside woods and marsh', 'Water is near. Willow and cattail for weaving; good ground for wildlife.'], brush: ['Brush', 'Thick brush: hard to walk through, and it burns fiercely.'],
    grass: ['Grass and meadow', 'Open ground: grazing, hay, easy walking.'], farm: ['Fields and pasture', 'Cleared, worked ground.'], rock: ['Bare rock', 'Bare rock or scree.'] };
  var LAYERS = [
    ['Base map', [
      { id: 'contours', title: 'Topo lines', note: 'Lines of equal height, in feet', layers: ['contour-lines', 'contour-labels'], on: true, need: 'terrain' },
      { id: 'shade', title: 'Shaded hills', layers: ['hillshade'], on: true, need: 'terrain' },
      { id: 'steep', title: 'Steep ground', note: 'The darker, the steeper', layers: ['steep'], need: 'terrain',
        legend: [['#fff3b0', 'gentle'], ['#ffc65c', 'moderate'], ['#f58b3c', 'steep'], ['#d9480f', 'very steep'], ['#7b2cbf', 'cliffs']] },
      { id: 'sunny', title: 'Sunny slopes', note: 'Ground that faces south: warmest, best for gardens and solar', layers: ['sunny'], need: 'terrain', legend: [['#ffcc33', 'faces south']] }]],
    ['Land', [
      { id: 'parcels', title: 'Property lines', note: 'Tap a lot for its number, acres and owner', layers: ['parcel-lines', 'parcel-hit'], on: true, need: 'parcels', legend: [['#d9480f', 'tax lot', 'ln']] },
      { id: 'own', title: 'Who manages the land', note: 'Public land in color; private land has none', layers: ['own-fill', 'own-line'], on: true, need: 'ownership' },
      { id: 'sections', title: 'Section grid', note: 'Township, range and section, as on deeds and old maps', layers: ['sections', 'townships', 'section-labels'], src: 'sections' }]],
    ['Water', [
      { id: 'streams', title: 'Creeks: year-round or seasonal', layers: ['streams-y', 'streams-s', 'streams-d'], src: 'streams',
        legend: [['#1565c0', 'runs all year', 'ln'], ['#5aa9e6', 'dry part of the year', 'ln'], ['#00897b', 'ditch or canal', 'ln']] },
      { id: 'springs', title: 'Springs and waterfalls', layers: ['springs'], src: 'springs', legend: [['', '💧 spring'], ['', '🌊 waterfall']] },
      { id: 'wells', title: 'Wells', note: 'From the state\'s well reports: how deep people had to drill', layers: ['wells'], src: 'wells',
        legend: [['#2b8a3e', 'under 75 ft', 'dot'], ['#f08c00', '75 to 200 ft', 'dot'], ['#c92a2a', 'over 200 ft', 'dot']] },
      { id: 'dams', title: 'Dams and ponds behind them', layers: ['dams'], src: 'dams' }]],
    ['Food and growing', [
      { id: 'soils', title: 'Good growing ground', note: 'The Soil Survey\'s rating without irrigation', layers: ['soils'], src: 'soils',
        legend: [['#1b7f3b', 'best cropland'], ['#7cb342', 'good, with care'], ['#c0ca33', 'fair: limited crops']] },
      { id: 'wildfood', title: 'Wild food sightings', note: 'Where people have recorded edible plants and mushrooms. A sighting is not a promise, and never eat anything on a map\'s word: check it in the guides', layers: ['wildfood'], src: 'wildfood',
        legend: Object.keys(WF).map(function (k) { return [WF[k][0], WF[k][1], 'dot']; }) },
      { id: 'fish', title: 'Salmon and trout streams', layers: ['fish-trout', 'fish-salmon'], src: 'fish', legend: [['#e8590c', 'salmon, steelhead', 'ln'], ['#845ef7', 'trout', 'ln']] },
      { id: 'frost', title: 'Frost pockets', note: 'Low, flat ground where cold air settles on still nights: frost comes earlier in fall and stays later in spring. Worked out from the shape of the ground, so take it as a guide',
        layers: ['frost'], need: 'terrain', legend: [['#5b7cfa', 'coldest hollows'], ['#a9c1ff', 'cool flats']] }]],
    ['Hunting', [
      { id: 'deer_elk', title: 'Deer and elk country', note: 'Where the state\'s wildlife staff say deer and elk live, and where they gather by season', layers: ['deer-elk'], src: 'deer_elk',
        legend: Object.keys(HAB).map(function (k) { return [HAB[k][0], HAB[k][1]]; }) },
      { id: 'game', title: 'Game sightings', note: 'Where people have recorded game animals and birds. A sighting is not a promise', layers: ['game'], src: 'game',
        legend: Object.keys(GAME).map(function (k) { return [GAME[k][0], GAME[k][1], 'dot']; }) },
      { id: 'hunt_units', title: 'Hunting units', note: 'The state\'s units, as the hunting rules name them', layers: ['hunt-units', 'hunt-unit-names'], src: 'hunt_units', legend: [['#3f6212', 'unit edge', 'ln']] }]],
    ['Materials', [
      { id: 'timber', title: 'Timber: what grows where', note: 'The main trees or cover, from the national vegetation map. Good to about a city block', layers: ['timber'], src: 'timber', raster: true },
      { id: 'rocks', title: 'Rock types', note: 'The rock under the ground. Tap for what it is good for', layers: ['rocks'], src: 'rocks',
        legend: Object.keys(ROCK).filter(function (k) { return k !== 'other'; }).map(function (k) { return [ROCK[k][0], ROCK[k][1]]; }) },
      { id: 'mines', title: 'Mines, quarries and mineral sites', note: 'Old workings are dangerous: stay out of shafts and tunnels', layers: ['mines'], src: 'mines',
        legend: Object.keys(MINE).map(function (k) { return [MINE[k][0], MINE[k][1], 'dot']; }) }]],
    ['Hazards', [
      { id: 'fires', title: 'Past wildfires', note: 'Burned areas, by when they burned', layers: ['fires', 'fires-line'], src: 'fires',
        legend: [['#c92a2a', '2020 on'], ['#e8590c', '2010s'], ['#d9a02b', '2000s'], ['#8d7b68', 'before 2000']] },
      { id: 'flood', title: 'Flood zones', note: 'Ground a big flood covers (FEMA\'s 1-in-100-year flood)', layers: ['flood'], src: 'flood', legend: [['#3b82f6', 'flood zone']] },
      { id: 'landslides', title: 'Old landslides', note: 'Ground that has slid before can slide again', layers: ['landslides'], src: 'landslides', legend: [['#8d5524', 'slide deposit']] }]],
    ['Places and getting around', [
      { id: 'places', title: 'Useful places', note: 'Medical, fuel, food, fire stations, bridges, camps, halls', layers: ['poi'], src: 'places',
        legend: ['med', 'fuel', 'food', 'supply', 'fire', 'bridge', 'camp', 'hall', 'school', 'evac'].map(function (k) { return ['', BADGE[k] + ' ' + PLACE[k].toLowerCase()]; }) },
      { id: 'backroads', title: 'Forest and BLM roads', note: 'The number on the road sign, and whether you can drive it. A closed road is still a way on foot', layers: ['backroads', 'backroad-nums'], src: 'backroads',
        legend: Object.keys(ROAD).map(function (k) { return [ROAD[k][0], ROAD[k][1], 'ln']; }) },
      { id: 'gates', title: 'Gates and road blocks', note: 'On BLM roads. A gate may be locked: know another way round', layers: ['gates'], src: 'gates', legend: [['', '🚧 gate'], ['', '⛔ road blocked']] },
      { id: 'towers', title: 'Radio towers and fire lookouts', note: 'High ground with a road to it. Lookouts have the widest views', layers: ['towers'], src: 'towers', legend: [['', '📡 radio site'], ['', '🔭 fire lookout']] },
      { id: 'escape', title: 'Escape routes', note: 'The county\'s back ways out when the main road is cut', layers: ['escape'], src: 'escape', legend: [['#2f9e44', 'escape route', 'ln']] },
      { id: 'routes', title: 'Walking routes to other towns', layers: ['routes'], src: 'routes', legend: [['#7b2cbf', 'route', 'ln']] },
      { id: 'pins', title: 'Pins', note: 'Your own marks, and the ones shared on this library', layers: ['pins', 'shared-pins'], on: true }]]
  ];

  fetch(DATA + 'index.json').then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (cfg) {
    if (!drive) return cfg;
    // on a drive there may be a bigger map too (Settings > A bigger map): its streets and heights take the local ones' place
    return fetch(DATA + 'wide.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (w) {
      if (w && w.streets) { cfg.streets = w.streets; cfg.streetsV = w.v; cfg.bbox = w.bbox; if (w.terrain) cfg.terrain = w.terrain; cfg.wide = w.label; }
      return cfg;
    });
  }).then(start).catch(function (e) {
    if (e && e.stack && window.console) console.error(e);
    say('<b>The map files aren\'t here yet.</b><br>' + (drive ? 'Run the installer again: it fetches the map with everything else.' : 'They may still be on their way: try again later.'));
  });

  function start(cfg) {
    var protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    var terrainUrl = cfg.terrain ? (drive ? location.origin + '/maptiles/' + cfg.terrain.file.replace(/\.pmtiles$/, '') + '/{z}/{x}/{y}.webp' : DATA + 'terrain/{z}/{x}/{y}.webp') : '';
    var dem = null;
    if (terrainUrl) {
      dem = new mlcontour.DemSource({ url: terrainUrl, encoding: 'terrarium', maxzoom: cfg.terrain.maxzoom, worker: true, cacheSize: 80, timeoutMs: 20000 });
      dem.setupMaplibre(maplibregl);
      maplibregl.addProtocol('ark-slope', slopeTiles(dem));
    }
    // which of the layers this area's files have
    var have = { terrain: !!cfg.terrain, parcels: !!(cfg.property && cfg.property.parcels), ownership: !!(cfg.property && cfg.property.ownership) };
    (cfg.overlays || []).forEach(function (o) { o.layers.forEach(function (l) { have[l] = true; }); });
    var V = cfg.v ? '?v=' + cfg.v : '', vegOv = (cfg.overlays || []).filter(function (o) { return o.raster && o.group === 'timber'; })[0] || {}, vegPM = null;
    var ITEMS = [], GROUPS = {};
    LAYERS.forEach(function (g) { g[1].forEach(function (it) { if (it.id === 'pins' || have[it.need || it.src]) { ITEMS.push(it); GROUPS[it.id] = it.layers; } }); });

    var b = cfg.bbox, pad = 0.15;
    var map = new maplibregl.Map({
      container: 'map', style: style(cfg, dem), center: [cfg.center[0], cfg.center[1]], zoom: cfg.center[2], minZoom: cfg.wide ? 5 : 7, maxZoom: 18,
      maxBounds: [[b[0] - pad, b[1] - pad], [b[2] + pad, b[3] + pad]], attributionControl: false, dragRotate: false, pitchWithRotate: false, hash: true
    });
    map.touchZoomRotate.disableRotation();
    map.on('styleimagemissing', function (e) { addBadge(map, e.id); });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 120 }), 'bottom-left');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    window.arkMap = map;   // for testing

    // ---- the one panel
    var SHEETS = { layers: ['Layers', 't-layers', true], info: ['What\'s here', null, false], measure: ['Measure', 't-measure', false], pins: ['My pins', 't-pins', true], print: ['Print this part of the map', 't-print', true] };
    var sheet = '';
    function openSheet(name, title) {
      if (sheet === 'measure' && name !== 'measure') endMeasure();
      sheet = name;
      Object.keys(SHEETS).forEach(function (k) { $('s-' + k).hidden = k !== name; if (SHEETS[k][1]) $(SHEETS[k][1]).classList.toggle('on', k === name); });
      $('sheettitle').textContent = title || SHEETS[name][0]; $('sheet').classList.toggle('tall', SHEETS[name][2]);
      $('sheet').hidden = false; document.body.classList.add('sheet-open'); $('results').hidden = true; $('sheetbody').scrollTop = 0;
    }
    function closeSheet() {
      if (sheet === 'measure') endMeasure();
      if (sheet === 'print') pr.seq++;
      sheet = ''; $('sheet').hidden = true; document.body.classList.remove('sheet-open');
      Object.keys(SHEETS).forEach(function (k) { if (SHEETS[k][1]) $(SHEETS[k][1]).classList.remove('on'); });
      if (pin && !pinKept) { pin.remove(); pin = null; }
    }
    $('sheetclose').onclick = closeSheet;
    var toggleSheet = function (name, then) { return function () { if (sheet === name) closeSheet(); else { openSheet(name); if (then) then(); } }; };

    // ---- layers: a switch for each, in groups that fold; what is on is remembered on this device
    var has = function (id) { return !!map.getLayer(id); };
    var show = function (ids, on) { ids.forEach(function (id) { if (has(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); }); };
    var saved = store.get('arkMapLayers', {});
    var isOn = function (it) { return it.id in saved ? !!saved[it.id] : !!it.on; };
    function legendHtml(it) {
      var lg = it.legend;
      if (it.id === 'own') lg = (cfg.property.owners || ['BLM', 'USFS', 'ST', 'LG']).filter(function (c) { return OWN[c] && OWN[c][1]; })
        .map(function (c) { return [OWN[c][1], c.indexOf('ST') === 0 ? 'State of Oregon' : OWN[c][0]]; }).filter(function (v, i, a) { return a.map(function (x) { return x[1]; }).indexOf(v[1]) === i; });
      if (it.id === 'timber') lg = (vegOv.classes || []).filter(function (c) { return VEG[c[0]]; }).map(function (c) { return [c[1], VEG[c[0]][0]]; });
      if (!lg) return '';
      return '<div class="legend" id="lg-' + it.id + '">' + lg.map(function (l) {
        return '<span>' + (l[0] ? '<i class="' + (l[2] || '') + '" style="' + (l[2] === 'ln' ? 'border-color:' : 'background:') + l[0] + '"></i>' : '') + esc(l[1]) + '</span>'; }).join('') + '</div>';
    }
    function renderLayers() {
      var open = store.get('arkMapOpen', { 'Base map': true, Land: true });
      $('layerlist').innerHTML = LAYERS.map(function (g) {
        var its = g[1].filter(function (it) { return GROUPS[it.id]; }); if (!its.length) return '';
        var n = its.filter(isOn).length;
        return '<details class="grp" data-g="' + esc(g[0]) + '"' + (open[g[0]] ? ' open' : '') + '><summary>' + esc(g[0]) + ' <span class="n">' + (n ? n + ' on' : '') + '</span></summary>' + its.map(function (it) {
          return '<label class="lay"><span class="sw"><input type="checkbox" id="l-' + it.id + '"' + (isOn(it) ? ' checked' : '') + '><span></span></span><span class="tx">' + esc(it.title) +
            (it.note ? '<small>' + esc(it.note) + '</small>' : '') + '</span></label>' + legendHtml(it);
        }).join('') + '</details>';
      }).join('');
      ITEMS.forEach(function (it) {
        var box = $('l-' + it.id), lg = $('lg-' + it.id);
        if (lg) lg.hidden = !box.checked;
        box.onchange = function () {
          show(it.layers, box.checked); saved[it.id] = box.checked; store.set('arkMapLayers', saved); if (lg) lg.hidden = !box.checked;
          var d = box.closest('details'), n = d.querySelectorAll('input:checked').length; d.querySelector('.n').textContent = n ? n + ' on' : '';
        };
      });
      $('layerlist').querySelectorAll('details').forEach(function (d) { d.ontoggle = function () { var o = store.get('arkMapOpen', { 'Base map': true, Land: true }); o[d.dataset.g] = d.open; store.set('arkMapOpen', o); }; });
    }
    renderLayers();
    map.on('load', function () { ITEMS.forEach(function (it) { show(it.layers, isOn(it)); }); drawPins(); drawShared(); });
    $('propnote').hidden = !have.parcels;
    if (cfg.wide) $('propnote').insertAdjacentHTML('afterend', '<p class="small">Roads, trails and topo lines cover ' + esc(cfg.wide) + '. The other layers and the search cover ' + esc(cfg.name) + '.</p>');
    $('credits').innerHTML = 'Map data: ' + (cfg.credits || []).map(esc).join(' · ') + (cfg.built ? '. Made ' + esc(cfg.built) + '.' : '');
    $('t-layers').onclick = toggleSheet('layers');

    // ---- tap: what's here
    var pin = null, pinKept = false;
    function elevationAt(lngLat) {
      if (!dem) return Promise.resolve(null);
      var z = cfg.terrain.maxzoom, n = Math.pow(2, z);
      var fx = (lngLat.lng + 180) / 360 * n, s = Math.sin(lngLat.lat * Math.PI / 180), fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
      var tx = Math.floor(fx), ty = Math.floor(fy);
      return dem.getDemTile(z, tx, ty).then(function (t) {
        var px = Math.min(t.width - 1, Math.floor((fx - tx) * t.width)), py = Math.min(t.height - 1, Math.floor((fy - ty) * t.height));
        var m = t.data[py * t.width + px]; return isFinite(m) ? m : null;
      }).catch(function () { return null; });
    }
    // the county writes owners in capitals ("SMITH JOHN & MARY"): easier to read with small letters, short words like LLC kept
    function ownerName(n) {
      return String(n).toLowerCase().replace(/[a-z][a-z']*/g, function (w) {
        return /^(llc|inc|co|usa|blm|ii|iii|iv|lp|llp|pc|na|dba|hoa|odot|odf|us)$/.test(w) ? w.toUpperCase() : /^(of|and|the|for|et|al)$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1);
      }).replace(/^[a-z]/, function (c) { return c.toUpperCase(); });
    }
    function lotName(lot) {   // Oregon map and tax lot: township, range, section, quarter, then the lot number
      var m = /^(\d\d)(\d\d)(\d\d)(\w\w)0*(\w+)$/.exec(lot || '');
      return m ? 'Tax lot ' + m[5] + ' <span class="small">(map ' + m[1] + '-' + m[2] + '-' + m[3] + (m[4] !== '00' ? '-' + m[4] : '') + ')</span>' : 'Tax lot ' + esc(lot);
    }
    // what a thing in one of the layers is, in words: -> [kind, title, [lines]]
    var CLASS = { 1: 'best cropland: few limits', 2: 'very good cropland: some care needed', 3: 'good cropland with care: fewer crops, or erosion to watch', 4: 'fair: only some crops, and careful handling' };
    function describe(f) {
      var p = f.properties, L = f.layer.id, out = [];
      var add = function (v) { if (v != null && v !== '') out.push(esc(v)); };
      if (L === 'springs') return [p.k === 'fall' ? 'Waterfall' : 'Spring', p.n || '', out];
      if (L.indexOf('streams') === 0) return ['Creek', p.n || '', [p.k === 'y' ? 'Runs all year' : p.k === 's' ? 'Seasonal: dry part of the year' : p.k === 'd' ? 'A ditch or canal' : '']];
      if (L === 'wells') { add(p.d + ' ft deep'); if (p.s) add('water stood ' + p.s + ' ft down when it was drilled'); if (p.f) add('first water at ' + p.f + ' ft'); if (p.y) add('drilled ' + p.y); return ['Well', '', out]; }
      if (L === 'dams') { if (p.h) add(p.h + ' ft high'); if (p.r) add('on ' + p.r); if (p.af) add('holds about ' + Math.round(p.af).toLocaleString() + ' acre-feet'); return ['Dam', p.n || '', out]; }
      if (L === 'soils') { add('Class ' + p.c + ': ' + (CLASS[p.c] || '')); add(p.n); if (p.d) add('Drainage: ' + String(p.d).toLowerCase()); return ['Growing ground', '', out]; }
      if (L === 'wildfood') { if (p.y) add('seen ' + p.y); add('A sighting, not a promise. Check any plant or mushroom in the guides before eating it.'); return ['Wild food', p.n || '', out]; }
      if (L.indexOf('fish') === 0) { add(p.n); if (p.u) add(String(p.u).replace(/([a-z])([A-Z])/g, '$1, $2').toLowerCase()); return ['Fish stream', p.sp || '', out]; }
      if (L === 'mines') { add(p.c); add(p.w); if (p.p) add('Produced: ' + p.p); add('Old workings are dangerous: stay out.'); return [(MINE[p.k] || ['', 'Mineral site'])[1] + ' site', p.n || '', out]; }
      if (L === 'fires') { if (p.a) add(Number(p.a).toLocaleString() + ' acres'); return ['Wildfire' + (p.y ? ', ' + p.y : ''), p.n || '', out]; }
      if (L === 'flood') return ['Flood zone', '', ['A big flood covers this ground' + (p.z ? ' (FEMA zone ' + esc(p.z) + ')' : '')]];
      if (L === 'landslides') { add(p.t); return ['Old landslide', p.n || '', out]; }
      if (L === 'poi') { add(p.d); return [(p.k === 'bridge' && p.r ? 'Bridge with a weight limit' : PLACE[p.k] || 'Place'), p.n || '', out]; }
      if (L === 'escape') { add(p.s); add(p.se); add(p.su); add(p.d); return ['Escape route', p.n || '', out]; }
      if (L === 'routes') return ['Walking route', 'One of the routes to other towns', ['<a href="' + esc(routesPage()) + '">Open the list of routes</a>']];
      if (L === 'backroads') { add(p.nm); add((ROAD[p.k] || ROAD.unk)[1].replace(/^./, function (c) { return c.toUpperCase(); })); if (p.s) add('Surface: ' + p.s); add(p.d);
        return [p.a === 'fs' ? 'Forest Service road' : 'BLM road', p.n ? 'Road ' + p.n : (p.nm || ''), out]; }
      if (L === 'gates') { add(p.k === 'gate' ? 'It may be locked. Know another way round.' : 'Blocked to vehicles with rocks, a berm or a barrier. Still a way on foot.'); return [p.k === 'gate' ? 'Gate' : 'Road block', '', out]; }
      if (L === 'towers') { if (p.k === 'lookout') { add('A high point with a wide view.'); return ['Fire lookout', p.n || '', out]; }
        add('Transmitters here: ' + (p.d || 'radio')); add('High ground with a road to it, and often its own power.'); return ['Radio site', '', out]; }
      if (L === 'hunt-units') return ['Hunting unit', (p.n || '') + (p.u ? ' (unit ' + p.u + ')' : ''), ['Seasons and tags go by unit: see the hunting rules in the local guides.']];
      if (L === 'deer-elk') return ['Deer and elk', '', [esc({ winter: 'Winter gathering ground: deer and elk crowd here from about November to April.', summer: 'Summer gathering ground.',
        major: 'They live here all year, in good numbers.', edge: 'They live here all year, but fewer of them.', town: 'Around farms and towns: deer and elk are here, and clash with people.' }[p.k] || '')]];
      if (L === 'game') { if (p.y) add('seen ' + p.y); add('A sighting, not a promise.'); return ['Game sighting', p.n || '', out]; }
      if (L === 'rocks') { var rk = ROCK[p.k] || ROCK.other; add(p.n); if (p.r) add('Mostly ' + p.r); add(rk[2]); return ['Rock', rk[1], out]; }
      if (L === 'sections') return ['Section grid', 'Section ' + (p.s || '?') + (p.t ? ', ' + p.t : ''), out];
      return null;
    }
    function routesPage() { var r = document.body.getAttribute('data-routes') || ''; return drive ? '/lib/' + r : '../walking-routes/WALKING-ROUTES.html'; }
    map.on('click', function (e) {
      $('results').hidden = true; say('');
      if (measuring) { addMeasure(e.lngLat); return; }
      var ll = e.lngLat, rows = [], facts = [], seen = {};
      var base = map.queryRenderedFeatures(e.point, { layers: ['parcel-hit', 'own-fill', 'own-hit'].filter(has) });
      var lot = base.filter(function (f) { return f.layer.id === 'parcel-hit'; })[0], own = base.filter(function (f) { return f.layer.id !== 'parcel-hit'; })[0];
      if (own) rows.push(['Land', esc(ownName(own.properties.own))]);
      if (lot) rows.push(['Property', lotName(lot.properties.lot) + (lot.properties.acres ? ', about ' + lot.properties.acres + ' acres' : '')]);
      if (lot && lot.properties.owner) rows.push(['Owner', esc(ownerName(lot.properties.owner)) + ' <span class="small">(county records' + (cfg.built ? ', ' + esc(cfg.built) + ')' : ')') + '</span>']);
      rows.push(['Position', ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5)]);
      // everything in the switched-on layers within a finger's width of the tap
      var ids = []; ITEMS.forEach(function (it) { if (it.src && !it.raster && $('l-' + it.id).checked) it.layers.forEach(function (l) { if (has(l)) ids.push(l); }); });
      var box = [[e.point.x - 12, e.point.y - 12], [e.point.x + 12, e.point.y + 12]];
      (ids.length ? map.queryRenderedFeatures(box, { layers: ids }) : []).forEach(function (f) {
        var d = describe(f); if (!d) return;
        var key = d[0] + '|' + d[1] + '|' + d[2].join('|'); if (seen[key] || facts.length >= 12) return; seen[key] = 1; facts.push(d);
      });
      var mine = has('pins') ? map.queryRenderedFeatures(box, { layers: ['pins', 'shared-pins'].filter(has) })[0] : null;
      var draw = function () {
        $('s-info').innerHTML = (mine ? '<div class="fact"><span class="k">' + (mine.properties.shared ? 'Shared pin' : 'My pin') + '</span><b>' + (mine.properties.shared ? '📍 ' : '📌 ') + esc(mine.properties.name) + '</b>' + (mine.properties.note ? esc(mine.properties.note) : '') +
            '<div class="row"><button class="btn sm" type="button" id="i-del">Remove this pin</button></div></div>' : '') +
          facts.map(function (d) { return '<div class="fact"><span class="k">' + esc(d[0]) + '</span>' + (d[1] ? '<b>' + esc(d[1]) + '</b>' : '') + d[2].filter(Boolean).join('<br>') + '</div>'; }).join('') +
          '<div class="fact"><table class="kv">' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</table>' +
          '<div class="row"><button class="btn sm" type="button" id="i-pin">📌 Save as a pin</button><button class="btn sm" type="button" id="i-meas">📏 Measure from here</button></div>' +
          '<div id="i-form" hidden><input class="t" id="i-name" placeholder="A name for this pin" maxlength="60"><textarea class="t" id="i-note" rows="2" placeholder="A note (optional)" maxlength="300"></textarea>' +
          (sharing ? '<label class="chk"><input type="checkbox" id="i-share"> Share it with everyone using this library</label>' : '') +
          '<div class="row"><button class="btn sm go" type="button" id="i-save">Save pin</button></div></div></div>';
        $('i-pin').onclick = function () { $('i-form').hidden = false; $('i-name').focus(); };
        $('i-save').onclick = function () {
          var nm = $('i-name').value.trim() || 'Pin', nt = $('i-note').value.trim();
          if ($('i-share') && $('i-share').checked) sharePin('add', { pin: { name: nm, note: nt, lng: ll.lng, lat: ll.lat } }); else addPin(ll, nm, nt);
          closeSheet();
        };
        $('i-meas').onclick = function () { startMeasure(); addMeasure(ll); };
        if (mine) $('i-del').onclick = function () { if (mine.properties.shared) sharePin('remove', { id: mine.properties.id }); else removePin(mine.properties.id); closeSheet(); };
      };
      draw(); openSheet('info', facts.length ? facts[0][1] || facts[0][0] : lot ? 'Tax lot' : 'What\'s here');
      if (pin) pin.remove();
      pin = new maplibregl.Marker({ color: '#d9480f' }).setLngLat(ll).addTo(map); pinKept = false;
      vegAt(ll).then(function (k) { if (k && VEG[k] && sheet === 'info') { facts.push(['What grows here', VEG[k][0], [esc(VEG[k][1])]]); draw(); } });
      elevationAt(ll).then(function (m) { if (m != null && sheet === 'info') { rows.splice(rows.length - 1, 0, ['Height', Math.round(m * 3.28084).toLocaleString() + ' ft <span class="small">(' + Math.round(m) + ' m)</span>']); draw(); } });
    });

    // the timber layer is pictures, not shapes: what is at a point is read from the colour of its dot
    function vegAt(ll) {
      if (!vegOv.file || !$('l-timber') || !$('l-timber').checked) return Promise.resolve(null);
      vegPM = vegPM || new pmtiles.PMTiles(DATA + vegOv.file + V);
      var z = vegOv.maxzoom, n = Math.pow(2, z), fx = (ll.lng + 180) / 360 * n, sn = Math.sin(ll.lat * Math.PI / 180), fy = (0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * n;
      var tx = Math.floor(fx), ty = Math.floor(fy);
      return vegPM.getZxy(z, tx, ty).then(function (t) {
        if (!t || !t.data) return null;
        return createImageBitmap(new Blob([t.data], { type: 'image/png' })).then(function (bm) {
          var c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; var g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bm, 0, 0);
          var d = g.getImageData(Math.min(bm.width - 1, Math.floor((fx - tx) * bm.width)), Math.min(bm.height - 1, Math.floor((fy - ty) * bm.height)), 1, 1).data, best = null, bd = 1e9;
          if (d[3] < 128) return null;
          (vegOv.classes || []).forEach(function (cl) {
            var r = parseInt(cl[1].slice(1, 3), 16), gg = parseInt(cl[1].slice(3, 5), 16), b = parseInt(cl[1].slice(5, 7), 16), dd = Math.abs(r - d[0]) + Math.abs(gg - d[1]) + Math.abs(b - d[2]);
            if (dd < bd) { bd = dd; best = cl[0]; }
          });
          return bd < 24 ? best : null;
        });
      }).catch(function () { return null; });
    }

    // ---- shared pins: kept by the library itself (on a drive or an ARK Vault), so every phone on its Wi-Fi sees them
    var sharing = false, shared = [];
    function drawShared() {
      var src = map.getSource('shared-pins'); if (!src) return;
      src.setData({ type: 'FeatureCollection', features: shared.map(function (p) { return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, name: p.name, note: p.note || '', shared: 1 } }; }) });
    }
    function gotShared(j) { if (j && j.pins) { sharing = true; shared = j.pins; drawShared(); if (sheet === 'pins') renderPins(); } }
    function sharePin(what, body) {
      body.do = what;
      return fetch('/api/pins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.ok ? r.json() : r.text().then(function (t) { throw new Error(t); }); }).then(gotShared)
        .catch(function (e) { say('<b>The pin could not be shared.</b> ' + esc(String(e && e.message || '').slice(0, 160)) + ' <button class="btn" type="button" onclick="this.parentNode.hidden=true">OK</button>'); });
    }
    function loadShared() { if (!document.hidden) fetch('/api/pins').then(function (r) { return r.ok ? r.json() : null; }).then(gotShared).catch(function () {}); }
    if (drive) { loadShared(); setInterval(loadShared, 30000); document.addEventListener('visibilitychange', loadShared); }

    // ---- where am I: the phone only tells a secure page (https, or the device the library runs on)
    var geo = null, canLocate = window.isSecureContext && !!navigator.geolocation;
    var ok = ' <button class="btn" type="button" onclick="this.parentNode.hidden=true">OK</button>';
    if (canLocate) {   // made now, so it is ready by the time the button is tapped
      geo = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true, timeout: 60000 }, trackUserLocation: true, showUserHeading: true, showAccuracyCircle: true });
      geo.on('error', function (err) {
        $('locate').classList.remove('on');
        say((err && err.code === 1 ? '<b>The phone didn\'t allow its position.</b> Allow location for this page (and for the browser, in the phone\'s Settings), then tap 📍 again.'
          : '<b>No position yet.</b> Outdoors with a clear view of the sky it can take a minute or two with no cell signal. Tap 📍 to try again.') + ok);
      });
      geo.on('geolocate', function () { say(''); });
      geo.on('trackuserlocationend', function () { if (geo._watchState === 'OFF') $('locate').classList.remove('on'); });
      map.addControl(geo, 'top-left');
      if (geo._container) geo._container.style.display = 'none';   // its own button stays out of sight: ours (📍) drives it
    }
    $('locate').onclick = function () {
      if (!canLocate) {
        if (!drive || !navigator.geolocation) { say('<b>This phone won\'t share its position with this page.</b><br>Phones only do that for a secure page. Open the map from the library website (https).' + ok); return; }
        // the library shared over Wi-Fi: it has a secure address too, with a certificate it makes itself, which the phone has to be told to accept
        say('<b>To show where you are, this phone needs the library\'s secure address.</b>' +
          '<ol style="margin:6px 0 8px;padding-left:20px"><li>Tap <b>Open the secure map</b>.</li>' +
          '<li>The phone warns that the connection is <i>not private</i>. That is expected: the library makes its own security certificate, and nothing leaves this Wi-Fi. ' +
          'On an iPhone tap <b>Show Details</b>, then <b>visit this website</b>. On Android tap <b>Advanced</b>, then <b>Proceed</b>.</li>' +
          '<li>Tap 📍 again and allow location.</li></ol>' +
          '<button class="btn go" type="button" id="gosecure">Open the secure map</button> <button class="btn" type="button" onclick="this.parentNode.hidden=true">Not now</button>');
        $('gosecure').onclick = function () {
          fetch('/api/secure?now=' + Date.now()).then(function (r) { return r.json(); }).then(function (j) {
            if (!j.ok) throw new Error(j.why || '');
            location.href = 'https://' + location.hostname + ':' + j.port + location.pathname + location.search + location.hash;
          }).catch(function (e) {
            say('<b>The secure address isn\'t there.</b> ' + esc(e && e.message ? e.message : 'The library on the other device may need updating.') +
              ' You can still read your position from the phone\'s compass app and find it on the map.' + ok);
          });
        };
        return;
      }
      var go = function (tries) { if (!geo.trigger() && tries > 0) setTimeout(function () { go(tries - 1); }, 400); };
      go(8); $('locate').classList.add('on');
    };

    // ---- find a place by name
    var places = null;
    if (cfg.places) fetch(DATA + cfg.places).then(function (r) { return r.json(); }).then(function (p) { places = p; }).catch(function () {});
    else $('q').hidden = true;
    var ICON = { locality: '🏘️', peak: '⛰️', lake: '💧', river: '🌊', stream: '💧', park: '🌲', road: '🛣️', poi: '📌' };
    var KIND = { locality: 'town or place', peak: 'peak', lake: 'lake or pond', river: 'river', stream: 'creek', park: 'park or forest', road: 'road', poi: 'place' };
    var ZOOM = { locality: 13, peak: 14, lake: 14, river: 12, stream: 14, park: 12, road: 14, poi: 15 };
    function search() {
      var words = $('q').value.toLowerCase().split(/\s+/).filter(Boolean), box = $('results');
      if (!words.length || !places) { box.hidden = true; return; }
      var hit = [], i, p, n;
      for (i = 0; i < places.length && hit.length < 400; i++) {
        p = places[i]; n = p[0].toLowerCase();
        if (words.every(function (w) { return n.indexOf(w) >= 0; })) hit.push(p);
      }
      var first = words[0];   // names that start with what was typed come first; the list is already in order of importance
      hit.sort(function (a, c) { return (a[0].toLowerCase().indexOf(first) === 0 ? 0 : 1) - (c[0].toLowerCase().indexOf(first) === 0 ? 0 : 1); });
      hit = hit.slice(0, 12);
      box.innerHTML = hit.length ? hit.map(function (p, i) { return '<button type="button" data-i="' + i + '">' + (ICON[p[1]] || '📌') + ' ' + esc(p[0]) + ' <small>' + (KIND[p[1]] || '') + '</small></button>'; }).join('')
        : '<p class="small" style="margin:8px 10px">Nothing by that name on this map. Try part of the name.</p>';
      box.hidden = false;
      box.querySelectorAll('button').forEach(function (bt) {
        bt.onclick = function () {
          var p = hit[+bt.dataset.i]; box.hidden = true; $('q').blur();
          map.flyTo({ center: [p[2], p[3]], zoom: Math.max(map.getZoom(), ZOOM[p[1]] || 14), speed: 1.6 });
          if (pin) pin.remove();
          pin = new maplibregl.Marker({ color: '#d9480f' }).setLngLat([p[2], p[3]]).addTo(map);
        };
      });
    }
    // ---- my pins: kept on this device (and in a file, to carry them to another)
    var pins = store.get('arkPins', []);
    function drawPins() {
      var src = map.getSource('pins'); if (!src) return;
      src.setData({ type: 'FeatureCollection', features: pins.map(function (p) { return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, name: p.name, note: p.note || '' } }; }) });
    }
    function addPin(ll, name, note) { pins.push({ id: Date.now() + '-' + Math.round(Math.random() * 1e6), name: name, note: note, lng: +ll.lng.toFixed(6), lat: +ll.lat.toFixed(6), t: Date.now() }); store.set('arkPins', pins); drawPins(); }
    function removePin(id) { pins = pins.filter(function (p) { return p.id !== id; }); store.set('arkPins', pins); drawPins(); renderPins(); }
    function renderPins() {
      $('pinlist').innerHTML = pins.length ? pins.map(function (p, i) {
        return '<div class="pinrow"><span>📌</span><span class="tx" data-i="' + i + '">' + esc(p.name) + '<small>' + (p.note ? esc(p.note) + ' · ' : '') + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) + '</small></span><button class="btn sm" type="button" data-d="' + esc(p.id) + '">Remove</button></div>';
      }).join('') : '<p class="small">No pins yet.</p>';
      if (sharing) $('pinlist').innerHTML += '<h4 class="sub">Shared on this library</h4>' + (shared.length ? shared.map(function (p, i) {
        return '<div class="pinrow"><span>📍</span><span class="tx" data-s="' + i + '">' + esc(p.name) + '<small>' + (p.note ? esc(p.note) + ' · ' : '') + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) + '</small></span><button class="btn sm" type="button" data-r="' + esc(p.id) + '">Remove</button></div>';
      }).join('') : '<p class="small">None yet. Everyone using this library sees these. To share one, tap the map, then <b>Save as a pin</b>, and tick <b>Share it</b>.</p>');
      $('pinlist').querySelectorAll('.tx').forEach(function (el) { el.onclick = function () { var p = el.dataset.s != null ? shared[+el.dataset.s] : pins[+el.dataset.i]; map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 14) }); if (innerWidth < 820) closeSheet(); }; });
      $('pinlist').querySelectorAll('[data-d]').forEach(function (el) { el.onclick = function () { removePin(el.dataset.d); }; });
      $('pinlist').querySelectorAll('[data-r]').forEach(function (el) { el.onclick = function () { sharePin('remove', { id: el.dataset.r }); }; });
    }
    $('t-pins').onclick = toggleSheet('pins', renderPins);
    $('p-export').onclick = function () {
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ arkPins: pins }, null, 1)], { type: 'application/json' })); a.download = 'my-map-pins.json'; a.click();
    };
    $('p-import').onchange = function () {
      var f = this.files[0]; if (!f) return; var fr = new FileReader();
      fr.onload = function () {
        try {
          var got = JSON.parse(fr.result).arkPins, ids = {}; pins.forEach(function (p) { ids[p.id] = 1; });
          got.forEach(function (p) { if (p && isFinite(p.lng) && isFinite(p.lat) && !ids[p.id]) pins.push({ id: String(p.id || Date.now() + Math.random()), name: String(p.name || 'Pin').slice(0, 60), note: String(p.note || '').slice(0, 300), lng: +p.lng, lat: +p.lat, t: p.t || Date.now() }); });
          store.set('arkPins', pins); drawPins(); renderPins();
        } catch (e) { say('<b>That file doesn\'t hold map pins.</b> <button class="btn" type="button" onclick="this.parentNode.hidden=true">OK</button>'); }
      };
      fr.readAsText(f); this.value = '';
    };

    // ---- measure: distance along a path, the ups and downs, and whether the two ends can see each other
    var measuring = false, mpts = [];
    function dist(a, c) { var R = 6371000, r = Math.PI / 180, dLat = (c.lat - a.lat) * r, dLng = (c.lng - a.lng) * r, h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(c.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2); return 2 * R * Math.asin(Math.sqrt(h)); }
    function far(m) { var ft = m * 3.28084; return ft < 1500 ? Math.round(ft).toLocaleString() + ' ft' : (ft / 5280).toFixed(ft < 52800 ? 2 : 1) + ' miles'; }
    function startMeasure() { measuring = true; mpts = []; openSheet('measure'); $('hint').textContent = 'Tap the map to mark points'; $('hint').hidden = false; map.getCanvas().style.cursor = 'crosshair'; drawMeasure(); }
    function endMeasure() { measuring = false; mpts = []; $('hint').hidden = true; map.getCanvas().style.cursor = ''; var s = map.getSource('measure'); if (s) s.setData({ type: 'FeatureCollection', features: [] }); }
    function addMeasure(ll) { mpts.push(ll); drawMeasure(); }
    var mseq = 0;
    function drawMeasure() {
      var s = map.getSource('measure'), fs = mpts.map(function (p, i) { return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { n: i + 1 } }; });
      if (mpts.length > 1) fs.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: mpts.map(function (p) { return [p.lng, p.lat]; }) }, properties: {} });
      if (s) s.setData({ type: 'FeatureCollection', features: fs });
      var total = 0, i; for (i = 1; i < mpts.length; i++) total += dist(mpts[i - 1], mpts[i]);
      $('m-hint').hidden = mpts.length > 1; $('hint').hidden = mpts.length > 1;
      $('m-out').innerHTML = mpts.length < 2 ? (mpts.length ? '<p>First point marked. Tap the next one.</p>' : '') : '<p style="font-size:20px;font-weight:700;margin:2px 0">' + far(total) + '</p>' +
        '<p class="small">' + (mpts.length - 1) + ' stretch' + (mpts.length > 2 ? 'es' : '') + ', as the crow flies between points' + (total > 800 ? ' · about ' + Math.max(1, Math.round(total / 1609.34 / 2.5 * 60)) + ' minutes on foot on level ground' : '') + '</p>';
      $('profile').hidden = true; $('m-prof').innerHTML = '';
      if (mpts.length < 2 || !dem) return;
      // heights along the way
      var seq = ++mseq, N = 100, pts = [], acc = 0, segs = [];
      for (i = 1; i < mpts.length; i++) { var d = dist(mpts[i - 1], mpts[i]); segs.push([acc, d, mpts[i - 1], mpts[i]]); acc += d; }
      for (i = 0; i <= N; i++) {
        var at = total * i / N, sg = segs[0]; segs.forEach(function (g) { if (at >= g[0]) sg = g; });
        var t = sg[1] ? Math.min(1, (at - sg[0]) / sg[1]) : 0;
        pts.push({ d: at, ll: { lng: sg[2].lng + (sg[3].lng - sg[2].lng) * t, lat: sg[2].lat + (sg[3].lat - sg[2].lat) * t } });
      }
      Promise.all(pts.map(function (p) { return elevationAt(p.ll); })).then(function (els) {
        if (seq !== mseq || !measuring) return;
        var ok = els.filter(function (v) { return v != null; }); if (ok.length < els.length * 0.8) return;
        els = els.map(function (v, k) { return v == null ? (els[k - 1] != null ? els[k - 1] : ok[0]) : v; });
        var lo = Math.min.apply(null, els), hi = Math.max.apply(null, els), up = 0, down = 0;
        for (i = 1; i < els.length; i++) { var dv = els[i] - els[i - 1]; if (dv > 0) up += dv; else down -= dv; }
        var cv = $('profile'); cv.hidden = false; var W = cv.width = cv.clientWidth * 2, H = cv.height = 240, g = cv.getContext('2d'), padL = 8, padB = 8, span = Math.max(hi - lo, 10);
        var X = function (k) { return padL + (W - 2 * padL) * k / N; }, Y = function (v) { return H - padB - (H - 2 * padB - 22) * (v - lo) / span; };
        g.clearRect(0, 0, W, H); g.beginPath(); g.moveTo(X(0), H - padB); els.forEach(function (v, k) { g.lineTo(X(k), Y(v)); }); g.lineTo(X(N), H - padB); g.closePath();
        g.fillStyle = 'rgba(79,209,197,.35)'; g.fill(); g.beginPath(); els.forEach(function (v, k) { if (k) g.lineTo(X(k), Y(v)); else g.moveTo(X(k), Y(v)); }); g.strokeStyle = '#0d9488'; g.lineWidth = 3; g.stroke();
        var txt = '<p class="small">Lowest ' + Math.round(lo * 3.28084).toLocaleString() + ' ft, highest ' + Math.round(hi * 3.28084).toLocaleString() + ' ft · up ' + Math.round(up * 3.28084).toLocaleString() + ' ft, down ' + Math.round(down * 3.28084).toLocaleString() + ' ft along the way</p>';
        if (mpts.length === 2) {   // line of sight between the two ends, each 6 ft above the ground, with the earth's curve (as radio sees it)
          var h0 = els[0] + 1.8, h1 = els[N] + 1.8, worst = 0, where = 0;
          for (i = 1; i < N; i++) { var dd = pts[i].d, line = h0 + (h1 - h0) * dd / total, bulge = dd * (total - dd) / (2 * 6371000 * 4 / 3), over = els[i] + bulge - line; if (over > worst) { worst = over; where = dd; } }
          g.beginPath(); g.moveTo(X(0), Y(h0)); g.lineTo(X(N), Y(h1)); g.setLineDash([8, 6]); g.strokeStyle = worst > 0 ? '#d9480f' : '#2b8a3e'; g.lineWidth = 2.5; g.stroke(); g.setLineDash([]);
          txt += worst > 0 ? '<p>🚫 <b>The two ends can\'t see each other.</b> The ground ' + far(where) + ' from the first point is in the way by about ' + Math.round(worst * 3.28084).toLocaleString() + ' ft. A radio would need a higher spot or a relay.</p>'
            : '<p>✅ <b>The two ends can see each other</b> (each 6 ft above the ground; trees and buildings not counted). Good for a radio link.</p>';
        }
        $('m-prof').innerHTML = txt;
      });
    }
    $('t-measure').onclick = function () { if (sheet === 'measure') closeSheet(); else startMeasure(); };
    $('m-undo').onclick = function () { mpts.pop(); drawMeasure(); };
    $('m-clear').onclick = function () { mpts = []; drawMeasure(); $('hint').hidden = false; };

    // ---- print the part of the map on the screen
    // On the receipt printer (through the Library Assistant): black and white, 384 dots a strip, 1 to 4 strips side by side.
    // On an ordinary printer: one colour page. Either way a second, unseen map is drawn at the size the paper needs.
    var places0 = function () { return places || []; };
    function drawMap(st, w, h, zoom, ratio) {       // -> Promise of {canvas, map}: a map w x h (CSS px) drawn off screen
      return new Promise(function (ok, bad) {
        var box = document.createElement('div'); box.style.cssText = 'width:' + w + 'px;height:' + h + 'px';
        $('printwork').appendChild(box);
        var m = new maplibregl.Map({ container: box, style: st, center: map.getCenter(), zoom: zoom, interactive: false, attributionControl: false,
          preserveDrawingBuffer: true, pixelRatio: ratio, fadeDuration: 0, maxZoom: 22 });
        m.on('styleimagemissing', function (e) { addBadge(m, e.id); });
        var done = false, quiet = 0, t0 = Date.now();
        var finish = function () { if (done) return; done = true; clearInterval(iv); setTimeout(function () { ok({ canvas: m.getCanvas(), map: m, box: box }); }, 250); };
        m.once('idle', finish);
        m.on('error', function () {});                 // a tile outside the map: it prints blank there
        var iv = setInterval(function () {             // the hill shading can keep "idle" from ever coming: settle for all tiles in and still
          quiet = m.areTilesLoaded() ? quiet + 1 : 0;
          if (quiet >= 4 || Date.now() - t0 > 25000) finish();
        }, 400);
      });
    }
    function niceBar(maxFeet) {                        // a round length for the scale bar, and its words
      var steps = [50, 100, 200, 500, 1000, 2000, 2640, 5280, 10560, 26400, 52800, 105600, 264000, 528000], f = steps[0];
      steps.forEach(function (v) { if (v <= maxFeet) f = v; });
      return { feet: f, text: f < 2640 ? f.toLocaleString() + ' ft' : (f / 5280) + (f === 5280 ? ' mile' : ' miles') };
    }
    function decorate(g, w, h, m, colour) {            // the frame, north arrow, scale bar and the tapped spot, drawn on the picture
      var c = m.getCenter(), ftPerPx = 40075016.686 * Math.cos(c.lat * Math.PI / 180) / Math.pow(2, m.getZoom()) / 512 * 3.28084;
      var bar = niceBar(ftPerPx * Math.min(w * 0.45, 300)), bw = Math.round(bar.feet / ftPerPx), k = w / 384 > 2.5 ? 1.5 : 1;
      g.lineWidth = 3; g.strokeStyle = '#000'; g.strokeRect(1.5, 1.5, w - 3, h - 3);
      g.font = 'bold ' + Math.round(15 * k) + 'px sans-serif'; g.textBaseline = 'alphabetic';
      var tw = Math.max(bw, g.measureText(bar.text).width) + 20, x = 10, y = h - 12;
      g.fillStyle = '#fff'; g.fillRect(x - 4, y - 34 * k, tw + 8, 40 * k); g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(x - 3.5, y - 33.5 * k, tw + 7, 39 * k);
      g.fillStyle = '#000'; g.fillText(bar.text, x + 4, y - 14 * k);
      g.fillRect(x + 4, y - 8 * k, bw, 4 * k); g.fillRect(x + 4, y - 12 * k, 2, 10 * k); g.fillRect(x + 2 + bw, y - 12 * k, 2, 10 * k);
      var nx = w - 26 * k, ny = 16 * k;                 // north arrow
      g.fillStyle = '#fff'; g.fillRect(nx - 16 * k, ny - 10 * k, 32 * k, 62 * k); g.strokeRect(nx - 15.5 * k, ny - 9.5 * k, 31 * k, 61 * k);
      g.fillStyle = '#000'; g.beginPath(); g.moveTo(nx, ny - 4 * k); g.lineTo(nx + 9 * k, ny + 22 * k); g.lineTo(nx, ny + 15 * k); g.lineTo(nx - 9 * k, ny + 22 * k); g.closePath(); g.fill();
      g.font = 'bold ' + Math.round(18 * k) + 'px sans-serif'; g.textAlign = 'center'; g.fillText('N', nx, ny + 44 * k); g.textAlign = 'left';
      if (pin) {                                        // the spot that was tapped or found
        var p = m.project(pin.getLngLat());
        if (p.x > 8 && p.y > 8 && p.x < w - 8 && p.y < h - 8) {
          g.lineWidth = 5; g.strokeStyle = '#fff'; g.beginPath(); g.arc(p.x, p.y, 9 * k, 0, 7); g.moveTo(p.x - 15 * k, p.y); g.lineTo(p.x + 15 * k, p.y); g.moveTo(p.x, p.y - 15 * k); g.lineTo(p.x, p.y + 15 * k); g.stroke();
          g.lineWidth = 2.2; g.strokeStyle = colour ? '#d9480f' : '#000'; g.stroke();
        }
      }
      return { widthFeet: ftPerPx * w, bar: bar };
    }
    function blackAndWhite(g, w, h) {                  // crisp black lines; the grey of water becomes a pattern of dots
      var im = g.getImageData(0, 0, w, h), d = im.data, i, v, x, y;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = (y * w + x) * 4; v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        v = v > 186 && v < 214 ? ((x + y * 2) % 4 === 0 ? 0 : 255) : v < 168 ? 0 : 255;
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
      g.putImageData(im, 0, 0);
    }
    function nearName() {                               // "near Cave Junction": the closest town to the middle of the picture
      var c = map.getCenter(), best = null, bd = 1e9;
      places0().forEach(function (p) { if (p[1] !== 'locality') return; var dx = (p[2] - c.lng) * Math.cos(c.lat * Math.PI / 180), dy = p[3] - c.lat, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = p[0]; } });
      return best && bd < 0.03 ? 'near ' + best : cfg.name;
    }
    function widthWords(feet) { return feet < 5280 ? Math.round(feet / 100) * 100 + ' feet' : (Math.round(feet / 528) / 10) + ' miles'; }
    var pr = { cols: 2, job: null, seq: 0 };
    function shown() { var o = {}; ['contours', 'parcels', 'own'].forEach(function (k) { o[k] = !!($('l-' + k) && $('l-' + k).checked); }); return o; }
    function receiptPreview() {
      var seq = ++pr.seq, cols = pr.cols, box = $('map').getBoundingClientRect();
      var W = 384 * cols, H = Math.min(Math.round(W * box.height / box.width), 4200, 384 * cols * 3);
      $('pr-info').textContent = 'Drawing the map…'; $('pr-go').disabled = true; pr.job = null;
      drawMap(printStyle(cfg, dem, shown()), W, H, map.getZoom() + Math.log(W / box.width) / Math.LN2, 2).then(function (r) {
        var cv = document.createElement('canvas'); cv.width = W; cv.height = H; var g = cv.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(r.canvas, 0, 0, W, H);
        blackAndWhite(g, W, H);
        var info = decorate(g, W, H, r.map, false);
        r.map.remove(); r.box.remove();
        if (seq !== pr.seq) return;
        var c = map.getCenter(), blocks = [{ t: 'h3', x: 'Map ' + nearName() }];
        blocks.push({ t: 'p', x: 'North is up. The map is about ' + widthWords(info.widthFeet) + ' wide; the bar on it is ' + info.bar.text + '. Middle: ' + c.lat.toFixed(5) + ', ' + c.lng.toFixed(5) + '.' +
          (pin ? ' The cross marks ' + pin.getLngLat().lat.toFixed(5) + ', ' + pin.getLngLat().lng.toFixed(5) + '.' : '') });
        if (cols > 1) blocks.push({ t: 'p', x: 'Tape the ' + cols + ' strips side by side: A on the left, then ' + 'BCD'.slice(0, cols - 1).split('').join(', ') + '.' });
        for (var i = 0; i < cols; i++) {
          var s = document.createElement('canvas'); s.width = 384; s.height = H;
          s.getContext('2d').drawImage(cv, i * 384, 0, 384, H, 0, 0, 384, H);
          if (cols > 1) blocks.push({ t: 'h4', x: 'strip ' + 'ABCD'[i] });
          blocks.push({ t: 'img', data: s.toDataURL('image/png') });
        }
        var whole = cv.toDataURL('image/png');
        $('pr-prev').querySelector('img').src = whole; $('pr-save').href = whole; $('pr-save').hidden = false;
        if (!drive) { $('pr-info').textContent = 'This is how it prints on the library\'s receipt printer (on the ARK Vault). Here you can save the picture.'; return; }
        pr.job = { size: 'small', title: '', pictures: true, blocks: blocks };
        return fetch('/api/print', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pr.job) }).then(function (res) { return res.ok ? res.json() : res.text().then(function (t) { throw new Error(t); }); }).then(function (p) {
          if (seq !== pr.seq) return;
          var inch = p.mm / 25.4, found = p.printer && p.printer.found;
          $('pr-info').textContent = 'About ' + (inch < 12 ? Math.round(inch) + ' in' : (Math.round(inch / 1.2) / 10) + ' ft') + ' of paper. ' + (found ? '' : 'No printer found: plug it into the computer running the library (on the ARK Vault, the Pi).');
          $('pr-go').disabled = !found;
        });
      }).catch(function (e) { if (seq === pr.seq) $('pr-info').textContent = 'Could not make the picture' + (e && e.message ? ' (' + String(e.message).slice(0, 120) + ')' : '') + '.'; });
    }
    $('pr-cols').querySelectorAll('button').forEach(function (bt) {
      bt.onclick = function () { pr.cols = +bt.dataset.v; $('pr-cols').querySelectorAll('button').forEach(function (o) { o.classList.toggle('on', o === bt); }); receiptPreview(); };
    });
    $('pr-go').onclick = function () {
      if (!pr.job) return;
      $('pr-go').disabled = true; $('pr-info').textContent = 'Printing…';
      fetch('/api/print?go=1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pr.job) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (p) { if (!r.ok) throw new Error(p.error || 'the printer did not answer'); }); })
        .then(function () { $('pr-info').textContent = 'Sent to the printer. Tear each strip off when it stops.'; $('pr-go').disabled = false; })
        .catch(function (e) { $('pr-info').textContent = String(e.message || e); $('pr-go').disabled = false; });
    };
    $('pr-color').onclick = function () {               // one colour page: 8 x 10.35 in at 150 dots an inch, the screen's middle and width
      var box = $('map').getBoundingClientRect(), W = 1200, H = 1552;
      $('pr-colorinfo').textContent = 'Drawing the map…'; $('pr-color').disabled = true;
      var st = style(cfg, dem);                         // with the layers that are switched off left out
      Object.keys(GROUPS).forEach(function (k) { if (!$('l-' + k).checked) st.layers.forEach(function (l) { if (GROUPS[k].indexOf(l.id) >= 0) { l.layout = l.layout || {}; l.layout.visibility = 'none'; } }); });
      drawMap(st, W, H, map.getZoom() + Math.log(W / box.width) / Math.LN2, 1.5).then(function (r) {
        var cv = document.createElement('canvas'); cv.width = W; cv.height = H; var g = cv.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(r.canvas, 0, 0, W, H);
        decorate(g, W, H, r.map, true); r.map.remove(); r.box.remove();
        g.font = '14px sans-serif'; g.fillStyle = '#000'; var c = map.getCenter();
        var cap = 'Map ' + nearName() + '  ·  middle ' + c.lat.toFixed(5) + ', ' + c.lng.toFixed(5) + '  ·  © OpenStreetMap contributors, Mapterhorn' + (cfg.property ? ', county tax lots (not a survey)' : '');
        g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(4, 4, g.measureText(cap).width + 14, 22); g.fillStyle = '#000'; g.fillText(cap, 10, 20);
        var url = cv.toDataURL('image/jpeg', 0.92), img = new Image();
        img.onload = function () { $('printsheet').innerHTML = ''; $('printsheet').appendChild(img); $('pr-colorinfo').textContent = ''; $('pr-color').disabled = false; setTimeout(function () { window.print(); }, 150); };
        img.src = url;
      }).catch(function () { $('pr-colorinfo').textContent = 'Could not draw the page.'; $('pr-color').disabled = false; });
    };
    $('t-print').onclick = toggleSheet('print', function () { receiptPreview(); });
    $('q').addEventListener('input', search);
    $('q').addEventListener('focus', search);
    $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { var f = $('results').querySelector('button'); if (f) f.click(); } });
  }

  // "Steep ground" and "Sunny slopes": pictures worked out here from the height tiles, one for each tile the map asks for
  function slopeTiles(dem) {
    return function (params) {
      var m = /^ark-slope:\/\/(\w+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url), what = m[1], z = +m[2], x = +m[3], y = +m[4];
      if (what === 'frost') return frostTile(dem, z, x, y);
      return dem.getDemTile(z, x, y).then(function (t) {
        var w = t.width, h = t.height, d = t.data, c = document.createElement('canvas'); c.width = w; c.height = h;
        var g = c.getContext('2d'), im = g.createImageData(w, h), o = im.data;
        var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / Math.pow(2, z)))), px = 40075016.686 * Math.cos(lat) / Math.pow(2, z) / w;
        for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
          var l = d[j * w + Math.max(i - 1, 0)], r = d[j * w + Math.min(i + 1, w - 1)], u = d[Math.max(j - 1, 0) * w + i], dn = d[Math.min(j + 1, h - 1) * w + i];
          var dx = (r - l) / (2 * px), dy = (dn - u) / (2 * px), deg = Math.atan(Math.sqrt(dx * dx + dy * dy)) * 57.2958, k = (j * w + i) * 4, col = null;
          if (what === 'sunny') { var asp = Math.atan2(-dx, -dy) * 57.2958; if (deg >= 4 && Math.abs(asp) <= 50) col = [255, 204, 51, 105]; }   // downhill points south, within 50 degrees
          else col = deg < 8 ? null : deg < 15 ? [255, 243, 176, 90] : deg < 25 ? [255, 198, 92, 110] : deg < 35 ? [245, 139, 60, 125] : deg < 45 ? [217, 72, 15, 135] : [123, 44, 191, 140];
          if (col) { o[k] = col[0]; o[k + 1] = col[1]; o[k + 2] = col[2]; o[k + 3] = col[3]; }
        }
        g.putImageData(im, 0, 0);
        return new Promise(function (ok) { c.toBlob(function (bl) { bl.arrayBuffer().then(function (ab) { ok({ data: ab }); }); }, 'image/png'); });
      });
    };
  }

  // "Frost pockets": cold air is heavy and runs downhill on a still, clear night, pooling on low, flat ground. A spot is
  // marked when it is nearly level and well below the average height of the ground for a mile and a half around (so:
  // valley floors and hollows, not benches or ridges). It needs the eight tiles around the one asked for.
  function frostTile(dem, z, x, y) {
    var jobs = [], dx, dy;
    for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) jobs.push(dem.getDemTile(z, x + dx, y + dy).catch(function () { return null; }));
    return Promise.all(jobs).then(function (ts) {
      if (!ts[4]) throw new Error('no heights here');
      var Q = 256, G = 3 * Q, el = new Float32Array(G * G), ok = new Uint8Array(G * G), i, j, k;
      ts.forEach(function (t, n) {
        if (!t) return;
        var ox = (n % 3) * Q, oy = Math.floor(n / 3) * Q, st = t.width / Q, v;
        for (j = 0; j < Q; j++) for (i = 0; i < Q; i++) { v = t.data[Math.floor(j * st) * t.width + Math.floor(i * st)]; if (isFinite(v)) { el[(oy + j) * G + ox + i] = v; ok[(oy + j) * G + ox + i] = 1; } }
      });
      var W1 = G + 1, S = new Float64Array(W1 * W1), N = new Int32Array(W1 * W1), rs, rn;   // running sums: the average of any box in four look-ups
      for (j = 0; j < G; j++) { rs = 0; rn = 0; for (i = 0; i < G; i++) { k = j * G + i; if (ok[k]) { rs += el[k]; rn++; } S[(j + 1) * W1 + i + 1] = S[j * W1 + i + 1] + rs; N[(j + 1) * W1 + i + 1] = N[j * W1 + i + 1] + rn; } }
      var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / Math.pow(2, z)))), cell = 40075016.686 * Math.cos(lat) / Math.pow(2, z) / Q, r = Math.max(2, Math.min(Q - 1, Math.round(2500 / cell)));
      var c = document.createElement('canvas'); c.width = c.height = Q; var g = c.getContext('2d'), im = g.createImageData(Q, Q), o = im.data;
      for (j = 0; j < Q; j++) for (i = 0; i < Q; i++) {
        var gi = Q + i, gj = Q + j, e = el[gj * G + gi]; if (!ok[gj * G + gi]) continue;
        var x0 = gi - r, x1 = gi + r + 1, y0 = gj - r, y1 = gj + r + 1;
        var cnt = N[y1 * W1 + x1] - N[y0 * W1 + x1] - N[y1 * W1 + x0] + N[y0 * W1 + x0]; if (cnt < 9) continue;
        var low = e - (S[y1 * W1 + x1] - S[y0 * W1 + x1] - S[y1 * W1 + x0] + S[y0 * W1 + x0]) / cnt;
        var sx = (el[gj * G + gi + 1] - el[gj * G + gi - 1]) / (2 * cell), sy = (el[(gj + 1) * G + gi] - el[(gj - 1) * G + gi]) / (2 * cell), deg = Math.atan(Math.sqrt(sx * sx + sy * sy)) * 57.2958;
        var col = deg < 4 && low < -60 ? [91, 124, 250, 125] : (deg < 6 && low < -20) || (deg < 2 && low < -6) ? [169, 193, 255, 115] : null;
        if (col) { k = (j * Q + i) * 4; o[k] = col[0]; o[k + 1] = col[1]; o[k + 2] = col[2]; o[k + 3] = col[3]; }
      }
      g.putImageData(im, 0, 0);
      return new Promise(function (done) { c.toBlob(function (bl) { bl.arrayBuffer().then(function (ab) { done({ data: ab }); }); }, 'image/png'); });
    });
  }

  // The layers that are switched on and off, put into the style where they belong: areas under the roads, lines over
  // them, signs and dots on top.
  function addOverlays(S, cfg, dem, V) {
    var L = S.layers, at = function (id) { for (var i = 0; i < L.length; i++) if (L[i].id === id) return i; return -1; };
    var src = {}, zw = function (stops) { var o = ['interpolate', ['exponential', 1.6], ['zoom']]; stops.forEach(function (s) { o.push(s[0], s[1]); }); return o; };
    (cfg.overlays || []).forEach(function (o) {
      S.sources['ov-' + o.group] = o.raster ? { type: 'raster', url: 'pmtiles://' + DATA + o.file + V, tileSize: 256 } : { type: 'vector', url: 'pmtiles://' + DATA + o.file + V };
      o.layers.forEach(function (l) { src[l] = 'ov-' + o.group; });
    });
    var mk = function (id, type, layer, paint, extra) { var l = { id: id, type: type, source: src[layer], 'source-layer': layer, paint: paint }; if (extra) Object.keys(extra).forEach(function (k) { l[k] = extra[k]; }); return l; };
    var match = function (prop, table, other) { var m = ['match', ['get', prop]]; Object.keys(table).forEach(function (k) { m.push(k, table[k][0]); }); m.push(other); return m; };
    var fills = [], lines = [], tops = [];
    if (src.timber) fills.push({ id: 'timber', type: 'raster', source: src.timber, paint: { 'raster-opacity': 0.6, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } });
    if (src.rocks) fills.push(mk('rocks', 'fill', 'rocks', { 'fill-color': match('k', ROCK, '#cccccc'), 'fill-opacity': 0.5, 'fill-outline-color': 'rgba(60,60,60,.45)' }));
    if (src.deer_elk) fills.push(mk('deer-elk', 'fill', 'deer_elk', { 'fill-color': match('k', HAB, '#cccccc'), 'fill-opacity': 0.38 }));
    if (src.soils) fills.push(mk('soils', 'fill', 'soils', { 'fill-color': ['match', ['get', 'c'], 1, '#1b7f3b', 2, '#1b7f3b', 3, '#7cb342', '#c0ca33'], 'fill-opacity': 0.45 }));
    if (src.landslides) fills.push(mk('landslides', 'fill', 'landslides', { 'fill-color': '#8d5524', 'fill-opacity': 0.4, 'fill-outline-color': '#5d3310' }));
    if (src.flood) fills.push(mk('flood', 'fill', 'flood', { 'fill-color': '#3b82f6', 'fill-opacity': 0.32 }));
    if (src.fires) {
      fills.push(mk('fires', 'fill', 'fires', { 'fill-color': ['step', ['to-number', ['get', 'y'], 0], '#8d7b68', 2000, '#d9a02b', 2010, '#e8590c', 2020, '#c92a2a'], 'fill-opacity': 0.42 }));
      fills.push(mk('fires-line', 'line', 'fires', { 'line-color': ['step', ['to-number', ['get', 'y'], 0], '#5c4f42', 2000, '#8a5a00', 2010, '#a33a00', 2020, '#8f1d1d'], 'line-width': 1.6, 'line-opacity': 0.85 }));
    }
    if (dem) {
      ['steep', 'sunny', 'frost'].forEach(function (w) {
        S.sources[w] = { type: 'raster', tiles: ['ark-slope://' + w + '/{z}/{x}/{y}'], tileSize: 512, minzoom: 9, maxzoom: cfg.terrain.maxzoom, bounds: cfg.bbox };
        fills.push({ id: w, type: 'raster', source: w, minzoom: 9, paint: { 'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } });
      });
    }
    if (src.fish) {
      lines.push(mk('fish-trout', 'line', 'fish', { 'line-color': '#845ef7', 'line-width': zw([[9, 3], [14, 7]]), 'line-opacity': 0.4 }, { filter: ['==', ['get', 'k'], 'trout'], layout: { 'line-cap': 'round' } }));
      lines.push(mk('fish-salmon', 'line', 'fish', { 'line-color': '#e8590c', 'line-width': zw([[9, 3], [14, 7]]), 'line-opacity': 0.45 }, { filter: ['==', ['get', 'k'], 'salmon'], layout: { 'line-cap': 'round' } }));
    }
    if (src.streams) {
      lines.push(mk('streams-s', 'line', 'streams', { 'line-color': '#5aa9e6', 'line-width': zw([[12, 1], [15, 1.8]]), 'line-dasharray': [3, 2] }, { filter: ['in', ['get', 'k'], ['literal', ['s', 'u']]] }));
      lines.push(mk('streams-d', 'line', 'streams', { 'line-color': '#00897b', 'line-width': 1.4, 'line-dasharray': [1, 1.5] }, { filter: ['==', ['get', 'k'], 'd'] }));
      lines.push(mk('streams-y', 'line', 'streams', { 'line-color': '#1565c0', 'line-width': zw([[9, 1], [12, 1.8], [15, 3]]) }, { filter: ['==', ['get', 'k'], 'y'] }));
    }
    if (src.sections) {
      lines.push(mk('sections', 'line', 'sections', { 'line-color': '#555', 'line-width': 0.8, 'line-dasharray': [4, 3], 'line-opacity': 0.8 }, { minzoom: 11 }));
      if (src.townships) lines.push(mk('townships', 'line', 'townships', { 'line-color': '#333', 'line-width': 1.6, 'line-opacity': 0.7 }));
    }
    if (src.backroads) lines.push(mk('backroads', 'line', 'backroads', { 'line-color': match('k', ROAD, '#868e96'), 'line-width': zw([[11, 2.5], [14, 5.5], [17, 9]]), 'line-opacity': 0.6 },
      { minzoom: 11, layout: { 'line-cap': 'round', 'line-join': 'round' } }));
    if (src.hunt_units) lines.push(mk('hunt-units', 'line', 'hunt_units', { 'line-color': '#3f6212', 'line-width': zw([[7, 1.6], [13, 3]]), 'line-dasharray': [4, 2], 'line-opacity': 0.9 }));
    if (src.escape) lines.push(mk('escape', 'line', 'escape', { 'line-color': '#2f9e44', 'line-width': zw([[9, 2.5], [14, 5]]), 'line-opacity': 0.75 }, { layout: { 'line-cap': 'round', 'line-join': 'round' } }));
    if (src.routes) lines.push(mk('routes', 'line', 'routes', { 'line-color': '#7b2cbf', 'line-width': zw([[8, 2], [14, 4]]), 'line-dasharray': [2, 1.5], 'line-opacity': 0.85 }));
    var dot = function (id, layer, color, minzoom) { return mk(id, 'circle', layer, { 'circle-color': color, 'circle-radius': zw([[10, 3.2], [14, 5.5]]), 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 }, minzoom ? { minzoom: minzoom } : null); };
    var sign = function (id, layer, icon, minzoom) {
      return mk(id, 'symbol', layer, { 'text-color': '#222', 'text-halo-color': 'rgba(255,255,255,.9)', 'text-halo-width': 1.4 }, { minzoom: minzoom || 9,
        layout: { 'icon-image': icon, 'icon-size': zw([[9, 0.6], [14, 0.95]]), 'icon-allow-overlap': true, 'text-field': ['step', ['zoom'], '', 13, ['coalesce', ['get', 'n'], '']], 'text-font': ['Noto Sans Regular'],
          'text-size': 11.5, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 8 } });
    };
    if (src.backroad_labels) tops.push(mk('backroad-nums', 'symbol', 'backroad_labels', { 'text-color': '#1f1f1f', 'text-halo-color': 'rgba(255,255,255,.95)', 'text-halo-width': 2 }, { minzoom: 12,
      layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Medium'], 'text-size': zw([[12, 10], [15, 12.5]]), 'text-padding': 3 } }));
    if (src.hunt_units) tops.push(mk('hunt-unit-names', 'symbol', 'hunt_units', { 'text-color': '#2f4a0d', 'text-halo-color': 'rgba(255,255,255,.9)', 'text-halo-width': 1.6 },
      { layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['get', 'n'], ' unit'], 'text-font': ['Noto Sans Medium'], 'text-size': 12.5, 'symbol-spacing': 420, 'text-offset': [0, 0.9], 'text-max-angle': 30 } }));
    if (src.game) tops.push(dot('game', 'game', match('k', GAME, '#666')));
    if (src.wells) tops.push(dot('wells', 'wells', ['step', ['to-number', ['get', 'd'], 0], '#2b8a3e', 75, '#f08c00', 200, '#c92a2a'], 12));
    if (src.wildfood) tops.push(dot('wildfood', 'wildfood', match('k', { nut: ['#8d6e63'], berry: ['#7b1fa2'], fruit: ['#d81b60'], root: ['#ef6c00'], green: ['#2e7d32'], mushroom: ['#b08d57'] }, '#666')));
    if (src.mines) { var md = dot('mines', 'mines', match('k', { gold: ['#f5b301'], chrome: ['#607d8b'], copper: ['#bf5b17'], lime: ['#e0e0e0'], clay: ['#a1543f'], stone: ['#9e9e9e'], coal: ['#212121'], metal: ['#455a64'], mineral: ['#ec407a'] }, '#777')); md.paint['circle-stroke-color'] = '#222'; tops.push(md); }
    if (src.section_labels) tops.push(mk('section-labels', 'symbol', 'section_labels', { 'text-color': '#444', 'text-halo-color': 'rgba(255,255,255,.8)', 'text-halo-width': 1.2 }, { minzoom: 12, layout: { 'text-field': ['get', 's'], 'text-font': ['Noto Sans Medium'], 'text-size': 12 } }));
    if (src.springs) tops.push(sign('springs', 'springs', ['match', ['get', 'k'], 'fall', 'b-fall', 'b-spring'], 10));
    if (src.dams) tops.push(sign('dams', 'dams', 'b-dam', 9));
    if (src.places) tops.push(sign('poi', 'places', ['concat', 'b-', ['get', 'k']], 11));
    if (src.gates) tops.push(sign('gates', 'gates', ['concat', 'b-', ['get', 'k']], 11));
    if (src.towers) tops.push(sign('towers', 'towers', ['concat', 'b-', ['get', 'k']], 9));
    S.sources.measure = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
    S.sources.pins = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
    S.sources['shared-pins'] = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
    tops.push({ id: 'measure-line', type: 'line', source: 'measure', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#0b7285', 'line-width': 3.5, 'line-dasharray': [2, 1] } });
    tops.push({ id: 'measure-pts', type: 'circle', source: 'measure', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#0b7285', 'circle-stroke-width': 3 } });
    tops.push({ id: 'pins', type: 'symbol', source: 'pins', layout: { 'icon-image': 'b-pin', 'icon-size': 1, 'icon-allow-overlap': true, 'icon-anchor': 'bottom', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12.5,
      'text-offset': [0, 0.3], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#7a1f1f', 'text-halo-color': '#fff', 'text-halo-width': 1.6 } });
    tops.push({ id: 'shared-pins', type: 'symbol', source: 'shared-pins', layout: { 'icon-image': 'b-shared', 'icon-size': 1, 'icon-allow-overlap': true, 'icon-anchor': 'bottom', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12.5,
      'text-offset': [0, 0.3], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#0b4f6c', 'text-halo-color': '#fff', 'text-halo-width': 1.6 } });
    var i = at('hillshade'); if (i < 0) i = at('water'); L.splice.apply(L, [i, 0].concat(fills));
    i = at('rail'); L.splice.apply(L, [i + 1, 0].concat(lines));
    tops.forEach(function (l) { L.push(l); });
  }

  // The same map for the receipt printer: no colours, so everything is told apart by the kind of line. Roads are solid
  // (main roads a double line), forest tracks dashed, trails dotted, creeks dash-dot, contour lines thin, tax lots long
  // dashes, public-land edges short heavy dashes, water a pattern of dots (blackAndWhite makes it from the grey).
  function printStyle(cfg, dem, on) {
    var FONT = ['Noto Sans Regular'], BOLD = ['Noto Sans Medium'], ITAL = ['Noto Sans Italic'], V = cfg.v ? '?v=' + cfg.v : '';
    var kind = function (v) { return ['==', ['get', 'kind'], v]; }, kinds = function (a) { return ['in', ['get', 'kind'], ['literal', a]]; };
    var detail = function (a) { return ['in', ['get', 'kind_detail'], ['literal', a]]; };
    var S = { version: 8, glyphs: new URL('fonts/', location.href).href + '{fontstack}/{range}.pbf', sources: { streets: { type: 'vector', url: 'pmtiles://' + DATA + cfg.streets + (cfg.streetsV ? '?v=' + cfg.streetsV : V) } }, layers: [] };
    var L = S.layers, prop = cfg.property, K = '#000';
    var line = function (id, src, layer, filter, w, dash, minzoom, color) {
      var l = { id: id, type: 'line', source: src, 'source-layer': layer, layout: { 'line-join': 'round' }, paint: { 'line-color': color || K, 'line-width': w } };
      if (filter) l.filter = filter; if (dash) l.paint['line-dasharray'] = dash; if (minzoom) l.minzoom = minzoom; L.push(l);
    };
    L.push({ id: 'bg', type: 'background', paint: { 'background-color': '#fff' } });
    L.push({ id: 'water', type: 'fill', source: 'streets', 'source-layer': 'water', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#c8c8c8', 'fill-antialias': false } });
    if (dem && on.contours) {
      S.sources.contours = { type: 'vector', maxzoom: 15, bounds: cfg.bbox, tiles: [dem.contourProtocolUrl({ multiplier: 3.28084, overzoom: 1, elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours',
        thresholds: { 10: [200, 1000], 12: [80, 400], 13: [40, 200] } })] };
      L.push({ id: 'contour-lines', type: 'line', source: 'contours', 'source-layer': 'contours', minzoom: 10, paint: { 'line-color': K, 'line-width': ['match', ['get', 'level'], 1, 1.3, 0.55] } });
    }
    line('streams', 'streets', 'water', ['all', ['==', ['geometry-type'], 'LineString'], kinds(['stream', 'canal', 'ditch', 'drain'])], 1.2, [5, 2, 1, 2], 11);
    line('rivers', 'streets', 'water', ['all', ['==', ['geometry-type'], 'LineString'], kind('river')], 1.8, [6, 2, 1, 2]);
    if (prop) S.sources.property = { type: 'vector', url: 'pmtiles://' + DATA + prop.file + V };
    if (prop && prop.ownership && on.own) {
      var pub = ['in', ['get', 'own'], ['literal', Object.keys(OWN).filter(function (c) { return OWN[c][1]; })]];
      line('own-line', 'property', 'ownership', pub, 2, [1, 1.6], 9);
    }
    if (prop && prop.parcels && on.parcels) line('parcel-lines', 'property', 'parcels', null, 0.9, [7, 4], 12);
    L.push({ id: 'buildings', type: 'fill', source: 'streets', 'source-layer': 'buildings', filter: ['==', ['geometry-type'], 'Polygon'], minzoom: 14, paint: { 'fill-color': K } });
    var minor = ['all', kind('minor_road'), ['!', detail(['service'])]], svc = ['all', kind('minor_road'), detail(['service'])];
    var big = ['any', kind('highway'), ['all', kind('major_road'), detail(['trunk', 'trunk_link', 'primary', 'primary_link'])]];
    var mid = ['all', kind('major_road'), detail(['secondary', 'secondary_link', 'tertiary', 'tertiary_link'])];
    line('trail', 'streets', 'roads', ['all', kind('path'), ['!', detail(['track', 'driveway', 'pier', 'steps'])]], 1.2, [1, 2], 12);
    line('track', 'streets', 'roads', ['all', kind('path'), detail(['track'])], 1.3, [4, 2], 11);
    line('svc', 'streets', 'roads', svc, 0.9, null, 13);
    line('minor', 'streets', 'roads', minor, 1.6, null, 11);
    line('mid', 'streets', 'roads', mid, 2.6);
    line('big-case', 'streets', 'roads', big, 4.6);
    line('big', 'streets', 'roads', big, 1.8, null, 0, '#fff');
    line('rail', 'streets', 'roads', kind('rail'), 1.4, [8, 3]);
    line('county', 'streets', 'boundaries', kinds(['county', 'region', 'country']), 1.4, [8, 3, 2, 3]);
    var label = function (id, src, layer, filter, layout, minzoom) {
      var l = { id: id, type: 'symbol', source: src, 'source-layer': layer, filter: filter,
        layout: Object.assign({ 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 12, 'text-max-width': 8 }, layout), paint: { 'text-color': K, 'text-halo-color': '#fff', 'text-halo-width': 2 } };
      if (minzoom) l.minzoom = minzoom; L.push(l);
    };
    if (dem && on.contours) label('contour-labels', 'contours', 'contours', ['>', ['get', 'level'], 0], { 'symbol-placement': 'line', 'text-size': 11, 'text-field': ['number-format', ['get', 'ele'], {}], 'symbol-spacing': 300, 'text-max-angle': 28 }, 12);
    label('creek-names', 'streets', 'water', ['all', ['==', ['geometry-type'], 'LineString'], ['has', 'name']], { 'symbol-placement': 'line', 'text-font': ITAL, 'text-size': 12, 'symbol-spacing': 350 }, 11);
    label('lake-names', 'streets', 'water', ['all', ['==', ['geometry-type'], 'Polygon'], ['has', 'name']], { 'text-font': ITAL, 'text-size': 12 }, 11);
    label('road-names', 'streets', 'roads', ['has', 'name'], { 'symbol-placement': 'line', 'text-size': 11.5, 'symbol-spacing': 300 }, 12);
    label('shields', 'streets', 'roads', ['all', ['has', 'ref'], big], { 'symbol-placement': 'line', 'text-field': ['get', 'ref'], 'text-font': BOLD, 'text-size': 12, 'symbol-spacing': 420 }, 8);
    L.push({ id: 'peak-dots', type: 'circle', source: 'streets', 'source-layer': 'pois', filter: kind('peak'), minzoom: 11, paint: { 'circle-radius': 3, 'circle-color': K, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
    label('peaks', 'streets', 'pois', ['all', kind('peak'), ['has', 'name']], { 'text-offset': [0, 0.5], 'text-anchor': 'top', 'text-size': 12,
      'text-field': ['case', ['has', 'elevation'], ['concat', ['get', 'name'], '\n', ['number-format', ['round', ['*', ['to-number', ['get', 'elevation']], 3.28084]], {}], ' ft'], ['get', 'name']] }, 11);
    label('places', 'streets', 'places', kind('locality'), { 'text-font': BOLD, 'text-size': 15, 'symbol-sort-key': ['get', 'min_zoom'] });
    return S;
  }

  function style(cfg, dem) {
    var FONT = ['Noto Sans Regular'], BOLD = ['Noto Sans Medium'], ITAL = ['Noto Sans Italic'];
    var V = cfg.v ? '?v=' + cfg.v : '';   // the files' version: a saved copy of an older map isn't used for a newer one
    var kind = function (v) { return ['==', ['get', 'kind'], v]; }, kinds = function (a) { return ['in', ['get', 'kind'], ['literal', a]]; };
    var detail = function (a) { return ['in', ['get', 'kind_detail'], ['literal', a]]; };
    var zw = function (stops) { var o = ['interpolate', ['exponential', 1.6], ['zoom']]; stops.forEach(function (s) { o.push(s[0], s[1]); }); return o; };
    var S = { version: 8, glyphs: new URL('fonts/', location.href).href + '{fontstack}/{range}.pbf',
      sources: { streets: { type: 'vector', url: 'pmtiles://' + DATA + cfg.streets + (cfg.streetsV ? '?v=' + cfg.streetsV : V), attribution: '© OpenStreetMap contributors' } }, layers: [] };
    var L = S.layers, prop = cfg.property;
    if (prop) S.sources.property = { type: 'vector', url: 'pmtiles://' + DATA + prop.file + V };
    if (dem) {
      S.sources.dem = { type: 'raster-dem', encoding: 'terrarium', tiles: [dem.sharedDemProtocolUrl], maxzoom: cfg.terrain.maxzoom, tileSize: 512, bounds: cfg.bbox };
      // feet: 200 ft lines from far out, 40 ft lines (every 5th one heavy) close in, as on a USGS quad
      S.sources.contours = { type: 'vector', maxzoom: 15, bounds: cfg.bbox, attribution: '© Mapterhorn', tiles: [dem.contourProtocolUrl({ multiplier: 3.28084, overzoom: 1, elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours',
        thresholds: { 10: [200, 1000], 12: [80, 400], 13: [40, 200] } })] };
    }
    L.push({ id: 'bg', type: 'background', paint: { 'background-color': '#f6f3e9' } });
    L.push({ id: 'woods', type: 'fill', source: 'streets', 'source-layer': 'landuse', filter: kinds(['wood', 'forest', 'scrub']), paint: { 'fill-color': '#dcebcc', 'fill-opacity': 0.8 } });
    L.push({ id: 'open', type: 'fill', source: 'streets', 'source-layer': 'landuse', filter: kinds(['farmland', 'meadow', 'grass', 'grassland', 'park', 'golf_course', 'recreation_ground', 'cemetery', 'pitch']), paint: { 'fill-color': '#eef0d3', 'fill-opacity': 0.8 } });
    L.push({ id: 'town', type: 'fill', source: 'streets', 'source-layer': 'landuse', filter: kinds(['residential', 'commercial', 'industrial', 'school']), paint: { 'fill-color': '#ece6da', 'fill-opacity': 0.8 } });
    L.push({ id: 'wetland', type: 'fill', source: 'streets', 'source-layer': 'landuse', filter: kind('wetland'), paint: { 'fill-color': '#cfe6e0', 'fill-opacity': 0.8 } });
    if (prop && prop.ownership) {
      var col = ['match', ['get', 'own']]; Object.keys(OWN).forEach(function (c) { if (OWN[c][1]) col.push(c, OWN[c][1]); }); col.push('rgba(0,0,0,0)');
      var pub = ['in', ['get', 'own'], ['literal', Object.keys(OWN).filter(function (c) { return OWN[c][1]; })]];
      L.push({ id: 'own-fill', type: 'fill', source: 'property', 'source-layer': 'ownership', filter: pub, paint: { 'fill-color': col, 'fill-opacity': 0.5 } });
      L.push({ id: 'own-hit', type: 'fill', source: 'property', 'source-layer': 'ownership', filter: ['!', pub], paint: { 'fill-color': '#000', 'fill-opacity': 0 } });
    }
    if (dem) L.push({ id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.32, 'hillshade-shadow-color': '#4a3f2e', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#6b5d48' } });
    L.push({ id: 'water', type: 'fill', source: 'streets', 'source-layer': 'water', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#b8d8f0' } });
    L.push({ id: 'streams', type: 'line', source: 'streets', 'source-layer': 'water', filter: ['all', ['==', ['geometry-type'], 'LineString'], kinds(['stream', 'canal', 'ditch', 'drain'])], minzoom: 11,
      paint: { 'line-color': '#4f93cf', 'line-width': zw([[11, 0.5], [14, 1.1], [17, 2.5]]) } });
    L.push({ id: 'rivers', type: 'line', source: 'streets', 'source-layer': 'water', filter: ['all', ['==', ['geometry-type'], 'LineString'], kind('river')],
      paint: { 'line-color': '#4f93cf', 'line-width': zw([[8, 0.8], [12, 1.8], [16, 4]]) } });
    if (dem) {
      L.push({ id: 'contour-lines', type: 'line', source: 'contours', 'source-layer': 'contours', minzoom: 10,
        paint: { 'line-color': '#9a5b22', 'line-opacity': ['match', ['get', 'level'], 1, 0.75, 0.42], 'line-width': ['match', ['get', 'level'], 1, 1.15, 0.6] } });
    }
    if (prop && prop.ownership) L.push({ id: 'own-line', type: 'line', source: 'property', 'source-layer': 'ownership', minzoom: 9, paint: { 'line-color': '#7a6a3a', 'line-opacity': 0.45, 'line-width': 0.8 } });
    L.push({ id: 'county', type: 'line', source: 'streets', 'source-layer': 'boundaries', filter: kinds(['county', 'region', 'country']), paint: { 'line-color': '#8a7fa8', 'line-dasharray': [5, 3], 'line-width': 1.2 } });
    L.push({ id: 'buildings', type: 'fill', source: 'streets', 'source-layer': 'buildings', filter: ['==', ['geometry-type'], 'Polygon'], minzoom: 14, paint: { 'fill-color': '#c9c2b2' } });
    if (prop && prop.parcels) {
      L.push({ id: 'parcel-hit', type: 'fill', source: 'property', 'source-layer': 'parcels', minzoom: 12, paint: { 'fill-color': '#000', 'fill-opacity': 0 } });
      L.push({ id: 'parcel-lines', type: 'line', source: 'property', 'source-layer': 'parcels', minzoom: 12,
        paint: { 'line-color': '#d9480f', 'line-opacity': zw([[12, 0.35], [14, 0.75]]), 'line-width': zw([[12, 0.4], [14, 0.9], [17, 1.8]]) } });
    }
    // roads: forest tracks dashed, trails dotted, as on a topo map
    var road = function (id, filter, color, w, extra) {
      var l = { id: id, type: 'line', source: 'streets', 'source-layer': 'roads', filter: filter, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': zw(w) } };
      if (extra) Object.keys(extra).forEach(function (k) { if (k === 'minzoom') l.minzoom = extra[k]; else if (k === 'cap') l.layout['line-cap'] = extra[k]; else l.paint[k] = extra[k]; });
      L.push(l);
    };
    var minor = ['all', kind('minor_road'), ['!', detail(['service'])]], svc = ['all', kind('minor_road'), detail(['service'])];
    var big = ['any', kind('highway'), ['all', kind('major_road'), detail(['trunk', 'trunk_link', 'primary', 'primary_link'])]];
    var mid = ['all', kind('major_road'), detail(['secondary', 'secondary_link', 'tertiary', 'tertiary_link'])];
    var track = ['all', kind('path'), detail(['track'])], trail = ['all', kind('path'), ['!', detail(['track', 'driveway', 'pier', 'steps'])]];
    road('trail', trail, '#5b4636', [[12, 0.8], [15, 1.4], [18, 2.5]], { 'line-dasharray': [1, 2], minzoom: 12, cap: 'butt' });
    road('track', track, '#6b5540', [[11, 0.6], [14, 1.3], [18, 3]], { 'line-dasharray': [4, 2], minzoom: 11, cap: 'butt' });
    road('svc-case', svc, '#a59d8f', [[13, 1], [15, 2.4], [18, 6.4]], { minzoom: 13 });
    road('svc', svc, '#ffffff', [[13, 0.5], [15, 1.4], [18, 5]], { minzoom: 13 });
    road('minor-case', minor, '#9b9488', [[11, 0.9], [14, 3], [18, 13]], { minzoom: 11 });
    road('mid-case', mid, '#8f7d54', [[8, 1], [12, 3], [15, 6], [18, 17]]);
    road('big-case', big, '#8a4b3c', [[7, 1.4], [12, 4], [15, 8], [18, 20]]);
    road('minor', minor, '#ffffff', [[11, 0.5], [14, 2], [18, 11]], { minzoom: 11 });
    road('mid', mid, '#fbe9a6', [[8, 0.5], [12, 2], [15, 4.5], [18, 15]]);
    road('big', big, '#f3b3a0', [[7, 0.8], [12, 2.8], [15, 6.5], [18, 18]]);
    L.push({ id: 'rail', type: 'line', source: 'streets', 'source-layer': 'roads', filter: kind('rail'), paint: { 'line-color': '#555', 'line-dasharray': [6, 3], 'line-width': 1.2 } });
    // names
    var label = function (id, layer, filter, layout, paint, minzoom) {
      var l = { id: id, type: 'symbol', source: 'streets', 'source-layer': layer, filter: filter,
        layout: Object.assign({ 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 12, 'text-max-width': 8 }, layout),
        paint: Object.assign({ 'text-color': '#333', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.4 }, paint || {}) };
      if (minzoom) l.minzoom = minzoom; L.push(l);
    };
    if (dem) L.push({ id: 'contour-labels', type: 'symbol', source: 'contours', 'source-layer': 'contours', minzoom: 12, filter: ['>', ['get', 'level'], 0],
      layout: { 'symbol-placement': 'line', 'text-size': 10.5, 'text-font': FONT, 'text-field': ['number-format', ['get', 'ele'], {}], 'symbol-spacing': 320, 'text-max-angle': 28 },
      paint: { 'text-color': '#7a4516', 'text-halo-color': 'rgba(246,243,233,0.9)', 'text-halo-width': 1.5 } });
    label('creek-names', 'water', ['all', ['==', ['geometry-type'], 'LineString'], ['has', 'name']], { 'symbol-placement': 'line', 'text-font': ITAL, 'text-size': 11.5, 'symbol-spacing': 350, 'text-letter-spacing': 0.05 }, { 'text-color': '#22639c' }, 11);
    label('lake-names', 'water', ['all', ['==', ['geometry-type'], 'Polygon'], ['has', 'name']], { 'text-font': ITAL, 'text-size': 11.5 }, { 'text-color': '#22639c' }, 11);
    label('road-names', 'roads', ['all', ['has', 'name'], ['!', kind('path')]], { 'symbol-placement': 'line', 'text-size': zw([[12, 10], [16, 13]]), 'symbol-spacing': 300 }, { 'text-color': '#4a4136' }, 12);
    label('track-names', 'roads', ['all', ['has', 'name'], kind('path')], { 'symbol-placement': 'line', 'text-size': 10.5, 'symbol-spacing': 300 }, { 'text-color': '#5b4636' }, 13);
    label('shields', 'roads', ['all', ['has', 'ref'], big], { 'symbol-placement': 'line', 'text-field': ['get', 'ref'], 'text-font': BOLD, 'text-size': 10.5, 'symbol-spacing': 420, 'text-rotation-alignment': 'viewport' },
      { 'text-color': '#7a2d1c', 'text-halo-width': 2 }, 8);
    L.push({ id: 'peak-dots', type: 'circle', source: 'streets', 'source-layer': 'pois', filter: kind('peak'), minzoom: 11, paint: { 'circle-radius': 2.6, 'circle-color': '#6b3e12', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
    label('peaks', 'pois', ['all', kind('peak'), ['has', 'name']], { 'text-offset': [0, 0.5], 'text-anchor': 'top', 'text-size': 11.5,
      'text-field': ['case', ['has', 'elevation'], ['concat', ['get', 'name'], '\n', ['number-format', ['round', ['*', ['to-number', ['get', 'elevation']], 3.28084]], {}], ' ft'], ['get', 'name']] },
      { 'text-color': '#5a3410' }, 11);
    label('pois', 'pois', ['all', ['has', 'name'], ['!', kinds(['peak', 'residential', 'water', 'district', 'administrative', 'path'])]], { 'text-size': 11, 'text-offset': [0, 0.3], 'text-anchor': 'top' }, { 'text-color': '#3d5a3a' }, 13);
    label('places', 'places', kind('locality'), { 'text-font': BOLD, 'symbol-sort-key': ['get', 'min_zoom'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 8, ['case', ['<=', ['to-number', ['get', 'min_zoom'], 12], 8], 13, 10.5], 14, ['case', ['<=', ['to-number', ['get', 'min_zoom'], 12], 8], 19, 14]] },
      { 'text-color': '#1f1f1f', 'text-halo-width': 1.8 });
    addOverlays(S, cfg, dem, V);
    return S;
  }
})();
