/* ---------------- Storage ---------------- */
const STORAGE_CITIES_KEY = 'bgmap.cities.v2';
const STORAGE_SITES_KEY = 'bgmap.sites.v1';

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

let visitedCities = loadJSON(STORAGE_CITIES_KEY, {});   // { ekatteId: true }
let visitedSites = loadJSON(STORAGE_SITES_KEY, {});      // { siteId: true }
function saveCities() { saveJSON(STORAGE_CITIES_KEY, visitedCities); }
function saveSites() { saveJSON(STORAGE_SITES_KEY, visitedSites); }

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}

/* ---------------- Map setup ---------------- */

const map = L.map('map', { preferCanvas: true, maxBoundsViscosity: 1.0, attributionControl: false }).setView([42.75, 25.3], 7);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19
}).addTo(map);

map.createPane('maskPane');
map.getPane('maskPane').style.zIndex = 350;
map.getPane('maskPane').style.pointerEvents = 'none';

const citiesLayerGroup = L.layerGroup().addTo(map);
const sitesLayerGroup = L.layerGroup().addTo(map);

const BULGARIA_FALLBACK_BOUNDS = L.latLngBounds([40.9, 22.2], [44.3, 28.7]);

function restrictToBulgaria(bounds) {
  map.fitBounds(bounds.pad(0.03));
  map.setMaxBounds(bounds.pad(0.2));
  map.setMinZoom(map.getBoundsZoom(bounds.pad(0.2)));
}

fetch('data/boundary.geojson')
  .then(r => { if (!r.ok) throw new Error('boundary.geojson not available'); return r.json(); })
  .then(data => {
    const ring = data.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]);
    const world = [[-89, -179], [-89, 179], [89, 179], [89, -179]];

    L.polygon([world, ring], {
      stroke: false, fillColor: '#14201A', fillOpacity: 0.82, pane: 'maskPane'
    }).addTo(map);

    L.polygon(ring, {
      color: '#D46A85', weight: 1.5, opacity: 0.55, fill: false, pane: 'maskPane'
    }).addTo(map);

    restrictToBulgaria(L.latLngBounds(ring));
  })
  .catch(err => {
    console.warn('No national boundary outline available, using a bounding-box restriction instead.', err.message);
    restrictToBulgaria(BULGARIA_FALLBACK_BOUNDS);
  });

/* ---------------- Tabs ---------------- */

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

/* ---------------- Layer toggles ---------------- */

function setupLayerChip(buttonId, layerGroup) {
  const btn = document.getElementById(buttonId);
  btn.addEventListener('click', () => {
    const isActive = btn.classList.toggle('active');
    btn.setAttribute('aria-pressed', String(isActive));
    if (isActive) map.addLayer(layerGroup); else map.removeLayer(layerGroup);
  });
}
setupLayerChip('toggle-cities-layer', citiesLayerGroup);
setupLayerChip('toggle-sites-layer', sitesLayerGroup);

function checkIconSvg() {
  return `<svg class="item-check" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="8" fill="#6FCF97"/>
    <path d="M4.5 8.3l2.2 2.2 4.8-4.8" stroke="#0F1A12" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function emptyStateHtml(searchTargetId, itemLabel) {
  return `<li class="empty-state">
    <div class="empty-state-icon">🔎</div>
    <div class="empty-state-title">No ${itemLabel} found</div>
    <div class="empty-state-sub">Nothing matches that search. Try a different name or town.</div>
    <button class="empty-state-clear" data-clear-target="${searchTargetId}">Clear search</button>
  </li>`;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.empty-state-clear');
  if (!btn) return;
  const input = document.getElementById(btn.dataset.clearTarget);
  if (!input) return;
  input.value = '';
  input.dispatchEvent(new Event('input'));
  input.focus();
});

/* ---------------- Cities ---------------- */

let allCityFeatures = [];

fetch('data/cities.geojson')
  .then(r => r.json())
  .then(data => {
    allCityFeatures = data.features;
    document.getElementById('cities-total-count').textContent = allCityFeatures.length;

    allCityFeatures.forEach(feature => {
      const [lon, lat] = feature.geometry.coordinates;
      const marker = L.marker([lat, lon], { icon: cityIcon(feature.properties.id) });
      marker.on('click', () => toggleCity(feature.properties.id));
      marker.bindTooltip(feature.properties.name, { direction: 'top', offset: [0, -14] });
      marker.__cityId = feature.properties.id;
      citiesLayerGroup.addLayer(marker);
    });

    renderCitiesList();
  })
  .catch(err => {
    console.error('Failed to load city data', err);
    document.getElementById('cities-list').innerHTML = '<li class="empty">Could not load city data.</li>';
  });

function cityIcon(id) {
  const visited = !!visitedCities[id];
  return L.divIcon({
    className: '',
    html: `<div class="city-pin ${visited ? 'visited' : ''}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 15]
  });
}

