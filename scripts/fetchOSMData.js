const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter'
];
const DATA_DIR = path.join(__dirname, '..', 'data');

// Main (primary) and secondary roads within Bulgaria's national boundary,
// requested as two smaller queries instead of one big one - the combined
// query is heavy enough that public Overpass instances sometimes 504 on it.
const PRIMARY_ROADS_QUERY = `
[out:json][timeout:120];
area["ISO3166-1"="BG"][admin_level=2]->.bg;
way["highway"="primary"](area.bg);
out geom;
`;

const SECONDARY_ROADS_QUERY = `
[out:json][timeout:120];
area["ISO3166-1"="BG"][admin_level=2]->.bg;
way["highway"="secondary"](area.bg);
out geom;
`;

// Bulgarian settlements officially classed as towns/cities ("градове").
// OSM tags the larger ones "city" and smaller ones "town" - both count
// as official cities under Bulgarian administrative terminology.
const CITIES_QUERY = `
[out:json][timeout:90];
area["ISO3166-1"="BG"][admin_level=2]->.bg;
(
  node["place"~"^(city|town)$"](area.bg);
);
out body;
`;

// The national boundary relation itself, used to mask the map down to just
// Bulgaria and to restrict panning/zooming to the country.
const BOUNDARY_QUERY = `
[out:json][timeout:120];
relation["ISO3166-1"="BG"][admin_level=2][boundary=administrative];
out geom;
`;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runOverpassQuery(query, { retriesPerEndpoint = 3, retryDelayMs = 8000 } = {}) {
  let lastError;
  for (const url of OVERPASS_URLS) {
    for (let attempt = 1; attempt <= retriesPerEndpoint; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            // Overpass's Apache front-ends reject requests with no/generic
            // User-Agent (406 Not Acceptable) - identify ourselves properly.
            'User-Agent': 'BulgariaTravelMap/1.0 (local hobby project; contact: marin.jelev92@gmail.com)'
          }
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          // 429 = rate limited, 502/503/504 = server overloaded/restarting -
          // all worth a short wait and another try rather than giving up.
          const transient = [429, 502, 503, 504].includes(res.status);
          const retryAfterHeader = res.headers.get('retry-after');
          const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : null;
          const err = new Error(`${res.status} ${res.statusText} ${text.slice(0, 200)}`);
          err.transient = transient;
          err.retryAfterMs = Number.isFinite(retryAfterMs) ? retryAfterMs : null;
          throw err;
        }
        return await res.json();
      } catch (err) {
        lastError = err;
        const canRetrySameEndpoint = err.transient && attempt < retriesPerEndpoint;
        if (canRetrySameEndpoint) {
          const wait = err.retryAfterMs || retryDelayMs * attempt; // back off a bit more each retry
          console.warn(`Overpass endpoint ${url} returned a transient error (attempt ${attempt}/${retriesPerEndpoint}): ${err.message}. Retrying in ${Math.round(wait / 1000)}s...`);
          await delay(wait);
        } else {
          console.warn(`Overpass endpoint ${url} failed: ${err.message}. Trying next mirror if available...`);
          break;
        }
      }
    }
  }
  throw new Error(`All Overpass endpoints failed. Last error: ${lastError.message}`);
}

function waysToGeoJSON(osmData) {
  const features = osmData.elements
    .filter(el => el.type === 'way' && el.geometry && el.geometry.length > 1)
    .map(el => ({
      type: 'Feature',
      id: el.id,
      properties: {
        id: el.id,
        name: (el.tags && (el.tags.name || el.tags.ref)) || `Road ${el.id}`,
        ref: (el.tags && el.tags.ref) || null,
        highway: (el.tags && el.tags.highway) || null
      },
      geometry: {
        type: 'LineString',
        coordinates: el.geometry.map(pt => [pt.lon, pt.lat])
      }
    }));
  return { type: 'FeatureCollection', features };
}

function nodesToGeoJSON(osmData) {
  const features = osmData.elements
    .filter(el => el.type === 'node')
    .map(el => ({
      type: 'Feature',
      id: el.id,
      properties: {
        id: el.id,
        name: (el.tags && el.tags.name) || `City ${el.id}`,
        place: (el.tags && el.tags.place) || null
      },
      geometry: {
        type: 'Point',
        coordinates: [el.lon, el.lat]
      }
    }));
  return { type: 'FeatureCollection', features };
}

