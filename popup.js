/* P.I.E popup — redesigned tabbed UI on the Phase-2 two-axis engine.
 * Sensitivity  = real PII in the value (detectPII, content-driven).
 * Tracking     = known cross-site tracker (lookup in bundled Open Cookie DB).
 * The scoring/engine functions are unchanged; only the render layer is new. */

let cookieData = [];
let currentSiteHost = '';
let currentIp = '';
let currentSecure = true;
let consentDetected = false;
let popupSettings = null;
const thirdPartyHits = new Set();   // third-party domains seen via network (background.js)

/* ------------------------------------------------------------------ *
 * Engine — cookie value analysis (Sensitivity axis)                  *
 * ------------------------------------------------------------------ */

function looksLikeBase64(s) {
  if (!s || s.length < 8) return false;
  return /^(?:[A-Za-z0-9+\/\-_]{4})+(?:==|=)?$/.test(s.replace(/\s+/g, ''));
}

function tryBase64Decode(s) {
  try {
    const cleaned = s.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(cleaned);
    try {
      return decodeURIComponent(Array.prototype.map.call(decoded, c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    } catch (_) {
      return decoded;
    }
  } catch (_) { return null; }
}

function luhnCheck(numStr) {
  const digits = numStr.replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

function safeDecodeURIComponent(v) {
  try { return decodeURIComponent(v); } catch (_) { return v; }
}

// Sensitivity axis: driven only by decodable PII content, never entropy/identifiers.
function detectPII(cookie) {
  const raw = cookie.value || '';
  const checks = [];
  const candidates = new Set();
  candidates.add(raw);
  const urlDecoded = safeDecodeURIComponent(raw);
  if (urlDecoded !== raw) candidates.add(urlDecoded);
  if (looksLikeBase64(raw)) {
    const decoded = tryBase64Decode(raw);
    if (decoded) candidates.add(decoded);
  }

  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const phoneDigitsRe = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}/;
  const jwtRe = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/;

  for (const val of candidates) {
    const trimmed = (val || '').trim();
    if (!trimmed) continue;

    if (emailRe.test(trimmed)) {
      checks.push({ type: 'email', score: 0.95, reason: 'Contains email address' });
    }
    if (phoneDigitsRe.test(trimmed)) {
      const digits = trimmed.replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 15) {
        checks.push({ type: 'phone', score: 0.7, reason: 'Contains plausible phone number' });
      }
    }
    if (jwtRe.test(trimmed)) {
      try {
        const [, payload] = trimmed.split('.');
        const json = tryBase64Decode(payload);
        if (json) {
          const obj = JSON.parse(json);
          if (obj && (obj.email || obj.sub || obj.user || obj.user_id || obj.id)) {
            checks.push({ type: 'jwt', score: 0.95, reason: 'JWT includes user identifiers' });
          } else {
            checks.push({ type: 'jwt', score: 0.8, reason: 'JWT token' });
          }
        } else {
          checks.push({ type: 'jwt', score: 0.8, reason: 'JWT token' });
        }
      } catch (_) {
        checks.push({ type: 'jwt', score: 0.8, reason: 'JWT token' });
      }
    }
    const ccCandidates = trimmed.match(/[0-9][0-9 \-]{10,}[0-9]/g);
    if (ccCandidates) {
      for (const cc of ccCandidates) {
        if (luhnCheck(cc)) {
          checks.push({ type: 'credit_card', score: 0.98, reason: 'Possible credit card number (passes Luhn check)' });
          break;
        }
      }
    }
    const nameStr = safeDecodeURIComponent(trimmed);
    if (/^[A-Z][a-z]{2,}\s[A-Z][a-z]{2,}$/.test(nameStr) && nameStr.length <= 40) {
      checks.push({ type: 'name', score: 0.35, reason: 'Full name-like pattern (low confidence)' });
    }
  }

  const byType = new Map();
  for (const c of checks) {
    const prev = byType.get(c.type);
    if (!prev || c.score > prev.score) byType.set(c.type, c);
  }
  const filtered = Array.from(byType.values()).filter(c => c.score >= 0.35);
  filtered.sort((a, b) => b.score - a.score);
  return filtered;
}

function sensitivityLevel(findings) {
  if (!findings || findings.length === 0) return 'none';
  const s = findings[0].score;
  if (s >= 0.85) return 'high';
  if (s >= 0.6) return 'medium';
  if (s >= 0.35) return 'low';
  return 'none';
}

/* ------------------------------------------------------------------ *
 * Engine — tracker lookup (Tracking axis)                            *
 * ------------------------------------------------------------------ */

const COOKIE_DB = (typeof window !== 'undefined' && window.PIE_COOKIE_DB) || { exact: {}, wildcard: {} };
const _dbExactLower = {};
for (const _k in (COOKIE_DB.exact || {})) _dbExactLower[_k.toLowerCase()] = COOKIE_DB.exact[_k];
const _dbWildcards = Object.keys(COOKIE_DB.wildcard || {}).map(function (k) {
  return { prefix: k.toLowerCase(), rec: COOKIE_DB.wildcard[k] };
});

function lookupCookieDB(name) {
  if (!name) return null;
  if (COOKIE_DB.exact && COOKIE_DB.exact[name]) return COOKIE_DB.exact[name];
  const lc = name.toLowerCase();
  if (_dbExactLower[lc]) return _dbExactLower[lc];
  for (const w of _dbWildcards) {
    if (w.prefix && lc.startsWith(w.prefix)) return w.rec;
  }
  return null;
}

function isThirdPartyCookie(cookie) {
  const host = currentSiteHost || '';
  const cd = (cookie.domain || '').replace(/^\./, '');
  return !!(host && cd && !cd.endsWith(host));
}

const AXIS_TEXT = { none: 'None', low: 'Low', medium: 'Medium', high: 'High' };

function classifyTracking(cookie) {
  const rec = lookupCookieDB(cookie.name);
  const thirdParty = isThirdPartyCookie(cookie);
  if (rec) {
    const cat = rec.c;
    let level = 'none';
    if (cat === 'Marketing') level = 'high';
    else if (cat === 'Analytics') level = 'medium';
    return { level: level, label: cat, platform: rec.p || '', category: cat, known: true, thirdParty: thirdParty };
  }
  if (thirdParty) {
    return { level: 'low', label: 'Third-party (unclassified)', platform: '', category: null, known: false, thirdParty: true };
  }
  return { level: 'none', label: 'Not a known tracker', platform: '', category: null, known: false, thirdParty: false };
}

function overallSensitivity(cookies) {
  let high = 0, medium = 0, low = 0;
  for (const c of cookies) {
    const lvl = sensitivityLevel(detectPII(c));
    if (lvl === 'high') high++;
    else if (lvl === 'medium') medium++;
    else if (lvl === 'low') low++;
  }
  let level = 'none', label = 'None';
  if (high > 0) { level = 'high'; label = 'High'; }
  else if (medium > 0) { level = 'medium'; label = 'Medium'; }
  else if (low > 0) { level = 'low'; label = 'Low'; }
  return { level: level, label: label, high: high, medium: medium, low: low, count: high + medium + low };
}

function overallTracking(cookies) {
  let high = 0, medium = 0, low = 0, knownTrackers = 0;
  for (const c of cookies) {
    const t = classifyTracking(c);
    if (t.level === 'high') high++;
    else if (t.level === 'medium') medium++;
    else if (t.level === 'low') low++;
    if (t.known && (t.category === 'Marketing' || t.category === 'Analytics')) knownTrackers++;
  }
  let level = 'none', label = 'None';
  if (high > 0) { level = 'high'; label = 'High'; }
  else if (medium > 0) { level = 'medium'; label = 'Medium'; }
  else if (low > 0) { level = 'low'; label = 'Possible'; }
  return { level: level, label: label, high: high, medium: medium, low: low, knownTrackers: knownTrackers, count: high + medium + low };
}

function getAttributeWarnings(cookie) {
  const issues = [];
  if (!cookie.secure) issues.push('Missing Secure');
  if (!cookie.httpOnly) issues.push('Missing HttpOnly');
  if (!cookie.sameSite || cookie.sameSite === 'no_restriction') issues.push('SameSite not Strict/Lax');
  if (cookie.sameSite === 'no_restriction' && !cookie.secure) issues.push('SameSite=None without Secure');
  if (cookie.expirationDate && cookie.expirationDate > (Date.now() / 1000 + 31536000)) issues.push('Very long expiry');
  return issues;
}

function formatExpiry(cookie) {
  if (!cookie.expirationDate) return 'Session cookie';
  const d = new Date(cookie.expirationDate * 1000);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Chrome plumbing                                                    *
 * ------------------------------------------------------------------ */

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0];
}

