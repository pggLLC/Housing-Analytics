/**
 * The second homes panel is pinned to what it must agree with: every seasonal
 * figure is the ACS B25004 count in data/hna/vacancy-status.json over the
 * B25001 total in data/hna/housing-units-b25001.json (same release), every
 * lodging tax shown is a local-housing-funds record with its own summary,
 * every license count is a row of the official-registry benchmark, and the
 * panel prints those numbers rather than its own. Absence stays absent: no
 * license count renders as "not found yet", never as 0.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const DATA = json('data/hna/second-homes-str.json');
const VAC = json('data/hna/vacancy-status.json');
const HU = json('data/hna/housing-units-b25001.json');
const FUNDS = json('data/policy/local-housing-funds.json');
const STR = json('data/benchmarks/str-license-counts.json');
const GEO = json('data/hna/geo-config.json');
const FEED = json('data/policy_briefs_curated.json');

test('the joined file is current with its inputs', () => {
  const r = spawnSync('python3', ['scripts/hna/build_second_homes_str.py', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('every HNA geography has a record, and the ACS release matches the vacancy cache', () => {
  const ids = [...GEO.counties, ...GEO.places, ...GEO.cdps].map((g) => g.geoid).sort();
  assert.deepEqual(Object.keys(DATA.geographies).sort(), ids);
  assert.ok(VAC.meta.source.includes(HU.meta.release.name), `${HU.meta.release.name} vs ${VAC.meta.source}`);
});

test('every seasonal figure is the ACS count over the ACS total', () => {
  let checked = 0;
  for (const [geoid, rec] of Object.entries(DATA.geographies)) {
    const v = VAC.geographies[geoid];
    const s = rec.seasonal_homes;
    if (!v) { assert.equal(s, null, geoid); assert.ok(rec.seasonal_homes_unavailable_reason, geoid); continue; }
    assert.equal(s.units, v.seasonal_recreational_occasional, geoid);
    assert.equal(s.moe, v.moe.seasonal_recreational_occasional, geoid);
    const total = HU.geographies[geoid].housing_units;
    assert.equal(s.housing_units, total, geoid);
    if (total > 0) {
      assert.equal(s.share_of_housing_units, Math.round((s.units / total) * 1e4) / 1e4, geoid);
      checked++;
    } else {
      assert.equal(s.share_of_housing_units, null, `${geoid}: no total must mean no share, not 0`);
    }
  }
  assert.ok(checked > 300, `only ${checked} shares checked`);
});

test('license counts come only from the official-registry benchmark; absence is null, never 0', () => {
  const byGeoid = new Map(STR.entries.map((e) => [e.geoid, e]));
  let present = 0;
  for (const [geoid, rec] of Object.entries(DATA.geographies)) {
    const e = byGeoid.get(geoid);
    if (!e) { assert.equal(rec.str_licenses, null, geoid); continue; }
    present++;
    assert.equal(rec.str_licenses.units, e.licensed_str_units, geoid);
    assert.equal(rec.str_licenses.source_url, e.source_url, geoid);
    assert.ok(/^https:\/\//.test(e.source_url) && e.as_of, `${e.jurisdiction}: needs an official URL and date`);
  }
  assert.ok(present > 0, 'no license counts were joined');
  assert.ok(/not a count of zero/i.test(DATA.meta.unavailable_reasons.str_licenses));
});

test('every lodging or STR tax for housing shows on its own geography, with the record\'s own summary', () => {
  const records = FUNDS.entries.filter((e) => e.tool === 'lodging_or_str_tax');
  assert.ok(records.length >= 10, 'too few lodging tax records to check');
  for (const r of records) {
    const rec = DATA.geographies[r.geoid];
    assert.ok(rec, `${r.id}: geography ${r.geoid} missing`);
    const shown = (rec.lodging_taxes || []).find((t) => t.id === r.id);
    assert.ok(shown, `${r.id} not on ${r.geoid}`);
    assert.equal(shown.summary, r.summary);
    assert.equal(shown.status, r.status);
  }
  // A place inherits its county's tax as a county tax, never as its own.
  const vail = DATA.geographies['0880040'];
  assert.ok((vail.county_lodging_taxes || []).every((t) => t.geoid === vail.county_geoid));
  assert.ok((vail.lodging_taxes || []).every((t) => t.geoid === '0880040'));
});

function panel() {
  const dom = new JSDOM('<!doctype html><div id="m"></div>', { runScripts: 'outside-only' });
  dom.window.fetch = async () => ({ ok: true, json: async () => structuredClone(DATA) });
  dom.window.eval(read('js/components/second-homes-panel.js'));
  return dom.window;
}

test('the panel prints the file\'s numbers and says absence as absence', async () => {
  const w = panel();
  const m = w.document.getElementById('m');
  const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

  // Pick cases from the data, not by name, so the scan always has something to check.
  const recs = Object.values(DATA.geographies);
  const withShare = recs.find((r) => r.seasonal_homes && r.seasonal_homes.reliability === 'reliable' && r.lodging_taxes);
  const noLicense = recs.find((r) => !r.str_licenses && r.seasonal_homes && r.seasonal_homes.reliability === 'reliable');
  const zero = recs.find((r) => r.seasonal_homes && r.seasonal_homes.reliability === 'zero_estimate');
  const withLicense = recs.find((r) => r.str_licenses);
  for (const [label, r] of Object.entries({ withShare, noLicense, zero, withLicense })) assert.ok(r, `no ${label} case in the data`);

  await w.SecondHomesPanel.attach(m, { geoid: withShare.geoid, geoType: withShare.level });
  assert.ok(m.querySelector('[data-shp="seasonal"]').textContent.includes(pct(withShare.seasonal_homes.share_of_housing_units)));
  for (const t of withShare.lodging_taxes) assert.ok(m.querySelector(`[data-shp-tax="${t.id}"]`), `${t.id} not rendered`);

  await w.SecondHomesPanel.attach(m, { geoid: noLicense.geoid, geoType: noLicense.level });
  const str = m.querySelector('[data-shp="str"]').textContent;
  assert.ok(/not a count of zero/i.test(str), str);
  assert.ok(!/\b0 licensed/.test(str));

  await w.SecondHomesPanel.attach(m, { geoid: withLicense.geoid, geoType: withLicense.level });
  assert.ok(m.querySelector('[data-shp="str"]').textContent.includes(withLicense.str_licenses.units.toLocaleString('en-US')));

  await w.SecondHomesPanel.attach(m, { geoid: zero.geoid, geoType: zero.level });
  assert.ok(/not proof there are none/.test(m.querySelector('[data-shp="seasonal"]').textContent));

  const noTax = recs.find((r) => !r.lodging_taxes && !r.county_lodging_taxes && !r.ballot_measures && !r.county_ballot_measures && !r.places_with_lodging_taxes && !r.places_with_ballot_measures);
  await w.SecondHomesPanel.attach(m, { geoid: noTax.geoid, geoType: noTax.level });
  assert.ok(/not proof there is none/.test(m.querySelector('[data-shp="tax"]').textContent));
});

test('the panel is on the "What housing exists" view only, and its brief link opens a curated brief', () => {
  const views = json('data/hna/hna-views.json');
  const holders = views.views.filter((v) => v.sections.some((s) => s.title.startsWith('Second homes')));
  assert.deepEqual(holders.map((v) => v.id), ['stock']);
  assert.ok(read('hna-what-housing-exists.html').includes('id="hnaSecondHomesMount"'));
  const src = read('js/components/second-homes-panel.js');
  const id = /var BRIEF_ID = '([^']+)'/.exec(src)[1];
  const brief = FEED.briefs.find((b) => b.id === id);
  assert.ok(brief && brief.is_curated, `panel links to ${id}, which is not a curated brief`);
});
