/*
 * Toolingo clean-urls.js — on-device tracking-parameter removal.
 *
 * Inspired by the ClearURLs project; this is a hand-curated, bundled subset
 * (not the full remote ruleset). All processing is on-device — no network calls.
 *
 * Exports PIE_CLEAN_URLS to window / globalThis (shared by popup and tests).
 */
(function (root) {
  'use strict';

  // Exact parameter names to strip.
  const EXACT = new Set([
    // UTM (Google Analytics / general)
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
    // Google Ads
    'gclid', 'gclsrc', 'gbraid', 'wbraid', 'dclid',
    // Meta / Facebook
    'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_source', 'fb_ref',
    // Microsoft / Bing
    'msclkid',
    // Mailchimp
    'mc_eid', 'mc_cid',
    // HubSpot
    '_hsenc', '_hsmi',
    // Marketo
    'mkt_tok',
    // Yahoo
    'yclid',
    // Twitter / X
    'twclid',
    // LinkedIn
    'li_fat_id',
    // TikTok
    'ttclid',
    // Pinterest
    'epik',
    // Snapchat
    'ScCid',
    // GA4 / cross-network
    '_ga', '_gl',
    // Outbrain
    'obOrigUrl',
    // Taboola
    'tblci',
    // Generic ref / source hints
    'ref', 'referrer', 'source', 'affiliate', 'affiliate_id',
    // Iterable email
    'itm_source', 'itm_medium', 'itm_campaign', 'itm_content',
    // Klaviyo
    'klaviyo_source',
    // Drip
    '__s',
    // Brevo (Sendinblue)
    'sib_uid',
    // ConvertKit
    'ck_subscriber_id',
    // ActiveCampaign
    'vgo_ee',
    // Campaign Monitor
    'cmp',
    // Pardot
    'pardot_extra_field',
    // Adobe Analytics
    'icid',
    // Snapchat Pixel
    'sc_content_id',
  ]);

  // Prefix-based: strip any param whose name starts with one of these.
  // Keep the list short to avoid false-positives.
  const PREFIXES = [
    'utm_',
    'itm_',
  ];

  function isTracking(name) {
    if (!name) return false;
    const lc = name.toLowerCase();
    if (EXACT.has(lc) || EXACT.has(name)) return true;
    for (let i = 0; i < PREFIXES.length; i++) {
      if (lc.startsWith(PREFIXES[i])) return true;
    }
    return false;
  }

  /**
   * Strip tracking params from a URL string.
   * Returns { url: string, removed: string[], changed: boolean }.
   * If the URL is not http/https, returns { url: urlString, removed: [], changed: false }.
   * If parsing fails, returns the original string unchanged.
   */
  function clean(urlString) {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (_) {
      return { url: urlString, removed: [], changed: false };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { url: urlString, removed: [], changed: false };
    }
    const removed = [];
    const keep = [];
    for (const [k] of parsed.searchParams) {
      if (isTracking(k)) {
        removed.push(k);
      } else {
        keep.push([k, parsed.searchParams.get(k)]);
      }
    }
    if (removed.length === 0) {
      return { url: urlString, removed: [], changed: false };
    }
    // Rebuild search string preserving order of kept params.
    const fresh = new URL(parsed.href);
    for (const k of removed) fresh.searchParams.delete(k);
    return { url: fresh.href, removed: removed, changed: true };
  }

  /**
   * Count how many tracking parameters are in the URL.
   * Returns 0 if the URL cannot be parsed or is not http/https.
   */
  function countTrackingParams(urlString) {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (_) {
      return 0;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 0;
    let count = 0;
    for (const [k] of parsed.searchParams) {
      if (isTracking(k)) count++;
    }
    return count;
  }

  root.PIE_CLEAN_URLS = {
    EXACT: EXACT,
    PREFIXES: PREFIXES,
    isTracking: isTracking,
    clean: clean,
    countTrackingParams: countTrackingParams
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
