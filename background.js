importScripts('settings.js', 'i18n.js', 'tracker-domains.js', 'digest.js', 'block-stats.js');

let bgSettings = PIE_SETTINGS.DEFAULTS;

async function refreshSettings() {
  bgSettings = await PIE_SETTINGS.load();
  PIE_I18N.setLocale(bgSettings.language);
}

// Initial load — settings must resolve first; DNR rules are applied after the
// function is defined (see applyDnrRules definition below).
const _settingsReady = refreshSettings();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[PIE_SETTINGS.STORAGE_KEY]) {
    const wasOn = bgSettings.thirdPartyNotifications;
    const wasBlocking = bgSettings.trackerBlock;
    bgSettings = PIE_SETTINGS.mergeWithDefaults(changes[PIE_SETTINGS.STORAGE_KEY].newValue);
    // Keep notification wording in sync with the chosen language.
    PIE_I18N.setLocale(bgSettings.language);
    // If the user just turned notifications off, clear any that are still showing.
    if (wasOn && !bgSettings.thirdPartyNotifications) clearAllNotifications();
    // Refresh badges so a toggled trackerBadge setting takes effect immediately.
    refreshAllBadges();
    // Re-apply DNR rules when trackerBlock setting changes.
    if (wasBlocking !== bgSettings.trackerBlock) applyDnrRules();
  }
});

/* ---------- Declarative Net Request — tracker blocking (Phase 4) ----------
 * Opt-in only (trackerBlock default false). Builds dynamic DNR rules from the
 * PIE_TRACKERS domain list, targeting third-party requests only. Rules are
 * replaced atomically; cleared when the feature is disabled.
 *
 * We do NOT use onRuleMatchedDebug (CWS-limited). Instead, blocked requests
 * surface via webRequest.onErrorOccurred with error net::ERR_BLOCKED_BY_CLIENT,
 * which is caught below to increment block-stats counters. */

const DNR_RULE_ID_BASE = 10000;
const DNR_RESOURCE_TYPES = [
  'script', 'xmlhttprequest', 'image', 'sub_frame',
  'ping', 'media', 'websocket', 'font', 'other'
];

async function applyDnrRules() {
  if (typeof PIE_TRACKERS === 'undefined') return;
  const enabled = bgSettings.trackerBlock;
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existing.map((r) => r.id);

  if (!enabled) {
    if (removeIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds });
    }
    return;
  }

  // Build one DNR rule per known tracker domain, third-party only.
  const domains = Object.keys(PIE_TRACKERS.DOMAINS);
  const addRules = domains.map((domain, i) => ({
    id: DNR_RULE_ID_BASE + i,
    priority: 1,
    action: { type: 'block' },
    condition: {
      requestDomains: [domain],
      domainType: 'thirdParty',
      resourceTypes: DNR_RESOURCE_TYPES
    }
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: removeIds,
    addRules: addRules
  });
}

// Apply rules on startup once settings + function are both ready.
_settingsReady.then(() => applyDnrRules()).catch(() => {});

// Count ERR_BLOCKED_BY_CLIENT events for known tracker hosts.
// These fire for requests blocked by DNR as well as other mechanisms.
const BLOCKED_ERRORS = new Set([
  'net::ERR_BLOCKED_BY_CLIENT',
  'net::ERR_BLOCKED_BY_ADMINISTRATOR',
  'net::ERR_BLOCKED_BY_RESPONSE'
]);

/* ---------- Toolbar badge = known-tracker count on the current tab ----------
 * The badge shows how many distinct known-tracker hosts a tab has contacted, so
 * there's always-visible value without opening the popup. HTTPS status still
 * reaches the popup via the SECURITY_CHECK message and its own site bar. */

const tabTrackers = new Map();   // tabId -> Set<host> of known-tracker hosts seen

function updateBadge(tabId) {
  if (tabId == null || tabId < 0) return;
  const n = bgSettings.trackerBadge ? (tabTrackers.get(tabId) || EMPTY_SET).size : 0;
  try {
    chrome.action.setBadgeText({ tabId: tabId, text: n > 0 ? String(n) : '' });
    if (n > 0) {
      chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: n >= 5 ? '#C4494C' : '#E8A13B' });
    }
  } catch (_) {}
}

