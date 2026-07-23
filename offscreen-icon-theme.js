/*
 * Offscreen page — watches prefers-color-scheme so the service worker can
 * swap toolbar icons (Chrome has no toolbar-color API for extensions).
 */
(function () {
  'use strict';

  function scheme() {
    try {
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (_) {
      return 'light';
    }
  }

  function notify() {
    try {
      chrome.runtime.sendMessage({ type: 'ICON_COLOR_SCHEME', scheme: scheme() });
    } catch (_) {}
  }

  notify();
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', notify);
  } catch (_) {
    try {
      matchMedia('(prefers-color-scheme: dark)').addListener(notify);
    } catch (_) {}
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'GET_COLOR_SCHEME') {
      sendResponse({ scheme: scheme() });
      return;
    }
  });
})();
