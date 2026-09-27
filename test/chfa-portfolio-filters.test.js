'use strict';
/**
 * chfa-portfolio-filters — the Development, Setting, Serves and Income
 * targeting filters on chfa-portfolio.html.
 *
 * Each filter reads a field CHFA publishes. The guards pin every dropdown to
 * that field rather than to its wording: an option must match a value that
 * exists in data/chfa-lihtc.json, the Development column must print the same
 * label as the filter option that selects it, and a record whose breakdown is
 * empty must match no specific group instead of being counted as "none".
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'chfa-portfolio.html'), 'utf8');
const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'chfa-lihtc.json'), 'utf8'))
  .features.map((f) => f.properties);

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('chfa-portfolio-filters');

function options(id) {
  const m = new RegExp('<select id="' + id + '"[\\s\\S]*?</select>').exec(html);
  assert.ok(m, 'no <select id="' + id + '"> on the page');
  return [...m[0].matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)]
    .filter((o) => o[1] !== '')
    .map((o) => ({ value: o[1], label: o[2] }));
}

let fns = null;
run('the filter predicates are present and extractable', () => {
  const start = html.indexOf('var DEV_TYPE_LABELS');
  const end = html.indexOf('function fmt(n)', start);
  assert.ok(start !== -1 && end !== -1,
    'could not find the filter predicates in chfa-portfolio.html — if they were ' +
    'renamed, update this test rather than deleting it');
  // eslint-disable-next-line no-new-func
  fns = new Function(html.slice(start, end) +
    '\n return { DEV_TYPE_LABELS, INCOME_BANDS, devType, matchesServes, matchesIncome };')();
});

function withFns(name, fn) {
  run(name, () => {
    assert.ok(fns, 'skipped: the predicates could not be extracted (see above)');
    fn();
  });
}

withFns('every CHFA record gets a development type, and each option selects some', () => {
  assert.ok(rows.length > 0, 'precondition: the portfolio file has records');
  const unclassified = rows.filter((r) => fns.devType(r) === null).map((r) => r.ProjectType);
  assert.deepEqual([...new Set(unclassified)], [],
    'CHFA published a ProjectType the page does not classify: ' + JSON.stringify([...new Set(unclassified)]));
  for (const o of options('filterDevType')) {
    assert.ok(rows.some((r) => fns.devType(r) === o.value), 'option "' + o.label + '" matches no record');
  }
});

withFns('the Development column prints the same label as the filter option', () => {
  const opts = options('filterDevType');
  assert.deepEqual(opts.map((o) => o.value).sort(), Object.keys(fns.DEV_TYPE_LABELS).sort());
  for (const o of opts) assert.equal(fns.DEV_TYPE_LABELS[o.value], o.label);
  assert.equal(fns.devType({ ProjectType: 'Something new' }), null,
    'an unrecognised ProjectType must stay unclassified, not be folded into a category');
});

run('the Setting options are exactly the UrbanRural values CHFA publishes', () => {
  const inData = [...new Set(rows.map((r) => r.UrbanRural).filter(Boolean))].sort();
  assert.deepEqual(options('filterSetting').map((o) => o.value).sort(), inData);
});

withFns('every Serves option is a published population field and matches some record', () => {
  for (const o of options('filterServes')) {
    assert.ok(rows.every((r) => o.value in (r.PopulationUnits || {})),
      '"' + o.value + '" is not a PopulationUnits field');
    const expected = rows.filter((r) => r.PopulationUnits[o.value] > 0).length;
    assert.ok(expected > 0, 'option "' + o.label + '" matches no record');
    assert.equal(rows.filter((r) => fns.matchesServes(r, o.value)).length, expected,
      'the "' + o.label + '" filter disagrees with the data');
  }
});

withFns('every Income option reads published AMI bands and matches some record', () => {
  for (const o of options('filterIncome')) {
    const bands = fns.INCOME_BANDS[o.value];
    assert.ok(bands && bands.length, 'option "' + o.value + '" has no band definition');
    for (const b of bands) {
      assert.ok(rows.every((r) => b in (r.AMIUnits || {})), '"' + b + '" is not an AMIUnits field');
    }
    const expected = rows.filter((r) => bands.some((b) => r.AMIUnits[b] > 0)).length;
    assert.ok(expected > 0, 'option "' + o.label + '" matches no record');
    assert.equal(rows.filter((r) => fns.matchesIncome(r, o.value)).length, expected);
  }
  // The label must say what the band list does: ≤30% includes the ≤20% band.
  assert.ok(fns.INCOME_BANDS.le30.includes('lte20'), '≤30% must include the ≤20% band');
});

withFns('an empty or missing breakdown matches no specific group', () => {
  const zero = { senior: 0, family: 0, homeless: 0, veteran: 0, supportive: 0, special: 0 };
  for (const r of [{}, { PopulationUnits: null }, { PopulationUnits: zero }, { PopulationUnits: { family: null } }]) {
    assert.equal(fns.matchesServes(r, 'family'), false, JSON.stringify(r));
    assert.equal(fns.matchesServes(r, ''), true, '"Any" must keep ' + JSON.stringify(r));
  }
  assert.equal(fns.matchesIncome({ AMIUnits: { lte20: 0, ami30: 0 } }, 'le30'), false);
  assert.equal(fns.matchesIncome({}, ''), true);
});

run('the breakdown-gap note is shown because the data has such records', () => {
  const gaps = rows.filter((r) =>
    !Object.values(r.PopulationUnits || {}).some((v) => v > 0) ||
    !Object.values(r.AMIUnits || {}).some((v) => v > 0)).length;
  assert.equal(html.includes('id="breakdownGapNote"'), gaps > 0,
    gaps + ' records have no breakdown; the note must be present exactly when there are any');
});

run('every new filter is read by applyFilters and wired to a listener', () => {
  const listen = /\[([^\]]*)\]\.forEach\(id =>\s*document\.getElementById\(id\)\.addEventListener\('change'/.exec(html);
  assert.ok(listen, 'could not find the change-listener list');
  for (const id of ['filterDevType', 'filterSetting', 'filterServes', 'filterIncome']) {
    assert.ok(html.includes("getElementById('" + id + "').value"), id + ' is never read');
    assert.ok(listen[1].includes("'" + id + "'"), id + ' has no change listener');
  }
});

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