function pointsEqual(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

function ringArea(ring) {
  // Shoelace formula on [lng, lat] pairs - only used to compare ring sizes.
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

// A boundary relation's outer edge arrives as many separate way segments
// that share endpoints. Stitch them end-to-end into closed rings.
function assembleRings(segments) {
  const segs = segments.map(s => s.slice());
  const rings = [];
  while (segs.length) {
    let current = segs.shift();
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const cStart = current[0];
        const cEnd = current[current.length - 1];
        const sStart = s[0];
        const sEnd = s[s.length - 1];
        if (pointsEqual(cEnd, sStart)) {
          current = current.concat(s.slice(1));
          segs.splice(i, 1);
          changed = true;
          break;
        } else if (pointsEqual(cEnd, sEnd)) {
          current = current.concat(s.slice(0, -1).reverse());
          segs.splice(i, 1);
          changed = true;
          break;
        } else if (pointsEqual(cStart, sEnd)) {
          current = s.slice(0, -1).concat(current);
          segs.splice(i, 1);
          changed = true;
          break;
        } else if (pointsEqual(cStart, sStart)) {
          current = s.slice(1).reverse().concat(current);
          segs.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    rings.push(current);
  }
  return rings;
}

function relationToBoundaryGeoJSON(osmData) {
  const relation = osmData.elements.find(el => el.type === 'relation');
  if (!relation || !relation.members) {
    throw new Error('No boundary relation found in Overpass response.');
  }

  const outerSegments = relation.members
    .filter(m => m.type === 'way' && m.role === 'outer' && m.geometry && m.geometry.length > 1)
    .map(m => m.geometry.map(pt => [pt.lon, pt.lat]));

  if (outerSegments.length === 0) {
    throw new Error('Boundary relation had no outer way geometry.');
  }

  const rings = assembleRings(outerSegments).filter(r => r.length > 3);
  if (rings.length === 0) {
    throw new Error('Could not assemble a closed ring from the boundary ways.');
  }

  // Bulgaria is one contiguous territory with no islands or exclaves, so
  // the largest assembled ring is the national outline; smaller ones are
  // stray artifacts and can be ignored.
  rings.sort((a, b) => ringArea(b) - ringArea(a));
  const outerRing = rings[0];

  const first = outerRing[0];
  const last = outerRing[outerRing.length - 1];
  if (!pointsEqual(first, last)) outerRing.push(first);

  return {
    type: 'Feature',
    properties: { name: 'Bulgaria' },
    geometry: { type: 'Polygon', coordinates: [outerRing] }
  };
}

async function fetchAndSaveOSMData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log(`[${new Date().toISOString()}] Fetching primary roads from Overpass...`);
  const primaryRaw = await runOverpassQuery(PRIMARY_ROADS_QUERY);
  await delay(5000);

  console.log(`[${new Date().toISOString()}] Fetching secondary roads from Overpass...`);
  const secondaryRaw = await runOverpassQuery(SECONDARY_ROADS_QUERY);
  await delay(5000);

  const roadsGeoJSON = waysToGeoJSON({ elements: [...primaryRaw.elements, ...secondaryRaw.elements] });
  fs.writeFileSync(path.join(DATA_DIR, 'roads.geojson'), JSON.stringify(roadsGeoJSON));
  console.log(`Saved ${roadsGeoJSON.features.length} road segments.`);

  console.log(`[${new Date().toISOString()}] Fetching cities/towns from Overpass...`);
  const citiesRaw = await runOverpassQuery(CITIES_QUERY);
  const citiesGeoJSON = nodesToGeoJSON(citiesRaw);
  fs.writeFileSync(path.join(DATA_DIR, 'cities.geojson'), JSON.stringify(citiesGeoJSON));
  console.log(`Saved ${citiesGeoJSON.features.length} cities/towns.`);
  await delay(5000);

  console.log(`[${new Date().toISOString()}] Fetching national boundary from Overpass...`);
  let boundaryOk = false;
  try {
    const boundaryRaw = await runOverpassQuery(BOUNDARY_QUERY);
    const boundaryGeoJSON = relationToBoundaryGeoJSON(boundaryRaw);
    fs.writeFileSync(path.join(DATA_DIR, 'boundary.geojson'), JSON.stringify(boundaryGeoJSON));
    boundaryOk = true;
    console.log('Saved national boundary outline.');
  } catch (err) {
    // Not fatal - the map still works, it just won't be masked to Bulgaria
    // and will fall back to a bounding-box view restriction instead.
    console.warn(`Could not build national boundary outline: ${err.message}`);
  }

  fs.writeFileSync(
    path.join(DATA_DIR, 'last-updated.json'),
    JSON.stringify({ updatedAt: new Date().toISOString() })
  );

  return {
    roadCount: roadsGeoJSON.features.length,
    cityCount: citiesGeoJSON.features.length,
    boundaryOk
  };
}

module.exports = { fetchAndSaveOSMData };
