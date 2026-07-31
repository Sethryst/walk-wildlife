                  export const POINTS_PER_MILE = 10;
                  export const POINTS_PER_NEW_HISTORY_SITE = 25;
                  export const POINTS_PER_OBSERVATION = 15;
                  export const STREAK_BONUS_PER_DAY = 5;
                  export const MAX_GPS_ACCURACY_METERS = 50;
                  export const MAX_WALK_SPEED_MPS = 15;

                  export const CITIES = {
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
                  export const DEFAULT_PROFILE = {
  id: 'local-user', totalPoints: 0, walksCompleted: 0, milesTotal: 0,
  sitesDiscovered: {}, observationsLogged: 0, streakDays: 0, lastWalkDate: null
};
                  export const GEOFENCE_CATEGORIES = [
  ['library', '📚 Libraries'], ['park', '🌳 Parks'], ['public_art', '🎨 Public Art'],
  ['recreation_center', '🏢 Recreation Centers'], ['water_access', '🌊 Water Access'],
  ['community_garden', '🌱 Community Gardens'], ['history', '✦ History Sites'],
  ['wifi', '📶 Free Wi-Fi']
];
                  export const DEFAULT_SETTINGS = {
  id: 'app-settings', activeCity: 'vienna', lastSyncedAt: null,
  enableGeofencing: true, geofenceCategories: ['library', 'park', 'public_art', 'recreation_center', 'water_access', 'history', 'community_garden', 'wifi'], defaultGeofenceRadiusMeters: 50
};

                  export const state = {
  map: null, userMarker: null, routeLine: null, draftMarker: null, currentPosition: null,
  activeWalk: null, watchId: null, timerId: null, prompted: new Set(), currentSite: null,
  draftObservationLocation: null, archiveFilter: 'all', activeView: 'map', modalOpen: null, activeCity: 'vienna',
  profile: { ...DEFAULT_PROFILE }, settings: { ...DEFAULT_SETTINGS }, historyLayer: null, observationLayer: null, poiLayer: null, trailLayer: null,
  cityPois: {}, trailSegments: {}, poiTags: new Set(),
  online: { client: null, session: null, remoteProfile: null, candidate: null, leaderboard: [], incoming: [] }
};

                  export const el = (id) => document.getElementById(id);


                  export const POI_TAGS = [
  ['park', '🌳 Parks'], ['public_art', '🎨 Public Art'], ['recreation_center', '🏢 Recreation Centers'],
  ['water_access', '🌊 Water Access'], ['trail', '🥾 Trails'], ['library', '📚 Libraries'],
  ['community_garden', '🌱 Community Gardens'], ['history', '🏛 History Sites'],
  ['history_landmark', '🏛 Landmarks'], ['history_monument', '🗿 Monuments'], ['history_museum', '🖼 Museums'],
  ['history_cemetery', '🪦 Cemeteries'], ['history_marker', '📜 Historical Markers'],
  ['wifi', '📶 Free Wi-Fi'], ['basketball', 'Basketball'], ['tennis', 'Tennis'],
  ['playground', 'Playground'], ['dog_park', 'Dog park'], ['splash_pad', 'Splash pad'],
  ['disc_golf', 'Disc golf'], ['skate_park', 'Skate park'], ['restrooms', 'Restrooms']
];
                  export const TAG_LABELS = Object.fromEntries(POI_TAGS);
                  export const POI_TAG_PRIORITY = ['history', 'park', 'public_art', 'recreation_center', 'water_access', 'trail', 'library', 'community_garden', 'wifi'];
                  export const POI_ICONS = { park: '🌳', public_art: '🎨', recreation_center: '🏢', water_access: '🌊', trail: '🥾', library: '📚', community_garden: '🌱', history: '🏛', wifi: '📶' };
// History sites are split into subtypes so the filter sheet isn't one catch-all
// "History" bucket — each gets its own chip and its own pin glyph.
                export const HISTORY_SUBTYPES = {
  landmark: { label: 'Landmarks', icon: '🏛' },
  monument: { label: 'Monuments', icon: '🗿' },
  museum: { label: 'Museums', icon: '🖼' },
  cemetery: { label: 'Cemeteries', icon: '🪦' },
  marker: { label: 'Historical Markers', icon: '📜' } // default/fallback subtype
};