async function getIPAddress(hostname) {
  try {
    const res = await fetch(`https://dns.google/resolve?name=${hostname}&type=A`);
    const data = await res.json();
    if (data.Answer && data.Answer.length > 0) {
      const record = data.Answer.find(a => a.type === 1);
      return record ? record.data : 'IP not found';
    }
    return 'IP not found';
  } catch (e) {
    return 'IP unavailable';
  }
}

function buildCookieUrl(cookie) {
  const scheme = cookie.secure ? 'https' : 'http';
  const host = (cookie.domain || '').replace(/^\./, '');
  const path = cookie.path || '/';
  return `${scheme}://${host}${path}`;
}

async function deleteCookie(cookie) {
  try {
    await chrome.cookies.remove({ url: buildCookieUrl(cookie), name: cookie.name });
  } catch (e) {}
}

const BREAKAGE_WARNING = 'Deleting cookies may log you out or break features on this site. Continue?';

/* ------------------------------------------------------------------ *
 * Rendering — helpers                                                *
 * ------------------------------------------------------------------ */

const RING_FRAC = { none: 0.08, low: 0.4, medium: 0.7, high: 1.0 };
const LEVEL_STROKE = { none: 'var(--none-stroke)', low: 'var(--accent)', medium: 'var(--med-stroke)', high: 'var(--high-stroke)' };
const LEVEL_FG = { none: 'var(--none-fg)', low: 'var(--low-fg)', medium: 'var(--med-fg)', high: 'var(--high-fg)' };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function makeRing(titleText, level, subText) {
  const card = el('div', 'ring-card');
  const ring = el('div', 'ring');
  const circ = 2 * Math.PI * 40;
  const offset = Math.round(circ * (1 - (RING_FRAC[level] || 0.08)));
  ring.innerHTML =
    `<svg width="92" height="92" viewBox="0 0 96 96">` +
      `<circle cx="48" cy="48" r="40" fill="none" stroke="var(--line)" stroke-width="9"/>` +
      `<circle cx="48" cy="48" r="40" fill="none" stroke="${LEVEL_STROKE[level]}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${Math.round(circ)}" stroke-dashoffset="${offset}"/>` +
    `</svg>` +
    `<div class="val"><b style="color:${LEVEL_FG[level]}">${AXIS_TEXT[level]}</b><span>${subText}</span></div>`;
  card.appendChild(ring);
  card.appendChild(el('div', 'title', titleText));
  return card;
}

