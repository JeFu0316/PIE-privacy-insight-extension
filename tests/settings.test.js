/*
 * P.I.E settings unit tests. Run: node tests/settings.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');
const settingsSrc = fs.readFileSync(path.join(repoRoot, 'settings.js'), 'utf8');

let stored = {};
const ctx = {
  URL,
  chrome: {
  storage: {
    sync: {
      get: async (key) => ({ [key]: stored[key] }),
      set: async (obj) => { Object.assign(stored, obj); }
    }
  }
}};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(settingsSrc, ctx, { filename: 'settings.js' });

const { PIE_SETTINGS } = ctx;

(async () => {
  let pass = 0, fail = 0;
  const ok = (name, cond, got) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + '  => ' + JSON.stringify(got)); }
  };

  ok('defaults applied when empty', PIE_SETTINGS.mergeWithDefaults(null).theme === 'system');
  ok('invalid theme rejected', PIE_SETTINGS.mergeWithDefaults({ theme: 'neon' }).theme === 'system');
  ok('valid theme kept', PIE_SETTINGS.mergeWithDefaults({ theme: 'dark' }).theme === 'dark');
  ok('extended theme catppuccin kept', PIE_SETTINGS.mergeWithDefaults({ theme: 'catppuccin' }).theme === 'catppuccin');
  ok('extended theme nord kept', PIE_SETTINGS.mergeWithDefaults({ theme: 'nord' }).theme === 'nord');
  ok('extended theme colorblind kept', PIE_SETTINGS.mergeWithDefaults({ theme: 'colorblind' }).theme === 'colorblind');
  ok('bannerAutoHide default off', PIE_SETTINGS.mergeWithDefaults(null).bannerAutoHide === false);
  ok('bannerAutoHide can enable', PIE_SETTINGS.mergeWithDefaults({ bannerAutoHide: true }).bannerAutoHide === true);
  ok('bannerAutoHide ignores non-boolean', PIE_SETTINGS.mergeWithDefaults({ bannerAutoHide: 'yes' }).bannerAutoHide === false);
  ok('trackerBadge default on', PIE_SETTINGS.mergeWithDefaults(null).trackerBadge === true);
  ok('trackerBadge can disable', PIE_SETTINGS.mergeWithDefaults({ trackerBadge: false }).trackerBadge === false);
  ok('autoClean default off', PIE_SETTINGS.mergeWithDefaults(null).autoClean === false);
  ok('autoClean can enable', PIE_SETTINGS.mergeWithDefaults({ autoClean: true }).autoClean === true);
  ok('autoCleanAllowlist default empty array', Array.isArray(PIE_SETTINGS.mergeWithDefaults(null).autoCleanAllowlist) && PIE_SETTINGS.mergeWithDefaults(null).autoCleanAllowlist.length === 0);
  ok('autoCleanAllowlist keeps string entries', (() => { const a = PIE_SETTINGS.mergeWithDefaults({ autoCleanAllowlist: ['example.com', 5, '', 'foo.org'] }).autoCleanAllowlist; return a.length === 2 && a[0] === 'example.com' && a[1] === 'foo.org'; })());
  ok('autoCleanAllowlist ignores non-array', Array.isArray(PIE_SETTINGS.mergeWithDefaults({ autoCleanAllowlist: 'nope' }).autoCleanAllowlist) && PIE_SETTINGS.mergeWithDefaults({ autoCleanAllowlist: 'nope' }).autoCleanAllowlist.length === 0);
  ok('normalize bare host', PIE_SETTINGS.normalizeAllowlistEntry('DoubleClick.net') === 'doubleclick.net');
  ok('normalize www host to base', PIE_SETTINGS.normalizeAllowlistEntry('www.google-analytics.com') === 'google-analytics.com');
  ok('normalize URL to base', PIE_SETTINGS.normalizeAllowlistEntry('https://sub.tracker.example.com/path?x=1') === 'example.com');
  ok('normalize co.uk base', PIE_SETTINGS.normalizeAllowlistEntry('https://ads.foo.co.uk/x') === 'foo.co.uk');
  ok('normalize rejects junk', PIE_SETTINGS.normalizeAllowlistEntry('not a domain') === '' && PIE_SETTINGS.normalizeAllowlistEntry('') === '' && PIE_SETTINGS.normalizeAllowlistEntry('localhost') === '');
  ok('sanitizeAllowlist dedupes', (() => {
    const a = PIE_SETTINGS.sanitizeAllowlist(['https://www.example.com/a', 'example.com', 'EXAMPLE.com', 'bad']);
    return a.length === 1 && a[0] === 'example.com';
  })());
  ok('merge normalizes allowlist', (() => {
    const a = PIE_SETTINGS.mergeWithDefaults({ autoCleanAllowlist: ['https://www.ads.google.com/x', 'ads.google.com'] }).autoCleanAllowlist;
    return a.length === 1 && a[0] === 'google.com';
  })());
  ok('extended theme custom kept', PIE_SETTINGS.mergeWithDefaults({ theme: 'custom' }).theme === 'custom');

  ok('language default auto', PIE_SETTINGS.mergeWithDefaults(null).language === 'auto');
  ok('language valid kept (zh_CN)', PIE_SETTINGS.mergeWithDefaults({ language: 'zh_CN' }).language === 'zh_CN');
  ok('language valid kept (ru)', PIE_SETTINGS.mergeWithDefaults({ language: 'ru' }).language === 'ru');
  ok('language invalid rejected', PIE_SETTINGS.mergeWithDefaults({ language: 'klingon' }).language === 'auto');
  ok('myIpLookupEnabled default off', PIE_SETTINGS.mergeWithDefaults(null).myIpLookupEnabled === false);
  ok('myIpLookupEnabled can enable', PIE_SETTINGS.mergeWithDefaults({ myIpLookupEnabled: true }).myIpLookupEnabled === true);
  ok('weeklyDigestEnabled default on', PIE_SETTINGS.mergeWithDefaults(null).weeklyDigestEnabled === true);
  ok('weeklyDigestEnabled can disable', PIE_SETTINGS.mergeWithDefaults({ weeklyDigestEnabled: false }).weeklyDigestEnabled === false);
  ok('weeklyDigestEnabled ignores non-boolean', PIE_SETTINGS.mergeWithDefaults({ weeklyDigestEnabled: 'no' }).weeklyDigestEnabled === true);

  ok('trackerBlock default off', PIE_SETTINGS.mergeWithDefaults(null).trackerBlock === false);
  ok('trackerBlock can enable', PIE_SETTINGS.mergeWithDefaults({ trackerBlock: true }).trackerBlock === true);
  ok('fingerprintDetect default on', PIE_SETTINGS.mergeWithDefaults(null).fingerprintDetect === true);
  ok('fingerprintDetect can disable', PIE_SETTINGS.mergeWithDefaults({ fingerprintDetect: false }).fingerprintDetect === false);
  ok('fingerprintShield default off', PIE_SETTINGS.mergeWithDefaults(null).fingerprintShield === false);
  ok('fingerprintShield can enable', PIE_SETTINGS.mergeWithDefaults({ fingerprintShield: true }).fingerprintShield === true);
  ok('aiExplainEnabled default off', PIE_SETTINGS.mergeWithDefaults(null).aiExplainEnabled === false);
  ok('aiExplainEnabled can enable', PIE_SETTINGS.mergeWithDefaults({ aiExplainEnabled: true }).aiExplainEnabled === true);
  ok('betaFeatures default off', PIE_SETTINGS.mergeWithDefaults(null).betaFeatures === false);
  ok('betaFeatures can enable', PIE_SETTINGS.mergeWithDefaults({ betaFeatures: true }).betaFeatures === true);
  ok('toolbarIcon default light', PIE_SETTINGS.mergeWithDefaults(null).toolbarIcon === 'light');
  ok('toolbarIcon dark kept', PIE_SETTINGS.mergeWithDefaults({ toolbarIcon: 'dark' }).toolbarIcon === 'dark');
  ok('toolbarIcon auto kept', PIE_SETTINGS.mergeWithDefaults({ toolbarIcon: 'auto' }).toolbarIcon === 'auto');
  ok('toolbarIcon invalid rejected', PIE_SETTINGS.mergeWithDefaults({ toolbarIcon: 'neon' }).toolbarIcon === 'light');

  ok('backgroundAnim default particles', PIE_SETTINGS.mergeWithDefaults(null).backgroundAnim === 'particles');
  ok('backgroundAnim valid kept', PIE_SETTINGS.mergeWithDefaults({ backgroundAnim: 'aurora' }).backgroundAnim === 'aurora');
  ok('backgroundAnim off kept', PIE_SETTINGS.mergeWithDefaults({ backgroundAnim: 'none' }).backgroundAnim === 'none');
  ok('backgroundAnim invalid rejected', PIE_SETTINGS.mergeWithDefaults({ backgroundAnim: 'sparkle' }).backgroundAnim === 'particles');

  ok('customTheme default has 6 hex keys', (() => { const c = PIE_SETTINGS.mergeWithDefaults(null).customTheme; return PIE_SETTINGS.CUSTOM_THEME_KEYS.every((k) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c[k])); })());
  ok('customTheme keeps valid hex overrides', (() => { const c = PIE_SETTINGS.mergeWithDefaults({ customTheme: { brand: '#123abc', bg: '#000' } }).customTheme; return c.brand === '#123abc' && c.bg === '#000'; })());
  ok('customTheme rejects invalid hex, falls back', (() => { const c = PIE_SETTINGS.mergeWithDefaults({ customTheme: { brand: 'red', accent: '#zzzzzz' } }).customTheme; return c.brand === PIE_SETTINGS.DEFAULT_CUSTOM_THEME.brand && c.accent === PIE_SETTINGS.DEFAULT_CUSTOM_THEME.accent; })());
  ok('customTheme ignores non-object', (() => { const c = PIE_SETTINGS.mergeWithDefaults({ customTheme: 'nope' }).customTheme; return c.text === PIE_SETTINGS.DEFAULT_CUSTOM_THEME.text; })());
  ok('sanitizeCustomTheme drops unknown keys', (() => { const c = PIE_SETTINGS.sanitizeCustomTheme({ evil: '#fff', brand: '#abcdef' }); return c.evil === undefined && c.brand === '#abcdef'; })());

  ok('schemaVersion always current', PIE_SETTINGS.mergeWithDefaults({}).schemaVersion === PIE_SETTINGS.SCHEMA_VERSION);

  stored = {};
  const loaded = await PIE_SETTINGS.load();
  ok('load returns defaults', loaded.defaultTab === 'overview' && loaded.thirdPartyNotifications === true && loaded.ipLookupEnabled === false, loaded);

  await PIE_SETTINGS.save({ theme: 'light', ipLookupEnabled: false });
  const saved = await PIE_SETTINGS.load();
  ok('save persists partial', saved.theme === 'light' && saved.ipLookupEnabled === false, saved);
  ok('save preserves other keys', saved.defaultTab === 'overview', saved);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
  console.log('All settings tests passed.');
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
