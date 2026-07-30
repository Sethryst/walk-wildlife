/* Walk & Wildlife Journal — local-first walking, history, and nature journal. */

// Scoring is local, transparent, and never based on GPS-ping count.
const POINTS_PER_MILE = 10;
const POINTS_PER_NEW_HISTORY_SITE = 25;
const POINTS_PER_OBSERVATION = 15;
const STREAK_BONUS_PER_DAY = 5;
const MAX_GPS_ACCURACY_METERS = 50;
const MAX_WALK_SPEED_MPS = 15;

const CITIES = {
  vienna: {
    name: 'Vienna',
    state: 'VA',
    center: { lat: 38.9013, lng: -77.2652 },
    zoom: 15,
    dataFile: './data/vienna-poi.json'
  },
  norfolk: {
    name: 'Norfolk',
    state: 'VA',
    center: { lat: 36.8508, lng: -76.2859 },
    zoom: 14,
    dataFile: './data/norfolk-poi.json'
  },
  newyork: {
    name: 'New York',
    state: 'NY',
    center: { lat: 40.73088, lng: -73.99759 },
    zoom: 13,
    dataFile: './data/newyork-poi.json'
  },
  pgcounty: {
    name: "Prince George's County",
    state: 'MD',
    center: { lat: 38.8315, lng: -76.8465 },
    zoom: 11,
    dataFile: './data/pgcounty-poi.json'
  },
  dc: {
    name: 'Washington',
    state: 'DC',
    center: { lat: 38.8951, lng: -77.0364 },
    zoom: 13,
    dataFile: './data/dc-poi.json'
  }
};

function cityLabel(cityId) {
  const config = CITIES[cityId];
  if (!config) return '';
  const suffix = cityId === 'norfolk' ? ' (prototype)' : '';
  return `${config.name}, ${config.state}${suffix}`;
}

const DEFAULT_PROFILE = {
  id: 'local-user', totalPoints: 0, walksCompleted: 0, milesTotal: 0,
  sitesDiscovered: {}, observationsLogged: 0, streakDays: 0, lastWalkDate: null
};
const GEOFENCE_CATEGORIES = [
  ['library', '📚 Libraries'], ['park', '🌳 Parks'], ['public_art', '🎨 Public Art'],
  ['recreation_center', '🏢 Recreation Centers'], ['water_access', '🌊 Water Access'],
  ['community_garden', '🌱 Community Gardens'], ['history', '✦ History Sites'],
  ['wifi', '📶 Free Wi-Fi']
];
const DEFAULT_SETTINGS = {
  id: 'app-settings', activeCity: 'vienna', lastSyncedAt: null,
  enableGeofencing: true, geofenceCategories: ['library', 'park', 'public_art', 'recreation_center', 'water_access', 'history', 'community_garden', 'wifi'], defaultGeofenceRadiusMeters: 50
};

const state = {
  map: null, userMarker: null, routeLine: null, draftMarker: null, currentPosition: null,
  activeWalk: null, watchId: null, timerId: null, prompted: new Set(), currentSite: null,
  draftObservationLocation: null, archiveFilter: 'all', activeView: 'map', modalOpen: null, activeCity: 'vienna',
  profile: { ...DEFAULT_PROFILE }, settings: { ...DEFAULT_SETTINGS }, historyLayer: null, observationLayer: null, poiLayer: null, trailLayer: null,
  cityPois: {}, trailSegments: {}, poiTags: new Set(),
  online: { client: null, session: null, remoteProfile: null, candidate: null, leaderboard: [], incoming: [] }
};

