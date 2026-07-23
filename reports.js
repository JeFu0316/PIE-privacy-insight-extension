/*
 * On-device user report inbox (no upload). Future: sync to a Toolingo backend.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'pie_user_reports';
  const MAX_REPORTS = 40;

  let storageApi = null;

  function getStorage() {
    if (storageApi) return storageApi;
    return {
      get: async function (key) {
        const data = await chrome.storage.local.get(key);
        return data[key];
      },
      set: async function (key, value) {
        const obj = {};
        obj[key] = value;
        await chrome.storage.local.set(obj);
      }
    };
  }

  function setStorageApi(api) { storageApi = api; }

  function sanitizeList(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (r) {
      return r && typeof r === 'object' && typeof r.id === 'string' && typeof r.ts === 'number';
    }).slice(0, MAX_REPORTS);
  }

  async function list() {
    try {
      return sanitizeList(await getStorage().get(STORAGE_KEY));
    } catch (_) {
      return [];
    }
  }

  async function add(entry) {
    const item = {
      id: entry.id || ('r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
      ts: entry.ts || Date.now(),
      topic: String(entry.topic || 'other').slice(0, 40),
      url: String(entry.url || '').slice(0, 500),
      details: String(entry.details || '').slice(0, 4000),
      version: String(entry.version || '').slice(0, 32),
      locale: String(entry.locale || '').slice(0, 16)
    };
    const next = [item].concat(await list()).slice(0, MAX_REPORTS);
    try {
      await getStorage().set(STORAGE_KEY, next);
    } catch (_) {}
    return item;
  }

  async function clear() {
    try {
      await getStorage().set(STORAGE_KEY, []);
    } catch (_) {}
  }

  root.PIE_REPORTS = {
    STORAGE_KEY: STORAGE_KEY,
    MAX_REPORTS: MAX_REPORTS,
    setStorageApi: setStorageApi,
    list: list,
    add: add,
    clear: clear
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