function statTile(iconClass, iconSvg, n, label) {
  const s = el('div', 'stat');
  const ico = el('span', 'ico ' + iconClass);
  ico.setAttribute('aria-hidden', 'true');
  ico.innerHTML = iconSvg;
  const wrap = el('div');
  wrap.appendChild(el('div', 'n', String(n)));
  wrap.appendChild(el('div', 'l', label));
  s.appendChild(ico);
  s.appendChild(wrap);
  return s;
}

const ICO = {
  cookie: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1"/><circle cx="14" cy="14" r="1"/><circle cx="15" cy="9" r="1"/></svg>',
  third: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12h16M4 12a8 8 0 0 1 16 0M4 12a8 8 0 0 0 16 0"/></svg>',
  track: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
};

/* ------------------------------------------------------------------ *
 * Rendering — tabs                                                   *
 * ------------------------------------------------------------------ */

function renderSiteBar() {
  const dom = document.getElementById('site-domain');
  const ip = document.getElementById('site-ip');
  const badge = document.getElementById('https-badge');
  const lock = document.getElementById('site-lock');
  if (dom) dom.textContent = currentSiteHost || 'This page';
  if (ip) ip.textContent = (currentIp ? currentIp + ' · ' : '') + cookieData.length + ' cookie' + (cookieData.length !== 1 ? 's' : '');
  if (badge) {
    badge.textContent = currentSecure ? 'HTTPS Secure' : 'Not secure';
    badge.className = 'pill ' + (currentSecure ? 'secure' : 'insecure');
  }
  if (lock) lock.className = 'lock' + (currentSecure ? '' : ' insecure');
}

