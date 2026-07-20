/*
 * P.I.E network tracker-lookup tests. Plain Node, no framework:
 *     node tests/network.test.js
 * Loads the real tracker-domains.js and checks the domain matcher.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { self: {} };
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'tracker-domains.js'), 'utf8'), ctx);
const T = ctx.PIE_TRACKERS;

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + '  => ' + JSON.stringify(got)); }
};

ok('list has 100+ domains', T.count >= 100, T.count);

// exact + subdomain (parent-walk) matches
const cases = [
  ['www.google-analytics.com', 'Google', 'Analytics'],
  ['stats.g.doubleclick.net', 'Google (DoubleClick)', 'Advertising'],
  ['connect.facebook.net', 'Meta', 'Advertising'],
  ['px.ads.linkedin.com', 'Microsoft (LinkedIn)', 'Social'],
  ['c.clarity.ms', 'Microsoft', 'Analytics'],
  ['sub.criteo.com', 'Criteo', 'Advertising'],
  ['mc.yandex.ru', 'Yandex', 'Analytics']
];
for (const [host, company, category] of cases) {
  const r = T.lookup(host);
  ok('tracker: ' + host, !!r && r.company === company && r.category === category, r);
}

// non-trackers must return null (no false positives)
for (const host of ['example.com', 'cdn.jsdelivr.net', 'github.com', 'wikipedia.org', 'my-shop.co.uk']) {
  ok('not a tracker: ' + host, T.lookup(host) === null, T.lookup(host));
}

// robustness
ok('empty host -> null', T.lookup('') === null);
ok('trailing dot handled', !!T.lookup('google-analytics.com.'));
ok('case-insensitive', !!T.lookup('WWW.CRITEO.COM'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
