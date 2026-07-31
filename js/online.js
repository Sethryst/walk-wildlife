import {
  toast,
  el,
  shortDate,
  totalSitesDiscovered,
  renderProfile
} from './utils.js';

import { state } from './state.js';

import db from './storage.js';
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
  export async function openOnline() {
  await setupOnline();
  openSheet('onlineSheet');
  await renderOnline();
}
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


export function onlineConfig() { return window.WALK_WILDLIFE_SUPABASE || {}; }
export function onlineConfigured() {
  const config = onlineConfig();
  return Boolean(config.url && config.anonKey && window.supabase?.createClient);
}