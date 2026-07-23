/*
 * clean-urls.test.js — unit tests for PIE_CLEAN_URLS.
 * Run: node --test tests/clean-urls.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync(path.join(__dirname, '..', 'clean-urls.js'), 'utf8');
// Inject URL and URLSearchParams into the VM sandbox (they're not available by default
// in vm contexts but ARE available in Chrome/extension contexts).
const ctx = { URL, URLSearchParams };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'clean-urls.js' });
const C = ctx.PIE_CLEAN_URLS;

test('clean strips utm_source', () => {
  const r = C.clean('https://example.com/page?utm_source=email&id=1');
  assert.equal(r.changed, true);
  assert.ok(r.removed.includes('utm_source'));
  assert.ok(!r.url.includes('utm_source'));
  assert.ok(r.url.includes('id=1'));
});

test('clean strips fbclid', () => {
  const r = C.clean('https://example.com/?fbclid=Abc123&q=hello');
  assert.equal(r.changed, true);
  assert.ok(r.removed.includes('fbclid'));
  assert.ok(r.url.includes('q=hello'));
});

test('clean strips gclid', () => {
  const r = C.clean('https://example.com/?gclid=xyz&page=1');
  assert.equal(r.changed, true);
  assert.ok(r.removed.includes('gclid'));
});

test('clean strips multiple tracking params', () => {
  const r = C.clean('https://site.com/?utm_source=fb&utm_campaign=sale&product=shoes');
  assert.equal(r.changed, true);
  assert.equal(r.removed.length, 2);
  assert.ok(r.url.includes('product=shoes'));
});

test('clean preserves clean URL unchanged', () => {
  const url = 'https://example.com/path?q=search&page=2';
  const r = C.clean(url);
  assert.equal(r.changed, false);
  assert.equal(r.removed.length, 0);
  assert.equal(r.url, url);
});

test('clean handles URL with no params', () => {
  const url = 'https://example.com/about';
  const r = C.clean(url);
  assert.equal(r.changed, false);
  assert.equal(r.url, url);
});

test('clean rejects non-http protocols', () => {
  const url = 'ftp://example.com/?utm_source=x';
  const r = C.clean(url);
  assert.equal(r.changed, false);
  assert.equal(r.url, url);
});

test('clean handles invalid URL gracefully', () => {
  const r = C.clean('not a url');
  assert.equal(r.changed, false);
});

test('countTrackingParams returns correct count', () => {
  assert.equal(C.countTrackingParams('https://example.com/?utm_source=fb&utm_medium=cpc&id=1'), 2);
  assert.equal(C.countTrackingParams('https://example.com/?q=hello'), 0);
  assert.equal(C.countTrackingParams('https://example.com/'), 0);
});

test('countTrackingParams handles bad URL', () => {
  assert.equal(C.countTrackingParams('garbage'), 0);
});

test('isTracking detects utm_ prefix variants', () => {
  assert.equal(C.isTracking('utm_custom'), true);
  assert.equal(C.isTracking('utm_extra_field'), true);
});

test('isTracking does not flag innocent params', () => {
  assert.equal(C.isTracking('id'), false);
  assert.equal(C.isTracking('q'), false);
  assert.equal(C.isTracking('page'), false);
  assert.equal(C.isTracking('token'), false);
});

test('clean handles msclkid', () => {
  const r = C.clean('https://example.com/?msclkid=abc&lang=en');
  assert.equal(r.changed, true);
  assert.ok(r.removed.includes('msclkid'));
  assert.ok(r.url.includes('lang=en'));
});

test('clean handles _ga', () => {
  const r = C.clean('https://example.com/?_ga=2.12345&ref=homepage');
  assert.equal(r.changed, true);
  assert.ok(r.removed.includes('_ga'));
});