const EMPTY_SET = new Set();

function refreshAllBadges() {
  try {
    chrome.tabs.query({}, (tabs) => {
      for (const t of (tabs || [])) if (t.id != null) updateBadge(t.id);
    });
  } catch (_) {}
}

/* ---------- Per-navigation notification reset ---------- */
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // A new URL means a new page: clear this tab's third-party alert state so the
  // (single) summary notification starts fresh instead of carrying over.
  if (info.url) {
    clearTabNotification(tabId);
    // Reset per-tab block counter for the new page.
    if (typeof PIE_BLOCK_STATS !== 'undefined') PIE_BLOCK_STATS.resetTab(tabId);
  }

  if (info.status === 'complete' && tab.url) {
    const isSecure = tab.url.startsWith('https://');
    chrome.runtime.sendMessage({ type: 'SECURITY_CHECK', secure: isSecure }).catch(() => {});
  }
});

/* ---------- Third-party cookie detection + notification ----------
 * Anti-spam design: we notify only for responses that actually set a cookie, and
 * at most ONE desktop notification per tab per page load. As more distinct
 * third-party cookie domains appear, that single notification is updated in place
 * (never re-popped). State resets on navigation and clears when the tab closes. */

// tabId -> { domains: Set<string>, notifId: string|null }
const thirdPartyNotify = new Map();

function clearTabNotification(tabId) {
  const st = thirdPartyNotify.get(tabId);
  if (st && st.notifId) { try { chrome.notifications.clear(st.notifId); } catch (_) {} }
  thirdPartyNotify.delete(tabId);
}

function clearAllNotifications() {
  for (const st of thirdPartyNotify.values()) {
    if (st && st.notifId) { try { chrome.notifications.clear(st.notifId); } catch (_) {} }
  }
  thirdPartyNotify.clear();
}

function responseSetsCookie(headers) {
  if (!Array.isArray(headers)) return false;
  for (const h of headers) {
    if (h && h.name && h.name.toLowerCase() === 'set-cookie') return true;
  }
  return false;
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    try {
      const initiator = details.initiator || details.originUrl || '';
      if (!initiator) return;

      const pageDomain = new URL(initiator).hostname;
      const cookieDomain = new URL(details.url).hostname;
      if (!pageDomain || !cookieDomain || cookieDomain.endsWith(pageDomain)) return;

      // Only a response that actually SETS a cookie counts as a third-party cookie.
      if (!responseSetsCookie(details.responseHeaders)) return;

      chrome.runtime.sendMessage({
        type: 'THIRD_PARTY_COOKIE',
        domain: cookieDomain,
        from: pageDomain
      }).catch(() => {});

      if (!bgSettings.thirdPartyNotifications) return;
      const tabId = details.tabId;
      if (tabId == null || tabId < 0) return;   // ignore non-tab (background) requests

      let st = thirdPartyNotify.get(tabId);
      if (!st) { st = { domains: new Set(), notifId: null }; thirdPartyNotify.set(tabId, st); }
      if (st.domains.has(cookieDomain)) return;  // already counted — no new alert
      st.domains.add(cookieDomain);

      const count = st.domains.size;
      const message = count === 1
        ? PIE_I18N.t('notif.one', { domain: cookieDomain, page: pageDomain })
        : PIE_I18N.t('notif.many', { count: count, page: pageDomain });

      if (!st.notifId) {
        // First one this page: create a single notification (one desktop pop).
        st.notifId = 'pie-3p-' + tabId + '-' + Date.now();
        chrome.notifications.create(st.notifId, {
          type: 'basic',
          iconUrl: 'toolingo128.png',
          title: PIE_I18N.t('notif.title'),
          message: message,
          priority: 0
        });
      } else {
        // Subsequent domains: update the existing notification quietly, no new pop.
        chrome.notifications.update(st.notifId, { message: message });
      }
    } catch (e) {}
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

/* ---------- Network activity capture (observational, metadata only) ----------
 * Per-tab bounded log of requests. We record method, host, path (no query
 * string), resource type, status, timing, first/third-party, and a known-tracker
 * match. We never capture request bodies or response contents, and nothing is
 * sent off the device — the popup reads this over chrome.runtime messaging. */

const MAX_PER_TAB = 200;
const netLog = new Map();   // tabId -> [entry, ...] (newest last)
const pending = new Map();  // requestId -> entry (to fill in the status later)
const tabHost = new Map();  // tabId -> top-frame hostname

const TWO_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'co.jp', 'co.kr', 'com.au', 'net.au',
  'com.br', 'com.cn', 'com.mx', 'co.in', 'co.nz', 'co.za', 'com.tr', 'com.sg'
]);

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; }
}

