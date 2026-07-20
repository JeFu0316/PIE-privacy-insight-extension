importScripts('settings.js', 'tracker-domains.js');

let bgSettings = PIE_SETTINGS.DEFAULTS;

async function refreshSettings() {
  bgSettings = await PIE_SETTINGS.load();
}

refreshSettings();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[PIE_SETTINGS.STORAGE_KEY]) {
    bgSettings = PIE_SETTINGS.mergeWithDefaults(changes[PIE_SETTINGS.STORAGE_KEY].newValue);
  }
});

/* ---------- HTTPS badge ---------- */
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url) {
    const isSecure = tab.url.startsWith('https://');
    chrome.action.setBadgeText({ tabId, text: isSecure ? '✔' : '!' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: isSecure ? 'green' : 'red' });
    chrome.runtime.sendMessage({ type: 'SECURITY_CHECK', secure: isSecure }).catch(() => {});
  }
});

/* ---------- Third-party cookie detection + notification ---------- */
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    try {
      const initiator = details.initiator || details.originUrl || '';
      if (!initiator) return;

      const pageDomain = new URL(initiator).hostname;
      const cookieDomain = new URL(details.url).hostname;

      if (pageDomain && cookieDomain && !cookieDomain.endsWith(pageDomain)) {
        chrome.runtime.sendMessage({
          type: 'THIRD_PARTY_COOKIE',
          domain: cookieDomain,
          from: pageDomain
        }).catch(() => {});

        if (bgSettings.thirdPartyNotifications) {
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'pie128.png',
            title: 'Privacy Alert – Third-Party Cookies',
            message: `The site ${pageDomain} is loading cookies from ${cookieDomain}. These may track you across websites.`
          });
        }
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
      if (!bgSettings.networkMonitoring) return;
      const tabId = details.tabId;
      if (tabId == null || tabId < 0) return;   // ignore non-tab requests

      if (details.type === 'main_frame') {
        // New top-level navigation: reset this tab's log.
        tabHost.set(tabId, hostOf(details.url));
        netLog.set(tabId, []);
      }

      const reqHost = hostOf(details.url);
      const topHost = tabHost.get(tabId) || hostOf(details.initiator || '');
      const thirdParty = !!(topHost && reqHost && baseDomain(reqHost) !== baseDomain(topHost));
      const tracker = (typeof PIE_TRACKERS !== 'undefined' && thirdParty) ? PIE_TRACKERS.lookup(reqHost) : null;

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
    const e = pending.get(details.requestId);
    if (e) { e.status = 'blocked'; pending.delete(details.requestId); }
  },
  { urls: ['<all_urls>'] }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  netLog.delete(tabId);
  tabHost.delete(tabId);
});

/* ---------- Popup requests the current tab's network log ---------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'GET_NETWORK_LOG') {
    const tabId = msg.tabId;
    const entries = (tabId != null && netLog.has(tabId)) ? netLog.get(tabId) : [];
    sendResponse({ entries: entries, monitoring: !!bgSettings.networkMonitoring });
  }
});
