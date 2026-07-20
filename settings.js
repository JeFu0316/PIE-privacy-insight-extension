/*
 * P.I.E settings — chrome.storage.sync layer (Phase 1 foundation).
 * Shared by popup (script tag) and service worker (importScripts).
 * No network calls; defaults merge on every load for forward-compatible migrations.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'pie_settings';
  const SCHEMA_VERSION = 1;

  const DEFAULTS = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    theme: 'system',
    defaultTab: 'overview',
    thirdPartyNotifications: true,
    ipLookupEnabled: false,
    networkMonitoring: true,
    animations: true,
    bannerAutoHide: false
  });

  const VALID = {
    theme: new Set(['system', 'light', 'dark', 'catppuccin', 'dracula', 'nord', 'colorblind']),
    defaultTab: new Set(['overview', 'cookies', 'security', 'network'])
  };

  function mergeWithDefaults(raw) {
    const out = { ...DEFAULTS };
    if (!raw || typeof raw !== 'object') return out;

    if (VALID.theme.has(raw.theme)) out.theme = raw.theme;
    if (VALID.defaultTab.has(raw.defaultTab)) out.defaultTab = raw.defaultTab;
    if (typeof raw.thirdPartyNotifications === 'boolean') {
      out.thirdPartyNotifications = raw.thirdPartyNotifications;
    }
    if (typeof raw.ipLookupEnabled === 'boolean') {
      out.ipLookupEnabled = raw.ipLookupEnabled;
    }
    if (typeof raw.networkMonitoring === 'boolean') {
      out.networkMonitoring = raw.networkMonitoring;
    }
    if (typeof raw.animations === 'boolean') {
      out.animations = raw.animations;
    }
    if (typeof raw.bannerAutoHide === 'boolean') {
      out.bannerAutoHide = raw.bannerAutoHide;
    }

    out.schemaVersion = SCHEMA_VERSION;
    return out;
  }

  async function load() {
    try {
      const data = await chrome.storage.sync.get(STORAGE_KEY);
      return mergeWithDefaults(data[STORAGE_KEY]);
    } catch (_) {
      return mergeWithDefaults(null);
    }
  }

  async function save(partial) {
    const current = await load();
    const next = mergeWithDefaults({ ...current, ...partial });
    await chrome.storage.sync.set({ [STORAGE_KEY]: next });
    return next;
  }

  root.PIE_SETTINGS = {
    STORAGE_KEY,
    SCHEMA_VERSION,
    DEFAULTS,
    mergeWithDefaults,
    load,
    save
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
