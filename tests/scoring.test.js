/*
 * P.I.E scoring unit tests (two-axis: Sensitivity + Tracking).
 *
 * No framework / build step - plain Node. Run from the repo root:
 *     node tests/scoring.test.js
 *
 * It loads the real cookie-database.js and popup.js into a sandbox with minimal
 * stubs for the browser APIs, then calls the actual scoring functions. Exit code
 * is non-zero if any assertion fails, so it can gate a release.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');
const dbSrc = fs.readFileSync(path.join(repoRoot, 'cookie-database.js'), 'utf8');
const popupSrc = fs.readFileSync(path.join(repoRoot, 'popup.js'), 'utf8');

// ---- Minimal browser stubs so popup.js loads headlessly ----
const noop = () => {};
function elStub() {
  return {
    style: {}, classList: { add: noop, remove: noop },
    addEventListener: noop, appendChild: noop, setAttribute: noop,
    set innerHTML(v) {}, get innerHTML() { return ''; },
    set textContent(v) {}, get textContent() { return ''; },
    querySelector: () => null
  };
}
const ctx = {};
ctx.window = ctx;                       // so `window.PIE_COOKIE_DB` resolves to this context
ctx.console = console;
ctx.setTimeout = setTimeout;
ctx.atob = (s) => Buffer.from(s, 'base64').toString('binary');
ctx.navigator = { clipboard: { writeText: async () => {} } };
ctx.fetch = async () => ({ json: async () => ({}) });
ctx.document = {
  addEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
  getElementById: () => elStub(), createElement: () => elStub()
};
ctx.chrome = {
  runtime: { onMessage: { addListener: noop }, sendMessage: () => ({ catch: noop }) },
  tabs: { query: async () => [{}], onUpdated: { addListener: noop } },
  cookies: { getAll: async () => [], remove: async () => {} },
  action: {}
};
vm.createContext(ctx);

// Concatenate DB + popup + the assertions so the test code shares popup.js's
// top-level lexical scope (lets it read/set `currentSiteHost` and call the funcs).
const assertions = `
;(() => {
  let pass = 0, fail = 0;
  const ok = (name, cond, got) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + '  => ' + JSON.stringify(got)); }
  };

  currentSiteHost = 'github.com';

  // --- database sanity ---
  ok('DB has >250 exact entries', Object.keys(COOKIE_DB.exact).length > 250, Object.keys(COOKIE_DB.exact).length);
  ok('DB has wildcard entries', Object.keys(COOKIE_DB.wildcard).length >= 20, Object.keys(COOKIE_DB.wildcard).length);

  // --- Sensitivity axis (content only; entropy/identifiers must NOT count) ---
  ok('email -> sensitivity high', sensitivityLevel(detectPII({ name: 'sid', value: 'user=jeff@example.com' })) === 'high');
  ok('random UUID -> sensitivity none (regression: was MODERATE)', detectPII({ name: 'x', value: '256c18e8-d881-11e9-8a34-2a2ae2dbcce4' }).length === 0);
  ok('long hex -> sensitivity none (regression)', detectPII({ name: 'x', value: 'a94f8b2c1de0347fa94f8b2c1de0347f' }).length === 0);
  ok('high-entropy token -> sensitivity none (regression)', detectPII({ name: 'x', value: 'Zx9Kq2Lm8Pw4Rt6Yv1Bn3Cd5Ef7Gh0' }).length === 0);
  ok('Luhn-valid card -> sensitivity high', sensitivityLevel(detectPII({ name: 'x', value: '4111111111111111' })) === 'high');

  // --- Tracking axis (DB lookup) ---
  const ga = classifyTracking({ name: '_ga', domain: '.github.com' });
  ok('_ga -> known Analytics tracker (Google)', ga.known && ga.category === 'Analytics' && ga.level === 'medium' && /Google/.test(ga.platform), ga);
  ok('_ga value -> sensitivity none (headline fix)', sensitivityLevel(detectPII({ name: '_ga', value: 'GA1.2.1993.1699' })) === 'none');
  const fbp = classifyTracking({ name: '_fbp', domain: '.facebook.com' });
  ok('_fbp -> Marketing high (Facebook)', fbp.category === 'Marketing' && fbp.level === 'high', fbp);
  ok('_gac_<id> -> wildcard match, Marketing high', (() => { const g = classifyTracking({ name: '_gac_1699123', domain: '.x.com' }); return g.known && g.category === 'Marketing' && g.level === 'high'; })());
  ok('case-insensitive lookup (_GA)', classifyTracking({ name: '_GA', domain: '.github.com' }).known === true);
  const fp = classifyTracking({ name: 'my_app_session', domain: 'github.com' });
  ok('first-party unknown -> not a tracker', fp.known === false && fp.level === 'none' && fp.thirdParty === false, fp);
  const tp = classifyTracking({ name: 'zz_unknown_9', domain: 'ads.evil-example.org' });
  ok('third-party unknown -> possible (low), unclassified', tp.known === false && tp.level === 'low' && tp.thirdParty === true, tp);

  // --- overall roll-ups ---
  const os = overallSensitivity([{ name: 'sid', value: 'jeff@example.com' }, { name: 'g', value: '256c18e8-d881-11e9-8a34-2a2ae2dbcce4' }]);
  ok('overallSensitivity -> high, 1 PII cookie', os.level === 'high' && os.count === 1, os);
  const ot = overallTracking([{ name: '_ga', domain: '.github.com' }, { name: '_fbp', domain: '.facebook.com' }, { name: 'my_app_session', domain: 'github.com' }]);
  ok('overallTracking -> high, 2 known trackers', ot.level === 'high' && ot.knownTrackers === 2, ot);

  console.log('\\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) { throw new Error(fail + ' scoring test(s) failed'); }
})();
`;

try {
  vm.runInContext(dbSrc + '\n' + popupSrc + '\n' + assertions, ctx, { filename: 'pie-scoring-combined.js' });
  console.log('All scoring tests passed.');
} catch (e) {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
}
