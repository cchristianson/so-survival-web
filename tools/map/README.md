# The map in the web browser

`MAP.html` (with `map.js`) is the library's own map: it runs in any web browser, on the website and from the drive
(through the Library Assistant, at `/lib/Map/MAP.html`), with no app and no internet.

## What draws it (unmodified files from npm, bundled so the map works offline)

| File | From | License |
|---|---|---|
| `maplibre-gl.js`, `maplibre-gl.css` | `maplibre-gl@4.7.1` (https://github.com/maplibre/maplibre-gl-js) | BSD 3-Clause (`LICENSE-maplibre-gl.txt`) |
| `pmtiles.js` | `pmtiles@4.5.0`, `dist/pmtiles.js` (https://github.com/protomaps/PMTiles) | BSD 3-Clause |
| `maplibre-contour.js` | `maplibre-contour@0.1.1`, `dist/index.min.js` (https://github.com/onthegomap/maplibre-contour) | BSD 3-Clause (`LICENSE-maplibre-contour.txt`) |
| `fonts/` | Noto Sans glyphs from https://github.com/protomaps/basemaps-assets | SIL Open Font License (`fonts/OFL.txt`) |

## The map's files (made by `tools/maintenance/build_map.py`, kept in `build-cache/maps/`)

| File | What | From |
|---|---|---|
| `<area>-streets.pmtiles` | roads, trails, water, towns, names | OpenStreetMap contributors (ODbL), as the Protomaps basemap (https://protomaps.com) |
| `<area>-terrain.pmtiles` | ground heights; the browser draws the contour lines and hill shading from them | Mapterhorn (https://mapterhorn.com; in the US, USGS 3DEP) |
| `<area>-property.pmtiles` | tax-lot outlines and who manages the land | the public map servers named in the area's `region.json` (`web_map`) |
| `<area>-places.json` | names to search for | taken from the streets file |
| `<area>-addresses.json` | house numbers to search for, by street, each with the middle of its lot | the tax-lot server named in `region.json` (`web_map.addresses`): the lot's own street address only, no names |
| `<area>-water.pmtiles` | creeks (year-round or seasonal), springs, wells, dams | USGS National Hydrography Dataset; the state's well reports and dam inventory |
| `<area>-food.pmtiles` | good growing ground, wild food sightings, fish streams | USDA NRCS Soil Survey; iNaturalist (research grade, open positions only); the state's fish habitat map |
| `<area>-materials.pmtiles` | rock types; mines, quarries and mineral sites | USGS State Geologic Map Compilation; the state geology agency |
| `<area>-hazards.pmtiles` | past wildfires, flood zones, old landslides | National Interagency Fire Center; FEMA; the state geology agency |
| `<area>-places.pmtiles` | useful places and bridges; radio towers and fire lookouts | OpenStreetMap (from the streets file); the county; USDA Forest Service; FCC licences as gathered by the National Interagency Fire Center; the state forestry agency |
| `<area>-travel.pmtiles` | walking routes, section grid, escape routes; forest and BLM roads (number, whether they can be driven), gates and road blocks | the library's routes; BLM's land survey; the county; USDA Forest Service; BLM |
| `<area>-game.pmtiles` | hunting units, deer and elk habitat, game sightings | the state wildlife agency; iNaturalist (research grade, open positions only) |
| `<area>-timber.pmtiles` | what grows where, as pictures (PNG tiles, a dozen kinds) | LANDFIRE existing vegetation type (30 m) |

On the **website** the page's programs get their version in their names (`map.js` becomes `map.1a2b3c4d.js`; the
website build does it), because a phone's saved copy of a file is never asked for again: a changed program must be
a new file. The page itself, `index.json`, the place names and the addresses are asked for afresh whenever there
is a network. On a drive nothing is saved by the browser, so the names stay plain.

**Frost pockets**, like steep ground and sunny slopes, are worked out in the browser from the height tiles
(`frostTile` in `map.js`). **Shared pins** are kept by the Library Assistant (`/api/pins`, `pins.go`, in
`map-pins.json` next to its `settings.json`), so they only exist on a drive or an ARK Vault, not on the website.

Of tax lots, the outlines, lot numbers and acres are fetched, and the owner's name where the area's
`region.json` names that field (`web_map.parcels.owner`): never mailing addresses or values.
A drive can also hold a **bigger map** (streets and heights for a wide area, `wide-*.pmtiles` and `wide.json`
in `Map/data/`): the Library Assistant cuts it out of the same two world maps on request (Settings > A bigger
map, `mapwide.go`); what area is `web_map.wide` in `region.json`. Over a shared library the page can move to
the Library Assistant's https address (`secure.go`), where a phone will give its position.

On the website the files are in `maps/` (the height tiles also as plain files in `maps/terrain/`, since
a website has no program to hand them out one at a time); on the drive in `Map/data/`, where the
Library Assistant hands out the height tiles (`/maptiles/...`, `maptiles.go`).
