const STORAGE_ROADS_KEY = 'bgmap.roads.v1';
const STORAGE_CITIES_KEY = 'bgmap.cities.v1';

const map = L.map('map', { preferCanvas: true, maxBoundsViscosity: 1.0 }).setView([42.75, 25.3], 7);

L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  maxZoom: 19
}).addTo(map);

// A pane between the base tiles and the roads/cities layers, so the
// Bulgaria-only mask always sits under the data regardless of load order.
map.createPane('maskPane');
map.getPane('maskPane').style.zIndex = 350;
map.getPane('maskPane').style.pointerEvents = 'none';

const BULGARIA_FALLBACK_BOUNDS = L.latLngBounds([40.9, 22.2], [44.3, 28.7]);

function restrictToBulgaria(bounds) {
  map.fitBounds(bounds.pad(0.03));
  map.setMaxBounds(bounds.pad(0.2));
  map.setMinZoom(map.getBoundsZoom(bounds.pad(0.2)));
}

fetch('/data/boundary.geojson')
  .then(r => {
    if (!r.ok) throw new Error('boundary.geojson not available');
    return r.json();
  })
  .then(data => {
    const ring = data.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]);
    const world = [[-89, -179], [-89, 179], [89, 179], [89, -179]];

    // Grey out everything that isn't Bulgaria.
    L.polygon([world, ring], {
      stroke: false,
      fillColor: '#14201A',
      fillOpacity: 0.82,
      pane: 'maskPane'
    }).addTo(map);

    // A subtle outline of the national border on top of the mask.
    L.polygon(ring, {
      color: '#D46A85',
      weight: 1.5,
      opacity: 0.55,
      fill: false,
      pane: 'maskPane'
    }).addTo(map);

    restrictToBulgaria(L.latLngBounds(ring));
  })
  .catch(err => {
    console.warn('No national boundary outline available, using a bounding-box restriction instead.', err.message);
    restrictToBulgaria(BULGARIA_FALLBACK_BOUNDS);
  });

let travelledRoads = loadJSON(STORAGE_ROADS_KEY, {});
let visitedCities = loadJSON(STORAGE_CITIES_KEY, {});

let roadLayer;
let cityLayer;

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function saveRoads() { localStorage.setItem(STORAGE_ROADS_KEY, JSON.stringify(travelledRoads)); }
function saveCities() { localStorage.setItem(STORAGE_CITIES_KEY, JSON.stringify(visitedCities)); }

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}

/* ---------------- Trip modal ---------------- */

const modal = document.getElementById('trip-modal');
const modalForm = document.getElementById('trip-form');
const startInput = document.getElementById('trip-start');
const endInput = document.getElementById('trip-end');
const modalRoadName = document.getElementById('trip-road-name');
let pendingRoadId = null;

function openTripModal(roadId, roadLabel) {
  pendingRoadId = roadId;
  modalRoadName.textContent = roadLabel;
  startInput.value = '';
  endInput.value = '';
  modal.classList.add('open');
  startInput.focus();
}
function closeTripModal() {
  modal.classList.remove('open');
  pendingRoadId = null;
}
document.getElementById('trip-cancel').addEventListener('click', () => {
  // If the user cancels right after marking a road, drop the mark entirely
  // rather than leaving a blue road with no trip info.
  if (pendingRoadId && travelledRoads[pendingRoadId] && !travelledRoads[pendingRoadId].start) {
    delete travelledRoads[pendingRoadId];
    saveRoads();
    refreshRoadStyle(pendingRoadId);
    renderRoadsList();
  }
  closeTripModal();
});
modalForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!pendingRoadId) return;
  const start = startInput.value.trim();
  const end = endInput.value.trim();
  if (!start || !end) return;
  travelledRoads[pendingRoadId].start = start;
  travelledRoads[pendingRoadId].end = end;
  saveRoads();
  renderRoadsList();
  closeTripModal();
});

/* ---------------- Roads ---------------- */

fetch('/data/roads.geojson')
  .then(r => r.json())
  .then(data => {
    roadLayer = L.geoJSON(data, {
      style: feature => styleForRoad(feature),
      onEachFeature: (feature, layer) => {
        layer.on('click', () => onRoadClick(layer));
      }
    }).addTo(map);
    renderRoadsList();
  })
  .catch(err => {
    console.error('Failed to load road data', err);
    document.getElementById('roads-list').innerHTML =
      '<li class="empty">Could not load road data. Make sure the server fetched OpenStreetMap data successfully (check the terminal).</li>';
  });

function styleForRoad(feature) {
  const id = feature.properties.id;
  const travelled = !!travelledRoads[id];
  return {
    color: travelled ? '#2E6FD9' : '#8B9A8E',
    weight: travelled ? 5 : 3,
    opacity: travelled ? 0.95 : 0.5
  };
}

function refreshRoadStyle(id) {
  if (!roadLayer) return;
  roadLayer.eachLayer(layer => {
    if (String(layer.feature.properties.id) === String(id)) {
      layer.setStyle(styleForRoad(layer.feature));
    }
  });
}

