/* P.I.E content script — cookie-consent detection + optional best-effort hide.
 *
 * Privacy note: this script does NOT read or forward the page's fetch traffic,
 * form fields, storage, or cookie values. It only looks for a consent banner and
 * tells the extension one bit of information ("a banner exists" / "user accepted"),
 * via chrome.runtime messaging to the extension itself — never window.postMessage.
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
})();
