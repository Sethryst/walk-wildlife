import { state } from './state.js';
import { city, poiTags, isWalkablePoi, renderCityPois } from './poi.js';
import { distanceMeters } from './geo.js';
import { el, escapeHtml } from './utils.js';
import { routeOnFoot } from './routing.js';
import { quietPlacesNear } from './quiet-places.js';

const MILES_PER_MINUTE = 0.05;
const originForPlan = () => state.plannerStart || state.currentPosition || { lat: state.map?.getCenter().lat ?? city().center.lat, lng: state.map?.getCenter().lng ?? city().center.lng };
const activePreferences = () => [...document.querySelectorAll('.planner-chip.active')].map((button) => button.dataset.plannerTag).filter(Boolean);
const selectedMinutes = () => Number(document.querySelector('input[name="walkTime"]:checked')?.value || 15);
const selectedRouteMode = () => document.querySelector('input[name="routeMode"]:checked')?.value || 'round-trip';
const bearing = (from, point) => (Math.atan2(point.lng - from.lng, point.lat - from.lat) * 180 / Math.PI + 360) % 360;
const ROUTE_THEMES = { park: 'Green Space', trail: 'Wildlife', history: 'History', quiet: 'Quiet' };

function routeTitle(stops, preferences, index) {
  const selectedTheme = preferences.find((tag) => ROUTE_THEMES[tag]);
  const discoveredTheme = stops.flatMap(poiTags).find((tag) => ROUTE_THEMES[tag]);
  const theme = ROUTE_THEMES[selectedTheme || discoveredTheme] || 'Local Discovery';
  const cityName = city().name;
  return `${cityName} ${theme} Loop${index ? ` ${index + 1}` : ''}`;
}

export function setPlanningMode(active) {
  state.planningMode = active;
  document.body.classList.toggle('planning-mode', active);
  if (!active) state.plannerSelecting = null;
  renderCityPois();
}

function candidateStops(origin, preferences) {
  return [...(state.cityPois[state.activeCity] || []), ...(state.quietFallbackPlaces || [])].filter(isWalkablePoi)
    .filter((poi) => !preferences.length || preferences.includes('quiet') || preferences.some((tag) => poiTags(poi).includes(tag)))
    .map((poi) => ({ poi, distance: distanceMeters(origin, poi), heading: bearing(origin, poi) }))
    .filter(({ distance }) => distance > 80 && distance < 2600)
    .sort((a, b) => a.distance - b.distance);
}

function loopSeeds(origin, preferences) {
  const candidates = candidateStops(origin, preferences);
  // One nearby stop per compass sector produces genuinely different loop shapes.
  return [0, 72, 144, 216, 288].map((heading) => {
    const first = candidates.slice().sort((a, b) => Math.abs((((a.heading - heading) + 540) % 360) - 180) - Math.abs((((b.heading - heading) + 540) % 360) - 180))[0];
    if (!first) return [];
    const second = candidates.filter((item) => item.poi.id !== first.poi.id).sort((a, b) => Math.abs((((a.heading - (first.heading + 70)) + 540) % 360) - 180) - Math.abs((((b.heading - (first.heading + 70)) + 540) % 360) - 180))[0];
    return [first.poi, second?.poi].filter(Boolean);
  }).filter((stops, index, all) => stops.length && all.findIndex((other) => other[0].id === stops[0].id) === index);
}
function sparseAreaLoopSeeds(origin, minutes) {
  // POI availability must never determine whether a person can take a walk.
  // These are route waypoints only; they deliberately create no fake stops.
  const radiusMeters = Math.max(140, Math.min(700, (minutes * MILES_PER_MINUTE * 1609.344) / 4));
  const pointAt = (degrees) => {
    const radians = degrees * Math.PI / 180;
    return { lat: origin.lat + (Math.cos(radians) * radiusMeters) / 111320, lng: origin.lng + (Math.sin(radians) * radiusMeters) / (111320 * Math.cos(origin.lat * Math.PI / 180)) };
  };
  return [0, 120, 240].map((heading) => ({ stops: [], via: [pointAt(heading), pointAt(heading + 90)] }));
}

function interestScore(stops, preferences) {
  const tags = stops.flatMap(poiTags);
  return (preferences.length ? preferences.filter((tag) => tags.includes(tag)).length * 3 : 0) + new Set(tags).size + stops.filter((p) => poiTags(p).includes('history')).length * 2 + stops.reduce((score, stop) => score + (Number(stop.walkRelevanceScore) || 0), 0);
}