function renderOverview() {
  const sens = overallSensitivity(cookieData);
  const track = overallTracking(cookieData);
  const thirdParty = cookieData.filter(isThirdPartyCookie).length;

  const rings = document.getElementById('ov-rings');
  rings.innerHTML = '';
  rings.appendChild(makeRing('Personal data exposure', sens.level,
    sens.count > 0 ? sens.count + ' with PII' : 'no PII'));
  rings.appendChild(makeRing('Cross-site tracking', track.level,
    track.knownTrackers > 0 ? track.knownTrackers + ' tracker' + (track.knownTrackers !== 1 ? 's' : '') : 'none known'));

  const stats = document.getElementById('ov-stats');
  stats.innerHTML = '';
  stats.appendChild(statTile('p', ICO.cookie, cookieData.length, 'Cookies'));
  stats.appendChild(statTile('b', ICO.third, thirdParty, 'Third-party'));
  stats.appendChild(statTile('a', ICO.track, track.knownTrackers, 'Known trackers'));
  stats.appendChild(statTile('g', ICO.check, sens.count, 'With PII'));

  const hint = document.getElementById('ov-hint');
  let msg;
  if (sens.count === 0 && track.knownTrackers === 0) {
    msg = 'No personal data in cookies and no known trackers detected on this site.';
  } else if (sens.count === 0) {
    msg = 'No personal data stored in cookies, but this site loads known cross-site trackers. Two independent readings — not one blended score.';
  } else {
    msg = sens.count + ' cookie' + (sens.count !== 1 ? 's' : '') + ' may contain personal data. Sensitivity and tracking are shown separately so real PII is never confused with ordinary tracker IDs.';
  }
  hint.textContent = msg;
}

function cookieDetail(cookie) {
  const det = el('div', 'cdet');
  const findings = detectPII(cookie);
  const track = classifyTracking(cookie);

  const rows = [];
  if (findings.length) rows.push(['Finding', findings.map(f => f.reason).join('; ')]);
  if (track.known) rows.push(['Tracker', track.category + (track.platform ? ' — ' + track.platform : '')]);
  rows.push(['Domain', cookie.domain || '—']);
  rows.push(['Path', cookie.path || '/']);
  rows.push(['Expires', formatExpiry(cookie)]);
  rows.push(['Secure · HttpOnly · SameSite',
    (cookie.secure ? 'yes' : 'no') + ' · ' + (cookie.httpOnly ? 'yes' : 'no') + ' · ' + (cookie.sameSite || 'unset')]);
  const attrs = getAttributeWarnings(cookie);
  if (attrs.length) rows.push(['Attribute notes', attrs.join(' • ')]);

  for (const [k, v] of rows) {
    const kv = el('div', 'kv');
    kv.appendChild(el('span', null, k));
    kv.appendChild(el('span', null, v));
    det.appendChild(kv);
  }

  const full = el('div', 'full');
  full.textContent = cookie.value || '(empty)';
  det.appendChild(full);

  const acts = el('div', 'acts');
  const showBtn = el('button', null, 'Show value');
  showBtn.addEventListener('click', () => {
    const shown = full.classList.toggle('show');
    showBtn.textContent = shown ? 'Hide value' : 'Show value';
  });
  const copyBtn = el('button', null, 'Copy');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(cookie.value || '');
      copyBtn.textContent = 'Copied';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
    } catch (e) {}
  });
  const delBtn = el('button', 'del', 'Delete');
  delBtn.addEventListener('click', async () => {
    if (!window.confirm(BREAKAGE_WARNING)) return;
    await deleteCookie(cookie);
    cookieData = cookieData.filter(c => !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path));
    renderAll();
  });
  acts.appendChild(showBtn);
  acts.appendChild(copyBtn);
  acts.appendChild(delBtn);
  det.appendChild(acts);
  return det;
}

