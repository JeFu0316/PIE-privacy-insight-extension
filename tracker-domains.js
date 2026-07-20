/*
 * P.I.E tracker-domain list (on-device, for the Network tab).
 *
 * A compact, hand-curated map of common third-party tracker domains to their
 * owning company and category. Self-authored from public knowledge — NOT derived
 * from a licensed dataset, so there are no third-party licensing obligations.
 * It covers the highest-prevalence trackers, not an exhaustive list.
 *
 * Shared module: attaches PIE_TRACKERS to the popup window and the service worker
 * (via importScripts). No network calls — lookups are 100% local.
 */
(function (root) {
  'use strict';

  // domain -> { company, category }
  // category: Advertising | Analytics | Social | Tag manager | Attribution
  //           | Marketing | Customer data | Fingerprinting | Consent
  const DOMAINS = {
    // Google / Alphabet
    'google-analytics.com': { company: 'Google', category: 'Analytics' },
    'analytics.google.com': { company: 'Google', category: 'Analytics' },
    'googletagmanager.com': { company: 'Google', category: 'Tag manager' },
    'googletagservices.com': { company: 'Google', category: 'Advertising' },
    'doubleclick.net': { company: 'Google (DoubleClick)', category: 'Advertising' },
    'googlesyndication.com': { company: 'Google', category: 'Advertising' },
    'googleadservices.com': { company: 'Google', category: 'Advertising' },
    'adservice.google.com': { company: 'Google', category: 'Advertising' },
    '2mdn.net': { company: 'Google (DoubleClick)', category: 'Advertising' },
    'app-measurement.com': { company: 'Google (Firebase)', category: 'Analytics' },
    'crashlytics.com': { company: 'Google (Firebase)', category: 'Analytics' },
    'googleoptimize.com': { company: 'Google', category: 'Analytics' },
    'google-analytics.l.google.com': { company: 'Google', category: 'Analytics' },

    // Meta / Facebook
    'facebook.com': { company: 'Meta', category: 'Social' },
    'facebook.net': { company: 'Meta', category: 'Advertising' },
    'connect.facebook.net': { company: 'Meta', category: 'Advertising' },
    'fbcdn.net': { company: 'Meta', category: 'Social' },
    'instagram.com': { company: 'Meta', category: 'Social' },
    'atdmt.com': { company: 'Meta', category: 'Advertising' },

    // Microsoft
    'clarity.ms': { company: 'Microsoft', category: 'Analytics' },
    'bat.bing.com': { company: 'Microsoft', category: 'Advertising' },
    'bing.com': { company: 'Microsoft', category: 'Advertising' },
    'ads.microsoft.com': { company: 'Microsoft', category: 'Advertising' },
    'linkedin.com': { company: 'Microsoft (LinkedIn)', category: 'Social' },
    'licdn.com': { company: 'Microsoft (LinkedIn)', category: 'Advertising' },
    'adnxs.com': { company: 'Microsoft (Xandr)', category: 'Advertising' },

    // Amazon
    'amazon-adsystem.com': { company: 'Amazon', category: 'Advertising' },
    'assoc-amazon.com': { company: 'Amazon', category: 'Advertising' },

    // Adobe
    'demdex.net': { company: 'Adobe', category: 'Customer data' },
    'omtrdc.net': { company: 'Adobe', category: 'Analytics' },
    '2o7.net': { company: 'Adobe', category: 'Analytics' },
    'adobedtm.com': { company: 'Adobe', category: 'Tag manager' },
    'everesttech.net': { company: 'Adobe', category: 'Advertising' },

    // Oracle
    'bluekai.com': { company: 'Oracle', category: 'Customer data' },
    'addthis.com': { company: 'Oracle', category: 'Social' },
    'eloqua.com': { company: 'Oracle', category: 'Marketing' },
    'moatads.com': { company: 'Oracle', category: 'Advertising' },
    'nexac.com': { company: 'Oracle', category: 'Customer data' },

    // X / Twitter
    'ads-twitter.com': { company: 'X (Twitter)', category: 'Advertising' },
    'analytics.twitter.com': { company: 'X (Twitter)', category: 'Analytics' },
    't.co': { company: 'X (Twitter)', category: 'Social' },
    'twitter.com': { company: 'X (Twitter)', category: 'Social' },

    // TikTok / ByteDance
    'tiktok.com': { company: 'TikTok', category: 'Social' },
    'analytics.tiktok.com': { company: 'TikTok', category: 'Analytics' },
    'byteoversea.com': { company: 'TikTok', category: 'Analytics' },

    // Snap / Pinterest / Reddit / VK
    'snapchat.com': { company: 'Snap', category: 'Advertising' },
    'sc-static.net': { company: 'Snap', category: 'Advertising' },
    'pinterest.com': { company: 'Pinterest', category: 'Social' },
    'reddit.com': { company: 'Reddit', category: 'Social' },
    'redditstatic.com': { company: 'Reddit', category: 'Advertising' },
    'vk.com': { company: 'VK', category: 'Social' },

    // Ad exchanges / SSPs / DSPs
    'criteo.com': { company: 'Criteo', category: 'Advertising' },
    'criteo.net': { company: 'Criteo', category: 'Advertising' },
    'taboola.com': { company: 'Taboola', category: 'Advertising' },
    'outbrain.com': { company: 'Outbrain', category: 'Advertising' },
    'pubmatic.com': { company: 'PubMatic', category: 'Advertising' },
    'rubiconproject.com': { company: 'Magnite', category: 'Advertising' },
    'casalemedia.com': { company: 'Index Exchange', category: 'Advertising' },
    'indexww.com': { company: 'Index Exchange', category: 'Advertising' },
    'openx.net': { company: 'OpenX', category: 'Advertising' },
    'adsrvr.org': { company: 'The Trade Desk', category: 'Advertising' },
    '3lift.com': { company: 'TripleLift', category: 'Advertising' },
    'sharethrough.com': { company: 'Sharethrough', category: 'Advertising' },
    'smartadserver.com': { company: 'Equativ', category: 'Advertising' },
    'yieldmo.com': { company: 'Yieldmo', category: 'Advertising' },
    'teads.tv': { company: 'Teads', category: 'Advertising' },
    'bidswitch.net': { company: 'BidSwitch', category: 'Advertising' },
    'mathtag.com': { company: 'MediaMath', category: 'Advertising' },
    'adform.net': { company: 'Adform', category: 'Advertising' },
    'media.net': { company: 'Media.net', category: 'Advertising' },
    'contextweb.com': { company: 'PulsePoint', category: 'Advertising' },
    'gumgum.com': { company: 'GumGum', category: 'Advertising' },
    'adroll.com': { company: 'AdRoll', category: 'Advertising' },
    'rlcdn.com': { company: 'LiveRamp', category: 'Customer data' },
    'agkn.com': { company: 'Neustar', category: 'Advertising' },
    'crwdcntrl.net': { company: 'Lotame', category: 'Customer data' },
    'serving-sys.com': { company: 'Sizmek', category: 'Advertising' },
    'yahoo.com': { company: 'Yahoo', category: 'Advertising' },
    'advertising.com': { company: 'Yahoo', category: 'Advertising' },

    // Analytics / product analytics / session replay
    'quantserve.com': { company: 'Quantcast', category: 'Analytics' },
    'quantcount.com': { company: 'Quantcast', category: 'Analytics' },
    'scorecardresearch.com': { company: 'Comscore', category: 'Analytics' },
    'comscore.com': { company: 'Comscore', category: 'Analytics' },
    'chartbeat.com': { company: 'Chartbeat', category: 'Analytics' },
    'chartbeat.net': { company: 'Chartbeat', category: 'Analytics' },
    'hotjar.com': { company: 'Hotjar', category: 'Analytics' },
    'hotjar.io': { company: 'Hotjar', category: 'Analytics' },
    'mouseflow.com': { company: 'Mouseflow', category: 'Analytics' },
    'fullstory.com': { company: 'FullStory', category: 'Analytics' },
    'mixpanel.com': { company: 'Mixpanel', category: 'Analytics' },
    'amplitude.com': { company: 'Amplitude', category: 'Analytics' },
    'heapanalytics.com': { company: 'Heap', category: 'Analytics' },
    'segment.com': { company: 'Twilio Segment', category: 'Customer data' },
    'segment.io': { company: 'Twilio Segment', category: 'Customer data' },
    'optimizely.com': { company: 'Optimizely', category: 'Analytics' },
    'crazyegg.com': { company: 'Crazy Egg', category: 'Analytics' },
    'inspectlet.com': { company: 'Inspectlet', category: 'Analytics' },
    'luckyorange.com': { company: 'Lucky Orange', category: 'Analytics' },
    'newrelic.com': { company: 'New Relic', category: 'Analytics' },
    'nr-data.net': { company: 'New Relic', category: 'Analytics' },
    'sentry.io': { company: 'Sentry', category: 'Analytics' },
    'bugsnag.com': { company: 'Bugsnag', category: 'Analytics' },
    'cloudflareinsights.com': { company: 'Cloudflare', category: 'Analytics' },
    'yandex.ru': { company: 'Yandex', category: 'Analytics' },
    'mc.yandex.ru': { company: 'Yandex', category: 'Analytics' },
    'hs-analytics.net': { company: 'HubSpot', category: 'Marketing' },

    // Attribution (mobile / app)
    'branch.io': { company: 'Branch', category: 'Attribution' },
    'appsflyer.com': { company: 'AppsFlyer', category: 'Attribution' },
    'adjust.com': { company: 'Adjust', category: 'Attribution' },
    'kochava.com': { company: 'Kochava', category: 'Attribution' },
    'singular.net': { company: 'Singular', category: 'Attribution' },

    // Marketing / CRM / customer engagement
    'hubspot.com': { company: 'HubSpot', category: 'Marketing' },
    'hubspot.net': { company: 'HubSpot', category: 'Marketing' },
    'marketo.com': { company: 'Adobe (Marketo)', category: 'Marketing' },
    'mktoresp.com': { company: 'Adobe (Marketo)', category: 'Marketing' },
    'pardot.com': { company: 'Salesforce (Pardot)', category: 'Marketing' },
    'list-manage.com': { company: 'Mailchimp', category: 'Marketing' },
    'klaviyo.com': { company: 'Klaviyo', category: 'Marketing' },
    'braze.com': { company: 'Braze', category: 'Customer data' },
    'onesignal.com': { company: 'OneSignal', category: 'Marketing' },
    'intercom.io': { company: 'Intercom', category: 'Customer data' },
    'intercomcdn.com': { company: 'Intercom', category: 'Customer data' },
    'drift.com': { company: 'Drift', category: 'Marketing' },

    // Consent management platforms
    'onetrust.com': { company: 'OneTrust', category: 'Consent' },
    'cookielaw.org': { company: 'OneTrust', category: 'Consent' },
    'cookiebot.com': { company: 'Cookiebot', category: 'Consent' },
    'trustarc.com': { company: 'TrustArc', category: 'Consent' },
    'usercentrics.eu': { company: 'Usercentrics', category: 'Consent' },
    'quantcast.mgr.consensu.org': { company: 'Quantcast', category: 'Consent' }
  };

  // Match a host against the list, walking up parent domains
  // (e.g. stats.g.doubleclick.net -> doubleclick.net).
  function lookup(host) {
    if (!host) return null;
    let h = String(host).toLowerCase().replace(/\.$/, '');
    while (h.indexOf('.') !== -1) {
      if (DOMAINS[h]) return DOMAINS[h];
      h = h.slice(h.indexOf('.') + 1);
    }
    return DOMAINS[h] || null;
  }

  root.PIE_TRACKERS = { DOMAINS: DOMAINS, lookup: lookup, count: Object.keys(DOMAINS).length };
})(typeof globalThis !== 'undefined' ? globalThis : self);
