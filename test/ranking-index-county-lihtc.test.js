#!/usr/bin/env node
/**
 * County LIHTC counts must agree with the CHFA feed they are counted from.
 *
 * Both LIHTC augmenters of data/hna/ranking-index.json attributed projects to
 * places only — by PROJ_CTY name, and by place polygon. A county's name never
 * matches a PROJ_CTY and no county polygon was ever tested, so all 64 county
 * rows shipped lihtc_project_count = 0, lihtc_in_boundary = 0 and
 * recency_basis = 'never_funded': Denver County read 0 projects beside Denver
 * city's 251, and every county scored as maximum LIHTC opportunity. The
 * digests then published those zeros under source_id 'acs-profile'.
 *
 * This pins the agreement, not a number: each county's count must equal the
 * number of records in data/chfa-lihtc.json carrying its CNTY_FIPS. When CHFA
 * adds a project, both sides move together.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'data', 'hna', 'ranking-index.json');
const CHFA = path.join(ROOT, 'data', 'chfa-lihtc.json');
const DIGEST_DIR = path.join(ROOT, 'data', 'hna', 'jurisdiction-metrics-digest');

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

console.log('ranking-index-county-lihtc');

const REBUILD = 'Run `npm run rebuild:derived` (never the index builder alone).';
const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const counties = (index.rankings || []).filter((r) => r && r.type === 'county');
const chfa = JSON.parse(fs.readFileSync(CHFA, 'utf8'));

const chfaByCounty = new Map();
for (const f of chfa.features || []) {
  const fips = String((f.properties || {}).CNTY_FIPS || '');
  if (/^08\d{3}$/.test(fips)) chfaByCounty.set(fips, (chfaByCounty.get(fips) || 0) + 1);
}
const funded = counties.filter((c) => chfaByCounty.has(c.geoid));

test('the scan has something to check', () => {
  assert.strictEqual(counties.length, 64, `expected 64 county rows, found ${counties.length}`);
  assert.ok(funded.length >= 40, `only ${funded.length} counties have CHFA records — did data/chfa-lihtc.json lose CNTY_FIPS?`);
});

test('no county with LIHTC projects in chfa-lihtc.json reports 0', () => {
  const zero = funded.filter((c) => !(c.metrics && c.metrics.lihtc_project_count > 0));
  assert.deepStrictEqual(zero.map((c) => `${c.geoid} ${c.name}`), [], REBUILD);
});

test('each county lihtc_project_count equals its CNTY_FIPS record count in chfa-lihtc.json', () => {
  const off = counties
    .map((c) => ({ c, want: chfaByCounty.get(c.geoid) || 0, got: c.metrics && c.metrics.lihtc_project_count }))
    .filter(({ want, got }) => got !== want)
    .map(({ c, want, got }) => `${c.geoid} ${c.name}: index ${got}, chfa-lihtc.json ${want}`);
  assert.deepStrictEqual(off, [], REBUILD);
});

test('no funded county has a zero point-in-polygon count', () => {
  const zero = funded.filter((c) => !(c.metrics && c.metrics.lihtc_in_boundary > 0));
  assert.deepStrictEqual(zero.map((c) => `${c.geoid} ${c.name}`), [], REBUILD);
});

test('no funded county is scored never_funded', () => {
  const nf = funded.filter((c) => (c.metrics || {}).recency_basis === 'never_funded');
  assert.deepStrictEqual(nf.map((c) => `${c.geoid} ${c.name}`), [], REBUILD);
});

test('the HNA badge cannot render "0 projects on record" for a county', () => {
  // js/hna/hna-renderers.js prints `n projects on record` for any measured
  // record whose basis is not never_funded.
  const bad = counties.filter((c) => {
    const m = c.metrics || {};
    return m.recency_basis && m.recency_basis !== 'never_funded' && !(m.lihtc_project_count > 0);
  });
  assert.deepStrictEqual(bad.map((c) => `${c.geoid} ${c.name}`), []);
});

test('county digests do not label LIHTC metrics as ACS', () => {
  let checked = 0;
  const wrong = [];
  for (const c of counties) {
    const file = path.join(DIGEST_DIR, `${c.geoid}.json`);
    if (!fs.existsSync(file)) continue;
    const metrics = JSON.parse(fs.readFileSync(file, 'utf8')).metrics || {};
    for (const [key, m] of Object.entries(metrics)) {
      if (!key.includes('lihtc')) continue;
      checked += 1;
      if (String(m.source_id).startsWith('acs')) wrong.push(`${c.geoid} ${key}: ${m.source_id}`);
    }
    const digestCount = metrics.lihtc_project_count && metrics.lihtc_project_count.value;
    if (chfaByCounty.has(c.geoid) && !(digestCount > 0)) wrong.push(`${c.geoid} lihtc_project_count digest value ${digestCount}`);
  }
  assert.ok(checked >= 64, `only ${checked} LIHTC digest entries found across county digests`);
  assert.deepStrictEqual(wrong, []);
});

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
