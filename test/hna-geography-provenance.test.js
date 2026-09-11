'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GP = require('../js/hna/geography-provenance.js');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('hna-geography-provenance');

run('every level resolves to a label and a tone', () => {
  GP.LEVELS.forEach((level) => {
    const d = GP.describe({ level });
    assert.ok(d.label, level + ' has a label');
    assert.ok(d.tone, level + ' has a tone');
    assert.ok(d.title && d.title.length > 20, level + ' has an explanatory title');
  });
});

run('an unknown level degrades to unavailable rather than rendering blank', () => {
  ['', null, undefined, 'tract', 'PLACE!'].forEach((level) => {
    const d = GP.describe({ level });
    assert.equal(d.level, 'unavailable');
    assert.equal(d.label, 'No local data');
  });
});

run('apportioned names the tract count and singularises correctly', () => {
  assert.equal(GP.describe({ level: 'apportioned', tractCount: 12 }).label, 'From 12 tracts');
  assert.equal(GP.describe({ level: 'apportioned', tractCount: 1 }).label, 'From 1 tract');
});

run('a single-tract place is explicitly called out as indicative', () => {
  const one = GP.describe({ level: 'apportioned', tractCount: 1 });
  const many = GP.describe({ level: 'apportioned', tractCount: 9 });
  assert.match(one.title, /only one tract/i, 'single-tract places warn in the tooltip');
  assert.doesNotMatch(many.title, /only one tract/i, 'multi-tract places do not');
});

run('a null or zero tract count never renders "from 0 tracts"', () => {
  // isFinite(null) === true because Number(null) === 0 — the exact trap this
  // codebase keeps hitting. Number.isFinite is required here.
  [null, undefined, 0, '', NaN, 'abc', -3].forEach((bad) => {
    const d = GP.describe({ level: 'apportioned', tractCount: bad });
    assert.equal(d.tractCount, null, JSON.stringify(bad) + ' yields no count');
    assert.equal(d.label, 'Apportioned', JSON.stringify(bad) + ' falls back to a countless label');
    assert.doesNotMatch(d.label, /\b0\b/, 'never prints a zero count');
  });
});

run('county-proxy names the county it borrowed from', () => {
  const d = GP.describe({ level: 'county-proxy', countyName: 'Boulder County', metric: 'Cost burden' });
  assert.match(d.title, /Boulder County/);
  assert.equal(d.label, 'County proxy');
});

run('county-proxy still reads sensibly with no county name', () => {
  const d = GP.describe({ level: 'county-proxy' });
  assert.match(d.title, /containing county/i);
});

run('place and county carry distinct tones so they are visually separable', () => {
  const tones = GP.LEVELS.map((level) => GP.describe({ level }).tone);
  assert.equal(new Set(tones).size >= 4, true, 'at least four distinct tones');
  assert.notEqual(GP.describe({ level: 'place' }).tone, GP.describe({ level: 'county-proxy' }).tone);
});

run('chipHtml escapes injected content', () => {
  const html = GP.chipHtml({ level: 'county-proxy', countyName: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(html, /<img/, 'no raw tag survives');
  assert.match(html, /&lt;img/, 'the tag is escaped into the title');
});

run('chipHtml accepts either a descriptor or a describe() input', () => {
  const viaInput = GP.chipHtml({ level: 'place' });
  const viaDesc = GP.chipHtml(GP.describe({ level: 'place' }));
  assert.equal(viaInput, viaDesc);
  assert.match(viaInput, /data-geo-level="place"/);
  assert.match(viaInput, /data-tone="local"/);
});

run('fromPlaceChasRecord reads either snake or camel tract counts', () => {
  assert.equal(GP.fromPlaceChasRecord({ tract_count: 4 }).label, 'From 4 tracts');
  assert.equal(GP.fromPlaceChasRecord({ tractCount: 4 }).label, 'From 4 tracts');
  assert.equal(GP.fromPlaceChasRecord(null), null, 'no record yields no claim');
});

run('real place-chas records all resolve to a usable chip', () => {
  const file = path.join(ROOT, 'data/hna/place-chas.json');
  const places = JSON.parse(fs.readFileSync(file, 'utf8')).places || {};
  const ids = Object.keys(places);
  assert.ok(ids.length > 400, 'expected the full place-CHAS set');
  let single = 0;
  ids.forEach((id) => {
    const d = GP.fromPlaceChasRecord(places[id]);
    assert.ok(d && d.label, id + ' resolves to a chip');
    assert.doesNotMatch(d.label, /NaN|undefined|from 0/i, id + ' renders a clean label');
    if (d.tractCount === 1) single += 1;
  });
  // Guards the premise of the single-tract warning: if apportionment ever
  // stops producing single-tract places this test should be revisited, not
  // silently kept alive.
  assert.ok(single > 100, 'single-tract places exist and are worth warning about (found ' + single + ')');
});

run('every chip tone has a CSS rule backing it', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/pages/housing-needs-assessment.css'), 'utf8');
  const tones = new Set(GP.LEVELS.map((level) => GP.describe({ level }).tone));
  tones.forEach((tone) => {
    assert.ok(css.includes('data-tone="' + tone + '"'),
      'tone "' + tone + '" is styled in housing-needs-assessment.css');
  });
  assert.ok(css.includes('.geo-chip'), 'the chip itself is styled');
});

if (failures) { console.error('hna-geography-provenance: FAIL'); process.exitCode = 1; }
else console.log('hna-geography-provenance: PASS');
