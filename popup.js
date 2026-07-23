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
let myIpInfo = null;   // { ip, loc, colo, warp, ptr, kind } when my-IP lookup is on
const thirdPartyHits = new Set();   // third-party domains seen via network (background.js)

const APP_VERSION = '2.1.0';

// i18n shorthands. Defensive so the engine still loads in the headless test
// sandbox (where PIE_I18N isn't present) — there they resolve to the key.
function tr(key, subs) {
  return (typeof PIE_I18N !== 'undefined' && PIE_I18N) ? PIE_I18N.t(key, subs) : key;
}
function trn(key, n, subs) {
  return (typeof PIE_I18N !== 'undefined' && PIE_I18N) ? PIE_I18N.tn(key, n, subs) : key;
}

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
      checks.push({ type: 'email', score: 0.95, reasonKey: 'pii.email' });
    }
    if (phoneDigitsRe.test(trimmed)) {
      const digits = trimmed.replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 15) {
        checks.push({ type: 'phone', score: 0.7, reasonKey: 'pii.phone' });
      }
    }
    if (jwtRe.test(trimmed)) {
      try {
        const [, payload] = trimmed.split('.');
        const json = tryBase64Decode(payload);
        if (json) {
          const obj = JSON.parse(json);
          if (obj && (obj.email || obj.sub || obj.user || obj.user_id || obj.id)) {
            checks.push({ type: 'jwt', score: 0.95, reasonKey: 'pii.jwtId' });
          } else {
            checks.push({ type: 'jwt', score: 0.8, reasonKey: 'pii.jwt' });
          }
        } else {
          checks.push({ type: 'jwt', score: 0.8, reasonKey: 'pii.jwt' });
        }
      } catch (_) {
        checks.push({ type: 'jwt', score: 0.8, reasonKey: 'pii.jwt' });
      }
    }
    const ccCandidates = trimmed.match(/[0-9][0-9 \-]{10,}[0-9]/g);
    if (ccCandidates) {
      for (const cc of ccCandidates) {
        if (luhnCheck(cc)) {
          checks.push({ type: 'credit_card', score: 0.98, reasonKey: 'pii.creditCard' });
          break;
        }
      }
    }
    const nameStr = safeDecodeURIComponent(trimmed);
    if (/^[A-Z][a-z]{2,}\s[A-Z][a-z]{2,}$/.test(nameStr) && nameStr.length <= 40) {
      checks.push({ type: 'name', score: 0.35, reasonKey: 'pii.name' });
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

function axisText(level) { return tr('axis.' + level); }

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
  if (!cookie.secure) issues.push(tr('attr.missingSecure'));
  if (!cookie.httpOnly) issues.push(tr('attr.missingHttpOnly'));
  if (!cookie.sameSite || cookie.sameSite === 'no_restriction') issues.push(tr('attr.sameSiteWeak'));
  if (cookie.sameSite === 'no_restriction' && !cookie.secure) issues.push(tr('attr.sameSiteNoneInsecure'));
  if (cookie.expirationDate && cookie.expirationDate > (Date.now() / 1000 + 31536000)) issues.push(tr('attr.longExpiry'));
  return issues;
}

function formatExpiry(cookie) {
  if (!cookie.expirationDate) return tr('expiry.session');
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
      return record ? record.data : tr('ip.notFound');
    }
    return tr('ip.notFound');
  } catch (e) {
    return tr('ip.unavailable');
  }
}

async function lookupPtr(ip) {
  if (typeof PIE_EXIT_IP === 'undefined') return null;
  const name = PIE_EXIT_IP.ptrNameForIp(ip);
  if (!name) return null;
  try {
    const res = await fetch('https://dns.google/resolve?name=' + encodeURIComponent(name) + '&type=PTR');
    const data = await res.json();
    const ans = (data && data.Answer) || [];
    const ptr = ans.find(a => a.type === 12);
    return ptr && ptr.data ? String(ptr.data).replace(/\.$/, '') : null;
  } catch (_) {
    return null;
  }
}

// Optional: public exit IP via Cloudflare + best-effort VPN/datacenter hint (PTR keywords / WARP).
async function refreshMyIp() {
  if (!popupSettings || !popupSettings.myIpLookupEnabled) {
    myIpInfo = null;
    return null;
  }
  try {
    const res = await fetch('https://www.cloudflare.com/cdn-cgi/trace', { cache: 'no-store' });
    const text = await res.text();
    const parsed = PIE_EXIT_IP.parseCloudflareTrace(text);
    if (!parsed.ip) {
      myIpInfo = { ip: '', kind: 'unknown', error: true };
      return myIpInfo;
    }
    const ptr = await lookupPtr(parsed.ip);
    const cls = PIE_EXIT_IP.classifyExit({ ip: parsed.ip, warp: parsed.warp, ptr: ptr });
    myIpInfo = {
      ip: parsed.ip,
      loc: parsed.loc || '',
      colo: parsed.colo || '',
      warp: !!parsed.warp,
      ptr: ptr || '',
      kind: cls.kind,
      matched: cls.matched || ''
    };
    return myIpInfo;
  } catch (_) {
    myIpInfo = { ip: '', kind: 'unknown', error: true };
    return myIpInfo;
  }
}

