/*
 * P.I.E settings unit tests. Run: node tests/settings.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');
const settingsSrc = fs.readFileSync(path.join(repoRoot, 'settings.js'), 'utf8');

let stored = {};
const ctx = { chrome: {
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
  ok('extended theme custom kept', PIE_SETTINGS.mergeWithDefaults({ theme: 'custom' }).theme === 'custom');

  ok('backgroundAnim default aurora', PIE_SETTINGS.mergeWithDefaults(null).backgroundAnim === 'aurora');
  ok('backgroundAnim valid kept', PIE_SETTINGS.mergeWithDefaults({ backgroundAnim: 'particles' }).backgroundAnim === 'particles');
  ok('backgroundAnim off kept', PIE_SETTINGS.mergeWithDefaults({ backgroundAnim: 'none' }).backgroundAnim === 'none');
  ok('backgroundAnim invalid rejected', PIE_SETTINGS.mergeWithDefaults({ backgroundAnim: 'sparkle' }).backgroundAnim === 'aurora');

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