function toggleCity(id) {
  if (visitedCities[id]) delete visitedCities[id]; else visitedCities[id] = true;
  saveCities();
  citiesLayerGroup.eachLayer(marker => {
    if (marker.__cityId === id) marker.setIcon(cityIcon(id));
  });
  renderCitiesList();
}

function renderCitiesList(filterText) {
  const list = document.getElementById('cities-list');
  const filter = (filterText || '').trim().toLowerCase();
  const visitedCount = Object.keys(visitedCities).length;
  document.getElementById('cities-visited-count').textContent = visitedCount;
  const total = allCityFeatures.length || 1;
  document.getElementById('cities-progress-fill').style.width = `${(visitedCount / total) * 100}%`;

  const rows = allCityFeatures
    .filter(f => !filter || f.properties.name.toLowerCase().includes(filter))
    .sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'bg'));

  if (rows.length === 0) {
    list.innerHTML = filter ? emptyStateHtml('cities-search', 'cities') : '<li class="empty">No cities loaded.</li>';
    return;
  }

  list.innerHTML = rows.map(f => {
    const id = f.properties.id;
    const visited = !!visitedCities[id];
    return `<li class="${visited ? 'visited' : ''}" data-city-id="${id}">
      <span class="item-name">${escapeHTML(f.properties.name)}</span>
      <span class="item-province">${escapeHTML(f.properties.province)}</span>
      ${checkIconSvg()}
    </li>`;
  }).join('');
}

document.getElementById('cities-list').addEventListener('click', (e) => {
  const row = e.target.closest('li[data-city-id]');
  if (!row) return;
  toggleCity(row.dataset.cityId);
});
document.getElementById('cities-search').addEventListener('input', (e) => renderCitiesList(e.target.value));

/* ---------------- 100 Sites ---------------- */

let allSiteFeatures = [];
let siteGroupsOrder = [];
let manuallyOpenGroups = new Set();

const STAR_PATH = 'M9 1.5l2.35 4.76 5.25.76-3.8 3.7.9 5.24L9 13.5l-4.7 2.46.9-5.24-3.8-3.7 5.25-.76z';

function siteIconSvg(visited) {
  const fill = visited ? '#C9A54A' : 'rgba(241,238,227,0.55)';
  const stroke = visited ? '#7A5F1E' : '#33422F';
  return `<svg class="site-star" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path d="${STAR_PATH}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>
  </svg>`;
}

