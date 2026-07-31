import {
  DEFAULT_PROFILE,
  CITIES,
  POINTS_PER_MILE,
  STREAK_BONUS_PER_DAY,
  MAX_GPS_ACCURACY_METERS,
  MAX_WALK_SPEED_MPS,
  POI_TAGS,
  TAG_LABELS,
  POI_TAG_PRIORITY,
  POI_ICONS,
  HISTORY_SUBTYPES,
  GEOFENCE_CATEGORIES
} from './constants.js';

import { state } from './state.js';
export function el(id) {
  return document.getElementById(id);
}
export function cityLabel(cityId) {
  const config = CITIES[cityId];
  if (!config) return '';
  const suffix = cityId === 'norfolk' ? ' (prototype)' : '';
  return `${config.name}, ${config.state}${suffix}`;
}
export function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }

export function normalizePoiTags(poi) {
  const tags = [...(poi.tags || [])];
  if (poi.category && !tags.includes(poi.category)) tags.push(poi.category);
  if (poi.amenities) poi.amenities.forEach((amenity) => { if (!tags.includes(amenity)) tags.push(amenity); });
  // Source data sometimes marks a site historic only in `subcategory` (e.g.
  // Norfolk's "HISTORICAL" library subcategory) without a top-level `history`
  // tag. Fold that in rather than dropping it silently.
  if (poi.subcategory && /histor/i.test(poi.subcategory) && !tags.includes('history')) tags.push('history');
  // NYC Parks' "Historical Signs" dataset: every record's own name/source
  // says "— Historical Sign" / "Historical Signs (borough)" — this is the
  // source's own label for what the record IS, not a name-keyword guess like
  // "Memorial"/"Monument" (which stay in the audit script for a human to
  // confirm). Only ~128/2266 had a `history` tag from import; the rest were
  // tagged solely by their physical park/location category.
  if (/historical sign/i.test(`${poi.name || ''} ${poi.source || ''}`) && !tags.includes('history')) tags.push('history');
  return tags;
}
export function inferHistorySubtype(poi) {
  if (poi.historySubtype && HISTORY_SUBTYPES[poi.historySubtype]) return poi.historySubtype;
  const text = `${poi.subcategory || ''} ${poi.name || ''} ${poi.description || ''}`;
  if (/museum/i.test(text)) return 'museum';
  if (/monument/i.test(text)) return 'monument';
  if (/cemetery/i.test(text)) return 'cemetery';
  if (/librar|building|hall|house|church/i.test(text)) return 'landmark';
  return 'marker';
}
export function poiTags(poi) {
  const tags = normalizePoiTags(poi);
  if (tags.includes('history')) {
    const subtypeTag = `history_${inferHistorySubtype(poi)}`;
    if (!tags.includes(subtypeTag)) tags.push(subtypeTag);
  }
  return tags;
}
export function primaryPoiTag(poi) {
  const tags = poiTags(poi);
  return POI_TAG_PRIORITY.find((tag) => tags.includes(tag)) || tags[0] || 'history';
}
export function migratePoi(poi, cityId) {
  const config = CITIES[cityId];
  return { ...poi, city: cityId, tags: normalizePoiTags(poi), radius: poi.radius || config?.defaultGeofenceRadiusMeters || 50 };
}
export function city() { return CITIES[state.activeCity]; }
// A "history site" is any POI actually tagged `history` — NOT any POI that
// happens to have a geofence radius (every POI gets a default radius via
// migratePoi, so that check was matching parks, libraries, etc. too).
// Used for the history map layer/demo only — NOT the profile progress stat,
// see cityDiscoverableSites() below for that.
export function citySites() { return (state.cityPois[state.activeCity] || []).filter((poi) => poiTags(poi).includes('history')); }
// The profile "X/Y sites" stat and the Explorer badge track discovery across
// every enabled geofence category (parks, libraries, art, etc.) — that's what
// checkGeofences() actually awards, not just history sites. Mirrors its
// eligibility check so the denominator always matches what's collectible.
export function cityDiscoverableSites() {
  const pois = state.cityPois[state.activeCity] || [];
  const enabledCategories = new Set(state.settings?.geofenceCategories || GEOFENCE_CATEGORIES.map(([id]) => id));
  return pois.filter((poi) => poiTags(poi).some((tag) => enabledCategories.has(tag)));
}
export function withinRenderBounds(poi) {
  if (!state.map) return true;
  try { return state.map.getBounds().pad(0.6).contains([poi.lat, poi.lng]); } catch { return true; }
}
export function uid(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
export function distanceMeters(a, b) {
  const r = 6371e3, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
export function formatDistance(meters) { return (meters / 1609.344).toFixed(meters < 160 ? 2 : 1); }
export function formatDuration(seconds) { const min = Math.floor(seconds / 60); return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
export function shortDate(value) { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value)); }
export function dayKey(date = new Date()) { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function previousDayKey(key) { const d = new Date(`${key}T12:00:00`); d.setDate(d.getDate() - 1); return dayKey(d); }
export function setStatus(text, locating = false) { el('mapStatusText').textContent = text; el('mapStatus').classList.toggle('locating', locating); }
export function toast(message) { const node = el('toast'); node.textContent = message; node.classList.remove('hidden'); clearTimeout(toast.timeout); toast.timeout = setTimeout(() => node.classList.add('hidden'), 3200); }
export function escapeHtml(text) { return String(text || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char])); }

