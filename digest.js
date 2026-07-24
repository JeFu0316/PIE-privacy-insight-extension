/*
 * Toolingo weekly privacy digest — on-device aggregates only.
 * chrome.storage.local (not sync). No first-party browsing hosts. No upload.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'pie_weekly_digest';
  const MAX_DOMAINS = 40;
  const TOP_N = 5;

  const TWO_PART_TLDS = new Set([
    'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'co.jp', 'co.kr', 'com.au', 'net.au',
    'com.br', 'com.cn', 'com.mx', 'co.in', 'co.nz', 'co.za', 'com.tr', 'com.sg'
  ]);

  function baseDomain(host) {
    if (!host || typeof host !== 'string') return '';
    let h = host.trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
    if (!h || h.indexOf('.') === -1) return '';
    const parts = h.split('.');
    if (parts.length <= 2) return h;
    const lastTwo = parts.slice(-2).join('.');
    if (TWO_PART_TLDS.has(lastTwo)) return parts.slice(-3).join('.');
    return lastTwo;
  }

  /** ISO-like week id in UTC: YYYY-Www */
  function weekId(date) {
    const d = date ? new Date(date) : new Date();
    if (isNaN(d.getTime())) return weekId(new Date());
    const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
    return utc.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
  }

  function emptyState(id) {
    return {
      weekId: id || weekId(),
      trackerEvents: 0,
      trackerDomains: {},
      cookiesCleaned: 0
    };
  }

  function sanitizeState(raw, currentWeek) {
    const wid = currentWeek || weekId();
    if (!raw || typeof raw !== 'object' || raw.weekId !== wid) {
      return emptyState(wid);
    }
    const domains = Object.create(null);
    if (raw.trackerDomains && typeof raw.trackerDomains === 'object') {
      Object.keys(raw.trackerDomains).forEach(function (k) {
        const n = raw.trackerDomains[k];
        if (typeof k === 'string' && k && typeof n === 'number' && n > 0 && isFinite(n)) {
          domains[k] = Math.floor(n);
        }
      });
    }
    return {
      weekId: wid,
      trackerEvents: (typeof raw.trackerEvents === 'number' && raw.trackerEvents > 0)
        ? Math.floor(raw.trackerEvents) : 0,
      trackerDomains: domains,
      cookiesCleaned: (typeof raw.cookiesCleaned === 'number' && raw.cookiesCleaned > 0)
        ? Math.floor(raw.cookiesCleaned) : 0
    };
  }

  function capDomains(domains) {
    const keys = Object.keys(domains);
    if (keys.length <= MAX_DOMAINS) return domains;
    keys.sort(function (a, b) { return domains[b] - domains[a]; });
    const out = Object.create(null);
    for (let i = 0; i < MAX_DOMAINS; i++) out[keys[i]] = domains[keys[i]];
    return out;
  }

  function topTrackers(domains, n) {
    const limit = n == null ? TOP_N : n;
    return Object.keys(domains)
      .map(function (domain) { return { domain: domain, count: domains[domain] }; })
      .sort(function (a, b) { return b.count - a.count || a.domain.localeCompare(b.domain); })
      .slice(0, limit);
  }

  // Injectable storage for unit tests.
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

  function setStorageApi(api) {
    storageApi = api;
  }

  let writeChain = Promise.resolve();

  function enqueue(fn) {
    writeChain = writeChain.then(fn, fn);
    return writeChain;
  }

  async function loadRaw() {
    try {
      return await getStorage().get(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  async function saveState(state) {
    try {
      await getStorage().set(STORAGE_KEY, state);
    } catch (_) {}
    return state;
  }

  async function load() {
    const wid = weekId();
    const raw = await loadRaw();
    const state = sanitizeState(raw, wid);
    if (!raw || raw.weekId !== wid) {
      await saveState(state);
    }
    return state;
  }

  async function mutate(mutator) {
    return enqueue(async function () {
      const wid = weekId();
      const state = sanitizeState(await loadRaw(), wid);
      mutator(state);
      state.trackerDomains = capDomains(state.trackerDomains);
      return saveState(state);
    });
  }

  async function recordTracker(host) {
    const base = baseDomain(host);
    if (!base) return null;
    return mutate(function (state) {
      state.trackerEvents += 1;
      state.trackerDomains[base] = (state.trackerDomains[base] || 0) + 1;
    });
  }

  async function recordCleaned(n) {
    const count = typeof n === 'number' && n > 0 ? Math.floor(n) : 0;
    if (!count) return null;
    return mutate(function (state) {
      state.cookiesCleaned += count;
    });
  }

  async function snapshot() {
    const state = await load();
    return {
      weekId: state.weekId,
      trackerEvents: state.trackerEvents,
      cookiesCleaned: state.cookiesCleaned,
      topTrackers: topTrackers(state.trackerDomains, TOP_N)
    };
  }

  root.PIE_DIGEST = {
    STORAGE_KEY: STORAGE_KEY,
    MAX_DOMAINS: MAX_DOMAINS,
    TOP_N: TOP_N,
    weekId: weekId,
    baseDomain: baseDomain,
    emptyState: emptyState,
    sanitizeState: sanitizeState,
    capDomains: capDomains,
    topTrackers: topTrackers,
    setStorageApi: setStorageApi,
    load: load,
    recordTracker: recordTracker,
    recordCleaned: recordCleaned,
    snapshot: snapshot
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
