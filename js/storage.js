export const db = (() => {
  let database;
  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('walk-wildlife-journal', 3);
      request.onupgradeneeded = () => {
        database = request.result;
        if (!database.objectStoreNames.contains('walks')) database.createObjectStore('walks', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('observations')) database.createObjectStore('observations', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('moments')) database.createObjectStore('moments', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('profile')) database.createObjectStore('profile', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('points_of_interest')) database.createObjectStore('points_of_interest', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('poi_metadata')) database.createObjectStore('poi_metadata', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('regions')) database.createObjectStore('regions', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('region_pois')) database.createObjectStore('region_pois', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('region_buckets')) database.createObjectStore('region_buckets', { keyPath: 'id' });
      };
      request.onsuccess = () => { database = request.result; resolve(); };
      request.onerror = () => reject(request.error);
    });
  }
  function store(name, mode = 'readonly') { return database.transaction(name, mode).objectStore(name); }
  function put(name, item) { return new Promise((resolve, reject) => {const r = store(name, 'readwrite').put(item); r.onsuccess = () => resolve(item); r.onerror = () => reject(r.error); }); }
  function get(name, id) { return new Promise((resolve, reject) => {const r = store(name).get(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  function all(name) { return new Promise((resolve, reject) => {const r = store(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  function clearAll() {
    return Promise.all(['walks', 'observations', 'moments', 'profile', 'settings'].map((name) => new Promise((resolve, reject) => {
    const r = store(name, 'readwrite').clear(); r.onsuccess = resolve; r.onerror = () => reject(r.error);
    })));
  }
  return { open, put, get, all, clearAll };
})();
export default db;