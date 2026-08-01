import { state } from './state.js';
import { POINTS_PER_OBSERVATION } from './constants.js';
import { el, cityLabel, escapeHtml, uid } from './utils.js';
import db from './storage.js';
import { updateProfile } from './profile.js';
import { openSheet, closeSheets, toast } from './ui.js';
import { renderArchive } from './archive.js';

export function openObservation(location) {
  const loc = location || state.currentPosition || { lat: state.map.getCenter().lat, lng: state.map.getCenter().lng };
  state.draftObservationLocation = loc;
  if (state.draftMarker) state.draftMarker.remove();
  const icon = L.divIcon({ className: '', html: '<div class="wildlife-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  state.draftMarker = L.marker([loc.lat, loc.lng], { icon }).addTo(state.map);
  el('observationLocation').textContent = `Pinned at ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)} in ${cityLabel(state.activeCity)}. Move it by closing this form and tapping a new spot on the map.`;
  el('observationForm').reset(); el('photoName').textContent = 'Optional, stored only on this device';
  openSheet('observationSheet');
}
export function addObservationMarker(observation) {
  const icon = L.divIcon({ className: '', html: '<div class="wildlife-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  const marker = L.marker([observation.location.lat, observation.location.lng], { icon, title: observation.species }).addTo(state.observationLayer);
  marker.bindPopup(`<strong>${escapeHtml(observation.species)}</strong>${observation.note ? `<br><span>${escapeHtml(observation.note)}</span>` : ''}`);
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
