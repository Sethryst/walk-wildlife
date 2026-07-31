/* Walk & Wildlife Journal — local-first walking, history, and nature journal. */

// Scoring is local, transparent, and never based on GPS-ping count.
import db from './js/storage.js';

import { 
  POINTS_PER_MILE,
  POINTS_PER_NEW_HISTORY_SITE,
  POINTS_PER_OBSERVATION,
  STREAK_BONUS_PER_DAY,
  MAX_GPS_ACCURACY_METERS,
  MAX_WALK_SPEED_MPS,
  CITIES,
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS
} from './js/constants.js';

import {
  city,
  cityLabel,
  migratePoi,
  normalizeProfile,
  sitesForProfile,
  totalSitesDiscovered,
  localObservationCity,
  uid
} from './js/utils.js';
import {
  loadCityData,
  loadAllCityData,
  createMigratedProfile,
  loadLocalState,
  updateProfile,
  refreshCityMap,
  switchCity,
  stopWalk,
  saveHistoryMoment,
  saveObservation,
  saveJournal,
  renderArchive, 
  exportJournal,
  importJournal,
  openWalkDetail,
  init
} from './js/data.js';

import {
  setupOnline,
  loadRemoteProfile,
  syncProfile,
  openOnline,
  renderOnline,
  signIn,
  signUp,
  createOnlineProfile,
  updateAccountUsername,
  updateAccountPhone,
  updateAccountEmail,
  updateAccountPassword,
  acceptFriend
} from './js/online.js';

init();