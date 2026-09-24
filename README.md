# Пътеки — Bulgaria Travel Map

A Bulgaria-only interactive map with two trackers:

- **Cities** — mark any of Bulgaria's 261 official towns/cities as visited.
- **100 National Tourist Sites** — track the official BTS ("Български
  туристически съюз") list of 100 numbered sites. Several points bundle more
  than one attraction (e.g. Sofia's point spans several museums), so there
  are 250 individually-checkable attractions grouped under those 100 points.
  Reach 25 / 50 / 100 distinct points and you unlock the real Bronze / Silver
  / Gold badge tiers the physical movement uses.

Signing in is required, and your progress is saved to your account via
Supabase — it follows you across browsers and devices. The map itself is
still a fully static site (no server-rendered pages, no scheduled jobs),
which keeps it a natural fit for Vercel; Supabase only handles auth and
storing your visited-cities/visited-sites state.

## 1. Deploying on Vercel

Push this repo to GitHub (already done if you're reading this from
`marinJelev/BulgariaMap`) and import it into Vercel as a new project.
`vercel.json` tells Vercel the deployable site lives in `public/` — no other
configuration is needed; there's no build step.

## 2. Running it locally

```bash
npm start
```

This runs `npx serve public` and opens the site at `http://localhost:3000`.
No dependencies to install — `serve` is fetched on demand by `npx`. If you'd
rather not touch npm at all, any static file server works just as well, e.g.:

```bash
cd public && python3 -m http.server 3000
```

## 3. Using it

- Signing in (email + password) is required before you can use the app;
  your progress is tied to your account.
- The map is locked to Bulgaria — everything outside the border is greyed
  out, and you can't pan/zoom out to neighboring countries.
- **100 Sites tab**: sites are grouped by their official point number. Click
  a group to expand it and check off individual attractions, or click a star
  pin on the map and use "Mark as visited" in its popup. The progress bar
  and Bronze/Silver/Gold badges track *distinct points* reached (checking
  any one attraction at a point counts that whole point, same as the
  physical stamp book).
- **Cities tab**: click a pin (or check the box in the list) to mark a
  town/city visited.
- Use the **Cities** / **100 Sites** checkboxes in the top bar to hide either
  layer on the map if it gets visually busy.
- Search boxes in each tab filter the sidebar list by name.

## 4. Project structure

```
bulgaria-map/
├── public/                     Everything Vercel deploys, as-is
│   ├── index.html
│   ├── style.css
│   ├── app.js                  Map, tabs, badges, search, auth, sync
│   └── data/
│       ├── boundary.geojson    Bulgaria's national outline (mask + bounds)
│       ├── cities.geojson      261 official towns/cities
│       └── tourist-sites.json  250 attractions across the 100 official points
├── scripts/
│   └── build-tourist-sites.js  Regenerates tourist-sites.json (see below)
├── vercel.json                 Tells Vercel to deploy the public/ folder
├── package.json                Just a local-dev convenience script
└── README.md
```

## 5. Where the data comes from

- **Boundary**: Bulgaria's polygon from the
  [`datasets/geo-countries`](https://github.com/datasets/geo-countries)
  public dataset (Natural Earth–derived), fetched once and committed as a
  static file.
- **Cities**: the 261 settlements officially classed as town/city (not
  village) from [`yurukov/Bulgaria-geocoding`](https://github.com/yurukov/Bulgaria-geocoding)'s
  `settlements_loc.csv`, filtered and converted once.
- **100 Sites**: transcribed from the official BTS list at
  [btsbg.org](https://www.btsbg.org/nacionalni-dvizheniya/100-nacionalni-turisticheski-obekta),
  geocoded at town/landmark precision (not individual-building precision).
  A handful of entries near the end of the source page weren't cleanly
  attributed to a town in the page's markup; those were placed using the
  best available knowledge of the actual landmark and are worth
  double-checking if you spot one in the wrong place.

None of this data changes often (an administrative boundary, a city list, and
a 60-year-old numbered heritage program), so unlike the old roads feature
this app replaced, there's no runtime fetching or scheduled refresh — these
are just static files. To fix or extend the tourist-sites data, edit
`scripts/build-tourist-sites.js` (the `RAW_SITES` array and `LOCATIONS`
coordinates) and run:

```bash
npm run build:tourist-sites
```

To refresh the boundary or cities data, re-fetch from the sources above and
convert to the same GeoJSON shape used in `public/data/`.

## 6. Notes / limitations

- City and site pins use town/landmark-level coordinates, not exact street
  addresses — fine for a checklist map, not for turn-by-turn navigation.
- Progress is tied to your account and synced via Supabase, so it follows
  you across browsers and devices once you're signed in. An account is
  required to use the app.
