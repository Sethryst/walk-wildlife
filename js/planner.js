import { state } from './state.js';
import { city, poiTags, isWalkablePoi } from './poi.js';
import { distanceMeters } from './geo.js';
import { routesForCity } from './routes.js';
import { el, escapeHtml } from './utils.js';
import { routeOnFoot } from './routing.js';

const MILES_PER_MINUTE = 0.05; // Approx. 3 mph walking pace.

function activePreferences() {
  return [...document.querySelectorAll('.planner-chip.active')].map((button) => button.dataset.plannerTag).filter(Boolean);
}

function selectedMinutes() {
  return Number(document.querySelector('input[name="walkTime"]:checked')?.value || 15);
}

function selectedRouteMode() {
  return document.querySelector('input[name="routeMode"]:checked')?.value || 'round-trip';
}

function routeDistanceToPoint(point, coordinates) {
  return Math.min(...coordinates.map(([lat, lng]) => distanceMeters(point, { lat, lng })));
}

function matchingStops(coordinates, preferences) {
  const pois = state.cityPois[state.activeCity] || [];
  const origin = state.currentPosition || { lat: state.map?.getCenter().lat ?? city().center.lat, lng: state.map?.getCenter().lng ?? city().center.lng };
  const filtered = pois.filter(isWalkablePoi).filter((poi) => !preferences.length || preferences.includes('quiet') || preferences.some((tag) => poiTags(poi).includes(tag)));
  return filtered
    .map((poi) => ({ poi, distance: coordinates.length ? routeDistanceToPoint(poi, coordinates) : distanceMeters(origin, poi) }))
    .sort((a, b) => a.distance - b.distance)
    .filter(({ distance }) => distance < 1800)
    .slice(0, 3).map(({ poi }) => poi);
}

function localRouteCoordinates(stops, mode) {
  const origin = state.currentPosition || { lat: state.map?.getCenter().lat ?? city().center.lat, lng: state.map?.getCenter().lng ?? city().center.lng };
  const coordinates = [[origin.lat, origin.lng], ...stops.map((stop) => [stop.lat, stop.lng])];
  return mode === 'round-trip' ? [...coordinates, [origin.lat, origin.lng]] : coordinates;
}

export async function generateTimeBasedPlan() {
  const minutes = selectedMinutes();
  const targetMiles = Number((minutes * MILES_PER_MINUTE).toFixed(2));
  const preferences = activePreferences();
  const routeMode = selectedRouteMode();
  const corridor = routesForCity().sort((a, b) => Math.abs(a.durationMinutes - minutes) - Math.abs(b.durationMinutes - minutes))[0];
  let coordinates = [];
  let title = 'Local discovery loop';
  let usingCorridor = false;

  if (corridor && minutes >= 30 && corridor.durationMinutes >= minutes * .8) {
    const portion = Math.max(2, Math.ceil(corridor.coordinates.length * Math.min(1, minutes / corridor.durationMinutes)));
    coordinates = corridor.coordinates.slice(0, portion);
    if (routeMode === 'round-trip') coordinates = [...coordinates, ...coordinates.slice(0, -1).reverse()];
    title = `${corridor.title} segment`;
    usingCorridor = true;
  }

  let stops = matchingStops(coordinates, preferences);
  const origin = state.plannerStart || state.currentPosition || { lat: state.map?.getCenter().lat ?? city().center.lat, lng: state.map?.getCenter().lng ?? city().center.lng };
  const destination = state.plannerEnd || stops[0];
  const routePoints = routeMode === 'point-to-point'
    ? (destination ? [origin, destination] : [])
    : (stops.length ? [origin, ...stops.slice(0, 2), origin] : []);
  const routed = await routeOnFoot(routePoints).catch(() => null);
  coordinates = routed?.coordinates || [];
  state.plannedRoute = { id: `plan-${Date.now()}`, title, city: state.activeCity, estimatedDurationMinutes: minutes, distanceMiles: routed ? Number((routed.distanceMeters / 1609.344).toFixed(2)) : targetMiles, routeMode, preferences, stops, coordinates, source: routed ? 'pedestrian-road-route' : 'route-unavailable' };
  renderPlanPreview();
  return state.plannedRoute;
}

export function renderPlanPreview() {
  const plan = state.plannedRoute;
  if (!plan) return;
  el('planDistance').textContent = `~${plan.distanceMiles} miles`;
  const shape = plan.routeMode === 'round-trip' ? 'round trip' : 'point-to-point walk';
  el('planSummary').textContent = plan.source === 'curated-corridor-segment'
    ? `${plan.title} as a ${shape}, with nearby places to pause.`
    : plan.source === 'route-unavailable' ? 'Choose a start and end on the map, then try again. No straight-line route will be shown.' : `A ${plan.estimatedDurationMinutes}-minute ${shape} on walkable roads and paths.`;
  el('planStops').innerHTML = plan.stops.length
    ? plan.stops.map((stop, index) => `<li><span>${index + 1}</span><strong>${escapeHtml(stop.name)}</strong><small>${escapeHtml(poiTags(stop).filter((tag) => !tag.startsWith('history_'))[0] || 'place')}</small></li>`).join('')
    : '<li class="no-plan-stops">No matching POIs are close enough yet—this plan will start from your current map area.</li>';
}

export function previewTimeBasedPlan() {
  const plan = state.plannedRoute || generateTimeBasedPlan();
  if (!state.map || !plan) return null;
  if (plan.coordinates.length < 2) return null;
  state.plannedRouteLine?.remove();
  state.plannedRouteLine = L.polyline(plan.coordinates, { color: '#b8860b', weight: 5, opacity: .88, dashArray: '8 6' }).addTo(state.map);
  const bounds = state.plannedRouteLine.getBounds();
  if (bounds.isValid()) state.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
  return plan;
}
