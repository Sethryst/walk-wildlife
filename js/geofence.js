import { distanceMeters } from './geo.js';
import { state } from './state.js';
import { GEOFENCE_CATEGORIES } from './constants.js';
import { isWalkablePoi, poiTags, showHistory } from './poi.js';

export function checkGeofences(point) {
  const settings = state.settings || {};
  if (settings.enableGeofencing === false) return;
  const enabledCategories = new Set(settings.geofenceCategories || GEOFENCE_CATEGORIES.map(([id]) => id));
  const defaultRadius = settings.defaultGeofenceRadiusMeters || 50;
  const pois = state.cityPois[state.activeCity] || [];
  const nearby = pois.find((poi) => {
    if (!isWalkablePoi(poi)) return false;
    const tags = poiTags(poi);
    if (!tags.some((tag) => enabledCategories.has(tag))) return false;
    if (state.prompted.has(`${state.activeCity}:${poi.id}`)) return false;
    const effectiveRadius = poi.radius || defaultRadius;
    return distanceMeters(point, poi) <= effectiveRadius;
  });
  if (nearby && !state.modalOpen) showHistory(nearby, distanceMeters(point, nearby));
}
