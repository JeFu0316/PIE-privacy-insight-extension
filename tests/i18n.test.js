/*
 * P.I.E i18n unit tests. Run: node tests/i18n.test.js
 *
 * Verifies locale detection/normalization, placeholder + plural formatting,
 * fallback behaviour, and — most importantly — that every translated catalog
 * has exactly the same keys as the English source of truth (no missing keys
 * that would silently fall back, and no stray keys).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');
const i18nSrc = fs.readFileSync(path.join(repoRoot, 'i18n.js'), 'utf8');

const ctx = { navigator: { languages: ['en-US'] } };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(i18nSrc, ctx, { filename: 'i18n.js' });

const I = ctx.PIE_I18N;

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + '  => ' + JSON.stringify(got)); }
};

// --- normalize / resolve ---
ok('normalize zh-CN -> zh_CN', I.normalize('zh-CN') === 'zh_CN');
ok('normalize zh-TW -> zh_TW', I.normalize('zh-TW') === 'zh_TW');
ok('normalize zh-HK -> zh_TW', I.normalize('zh-HK') === 'zh_TW');
ok('normalize zh (bare) -> zh_CN', I.normalize('zh') === 'zh_CN');
ok('normalize ru-RU -> ru', I.normalize('ru-RU') === 'ru');
ok('normalize unknown -> null', I.normalize('xx-YY') === null);
ok('resolve explicit available', I.resolve('ru') === 'ru');
ok('resolve auto uses navigator', I.resolve('auto') === 'en');
ok('resolve unavailable falls back to detect', I.resolve('ja') === 'en' || I.AVAILABLE.indexOf('ja') !== -1);

// --- t / tn ---
I.setLocale('en');
ok('t basic', I.t('tabs.overview') === 'Overview');
ok('t missing key returns key', I.t('nope.nope') === 'nope.nope');
ok('t placeholder fill', I.t('overview.withPII', { n: 3 }) === '3 with PII');
ok('tn singular', I.tn('site.cookies', 1) === '1 cookie');
ok('tn plural', I.tn('site.cookies', 4) === '4 cookies');

I.setLocale('zh_CN');
ok('t localized (zh_CN)', I.t('tabs.security') === '安全');
ok('t fallback to en when key missing in locale', typeof I.t('foot.scoring') === 'string' && I.t('foot.scoring').length > 0);

// --- catalog completeness: every locale mirrors en's keys exactly ---
const enKeys = Object.keys(I._messages.en).sort();
Object.keys(I._messages).forEach((loc) => {
  if (loc === 'en') return;
  const keys = Object.keys(I._messages[loc]).sort();
  const missing = enKeys.filter((k) => keys.indexOf(k) === -1);
  const extra = keys.filter((k) => enKeys.indexOf(k) === -1);
  ok('catalog ' + loc + ' has no missing keys', missing.length === 0, missing);
  ok('catalog ' + loc + ' has no extra keys', extra.length === 0, extra);
});

// --- every AVAILABLE locale has a display label ---
I.AVAILABLE.forEach((loc) => {
  ok('label present for ' + loc, typeof I.LOCALE_LABEL[loc] === 'string' && I.LOCALE_LABEL[loc].length > 0);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
console.log('All i18n tests passed.');
