import {
  toast,
  normalizeProfile,
  city,
  cityLabel,
  el,
  migratePoi,
  sitesForProfile,
  totalSitesDiscovered,
  localObservationCity,
  uid,
  initMap,
  addObservationMarker,
  renderCityExplorer,
  renderCityPois,
  setStatus,
  calculateWalkAward,
  closeSheets,
  momentCard,
  shortDate,
  formatDistance,
  formatDuration,
  openSheet,
  escapeHtml,
  dayKey,
  getCurrentLocation,
  renderProfile,
  openFiltersSheet,
  onlineConfigured,
  onlineConfig,
  openAccountSettings
} from './utils.js';

import {
  POINTS_PER_MILE,
  POINTS_PER_NEW_HISTORY_SITE,
  POINTS_PER_OBSERVATION,
  DEFAULT_SETTINGS,
  CITIES
} from './constants.js';

import db from './storage.js';
import { state } from './state.js';
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
export async function createMigratedProfile() {
  const [walks, observations, moments] = await Promise.all([db.all('walks'), db.all('observations'), db.all('moments')]);
  const profile = normalizeProfile({
    walksCompleted: walks.length,
    milesTotal: walks.reduce((total, walk) => total + ((walk.distanceMeters || 0) / 1609.344), 0),
    observationsLogged: observations.length,
    sitesDiscovered: {},
    totalPoints: walks.reduce((total, walk) => total + Math.round(((walk.distanceMeters || 0) / 1609.344) * POINTS_PER_MILE), 0) + observations.length * POINTS_PER_OBSERVATION
  });
  moments.filter((moment) => moment.type === 'history' && moment.siteId).forEach((moment) => {
    const cityId = moment.city || 'vienna';
    const ids = sitesForProfile(profile, cityId);
    if (!ids.includes(moment.siteId)) {
      profile.sitesDiscovered[cityId] = [...ids, moment.siteId];
      profile.totalPoints += POINTS_PER_NEW_HISTORY_SITE;
    }
  });
  return profile;
}
export async function loadLocalState() {
  const [savedProfile, savedSettings] = await Promise.all([db.get('profile', 'local-user'), db.get('settings', 'app-settings')]);
  state.profile = savedProfile ? normalizeProfile(savedProfile) : await createMigratedProfile();
  state.settings = { ...DEFAULT_SETTINGS, ...(savedSettings || {}) };
  if (!CITIES[state.settings.activeCity]) state.settings.activeCity = 'vienna';
  state.activeCity = state.settings.activeCity;
  await Promise.all([db.put('profile', state.profile), db.put('settings', state.settings)]);
}
export async function updateProfile(mutator) {
  const result = await mutator(state.profile);
  state.profile = normalizeProfile(state.profile);
  await db.put('profile', state.profile);
  renderProfile();
  void syncProfile().catch((error) => console.warn('Aggregate profile sync deferred:', error.message));
  return result;
}
export async function refreshCityMap(recenter = false) {
  const active = city();
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
  state.poiTags.clear();
  await db.put('settings', state.settings);
  await refreshCityMap(recenter);
  setStatus(`${cityLabel(nextCity)} ready for a walk`);
  toast(`Now exploring ${cityLabel(nextCity)}.`);
}
export async function stopWalk() {
  if (!state.activeWalk) return;
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null; clearInterval(state.timerId); state.timerId = null; updateWalkDisplay();
  const finished = { ...state.activeWalk, endedAt: new Date().toISOString(), points: [...state.activeWalk.points] };
  const award = await updateProfile((profile) => { const score = calculateWalkAward(finished, profile); profile.totalPoints += score.total; profile.walksCompleted += 1; profile.milesTotal += score.miles; if (score.firstWalkToday) { profile.streakDays = score.nextStreak; profile.lastWalkDate = score.date; } return score; });
  finished.pointsAwarded = award.total; await db.put('walks', finished); state.activeWalk = null;
  el('walkButton').textContent = 'Start walk'; el('walkButton').classList.remove('walking'); const pauseButton = el('pauseWalkButton'); if (pauseButton) pauseButton.classList.add('hidden');
  setStatus('Walk saved locally'); toast(`Walk saved - +${award.total} points.`); renderArchive(); openJournal(finished.id);
}
export async function saveHistoryMoment() {
  const site = state.currentSite; if (!site) return;
  const cityId = state.activeCity;
  const award = await updateProfile((profile) => {
    const discovered = sitesForProfile(profile, cityId);
    if (discovered.includes(site.id)) return { points: 0, firstDiscovery: false };
    profile.sitesDiscovered[cityId] = [...discovered, site.id];
    profile.totalPoints += POINTS_PER_NEW_HISTORY_SITE;
    return { points: POINTS_PER_NEW_HISTORY_SITE, firstDiscovery: true };
  });
  await db.put('moments', {
    id: uid('moment'), type: 'history', title: `Visited ${site.name}`,
    note: site.unverified ? 'Prototype historic-place prompt saved. Content is unverified.' : 'Historic-place prompt saved during a walk.',
    siteId: site.id, city: cityId, pointsAwarded: award.points, createdAt: new Date().toISOString(), location: { lat: site.lat, lng: site.lng }
  });
  closeSheets(); toast(award.firstDiscovery ? `New history site — +${award.points} points.` : 'History moment saved to your local archive.'); renderArchive();
}
export async function saveObservation(event) {
  event.preventDefault();
  const file = el('photoInput').files[0];
  let photo = null;
  if (file) photo = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
  const observation = { id: uid('observation'), type: 'observation', city: state.activeCity, species: el('speciesInput').value.trim(), note: el('observationNote').value.trim(), photo, location: state.draftObservationLocation, createdAt: new Date().toISOString(), pointsAwarded: POINTS_PER_OBSERVATION };
  await db.put('observations', observation);
  await updateProfile((profile) => { profile.totalPoints += POINTS_PER_OBSERVATION; profile.observationsLogged += 1; return POINTS_PER_OBSERVATION; });
  addObservationMarker(observation); closeSheets(); toast(`Observation saved — +${POINTS_PER_OBSERVATION} points.`); renderArchive();
}
export async function saveJournal(event) {
  event.preventDefault();
  const mood = document.querySelector('input[name="mood"]:checked').value;
  const note = el('journalNote').value.trim();
  const walkId = event.currentTarget.dataset.walkId;
  const moment = { id: uid('moment'), type: 'journal', title: mood, note: note || 'A reflection saved after a walk.', createdAt: new Date().toISOString(), walkId: walkId || null, city: state.activeCity };
  await db.put('moments', moment);
  closeSheets(); toast('Reflection saved locally.'); renderArchive();
}
export async function allArchiveItems() {
  const [walks, observations, moments] = await Promise.all([db.all('walks'), db.all('observations'), db.all('moments')]);
  return [...walks.map((walk) => ({ ...walk, type: 'walk', createdAt: walk.startedAt })), ...observations, ...moments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
export async function renderArchive() {
  let items = await allArchiveItems();
  if (state.archiveFilter === 'walk') items = items.filter((item) => item.type === 'walk' || item.type === 'journal');
  if (state.archiveFilter === 'observation') items = items.filter((item) => item.type === 'observation');
  el('archiveList').innerHTML = items.length ? items.map(momentCard).join('') : '<div class="empty-state">No matching moments yet. Start a walk or add an observation from the map.</div>';
}
export async function setupOnline() {
  if (!onlineConfigured() || state.online.client) return;
  const config = onlineConfig();
  state.online.client = window.supabase.createClient(config.url, config.anonKey);
  const { data } = await state.online.client.auth.getSession();
  state.online.session = data.session;
  if (state.online.session) await loadRemoteProfile();
  state.online.client.auth.onAuthStateChange((_event, session) => {
    state.online.session = session;
    setTimeout(() => { if (session) void loadRemoteProfile(); else { state.online.remoteProfile = null; renderProfile(); } }, 0);
  });
setInterval(async () => {
    if (state.online.client && state.online.session) {
      await state.online.client.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', state.online.session.user.id);
    }
  }, 90000);}
export async function loadRemoteProfile() {
  if (!state.online.client || !state.online.session) return null;
  const { data, error } = await state.online.client.from('profiles').select('id,username,phone,last_seen_at,total_points,miles_total,sites_discovered,updated_at').eq('id', state.online.session.user.id).maybeSingle();
  if (error) throw error;
  state.online.remoteProfile = data || null;
  renderProfile();
  return data;
}
export async function syncProfile() {
  if (!state.online.client || !state.online.session || !state.online.remoteProfile?.username) return false;
  const payload = {
    id: state.online.session.user.id, username: state.online.remoteProfile.username,
    total_points: Math.round(state.profile.totalPoints), miles_total: Number(state.profile.milesTotal.toFixed(3)),
    sites_discovered: totalSitesDiscovered(state.profile), updated_at: new Date().toISOString()
  };
  const { data, error } = await state.online.client.from('profiles').upsert(payload).select().single();
  if (error) throw error;
  state.online.remoteProfile = data;
  state.settings.lastSyncedAt = new Date().toISOString();
  await db.put('settings', state.settings);
  renderProfile();
  return true;
}
export async function openOnline() { await setupOnline(); openSheet('onlineSheet'); await renderOnline(); }
export async function renderOnline() {
  const setup = el('onlineSetupPanel'), magic = el('magicLinkForm'), username = el('usernameForm'), dashboard = el('onlineDashboard');
  [setup, magic, username, dashboard].forEach((panel) => panel.classList.add('hidden'));
  if (!onlineConfigured()) { setup.classList.remove('hidden'); return; }
  if (!state.online.session) { magic.classList.remove('hidden'); return; }
  if (!state.online.remoteProfile?.username) { username.classList.remove('hidden'); return; }
  dashboard.classList.remove('hidden');
  el('onlineStatusText').textContent = state.settings.lastSyncedAt ? `Last synced ${shortDate(state.settings.lastSyncedAt)}` : 'Online — aggregate stats ready to sync';
  await refreshFriends();
}
export async function signIn() {
  if (!onlineConfigured()) return;
  const email = el('onlineEmail').value.trim();
  const password = el('onlinePassword').value;
  if (!email || !password) { toast('Enter your email and password.'); return; }

  const { error } = await state.online.client.auth.signInWithPassword({ email, password });
  if (error) { toast(error.message); return; }

  await loadRemoteProfile();
  await renderOnline();
}

export async function signUp() {
  if (!onlineConfigured()) return;
  const email = el('onlineEmail').value.trim();
  const password = el('onlinePassword').value;
  if (!email || !password) { toast('Enter your email and password.'); return; }

  const { data, error } = await state.online.client.auth.signUp({ email, password });
  if (error) { toast(error.message); return; }
  if (!data.session) { toast('Account created — check your email to confirm before continuing.'); return; }

  await loadRemoteProfile();
  await renderOnline();
}
export async function createOnlineProfile(event) {
  event.preventDefault();
  if (!onlineConfigured()) return;
  const username = el('usernameInput').value.trim();
  if (!username) { toast('Enter a username.'); return; }
  const phone = el('phoneInput').value.trim();
  const payload = {
    id: state.online.session.user.id,
    username,
    phone: phone || null,
    last_seen_at: new Date().toISOString(),
    total_points: Math.round(state.profile.totalPoints),
    miles_total: Number(state.profile.milesTotal.toFixed(3)),
    sites_discovered: totalSitesDiscovered(state.profile),
    updated_at: new Date().toISOString()
  };
  const { data, error } = await state.online.client.from('profiles').upsert(payload).select().single();
  if (error) { toast(error.message.includes('unique') ? 'That username is already in use.' : error.message); return; }
  state.online.remoteProfile = data;
  state.settings.lastSyncedAt = new Date().toISOString();
  await db.put('settings', state.settings);
  renderProfile();
  await renderOnline();
  toast('Online profile created. Only aggregate stats can sync.');
}
export async function updateAccountUsername(event) {
  event.preventDefault();
  const username = el('accountUsernameInput').value.trim();
  if (!username) { toast('Enter a username.'); return; }
  const { data, error } = await state.online.client.from('profiles').update({ username, updated_at: new Date().toISOString() }).eq('id', state.online.session.user.id).select().single();
  if (error) { toast(error.message.includes('unique') ? 'That username is already in use.' : error.message); return; }
  state.online.remoteProfile = data;
  renderProfile();
  toast('Username updated.');
}
export async function updateAccountPhone(event) {
  event.preventDefault();
  const phone = el('accountPhoneInput').value.trim();
  const { data, error } = await state.online.client.from('profiles').update({ phone: phone || null, updated_at: new Date().toISOString() }).eq('id', state.online.session.user.id).select().single();
  if (error) { toast(error.message); return; }
  state.online.remoteProfile = data;
  toast('Phone number updated.');
}
export async function updateAccountEmail(event) {
  event.preventDefault();
  const email = el('accountEmailInput').value.trim();
  const { error } = await state.online.client.auth.updateUser({ email });
  if (error) { toast(error.message); return; }
  toast('Check your new email inbox to confirm the change.');
}
export async function updateAccountPassword(event) {
  event.preventDefault();
  const password = el('accountPasswordInput').value;
  if (!password || password.length < 6) { toast('Password must be at least 6 characters.'); return; }
  const { error } = await state.online.client.auth.updateUser({ password });
  if (error) { toast(error.message); return; }
  el('accountPasswordInput').value = '';
  toast('Password updated.');
}
export async function acceptFriend(friendId) {
  const { error } = await state.online.client.from('friendships').update({ status: 'accepted' }).eq('user_id', friendId).eq('friend_id', state.online.session.user.id);
  if (error) { toast(error.message); return; }
  toast('Friend added to your leaderboard.'); await refreshFriends();
}
export async function exportJournal() {
  const [walks, observations, moments, profile, settings] = await Promise.all([db.all('walks'), db.all('observations'), db.all('moments'), db.get('profile', 'local-user'), db.get('settings', 'app-settings')]);
  const backup = { format: 'walk-wildlife-journal', version: 1, exportedAt: new Date().toISOString(), walks, observations, moments, profile, settings };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `walk-wildlife-journal-${dayKey()}.json`; link.click(); URL.revokeObjectURL(url); toast('Journal backup downloaded.');
}
export async function importJournal(event) {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup.format !== 'walk-wildlife-journal' || backup.version !== 1 || !Array.isArray(backup.walks) || !Array.isArray(backup.observations) || !Array.isArray(backup.moments)) throw new Error('Choose a Walk & Wildlife journal backup file.');
    if (!confirm('Replace this device\'s current journal with this backup? This cannot be undone.')) return;
    await db.clearAll();
    await Promise.all([...backup.walks.map((item) => db.put('walks', item)), ...backup.observations.map((item) => db.put('observations', item)), ...backup.moments.map((item) => db.put('moments', item))]);
    state.profile = normalizeProfile(backup.profile || await createMigratedProfile()); state.settings = { ...DEFAULT_SETTINGS, ...(backup.settings || {}) };
    if (!CITIES[state.settings.activeCity]) state.settings.activeCity = 'vienna'; state.activeCity = state.settings.activeCity;
    await Promise.all([db.put('profile', state.profile), db.put('settings', state.settings)]); closeSheets(); await refreshCityMap(true); await renderArchive(); toast('Journal backup restored.');
  } catch (error) { toast(error.message || 'That backup could not be restored.'); }
}
export async function openWalkDetail(id) {
  const walk = await db.get('walks', id); if (!walk) return;
  const moments = await db.all('moments'); const reflection = moments.find((item) => item.type === 'journal' && item.walkId === id);
  let sheet = el('walkDetailSheet');
  if (!sheet) { sheet = document.createElement('section'); sheet.id = 'walkDetailSheet'; sheet.className = 'sheet tall-sheet hidden'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); document.body.append(sheet); }
  sheet.innerHTML = `<button class="close-sheet" data-close-walk-detail aria-label="Close">x</button><span class="sheet-kicker">SAVED WALK</span><h2>${escapeHtml(shortDate(walk.startedAt))} walk</h2><div class="walk-detail-stats"><div><strong>${formatDistance(walk.distanceMeters)}</strong><span>Miles</span></div><div><strong>${formatDuration(walk.durationSeconds)}</strong><span>Duration</span></div><div><strong>+${walk.pointsAwarded || 0}</strong><span>Points</span></div></div><div id="walkDetailMap" class="walk-detail-map"></div>${reflection ? `<section class="walk-reflection"><p class="sheet-kicker">${escapeHtml(reflection.title)}</p><p>${escapeHtml(reflection.note)}</p></section>` : '<p class="empty-state">No reflection was saved for this walk.</p>'}`;
  sheet.querySelector('[data-close-walk-detail]').addEventListener('click', () => { state.walkDetailMap?.remove(); state.walkDetailMap = null; closeSheets(); }); openSheet('walkDetailSheet');
  setTimeout(() => { const points = walk.points || []; state.walkDetailMap?.remove(); state.walkDetailMap = L.map('walkDetailMap', { zoomControl: false, attributionControl: false }); if (points.length) { const latLngs = points.map((point) => [point.lat, point.lng]); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.walkDetailMap); L.polyline(latLngs, { color: '#245448', weight: 5 }).addTo(state.walkDetailMap); state.walkDetailMap.fitBounds(latLngs, { padding: [22, 22], maxZoom: 17 }); } else { state.walkDetailMap.setView([city().center.lat, city().center.lng], city().zoom); } }, 20);
}
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
export function initBackupControls() {
  const panel = document.createElement('div'); panel.className = 'backup-controls';
  panel.innerHTML = '<p class="sheet-kicker">YOUR BACKUP</p><p>Download a private copy of this device journal, or restore a backup. Restoring replaces this device\'s current journal.</p><div class="backup-actions"><button class="secondary-button" id="exportDataButton" type="button">Export journal</button><label class="secondary-button import-label">Import journal<input id="importDataInput" type="file" accept="application/json,.json" /></label></div>';
  el('clearDataButton').before(panel);
  el('exportDataButton').addEventListener('click', exportJournal);
  el('importDataInput').addEventListener('change', importJournal);
}
export async function init() {
try { await db.open(); await loadLocalState(); await loadAllCityData(); } catch (error) { console.error(error); toast('Local storage or places data could not open in this browser.'); return; }  initMap();
try { initEvents(); } catch (error) { console.error('initEvents failed:', error); }
  await refreshCityMap(false); await renderArchive();
  try {
    await setupOnline();
    if (state.online.session && !state.online.remoteProfile?.username) {
      await openOnline();
      toast('Signed in! Choose a username to finish setup.');
    }
  } catch (error) { console.warn('Online mode unavailable:', error.message); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}
export async function refreshFriends() {
  if (!state.online.client || !state.online.session || !state.online.remoteProfile) return;
  const me = state.online.session.user.id;
  const { data: friendships, error } = await state.online.client.from('friendships').select('user_id,friend_id,status').or(`user_id.eq.${me},friend_id.eq.${me}`);
  if (error) { console.warn('Could not refresh friendships:', error.message); return; }
  const rows = friendships || [];
  const incoming = rows.filter((row) => row.friend_id === me && row.status === 'pending');
  const acceptedIds = rows.filter((row) => row.status === 'accepted').map((row) => row.user_id === me ? row.friend_id : row.user_id);
  let people = [state.online.remoteProfile];
  if (acceptedIds.length) {
    const { data: friends, error: friendsError } = await state.online.client.from('profiles').select('id,username,phone,last_seen_at,total_points,miles_total,sites_discovered,updated_at').in('id', acceptedIds);
    if (!friendsError) people = [...people, ...(friends || [])];
  }
  const incomingIds = incoming.map((row) => row.user_id);
  let requestProfiles = [];
  if (incomingIds.length) {
    const { data } = await state.online.client.from('profiles').select('id,username').in('id', incomingIds);
    requestProfiles = data || [];
  }
  state.online.leaderboard = people.sort((a, b) => (b.total_points || 0) - (a.total_points || 0));
  state.online.incoming = incoming.map((row) => ({ ...row, username: requestProfiles.find((profile) => profile.id === row.user_id)?.username || 'Friend' }));
  renderLeaderboard();
  renderIncomingRequests();
}
export async function findFriend(event) {
  event.preventDefault();
  const username = el('friendUsernameInput').value.trim();
  const { data, error } = await state.online.client.rpc('find_profile_by_username', { query_username: username });
  if (error) { toast(error.message); return; }
  const candidate = data?.[0];
  if (!candidate) { el('friendSearchResult').classList.add('hidden'); toast('No user found with that username.'); return; }
  if (candidate.id === state.online.session.user.id) { toast('That is your own profile.'); return; }
  state.online.candidate = candidate;
  el('friendSearchResult').innerHTML = `<div><strong>@${escapeHtml(candidate.username)}</strong><span>Send a private friend request</span></div><button class="secondary-button" id="sendFriendRequestButton">Add</button>`;
  el('friendSearchResult').classList.remove('hidden');
  el('sendFriendRequestButton').addEventListener('click', sendFriendRequest, { once: true });
}
export async function sendFriendRequest() {
  const candidate = state.online.candidate; if (!candidate) return;
  const { error } = await state.online.client.from('friendships').insert({ user_id: state.online.session.user.id, friend_id: candidate.id, status: 'pending' });
  if (error) { toast(error.code === '23505' ? 'A request already exists for this friend.' : error.message); return; }
  state.online.candidate = null; el('friendSearchResult').classList.add('hidden'); toast(`Friend request sent to @${candidate.username}.`);
}