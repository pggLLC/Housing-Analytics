'use strict';

/**
 * Keeps a data source's DESCRIPTION in step with whether it actually holds data.
 *
 * data/market/parcel_aggregates_co.json has never contained a parcel. Every
 * commit in its history carries counties_successful: 0 and eight placeholder
 * records reading "fetch failed — check county ArcGIS endpoint". The inventory
 * nevertheless described it as "Eight county-level parcel and zoning aggregate
 * records" from "Loveland / Regrid" — a populated dataset from a provider that
 * has never touched this file. On the Data Trust Center that is an empty
 * dataset presented as a real one.
 *
 * The `features` count is NOT the dishonest part: eight records do exist, and
 * the drift gate defines features as the length of the counted collection. The
 * dishonest part was the prose. This test ties the two together, in both
 * directions, so neither can drift from the data again.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

function sources() {
  global.window = global;
  delete require.cache[require.resolve(path.join(ROOT, 'js/data-source-inventory.js'))];
  require(path.join(ROOT, 'js/data-source-inventory.js'));
  return global.DataSourceInventory.getSources();
}

const parcels = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market/parcel_aggregates_co.json'), 'utf8'));
const entry = sources().find((s) => s.id === 'regrid-parcels');

console.log('parcel-source-honesty');

run('the source entry exists', () => {
  assert.ok(entry, 'regrid-parcels must be in the inventory');
});

run('an empty dataset says so where a reader will see it', () => {
  const records = parcels.counties || [];
  const populated = records.filter((r) => (r.total_parcels || 0) > 0);
  const empty = populated.length === 0 && records.length > 0;
  if (!empty) {
    // The source started working — the labels must then stop claiming it is empty.
    assert.doesNotMatch(entry.description, /carries NO parcel data/i,
      'parcel data is present now, so the description must be updated');
    assert.doesNotMatch(entry.name, /\(no data\)/i, 'the name must drop the "(no data)" marker');
    return;
  }
  assert.match(entry.name + ' ' + entry.coverage + ' ' + entry.description, /no (data|counties)/i,
    'an all-empty dataset must be labelled as carrying no data');
  assert.match(entry.description, /#1602/,
    'and must point at the issue tracking the repair');
});

run('the provider names who actually produces the file', () => {
  // fetch_parcel_data.py queries county assessor ArcGIS services. Regrid is a
  // separate integration writing a different file; naming it here sent the
  // #1602 triage looking for a credential fault that did not exist.
  assert.doesNotMatch(entry.provider, /regrid|loveland/i,
    'Regrid does not produce this file — ' + JSON.stringify(entry.provider));
  const meta = parcels.meta || {};
  assert.match(String(meta.source || ''), /assessor/i,
    "the file's own meta should name the assessor services");
});

run('a source with no coverage does not advertise a refresh cadence', () => {
  // Declaring Quarterly/90d made a pipeline that has never produced data read
  // as merely overdue. Unknown maps to a null window in
  // data-freshness-monitor.js, which surfaces as 'unknown' rather than a
  // confident 'stale' or 'current'.
  const records = parcels.counties || [];
  const populated = records.filter((r) => (r.total_parcels || 0) > 0);
  if (populated.length === 0) {
    assert.equal(entry.maxAgeDays, null, 'an empty source must not claim an age limit');
    assert.equal(entry.updateFrequency, 'Unknown', 'nor a refresh cadence it has never met');
  }
});

run('the fetch script refuses to report success when every source fails', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/market/fetch_parcel_data.py'), 'utf8');
  assert.match(src, /if successful == 0:/, 'a total failure must be detected');
  assert.match(src, /return 1/, 'and must exit non-zero');
  assert.ok(src.indexOf('NO county data fetched') > 0,
    'the log must not claim "✓ Wrote N county records" when nothing was fetched');
});

if (failures) { console.error('parcel-source-honesty: FAIL'); process.exitCode = 1; }
else console.log('parcel-source-honesty: PASS');
