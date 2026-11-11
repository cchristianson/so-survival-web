# The map in the web browser

`MAP.html` is the library's own map: it runs in any web browser, on the website and from the drive
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

Only tax-lot outlines, lot numbers and acres are fetched: never owners' names, addresses or values.
On the website the files are in `maps/` (the height tiles also as plain files in `maps/terrain/`, since
a website has no program to hand them out one at a time); on the drive in `Map/data/`, where the
Library Assistant hands out the height tiles (`/maptiles/...`, `maptiles.go`).