function pathOf(url) {
  try {
    const p = new URL(url).pathname || '/';
    return p.length > 80 ? p.slice(0, 80) + '…' : p;
  } catch (_) { return ''; }
}

function baseDomain(host) {
  if (!host) return '';
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (TWO_PART_TLDS.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

function pushEntry(tabId, entry) {
  let arr = netLog.get(tabId);
  if (!arr) { arr = []; netLog.set(tabId, arr); }
  arr.push(entry);
  if (arr.length > MAX_PER_TAB) {
    const dropped = arr.shift();
    if (dropped) pending.delete(dropped.id);
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    try {
      const tabId = details.tabId;
      if (tabId == null || tabId < 0) return;   // ignore non-tab requests

      if (details.type === 'main_frame') {
        // New top-level navigation: reset this tab's log + tracker/badge state.
        tabHost.set(tabId, hostOf(details.url));
        netLog.set(tabId, []);
        tabTrackers.set(tabId, new Set());
        updateBadge(tabId);
      }

      const reqHost = hostOf(details.url);
      const topHost = tabHost.get(tabId) || hostOf(details.initiator || '');
      const thirdParty = !!(topHost && reqHost && baseDomain(reqHost) !== baseDomain(topHost));
      const tracker = (typeof PIE_TRACKERS !== 'undefined' && thirdParty) ? PIE_TRACKERS.lookup(reqHost) : null;

      // Badge counting runs regardless of the network-monitoring setting.
      if (tracker && reqHost) {
        let ts = tabTrackers.get(tabId);
        if (!ts) { ts = new Set(); tabTrackers.set(tabId, ts); }
        if (!ts.has(reqHost)) {
          ts.add(reqHost);
          updateBadge(tabId);
          if (bgSettings.weeklyDigestEnabled && typeof PIE_DIGEST !== 'undefined') {
            try { PIE_DIGEST.recordTracker(reqHost); } catch (_) {}
          }
        }
      }

      if (!bgSettings.networkMonitoring) return;   // network log is gated; badge is not

      const entry = {
        id: details.requestId,
        method: details.method || 'GET',
        host: reqHost,
        path: pathOf(details.url),
        type: details.type || 'other',
        status: null,
        thirdParty: thirdParty,
        tracker: tracker,   // { company, category } | null
        ts: details.timeStamp || Date.now()
      };
      pushEntry(tabId, entry);
      pending.set(details.requestId, entry);
    } catch (e) {}
  },
  { urls: ['<all_urls>'] }
  // note: no 'requestBody' extraInfoSpec — request bodies are deliberately NOT captured
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const e = pending.get(details.requestId);
    if (e) { e.status = details.statusCode; pending.delete(details.requestId); }
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    // The request failed or was cancelled. Label as 'failed' in the net log.
    const e = pending.get(details.requestId);
    if (e) { e.status = 'failed'; pending.delete(details.requestId); }

    // When our DNR rules are active, blocked tracker requests surface here with
    // ERR_BLOCKED_BY_CLIENT. Count them for the block-stats display.
    if (bgSettings.trackerBlock && BLOCKED_ERRORS.has(details.error)) {
      try {
        const reqHost = hostOf(details.url);
        const topHost = tabHost.get(details.tabId) || '';
        const isThird = !!(topHost && reqHost && baseDomain(reqHost) !== baseDomain(topHost));
        if (isThird && typeof PIE_TRACKERS !== 'undefined' && PIE_TRACKERS.lookup(reqHost)) {
          const tabId = details.tabId;
          if (typeof PIE_BLOCK_STATS !== 'undefined') {
            PIE_BLOCK_STATS.recordBlock(tabId >= 0 ? tabId : undefined);
          }
        }
      } catch (_) {}
    }
  },
  { urls: ['<all_urls>'] }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  netLog.delete(tabId);
  tabHost.delete(tabId);
  tabTrackers.delete(tabId);
  clearTabNotification(tabId);
  if (typeof PIE_BLOCK_STATS !== 'undefined') PIE_BLOCK_STATS.removeTab(tabId);
  if (bgSettings.autoClean) scheduleAutoClean();
});

