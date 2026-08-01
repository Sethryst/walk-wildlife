import { state } from './state.js';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, GEOFENCE_CATEGORIES } from './constants.js';
import { el, normalizeProfile } from './utils.js';
import { initBackupControls } from './backup.js';
import { openWalkDetail, saveHistoryMoment, saveJournal, renderArchive } from './archive.js';
import { getCurrentLocation, startWalk, stopWalk } from './walk.js';
import { openObservation, saveObservation } from './observation.js';
import { openJournal, closeSheets, openSheet, openAccountSettings, openFiltersSheet, openProfile, renderGeofenceCategoryChips, setArchiveFilter, showView, toast } from './ui.js';
import { city, citySites, renderPoiTagFilters, renderCityPois, showHistory } from './poi.js';
import { syncProfile, renderOnline, openOnline, signIn, signUp, createOnlineProfile, updateAccountUsername, updateAccountPhone, updateAccountEmail, updateAccountPassword, acceptFriend, refreshFriends, findFriend } from './online.js';
import { refreshCityMap, switchCity } from './city.js';
import { renderProfile } from './profile.js';
import db from './storage.js';

export function initEvents() {
  initBackupControls();
  el('archiveList').addEventListener('click', (event) => { const card = event.target.closest('[data-walk-id]'); if (card) openWalkDetail(card.dataset.walkId); });
  el('archiveList').addEventListener('keydown', (event) => { const card = event.target.closest('[data-walk-id]'); if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openWalkDetail(card.dataset.walkId); } });
  el('locateButton').addEventListener('click', getCurrentLocation);
  el('walkButton').addEventListener('click', () => state.activeWalk ? stopWalk() : startWalk());
  el('addObservationButton').addEventListener('click', () => openObservation());
  el('journalButton').addEventListener('click', () => openJournal());
  el('demoButton').addEventListener('click', () => { const site = citySites()[0]; state.map.flyTo([site.lat, site.lng], Math.max(city().zoom + 2, 16)); setTimeout(() => showHistory(site, 28), 350); });
  el('settingsButton').addEventListener('click', () => openSheet('infoSheet'));
  el('profileJournalButton').addEventListener('click', () => openJournal());
  el('filtersButton').addEventListener('click', openFiltersSheet);
  el('dismissHistoryButton').addEventListener('click', closeSheets); el('saveHistoryMomentButton').addEventListener('click', saveHistoryMoment);
  el('observationForm').addEventListener('submit', saveObservation); el('journalForm').addEventListener('submit', saveJournal);
  el('photoInput').addEventListener('change', (event) => { el('photoName').textContent = event.target.files[0]?.name || 'Optional, stored only on this device'; });
  document.querySelectorAll('[data-close-sheet]').forEach((button) => button.addEventListener('click', closeSheets));
  el('modalBackdrop').addEventListener('click', closeSheets);
  document.querySelectorAll('.archive-filter .filter-button').forEach((button) => button.addEventListener('click', () => setArchiveFilter(button.dataset.filter)));
  el('citySelect').addEventListener('change', (event) => switchCity(event.target.value));
  el('goOnlineButton').addEventListener('click', openOnline);
  el('signInButton').addEventListener('click', signIn);
el('signUpButton').addEventListener('click', signUp);
el('usernameForm').addEventListener('submit', createOnlineProfile);
  el('syncNowButton').addEventListener('click', async () => { try { await syncProfile(); await renderOnline(); toast('Aggregate stats synced.'); } catch (error) { toast(error.message || 'Could not sync right now.'); } });
  el('refreshFriendsButton').addEventListener('click', refreshFriends); el('friendSearchForm').addEventListener('submit', findFriend);
el('accountSettingsButton').addEventListener('click', openAccountSettings);
el('accountUsernameForm').addEventListener('submit', updateAccountUsername);
el('accountPhoneForm').addEventListener('submit', updateAccountPhone);
el('accountEmailForm').addEventListener('submit', updateAccountEmail);
el('accountPasswordForm').addEventListener('submit', updateAccountPassword);
  el('incomingRequestsList').addEventListener('click', (event) => { const button = event.target.closest('[data-accept-id]'); if (button) acceptFriend(button.dataset.acceptId); });
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
    closeSheets();
    if (button.dataset.view === 'profile') openProfile();
    else showView('map');
  }));
  el('clearDataButton').addEventListener('click', async () => {
    if (!confirm("Clear every locally saved walk, reflection, observation, and profile score on this device? This can't be undone.")) return;
    await db.clearAll();
    state.profile = normalizeProfile(DEFAULT_PROFILE); state.settings = { ...DEFAULT_SETTINGS }; state.activeCity = 'vienna';
    await Promise.all([db.put('profile', state.profile), db.put('settings', state.settings)]);
    closeSheets(); await refreshCityMap(true); renderArchive(); toast('Local journal data and points cleared.');
  });
  el('poiTagFilters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-poi-tag]'); if (!button) return;
    const id = button.dataset.poiTag;
    state.poiTags.has(id) ? state.poiTags.delete(id) : state.poiTags.add(id);
    renderPoiTagFilters();
  });
  el('clearPoiFiltersButton').addEventListener('click', () => { state.poiTags.clear(); renderPoiTagFilters(); renderCityPois(); });
  el('applyFiltersButton').addEventListener('click', () => { renderCityPois(); closeSheets(); });
  el('trailFeatureButton').addEventListener('click', () => {
    const bounds = state.trailLayer.getBounds();
    if (bounds.isValid()) state.map.fitBounds(bounds, { padding: [28, 28] });
  });
  if (el('geofenceToggle')) {
    el('geofenceToggle').addEventListener('change', async (event) => {
      state.settings.enableGeofencing = event.target.checked;
      await db.put('settings', state.settings);
      renderProfile();
    });
  }
  if (el('geofenceRadiusSelect')) {
    el('geofenceRadiusSelect').addEventListener('change', async (event) => {
      state.settings.defaultGeofenceRadiusMeters = Number(event.target.value) || 50;
      await db.put('settings', state.settings);
    });
  }
  if (el('geofenceCategoryChips')) {
    el('geofenceCategoryChips').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-geofence-category]'); if (!button) return;
      const id = button.dataset.geofenceCategory;
      const categories = new Set(state.settings.geofenceCategories || GEOFENCE_CATEGORIES.map(([c]) => c));
      categories.has(id) ? categories.delete(id) : categories.add(id);
      state.settings.geofenceCategories = [...categories];
      await db.put('settings', state.settings);
      renderGeofenceCategoryChips();
    });
  }
}