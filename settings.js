/*
 * P.I.E settings — chrome.storage.sync layer (Phase 1 foundation).
 * Shared by popup (script tag) and service worker (importScripts).
 * No network calls; defaults merge on every load for forward-compatible migrations.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'pie_settings';
  const SCHEMA_VERSION = 1;

  // Curated set of colours the custom-theme editor exposes; the rest of the
  // palette is derived from these via color-mix() in popup.css.
  const CUSTOM_THEME_KEYS = ['bg', 'surface', 'brand', 'accent', 'text', 'danger'];
  const DEFAULT_CUSTOM_THEME = Object.freeze({
    bg: '#1C1B27',
    surface: '#232232',
    brand: '#6D5EF6',
    accent: '#3B82F6',
    text: '#ECEBF5',
    danger: '#E5484D'
  });

  const DEFAULTS = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    theme: 'system',
    language: 'auto',
    defaultTab: 'overview',
    thirdPartyNotifications: true,
    ipLookupEnabled: false,
    myIpLookupEnabled: false,
    networkMonitoring: true,
    animations: true,
    backgroundAnim: 'aurora',
    customTheme: { ...DEFAULT_CUSTOM_THEME },
    bannerAutoHide: false,
    trackerBadge: true,
    autoClean: false,
    autoCleanAllowlist: [],
    weeklyDigestEnabled: true
  });

  const VALID = {
    theme: new Set(['system', 'light', 'dark', 'catppuccin', 'dracula', 'nord', 'colorblind', 'custom']),
    defaultTab: new Set(['overview', 'cookies', 'security', 'network']),
    backgroundAnim: new Set(['none', 'aurora', 'particles', 'shimmer']),
    // 'auto' follows the browser locale; codes cover current + planned catalogs.
    language: new Set(['auto', 'en', 'zh_CN', 'zh_TW', 'ru', 'es', 'fr', 'de', 'pt_BR', 'ja', 'ko'])
  };

  const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  // Must match background.js baseDomain rules so allowlist checks align.
  const TWO_PART_TLDS = new Set([
    'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'co.jp', 'co.kr', 'com.au', 'net.au',
    'com.br', 'com.cn', 'com.mx', 'co.in', 'co.nz', 'co.za', 'com.tr', 'com.sg'
  ]);
  const HOST_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

  function baseDomain(host) {
    if (!host) return '';
    const parts = host.split('.');
    if (parts.length <= 2) return host;
    const lastTwo = parts.slice(-2).join('.');
    if (TWO_PART_TLDS.has(lastTwo)) return parts.slice(-3).join('.');
    return lastTwo;
  }

  /** Normalize a user-entered host/URL to the base domain Auto-Clean compares against. */
  function normalizeAllowlistEntry(raw) {
    if (typeof raw !== 'string') return '';
    let s = raw.trim().toLowerCase();
    if (!s) return '';

    // Accept bare hosts, URLs, or host/path pastes.
    if (s.indexOf('://') === -1 && (s.indexOf('/') !== -1 || s.indexOf('?') !== -1 || s.indexOf('#') !== -1)) {
      s = 'https://' + s;
    }
    if (s.indexOf('://') !== -1) {
      try {
        s = new URL(s).hostname;
      } catch (_) {
        return '';
      }
    } else {
      // Strip accidental path/query if pasted without scheme.
      s = s.split('/')[0].split('?')[0].split('#')[0];
    }

    s = s.replace(/^\.+/, '').replace(/\.+$/, '');
    if (!s || s.indexOf('.') === -1) return '';
    if (s.indexOf('..') !== -1) return '';
    if (s.indexOf(':') !== -1) return ''; // reject host:port / IPv6

    const labels = s.split('.');
    for (let i = 0; i < labels.length; i++) {
      if (!HOST_LABEL_RE.test(labels[i])) return '';
    }

    return baseDomain(s);
  }

  function sanitizeAllowlist(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = Object.create(null);
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const d = normalizeAllowlistEntry(raw[i]);
      if (!d || seen[d]) continue;
      seen[d] = true;
      out.push(d);
    }
    return out;
  }

  function sanitizeCustomTheme(raw) {
    const out = { ...DEFAULT_CUSTOM_THEME };
    if (!raw || typeof raw !== 'object') return out;
    CUSTOM_THEME_KEYS.forEach(function (k) {
      if (typeof raw[k] === 'string' && HEX_RE.test(raw[k])) out[k] = raw[k];
    });
    return out;
  }

  function mergeWithDefaults(raw) {
    const out = { ...DEFAULTS };
    if (!raw || typeof raw !== 'object') return out;

    if (VALID.theme.has(raw.theme)) out.theme = raw.theme;
    if (VALID.language.has(raw.language)) out.language = raw.language;
    if (VALID.defaultTab.has(raw.defaultTab)) out.defaultTab = raw.defaultTab;
    if (typeof raw.thirdPartyNotifications === 'boolean') {
      out.thirdPartyNotifications = raw.thirdPartyNotifications;
    }
    if (typeof raw.ipLookupEnabled === 'boolean') {
      out.ipLookupEnabled = raw.ipLookupEnabled;
    }
    if (typeof raw.myIpLookupEnabled === 'boolean') {
      out.myIpLookupEnabled = raw.myIpLookupEnabled;
    }
    if (typeof raw.networkMonitoring === 'boolean') {
      out.networkMonitoring = raw.networkMonitoring;
    }
    if (typeof raw.animations === 'boolean') {
      out.animations = raw.animations;
    }
    if (VALID.backgroundAnim.has(raw.backgroundAnim)) {
      out.backgroundAnim = raw.backgroundAnim;
    }
    out.customTheme = sanitizeCustomTheme(raw.customTheme);
    if (typeof raw.bannerAutoHide === 'boolean') {
      out.bannerAutoHide = raw.bannerAutoHide;
    }
    if (typeof raw.trackerBadge === 'boolean') {
      out.trackerBadge = raw.trackerBadge;
    }
    if (typeof raw.autoClean === 'boolean') {
      out.autoClean = raw.autoClean;
    }
    if (Array.isArray(raw.autoCleanAllowlist)) {
      out.autoCleanAllowlist = sanitizeAllowlist(raw.autoCleanAllowlist);
    }
    if (typeof raw.weeklyDigestEnabled === 'boolean') {
      out.weeklyDigestEnabled = raw.weeklyDigestEnabled;
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
    CUSTOM_THEME_KEYS,
    DEFAULT_CUSTOM_THEME,
    sanitizeCustomTheme,
    normalizeAllowlistEntry,
    sanitizeAllowlist,
    mergeWithDefaults,
    load,
    save
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
