/* Michael Yoto Maker — local autosave (IndexedDB with localStorage fallback) */
(function (YM) {
  'use strict';

  const DB_NAME = 'michael-yoto-maker';
  const STORE = 'kv';
  let dbPromise = null;
  let idbBroken = false;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      try {
        if (!('indexedDB' in window)) throw new Error('no indexedDB');
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('indexedDB error'));
        req.onblocked = () => reject(new Error('indexedDB blocked'));
        setTimeout(() => reject(new Error('indexedDB timeout')), 2500);
      } catch (e) {
        reject(e);
      }
    }).catch((err) => {
      idbBroken = true;
      throw err;
    });
    return dbPromise;
  }

  async function idbSet(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const Storage = (YM.Storage = {
    async save(key, value) {
      if (!idbBroken) {
        try {
          await idbSet(key, value);
          return 'idb';
        } catch (e) {
          idbBroken = true;
        }
      }
      try {
        const json = typeof value === 'string' ? value : JSON.stringify(value);
        localStorage.setItem('mym.' + key, json);
        return 'local';
      } catch (e) {
        return null;
      }
    },

    async load(key) {
      if (!idbBroken) {
        try {
          const v = await idbGet(key);
          if (v != null) return v;
        } catch (e) {
          idbBroken = true;
        }
      }
      try {
        const raw = localStorage.getItem('mym.' + key);
        if (raw != null) return JSON.parse(raw);
      } catch (e) { /* ignore */ }
      return null;
    },

    async remove(key) {
      try {
        if (!idbBroken) {
          const db = await openDB();
          await new Promise((res) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(key);
            tx.oncomplete = res;
            tx.onerror = res;
          });
        }
      } catch (e) { /* ignore */ }
      try { localStorage.removeItem('mym.' + key); } catch (e) { /* ignore */ }
    },

    get syncAvailable() { return true; },
  });

  YM.Prefs = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('mym.pref.' + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('mym.pref.' + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
  };
})(window.YM);
