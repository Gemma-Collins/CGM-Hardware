# Veggie Garden Planner

A browser-based planner for laying out vegetable/fruit gardens and figuring
out what to plant, where, and when — aiming for a continuous harvest through
the year at your specific location.

No build step, no backend, no account. It's static HTML/CSS/JS that talks
directly to a couple of free, keyless public APIs from the browser, and
keeps all your data in `localStorage`.

## Running it

Because it fetches `data/plants.json` and uses ES modules, open it through a
local static server rather than as a `file://` URL:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

## What it does

1. **Location & Site** — search for your city/address. This geocodes it
   (Open-Meteo Geocoding API) and pulls ~5 years of daily historical weather
   (Open-Meteo Archive API) to estimate your average last spring frost,
   first fall frost, monthly temperatures, and rainfall. Soil pH and texture
   come from ISRIC SoilGrids for your exact coordinates, with a manual
   override if you've had your soil tested.

2. **Garden Layout** — draw your garden to scale: set a scale by drawing a
   line over something of known length, then draw rectangle or freehand
   polygon beds. Each bed gets a name, sun exposure, and optional soil pH
   override, and its area is computed in square feet.

3. **What to Grow** — pick plants from the built-in database (24 common
   vegetables/fruits/herbs) and say when you want to be harvesting them
   (e.g. "lettuce, March through November").

4. **Feasibility & Calendar** — for each wishlist item, the planner checks
   your site's frost-free season, temperatures, and soil pH against that
   plant's requirements, and generates a planting schedule (including
   succession sowings, e.g. lettuce every 2 weeks) aimed at covering your
   requested harvest window. Each result is marked feasible / partially
   feasible / not feasible, with the reasoning shown.

5. **Bed Visualization** — pick a bed, choose which wishlist plants go in
   it, and auto-populate it: plants are packed in based on their spacing
   requirements, colored by type, with a legend and a count of how many fit.

6. **Live Sensors (future work)** — not wired up to real hardware yet. This
   tab stores config for ESPHome-based sun/light and soil-moisture sensor
   nodes per bed. `js/esphome.js` documents the intended integration (using
   ESPHome's `web_server` component's JSON API) and has a stub fetch
   function ready to be filled in once real devices exist.

## How the feasibility engine works

See `js/feasibility.js`. Each plant has a frost tolerance (tender / hardy /
half-hardy), whether it's cool-season-only, perennial, or a fall-planted
overwintering crop (garlic), days to maturity, and — for crops that decline
after one flush (lettuce, radish, beans, etc.) — a succession interval.

From your site's average frost dates and monthly temperatures, the engine
builds one or more valid planting windows per plant, generates concrete
planting dates (repeating at the succession interval where relevant), and
checks how much of your requested harvest period those plantings actually
cover. Soil pH and bed sun exposure are checked against the plant's
preferences and surfaced as warnings rather than hard blocks, since most are
fixable by amending soil or using a raised bed/container.

## Data sources

- [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) — free, no API key
- [Open-Meteo Historical Weather (Archive) API](https://open-meteo.com/en/docs/historical-weather-api) — free, no API key
- [ISRIC SoilGrids v2.0](https://www.isric.org/explore/soilgrids) — free, no API key

## Known limitations

- Frost dates and heat-month thresholds are statistical estimates from
  recent historical data, not a guarantee — always sanity-check against
  local extension office guidance for your area.
- Desired harvest windows that wrap the calendar year (e.g. "November
  through February") aren't supported yet — pick a range within one
  calendar year.
- The plant database (`data/plants.json`) covers 24 common crops with
  reasonable general figures; varieties differ, so treat it as a starting
  point.
- Bed layout uses simple strip-packing by spacing requirement, not a true
  optimizer — it's meant to give a realistic plant count and visual, not a
  perfectly efficient tiling.
