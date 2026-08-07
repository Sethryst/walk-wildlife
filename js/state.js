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
  currentPosition: null,
  curatedRouteLine: null,
  plannedRouteLine: null,
  plannedRoute: null,
  observationLayer: null,
  poiLayer: null,
  fieldEditionEntryLayer: null,
  fieldEditionMap: null,
  fieldEditionProtocol: null,

  // walking session
  activeWalk: null,
  watchId: null,
  timerId: null,

  // UI / prompts
  currentSite: null,
  draftObservationLocation: null,
  draftObservationIcon: 'camera',
  prompted: new Set(),
  poiTags: new Set(),
  archiveFilter: 'all',
  planningMode: false,
  plannerStart: null,
  plannerEnd: null,
  planOptions: [],
  quietFallbackPlaces: [],

  // online
  online: {
    client: null,
    session: null,
    remoteProfile: null
  },

  // region automation
  regionAutomation: null,

  // extra maps
  walkDetailMap: null
};
