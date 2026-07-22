/*
 * P.I.E exit-IP unit tests. Run: node tests/exit-ip.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'exit-ip.js'), 'utf8');
const ctx = { globalThis: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'exit-ip.js' });
const E = ctx.PIE_EXIT_IP;

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + '  => ' + JSON.stringify(got)); }
};

const sample = [
  'fl=1',
  'h=www.cloudflare.com',
  'ip=203.0.113.10',
  'ts=1',
  'loc=SG',
  'colo=SIN',
  'warp=off',
  ''
].join('\n');

const parsed = E.parseCloudflareTrace(sample);
ok('parse ip', parsed.ip === '203.0.113.10', parsed);
ok('parse loc', parsed.loc === 'SG', parsed);
ok('parse warp off', parsed.warp === false, parsed);

const warpOn = E.parseCloudflareTrace('ip=1.2.3.4\nwarp=on\n');
ok('parse warp on', warpOn.warp === true && warpOn.ip === '1.2.3.4', warpOn);

ok('ptr IPv4', E.ptrNameForIp('1.2.3.4') === '4.3.2.1.in-addr.arpa');
ok('ptr IPv6 expands', !!E.ptrNameForIp('2001:db8::1') && E.ptrNameForIp('2001:db8::1').endsWith('.ip6.arpa'));

ok('classify warp', E.classifyExit({ ip: '1.1.1.1', warp: true }).kind === 'warp');
ok('classify vpn ptr', E.classifyExit({ ip: '1.2.3.4', ptr: 'exit.nordvpn.com' }).kind === 'vpn_like');
ok('classify datacenter ptr', E.classifyExit({ ip: '1.2.3.4', ptr: 'ec2.compute.amazonaws.com' }).kind === 'vpn_like');
ok('classify residential', E.classifyExit({ ip: '8.8.8.8', ptr: 'dns.google' }).kind === 'residential_like');
ok('classify unknown empty', E.classifyExit({}).kind === 'unknown');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
console.log('All exit-ip tests passed.');
