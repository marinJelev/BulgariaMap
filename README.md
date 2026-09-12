# Пътеки — Bulgaria Travel Map

An interactive map of Bulgaria's primary and secondary roads and its cities/towns.
Click a road to mark it travelled (it turns blue) and log where you started and
ended; click a city pin to mark it visited. Both lists live in the sidebar, with
a visited/total counter for cities.

Road and city geometry comes from **OpenStreetMap** (via the Overpass API), so
it's the real road network, not a stylized approximation.

## 1. Requirements

- [Node.js](https://nodejs.org) 18 or later
- An internet connection (needed once, to download the map data — after that
  the app works offline against the cached files in `data/`)

## 2. Setup

```bash
cd bulgaria-map
npm install
npm start
```

The first run will fetch Bulgaria's road and city data from OpenStreetMap
(takes ~30–90 seconds depending on Overpass server load). After that, open:

```
http://localhost:3000
```

## 3. Using it

- The map is locked to Bulgaria: everything outside the national border is
  greyed out, and you can't pan or zoom out far enough to see neighboring
  countries.
- **Roads**: click any road on the map. It turns blue and a small form pops up
  asking where you started and ended that trip — save it and it appears in the
  "Roads travelled" list. Click a blue road again to un-mark it, or use the ×
  on its list entry.
- **Cities**: click a pin to mark that city/town visited (it turns gold). The
  counter shows how many of Bulgaria's cities/towns you've visited out of the
  total. Click again, or use the × in the list, to un-mark it.
- Your marks are saved in your **browser's local storage**, tied to this
  browser on this computer. They are *not* stored on any server, so clearing
  browser data will reset them, and they won't follow you to a different
  browser or device.

## 4. Keeping the road/city data current

- A **"Refresh map data"** button in the top bar re-fetches everything from
  OpenStreetMap immediately, any time you want.
- The server also schedules an **automatic weekly refresh** (Sundays at
  03:00, server time) using `node-cron`. Two things worth knowing:
  - This only fires while `npm start` is left running continuously. If you
    stop the server (e.g. close the terminal, shut down your laptop) between
    Sundays, that week's automatic refresh won't happen — it's not a
    background service that survives your machine being off. To get genuinely
    unattended weekly updates, you'd want to run this on a small always-on
    server or a host with its own cron/scheduler.
  - The schedule is set in `server.js` (`cron.schedule('0 3 * * 0', ...)`) —
    change the cron expression there if you want a different day/time.
- Refreshing re-downloads the full road/city dataset, so brand-new roads or
  towns added to OpenStreetMap will show up. Your travelled/visited marks are
  matched by OpenStreetMap's internal IDs, which are normally stable — but if
  a road is heavily redrawn or split in OpenStreetMap between refreshes, its
  ID can change and your mark on it could be lost. This is uncommon but worth
  knowing about.

## 5. Notes on what counts as a "city"

Bulgaria doesn't distinguish "town" vs "city" the way some countries do —
every officially incorporated settlement is a "град" (city/town). This app
counts every OpenStreetMap node tagged `place=city` or `place=town` within
Bulgaria, which should closely match Bulgaria's ~257 official cities/towns.
If you'd rather use a stricter or looser definition, that's a one-line change
in `scripts/fetchOSMData.js` (the `CITIES_QUERY` regex).

## 6. Project structure

```
bulgaria-map/
├── server.js              Express server, refresh endpoint, weekly cron job
├── scripts/
│   └── fetchOSMData.js    Overpass queries → GeoJSON conversion (roads, cities, boundary)
├── data/                  Cached roads.geojson / cities.geojson / boundary.geojson (auto-generated)
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js             Map rendering, Bulgaria mask, click handling, localStorage
└── package.json
```

## 7. Troubleshooting

- **"Could not load road/city data"** in the sidebar: the initial Overpass
  fetch likely failed (slow/unreachable Overpass server, or no internet at
  startup). Check the terminal for an error, then click "Refresh map data"
  once you have a connection.
- **Map isn't greyed out outside Bulgaria / no mask visible**: building the
  national outline is a separate, non-critical step (see `boundary.geojson`
  in `data/`). If Overpass's boundary relation query fails or times out, the
  app logs a warning and falls back to a plain bounding-box restriction
  instead of the exact border mask — roads and cities are unaffected either
  way. Hitting "Refresh map data" will retry building the outline.
- **Overpass request failed / timeout**: the public Overpass API
  (`overpass-api.de`) occasionally rate-limits or is briefly overloaded.
  Wait a minute and hit refresh again.
