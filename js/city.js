import db from './storage.js';
import { state } from './state.js';
import { CITIES } from './constants.js';
import { el, cityLabel, localObservationCity } from './utils.js';
import { renderCityExplorer, renderCityPois, migratePoi, city as cityLookup } from './poi.js';
import { renderProfile } from './profile.js';
import { setStatus, toast } from './ui.js';
import { addObservationMarker } from './observation.js';

export async function loadCityData(cityId) {
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
export async function loadAllCityData() {
  await Promise.all(Object.keys(CITIES).map((cityId) => loadCityData(cityId).catch((error) => console.error(error))));
}
export async function refreshCityMap(recenter = false) {
  const active = cityLookup();
  state.observationLayer.clearLayers(); state.prompted.clear();
  const observations = await db.all('observations');
  observations.filter((observation) => localObservationCity(observation) === state.activeCity).forEach(addObservationMarker);
  if (recenter) state.map.setView([active.center.lat, active.center.lng], active.zoom);
  el('activeCityLabel').textContent = cityLabel(state.activeCity);
  el('map').setAttribute('aria-label', `Map of ${cityLabel(state.activeCity)} historical places`);
  renderCityExplorer(); renderCityPois();
  renderProfile();
}
export async function switchCity(nextCity, recenter = true) {
  if (!CITIES[nextCity]) return;
  if (state.activeWalk) { el('citySelect').value = state.activeCity; toast('Finish the current walk before switching cities.'); return; }
  state.activeCity = nextCity; state.settings.activeCity = nextCity;
  state.curatedRouteLine?.remove(); state.curatedRouteLine = null;
  state.plannedRouteLine?.remove(); state.plannedRouteLine = null; state.plannedRoute = null;
  state.poiTags.clear();
  await db.put('settings', state.settings);
  await refreshCityMap(recenter);
  setStatus(`${cityLabel(nextCity)} ready for a walk`);
  toast(`Now exploring ${cityLabel(nextCity)}.`);
}
