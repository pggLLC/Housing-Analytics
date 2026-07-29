const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/*
 * V-PERF-2 guard: the affordability-ratio choropleth on colorado-deep-dive
 * pulls a ~16 MB tract-boundary GeoJSON and sits below the fold, so its fetch
 * must stay off the affordability tab's critical path — deferred until the map
 * scrolls into view via IntersectionObserver. This guard fails if the render
 * (and therefore the 16 MB fetch) is wired back to eager boot.
 */
const js = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'colorado-deep-dive.js'),
  'utf8'
);

assert.ok(
  js.includes('function deferUntilVisible'),
  'deferUntilVisible lazy-load helper must exist.'
);

assert.ok(
  js.includes('IntersectionObserver'),
  'Lazy-load must use IntersectionObserver.'
);

assert.match(
  js,
  /deferUntilVisible\(\s*'affRatioMap'\s*,[\s\S]{0,200}renderRatioMap\s*\(/,
  "renderRatioMap (the 16 MB tract-boundary fetch) must be wrapped in deferUntilVisible('affRatioMap', …), not called eagerly at boot."
);

console.log('Deep-dive lazy tract-boundary guard passed.');