function onRoadClick(layer) {
  const feature = layer.feature;
  const id = feature.properties.id;
  const label = feature.properties.name;

  if (travelledRoads[id]) {
    delete travelledRoads[id];
    saveRoads();
    layer.setStyle(styleForRoad(feature));
    renderRoadsList();
  } else {
    travelledRoads[id] = { name: label, ref: feature.properties.ref, start: '', end: '' };
    saveRoads();
    layer.setStyle(styleForRoad(feature));
    renderRoadsList();
    openTripModal(id, label);
  }
}

function renderRoadsList() {
  const list = document.getElementById('roads-list');
  const ids = Object.keys(travelledRoads);
  document.getElementById('roads-count').textContent = ids.length;
  if (ids.length === 0) {
    list.innerHTML = '<li class="empty">No roads marked yet. Click a road on the map to log a trip.</li>';
    return;
  }
  list.innerHTML = ids.map(id => {
    const r = travelledRoads[id];
    const trip = (r.start && r.end)
      ? `${escapeHTML(r.start)} → ${escapeHTML(r.end)}`
      : '<span class="muted">start/end not set</span>';
    return `<li>
      <div class="item-main">
        <span class="item-title">${escapeHTML(r.name)}${r.ref ? ` <span class="ref">(${escapeHTML(r.ref)})</span>` : ''}</span>
        <button class="remove-btn" data-type="road" data-id="${id}" title="Remove">&times;</button>
      </div>
      <div class="item-sub">${trip}</div>
    </li>`;
  }).join('');
}

/* ---------------- Cities ---------------- */

fetch('/data/cities.geojson')
  .then(r => r.json())
  .then(data => {
    document.getElementById('cities-total').textContent = data.features.length;

    cityLayer = L.geoJSON(data, {
      pointToLayer: (feature, latlng) => makeCityMarker(feature, latlng)
    }).addTo(map);

    renderCitiesList();
  })
  .catch(err => {
    console.error('Failed to load city data', err);
    document.getElementById('cities-list').innerHTML =
      '<li class="empty">Could not load city data.</li>';
  });

function makeCityMarker(feature, latlng) {
  const id = feature.properties.id;
  const marker = L.marker(latlng, { icon: iconForCity(id) });
  marker.on('click', () => onCityClick(feature, marker));
  marker.bindTooltip(feature.properties.name, { direction: 'top', offset: [0, -14] });
  return marker;
}

function iconForCity(id) {
  const visited = !!visitedCities[id];
  return L.divIcon({
    className: '',
    html: `<div class="city-pin ${visited ? 'visited' : ''}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 15]
  });
}

function onCityClick(feature, marker) {
  const id = feature.properties.id;
  if (visitedCities[id]) {
    delete visitedCities[id];
  } else {
    visitedCities[id] = { name: feature.properties.name };
  }
  saveCities();
  marker.setIcon(iconForCity(id));
  renderCitiesList();
}

function renderCitiesList() {
  const list = document.getElementById('cities-list');
  const ids = Object.keys(visitedCities);
  document.getElementById('cities-visited').textContent = ids.length;
  if (ids.length === 0) {
    list.innerHTML = '<li class="empty">No cities marked yet. Click a pin on the map to mark it visited.</li>';
    return;
  }
  list.innerHTML = ids.map(id => {
    const c = visitedCities[id];
    return `<li>
      <div class="item-main">
        <span class="item-title">${escapeHTML(c.name)}</span>
        <button class="remove-btn" data-type="city" data-id="${id}" title="Remove">&times;</button>
      </div>
    </li>`;
  }).join('');
}

/* ---------------- Remove buttons (event delegation) ---------------- */

document.getElementById('sidebar').addEventListener('click', (e) => {
  const btn = e.target.closest('.remove-btn');
  if (!btn) return;
  const { type, id } = btn.dataset;
  if (type === 'road') {
    delete travelledRoads[id];
    saveRoads();
    refreshRoadStyle(id);
    renderRoadsList();
  } else if (type === 'city') {
    delete visitedCities[id];
    saveCities();
    if (cityLayer) {
      cityLayer.eachLayer(layer => {
        if (String(layer.feature.properties.id) === String(id)) {
          layer.setIcon(iconForCity(id));
        }
      });
    }
    renderCitiesList();
  }
});

/* ---------------- Data freshness / manual refresh ---------------- */

fetch('/api/status').then(r => r.json()).then(s => {
  const el = document.getElementById('last-updated');
  if (s.updatedAt) {
    const d = new Date(s.updatedAt);
    el.textContent = `Map data updated ${d.toLocaleDateString()}`;
  } else {
    el.textContent = 'Map data not yet loaded';
  }
});

document.getElementById('refresh-btn').addEventListener('click', async () => {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const json = await res.json();
    if (json.ok) {
      location.reload();
    } else {
      alert('Refresh failed: ' + json.error);
    }
  } catch (e) {
    alert('Refresh failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh map data';
  }
});
