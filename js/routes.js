import { state } from './state.js';
import { escapeHtml } from './utils.js';

// Route geometry is rendered only after it is packaged from an authoritative
// GIS source. The prior hand-generalized lines remain listed for research, but
// are deliberately blocked from map rendering and time-based planning.
export const CURATED_ROUTES = [
  {
    id: 'nyc-manhattan-waterfront', city: 'newyork', title: 'Manhattan Waterfront Greenway',
    distanceMiles: 11.8, durationMinutes: 235, difficulty: 'Moderate',
    description: 'A long Hudson-side city walk from Battery Park through the west-side waterfront to Inwood.',
    sourceName: 'NYC DOT Greenways', sourceUrl: 'https://www.nyc.gov/html/dot/html/bicyclists/greenways.shtml',
    geometryStatus: 'needs_official_geometry', coordinates: []
  },
  {
    id: 'nyc-jamaica-bay', city: 'newyork', title: 'Jamaica Bay Greenway Explorer',
    distanceMiles: 13.6, durationMinutes: 275, difficulty: 'Challenging',
    description: 'A long waterfront discovery route linking Jamaica Bay parkland, Canarsie Pier, and shoreline paths.',
    sourceName: 'NYC DOT Greenways', sourceUrl: 'https://www.nyc.gov/html/dot/html/bicyclists/greenways.shtml',
    geometryStatus: 'needs_official_geometry', coordinates: []
  },
  {
    id: 'dc-anacostia-riverwalk', city: 'dc', title: 'Anacostia Riverwalk Long Trail',
    distanceMiles: 10.9, durationMinutes: 220, difficulty: 'Moderate',
    description: 'A long river corridor from the Tidal Basin and Navy Yard toward Anacostia Park and Kenilworth.',
    sourceName: 'DDOT Anacostia Riverwalk Trail', sourceUrl: 'https://ddot.dc.gov/page/anacostia-riverwalk-trail',
    geometryStatus: 'needs_official_geometry', coordinates: []
  },
  {
    id: 'dc-riverwalk-district-loop', city: 'dc', title: 'Riverwalk & Capitol Loop',
    distanceMiles: 7.2, durationMinutes: 145, difficulty: 'Moderate',
    description: 'A long downtown loop combining the Anacostia waterfront, Yards Park, Capitol views, and the Mall edge.',
    sourceName: 'DDOT Anacostia Riverwalk Trail', sourceUrl: 'https://ddot.dc.gov/page/anacostia-riverwalk-trail',
    geometryStatus: 'needs_official_geometry', coordinates: []
  },
  {
    id: 'dc-anacostia-riverwalk-south-capitol-section', city: 'dc', title: 'Anacostia Riverwalk: South Capitol section',
    distanceMiles: 0.6, durationMinutes: 12, difficulty: 'Easy', category: 'waterfront',
    description: 'A verified short section of the Anacostia Riverwalk Trail; suitable as a building block, not a claimed full-trail route.',
    sourceName: 'DDOT Bike Trails (DC) GIS', sourceUrl: 'https://services.arcgis.com/neT9SoYxizqTHZPH/ArcGIS/rest/services/MBT_Map_Draft_WFL1/FeatureServer/15',
    geometryStatus: 'validated', geometryProvenance: { type: 'official-gis', featureName: 'Anacostia Riverwalk Trail', retrievedAt: '2026-08-04' },
    coordinates: [[38.872796,-76.998926],[38.872876,-76.999603],[38.872954,-77.000479],[38.873207,-77.000620],[38.873213,-77.001241],[38.873049,-77.001451],[38.873047,-77.002214],[38.873045,-77.002329],[38.872778,-77.002402],[38.872728,-77.002631],[38.872543,-77.003514],[38.872530,-77.003592],[38.872083,-77.004660],[38.871542,-77.005992],[38.871191,-77.006015],[38.870837,-77.006521],[38.870521,-77.006779],[38.870180,-77.007043]],
    sections: [{ id: 'south-capitol', name: 'South Capitol to Navy Yard', durationMinutes: 12, completionReward: 10 }]
  }
];

export function validateRoute(route) {
  const points = route.coordinates || [];
  const validCoordinates = points.length >= 2 && points.every(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180);
  const valid = route.geometryStatus === 'validated' && route.geometryProvenance?.type === 'official-gis' && Boolean(route.sourceUrl) && validCoordinates;
  return { valid, reason: valid ? null : 'Official GIS geometry has not been packaged yet.' };
}

export function routesForCity(cityId = state.activeCity) {
  return CURATED_ROUTES.filter((route) => route.city === cityId && validateRoute(route).valid);
}
export function routeById(routeId) { return CURATED_ROUTES.find((route) => route.id === routeId) || null; }

export function renderCuratedRoutes() {
  const container = document.getElementById('curatedRoutesList');
  if (!container) return;
  const routes = CURATED_ROUTES.filter((route) => route.city === state.activeCity);
  container.innerHTML = routes.length ? routes.map((route) => { const audit = validateRoute(route); return `<article class="route-card ${audit.valid ? '' : 'route-card-pending'}"><div class="route-preview route-preview-${route.city}">↝</div><div><strong>${escapeHtml(route.title)}</strong><p>${route.distanceMiles} mi · about ${Math.round(route.durationMinutes / 60)} hr ${route.durationMinutes % 60 ? `${route.durationMinutes % 60} min` : ''}</p><span class="difficulty ${route.difficulty.toLowerCase()}">${escapeHtml(route.difficulty)}</span>${audit.valid ? '' : '<small class="route-audit-note">Official geometry review pending</small>'}</div>${audit.valid ? `<button class="primary-button" type="button" data-curated-route="${route.id}">View route</button>` : '<a class="text-button" href="' + escapeHtml(route.sourceUrl) + '" target="_blank" rel="noreferrer">Source</a>'}</article>`; }).join('') : '<div class="empty-state">Curated walks are being added for this city. Explore local places on the map in the meantime.</div>';
}

export function showCuratedRoute(routeId) {
  const route = CURATED_ROUTES.find((item) => item.id === routeId);
  if (!route || !validateRoute(route).valid || !state.map) return null;
  state.curatedRouteLine?.remove();
  state.curatedRouteLine = L.polyline(route.coordinates, { color: '#1b8b7e', weight: 6, opacity: .9, dashArray: '10 7' }).addTo(state.map);
  state.map.fitBounds(state.curatedRouteLine.getBounds(), { padding: [28, 28], maxZoom: 14 });
  return route;
}