/* ---------- Cookie Auto-Clean (opt-in) ----------
 * When enabled, P.I.E removes cookies that belong to KNOWN tracker/advertising
 * domains (never first-party login cookies), so tracking cookies don't linger.
 * Consent-management cookies are left alone so banners don't keep reappearing.
 * A base domain listed in autoCleanAllowlist is never touched. Runs debounced on
 * tab close, or on demand from the popup. All local — no data leaves the device. */

const CLEAN_DEBOUNCE_MS = 4000;
const CLEAN_SKIP_CATEGORIES = new Set(['Consent']);
let cleanTimer = null;

function scheduleAutoClean() {
  if (cleanTimer) return;
  cleanTimer = setTimeout(() => { cleanTimer = null; sweepTrackerCookies(); }, CLEAN_DEBOUNCE_MS);
}

function buildCookieUrl(c) {
  const host = (c.domain || '').replace(/^\./, '');
  return (c.secure ? 'https' : 'http') + '://' + host + (c.path || '/');
}

async function sweepTrackerCookies() {
  if (typeof PIE_TRACKERS === 'undefined') return 0;
  const allowlist = bgSettings.autoCleanAllowlist || [];
  let removed = 0;
  try {
    const all = await chrome.cookies.getAll({});
    for (const c of all) {
      const host = (c.domain || '').replace(/^\./, '').toLowerCase();
      if (!host) continue;
      if (allowlist.indexOf(baseDomain(host)) !== -1) continue;
      const rec = PIE_TRACKERS.lookup(host);
      if (!rec || CLEAN_SKIP_CATEGORIES.has(rec.category)) continue;
      try {
        await chrome.cookies.remove({ url: buildCookieUrl(c), name: c.name });
        removed++;
      } catch (_) {}
    }
  } catch (_) {}
  if (removed > 0 && bgSettings.weeklyDigestEnabled && typeof PIE_DIGEST !== 'undefined') {
    try { PIE_DIGEST.recordCleaned(removed); } catch (_) {}
  }
  return removed;
}

/* ---------- Popup messages ---------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'GET_NETWORK_LOG') {
    const tabId = msg.tabId;
    const entries = (tabId != null && netLog.has(tabId)) ? netLog.get(tabId) : [];
    sendResponse({ entries: entries, monitoring: !!bgSettings.networkMonitoring });
    return; // synchronous response
  }
  if (msg && msg.type === 'CLEAN_TRACKER_COOKIES') {
    sweepTrackerCookies().then((removed) => sendResponse({ removed: removed }));
    return true; // async response
  }
  if (msg && msg.type === 'GET_BLOCK_STATS') {
    const tabId = msg.tabId;
    const domainsConnected = (tabId != null && tabTrackers.has(tabId))
      ? tabTrackers.get(tabId).size : 0;
    if (typeof PIE_BLOCK_STATS !== 'undefined') {
      PIE_BLOCK_STATS.getStats(tabId).then((stats) => {
        sendResponse({
          enabled: !!bgSettings.trackerBlock,
          pageBlocked: stats.pageBlocked,
          lifetimeBlocked: stats.lifetimeBlocked,
          domainsConnected: domainsConnected
        });
      });
      return true; // async
    }
    sendResponse({ enabled: false, pageBlocked: 0, lifetimeBlocked: 0, domainsConnected: domainsConnected });
    return;
  }
});
