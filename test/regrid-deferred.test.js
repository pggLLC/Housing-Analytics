'use strict';

/**
 * Guards for the deferred Regrid integration (#1612) and the Bridge token
 * instruction (#1611).
 *
 * The owner decided not to fund a paid Regrid subscription. That is a product
 * and licensing decision, and the risk it creates is a specific one: an absent
 * licensed source quietly reading as "zero parcels", "no opportunity", or a
 * technical fault that a key would fix. These assertions hold the line on
 * describing it as deferred, and — deliberately in both directions — stop the
 * deferred labelling from outliving the deferral.
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
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

const REGRID_FILE = 'data/affordable-housing/regrid-parcels-by-place.json';
const WORKFLOW = '.github/workflows/fetch-parcel-zoning-data.yml';

console.log('regrid-deferred');

/**
 * Is the credential wired into a live step? A reference inside a comment is the
 * documented re-enable path and does not count.
 */
function regridOptedIn() {
  return read(WORKFLOW)
    .split('\n')
    .some((l) => l.includes('secrets.REGRID_API_KEY') && !l.trim().startsWith('#'));
}

run('the deferral and the wiring agree with each other', () => {
  // This test must not stand between the owner and re-enabling Regrid. #1612
  // asks that no scheduled request happen "without explicit owner opt-in" —
  // so wiring the credential back IS the opt-in, and the suite should then
  // require the labels to stop saying deferred, not fail the opt-in itself.
  const wf = read(WORKFLOW);
  assert.match(wf, /To re-enable: add `REGRID_API_KEY/,
    'the manual reactivation path must stay documented either way');

  const meta = readJson(REGRID_FILE).meta || {};
  if (regridOptedIn()) {
    assert.notEqual(meta.availability, 'deferred',
      'the credential is wired into a live step, so the data must no longer be labelled deferred — ' +
      'run the workflow and commit the result, or remove the env block again');
    return;
  }
  assert.equal(meta.availability, 'deferred',
    'no live step passes the credential, so the data must say it is deferred');
});

run('the data carries its own deferred reason', () => {
  const meta = readJson(REGRID_FILE).meta || {};
  const parcels = Number(meta.total_parcels || 0);
  if (parcels > 0 || regridOptedIn()) {
    // Regrid came back. The labels must not keep calling it deferred.
    assert.notEqual(meta.availability, 'deferred',
      'the file holds real parcels but is still marked deferred');
    return;
  }
  assert.equal(meta.availability, 'deferred', 'an empty licensed source must say why');
  assert.equal(meta.is_current_coverage, false,
    'the stub must never be presentable as current coverage');
  assert.ok(meta.deferred_reason && meta.deferred_reason.length > 40,
    'the reason must travel with the data, not live only in an issue');
});

run('absence is described as a licensing decision, not a fault', () => {
  const meta = readJson(REGRID_FILE).meta || {};
  if (Number(meta.total_parcels || 0) > 0 || regridOptedIn()) return;
  const reason = String(meta.deferred_reason || '');
  assert.match(reason, /not (a )?technical failure|licensing decision/i,
    'the reason must distinguish "not funded" from "broken"');
  assert.match(reason, /#1612/, 'and point at the decision record');
});

run('the UI does not offer a free tier that no longer exists', () => {
  // Regrid retired its free tier (F258). The old note read "Add via Data
  // Quality Dashboard (free tier 1k/mo)", which framed a licensing decision as
  // a missing setting.
  const src = read('js/components/map-layer-status.js');
  const strings = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // This one holds regardless of opt-in: the free tier is gone either way, so
  // advertising it is wrong whether or not a paid key is wired.
  assert.doesNotMatch(strings, /free tier 1k\/mo/,
    'the retired free tier must not be advertised to users');
  if (regridOptedIn()) return;
  assert.match(strings, /Deferred: Regrid is a paid licensed source/,
    'the status note must state the deferral');
  assert.match(strings, /Not broken/,
    'and must say the integration is not broken');
});

run('free government fallbacks are preserved', () => {
  // #1612: "Preserve free government-source and honest unknown-state
  // fallbacks." The county-assessor path must remain, not be deleted with the
  // Regrid deferral.
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/market/fetch_parcel_data.py')),
    'the free county-assessor fetcher must survive');
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/market/fetch_regrid_pipeline_parcels.py')),
    'the Regrid integration must not be deleted merely because it is inactive');
  const wf = read(WORKFLOW);
  assert.match(wf, /fetch_regrid_pipeline_parcels\.py/,
    'the step stays so the integration can be re-enabled without rebuilding it');
});

run('no instruction tells anyone to put a token in a shipped file', () => {
  // #1611: js/config.js ships to every visitor of a public site. An individual
  // supplying their own key through the Data Quality Dashboard keeps it in
  // their own browser storage, which is a different thing entirely.
  for (const p of ['data/market/bridge_co_market_summary.json', 'docs/DATA-INTEGRATIONS-AUDIT.md']) {
    const text = read(p);
    assert.doesNotMatch(text, /Set APP_CONFIG\.BRIDGE_BROWSER_TOKEN in js\/config\.js/,
      p + ' still instructs putting a token into a committed, publicly served file');
  }
  const note = String(readJson('data/market/bridge_co_market_summary.json')._note || '');
  assert.match(note, /DO NOT put a token in js\/config\.js/,
    'the corrected note must warn against it explicitly');
});

run('the Bridge stub still keeps the page on its fallback', () => {
  // #1611: "Retain the honest available: false state and the existing
  // non-Bridge fallback" while access is pending.
  const d = readJson('data/market/bridge_co_market_summary.json');
  assert.equal(d.available, false, 'the stub must remain unavailable until access is granted');
});


run('the fetcher labels BOTH states, so re-enabling needs no hand edit', () => {
  // #1612 asks for coverage of "both unavailable Regrid data and a
  // hypothetical valid/current response". The with-key path cannot be executed
  // here without a real credential and live API calls, so the branch itself is
  // asserted: the script must decide availability from the token and write the
  // active shape too, or re-enabling would leave the data claiming "deferred"
  // until somebody remembered to edit it by hand.
  const src = read('scripts/market/fetch_regrid_pipeline_parcels.py');
  assert.match(src, /deferred = not token/,
    'availability must be derived from the credential, not hard-coded');
  assert.match(src, /"availability":\s*"deferred" if deferred else "active"/,
    'the script must write the active state as well as the deferred one');
  assert.match(src, /"is_current_coverage":\s*not deferred/,
    'current-coverage must follow the same switch');
  assert.match(src, /if deferred:\s*\n\s*meta\["deferred_reason"\]/,
    'the reason is attached only while deferred, so it cannot outlive the deferral');
});

run('a deferred source is never expressible as a confident zero', () => {
  // The acceptance criterion that matters most: "Regrid absence does not become
  // zero parcels, no opportunity, or another confident finding."
  const meta = readJson(REGRID_FILE).meta || {};
  if (regridOptedIn()) return;
  assert.equal(Number(meta.total_parcels || 0), 0, 'the stub holds no parcels');
  // ...and every signal that a consumer could read says so explicitly, so a
  // bare 0 is never the only thing available to interpret.
  assert.equal(meta.is_current_coverage, false);
  assert.equal(meta.availability, 'deferred');
  assert.ok(meta.deferred_reason, 'with a reason attached');
});

if (failures) { console.error('regrid-deferred: FAIL'); process.exitCode = 1; }
else console.log('regrid-deferred: PASS');
