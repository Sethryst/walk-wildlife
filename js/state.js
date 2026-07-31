export const state = {
  // persisted data
  profile: null,
  settings: null,
  walks: [],
  observations: [],
  moments: [],

  // city / map data
  activeCity: 'vienna',
  cityPois: {},
  trailSegments: {},
  pois: [],

  // map objects
  map: null,
  observationLayer: null,
  poiLayer: null,

  // walking session
  activeWalk: null,
  watchId: null,
  timerId: null,

  // UI / prompts
  currentSite: null,
  draftObservationLocation: null,
  prompted: new Set(),
  poiTags: new Set(),
  archiveFilter: 'all',

  // online
  online: {
    client: null,
    session: null,
    remoteProfile: null
  },

  // extra maps
  walkDetailMap: null
};