function exitKindLabel(kind) {
  if (kind === 'warp') return tr('myip.kind.warp');
  if (kind === 'vpn_like') return tr('myip.kind.vpn');
  if (kind === 'residential_like') return tr('myip.kind.residential');
  return tr('myip.kind.unknown');
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

function breakageWarning() { return tr('confirm.breakage'); }

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
    `<div class="val"><b style="color:${LEVEL_FG[level]}">${axisText(level)}</b><span>${subText}</span></div>`;
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
  if (dom) dom.textContent = currentSiteHost || tr('site.thisPage');
  if (ip) ip.textContent = (currentIp ? currentIp + ' · ' : '') + trn('site.cookies', cookieData.length);
  if (badge) {
    badge.textContent = currentSecure ? tr('site.httpsSecure') : tr('site.notSecure');
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
  rings.appendChild(makeRing(tr('overview.sensTitle'), sens.level,
    sens.count > 0 ? tr('overview.withPII', { n: sens.count }) : tr('overview.noPII')));
  rings.appendChild(makeRing(tr('overview.trackTitle'), track.level,
    track.knownTrackers > 0 ? trn('overview.trackers', track.knownTrackers) : tr('overview.noneKnown')));

  renderOverviewMyIp();
  renderOverviewDigest();

  const stats = document.getElementById('ov-stats');
  stats.innerHTML = '';
  stats.appendChild(statTile('p', ICO.cookie, cookieData.length, tr('stats.cookies')));
  stats.appendChild(statTile('b', ICO.third, thirdParty, tr('stats.thirdParty')));
  stats.appendChild(statTile('a', ICO.track, track.knownTrackers, tr('stats.knownTrackers')));
  stats.appendChild(statTile('g', ICO.check, sens.count, tr('stats.withPII')));

  const hint = document.getElementById('ov-hint');
  let msg;
  if (sens.count === 0 && track.knownTrackers === 0) {
    msg = tr('overview.hintClean');
  } else if (sens.count === 0) {
    msg = tr('overview.hintTrackersOnly');
  } else {
    msg = trn('overview.hintPII', sens.count);
  }
  hint.textContent = msg;
}

function renderOverviewMyIp() {
  const box = document.getElementById('ov-myip');
  if (!box) return;
  box.innerHTML = '';
  box.hidden = false;

  box.appendChild(el('div', 'ov-ip-label', tr('myip.overviewLabel')));

  if (!popupSettings || !popupSettings.myIpLookupEnabled) {
    box.appendChild(el('div', 'ov-ip-meta', tr('myip.offShort')));
    const enable = el('button', 'ov-ip-enable', tr('myip.turnOn'));
    enable.addEventListener('click', async () => {
      popupSettings = await PIE_SETTINGS.save({ myIpLookupEnabled: true });
      const elToggle = document.getElementById('set-myip');
      if (elToggle) elToggle.checked = true;
      await refreshMyIp();
      renderOverview();
      renderSecurity();
    });
    box.appendChild(enable);
    return;
  }

  if (!myIpInfo || myIpInfo.error || !myIpInfo.ip) {
    box.appendChild(el('div', 'ov-ip-value', '—'));
    box.appendChild(el('div', 'ov-ip-meta', tr('myip.unavailable')));
    return;
  }

  box.appendChild(el('div', 'ov-ip-value', myIpInfo.ip));
  const bits = [exitKindLabel(myIpInfo.kind)];
  if (myIpInfo.loc) bits.push(tr('myip.loc', { loc: myIpInfo.loc }));
  box.appendChild(el('div', 'ov-ip-meta', bits.join(' · ')));
}

async function renderOverviewDigest() {
  const box = document.getElementById('ov-digest');
  if (!box) return;
  box.innerHTML = '';
  if (!popupSettings || !popupSettings.weeklyDigestEnabled || typeof PIE_DIGEST === 'undefined') {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.appendChild(el('div', 'ov-digest-title', tr('digest.title')));
  let snap;
  try {
    snap = await PIE_DIGEST.snapshot();
  } catch (_) {
    snap = null;
  }
  if (!snap || (snap.trackerEvents === 0 && snap.cookiesCleaned === 0)) {
    box.appendChild(el('div', 'ov-digest-empty', tr('digest.empty')));
    return;
  }
  const row = el('div', 'ov-digest-stats');
  row.appendChild(statTile('a', ICO.track, snap.trackerEvents, tr('digest.trackers')));
  row.appendChild(statTile('g', ICO.check, snap.cookiesCleaned, tr('digest.cleaned')));
  box.appendChild(row);
  if (snap.topTrackers && snap.topTrackers.length) {
    box.appendChild(el('div', 'ov-digest-top-label', tr('digest.top')));
    const list = el('ul', 'ov-digest-top');
    snap.topTrackers.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item.domain + ' · ' + item.count;
      list.appendChild(li);
    });
    box.appendChild(list);
  }
}

