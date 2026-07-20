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
