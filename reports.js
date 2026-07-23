/*
 * On-device user report inbox + optional remote submit to Toolingo support via Formspree.
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

  const FORMSPREE_ENDPOINT = 'https://formspree.io/f/mrenarao';

  async function submitRemote(item) {
    const res = await fetch(FORMSPREE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        topic: item.topic,
        url: item.url,
        details: item.details || '(none)',
        version: item.version,
        locale: item.locale,
        _subject: 'Toolingo report: ' + item.topic
      })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  }

  root.PIE_REPORTS = {
    STORAGE_KEY: STORAGE_KEY,
    MAX_REPORTS: MAX_REPORTS,
    setStorageApi: setStorageApi,
    list: list,
    add: add,
    clear: clear,
    submitRemote: submitRemote
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