const FEEDBACK_EMAIL = 'jeffreyk348@gmail.com';
// Future: official Toolingo site. Leave null until the domain is settled.
const TOOLINGO_SITE_URL = null;

function closeHeadMenu() {
  const actions = document.getElementById('head-actions');
  const menuBtn = document.getElementById('menu-btn');
  document.body.classList.remove('head-menu-open');
  if (actions) actions.setAttribute('aria-hidden', 'true');
  if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
}

function openHeadMenu() {
  const actions = document.getElementById('head-actions');
  const menuBtn = document.getElementById('menu-btn');
  document.body.classList.add('head-menu-open');
  if (actions) actions.setAttribute('aria-hidden', 'false');
  if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
}

function toggleHeadMenu() {
  if (document.body.classList.contains('head-menu-open')) closeHeadMenu();
  else openHeadMenu();
}

function openReportPanel() {
  closeHeadMenu();
  const panel = document.getElementById('report-panel');
  if (!panel) return;
  panel.hidden = false;
  const urlEl = document.getElementById('report-url');
  if (urlEl && !urlEl.value && currentSiteHost) {
    urlEl.value = (currentSecure ? 'https://' : 'http://') + currentSiteHost;
  }
  const details = document.getElementById('report-details');
  if (details) details.focus();
}

function closeReportPanel() {
  const panel = document.getElementById('report-panel');
  if (panel) panel.hidden = true;
  const msg = document.getElementById('report-msg');
  if (msg) msg.textContent = '';
}

function topicLabel(value) {
  const map = {
    bug: tr('report.topicBug'),
    site: tr('report.topicSite'),
    idea: tr('report.topicIdea'),
    other: tr('report.topicOther')
  };
  return map[value] || value;
}

async function submitReportForm() {
  const topicEl = document.getElementById('report-topic');
  const urlEl = document.getElementById('report-url');
  const detailsEl = document.getElementById('report-details');
  const msg = document.getElementById('report-msg');
  const sendBtn = document.getElementById('report-send');
  const details = (detailsEl && detailsEl.value || '').trim();
  if (!details) {
    if (msg) msg.textContent = tr('report.needDetails');
    if (detailsEl) detailsEl.focus();
    return;
  }
  const topic = topicEl ? topicEl.value : 'other';
  const siteUrl = (urlEl && urlEl.value || '').trim();
  const subject = tr('feedback.subject', { version: APP_VERSION });
  const body = tr('report.mailBody', {
    topic: topicLabel(topic),
    url: siteUrl || '—',
    details: details,
    version: APP_VERSION,
    language: (popupSettings && popupSettings.language) || 'auto',
    locale: (typeof PIE_I18N !== 'undefined' && PIE_I18N.getLocale()) || 'en'
  });

  // Prefer Gmail compose (reliable in extension popups). Mailto as secondary.
  // Future: POST to a Toolingo backend / Formspree (needs explicit network approval).
  const gmail = 'https://mail.google.com/mail/?view=cm&fs=1'
    + '&to=' + encodeURIComponent(FEEDBACK_EMAIL)
    + '&su=' + encodeURIComponent(subject)
    + '&body=' + encodeURIComponent(body);
  const mailto = 'mailto:' + FEEDBACK_EMAIL
    + '?subject=' + encodeURIComponent(subject)
    + '&body=' + encodeURIComponent(body);

  if (sendBtn) sendBtn.disabled = true;
  if (msg) msg.textContent = tr('report.sending');
  try {
    if (chrome && chrome.tabs && chrome.tabs.create) {
      await chrome.tabs.create({ url: gmail });
    } else {
      window.open(gmail, '_blank');
    }
    if (msg) msg.textContent = tr('report.sentHint');
    setTimeout(() => {
      closeReportPanel();
      if (detailsEl) detailsEl.value = '';
      if (sendBtn) sendBtn.disabled = false;
    }, 700);
  } catch (_) {
    try {
      await navigator.clipboard.writeText(subject + '\n\n' + body);
      if (msg) msg.textContent = tr('report.copiedFallback', { email: FEEDBACK_EMAIL });
    } catch (e2) {
      try { window.open(mailto, '_blank'); } catch (e3) {}
      if (msg) msg.textContent = tr('report.mailFallback');
    }
    if (sendBtn) sendBtn.disabled = false;
  }
}

function openFeedbackReport() {
  openReportPanel();
}

function setupTheme(initialTheme) {
  const btn = document.getElementById('menu-theme');
  let themeIdx = Math.max(0, THEME_ORDER.indexOf(initialTheme));
  applyTheme(THEME_ORDER[themeIdx]);
  syncThemeControls(THEME_ORDER[themeIdx]);
  if (btn) btn.addEventListener('click', () => {
    themeIdx = (themeIdx + 1) % THEME_ORDER.length;
    setTheme(THEME_ORDER[themeIdx]).then(() => { themeIdx = THEME_ORDER.indexOf(popupSettings.theme); });
  });
}

