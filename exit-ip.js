/*
 * P.I.E exit-IP helpers — parse Cloudflare trace + best-effort VPN/datacenter hint.
 * Classification is heuristic (WARP flag, reverse-DNS keywords). Never claim certainty.
 * Shared by popup (script tag) and unit tests (Node vm).
 */
(function (root) {
  'use strict';

  // Hosting / VPN / proxy tokens often seen in PTR hostnames (best-effort only).
  var HINT_RE = /(^|[.\-])(vpn|proxy|tunnel|tor|exit|relay|nordvpn|expressvpn|mullvad|surfshark|cyberghost|privateinternet|protonvpn|protonmail|datacamp|choopa|digitalocean|linode|vultr|hetzner|amazonaws|compute\.amazonaws|googleusercontent|bc\.googleusercontent|cloudapp|azure|oraclecloud|softlayer|ibmcloud|ovh|contabo|hostinger|leaseweb|scaleway|akamai|fastly|cloudflare|rackspace|colocrossing|namecheap|dreamhost|vps|dedicated|hosting|server|datacenter|data\-center)([.\-]|$)/i;

  function parseCloudflareTrace(text) {
    var out = { ip: '', loc: '', colo: '', warp: false };
    if (!text || typeof text !== 'string') return out;
    String(text).split(/\r?\n/).forEach(function (line) {
      var i = line.indexOf('=');
      if (i < 1) return;
      var k = line.slice(0, i).trim();
      var v = line.slice(i + 1).trim();
      if (k === 'ip') out.ip = v;
      else if (k === 'loc') out.loc = v;
      else if (k === 'colo') out.colo = v;
      else if (k === 'warp') out.warp = /^on$/i.test(v);
    });
    return out;
  }

  function isIPv4(ip) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip || '');
  }

  function isIPv6(ip) {
    return !!ip && ip.indexOf(':') !== -1;
  }

  // Build reverse DNS name for Google DNS PTR queries.
  function ptrNameForIp(ip) {
    if (isIPv4(ip)) {
      return ip.split('.').reverse().join('.') + '.in-addr.arpa';
    }
    if (isIPv6(ip)) {
      var expanded = expandIPv6(ip);
      if (!expanded) return null;
      var hex = expanded.replace(/:/g, '');
      return hex.split('').reverse().join('.') + '.ip6.arpa';
    }
    return null;
  }

  function expandIPv6(ip) {
    if (!ip) return null;
    var sides = ip.split('::');
    if (sides.length > 2) return null;
    var left = sides[0] ? sides[0].split(':') : [];
    var right = sides.length === 2 && sides[1] ? sides[1].split(':') : [];
    if (sides.length === 1) {
      if (left.length !== 8) return null;
      return left.map(pad4).join(':');
    }
    var missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    var mid = [];
    for (var i = 0; i < missing; i++) mid.push('0000');
    return left.concat(mid).concat(right).map(pad4).join(':');
  }

  function pad4(h) {
    return ('0000' + (h || '0')).slice(-4).toLowerCase();
  }

  /**
   * @param {{ ip?: string, warp?: boolean, ptr?: string|null, loc?: string }} meta
   * @returns {{ kind: string, matched?: string }}
   *   kind: 'warp' | 'vpn_like' | 'residential_like' | 'unknown'
   */
  function classifyExit(meta) {
    meta = meta || {};
    if (meta.warp) return { kind: 'warp' };
    var ptr = (meta.ptr || '').toLowerCase();
    if (ptr) {
      var m = ptr.match(HINT_RE);
      if (m) return { kind: 'vpn_like', matched: m[2] };
    }
    if (meta.ip && (isIPv4(meta.ip) || isIPv6(meta.ip))) {
      return { kind: 'residential_like' };
    }
    return { kind: 'unknown' };
  }

  root.PIE_EXIT_IP = {
    HINT_RE: HINT_RE,
    parseCloudflareTrace: parseCloudflareTrace,
    ptrNameForIp: ptrNameForIp,
    classifyExit: classifyExit,
    isIPv4: isIPv4,
    isIPv6: isIPv6
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
