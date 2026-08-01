import { state } from './state.js';
import { CITIES, GEOFENCE_CATEGORIES, HISTORY_SUBTYPES, POI_ICONS, POI_TAGS, POI_TAG_PRIORITY, TAG_LABELS } from './constants.js';
import { el, escapeHtml } from './utils.js';
import { distanceMeters } from './geo.js';
import { openSheet } from './ui.js';

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
