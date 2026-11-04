// data/policy/leading-signals.json is facts only: every row carries its source,
// nothing is scored, ballot results stay null until a clerk's result is recorded,
// and the committed file is what the builder writes today (apart from its date).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = path.join(ROOT, 'data/policy/leading-signals.json');
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/geo-config.json'), 'utf8'));
const known = new Set([...geo.counties, ...geo.places, ...(geo.cdps || [])].map((g) => g.geoid));

const KINDS = new Set(['land_banking', 'prop123', 'hna', 'local_funds', 'ballot_2026', 'pipeline']);
let rows = 0;
for (const [geoid, rec] of Object.entries(data.places)) {
  assert.equal(rec.geoid, geoid);
  assert.ok(known.has(geoid), `${geoid} is not an HNA geography`);
  assert.equal(rec.score, undefined, 'no score on a place');
  for (const [kind, list] of Object.entries(rec.signals)) {
    assert.ok(KINDS.has(kind), `unknown signal kind ${kind}`);
    assert.equal(rec.counts[kind], list.length);
    for (const r of list) {
      rows++;
      assert.ok(r.source_url || r.url, `${geoid} ${kind} row has no source: ${JSON.stringify(r).slice(0, 120)}`);
      for (const k of Object.keys(r)) assert.ok(!/score|weight|rank/i.test(k), `${kind} row carries ${k}`);
      if (kind === 'ballot_2026') {
        assert.ok(r.result === null || r.result_source, `${r.id}: a result needs its clerk source`);
        assert.ok(r.result_status, `${r.id}: result_status is required`);
      }
      if (kind === 'land_banking') {
        assert.equal(r.financed, undefined, 'no true/false financed flag: absence of a record is not a "no"');
        assert.equal(r.building_finance, r.status === 'financed' ? 'award_recorded' : 'none_found_in_checked_sources');
        assert.ok(r.status == null || r.status_label, `${r.project}: status ${r.status} carries its label`);
      }
    }
  }
  assert.equal(rec.land_banked_no_building_award_found,
    (rec.signals.land_banking || []).filter((r) => r.building_finance !== 'award_recorded').length);
}
// Every 2027-2029 filing lands on a place of its own kind: "City of Ouray" and
// "Ouray County" share a name once normalised, and each keeps its own goal.
const p123 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/policy/prop123_jurisdictions.json'), 'utf8'));
// A filing by a government that also filed in cycle 1 takes that record's kind
// (a "City and County of" government is a county there), and joins the same
// row as its existing commitment rather than adding a second one.
const cycle1 = new Map(p123.jurisdictions.map((j) => [j.name, j]));
let joined = 0;
for (const f of (p123.next_cycle || {}).filings || []) {
  const prior = cycle1.get(f.name);
  const isCounty = prior ? prior.kind === 'county' : /County$/.test(f.name);
  const hit = Object.values(data.places).some((rec) => /^\d{5}$/.test(rec.geoid) === isCounty
    && (rec.signals.prop123 || []).some((r) => r.cycle2_submitted === f.submitted && r.cycle2_unit_goal === f.unit_goal
      && (!prior || r.filing_date === prior.filing_date)));
  if (!data.meta.unmatched.includes(f.name)) {
    assert.ok(hit, `${f.name}: cycle-2 filing is on a ${isCounty ? 'county' : 'place'}${prior ? ', on its cycle-1 commitment' : ''}`);
    if (prior) joined++;
  }
}
assert.ok(joined > 0, 'the scan found cycle-2 filings with a cycle-1 commitment to join');
for (const rec of Object.values(data.places)) {
  assert.ok((rec.signals.prop123 || []).length <= 1, `${rec.name}: one Prop 123 signal, not a split commitment and filing`);
}
const ourayCity = Object.values(data.places).find((rec) => rec.name === 'Ouray (city)');
assert.ok(ourayCity && ourayCity.signals.prop123[0].cycle2_unit_goal != null, 'City of Ouray keeps its own cycle-2 filing');
assert.ok(rows > 300, `only ${rows} signal rows: the inputs did not load`);
assert.ok(Object.keys(data.places).length > 150);

// Fresh: rebuilding gives the committed file, apart from the build date.
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-')), 'out.json');
execFileSync('python3', [path.join(ROOT, 'scripts/policy/build_leading_signals.py'), '--out', tmp], { stdio: 'pipe' });
const fresh = JSON.parse(fs.readFileSync(tmp, 'utf8'));
delete fresh.meta.generated;
const committed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
delete committed.meta.generated;
assert.deepEqual(fresh, committed, 'data/policy/leading-signals.json is stale: run python3 scripts/policy/build_leading_signals.py');
console.log(`leading-signals: PASS (${Object.keys(data.places).length} geographies, ${rows} dated rows, none scored)`);