function siteIcon(visited) {
  return L.divIcon({
    className: '',
    html: siteIconSvg(visited),
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

fetch('data/tourist-sites.json')
  .then(r => r.json())
  .then(data => {
    allSiteFeatures = data.features;
    document.getElementById('sites-attractions-total').textContent = allSiteFeatures.length;

    allSiteFeatures.forEach(feature => {
      const [lon, lat] = feature.geometry.coordinates;
      const id = feature.properties.id;
      const marker = L.marker([lat, lon], { icon: siteIcon(!!visitedSites[id]) });
      marker.__siteId = id;
      marker.bindPopup(popupHtml(feature.properties));
      marker.on('popupopen', (e) => {
        const btn = e.popup.getElement().querySelector('.popup-toggle');
        if (btn) btn.addEventListener('click', () => {
          toggleSite(id);
          marker.setPopupContent(popupHtml(feature.properties));
        });
      });
      sitesLayerGroup.addLayer(marker);
    });

    // Preserve first-seen order of official numbers, sorted numerically.
    const seen = new Set();
    allSiteFeatures.forEach(f => seen.add(f.properties.group));
    siteGroupsOrder = Array.from(seen).sort((a, b) => Number(a) - Number(b));

    renderSitesList();
    updateSitesProgress();
  })
  .catch(err => {
    console.error('Failed to load tourist site data', err);
    document.getElementById('sites-list').innerHTML = '<li class="empty">Could not load site data.</li>';
  });

function popupHtml(props) {
  const visited = !!visitedSites[props.id];
  return `<div class="site-popup">
    <strong>#${escapeHTML(props.number)} · ${escapeHTML(props.location)}</strong>
    <div>${escapeHTML(props.name)}</div>
    <a href="${props.url}" target="_blank" rel="noopener">More info ↗</a><br/>
    <button class="popup-toggle">${visited ? 'Mark as not visited' : 'Mark as visited'}</button>
  </div>`;
}

function toggleSite(id) {
  if (visitedSites[id]) delete visitedSites[id]; else visitedSites[id] = true;
  saveSites();
  sitesLayerGroup.eachLayer(marker => {
    if (marker.__siteId === id) marker.setIcon(siteIcon(!!visitedSites[id]));
  });
  renderSitesList(document.getElementById('sites-search').value);
  updateSitesProgress();
}

function pointsVisitedCount() {
  const groupsWithVisit = new Set();
  allSiteFeatures.forEach(f => {
    if (visitedSites[f.properties.id]) groupsWithVisit.add(f.properties.group);
  });
  return groupsWithVisit.size;
}

function updateSitesProgress() {
  const count = pointsVisitedCount();
  document.getElementById('sites-points-visited').textContent = count;
  document.getElementById('sites-progress-fill').style.width = `${count}%`;

  const attractionsVisited = allSiteFeatures.filter(f => visitedSites[f.properties.id]).length;
  document.getElementById('sites-attractions-visited').textContent = attractionsVisited;

  [['badge-bronze', 25], ['badge-silver', 50], ['badge-gold', 100]].forEach(([id, threshold]) => {
    document.getElementById(id).classList.toggle('earned', count >= threshold);
  });
}

function renderSitesList(filterText) {
  const list = document.getElementById('sites-list');
  const filter = (filterText || '').trim().toLowerCase();

  const groupsWithVisit = new Set();
  allSiteFeatures.forEach(f => { if (visitedSites[f.properties.id]) groupsWithVisit.add(f.properties.group); });

  const html = siteGroupsOrder.map(group => {
    const attractions = allSiteFeatures.filter(f => f.properties.group === group);
    const matches = !filter || attractions.some(a =>
      a.properties.name.toLowerCase().includes(filter) || a.properties.location.toLowerCase().includes(filter)
    );
    if (!matches) return '';

    const visitedCount = attractions.filter(a => visitedSites[a.properties.id]).length;
    const complete = visitedCount === attractions.length;
    const location = attractions[0].properties.location;
    const openAttr = (filter || manuallyOpenGroups.has(group)) ? 'open' : '';

    const rows = attractions.map(a => {
      const id = a.properties.id;
      const visited = !!visitedSites[id];
      return `<div class="attraction-row ${visited ? 'visited' : ''}" data-site-id="${id}">
        <span class="attraction-name">${escapeHTML(a.properties.name)}</span>
        <a href="${a.properties.url}" target="_blank" rel="noopener">info ↗</a>
        ${checkIconSvg()}
      </div>`;
    }).join('');

    return `<li class="site-group ${complete ? 'complete' : ''} ${openAttr}" data-group="${group}">
      <div class="site-group-header">
        <div class="site-group-number">${escapeHTML(group)}</div>
        <div class="site-group-title">
          <div class="site-group-name">${escapeHTML(location)}</div>
          <div class="site-group-location">${attractions.length} attraction${attractions.length > 1 ? 's' : ''}</div>
        </div>
        <div class="site-group-count">${visitedCount}/${attractions.length}</div>
        <div class="site-group-chevron">▶</div>
      </div>
      <div class="site-attractions">${rows}</div>
    </li>`;
  }).join('');

  list.innerHTML = html || (filter ? emptyStateHtml('sites-search', 'sites') : '<li class="empty">No sites loaded.</li>');
}

document.getElementById('sites-list').addEventListener('click', (e) => {
  if (e.target.closest('a')) return; // let the "info" link open normally

  const attractionRow = e.target.closest('.attraction-row');
  if (attractionRow) {
    toggleSite(attractionRow.dataset.siteId);
    return;
  }

  const header = e.target.closest('.site-group-header');
  if (header) {
    const groupEl = header.closest('.site-group');
    const isOpen = groupEl.classList.toggle('open');
    if (isOpen) manuallyOpenGroups.add(groupEl.dataset.group);
    else manuallyOpenGroups.delete(groupEl.dataset.group);
  }
});

document.getElementById('sites-search').addEventListener('input', (e) => renderSitesList(e.target.value));
