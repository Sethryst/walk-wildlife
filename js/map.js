import { state } from './state.js';
import { city } from './poi.js';
import { debounce, el } from './utils.js';
import { openObservation } from './observation.js';
import { renderCityPois } from './poi.js';

export function initMap() {
  const active = city();
  state.map = L.map('map', { zoomControl: false, attributionControl: true }).setView([active.center.lat, active.center.lng], active.zoom);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors', crossOrigin: true }).addTo(state.map);
  state.historyRadiusLayer = L.layerGroup().addTo(state.map);
  const clusterOptions = (badgeClass) => ({
    chunkedLoading: true, // progressive loading: adds markers in batches off the main thread
    maxClusterRadius: 55,
    disableClusteringAtZoom: 17, // split back into individual pins once zoomed in
    iconCreatefunction: (cluster) => L.divIcon({ className: '', html: `<div class="cluster-badge ${badgeClass}">${cluster.getChildCount()}</div>`, iconSize: [36, 36] })
  });
  state.historyLayer = (typeof L.markerClusterGroup === 'function' ? L.markerClusterGroup(clusterOptions('history-cluster')) : L.layerGroup()).addTo(state.map);
  state.observationLayer = L.layerGroup().addTo(state.map);
  state.poiLayer = (typeof L.markerClusterGroup === 'function' ? L.markerClusterGroup(clusterOptions('poi-cluster')) : L.layerGroup()).addTo(state.map);
  state.trailLayer = L.featureGroup().addTo(state.map);
  state.map.on('click', (event) => openObservation({ lat: event.latlng.lat, lng: event.latlng.lng }));
  // Viewport windowing: only build markers for what's on/near screen, recomputed
  // after panning/zooming settles. Stands in for server-side bbox filtering
  // until the backend described in the recommendations exists.
  state.map.on('moveend zoomend', debounce(() => renderCityPois(), 200));
}
export function renderUserLocation(point, pan = false) {
  state.currentPosition = point;
  const icon = L.divIcon({ className: '', html: '<div class="user-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  if (!state.userMarker) state.userMarker = L.marker([point.lat, point.lng], { icon, zIndexOffset: 1000, title: 'Your location' }).addTo(state.map);
  else state.userMarker.setLatLng([point.lat, point.lng]);
  if (pan) state.map.panTo([point.lat, point.lng]);
}