function cookieRow(cookie) {
  const sLevel = sensitivityLevel(detectPII(cookie));
  const track = classifyTracking(cookie);
  const thirdParty = isThirdPartyCookie(cookie);

  const row = el('div', 'crow');
  const sum = el('div', 'csum');

  const name = el('div', 'cname');
  name.appendChild(el('strong', null, cookie.name));
  if (track.known && track.platform) name.appendChild(el('span', 'plat', track.platform));
  const type = el('span', 'type ' + (thirdParty ? 'third' : 'first'), thirdParty ? '3rd' : '1st');
  name.appendChild(type);

  const sBadge = el('span', 'badge b-' + sLevel, 'PII: ' + AXIS_TEXT[sLevel]);
  const tBadge = el('span', 'badge b-' + track.level, 'Track: ' + AXIS_TEXT[track.level]);

  sum.appendChild(name);
  sum.appendChild(sBadge);
  sum.appendChild(tBadge);
  sum.addEventListener('click', () => row.classList.toggle('open'));

  row.appendChild(sum);
  row.appendChild(cookieDetail(cookie));
  return row;
}

function renderCookies() {
  const list = document.getElementById('cookies-list');
  const actions = document.getElementById('cookies-actions');
  list.innerHTML = '';
  actions.innerHTML = '';

  if (!cookieData.length) {
    list.appendChild(el('div', 'empty', 'No cookies found for this site.'));
    return;
  }

  const sorted = cookieData.slice().sort((a, b) => a.name.localeCompare(b.name));
  const table = el('div', 'ctable');
  for (const c of sorted) table.appendChild(cookieRow(c));
  list.appendChild(table);

  const sens = overallSensitivity(cookieData);
  const track = overallTracking(cookieData);
  const info = el('span', 't',
    (sens.count > 0 ? sens.count + ' with PII' : 'no PII') + ' · ' +
    (track.knownTrackers > 0 ? track.knownTrackers + ' known tracker' + (track.knownTrackers !== 1 ? 's' : '') : 'no known trackers'));
  const flagged = cookieData.filter(c => sensitivityLevel(detectPII(c)) !== 'none');
  const btn = el('button', 'btn-danger', 'Delete all flagged');
  if (!flagged.length) btn.disabled = true;
  btn.addEventListener('click', async () => {
    if (!flagged.length) return;
    if (!window.confirm(flagged.length + ' cookie(s) contain personal data. ' + BREAKAGE_WARNING)) return;
    for (const c of flagged) await deleteCookie(c);
    const gone = new Set(flagged.map(c => c.name + '|' + c.domain + '|' + c.path));
    cookieData = cookieData.filter(c => !gone.has(c.name + '|' + c.domain + '|' + c.path));
    renderAll();
  });
  actions.appendChild(info);
  actions.appendChild(btn);
}

function renderSecurity() {
  const wrap = document.getElementById('security-content');
  wrap.innerHTML = '';

  const card = el('div', 'seccard ' + (currentSecure ? 'good' : 'bad'));
  const lockSvg = currentSecure
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';
  const stRow = el('div', 'st-row');
  const svgWrap = document.createElement('span');
  svgWrap.innerHTML = lockSvg;
  stRow.appendChild(svgWrap.firstChild);
  const info = el('div');
  info.appendChild(el('div', 'h', currentSecure ? 'Secure (HTTPS)' : 'Not secure (HTTP)'));
  info.appendChild(el('div', 's', currentSecure
    ? 'Encrypted · your data is protected in transit'
    : 'Unencrypted · avoid entering sensitive information'));
  stRow.appendChild(info);
  card.appendChild(stRow);
  wrap.appendChild(card);

  wrap.appendChild(el('div', 'sec-label', 'Cookie attribute warnings'));
  const warned = cookieData
    .map(c => ({ c, issues: getAttributeWarnings(c) }))
    .filter(x => x.issues.length);
  if (warned.length) {
    const listEl = el('div', 'sec-list');
    for (const { c, issues } of warned.slice(0, 12)) {
      const item = el('div', 'warn-item');
      item.appendChild(el('span', 'wt', c.name));
      item.appendChild(el('span', 'wd', issues.join(' · ')));
      listEl.appendChild(item);
    }
    wrap.appendChild(listEl);
  } else {
    wrap.appendChild(el('div', 'hint', 'No cookie attribute issues found.'));
  }

  const notes = [];
  if (thirdPartyHits.size) notes.push('⚠️ ' + thirdPartyHits.size + ' third-party domain' + (thirdPartyHits.size !== 1 ? 's' : '') + ' requested cookies during this visit.');
  if (consentDetected) notes.push('🍪 Cookie consent banner detected on this site.');
  if (notes.length) {
    const n = el('div', 'hint');
    n.style.marginTop = '12px';
    n.textContent = notes.join('  ');
    wrap.appendChild(n);
  }
}