export async function generateTimeBasedPlan() {
  state.plannedRoute = null; state.planOptions = [];
  el('planDistance').textContent = 'Finding routes…';
  el('planSummary').textContent = 'Looking for walkable options that fit your choices.';
  el('planStops').innerHTML = '';
  el('planOptions').innerHTML = '<p class="empty-state">Finding walkable routes…</p>';
  const minutes = selectedMinutes(); const preferences = activePreferences(); const routeMode = selectedRouteMode(); const origin = originForPlan();
  // Vienna and newly added regions can have very little curated data at first.
  // Quiet OSM places are a private, cached planning fallback—not map clutter.
  if (candidateStops(origin, preferences).length < 6) state.quietFallbackPlaces = await quietPlacesNear(state.activeCity, origin);
  const poiSeeds = loopSeeds(origin, preferences);
  const seeds = routeMode === 'round-trip'
    ? (poiSeeds.length ? poiSeeds.map((stops) => ({ stops, via: stops })) : sparseAreaLoopSeeds(origin, minutes))
    : [{ stops: state.plannerEnd ? [state.plannerEnd] : (poiSeeds[0] || []), via: state.plannerEnd ? [state.plannerEnd] : (poiSeeds[0] || []) }];
  const results = await Promise.all(seeds.map(async (seed, index) => {
    const points = routeMode === 'round-trip' ? [origin, ...seed.via, origin] : [origin, ...seed.via];
    const routed = await routeOnFoot(points).catch(() => null);
    if (!routed) return null;
    const miles = routed.distanceMeters / 1609.344;
    const timeFit = Math.max(0, 10 - Math.abs(minutes - routed.durationSeconds / 60) / 3);
    return { id: `plan-${Date.now()}-${index}`, title: routeMode === 'round-trip' ? routeTitle(seed.stops, preferences, index) : `${city().name} point-to-point walk`, city: state.activeCity, estimatedDurationMinutes: Math.round(routed.durationSeconds / 60), distanceMiles: Number(miles.toFixed(2)), routeMode, preferences, stops: seed.stops, coordinates: routed.coordinates, source: 'pedestrian-road-route', score: timeFit + interestScore(seed.stops, preferences) - miles * .15 };
  }));
  state.planOptions = results.filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 5);
  // A round trip has meaningful alternatives. Never silently choose one and
  // move the map; people must explicitly pick the shape they want.
  state.plannedRoute = state.planOptions.length === 1 ? state.planOptions[0] : null;
  renderPlanPreview();
  return state.plannedRoute;
}

export function choosePlan(id) { state.plannedRoute = state.planOptions.find((plan) => plan.id === id) || state.plannedRoute; renderPlanPreview(); previewTimeBasedPlan(); }
export function changePlan() { state.plannedRoute = null; renderPlanPreview(); }

export function renderPlanPreview() {
  const plan = state.plannedRoute;
  el('planOptions').innerHTML = plan
    ? `<button class="text-button" type="button" data-change-plan>Choose a different route</button>`
    : state.planOptions.length ? state.planOptions.map((option, index) => `<button class="route-option" type="button" data-plan-option="${option.id}"><span><strong>${escapeHtml(option.title)}${state.planOptions.length > 1 ? ` · option ${index + 1}` : ''}</strong><small>${option.estimatedDurationMinutes} min · ${option.distanceMiles} mi${option.stops.length ? ` · ${option.stops.length} discoveries` : ''}</small></span><b>${option.routeMode === 'round-trip' ? 'Loop ↻' : 'Route →'}</b></button>`).join('') : '<p class="empty-state">No walkable loop could be calculated here. Try a different start point or a shorter time.</p>';
  if (!plan) { el('planDistance').textContent = state.planOptions.length ? 'Choose a route' : 'No route yet'; el('planSummary').textContent = state.planOptions.length ? 'Pick one of the routes below to preview it on the map.' : 'Adjust the time, route shape, or starting point and try again.'; el('planStops').innerHTML = ''; return; }
  el('planDistance').textContent = `${plan.distanceMiles} miles`;
  const discoveries = plan.stops.slice(0, 2).map((stop) => stop.name).join(' and ');
  el('planSummary').textContent = discoveries
    ? `${plan.estimatedDurationMinutes}-minute ${plan.routeMode === 'round-trip' ? 'loop back to your start' : 'walk'} with ${discoveries}.`
    : `${plan.estimatedDurationMinutes}-minute ${plan.routeMode === 'round-trip' ? 'loop back to your start' : 'walk'} ranked for time and distance.`;
  el('planStops').innerHTML = plan.stops.map((stop, index) => `<li><span>${index + 1}</span><strong>${escapeHtml(stop.name)}</strong><small>${escapeHtml(stop.sourceType === 'osm-quiet-fallback' ? 'quiet place · OpenStreetMap' : poiTags(stop).find((tag) => !tag.startsWith('history_')) || 'place')}</small></li>`).join('');
}

export function previewTimeBasedPlan() {
  const plan = state.plannedRoute;
  if (!state.map || !plan?.coordinates?.length) return null;
  state.plannedRouteLine?.remove();
  state.plannedRouteLine = L.polyline(plan.coordinates, { color: '#b8860b', weight: 5, opacity: .88, dashArray: '8 6' }).addTo(state.map);
  const bounds = state.plannedRouteLine.getBounds(); if (bounds.isValid()) state.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
  return plan;
}