const el = (id) => document.getElementById(id);
const db = (() => {
  let database;
  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('walk-wildlife-journal', 3);
      request.onupgradeneeded = () => {
        database = request.result;
        if (!database.objectStoreNames.contains('walks')) database.createObjectStore('walks', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('observations')) database.createObjectStore('observations', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('moments')) database.createObjectStore('moments', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('profile')) database.createObjectStore('profile', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('points_of_interest')) database.createObjectStore('points_of_interest', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('poi_metadata')) database.createObjectStore('poi_metadata', { keyPath: 'id' });
      };
      request.onsuccess = () => { database = request.result; resolve(); };
      request.onerror = () => reject(request.error);
    });
  }
  function store(name, mode = 'readonly') { return database.transaction(name, mode).objectStore(name); }
  function put(name, item) { return new Promise((resolve, reject) => { const r = store(name, 'readwrite').put(item); r.onsuccess = () => resolve(item); r.onerror = () => reject(r.error); }); }
  function get(name, id) { return new Promise((resolve, reject) => { const r = store(name).get(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  function all(name) { return new Promise((resolve, reject) => { const r = store(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  function clearAll() {
    return Promise.all(['walks', 'observations', 'moments', 'profile', 'settings'].map((name) => new Promise((resolve, reject) => {
      const r = store(name, 'readwrite').clear(); r.onsuccess = resolve; r.onerror = () => reject(r.error);
    })));
  }
  return { open, put, get, all, clearAll };
})();

const POI_TAGS = [
  ['park', '🌳 Parks'], ['public_art', '🎨 Public Art'], ['recreation_center', '🏢 Recreation Centers'],
  ['water_access', '🌊 Water Access'], ['trail', '🥾 Trails'], ['library', '📚 Libraries'],
  ['community_garden', '🌱 Community Gardens'], ['history', '🏛 History Sites'],
  ['history_landmark', '🏛 Landmarks'], ['history_monument', '🗿 Monuments'], ['history_museum', '🖼 Museums'],
  ['history_cemetery', '🪦 Cemeteries'], ['history_marker', '📜 Historical Markers'],
  ['wifi', '📶 Free Wi-Fi'], ['basketball', 'Basketball'], ['tennis', 'Tennis'],
  ['playground', 'Playground'], ['dog_park', 'Dog park'], ['splash_pad', 'Splash pad'],
  ['disc_golf', 'Disc golf'], ['skate_park', 'Skate park'], ['restrooms', 'Restrooms']
];
const TAG_LABELS = Object.fromEntries(POI_TAGS);
const POI_TAG_PRIORITY = ['history', 'park', 'public_art', 'recreation_center', 'water_access', 'trail', 'library', 'community_garden', 'wifi'];
const POI_ICONS = { park: '🌳', public_art: '🎨', recreation_center: '🏢', water_access: '🌊', trail: '🥾', library: '📚', community_garden: '🌱', history: '🏛', wifi: '📶' };
// History sites are split into subtypes so the filter sheet isn't one catch-all
// "History" bucket — each gets its own chip and its own pin glyph.
const HISTORY_SUBTYPES = {
  landmark: { label: 'Landmarks', icon: '🏛' },
  monument: { label: 'Monuments', icon: '🗿' },
  museum: { label: 'Museums', icon: '🖼' },
  cemetery: { label: 'Cemeteries', icon: '🪦' },
  marker: { label: 'Historical Markers', icon: '📜' } // default/fallback subtype
};
function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }

function normalizePoiTags(poi) {
  const tags = [...(poi.tags || [])];
  if (poi.category && !tags.includes(poi.category)) tags.push(poi.category);
  if (poi.amenities) poi.amenities.forEach((amenity) => { if (!tags.includes(amenity)) tags.push(amenity); });
  // Source data sometimes marks a site historic only in `subcategory` (e.g.
  // Norfolk's "HISTORICAL" library subcategory) without a top-level `history`
  // tag. Fold that in rather than dropping it silently. This is intentionally
  // conservative — it does NOT infer `history` from name/description
  // keywords like "Memorial" or "Monument"; those are real data gaps the
  // audit script flags for a human to confirm and retag upstream.
  if (poi.subcategory && /histor/i.test(poi.subcategory) && !tags.includes('history')) tags.push('history');
  return tags;
}
function inferHistorySubtype(poi) {
  if (poi.historySubtype && HISTORY_SUBTYPES[poi.historySubtype]) return poi.historySubtype;
  const text = `${poi.subcategory || ''} ${poi.name || ''} ${poi.description || ''}`;
  if (/museum/i.test(text)) return 'museum';
  if (/monument/i.test(text)) return 'monument';
  if (/cemetery/i.test(text)) return 'cemetery';
  if (/librar|building|hall|house|church/i.test(text)) return 'landmark';
  return 'marker';
}
function poiTags(poi) {
  const tags = normalizePoiTags(poi);
  if (tags.includes('history')) {
    const subtypeTag = `history_${inferHistorySubtype(poi)}`;
    if (!tags.includes(subtypeTag)) tags.push(subtypeTag);
  }
  return tags;
}
function primaryPoiTag(poi) {
  const tags = poiTags(poi);
  return POI_TAG_PRIORITY.find((tag) => tags.includes(tag)) || tags[0] || 'history';
}
function migratePoi(poi, cityId) {
  const config = CITIES[cityId];
  return { ...poi, city: cityId, tags: normalizePoiTags(poi), radius: poi.radius || config?.defaultGeofenceRadiusMeters || 50 };
}

async function loadCityData(cityId) {
  const config = CITIES[cityId];
  const saved = (await db.all('points_of_interest')).filter((poi) => poi.city === cityId);
  const metadata = await db.get('poi_metadata', `${cityId}-seed`);
  const response = await fetch(config.dataFile);
  if (!response.ok) throw new Error(`${cityLabel(cityId)} places data could not be loaded.`);
  const seed = await response.json();
  if (!metadata || metadata.version !== seed.metadata.version || !saved.length) {
    const newPois = seed.pointsOfInterest.map((poi) => migratePoi(poi, cityId));
    await Promise.all(newPois.map((item) => db.put('points_of_interest', item)));
    await db.put('poi_metadata', { id: `${cityId}-seed`, version: seed.metadata.version, attribution: seed.metadata.attribution, trailSegments: seed.trailSegments || [] });
    state.cityPois[cityId] = newPois;
    state.trailSegments[cityId] = seed.trailSegments || [];
  } else {
    state.cityPois[cityId] = saved.map((poi) => migratePoi(poi, cityId));
    state.trailSegments[cityId] = metadata.trailSegments || [];
  }
}
async function loadAllCityData() {
  await Promise.all(Object.keys(CITIES).map((cityId) => loadCityData(cityId).catch((error) => console.error(error))));
}

function city() { return CITIES[state.activeCity]; }
// A "history site" is any POI actually tagged `history` — NOT any POI that
// happens to have a geofence radius (every POI gets a default radius via
// migratePoi, so that check was matching parks, libraries, etc. too).
function citySites() { return (state.cityPois[state.activeCity] || []).filter((poi) => poiTags(poi).includes('history')); }
function withinRenderBounds(poi) {
  if (!state.map) return true;
  try { return state.map.getBounds().pad(0.6).contains([poi.lat, poi.lng]); } catch { return true; }
}
function uid(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function distanceMeters(a, b) {
  const r = 6371e3, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
function formatDistance(meters) { return (meters / 1609.344).toFixed(meters < 160 ? 2 : 1); }
function formatDuration(seconds) { const min = Math.floor(seconds / 60); return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
function shortDate(value) { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value)); }
function dayKey(date = new Date()) { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function previousDayKey(key) { const d = new Date(`${key}T12:00:00`); d.setDate(d.getDate() - 1); return dayKey(d); }
function setStatus(text, locating = false) { el('mapStatusText').textContent = text; el('mapStatus').classList.toggle('locating', locating); }
function toast(message) { const node = el('toast'); node.textContent = message; node.classList.remove('hidden'); clearTimeout(toast.timeout); toast.timeout = setTimeout(() => node.classList.add('hidden'), 3200); }
function escapeHtml(text) { return String(text || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char])); }

function normalizeProfile(raw = {}) {
  const sites = Array.isArray(raw.sitesDiscovered) ? { vienna: raw.sitesDiscovered } : (raw.sitesDiscovered || {});
  const normalizedSites = {};
  Object.entries(sites).forEach(([key, ids]) => { normalizedSites[key] = [...new Set(Array.isArray(ids) ? ids : [])]; });
  return {
    ...DEFAULT_PROFILE, ...raw, id: 'local-user', totalPoints: Number(raw.totalPoints) || 0,
    walksCompleted: Number(raw.walksCompleted) || 0, milesTotal: Number(raw.milesTotal) || 0,
    observationsLogged: Number(raw.observationsLogged) || 0, streakDays: Number(raw.streakDays) || 0,
    sitesDiscovered: normalizedSites
  };
}
function sitesForProfile(profile, cityId = state.activeCity) { return profile.sitesDiscovered[cityId] || []; }
function totalSitesDiscovered(profile) { return Object.values(profile.sitesDiscovered).reduce((total, ids) => total + ids.length, 0); }
function localObservationCity(observation) { return observation.city || 'vienna'; }

async function createMigratedProfile() {
  const [walks, observations, moments] = await Promise.all([db.all('walks'), db.all('observations'), db.all('moments')]);
  const profile = normalizeProfile({
    walksCompleted: walks.length,
    milesTotal: walks.reduce((total, walk) => total + ((walk.distanceMeters || 0) / 1609.344), 0),
    observationsLogged: observations.length,
    sitesDiscovered: {},
    totalPoints: walks.reduce((total, walk) => total + Math.round(((walk.distanceMeters || 0) / 1609.344) * POINTS_PER_MILE), 0) + observations.length * POINTS_PER_OBSERVATION
  });
  moments.filter((moment) => moment.type === 'history' && moment.siteId).forEach((moment) => {
    const cityId = moment.city || 'vienna';
    const ids = sitesForProfile(profile, cityId);
    if (!ids.includes(moment.siteId)) {
      profile.sitesDiscovered[cityId] = [...ids, moment.siteId];
      profile.totalPoints += POINTS_PER_NEW_HISTORY_SITE;
    }
  });
  return profile;
}
async function loadLocalState() {
  const [savedProfile, savedSettings] = await Promise.all([db.get('profile', 'local-user'), db.get('settings', 'app-settings')]);
  state.profile = savedProfile ? normalizeProfile(savedProfile) : await createMigratedProfile();
  state.settings = { ...DEFAULT_SETTINGS, ...(savedSettings || {}) };
  if (!CITIES[state.settings.activeCity]) state.settings.activeCity = 'vienna';
  state.activeCity = state.settings.activeCity;
  await Promise.all([db.put('profile', state.profile), db.put('settings', state.settings)]);
}

function calculateWalkAward(walk, profile = state.profile) {
  const miles = (walk.distanceMeters || 0) / 1609.344;
  const today = dayKey();
  const firstWalkToday = profile.lastWalkDate !== today;
  const nextStreak = !firstWalkToday ? profile.streakDays : (profile.lastWalkDate === previousDayKey(today) ? profile.streakDays + 1 : 1);
  const distancePoints = Math.round(miles * POINTS_PER_MILE);
  const streakPoints = firstWalkToday ? STREAK_BONUS_PER_DAY : 0;
  return { miles, date: today, firstWalkToday, nextStreak, distancePoints, streakPoints, total: distancePoints + streakPoints };
}
async function updateProfile(mutator) {
  const result = await mutator(state.profile);
  state.profile = normalizeProfile(state.profile);
  await db.put('profile', state.profile);
  renderProfile();
  void syncProfile().catch((error) => console.warn('Aggregate profile sync deferred:', error.message));
  return result;
}

function renderPoiTagFilters() {
  const pois = state.cityPois[state.activeCity] || [];
  const availableTags = new Set(pois.flatMap((poi) => poiTags(poi)));
  el('poiTagFilters').innerHTML = POI_TAGS
    .filter(([id]) => availableTags.has(id))
    .map(([id, label]) => `<button type="button" class="poi-chip ${state.poiTags.has(id) ? 'active' : ''}" data-poi-tag="${id}">${label}</button>`)
    .join('');
  updateFiltersBadge();
}
function updateFiltersBadge() {
  const badge = el('filtersBadge');
  if (!badge) return;
  badge.textContent = state.poiTags.size ? String(state.poiTags.size) : '';
  badge.classList.toggle('hidden', !state.poiTags.size);
}
function poiMatchesFilters(poi) {
  if (!state.poiTags.size) return true;
  const tags = poiTags(poi);
  return [...state.poiTags].some((tag) => tags.includes(tag));
}
function renderCityPois() {
  if (!state.poiLayer) return;
  state.poiLayer.clearLayers(); state.trailLayer.clearLayers();
  const pois = state.cityPois[state.activeCity] || [];
  const markers = pois
    .filter((poi) => !poiTags(poi).includes('history'))
    .filter(poiMatchesFilters)
    .filter(withinRenderBounds)
    .map((poi) => {
      const markerTag = primaryPoiTag(poi);
      const icon = L.divIcon({ className: '', html: `<div class="poi-marker ${markerTag}">${POI_ICONS[markerTag] || '•'}</div>`, iconSize: [27, 27], iconAnchor: [13, 13] });
      const tagLabels = poiTags(poi).map((tag) => TAG_LABELS[tag] || tag.replaceAll('_', ' ')).join(', ');
      const details = [poi.description, poi.address, tagLabels ? `Tags: ${tagLabels}` : null].filter(Boolean).map(escapeHtml).join('<br>');
      const link = poi.link ? `<br><a href="${escapeHtml(poi.link)}" target="_blank" rel="noreferrer">Learn more ↗</a>` : '';
      return L.marker([poi.lat, poi.lng], { icon, title: poi.name }).bindPopup(`<strong>${escapeHtml(poi.name)}</strong>${details ? `<br><span>${details}</span>` : ''}${link}`);
    });
  if (state.poiLayer.addLayers) state.poiLayer.addLayers(markers); else markers.forEach((marker) => marker.addTo(state.poiLayer));
  const segments = state.trailSegments[state.activeCity] || [];
  if (!state.poiTags.size || state.poiTags.has('trail')) {
    segments.forEach((segment) => segment.coordinates.forEach((coordinates) => L.polyline(coordinates.map(([lng, lat]) => [lat, lng]), { color: '#2d7259', weight: 5, opacity: .82 }).bindTooltip('Elizabeth River Trail').addTo(state.trailLayer)));
  }
  renderHistorySites();
}
function renderHistorySites() {
  if (!state.historyLayer) return;
  state.historyLayer.clearLayers();
  if (state.historyRadiusLayer) state.historyRadiusLayer.clearLayers();
  const active = city();
  const sites = citySites().filter(poiMatchesFilters).filter(withinRenderBounds);
  const markers = sites.map((site) => {
    const subtype = inferHistorySubtype(site);
    const glyph = HISTORY_SUBTYPES[subtype]?.icon || '🏛';
    const historyIcon = L.divIcon({
      className: '',
      html: `<div class="historic-pin${site.unverified ? ' unverified' : ''}"><span class="pin-body"><span class="pin-icon">${glyph}</span></span></div>`,
      iconSize: [32, 40], iconAnchor: [16, 38]
    });
    const marker = L.marker([site.lat, site.lng], { icon: historyIcon, title: site.name });
    const subtypeLabel = HISTORY_SUBTYPES[subtype]?.label;
    marker.bindTooltip(site.unverified ? `${site.name} — unverified` : `${site.name}${subtypeLabel ? ` · ${subtypeLabel}` : ''}`, { direction: 'top', offset: [0, -32] });
    marker.on('click', () => showHistory(site, distanceMeters(state.currentPosition || active.center, site)));
    if (state.historyRadiusLayer) {
      L.circle([site.lat, site.lng], { radius: site.radius, stroke: true, weight: 1, color: site.unverified ? '#d4932f' : '#2d7259', opacity: .38, fillColor: site.unverified ? '#d4932f' : '#2d7259', fillOpacity: .06, interactive: false }).addTo(state.historyRadiusLayer);
    }
    return marker;
  });
  if (state.historyLayer.addLayers) state.historyLayer.addLayers(markers); else markers.forEach((marker) => marker.addTo(state.historyLayer));
}
function renderCityExplorer() {
  el('norfolkAttribution').classList.toggle('hidden', state.activeCity !== 'norfolk');
  el('trailFeatureButton').classList.toggle('hidden', !(state.trailSegments[state.activeCity] || []).length);
  updateFiltersBadge();
}
function openFiltersSheet() {
  renderPoiTagFilters();
  openSheet('filtersSheet');
}
function showView(view) {
  state.activeView = view;
  el('mapView').classList.toggle('hidden', view !== 'map');
  el('profileView').classList.toggle('hidden', view !== 'profile');
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  if (view === 'profile') {
    renderProfile();
    renderArchive();
  } else if (state.map) {
    state.map.invalidateSize();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
function initMap() {
  const active = city();
  state.map = L.map('map', { zoomControl: false, attributionControl: true }).setView([active.center.lat, active.center.lng], active.zoom);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors', crossOrigin: true }).addTo(state.map);
  state.historyRadiusLayer = L.layerGroup().addTo(state.map);
  const clusterOptions = (badgeClass) => ({
    chunkedLoading: true, // progressive loading: adds markers in batches off the main thread
    maxClusterRadius: 55,
    disableClusteringAtZoom: 17, // split back into individual pins once zoomed in
    iconCreateFunction: (cluster) => L.divIcon({ className: '', html: `<div class="cluster-badge ${badgeClass}">${cluster.getChildCount()}</div>`, iconSize: [36, 36] })
  });
  state.historyLayer = (typeof L.markerClusterGroup === 'function' ? L.markerClusterGroup(clusterOptions('history-cluster')) : L.layerGroup()).addTo(state.map);
  state.observationLayer = L.layerGroup().addTo(state.map);
  state.poiLayer = (typeof L.markerClusterGroup === 'function' ? L.markerClusterGroup(clusterOptions('poi-cluster')) : L.layerGroup()).addTo(state.map);
  state.trailLayer = L.featureGroup().addTo(state.map);
  state.map.on('click', (event) => openObservation({ lat: event.latlng.lat, lng: event.latlng.lng }));
  // Viewport windowing: only build markers for what's on/near screen, recomputed
  // after panning/zooming settles. Stands in for server-side bbox filtering
  // until the backend described in the recommendations exists.
  state.map.on('moveend zoomend', debounce(() => renderCityPois(), 200));
}
async function refreshCityMap(recenter = false) {
  const active = city();
  state.observationLayer.clearLayers(); state.prompted.clear();
  const observations = await db.all('observations');
  observations.filter((observation) => localObservationCity(observation) === state.activeCity).forEach(addObservationMarker);
  if (recenter) state.map.setView([active.center.lat, active.center.lng], active.zoom);
  el('activeCityLabel').textContent = cityLabel(state.activeCity);
  el('map').setAttribute('aria-label', `Map of ${cityLabel(state.activeCity)} historical places`);
  renderCityExplorer(); renderCityPois();
  renderProfile();
}
async function switchCity(nextCity, recenter = true) {
  if (!CITIES[nextCity]) return;
  if (state.activeWalk) { el('citySelect').value = state.activeCity; toast('Finish the current walk before switching cities.'); return; }
  state.activeCity = nextCity; state.settings.activeCity = nextCity;
  state.poiTags.clear();
  await db.put('settings', state.settings);
  await refreshCityMap(recenter);
  setStatus(`${cityLabel(nextCity)} ready for a walk`);
  toast(`Now exploring ${cityLabel(nextCity)}.`);
}

function renderUserLocation(point, pan = false) {
  state.currentPosition = point;
  const icon = L.divIcon({ className: '', html: '<div class="user-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  if (!state.userMarker) state.userMarker = L.marker([point.lat, point.lng], { icon, zIndexOffset: 1000, title: 'Your location' }).addTo(state.map);
  else state.userMarker.setLatLng([point.lat, point.lng]);
  if (pan) state.map.panTo([point.lat, point.lng]);
}
function checkGeofences(point) {
  const settings = state.settings || {};
  if (settings.enableGeofencing === false) return;
  const enabledCategories = new Set(settings.geofenceCategories || GEOFENCE_CATEGORIES.map(([id]) => id));
  const defaultRadius = settings.defaultGeofenceRadiusMeters || 50;
  const pois = state.cityPois[state.activeCity] || [];
  const nearby = pois.find((poi) => {
    const tags = poiTags(poi);
    if (!tags.some((tag) => enabledCategories.has(tag))) return false;
    if (state.prompted.has(`${state.activeCity}:${poi.id}`)) return false;
    const effectiveRadius = poi.radius || defaultRadius;
    return distanceMeters(point, poi) <= effectiveRadius;
  });
  if (nearby && !state.modalOpen) showHistory(nearby, distanceMeters(point, nearby));
}
function addWalkPoint(point) {
  if (!state.activeWalk || state.activeWalk.paused) return;
  if (!Number.isFinite(point.accuracy) || point.accuracy > MAX_GPS_ACCURACY_METERS) return;
  const points = state.activeWalk.points;
  const last = points.at(-1);
  const lastRaw = state.activeWalk.lastRawPoint;
  const now = Date.now();
  if (lastRaw) {
    const elapsedSeconds = Math.max(1, (now - lastRaw.capturedAtMs) / 1000);
    if (distanceMeters(lastRaw, point) / elapsedSeconds > MAX_WALK_SPEED_MPS) return;
  }
  if (last && distanceMeters(last, point) < 7) return;
  const samples = [...points.slice(-2), point];
  const smoothed = { lat: samples.reduce((sum, sample) => sum + sample.lat, 0) / samples.length, lng: samples.reduce((sum, sample) => sum + sample.lng, 0) / samples.length, accuracy: point.accuracy, capturedAt: new Date(now).toISOString() };
  state.activeWalk.lastRawPoint = { ...point, capturedAtMs: now };
  state.activeWalk.points.push(smoothed);
  state.activeWalk.distanceMeters += last ? distanceMeters(last, smoothed) : 0;
  if (!state.routeLine) state.routeLine = L.polyline([], { color: '#245448', weight: 5, opacity: .85 }).addTo(state.map);
  state.routeLine.addLatLng([smoothed.lat, smoothed.lng]);
  updateWalkDisplay();
}
function updateWalkDisplay() {
  const walk = state.activeWalk;
  if (!walk) { el('walkDuration').textContent = '00:00'; el('walkDistance').textContent = '0.00'; el('walkPoints').textContent = '0'; return; }
  const pausedNow = walk.pausedAt ? Date.now() - new Date(walk.pausedAt).getTime() : 0;
  walk.durationSeconds = Math.max(0, Math.floor((Date.now() - new Date(walk.startedAt).getTime() - (walk.pausedMilliseconds || 0) - pausedNow) / 1000));
  el('walkDuration').textContent = formatDuration(walk.durationSeconds);
  el('walkDistance').textContent = formatDistance(walk.distanceMeters);
  el('walkPoints').textContent = calculateWalkAward(walk).total;
}
function handlePosition(position, shouldPan = false) {
  const point = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
  renderUserLocation(point, shouldPan);
  const weakSignal = !Number.isFinite(point.accuracy) || point.accuracy > MAX_GPS_ACCURACY_METERS;
  if (weakSignal) { setStatus(`GPS signal weak (${Math.round(point.accuracy || 0)} m) - route not updated`); return; }
  setStatus(state.activeWalk ? (state.activeWalk.paused ? 'Walk paused' : 'Recording your walk') : 'Location found', Boolean(state.activeWalk && !state.activeWalk.paused));
  if (state.activeWalk) addWalkPoint(point);
  checkGeofences(point);
}
function getCurrentLocation() {
  if (!navigator.geolocation) { toast('This browser does not support location. Try the history preview instead.'); return; }
  setStatus('Finding your location...', true);
  navigator.geolocation.getCurrentPosition((position) => handlePosition(position, true), (error) => { setStatus('Location unavailable'); toast(error.code === 1 ? 'Location permission is needed to detect nearby places.' : 'Could not get a location. Check your signal and try again.'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 });
}
function ensurePauseButton() {
  let button = el('pauseWalkButton');
  if (!button) { button = document.createElement('button'); button.id = 'pauseWalkButton'; button.type = 'button'; button.className = 'secondary-button'; el('walkButton').before(button); button.addEventListener('click', togglePauseWalk); }
  button.classList.remove('hidden'); button.textContent = 'Pause';
}
function pauseWalk() { const walk = state.activeWalk; if (!walk) return; walk.paused = true; walk.pausedAt = new Date().toISOString(); el('pauseWalkButton').textContent = 'Resume'; setStatus('Walk paused'); updateWalkDisplay(); }
function resumeWalk() { const walk = state.activeWalk; if (!walk || !walk.paused) return; walk.pausedMilliseconds += Date.now() - new Date(walk.pausedAt).getTime(); walk.paused = false; walk.pausedAt = null; walk.lastRawPoint = null; el('pauseWalkButton').textContent = 'Pause'; setStatus('Recording your walk', true); }
function togglePauseWalk() { if (state.activeWalk?.paused) resumeWalk(); else pauseWalk(); }
function startWalk() {
  if (!navigator.geolocation) { toast('Location is not supported in this browser.'); return; }
  state.activeWalk = { id: uid('walk'), city: state.activeCity, startedAt: new Date().toISOString(), endedAt: null, durationSeconds: 0, distanceMeters: 0, points: [], journal: null, paused: false, pausedAt: null, pausedMilliseconds: 0, lastRawPoint: null };
  ensurePauseButton(); state.routeLine?.remove(); state.routeLine = L.polyline([], { color: '#245448', weight: 5, opacity: .85 }).addTo(state.map);
  el('walkButton').textContent = 'End walk'; el('walkButton').classList.add('walking'); setStatus('Recording your walk', true);
  state.timerId = setInterval(updateWalkDisplay, 1000);
  state.watchId = navigator.geolocation.watchPosition((position) => handlePosition(position, state.activeWalk.points.length === 0), () => { setStatus('Location connection paused'); toast('Location connection paused - your current route is still saved.'); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  getCurrentLocation();
}
async function stopWalk() {
  if (!state.activeWalk) return;
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null; clearInterval(state.timerId); state.timerId = null; updateWalkDisplay();
  const finished = { ...state.activeWalk, endedAt: new Date().toISOString(), points: [...state.activeWalk.points] };
  const award = await updateProfile((profile) => { const score = calculateWalkAward(finished, profile); profile.totalPoints += score.total; profile.walksCompleted += 1; profile.milesTotal += score.miles; if (score.firstWalkToday) { profile.streakDays = score.nextStreak; profile.lastWalkDate = score.date; } return score; });
  finished.pointsAwarded = award.total; await db.put('walks', finished); state.activeWalk = null;
  el('walkButton').textContent = 'Start walk'; el('walkButton').classList.remove('walking'); const pauseButton = el('pauseWalkButton'); if (pauseButton) pauseButton.classList.add('hidden');
  setStatus('Walk saved locally'); toast(`Walk saved - +${award.total} points.`); renderArchive(); openJournal(finished.id);
}
function openSheet(id) { state.modalOpen = id; el('modalBackdrop').classList.remove('hidden'); el(id).classList.remove('hidden'); }
function closeSheets() {
  state.modalOpen = null;
  el('modalBackdrop').classList.add('hidden');
  document.querySelectorAll('.sheet').forEach((sheet) => sheet.classList.add('hidden'));
  if (state.draftMarker) { state.draftMarker.remove(); state.draftMarker = null; }
}
function showHistory(site, distance) {
  state.currentSite = site; state.prompted.add(`${state.activeCity}:${site.id}`);
  el('historyTitle').textContent = site.name;
  el('historyDescription').textContent = site.description;
  el('historySource').href = site.source || '#';
  el('historySource').classList.toggle('hidden', !site.source);
  el('historyWarning').classList.toggle('hidden', !site.unverified);
  el('historyDistance').textContent = Number.isFinite(distance) ? `${Math.round(distance)} m from your location` : 'Within your walking radius';
  openSheet('historySheet');
}
async function saveHistoryMoment() {
  const site = state.currentSite; if (!site) return;
  const cityId = state.activeCity;
  const award = await updateProfile((profile) => {
    const discovered = sitesForProfile(profile, cityId);
    if (discovered.includes(site.id)) return { points: 0, firstDiscovery: false };
    profile.sitesDiscovered[cityId] = [...discovered, site.id];
    profile.totalPoints += POINTS_PER_NEW_HISTORY_SITE;
    return { points: POINTS_PER_NEW_HISTORY_SITE, firstDiscovery: true };
  });
  await db.put('moments', {
    id: uid('moment'), type: 'history', title: `Visited ${site.name}`,
    note: site.unverified ? 'Prototype historic-place prompt saved. Content is unverified.' : 'Historic-place prompt saved during a walk.',
    siteId: site.id, city: cityId, pointsAwarded: award.points, createdAt: new Date().toISOString(), location: { lat: site.lat, lng: site.lng }
  });
  closeSheets(); toast(award.firstDiscovery ? `New history site — +${award.points} points.` : 'History moment saved to your local archive.'); renderArchive();
}

function openObservation(location) {
  const loc = location || state.currentPosition || { lat: state.map.getCenter().lat, lng: state.map.getCenter().lng };
  state.draftObservationLocation = loc;
  if (state.draftMarker) state.draftMarker.remove();
  const icon = L.divIcon({ className: '', html: '<div class="wildlife-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  state.draftMarker = L.marker([loc.lat, loc.lng], { icon }).addTo(state.map);
  el('observationLocation').textContent = `Pinned at ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)} in ${cityLabel(state.activeCity)}. Move it by closing this form and tapping a new spot on the map.`;
  el('observationForm').reset(); el('photoName').textContent = 'Optional, stored only on this device';
  openSheet('observationSheet');
}
async function saveObservation(event) {
  event.preventDefault();
  const file = el('photoInput').files[0];
  let photo = null;
  if (file) photo = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
  const observation = { id: uid('observation'), type: 'observation', city: state.activeCity, species: el('speciesInput').value.trim(), note: el('observationNote').value.trim(), photo, location: state.draftObservationLocation, createdAt: new Date().toISOString(), pointsAwarded: POINTS_PER_OBSERVATION };
  await db.put('observations', observation);
  await updateProfile((profile) => { profile.totalPoints += POINTS_PER_OBSERVATION; profile.observationsLogged += 1; return POINTS_PER_OBSERVATION; });
  addObservationMarker(observation); closeSheets(); toast(`Observation saved — +${POINTS_PER_OBSERVATION} points.`); renderArchive();
}
function addObservationMarker(observation) {
  const icon = L.divIcon({ className: '', html: '<div class="wildlife-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  const marker = L.marker([observation.location.lat, observation.location.lng], { icon, title: observation.species }).addTo(state.observationLayer);
  marker.bindPopup(`<strong>${escapeHtml(observation.species)}</strong>${observation.note ? `<br><span>${escapeHtml(observation.note)}</span>` : ''}`);
}

function openJournal(walkId = null) { el('journalForm').reset(); el('journalForm').dataset.walkId = walkId || ''; openSheet('journalSheet'); }
async function saveJournal(event) {
  event.preventDefault();
  const mood = document.querySelector('input[name="mood"]:checked').value;
  const note = el('journalNote').value.trim();
  const walkId = event.currentTarget.dataset.walkId;
  const moment = { id: uid('moment'), type: 'journal', title: mood, note: note || 'A reflection saved after a walk.', createdAt: new Date().toISOString(), walkId: walkId || null, city: state.activeCity };
  await db.put('moments', moment);
  closeSheets(); toast('Reflection saved locally.'); renderArchive();
}

function momentCard(item) {
  const kind = item.type === 'observation' ? 'observation' : item.type === 'history' ? 'history' : item.type === 'walk' ? 'walk' : 'journal';
  const icons = { observation: '⌁', history: '✦', walk: '↝', journal: '✎' };
  const title = item.species || item.title || 'Walk';
  let detail = item.note || '';
  if (item.type === 'walk') detail = `${formatDistance(item.distanceMeters)} miles · ${formatDuration(item.durationSeconds)} · +${item.pointsAwarded ?? 0} pts`;
  if (!detail) detail = item.type === 'observation' ? 'Nature observation' : 'Journal reflection';
  return `<article class="moment-card ${item.type === 'walk' ? 'walk-card' : ''}" ${item.type === 'walk' ? `data-walk-id="${escapeHtml(item.id)}" role="button" tabindex="0"` : ''}><span class="moment-symbol ${kind === 'history' ? 'history' : kind === 'walk' ? 'walk' : ''}">${icons[kind]}</span><div class="moment-copy"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div><time class="moment-date">${shortDate(item.createdAt || item.startedAt)}</time></article>`;
}
async function allArchiveItems() {
  const [walks, observations, moments] = await Promise.all([db.all('walks'), db.all('observations'), db.all('moments')]);
  return [...walks.map((walk) => ({ ...walk, type: 'walk', createdAt: walk.startedAt })), ...observations, ...moments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
async function renderArchive() {
  let items = await allArchiveItems();
  if (state.archiveFilter === 'walk') items = items.filter((item) => item.type === 'walk' || item.type === 'journal');
  if (state.archiveFilter === 'observation') items = items.filter((item) => item.type === 'observation');
  el('archiveList').innerHTML = items.length ? items.map(momentCard).join('') : '<div class="empty-state">No matching moments yet. Start a walk or add an observation from the map.</div>';
}
function setArchiveFilter(filter = 'all') {
  state.archiveFilter = filter;
  document.querySelectorAll('.archive-filter .filter-button').forEach((button) => button.classList.toggle('active', button.dataset.filter === filter));
  renderArchive();
}

function badge(name, earned, detail) { return `<span class="badge ${earned ? 'earned' : ''}" title="${escapeHtml(detail)}">${earned ? '✓ ' : ''}${escapeHtml(name)}</span>`; }
function renderGeofenceCategoryChips() {
  const selected = new Set(state.settings.geofenceCategories || GEOFENCE_CATEGORIES.map(([id]) => id));
  const chipsEl = el('geofenceCategoryChips');
  if (chipsEl) {
    chipsEl.innerHTML = GEOFENCE_CATEGORIES.map(([id, label]) => `<button type="button" class="poi-chip ${selected.has(id) ? 'active' : ''}" data-geofence-category="${id}">${label}</button>`).join('');
  }
}
function renderProfile() {
  const profile = state.profile; const cityDiscoveries = sitesForProfile(profile).length; const totalCitySites = citySites().length;
  el('profilePoints').textContent = Math.round(profile.totalPoints).toLocaleString();
  el('profileStats').innerHTML = [
    [profile.walksCompleted, 'Walks completed'], [profile.milesTotal.toFixed(1), 'Miles total'],
    [`${cityDiscoveries}/${totalCitySites}`, `${CITIES[state.activeCity].name} sites`], [profile.observationsLogged, 'Observations'], [profile.streakDays, 'Day streak']
  ].map(([value, label]) => `<div class="profile-stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
  el('badgeList').innerHTML = [
    badge('First Steps', profile.walksCompleted >= 1, 'Complete one walk.'),
    badge('Explorer', totalCitySites > 0 && cityDiscoveries >= totalCitySites, `Discover every history stop in ${cityLabel(state.activeCity)}.`),
    badge('Century Club', profile.totalPoints >= 100, 'Earn 100 total trail points.'),
    badge('Naturalist', profile.observationsLogged >= 10, 'Log 10 nature observations.')
  ].join('');
  el('profileNextMilestone').textContent = profile.walksCompleted < 1 ? 'Complete a walk to earn First Steps.' : profile.totalPoints < 100 ? `${Math.max(0, 100 - Math.round(profile.totalPoints))} points to Century Club.` : 'Your local trail story is growing.';
  const select = el('citySelect');
  const grouped = {};
  Object.entries(CITIES).forEach(([id, item]) => {
    if (!grouped[item.state]) grouped[item.state] = [];
    grouped[item.state].push([id, item]);
  });
  select.innerHTML = Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stateCode, cities]) => `<optgroup label="${escapeHtml(stateCode)}">${cities.map(([id]) => `<option value="${id}">${escapeHtml(cityLabel(id))}</option>`).join('')}</optgroup>`)
    .join('');
  select.value = state.activeCity;
  if (el('geofenceToggle')) el('geofenceToggle').checked = state.settings.enableGeofencing !== false;
  if (el('geofenceOptionsContainer')) el('geofenceOptionsContainer').classList.toggle('hidden', state.settings.enableGeofencing === false);
  if (el('geofenceRadiusSelect')) el('geofenceRadiusSelect').value = String(state.settings.defaultGeofenceRadiusMeters || 50);
  renderGeofenceCategoryChips();
  const onlineName = state.online.remoteProfile?.username;
  el('onlineTeaserTitle').textContent = onlineName ? `Online as @${onlineName}` : 'Stay local by default';
  el('onlineTeaserText').textContent = onlineName ? `Last aggregate sync: ${state.settings.lastSyncedAt ? shortDate(state.settings.lastSyncedAt) : 'not yet'}. Routes, observations, photos, and notes remain local.` : 'Optional online mode shares only aggregate points and miles with friends—never routes, observations, photos, or notes.';
}
function openProfile() { showView('profile'); }

function onlineConfig() { return window.WALK_WILDLIFE_SUPABASE || {}; }
function onlineConfigured() {
  const config = onlineConfig();
  return Boolean(config.url && config.anonKey && window.supabase?.createClient);
}
async function setupOnline() {
  if (!onlineConfigured() || state.online.client) return;
  const config = onlineConfig();
  state.online.client = window.supabase.createClient(config.url, config.anonKey);
  const { data } = await state.online.client.auth.getSession();
  state.online.session = data.session;
  if (state.online.session) await loadRemoteProfile();
  state.online.client.auth.onAuthStateChange((_event, session) => {
    state.online.session = session;
    setTimeout(() => { if (session) void loadRemoteProfile(); else { state.online.remoteProfile = null; renderProfile(); } }, 0);
  });
setInterval(async () => {
    if (state.online.client && state.online.session) {
      await state.online.client.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', state.online.session.user.id);
    }
  }, 90000);}
async function loadRemoteProfile() {
  if (!state.online.client || !state.online.session) return null;
  const { data, error } = await state.online.client.from('profiles').select('id,username,phone,last_seen_at,total_points,miles_total,sites_discovered,updated_at').eq('id', state.online.session.user.id).maybeSingle();
  if (error) throw error;
  state.online.remoteProfile = data || null;
  renderProfile();
  return data;
}
async function syncProfile() {
  if (!state.online.client || !state.online.session || !state.online.remoteProfile?.username) return false;
  const payload = {
    id: state.online.session.user.id, username: state.online.remoteProfile.username,
    total_points: Math.round(state.profile.totalPoints), miles_total: Number(state.profile.milesTotal.toFixed(3)),
    sites_discovered: totalSitesDiscovered(state.profile), updated_at: new Date().toISOString()
  };
  const { data, error } = await state.online.client.from('profiles').upsert(payload).select().single();
  if (error) throw error;
  state.online.remoteProfile = data;
  state.settings.lastSyncedAt = new Date().toISOString();
  await db.put('settings', state.settings);
  renderProfile();
  return true;
}
async function openOnline() { await setupOnline(); openSheet('onlineSheet'); await renderOnline(); }
async function renderOnline() {
  const setup = el('onlineSetupPanel'), magic = el('magicLinkForm'), username = el('usernameForm'), dashboard = el('onlineDashboard');
  [setup, magic, username, dashboard].forEach((panel) => panel.classList.add('hidden'));
  if (!onlineConfigured()) { setup.classList.remove('hidden'); return; }
  if (!state.online.session) { magic.classList.remove('hidden'); return; }
  if (!state.online.remoteProfile?.username) { username.classList.remove('hidden'); return; }
  dashboard.classList.remove('hidden');
  el('onlineStatusText').textContent = state.settings.lastSyncedAt ? `Last synced ${shortDate(state.settings.lastSyncedAt)}` : 'Online — aggregate stats ready to sync';
  await refreshFriends();
}
async function signIn() {
  if (!onlineConfigured()) return;
  const email = el('onlineEmail').value.trim();
  const password = el('onlinePassword').value;
  if (!email || !password) { toast('Enter your email and password.'); return; }

  const { error } = await state.online.client.auth.signInWithPassword({ email, password });
  if (error) { toast(error.message); return; }

  await loadRemoteProfile();
  await renderOnline();
}

async function signUp() {
  if (!onlineConfigured()) return;
  const email = el('onlineEmail').value.trim();
  const password = el('onlinePassword').value;
  if (!email || !password) { toast('Enter your email and password.'); return; }

  const { data, error } = await state.online.client.auth.signUp({ email, password });
  if (error) { toast(error.message); return; }
  if (!data.session) { toast('Account created — check your email to confirm before continuing.'); return; }

  await loadRemoteProfile();
  await renderOnline();
}
async function createOnlineProfile(event) {
  event.preventDefault();
  if (!onlineConfigured()) return;
  const username = el('usernameInput').value.trim();
  if (!username) { toast('Enter a username.'); return; }
  const phone = el('phoneInput').value.trim();
  const payload = {
    id: state.online.session.user.id,
    username,
    phone: phone || null,
    last_seen_at: new Date().toISOString(),
    total_points: Math.round(state.profile.totalPoints),
    miles_total: Number(state.profile.milesTotal.toFixed(3)),
    sites_discovered: totalSitesDiscovered(state.profile),
    updated_at: new Date().toISOString()
  };
  const { data, error } = await state.online.client.from('profiles').upsert(payload).select().single();
  if (error) { toast(error.message.includes('unique') ? 'That username is already in use.' : error.message); return; }
  state.online.remoteProfile = data;
  state.settings.lastSyncedAt = new Date().toISOString();
  await db.put('settings', state.settings);
  renderProfile();
  await renderOnline();
  toast('Online profile created. Only aggregate stats can sync.');
}
function renderLeaderboard() {
  const rows = state.online.leaderboard || [];
  el('leaderboardList').innerHTML = rows.length ? rows.map((person, index) => {
  const isOnline = person.last_seen_at && (Date.now() - new Date(person.last_seen_at).getTime()) < 5 * 60 * 1000;
  const callLink = person.phone ? `<a class="call-link" href="tel:${escapeHtml(person.phone)}" aria-label="Call ${escapeHtml(person.username)}">📞</a>` : '';
  return `<div class="leaderboard-row"><span class="leaderboard-rank">${index + 1}</span><div class="leaderboard-person"><strong>${isOnline ? '🟢 ' : ''}${escapeHtml(person.username)}${person.id === state.online.session?.user.id ? ' (you)' : ''}</strong><span>${Number(person.miles_total || 0).toFixed(1)} miles · ${person.sites_discovered || 0} sites</span></div>${callLink}<span class="leaderboard-points">${person.total_points || 0}</span></div>`;
}).join('') : '<div class="empty-state">Add a friend by username to begin a private leaderboard.</div>';}
function renderIncomingRequests() {
  const section = el('incomingRequests');
  const list = state.online.incoming || [];
  section.classList.toggle('hidden', list.length === 0);
  el('incomingRequestsList').innerHTML = list.length
    ? list.map((request) => `<div class="leaderboard-row"><div class="leaderboard-person"><strong>@${escapeHtml(request.username)}</strong><span>wants to add you</span></div><button class="secondary-button" data-accept-id="${escapeHtml(request.user_id)}">Accept</button></div>`).join('')
    : '';
}
async function refreshFriends() {
  if (!state.online.client || !state.online.session || !state.online.remoteProfile) return;
  const me = state.online.session.user.id;
  const { data: friendships, error } = await state.online.client.from('friendships').select('user_id,friend_id,status').or(`user_id.eq.${me},friend_id.eq.${me}`);
  if (error) { console.warn('Could not refresh friendships:', error.message); return; }
  const rows = friendships || [];
  const incoming = rows.filter((row) => row.friend_id === me && row.status === 'pending');
  const acceptedIds = rows.filter((row) => row.status === 'accepted').map((row) => row.user_id === me ? row.friend_id : row.user_id);
  let people = [state.online.remoteProfile];
  if (acceptedIds.length) {
    const { data: friends, error: friendsError } = await state.online.client.from('profiles').select('id,username,phone,last_seen_at,total_points,miles_total,sites_discovered,updated_at').in('id', acceptedIds);
    if (!friendsError) people = [...people, ...(friends || [])];
  }
  const incomingIds = incoming.map((row) => row.user_id);
  let requestProfiles = [];
  if (incomingIds.length) {
    const { data } = await state.online.client.from('profiles').select('id,username').in('id', incomingIds);
    requestProfiles = data || [];
  }
  state.online.leaderboard = people.sort((a, b) => (b.total_points || 0) - (a.total_points || 0));
  state.online.incoming = incoming.map((row) => ({ ...row, username: requestProfiles.find((profile) => profile.id === row.user_id)?.username || 'Friend' }));
  renderLeaderboard();
  renderIncomingRequests();
}
async function findFriend(event) {
  event.preventDefault();
  const username = el('friendUsernameInput').value.trim();
  const { data, error } = await state.online.client.rpc('find_profile_by_username', { query_username: username });
  if (error) { toast(error.message); return; }
  const candidate = data?.[0];
  if (!candidate) { el('friendSearchResult').classList.add('hidden'); toast('No user found with that username.'); return; }
  if (candidate.id === state.online.session.user.id) { toast('That is your own profile.'); return; }
  state.online.candidate = candidate;
  el('friendSearchResult').innerHTML = `<div><strong>@${escapeHtml(candidate.username)}</strong><span>Send a private friend request</span></div><button class="secondary-button" id="sendFriendRequestButton">Add</button>`;
  el('friendSearchResult').classList.remove('hidden');
  el('sendFriendRequestButton').addEventListener('click', sendFriendRequest, { once: true });
}
async function sendFriendRequest() {
  const candidate = state.online.candidate; if (!candidate) return;
  const { error } = await state.online.client.from('friendships').insert({ user_id: state.online.session.user.id, friend_id: candidate.id, status: 'pending' });
  if (error) { toast(error.code === '23505' ? 'A request already exists for this friend.' : error.message); return; }
  state.online.candidate = null; el('friendSearchResult').classList.add('hidden'); toast(`Friend request sent to @${candidate.username}.`);
}
function openAccountSettings() {
  el('accountUsernameInput').value = state.online.remoteProfile?.username || '';
  el('accountPhoneInput').value = state.online.remoteProfile?.phone || '';
  el('accountEmailInput').value = state.online.session?.user?.email || '';
  el('accountPasswordInput').value = '';
  openSheet('accountSheet');
}
async function updateAccountUsername(event) {
  event.preventDefault();
  const username = el('accountUsernameInput').value.trim();
  if (!username) { toast('Enter a username.'); return; }
  const { data, error } = await state.online.client.from('profiles').update({ username, updated_at: new Date().toISOString() }).eq('id', state.online.session.user.id).select().single();
  if (error) { toast(error.message.includes('unique') ? 'That username is already in use.' : error.message); return; }
  state.online.remoteProfile = data;
  renderProfile();
  toast('Username updated.');
}
async function updateAccountPhone(event) {
  event.preventDefault();
  const phone = el('accountPhoneInput').value.trim();
  const { data, error } = await state.online.client.from('profiles').update({ phone: phone || null, updated_at: new Date().toISOString() }).eq('id', state.online.session.user.id).select().single();
  if (error) { toast(error.message); return; }
  state.online.remoteProfile = data;
  toast('Phone number updated.');
}
async function updateAccountEmail(event) {
  event.preventDefault();
  const email = el('accountEmailInput').value.trim();
  const { error } = await state.online.client.auth.updateUser({ email });
  if (error) { toast(error.message); return; }
  toast('Check your new email inbox to confirm the change.');
}
async function updateAccountPassword(event) {
  event.preventDefault();
  const password = el('accountPasswordInput').value;
  if (!password || password.length < 6) { toast('Password must be at least 6 characters.'); return; }
  const { error } = await state.online.client.auth.updateUser({ password });
  if (error) { toast(error.message); return; }
  el('accountPasswordInput').value = '';
  toast('Password updated.');
}
async function acceptFriend(friendId) {
  const { error } = await state.online.client.from('friendships').update({ status: 'accepted' }).eq('user_id', friendId).eq('friend_id', state.online.session.user.id);
  if (error) { toast(error.message); return; }
  toast('Friend added to your leaderboard.'); await refreshFriends();
}

function initBackupControls() {
  const panel = document.createElement('div'); panel.className = 'backup-controls';
  panel.innerHTML = '<p class="sheet-kicker">YOUR BACKUP</p><p>Download a private copy of this device journal, or restore a backup. Restoring replaces this device\'s current journal.</p><div class="backup-actions"><button class="secondary-button" id="exportDataButton" type="button">Export journal</button><label class="secondary-button import-label">Import journal<input id="importDataInput" type="file" accept="application/json,.json" /></label></div>';
  el('clearDataButton').before(panel);
  el('exportDataButton').addEventListener('click', exportJournal);
  el('importDataInput').addEventListener('change', importJournal);
}
async function exportJournal() {
  const [walks, observations, moments, profile, settings] = await Promise.all([db.all('walks'), db.all('observations'), db.all('moments'), db.get('profile', 'local-user'), db.get('settings', 'app-settings')]);
  const backup = { format: 'walk-wildlife-journal', version: 1, exportedAt: new Date().toISOString(), walks, observations, moments, profile, settings };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `walk-wildlife-journal-${dayKey()}.json`; link.click(); URL.revokeObjectURL(url); toast('Journal backup downloaded.');
}
async function importJournal(event) {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup.format !== 'walk-wildlife-journal' || backup.version !== 1 || !Array.isArray(backup.walks) || !Array.isArray(backup.observations) || !Array.isArray(backup.moments)) throw new Error('Choose a Walk & Wildlife journal backup file.');
    if (!confirm('Replace this device\'s current journal with this backup? This cannot be undone.')) return;
    await db.clearAll();
    await Promise.all([...backup.walks.map((item) => db.put('walks', item)), ...backup.observations.map((item) => db.put('observations', item)), ...backup.moments.map((item) => db.put('moments', item))]);
    state.profile = normalizeProfile(backup.profile || await createMigratedProfile()); state.settings = { ...DEFAULT_SETTINGS, ...(backup.settings || {}) };
    if (!CITIES[state.settings.activeCity]) state.settings.activeCity = 'vienna'; state.activeCity = state.settings.activeCity;
    await Promise.all([db.put('profile', state.profile), db.put('settings', state.settings)]); closeSheets(); await refreshCityMap(true); await renderArchive(); toast('Journal backup restored.');
  } catch (error) { toast(error.message || 'That backup could not be restored.'); }
}
async function openWalkDetail(id) {
  const walk = await db.get('walks', id); if (!walk) return;
  const moments = await db.all('moments'); const reflection = moments.find((item) => item.type === 'journal' && item.walkId === id);
  let sheet = el('walkDetailSheet');
  if (!sheet) { sheet = document.createElement('section'); sheet.id = 'walkDetailSheet'; sheet.className = 'sheet tall-sheet hidden'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); document.body.append(sheet); }
  sheet.innerHTML = `<button class="close-sheet" data-close-walk-detail aria-label="Close">x</button><span class="sheet-kicker">SAVED WALK</span><h2>${escapeHtml(shortDate(walk.startedAt))} walk</h2><div class="walk-detail-stats"><div><strong>${formatDistance(walk.distanceMeters)}</strong><span>Miles</span></div><div><strong>${formatDuration(walk.durationSeconds)}</strong><span>Duration</span></div><div><strong>+${walk.pointsAwarded || 0}</strong><span>Points</span></div></div><div id="walkDetailMap" class="walk-detail-map"></div>${reflection ? `<section class="walk-reflection"><p class="sheet-kicker">${escapeHtml(reflection.title)}</p><p>${escapeHtml(reflection.note)}</p></section>` : '<p class="empty-state">No reflection was saved for this walk.</p>'}`;
  sheet.querySelector('[data-close-walk-detail]').addEventListener('click', () => { state.walkDetailMap?.remove(); state.walkDetailMap = null; closeSheets(); }); openSheet('walkDetailSheet');
  setTimeout(() => { const points = walk.points || []; state.walkDetailMap?.remove(); state.walkDetailMap = L.map('walkDetailMap', { zoomControl: false, attributionControl: false }); if (points.length) { const latLngs = points.map((point) => [point.lat, point.lng]); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.walkDetailMap); L.polyline(latLngs, { color: '#245448', weight: 5 }).addTo(state.walkDetailMap); state.walkDetailMap.fitBounds(latLngs, { padding: [22, 22], maxZoom: 17 }); } else { state.walkDetailMap.setView([city().center.lat, city().center.lng], city().zoom); } }, 20);
}
function initEvents() {
  initBackupControls();
  el('archiveList').addEventListener('click', (event) => { const card = event.target.closest('[data-walk-id]'); if (card) openWalkDetail(card.dataset.walkId); });
  el('archiveList').addEventListener('keydown', (event) => { const card = event.target.closest('[data-walk-id]'); if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openWalkDetail(card.dataset.walkId); } });
  el('locateButton').addEventListener('click', getCurrentLocation);
  el('walkButton').addEventListener('click', () => state.activeWalk ? stopWalk() : startWalk());
  el('addObservationButton').addEventListener('click', () => openObservation());
  el('journalButton').addEventListener('click', () => openJournal());
  el('demoButton').addEventListener('click', () => { const site = citySites()[0]; state.map.flyTo([site.lat, site.lng], Math.max(city().zoom + 2, 16)); setTimeout(() => showHistory(site, 28), 350); });
  el('settingsButton').addEventListener('click', () => openSheet('infoSheet'));
  el('profileJournalButton').addEventListener('click', () => openJournal());
  el('filtersButton').addEventListener('click', openFiltersSheet);
  el('dismissHistoryButton').addEventListener('click', closeSheets); el('saveHistoryMomentButton').addEventListener('click', saveHistoryMoment);
  el('observationForm').addEventListener('submit', saveObservation); el('journalForm').addEventListener('submit', saveJournal);
  el('photoInput').addEventListener('change', (event) => { el('photoName').textContent = event.target.files[0]?.name || 'Optional, stored only on this device'; });
  document.querySelectorAll('[data-close-sheet]').forEach((button) => button.addEventListener('click', closeSheets));
  el('modalBackdrop').addEventListener('click', closeSheets);
  document.querySelectorAll('.archive-filter .filter-button').forEach((button) => button.addEventListener('click', () => setArchiveFilter(button.dataset.filter)));
  el('citySelect').addEventListener('change', (event) => switchCity(event.target.value));
  el('goOnlineButton').addEventListener('click', openOnline);
  el('signInButton').addEventListener('click', signIn);
el('signUpButton').addEventListener('click', signUp);
el('usernameForm').addEventListener('submit', createOnlineProfile);
  el('syncNowButton').addEventListener('click', async () => { try { await syncProfile(); await renderOnline(); toast('Aggregate stats synced.'); } catch (error) { toast(error.message || 'Could not sync right now.'); } });
  el('refreshFriendsButton').addEventListener('click', refreshFriends); el('friendSearchForm').addEventListener('submit', findFriend);
el('accountSettingsButton').addEventListener('click', openAccountSettings);
el('accountUsernameForm').addEventListener('submit', updateAccountUsername);
el('accountPhoneForm').addEventListener('submit', updateAccountPhone);
el('accountEmailForm').addEventListener('submit', updateAccountEmail);
el('accountPasswordForm').addEventListener('submit', updateAccountPassword);
  el('incomingRequestsList').addEventListener('click', (event) => { const button = event.target.closest('[data-accept-id]'); if (button) acceptFriend(button.dataset.acceptId); });
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
    closeSheets();
    if (button.dataset.view === 'profile') openProfile();
    else showView('map');
  }));
  el('clearDataButton').addEventListener('click', async () => {
    if (!confirm("Clear every locally saved walk, reflection, observation, and profile score on this device? This can't be undone.")) return;
    await db.clearAll();
    state.profile = normalizeProfile(DEFAULT_PROFILE); state.settings = { ...DEFAULT_SETTINGS }; state.activeCity = 'vienna';
    await Promise.all([db.put('profile', state.profile), db.put('settings', state.settings)]);
    closeSheets(); await refreshCityMap(true); renderArchive(); toast('Local journal data and points cleared.');
  });
  el('poiTagFilters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-poi-tag]'); if (!button) return;
    const id = button.dataset.poiTag;
    state.poiTags.has(id) ? state.poiTags.delete(id) : state.poiTags.add(id);
    renderPoiTagFilters();
  });
  el('clearPoiFiltersButton').addEventListener('click', () => { state.poiTags.clear(); renderPoiTagFilters(); renderCityPois(); });
  el('applyFiltersButton').addEventListener('click', () => { renderCityPois(); closeSheets(); });
  el('trailFeatureButton').addEventListener('click', () => {
    const bounds = state.trailLayer.getBounds();
    if (bounds.isValid()) state.map.fitBounds(bounds, { padding: [28, 28] });
  });
  if (el('geofenceToggle')) {
    el('geofenceToggle').addEventListener('change', async (event) => {
      state.settings.enableGeofencing = event.target.checked;
      await db.put('settings', state.settings);
      renderProfile();
    });
  }
  if (el('geofenceRadiusSelect')) {
    el('geofenceRadiusSelect').addEventListener('change', async (event) => {
      state.settings.defaultGeofenceRadiusMeters = Number(event.target.value) || 50;
      await db.put('settings', state.settings);
    });
  }
  if (el('geofenceCategoryChips')) {
    el('geofenceCategoryChips').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-geofence-category]'); if (!button) return;
      const id = button.dataset.geofenceCategory;
      const categories = new Set(state.settings.geofenceCategories || GEOFENCE_CATEGORIES.map(([c]) => c));
      categories.has(id) ? categories.delete(id) : categories.add(id);
      state.settings.geofenceCategories = [...categories];
      await db.put('settings', state.settings);
      renderGeofenceCategoryChips();
    });
  }
}

async function init() {
try { await db.open(); await loadLocalState(); await loadAllCityData(); } catch (error) { console.error(error); toast('Local storage or places data could not open in this browser.'); return; }  initMap();
try { initEvents(); } catch (error) { console.error('initEvents failed:', error); }
  await refreshCityMap(false); await renderArchive();
  try {
    await setupOnline();
    if (state.online.session && !state.online.remoteProfile?.username) {
      await openOnline();
      toast('Signed in! Choose a username to finish setup.');
    }
  } catch (error) { console.warn('Online mode unavailable:', error.message); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}
init();