function renderAll() {
  renderSiteBar();
  renderOverview();
  renderCookies();
  renderSecurity();
}

/* ------------------------------------------------------------------ *
 * Network tab — reads the current tab's request log from background   *
 * (metadata only; captured via observational webRequest).            *
 * ------------------------------------------------------------------ */

const NET_FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'xhr', label: 'Fetch/XHR', match: t => t === 'xmlhttprequest' || t === 'fetch' || t === 'ping' || t === 'beacon' },
  { key: 'script', label: 'Scripts', match: t => t === 'script' },
  { key: 'image', label: 'Images', match: t => t === 'image' || t === 'imageset' },
  { key: 'other', label: 'Other', match: t => !['xmlhttprequest', 'fetch', 'ping', 'beacon', 'script', 'image', 'imageset'].includes(t) }
];
let networkFilter = 'all';
let networkTimer = null;

async function fetchNetworkLog() {
  let tabId = null;
  try { const t = await getActiveTab(); tabId = t && t.id; } catch (_) {}
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_NETWORK_LOG', tabId }, (resp) => {
        if (chrome.runtime.lastError) { resolve({ entries: [], monitoring: true }); return; }
        resolve(resp || { entries: [], monitoring: true });
      });
    } catch (_) { resolve({ entries: [], monitoring: true }); }
  });
}

function statusInfo(status) {
  if (status === null || status === undefined) return { cls: 'pending', text: '…' };
  if (status === 'blocked') return { cls: 'err', text: 'blocked' };
  const n = Number(status);
  if (n >= 200 && n < 300) return { cls: 'ok', text: String(n) };
  if (n >= 300 && n < 400) return { cls: 'warn', text: String(n) };
  return { cls: 'err', text: String(n) };
}

function nsumCell(n, label, cls) {
  const c = el('div', 'cell' + (cls ? ' ' + cls : ''));
  c.appendChild(el('b', null, String(n)));
  c.appendChild(el('span', null, label));
  return c;
}

function networkRow(e) {
  const row = el('div', 'nreq');
  const top = el('div', 'nreq-top');
  const m = (e.method || 'GET').toUpperCase();
  top.appendChild(el('span', 'nmethod ' + m.toLowerCase(), m));
  const host = el('div', 'nhost');
  host.appendChild(document.createTextNode(e.host || ''));
  if (e.path && e.path !== '/') host.appendChild(el('span', 'npath', ' ' + e.path));
  top.appendChild(host);
  const st = statusInfo(e.status);
  top.appendChild(el('span', 'nstatus ' + st.cls, st.text));
  row.appendChild(top);
  const bot = el('div', 'nreq-bot');
  bot.appendChild(el('span', 'ntype', e.type || 'other'));
  if (e.tracker) bot.appendChild(el('span', 'ntag trk', e.tracker.company + ' · ' + e.tracker.category));
  else if (e.thirdParty) bot.appendChild(el('span', 'ntag tp', 'Third-party'));
  row.appendChild(bot);
  return row;
}

function renderNetworkOff(wrap) {
  wrap.innerHTML = '';
  const off = el('div', 'n-off');
  off.appendChild(el('p', null, 'Network activity monitoring is off. Turn it on to see the requests each page makes — captured on your device, metadata only.'));
  const btn = el('button', 'n-enable', 'Turn on monitoring');
  btn.addEventListener('click', async () => {
    popupSettings = await PIE_SETTINGS.save({ networkMonitoring: true });
    const ne = document.getElementById('set-network');
    if (ne) ne.checked = true;
    renderNetwork();
  });
  off.appendChild(btn);
  wrap.appendChild(off);
}