function setupHeadMenu() {
  const menuBtn = document.getElementById('menu-btn');
  const logoBtn = document.getElementById('logo-btn');
  const settingsBtn = document.getElementById('menu-settings');
  const reportBtn = document.getElementById('menu-report');
  if (menuBtn) menuBtn.addEventListener('click', toggleHeadMenu);
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      closeHeadMenu();
      openSettingsPanel();
    });
  }
  if (reportBtn) reportBtn.addEventListener('click', openReportPanel);
  if (logoBtn) {
    logoBtn.addEventListener('click', () => {
      // Future: open TOOLINGO_SITE_URL when the domain is settled.
      if (TOOLINGO_SITE_URL) {
        chrome.tabs.create({ url: TOOLINGO_SITE_URL });
        return;
      }
      logoBtn.title = tr('header.logoSoon');
    });
  }
}

function setupReportPanel() {
  const closeBtn = document.getElementById('report-close');
  const sendBtn = document.getElementById('report-send');
  const panel = document.getElementById('report-panel');
  if (closeBtn) closeBtn.addEventListener('click', closeReportPanel);
  if (sendBtn) sendBtn.addEventListener('click', submitReportForm);
  if (panel) {
    panel.addEventListener('click', (e) => {
      if (e.target === panel) closeReportPanel();
    });
  }
}

