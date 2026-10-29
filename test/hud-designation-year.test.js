'use strict';
// A HUD layer's name is not the year of the designations in it: on 2026-10-23
// HUD loaded the 2027 QCT and DDA lists into the layers named 2026. The cache
// workflow must keep the 2026 file until January, then label the new content 2027.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveDesignationYear, cachedDesignationYear, featureKey } = require('../scripts/hud/designation-year.js');

const DDA_2026 = ['NM:Crowley', 'NM:Eagle', 'NM:San Miguel', 'SA:80129'];
const DDA_2027 = ['NM:Archuleta', 'NM:Chaffee', 'NM:Crowley', 'NM:Eagle', 'SA:80433'];

test('next year\'s list in this year\'s layer is not written before January', () => {
  const r = resolveDesignationYear({ layerYear: 2026, thisYear: 2026, cachedYear: 2026, cachedKeys: DDA_2026, fetchedKeys: DDA_2027 });
  assert.equal(r.write, false);
  assert.equal(r.year, 2027);
});

test('in January the same layer is written as the new year', () => {
  const r = resolveDesignationYear({ layerYear: 2026, thisYear: 2027, cachedYear: 2026, cachedKeys: DDA_2026, fetchedKeys: DDA_2027 });
  assert.deepEqual([r.write, r.year], [true, 2027]);
});

test('unchanged content keeps the cached year, whatever the layer is named', () => {
  const later = resolveDesignationYear({ layerYear: 2026, thisYear: 2027, cachedYear: 2027, cachedKeys: DDA_2027, fetchedKeys: [...DDA_2027].reverse() });
  assert.deepEqual([later.write, later.year], [true, 2027]);
});

test('a correctly named new layer gives its own year', () => {
  const r = resolveDesignationYear({ layerYear: 2028, thisYear: 2028, cachedYear: 2027, cachedKeys: DDA_2027, fetchedKeys: DDA_2026 });
  assert.deepEqual([r.write, r.year], [true, 2028]);
});

test('with no cached year the layer name is used', () => {
  const r = resolveDesignationYear({ layerYear: 2026, thisYear: 2026, cachedYear: null, cachedKeys: null, fetchedKeys: DDA_2027 });
  assert.deepEqual([r.write, r.year], [true, 2026]);
});

test('keys and cached years read the repo\'s own files', () => {
  for (const f of ['qct-colorado.json', 'dda-colorado.json']) {
    const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8'));
    assert.ok(Number.isInteger(cachedDesignationYear(doc)), `${f} year readable`);
    const keys = doc.features.map(featureKey);
    assert.ok(new Set(keys).size > 10, `${f} keys distinguish features`); // a ZIP DDA can span several rows
    assert.ok(keys.every((k) => !/undefined|null|:$/.test(k)), `${f} keys complete`);
  }
});

test('both fetch steps in the workflow use the guard', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'cache-hud-gis-data.yml'), 'utf8');
  assert.equal((wf.match(/resolveDesignationYear\(\{/g) || []).length, 2);
  assert.equal((wf.match(/designationYear: r\.year/g) || []).length, 2);
  assert.ok(!/designationYear: year,/.test(wf), 'no step labels by layer name');
});

test('the Deal Calculator notes the 2027 DDA changes until the site carries the 2027 list', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'deal-calculator.js'), 'utf8');
  const dda = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dda-colorado.json'), 'utf8'));
  const has = js.includes('id="dc-dda-2027"');
  if (cachedDesignationYear(dda) >= 2027) {
    assert.ok(!has, 'data/dda-colorado.json now holds the 2027 list: remove the dc-dda-2027 note');
    return;
  }
  assert.ok(has, 'dc-dda-2027 note present');
  // Each change in the note, checked against the 2026 file it describes as changing.
  const counties = new Set(dda.features.filter((f) => f.properties.DDA_TYPE === 'NM').map((f) => f.properties.NAME));
  const zips = new Set(dda.features.filter((f) => f.properties.DDA_TYPE === 'SA').map((f) => f.properties.ZCTA5));
  for (const c of ['Archuleta', 'Chaffee']) assert.ok(!counties.has(c + ' County'), `${c} is new in 2027`);
  assert.ok(counties.has('San Miguel County'), 'San Miguel is in the 2026 list');
  assert.ok(!zips.has('80433'));
  for (const z of ['80129', '80249', '80465', '80913']) assert.ok(zips.has(z), `${z} is in the 2026 list`);
});