async function renderNetwork() {
  const wrap = document.getElementById('network-content');
  if (!wrap) return;
  if (popupSettings && popupSettings.networkMonitoring === false) {
    renderNetworkOff(wrap);
    return;
  }
  const data = await fetchNetworkLog();
  const entries = data.entries || [];
  const total = entries.length;
  const thirdParty = entries.filter(e => e.thirdParty).length;
  const trackers = entries.filter(e => e.tracker).length;

  const f = NET_FILTERS.find(x => x.key === networkFilter) || NET_FILTERS[0];
  const shown = entries.filter(e => f.match(e.type)).reverse();

  wrap.innerHTML = '';
  const sum = el('div', 'nsum');
  sum.appendChild(nsumCell(total, 'requests'));
  sum.appendChild(nsumCell(thirdParty, 'third-party'));
  sum.appendChild(nsumCell(trackers, 'trackers', 'trk'));
  wrap.appendChild(sum);

  const filters = el('div', 'nfilters');
  for (const flt of NET_FILTERS) {
    const chip = el('button', 'nchip' + (flt.key === networkFilter ? ' active' : ''), flt.label);
    chip.addEventListener('click', () => { networkFilter = flt.key; renderNetwork(); });
    filters.appendChild(chip);
  }
  wrap.appendChild(filters);

  if (!shown.length) {
    wrap.appendChild(el('div', 'empty', total ? 'No requests match this filter.' : 'No requests captured yet — reload the page to see its activity.'));
  } else {
    const list = el('div', 'nlist');
    for (const e of shown.slice(0, 150)) list.appendChild(networkRow(e));
    wrap.appendChild(list);
  }
  wrap.appendChild(el('div', 'nprivacy', 'Observed on your device — metadata only. P.I.E never records request contents or sends this anywhere.'));
}

function startNetworkPolling() {
  renderNetwork();
  stopNetworkPolling();
  networkTimer = setInterval(renderNetwork, 1500);
}

function stopNetworkPolling() {
  if (networkTimer) { clearInterval(networkTimer); networkTimer = null; }
}

function onTabShown(name) {
  if (name === 'network') startNetworkPolling();
  else stopNetworkPolling();
}

/* ------------------------------------------------------------------ *
 * Data load                                                          *
 * ------------------------------------------------------------------ */

async function showCookies() {
  const tab = await getActiveTab();
  if (!tab || !tab.url) return;
  let url;
  try { url = new URL(tab.url); } catch (e) { return; }

  currentSiteHost = url.hostname;
  currentSecure = url.protocol === 'https:';
  renderSiteBar();

  currentIp = '';
  if (popupSettings && popupSettings.ipLookupEnabled) {
    currentIp = await getIPAddress(url.hostname);
  }

  const domainVariants = [url.hostname, '.' + url.hostname];
  let all = [];
  for (const d of domainVariants) {
    const cookies = await chrome.cookies.getAll({ domain: d }).catch(() => []);
    if (cookies && cookies.length) all = all.concat(cookies);
  }
  const map = new Map();
  for (const c of all) map.set(`${c.name}|${c.domain}|${c.path}`, c);
  cookieData = Array.from(map.values());

  renderAll();
}

/* ------------------------------------------------------------------ *
 * Messages from background / content scripts                         *
 * ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'SECURITY_CHECK') {
    currentSecure = !!msg.secure;
    renderSiteBar();
    renderSecurity();
  } else if (msg.type === 'THIRD_PARTY_COOKIE') {
    if (msg.domain) thirdPartyHits.add(msg.domain);
    renderOverview();
    renderSecurity();
  } else if (msg.type === 'COOKIE_CONSENT_DETECTED') {
    consentDetected = true;
    renderSecurity();
  } else if (msg.type === 'COOKIE_ACCEPTED') {
    setTimeout(() => showCookies(), 1000);
  }
});

/* ------------------------------------------------------------------ *
 * Tabs + theme + settings panel                                      *
 * ------------------------------------------------------------------ */