export function normalizeProfile(raw = {}) {
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
export function sitesForProfile(profile, cityId = state.activeCity) { return profile.sitesDiscovered[cityId] || []; }
export function totalSitesDiscovered(profile) { return Object.values(profile.sitesDiscovered).reduce((total, ids) => total + ids.length, 0); }
export function localObservationCity(observation) { return observation.city || 'vienna'; }
export function calculateWalkAward(walk, profile = state.profile) {
  const miles = (walk.distanceMeters || 0) / 1609.344;
  const today = dayKey();
  const firstWalkToday = profile.lastWalkDate !== today;
  const nextStreak = !firstWalkToday ? profile.streakDays : (profile.lastWalkDate === previousDayKey(today) ? profile.streakDays + 1 : 1);
  const distancePoints = Math.round(miles * POINTS_PER_MILE);
  const streakPoints = firstWalkToday ? STREAK_BONUS_PER_DAY : 0;
  return { miles, date: today, firstWalkToday, nextStreak, distancePoints, streakPoints, total: distancePoints + streakPoints };
}
export function renderPoiTagFilters() {
  const pois = state.cityPois[state.activeCity] || [];
  const availableTags = new Set(pois.flatMap((poi) => poiTags(poi)));
  el('poiTagFilters').innerHTML = POI_TAGS
    .filter(([id]) => availableTags.has(id))
    .map(([id, label]) => `<button type="button" class="poi-chip ${state.poiTags.has(id) ? 'active' : ''}" data-poi-tag="${id}">${label}</button>`)
    .join('');
  updateFiltersBadge();
}
export function updateFiltersBadge() {
  const badge = el('filtersBadge');
  if (!badge) return;
  badge.textContent = state.poiTags.size ? String(state.poiTags.size) : '';
  badge.classList.toggle('hidden', !state.poiTags.size);
}
export function poiMatchesFilters(poi) {
  if (!state.poiTags.size) return true;
  const tags = poiTags(poi);
  return [...state.poiTags].some((tag) => tags.includes(tag));
}
export function renderCityPois() {
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
export function renderHistorySites() {
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
export function renderCityExplorer() {
  el('norfolkAttribution').classList.toggle('hidden', state.activeCity !== 'norfolk');
  el('trailFeatureButton').classList.toggle('hidden', !(state.trailSegments[state.activeCity] || []).length);
  updateFiltersBadge();
}
export function openFiltersSheet() {
  renderPoiTagFilters();
  openSheet('filtersSheet');
}
export function showView(view) {
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
export function initMap() {
  const active = city();
  state.map = L.map('map', { zoomControl: false, attributionControl: true }).setView([active.center.lat, active.center.lng], active.zoom);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors', crossOrigin: true }).addTo(state.map);
  state.historyRadiusLayer = L.layerGroup().addTo(state.map);
  const clusterOptions = (badgeClass) => ({
    chunkedLoading: true, // progressive loading: adds markers in batches off the main thread
    maxClusterRadius: 55,
    disableClusteringAtZoom: 17, // split back into individual pins once zoomed in
    iconCreatefunction: (cluster) => L.divIcon({ className: '', html: `<div class="cluster-badge ${badgeClass}">${cluster.getChildCount()}</div>`, iconSize: [36, 36] })
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
export function renderUserLocation(point, pan = false) {
  state.currentPosition = point;
  const icon = L.divIcon({ className: '', html: '<div class="user-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  if (!state.userMarker) state.userMarker = L.marker([point.lat, point.lng], { icon, zIndexOffset: 1000, title: 'Your location' }).addTo(state.map);
  else state.userMarker.setLatLng([point.lat, point.lng]);
  if (pan) state.map.panTo([point.lat, point.lng]);
}
export function checkGeofences(point) {
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
export function addWalkPoint(point) {
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
export function updateWalkDisplay() {
  const walk = state.activeWalk;
  if (!walk) { el('walkDuration').textContent = '00:00'; el('walkDistance').textContent = '0.00'; el('walkPoints').textContent = '0'; return; }
  const pausedNow = walk.pausedAt ? Date.now() - new Date(walk.pausedAt).getTime() : 0;
  walk.durationSeconds = Math.max(0, Math.floor((Date.now() - new Date(walk.startedAt).getTime() - (walk.pausedMilliseconds || 0) - pausedNow) / 1000));
  el('walkDuration').textContent = formatDuration(walk.durationSeconds);
  el('walkDistance').textContent = formatDistance(walk.distanceMeters);
  el('walkPoints').textContent = calculateWalkAward(walk).total;
}
export function handlePosition(position, shouldPan = false) {
  const point = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
  renderUserLocation(point, shouldPan);
  const weakSignal = !Number.isFinite(point.accuracy) || point.accuracy > MAX_GPS_ACCURACY_METERS;
  if (weakSignal) { setStatus(`GPS signal weak (${Math.round(point.accuracy || 0)} m) - route not updated`); return; }
  setStatus(state.activeWalk ? (state.activeWalk.paused ? 'Walk paused' : 'Recording your walk') : 'Location found', Boolean(state.activeWalk && !state.activeWalk.paused));
  if (state.activeWalk) addWalkPoint(point);
  checkGeofences(point);
}
export function getCurrentLocation() {
  if (!navigator.geolocation) { toast('This browser does not support location. Try the history preview instead.'); return; }
  setStatus('Finding your location...', true);
  navigator.geolocation.getCurrentPosition((position) => handlePosition(position, true), (error) => { setStatus('Location unavailable'); toast(error.code === 1 ? 'Location permission is needed to detect nearby places.' : 'Could not get a location. Check your signal and try again.'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 });
}
export function ensurePauseButton() {
  let button = el('pauseWalkButton');
  if (!button) { button = document.createElement('button'); button.id = 'pauseWalkButton'; button.type = 'button'; button.className = 'secondary-button'; el('walkButton').before(button); button.addEventListener('click', togglePauseWalk); }
  button.classList.remove('hidden'); button.textContent = 'Pause';
}
export function pauseWalk() { const walk = state.activeWalk; if (!walk) return; walk.paused = true; walk.pausedAt = new Date().toISOString(); el('pauseWalkButton').textContent = 'Resume'; setStatus('Walk paused'); updateWalkDisplay(); }
export function resumeWalk() { const walk = state.activeWalk; if (!walk || !walk.paused) return; walk.pausedMilliseconds += Date.now() - new Date(walk.pausedAt).getTime(); walk.paused = false; walk.pausedAt = null; walk.lastRawPoint = null; el('pauseWalkButton').textContent = 'Pause'; setStatus('Recording your walk', true); }
export function togglePauseWalk() { if (state.activeWalk?.paused) resumeWalk(); else pauseWalk(); }
export function startWalk() {
  if (!navigator.geolocation) { toast('Location is not supported in this browser.'); return; }
  state.activeWalk = { id: uid('walk'), city: state.activeCity, startedAt: new Date().toISOString(), endedAt: null, durationSeconds: 0, distanceMeters: 0, points: [], journal: null, paused: false, pausedAt: null, pausedMilliseconds: 0, lastRawPoint: null };
  ensurePauseButton(); state.routeLine?.remove(); state.routeLine = L.polyline([], { color: '#245448', weight: 5, opacity: .85 }).addTo(state.map);
  el('walkButton').textContent = 'End walk'; el('walkButton').classList.add('walking'); setStatus('Recording your walk', true);
  state.timerId = setInterval(updateWalkDisplay, 1000);
  state.watchId = navigator.geolocation.watchPosition((position) => handlePosition(position, state.activeWalk.points.length === 0), () => { setStatus('Location connection paused'); toast('Location connection paused - your current route is still saved.'); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  getCurrentLocation();
}
export function openSheet(id) { state.modalOpen = id; el('modalBackdrop').classList.remove('hidden'); el(id).classList.remove('hidden'); }
export function closeSheets() {
  state.modalOpen = null;
  el('modalBackdrop').classList.add('hidden');
  document.querySelectorAll('.sheet').forEach((sheet) => sheet.classList.add('hidden'));
  if (state.draftMarker) { state.draftMarker.remove(); state.draftMarker = null; }
}
export function showHistory(site, distance) {
  state.currentSite = site; state.prompted.add(`${state.activeCity}:${site.id}`);
  el('historyTitle').textContent = site.name;
  el('historyDescription').textContent = site.description;
  el('historySource').href = site.source || '#';
  el('historySource').classList.toggle('hidden', !site.source);
  el('historyWarning').classList.toggle('hidden', !site.unverified);
  el('historyDistance').textContent = Number.isFinite(distance) ? `${Math.round(distance)} m from your location` : 'Within your walking radius';
  openSheet('historySheet');
}
export function openObservation(location) {
  const loc = location || state.currentPosition || { lat: state.map.getCenter().lat, lng: state.map.getCenter().lng };
  state.draftObservationLocation = loc;
  if (state.draftMarker) state.draftMarker.remove();
  const icon = L.divIcon({ className: '', html: '<div class="wildlife-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  state.draftMarker = L.marker([loc.lat, loc.lng], { icon }).addTo(state.map);
  el('observationLocation').textContent = `Pinned at ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)} in ${cityLabel(state.activeCity)}. Move it by closing this form and tapping a new spot on the map.`;
  el('observationForm').reset(); el('photoName').textContent = 'Optional, stored only on this device';
  openSheet('observationSheet');
}
export function addObservationMarker(observation) {
  const icon = L.divIcon({ className: '', html: '<div class="wildlife-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  const marker = L.marker([observation.location.lat, observation.location.lng], { icon, title: observation.species }).addTo(state.observationLayer);
  marker.bindPopup(`<strong>${escapeHtml(observation.species)}</strong>${observation.note ? `<br><span>${escapeHtml(observation.note)}</span>` : ''}`);
}

export function openJournal(walkId = null) { el('journalForm').reset(); el('journalForm').dataset.walkId = walkId || ''; openSheet('journalSheet'); }
export function momentCard(item) {
  const kind = item.type === 'observation' ? 'observation' : item.type === 'history' ? 'history' : item.type === 'walk' ? 'walk' : 'journal';
  const icons = { observation: '⌁', history: '✦', walk: '↝', journal: '✎' };
  const title = item.species || item.title || 'Walk';
  let detail = item.note || '';
  if (item.type === 'walk') detail = `${formatDistance(item.distanceMeters)} miles · ${formatDuration(item.durationSeconds)} · +${item.pointsAwarded ?? 0} pts`;
  if (!detail) detail = item.type === 'observation' ? 'Nature observation' : 'Journal reflection';
  return `<article class="moment-card ${item.type === 'walk' ? 'walk-card' : ''}" ${item.type === 'walk' ? `data-walk-id="${escapeHtml(item.id)}" role="button" tabindex="0"` : ''}><span class="moment-symbol ${kind === 'history' ? 'history' : kind === 'walk' ? 'walk' : ''}">${icons[kind]}</span><div class="moment-copy"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div><time class="moment-date">${shortDate(item.createdAt || item.startedAt)}</time></article>`;
}
export function setArchiveFilter(filter = 'all') {
  state.archiveFilter = filter;
  document.querySelectorAll('.archive-filter .filter-button').forEach((button) => button.classList.toggle('active', button.dataset.filter === filter));
  renderArchive();
}

export function badge(name, earned, detail) { return `<span class="badge ${earned ? 'earned' : ''}" title="${escapeHtml(detail)}">${earned ? '✓ ' : ''}${escapeHtml(name)}</span>`; }
export function renderGeofenceCategoryChips() {
  const selected = new Set(state.settings.geofenceCategories || GEOFENCE_CATEGORIES.map(([id]) => id));
  const chipsEl = el('geofenceCategoryChips');
  if (chipsEl) {
    chipsEl.innerHTML = GEOFENCE_CATEGORIES.map(([id, label]) => `<button type="button" class="poi-chip ${selected.has(id) ? 'active' : ''}" data-geofence-category="${id}">${label}</button>`).join('');
  }
}
export function renderProfile() {
  const profile = state.profile; const cityDiscoveries = sitesForProfile(profile).length; const totalCitySites = cityDiscoverableSites().length;
  el('profilePoints').textContent = Math.round(profile.totalPoints).toLocaleString();
  el('profileStats').innerHTML = [
    [profile.walksCompleted, 'Walks completed'], [profile.milesTotal.toFixed(1), 'Miles total'],
    [`${cityDiscoveries}/${totalCitySites}`, `${CITIES[state.activeCity].name} sites`], [profile.observationsLogged, 'Observations'], [profile.streakDays, 'Day streak']
  ].map(([value, label]) => `<div class="profile-stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
  el('badgeList').innerHTML = [
    badge('First Steps', profile.walksCompleted >= 1, 'Complete one walk.'),
    badge('Explorer', totalCitySites > 0 && cityDiscoveries >= totalCitySites, `Discover every stop in ${cityLabel(state.activeCity)}.`),
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
export function openProfile() { showView('profile'); }

export function onlineConfig() { return window.WALK_WILDLIFE_SUPABASE || {}; }
export function onlineConfigured() {
  const config = onlineConfig();
  return Boolean(config.url && config.anonKey && window.supabase?.createClient);
}
export function renderLeaderboard() {
  const rows = state.online.leaderboard || [];
  el('leaderboardList').innerHTML = rows.length ? rows.map((person, index) => {
  const isOnline = person.last_seen_at && (Date.now() - new Date(person.last_seen_at).getTime()) < 5 * 60 * 1000;
  const callLink = person.phone ? `<a class="call-link" href="tel:${escapeHtml(person.phone)}" aria-label="Call ${escapeHtml(person.username)}">📞</a>` : '';
  return `<div class="leaderboard-row"><span class="leaderboard-rank">${index + 1}</span><div class="leaderboard-person"><strong>${isOnline ? '🟢 ' : ''}${escapeHtml(person.username)}${person.id === state.online.session?.user.id ? ' (you)' : ''}</strong><span>${Number(person.miles_total || 0).toFixed(1)} miles · ${person.sites_discovered || 0} sites</span></div>${callLink}<span class="leaderboard-points">${person.total_points || 0}</span></div>`;
}).join('') : '<div class="empty-state">Add a friend by username to begin a private leaderboard.</div>';}
export function renderIncomingRequests() {
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
export function openAccountSettings() {
  el('accountUsernameInput').value = state.online.remoteProfile?.username || '';
  el('accountPhoneInput').value = state.online.remoteProfile?.phone || '';
  el('accountEmailInput').value = state.online.session?.user?.email || '';
  el('accountPasswordInput').value = '';
  openSheet('accountSheet');
}
export function initBackupControls() {
  const panel = document.createElement('div'); panel.className = 'backup-controls';
  panel.innerHTML = '<p class="sheet-kicker">YOUR BACKUP</p><p>Download a private copy of this device journal, or restore a backup. Restoring replaces this device\'s current journal.</p><div class="backup-actions"><button class="secondary-button" id="exportDataButton" type="button">Export journal</button><label class="secondary-button import-label">Import journal<input id="importDataInput" type="file" accept="application/json,.json" /></label></div>';
  el('clearDataButton').before(panel);
  el('exportDataButton').addEventListener('click', exportJournal);
  el('importDataInput').addEventListener('change', importJournal);
}
export function initEvents() {
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
