/* P.I.E content script — cookie-consent detection, optional best-effort hide,
 * and fingerprint signal counting (Phase 5).
 *
 * Privacy note: this script does NOT read or forward the page's fetch traffic,
 * form fields, storage, or cookie values. It only looks for a consent banner and
 * tells the extension one bit of information ("a banner exists" / "user accepted"),
 * via chrome.runtime messaging to the extension itself — never window.postMessage
 * except for the fingerprint counter which postMessages only aggregate counts,
 * never any canvas pixel data or audio buffers.
 *
 * Best-effort auto-hide (opt-in, off by default): when the user enables it in
 * settings, detected consent banners are hidden with CSS. This is cosmetic only —
 * it does NOT click "reject" or change the site's actual consent state, and it may
 * occasionally hide the wrong element or miss a banner. It never runs unless the
 * user turns it on. */

(function () {
  'use strict';

  const STORAGE_KEY = 'pie_settings';
  const KEYWORDS = ['cookie', 'consent', 'gdpr', 'privacy'];

  // Broad detection set — used only to REPORT that a banner exists.
  const CMP_SELECTORS = [
    '#onetrust-banner-sdk', '#onetrust-consent-sdk', '#CybotCookiebotDialog',
    '#cookie-banner', '#cookieBanner', '#cookie-consent', '#cookieConsent',
    '#cookie-law-info-bar', '#gdpr-cookie-message', '#truste-consent-track',
    '.cc-window', '.cookie-consent', '.cookie-banner', '.cmp-container',
    '.qc-cmp2-container', '[aria-label*="cookie" i]', '[data-testid*="cookie" i]'
  ];

  // Narrower, well-known CMP containers — safe enough to hide via a CSS rule.
  // Excludes the broad attribute selectors above to limit collateral hiding.
  const CMP_HIDE_SELECTORS = [
    '#onetrust-banner-sdk', '#onetrust-consent-sdk', '#CybotCookiebotDialog',
    '#cookie-banner', '#cookieBanner', '#cookie-consent', '#cookieConsent',
    '#cookie-law-info-bar', '#gdpr-cookie-message', '#truste-consent-track',
    '.cc-window', '.cookie-consent', '.cookie-banner', '.cmp-container',
    '.qc-cmp2-container'
  ];

  let observer = null;
  let signaled = false;      // COOKIE_CONSENT_DETECTED sent at most once
  let scheduled = false;
  let acceptedSent = false;
  let autoHide = false;
  let styleInjected = false;
  const hiddenEls = [];      // elements we hid inline, for live un-hide

  function attrHaystack(el) {
    let cls = '';
    if (el.className) cls = typeof el.className === 'string' ? el.className : (el.className.baseVal || '');
    const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
    return ((el.id || '') + ' ' + cls + ' ' + aria).toLowerCase();
  }

  // Returns the consent element if one is present, else null.
  function findConsentEl() {
    for (const sel of CMP_SELECTORS) {
      try { const e = document.querySelector(sel); if (e) return e; } catch (_) {}
    }
    let candidates;
    try {
      candidates = document.querySelectorAll(
        '[role="dialog"],[aria-modal="true"],dialog,[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i]'
      );
    } catch (_) { return null; }
    for (const el of candidates) {
      const hay = attrHaystack(el);
      if (KEYWORDS.some(k => hay.includes(k))) return el;
    }
    return null;
  }

  function injectHideStyle() {
    if (styleInjected) return;
    styleInjected = true;
    try {
      const style = document.createElement('style');
      style.id = 'pie-banner-hide';
      style.textContent = CMP_HIDE_SELECTORS.join(',') + '{display:none !important;}';
      (document.head || document.documentElement).appendChild(style);
    } catch (_) { styleInjected = false; }
  }

  function removeHideStyle() {
    try {
      const s = document.getElementById('pie-banner-hide');
      if (s) s.remove();
    } catch (_) {}
    styleInjected = false;
  }

  // Many CMPs lock scrolling while the banner is up; undo that if we hid one.
  function restoreScroll() {
    try {
      for (const el of [document.documentElement, document.body]) {
        if (!el) continue;
        const cs = getComputedStyle(el);
        if (cs.overflow === 'hidden') el.style.setProperty('overflow', 'auto', 'important');
        if (cs.position === 'fixed') el.style.setProperty('position', 'static', 'important');
      }
    } catch (_) {}
  }

  function hideEl(el) {
    if (!el || hiddenEls.indexOf(el) !== -1) return;
    try {
      el.style.setProperty('display', 'none', 'important');
      hiddenEls.push(el);
      restoreScroll();
    } catch (_) {}
  }

  function unhideAll() {
    removeHideStyle();
    for (const el of hiddenEls) {
      try { el.style.removeProperty('display'); } catch (_) {}
    }
    hiddenEls.length = 0;
  }

  function scan() {
    const el = findConsentEl();
    if (!el) return;
    if (!signaled) {
      signaled = true;
      try { chrome.runtime.sendMessage({ type: 'COOKIE_CONSENT_DETECTED' }); } catch (_) {}
    }
    if (autoHide) hideEl(el);
    // If we're not hiding, one detection is enough — stop observing.
    if (!autoHide && observer) observer.disconnect();
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; scan(); }, 400);
  }

  function start() {
    if (autoHide) injectHideStyle();
    scan();
    if (document.body) {
      observer = new MutationObserver(scheduleScan);
      observer.observe(document.body, { childList: true, subtree: true });
      // Never scan indefinitely.
      setTimeout(() => { if (observer) observer.disconnect(); }, 15000);
    }
  }

  function begin() {
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }

  // Load the user's preference, then begin. Content scripts can read chrome.storage
  // directly (the "storage" permission is declared).
  try {
    chrome.storage.sync.get(STORAGE_KEY, (data) => {
      const s = (data && data[STORAGE_KEY]) || {};
      autoHide = s.bannerAutoHide === true;
      begin();
    });
  } catch (_) {
    begin();
  }

  // React to the setting being toggled while the page is open.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes[STORAGE_KEY]) return;
      const s = changes[STORAGE_KEY].newValue || {};
      const now = s.bannerAutoHide === true;
      if (now === autoHide) return;
      autoHide = now;
      if (autoHide) { injectHideStyle(); scan(); }
      else { unhideAll(); }
    });
  } catch (_) {}

  // When the user accepts cookies, ask the popup to re-scan. Scoped to button-like
  // targets with a short accept-ish label, and sent at most once.
  document.addEventListener('click', (e) => {
    if (acceptedSent) return;
    const t = e.target;
    const btn = t && t.closest ? t.closest('button, a, [role="button"], input[type="submit"]') : null;
    if (!btn) return;
    const label = ((btn.textContent || btn.value || '').trim()).toLowerCase();
    if (label && label.length <= 40 && /\b(accept|agree|allow|got it|ok)\b/.test(label)) {
      acceptedSent = true;
      setTimeout(() => {
        try { chrome.runtime.sendMessage({ type: 'COOKIE_ACCEPTED' }); } catch (_) {}
      }, 1500);
    }
  }, true);

  /* ---- Phase 5: Fingerprint signal detection --------------------------------
   * We inject a tiny MAIN-world script (via a <script> element) that wraps the
   * canvas and audio fingerprinting APIs. The injected script posts only
   * aggregate counts — never raw pixel data or audio buffers — back here via
   * window.postMessage with source: 'toolingo-fp'. This content script then
   * answers the popup's GET_FINGERPRINT_STATS message with the counts.
   *
   * Shield mode (opt-in, off by default) adds tiny noise to canvas readback to
   * degrade fingerprint accuracy; documented as best-effort. */

  let fpSettings = {
    detect: true,   // default — overridden by storage read below
    shield: false
  };
  const fpCounts = { canvas: 0, audio: 0 };

  function injectFpWatcher(shield) {
    try {
      const s = document.createElement('script');
      // All logic runs in MAIN world to access the page's prototype chain.
      s.textContent = (function (shieldMode) {
        if (window.__toolingo_fp_injected) return;
        window.__toolingo_fp_injected = true;
        let canvasCount = 0, audioCount = 0;

        function post(type) {
          window.postMessage({ source: 'toolingo-fp', type: type, c: canvasCount, a: audioCount }, '*');
        }

        // --- Canvas ---
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function () {
          canvasCount++;
          if (shieldMode) {
            // Add invisible 1-pixel noise to the canvas before reading.
            try {
              const ctx = this.getContext('2d');
              if (ctx) {
                const id = ctx.getImageData(0, 0, 1, 1);
                id.data[0] ^= (Math.random() * 4 | 0);
                ctx.putImageData(id, 0, 0);
              }
            } catch (_) {}
          }
          post('canvas');
          return origToDataURL.apply(this, arguments);
        };

        const origToBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function () {
          canvasCount++;
          post('canvas');
          return origToBlob.apply(this, arguments);
        };

        const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = function () {
          canvasCount++;
          if (shieldMode) {
            // Apply noise after data is captured (we can't mutate here without
            // affecting the site's actual render, so only post the signal).
          }
          post('canvas');
          return origGetImageData.apply(this, arguments);
        };

        // --- AudioContext ---
        function patchAudioContext(ctor) {
          if (!ctor || !ctor.prototype) return;
          const origDecodeAudio = ctor.prototype.decodeAudioData;
          if (origDecodeAudio) {
            ctor.prototype.decodeAudioData = function () {
              audioCount++;
              post('audio');
              return origDecodeAudio.apply(this, arguments);
            };
          }
        }
        try { patchAudioContext(AudioContext); } catch (_) {}
        try { patchAudioContext(OfflineAudioContext); } catch (_) {}
      }).toString().replace(/^function[^{]*\{/, '').replace(/}$/, '').replace('shieldMode', shield ? 'true' : 'false');
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (_) {}
  }

  function startFpDetection() {
    if (!fpSettings.detect) return;
    injectFpWatcher(fpSettings.shield);

    window.addEventListener('message', (event) => {
      if (!event.data || event.data.source !== 'toolingo-fp') return;
      // Accept only numeric counts — no data from outside.
      fpCounts.canvas = (typeof event.data.c === 'number') ? event.data.c : fpCounts.canvas;
      fpCounts.audio = (typeof event.data.a === 'number') ? event.data.a : fpCounts.audio;
    });
  }

  // Read settings then start detection.
  try {
    chrome.storage.sync.get(STORAGE_KEY, (data) => {
      const s = (data && data[STORAGE_KEY]) || {};
      fpSettings.detect = s.fingerprintDetect !== false; // default true
      fpSettings.shield = s.fingerprintShield === true;
      startFpDetection();
    });
  } catch (_) {
    startFpDetection();
  }

  // React to settings changes while the page is open.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes[STORAGE_KEY]) return;
      const s = changes[STORAGE_KEY].newValue || {};
      fpSettings.detect = s.fingerprintDetect !== false;
      fpSettings.shield = s.fingerprintShield === true;
    });
  } catch (_) {}

  // Answer popup requests for fingerprint stats.
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'GET_FINGERPRINT_STATS') {
        sendResponse({
          canvas: fpCounts.canvas,
          audio: fpCounts.audio,
          shielded: fpSettings.shield && fpSettings.detect
        });
        return true;
      }
    });
  } catch (_) {}
})();