function setupTabs(initialTab) {
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');

  function activateTab(tabEl) {
    tabs.forEach(x => x.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    tabEl.classList.add('active');
    const panel = document.getElementById('tab-' + tabEl.dataset.tab);
    if (panel) panel.classList.add('active');
    onTabShown(tabEl.dataset.tab);
  }

  tabs.forEach(t => t.addEventListener('click', () => {
    activateTab(t);
    PIE_SETTINGS.save({ defaultTab: t.dataset.tab }).catch(() => {});
  }));

  const start = [...tabs].find(t => t.dataset.tab === initialTab) || tabs[0];
  if (start) activateTab(start);
}

const THEME_ORDER = ['system', 'light', 'dark'];
const THEME_ICON = {
  system: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'
};

function applyTheme(state) {
  const root = document.documentElement;
  if (state === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', state);
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (icon) icon.innerHTML = THEME_ICON[state];
  if (label) label.textContent = state.charAt(0).toUpperCase() + state.slice(1);
}

function syncThemeControls(theme) {
  document.querySelectorAll('#set-theme .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

async function setTheme(theme) {
  if (!THEME_ORDER.includes(theme)) return;
  applyTheme(theme);
  syncThemeControls(theme);
  popupSettings = await PIE_SETTINGS.save({ theme });
}

function setupTheme(initialTheme) {
  const btn = document.getElementById('theme-btn');
  let themeIdx = Math.max(0, THEME_ORDER.indexOf(initialTheme));
  applyTheme(THEME_ORDER[themeIdx]);
  syncThemeControls(THEME_ORDER[themeIdx]);
  if (btn) btn.addEventListener('click', () => {
    themeIdx = (themeIdx + 1) % THEME_ORDER.length;
    setTheme(THEME_ORDER[themeIdx]).then(() => { themeIdx = THEME_ORDER.indexOf(popupSettings.theme); });
  });
}

function applyMotion(enabled) {
  document.documentElement.classList.toggle('reduce-motion', enabled === false);
}

function openSettingsPanel() {
  document.body.classList.add('settings-open');
  document.getElementById('settings-panel').hidden = false;
}

function closeSettingsPanel() {
  document.body.classList.remove('settings-open');
  document.getElementById('settings-panel').hidden = true;
}

function bindSettingsControls(settings) {
  const notifEl = document.getElementById('set-notifications');
  const ipEl = document.getElementById('set-ip');
  const netEl = document.getElementById('set-network');
  const animEl = document.getElementById('set-animations');
  if (notifEl) notifEl.checked = settings.thirdPartyNotifications;
  if (ipEl) ipEl.checked = settings.ipLookupEnabled;
  if (netEl) netEl.checked = settings.networkMonitoring;
  if (animEl) animEl.checked = settings.animations;
  syncThemeControls(settings.theme);

  document.querySelectorAll('#set-theme .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => setTheme(btn.dataset.theme));
  });

  if (notifEl) {
    notifEl.addEventListener('change', async () => {
      popupSettings = await PIE_SETTINGS.save({ thirdPartyNotifications: notifEl.checked });
    });
  }

  if (ipEl) {
    ipEl.addEventListener('change', async () => {
      popupSettings = await PIE_SETTINGS.save({ ipLookupEnabled: ipEl.checked });
      if (popupSettings.ipLookupEnabled && currentSiteHost) {
        currentIp = await getIPAddress(currentSiteHost);
      } else {
        currentIp = '';
      }
      renderSiteBar();
    });
  }

  if (netEl) {
    netEl.addEventListener('change', async () => {
      popupSettings = await PIE_SETTINGS.save({ networkMonitoring: netEl.checked });
      renderNetwork();
    });
  }

  if (animEl) {
    animEl.addEventListener('change', async () => {
      applyMotion(animEl.checked);
      popupSettings = await PIE_SETTINGS.save({ animations: animEl.checked });
    });
  }
}

function setupSettingsPanel() {
  const openBtn = document.getElementById('settings-btn');
  const backBtn = document.getElementById('settings-back');
  if (openBtn) openBtn.addEventListener('click', openSettingsPanel);
  if (backBtn) backBtn.addEventListener('click', closeSettingsPanel);
}

document.addEventListener('DOMContentLoaded', async () => {
  popupSettings = await PIE_SETTINGS.load();
  applyMotion(popupSettings.animations);
  setupTabs(popupSettings.defaultTab);
  setupTheme(popupSettings.theme);
  bindSettingsControls(popupSettings);
  setupSettingsPanel();
  showCookies();
});