function cookieDetail(cookie) {
  const det = el('div', 'cdet');
  const findings = detectPII(cookie);
  const track = classifyTracking(cookie);

  const yes = tr('detail.yes'), no = tr('detail.no');
  const rows = [];
  if (findings.length) rows.push([tr('detail.finding'), findings.map(f => tr(f.reasonKey)).join('; ')]);
  if (track.known) rows.push([tr('detail.tracker'), track.category + (track.platform ? ' — ' + track.platform : '')]);
  rows.push([tr('detail.domain'), cookie.domain || '—']);
  rows.push([tr('detail.path'), cookie.path || '/']);
  rows.push([tr('detail.expires'), formatExpiry(cookie)]);
  rows.push([tr('detail.flags'),
    (cookie.secure ? yes : no) + ' · ' + (cookie.httpOnly ? yes : no) + ' · ' + (cookie.sameSite || tr('detail.unset'))]);
  const attrs = getAttributeWarnings(cookie);
  if (attrs.length) rows.push([tr('detail.attrNotes'), attrs.join(' • ')]);

  for (const [k, v] of rows) {
    const kv = el('div', 'kv');
    kv.appendChild(el('span', null, k));
    kv.appendChild(el('span', null, v));
    det.appendChild(kv);
  }

  const full = el('div', 'full');
  full.textContent = cookie.value || tr('detail.empty');
  det.appendChild(full);

  const acts = el('div', 'acts');
  const showBtn = el('button', null, tr('detail.showValue'));
  showBtn.addEventListener('click', () => {
    const shown = full.classList.toggle('show');
    showBtn.textContent = shown ? tr('detail.hideValue') : tr('detail.showValue');
  });
  const copyBtn = el('button', null, tr('detail.copy'));
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(cookie.value || '');
      copyBtn.textContent = tr('detail.copied');
      setTimeout(() => (copyBtn.textContent = tr('detail.copy')), 1200);
    } catch (e) {}
  });
  const delBtn = el('button', 'del', tr('detail.delete'));
  delBtn.addEventListener('click', async () => {
    if (!window.confirm(breakageWarning())) return;
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
  const type = el('span', 'type ' + (thirdParty ? 'third' : 'first'), thirdParty ? tr('cookie.third') : tr('cookie.first'));
  name.appendChild(type);

  const sBadge = el('span', 'badge b-' + sLevel, tr('cookie.piiBadge', { level: axisText(sLevel) }));
  const tBadge = el('span', 'badge b-' + track.level, tr('cookie.trackBadge', { level: axisText(track.level) }));

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
    list.appendChild(el('div', 'empty', tr('cookies.empty')));
    return;
  }

  const sorted = cookieData.slice().sort((a, b) => a.name.localeCompare(b.name));
  const table = el('div', 'ctable');
  for (const c of sorted) table.appendChild(cookieRow(c));
  list.appendChild(table);

  const sens = overallSensitivity(cookieData);
  const track = overallTracking(cookieData);
  const info = el('span', 't',
    (sens.count > 0 ? tr('overview.withPII', { n: sens.count }) : tr('overview.noPII')) + ' · ' +
    (track.knownTrackers > 0 ? trn('cookies.knownTrackers', track.knownTrackers) : tr('cookies.noKnownTrackers')));
  const flagged = cookieData.filter(c => sensitivityLevel(detectPII(c)) !== 'none');
  const btn = el('button', 'btn-danger', tr('cookies.deleteAllFlagged'));
  if (!flagged.length) btn.disabled = true;
  btn.addEventListener('click', async () => {
    if (!flagged.length) return;
    if (!window.confirm(trn('confirm.flagged', flagged.length) + breakageWarning())) return;
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
  info.appendChild(el('div', 'h', currentSecure ? tr('security.secureTitle') : tr('security.insecureTitle')));
  info.appendChild(el('div', 's', currentSecure
    ? tr('security.secureDesc')
    : tr('security.insecureDesc')));
  stRow.appendChild(info);
  card.appendChild(stRow);
  wrap.appendChild(card);

  // Your public exit IP (optional — off by default; Cloudflare + best-effort hint).
  wrap.appendChild(el('div', 'sec-label', tr('myip.section')));
  const myCard = el('div', 'seccard myip-card');
  if (!popupSettings || !popupSettings.myIpLookupEnabled) {
    myCard.appendChild(el('div', 's', tr('myip.off')));
    const enable = el('button', 'n-enable', tr('myip.turnOn'));
    enable.style.marginTop = '10px';
    enable.addEventListener('click', async () => {
      popupSettings = await PIE_SETTINGS.save({ myIpLookupEnabled: true });
      const elToggle = document.getElementById('set-myip');
      if (elToggle) elToggle.checked = true;
      await refreshMyIp();
      renderSecurity();
    });
    myCard.appendChild(enable);
  } else if (!myIpInfo || myIpInfo.error || !myIpInfo.ip) {
    myCard.appendChild(el('div', 's', tr('myip.unavailable')));
  } else {
    const row = el('div', 'st-row');
    const block = el('div');
    block.appendChild(el('div', 'h', myIpInfo.ip));
    const bits = [exitKindLabel(myIpInfo.kind)];
    if (myIpInfo.loc) bits.push(tr('myip.loc', { loc: myIpInfo.loc }));
    block.appendChild(el('div', 's', bits.join(' · ')));
    row.appendChild(block);
    myCard.appendChild(row);
    myCard.appendChild(el('div', 'myip-disclaimer', tr('myip.disclaimer')));
  }
  wrap.appendChild(myCard);

  wrap.appendChild(el('div', 'sec-label', tr('security.attrWarnings')));
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
    wrap.appendChild(el('div', 'hint', tr('security.noAttrIssues')));
  }

  const notes = [];
  if (thirdPartyHits.size) notes.push(trn('security.thirdPartyNote', thirdPartyHits.size));
  if (consentDetected) notes.push(tr('security.consentNote'));
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
  { key: 'all', labelKey: 'net.filter.all', match: () => true },
  { key: 'xhr', labelKey: 'net.filter.xhr', match: t => t === 'xmlhttprequest' || t === 'fetch' || t === 'ping' || t === 'beacon' },
  { key: 'script', labelKey: 'net.filter.script', match: t => t === 'script' },
  { key: 'image', labelKey: 'net.filter.image', match: t => t === 'image' || t === 'imageset' },
  { key: 'other', labelKey: 'net.filter.other', match: t => !['xmlhttprequest', 'fetch', 'ping', 'beacon', 'script', 'image', 'imageset'].includes(t) }
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
  // 'blocked' kept for backward compatibility with any pre-existing log entries.
  if (status === 'failed' || status === 'blocked') return { cls: 'err', text: tr('net.statusFailed') };
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
  else if (e.thirdParty) bot.appendChild(el('span', 'ntag tp', tr('net.thirdPartyTag')));
  row.appendChild(bot);
  return row;
}

function renderNetworkOff(wrap) {
  wrap.innerHTML = '';
  const off = el('div', 'n-off');
  off.appendChild(el('p', null, tr('net.off')));
  const btn = el('button', 'n-enable', tr('net.turnOn'));
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
  sum.appendChild(nsumCell(total, tr('net.requests')));
  sum.appendChild(nsumCell(thirdParty, tr('net.thirdParty')));
  sum.appendChild(nsumCell(trackers, tr('net.trackers'), 'trk'));
  wrap.appendChild(sum);

  const filters = el('div', 'nfilters');
  for (const flt of NET_FILTERS) {
    const chip = el('button', 'nchip' + (flt.key === networkFilter ? ' active' : ''), tr(flt.labelKey));
    chip.addEventListener('click', () => { networkFilter = flt.key; renderNetwork(); });
    filters.appendChild(chip);
  }
  wrap.appendChild(filters);

  if (!shown.length) {
    wrap.appendChild(el('div', 'empty', total ? tr('net.noMatch') : tr('net.noneYet')));
  } else {
    const list = el('div', 'nlist');
    for (const e of shown.slice(0, 150)) list.appendChild(networkRow(e));
    wrap.appendChild(list);
  }
  wrap.appendChild(el('div', 'nprivacy', tr('net.privacy')));
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

  const myIpPromise = refreshMyIp();

  const domainVariants = [url.hostname, '.' + url.hostname];
  let all = [];
  for (const d of domainVariants) {
    const cookies = await chrome.cookies.getAll({ domain: d }).catch(() => []);
    if (cookies && cookies.length) all = all.concat(cookies);
  }
  const map = new Map();
  for (const c of all) map.set(`${c.name}|${c.domain}|${c.path}`, c);
  cookieData = Array.from(map.values());

  await myIpPromise;
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

const THEME_ORDER = ['system', 'light', 'dark', 'catppuccin', 'dracula', 'nord', 'colorblind', 'custom'];
const PALETTE_ICON = '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.5 1.5-1.5H16a6 6 0 0 0 6-6c0-4.4-4.5-8-10-8z"/>';
const THEME_ICON = {
  system: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  catppuccin: PALETTE_ICON,
  dracula: PALETTE_ICON,
  nord: PALETTE_ICON,
  colorblind: PALETTE_ICON,
  custom: PALETTE_ICON
};
// Proper names stay untranslated; generic names are localized via the catalog.
const THEME_PROPER = { catppuccin: 'Catppuccin', dracula: 'Dracula', nord: 'Nord' };
function themeLabel(state) { return THEME_PROPER[state] || tr('theme.' + state); }

function applyTheme(state) {
  const root = document.documentElement;
  if (state === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', state);
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (icon) icon.innerHTML = THEME_ICON[state] || PALETTE_ICON;
  if (label) label.textContent = themeLabel(state);
}

function syncThemeControls(theme) {
  document.querySelectorAll('#set-theme [data-theme]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
  const editor = document.getElementById('custom-editor');
  if (editor) editor.hidden = theme !== 'custom';
}

const CUSTOM_VAR = {
  bg: '--c-bg', surface: '--c-surface', brand: '--c-brand',
  accent: '--c-accent', text: '--c-text', danger: '--c-danger'
};

// Push the 6 curated colours onto :root so the [data-theme="custom"] rules
// (which derive the rest via color-mix) have values to work from.
function applyCustomVars(custom) {
  const colors = PIE_SETTINGS.sanitizeCustomTheme(custom);
  const style = document.documentElement.style;
  Object.keys(CUSTOM_VAR).forEach((k) => style.setProperty(CUSTOM_VAR[k], colors[k]));
  const sw = document.querySelector('#set-theme [data-theme="custom"] .sw-prev');
  if (sw && sw.children.length >= 3) {
    sw.children[0].style.background = colors.brand;
    sw.children[1].style.background = colors.surface;
    sw.children[2].style.background = colors.bg;
  }
  return colors;
}

async function setTheme(theme) {
  if (!THEME_ORDER.includes(theme)) return;
  applyTheme(theme);
  syncThemeControls(theme);
  popupSettings = await PIE_SETTINGS.save({ theme });
}

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Background animation only runs when the master "Smooth animations" toggle is on
// and the OS isn't requesting reduced motion.
function applyBackgroundFx() {
  const s = popupSettings || {};
  const on = s.animations !== false && !prefersReducedMotion();
  document.body.dataset.anim = on ? (s.backgroundAnim || 'particles') : 'none';
}

function applyMotion(enabled) {
  document.documentElement.classList.toggle('reduce-motion', enabled === false);
  applyBackgroundFx();
}

function applyStaticI18n() {
  if (typeof PIE_I18N === 'undefined') return;
  PIE_I18N.applyDom();
  const foot = document.getElementById('foot-status');
  if (foot) foot.textContent = tr('foot.status', { version: APP_VERSION });
  document.documentElement.lang = PIE_I18N.getLocale().replace('_', '-');
}

function populateLanguageSelect(current) {
  const sel = document.getElementById('set-language');
  if (!sel || typeof PIE_I18N === 'undefined') return;
  sel.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = tr('language.auto');
  sel.appendChild(auto);
  PIE_I18N.AVAILABLE.forEach((code) => {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = PIE_I18N.LOCALE_LABEL[code] || code;
    sel.appendChild(o);
  });
  sel.value = current || 'auto';
}

// Re-translate the whole popup after a language change, static + dynamic.
function refreshLanguage(pref) {
  if (typeof PIE_I18N === 'undefined') return;
  PIE_I18N.setLocale(pref);
  applyStaticI18n();
  populateLanguageSelect(pref);
  applyTheme(document.documentElement.getAttribute('data-theme') || 'system');
  renderAll();
  const active = document.querySelector('.tab.active');
  if (active && active.dataset.tab === 'network') renderNetwork();
}

function setupLanguage(settings) {
  populateLanguageSelect(settings.language);
  const sel = document.getElementById('set-language');
  if (sel) {
    sel.addEventListener('change', async () => {
      popupSettings = await PIE_SETTINGS.save({ language: sel.value });
      refreshLanguage(sel.value);
    });
  }
}

function openSettingsPanel() {
  closeReportPanel();
  closeHeadMenu();
  document.body.classList.add('settings-open');
  document.getElementById('settings-panel').hidden = false;
}

function closeSettingsPanel() {
  document.body.classList.remove('settings-open');
  document.getElementById('settings-panel').hidden = true;
}

function syncBgAnimControls(anim) {
  document.querySelectorAll('#set-bganim [data-anim]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.anim === (anim || 'particles'));
  });
}

// Live-preview colours on `input`; persist (and lock in the custom theme) on
// `change` to stay well under chrome.storage.sync write limits.
function bindCustomEditor(initial) {
  let working = PIE_SETTINGS.sanitizeCustomTheme(initial);
  const inputs = document.querySelectorAll('#custom-editor input[type="color"]');

  inputs.forEach((inp) => {
    const key = inp.dataset.key;
    if (working[key]) inp.value = working[key];

    inp.addEventListener('input', () => {
      working = { ...working, [key]: inp.value };
      applyCustomVars(working);
      if (document.documentElement.getAttribute('data-theme') !== 'custom') {
        applyTheme('custom');
        syncThemeControls('custom');
      }
    });

    inp.addEventListener('change', async () => {
      working = { ...working, [key]: inp.value };
      popupSettings = await PIE_SETTINGS.save({ theme: 'custom', customTheme: working });
    });
  });

  const resetBtn = document.getElementById('ce-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      working = { ...PIE_SETTINGS.DEFAULT_CUSTOM_THEME };
      inputs.forEach((inp) => { if (working[inp.dataset.key]) inp.value = working[inp.dataset.key]; });
      applyCustomVars(working);
      applyTheme('custom');
      syncThemeControls('custom');
      popupSettings = await PIE_SETTINGS.save({ theme: 'custom', customTheme: working });
    });
  }
}

function bindSettingsControls(settings) {
  const notifEl = document.getElementById('set-notifications');
  const ipEl = document.getElementById('set-ip');
  const myIpEl = document.getElementById('set-myip');
  const netEl = document.getElementById('set-network');
  const animEl = document.getElementById('set-animations');
  const bannerEl = document.getElementById('set-bannerhide');
  const badgeEl = document.getElementById('set-badge');
  const autoCleanEl = document.getElementById('set-autoclean');
  const digestEl = document.getElementById('set-digest');
  const cleanNowBtn = document.getElementById('clean-now');
  const cleanResult = document.getElementById('clean-result');
  const allowlistInput = document.getElementById('allowlist-input');
  const allowlistAdd = document.getElementById('allowlist-add');
  const allowlistAddSite = document.getElementById('allowlist-add-site');
  const allowlistList = document.getElementById('allowlist-list');
  const allowlistMsg = document.getElementById('allowlist-msg');
  if (notifEl) notifEl.checked = settings.thirdPartyNotifications;
  if (ipEl) ipEl.checked = settings.ipLookupEnabled;
  if (myIpEl) myIpEl.checked = settings.myIpLookupEnabled;
  if (netEl) netEl.checked = settings.networkMonitoring;
  if (animEl) animEl.checked = settings.animations;
  if (bannerEl) bannerEl.checked = settings.bannerAutoHide;
  if (badgeEl) badgeEl.checked = settings.trackerBadge;
  if (autoCleanEl) autoCleanEl.checked = settings.autoClean;
  if (digestEl) digestEl.checked = settings.weeklyDigestEnabled !== false;
  applyCustomVars(settings.customTheme);
  syncThemeControls(settings.theme);
  syncBgAnimControls(settings.backgroundAnim);

  function setAllowlistMsg(text) {
    if (allowlistMsg) allowlistMsg.textContent = text || '';
  }

  function renderAllowlist(list) {
    if (!allowlistList) return;
    const domains = Array.isArray(list) ? list : [];
    allowlistList.innerHTML = '';
    if (!domains.length) {
      const empty = document.createElement('li');
      empty.className = 'allowlist-empty';
      empty.textContent = tr('settings.allowlistEmpty');
      allowlistList.appendChild(empty);
      allowlistList.classList.add('is-empty');
      return;
    }
    allowlistList.classList.remove('is-empty');
    domains.forEach((domain) => {
      const li = document.createElement('li');
      li.className = 'allowlist-item';
      const span = document.createElement('span');
      span.textContent = domain;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'allowlist-remove';
      btn.textContent = tr('settings.allowlistRemove');
      btn.setAttribute('aria-label', tr('settings.allowlistRemove') + ': ' + domain);
      btn.addEventListener('click', async () => {
        const next = (popupSettings.autoCleanAllowlist || []).filter((d) => d !== domain);
        popupSettings = await PIE_SETTINGS.save({ autoCleanAllowlist: next });
        setAllowlistMsg('');
        renderAllowlist(popupSettings.autoCleanAllowlist);
      });
      li.appendChild(span);
      li.appendChild(btn);
      allowlistList.appendChild(li);
    });
  }

  async function addAllowlistDomain(raw) {
    const domain = PIE_SETTINGS.normalizeAllowlistEntry(raw);
    if (!domain) {
      setAllowlistMsg(tr('settings.allowlistInvalid'));
      return;
    }
    const cur = popupSettings.autoCleanAllowlist || [];
    if (cur.indexOf(domain) !== -1) {
      setAllowlistMsg('');
      if (allowlistInput) allowlistInput.value = '';
      renderAllowlist(cur);
      return;
    }
    popupSettings = await PIE_SETTINGS.save({ autoCleanAllowlist: cur.concat([domain]) });
    if (allowlistInput) allowlistInput.value = '';
    setAllowlistMsg('');
    renderAllowlist(popupSettings.autoCleanAllowlist);
  }

  renderAllowlist(settings.autoCleanAllowlist);
  if (allowlistAddSite) {
    allowlistAddSite.disabled = !currentSiteHost;
    allowlistAddSite.title = currentSiteHost || '';
  }

  document.querySelectorAll('#set-theme [data-theme]').forEach((btn) => {
    btn.addEventListener('click', () => setTheme(btn.dataset.theme));
  });

  bindCustomEditor(settings.customTheme);

  document.querySelectorAll('#set-bganim [data-anim]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const anim = btn.dataset.anim;
      syncBgAnimControls(anim);
      popupSettings = await PIE_SETTINGS.save({ backgroundAnim: anim });
      applyBackgroundFx();
    });
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

  if (myIpEl) {
    myIpEl.addEventListener('change', async () => {
      popupSettings = await PIE_SETTINGS.save({ myIpLookupEnabled: myIpEl.checked });
      await refreshMyIp();
      renderOverview();
      renderSecurity();
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
      popupSettings = await PIE_SETTINGS.save({ animations: animEl.checked });
      applyMotion(animEl.checked);
    });
  }

  if (bannerEl) {
    bannerEl.addEventListener('change', async () => {
      popupSettings = await PIE_SETTINGS.save({ bannerAutoHide: bannerEl.checked });
    });
  }

  if (badgeEl) {
    badgeEl.addEventListener('change', async () => {
      popupSettings = await PIE_SETTINGS.save({ trackerBadge: badgeEl.checked });
    });
  }

  if (autoCleanEl) {
    autoCleanEl.addEventListener('change', async () => {
      popupSettings = await PIE_SETTINGS.save({ autoClean: autoCleanEl.checked });
    });
  }

  if (digestEl) {
    digestEl.addEventListener('change', async () => {
      popupSettings = await PIE_SETTINGS.save({ weeklyDigestEnabled: digestEl.checked });
      renderOverviewDigest();
    });
  }

  if (allowlistAdd) {
    allowlistAdd.addEventListener('click', () => {
      addAllowlistDomain(allowlistInput ? allowlistInput.value : '');
    });
  }
  if (allowlistInput) {
    allowlistInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addAllowlistDomain(allowlistInput.value);
      }
    });
  }
  if (allowlistAddSite) {
    allowlistAddSite.addEventListener('click', () => {
      if (!currentSiteHost) {
        setAllowlistMsg(tr('settings.allowlistInvalid'));
        return;
      }
      addAllowlistDomain(currentSiteHost);
    });
  }

  if (cleanNowBtn) {
    cleanNowBtn.addEventListener('click', () => {
      cleanNowBtn.disabled = true;
      if (cleanResult) cleanResult.textContent = tr('settings.cleaning');
      try {
        chrome.runtime.sendMessage({ type: 'CLEAN_TRACKER_COOKIES' }, (resp) => {
          cleanNowBtn.disabled = false;
          if (chrome.runtime.lastError) {
            if (cleanResult) cleanResult.textContent = tr('settings.cleanError');
            return;
          }
          const n = (resp && resp.removed) || 0;
          if (cleanResult) {
            cleanResult.textContent = n > 0 ? trn('settings.cleanResult', n) : tr('settings.cleanNone');
          }
          if (n > 0) showCookies();
        });
      } catch (_) {
        cleanNowBtn.disabled = false;
        if (cleanResult) cleanResult.textContent = tr('settings.cleanError');
      }
    });
  }
}

function setupSettingsPanel() {
  const backBtn = document.getElementById('settings-back');
  if (backBtn) backBtn.addEventListener('click', closeSettingsPanel);

  const reportBtn = document.getElementById('report-btn');
  const footReport = document.getElementById('foot-report');
  if (reportBtn) reportBtn.addEventListener('click', openReportPanel);
  if (footReport) footReport.addEventListener('click', openReportPanel);
}

document.addEventListener('DOMContentLoaded', async () => {
  popupSettings = await PIE_SETTINGS.load();
  if (typeof PIE_I18N !== 'undefined') PIE_I18N.setLocale(popupSettings.language);
  applyStaticI18n();
  applyCustomVars(popupSettings.customTheme);
  applyMotion(popupSettings.animations);
  applyBackgroundFx();
  setupTabs(popupSettings.defaultTab);
  setupTheme(popupSettings.theme);
  setupLanguage(popupSettings);
  bindSettingsControls(popupSettings);
  setupSettingsPanel();
  setupHeadMenu();
  setupReportPanel();
  showCookies();
});
