/* P.I.E content script — cookie-consent detection only.
 *
 * Privacy note: this script does NOT read or forward the page's fetch traffic,
 * form fields, storage, or cookie values. It only looks for a consent banner and
 * tells the extension one bit of information ("a banner exists" / "user accepted"),
 * via chrome.runtime messaging to the extension itself — never window.postMessage.
 *
 * (Replaces the previous version, which wrapped window.fetch and captured form
 * submissions, then broadcast the URLs, request bodies, and form fields to the
 * whole page via postMessage(..., '*') — readable by any script on the page.
 * That data was never consumed anywhere, so removing it loses no functionality.) */

(function () {
  'use strict';

  const KEYWORDS = ['cookie', 'consent', 'gdpr', 'privacy'];

  // Common Consent Management Platform containers — cheap, targeted lookups
  // instead of scanning every element's text on every DOM mutation.
  const CMP_SELECTORS = [
    '#onetrust-banner-sdk', '#onetrust-consent-sdk', '#CybotCookiebotDialog',
    '#cookie-banner', '#cookieBanner', '#cookie-consent', '#cookieConsent',
    '#cookie-law-info-bar', '#gdpr-cookie-message', '#truste-consent-track',
    '.cc-window', '.cookie-consent', '.cookie-banner', '.cmp-container',
    '.qc-cmp2-container', '[aria-label*="cookie" i]', '[data-testid*="cookie" i]'
  ];

  let observer = null;
  let detected = false;
  let acceptedSent = false;
  let scheduled = false;

  function attrHaystack(el) {
    let cls = '';
    if (el.className) cls = typeof el.className === 'string' ? el.className : (el.className.baseVal || '');
    const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
    return ((el.id || '') + ' ' + cls + ' ' + aria).toLowerCase();
  }

  function detectConsent() {
    for (const sel of CMP_SELECTORS) {
      try { if (document.querySelector(sel)) return true; } catch (_) {}
    }
    // Bounded scan: only dialog/overlay-ish or cookie-tagged elements, and match
    // on attributes (id/class/aria) — not the full text of every node.
    let candidates;
    try {
      candidates = document.querySelectorAll(
        '[role="dialog"],[aria-modal="true"],dialog,[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i]'
      );
    } catch (_) { return false; }
    for (const el of candidates) {
      const hay = attrHaystack(el);
      if (KEYWORDS.some(k => hay.includes(k))) return true;
    }
    return false;
  }

  function signalDetected() {
    if (detected) return;
    if (detectConsent()) {
      detected = true;
      try { chrome.runtime.sendMessage({ type: 'COOKIE_CONSENT_DETECTED' }); } catch (_) {}
      if (observer) observer.disconnect();
    }
  }

  function scheduleScan() {
    if (detected || scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; signalDetected(); }, 400);
  }

  function start() {
    signalDetected();
    if (!detected && document.body) {
      observer = new MutationObserver(scheduleScan);
      observer.observe(document.body, { childList: true, subtree: true });
      // Stop watching after a while so we never scan indefinitely.
      setTimeout(() => { if (observer) observer.disconnect(); }, 15000);
    }
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);

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
