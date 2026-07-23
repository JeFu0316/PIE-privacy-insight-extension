/*
 * Weekly digest unit tests. Run: node tests/digest.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(repoRoot, 'digest.js'), 'utf8');

const store = {};
const ctx = {
  globalThis: null,
  chrome: {
    storage: {
      local: {
        get: async (key) => ({ [key]: store[key] }),
        set: async (obj) => { Object.assign(store, obj); }
      }
    }
  }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'digest.js' });
const { PIE_DIGEST } = ctx;

(async () => {
  let pass = 0, fail = 0;
  const ok = (name, cond, got) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + '  => ' + JSON.stringify(got)); }
  };

  ok('weekId format', /^20\d{2}-W\d{2}$/.test(PIE_DIGEST.weekId(new Date('2026-07-22T12:00:00Z'))));
  ok('baseDomain simple', PIE_DIGEST.baseDomain('www.doubleclick.net') === 'doubleclick.net');
  ok('baseDomain co.uk', PIE_DIGEST.baseDomain('ads.foo.co.uk') === 'foo.co.uk');

  // Inject memory storage
  const mem = {};
  PIE_DIGEST.setStorageApi({
    get: async (key) => mem[key],
    set: async (key, value) => { mem[key] = value; }
  });

  const wid = PIE_DIGEST.weekId();
  await PIE_DIGEST.recordTracker('www.google-analytics.com');
  await PIE_DIGEST.recordTracker('stats.g.doubleclick.net');
  await PIE_DIGEST.recordTracker('www.google-analytics.com');
  let snap = await PIE_DIGEST.snapshot();
  ok('same week id', snap.weekId === wid, snap);
  ok('tracker events counted', snap.trackerEvents === 3, snap);
  ok('top trackers sorted', snap.topTrackers[0].domain === 'google-analytics.com' && snap.topTrackers[0].count === 2, snap);

  await PIE_DIGEST.recordCleaned(5);
  snap = await PIE_DIGEST.snapshot();
  ok('cookies cleaned', snap.cookiesCleaned === 5, snap);

  // Cap domains
  for (let i = 0; i < 50; i++) {
    await PIE_DIGEST.recordTracker('tracker' + i + '.example.com');
  }
  const state = await PIE_DIGEST.load();
  ok('domains capped', Object.keys(state.trackerDomains).length <= PIE_DIGEST.MAX_DOMAINS, Object.keys(state.trackerDomains).length);

  // Rollover: plant old week then load
  mem[PIE_DIGEST.STORAGE_KEY] = {
    weekId: '1999-W01',
    trackerEvents: 99,
    trackerDomains: { 'old.com': 9 },
    cookiesCleaned: 7
  };
  snap = await PIE_DIGEST.snapshot();
  ok('rollover resets events', snap.trackerEvents === 0 && snap.cookiesCleaned === 0, snap);
  ok('rollover week current', snap.weekId === wid, snap);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
  console.log('All digest tests passed.');
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
