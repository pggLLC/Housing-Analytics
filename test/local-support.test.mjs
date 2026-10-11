#!/usr/bin/env node
/**
 * Local support: the scoring rule, and that the briefs say what the Finder adds.
 *
 * What these pin is agreement, not wording: the bonus a brief states must equal
 * js/local-support-data.js's bonus for that jurisdiction on the data's as_of
 * date (the same module the Opportunity Finder calls), and the committed brief
 * section must equal what the generator writes from the committed data.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { applyTo, briefFiles, civicFor, loadDocs, sectionFor, SECTION_ID } from '../scripts/generate-brief-local-support-sections.mjs';

const require = createRequire(import.meta.url);
const LSD = require('../js/local-support-data.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failed += 1; console.error(`  ✗ ${name}\n    ${err.message}`); }
}

console.log('Local support');

const TODAY = '2026-10-10';
function item(over) {
  return Object.assign({
    id: 'x', kind: 'action', type: 'project_approval', body: 'Town Council', title: 'T',
    date: '2025-05-01', outcome: 'approved', vote: null,
    source: { label: 'L', url: 'https://example.gov/x' }, evidence: [{ quote: 'q' }]
  }, over);
}
function docs(rows, extra) {
  return Object.assign({
    support: { meta: { as_of: TODAY }, jurisdictions: rows },
    fees: { entries: [], land_use: [] }, funds: { entries: [] }, coverage: { jurisdictions: [] }
  }, extra || {});
}
function row(geoid, items, over) {
  return Object.assign({ geoid, jurisdiction: 'J', checked: '2026-10-01', review_by: '2027-04-01',
    result_by_scope: { plans: 'none_found', council: 'none_found' }, items }, over);
}

test('a jurisdiction nobody checked gets +0 and every part reads not_checked', () => {
  const p = LSD.build(docs([])).profile('0899999', TODAY);
  assert.equal(p.bonus, 0);
  for (const k of LSD.BONUS_PARTS) assert.equal(p.parts[k].state, 'not_checked', k);
  assert.equal(p.anyChecked, false);
});

test('checked with nothing found is also +0: absence and unknown both add nothing', () => {
  const p = LSD.build(docs([row('0811111', [])])).profile('0811111', TODAY);
  assert.equal(p.bonus, 0);
  assert.equal(p.parts.plans.state, 'none_found');
});

test('each part is worth 2 and the bonus never exceeds MAX_BONUS', () => {
  assert.equal(LSD.MAX_BONUS, 6);
  const d = docs([row('0811111', [
    item({ id: 'p', kind: 'plan', type: 'housing_plan', outcome: 'adopted', date: '2024-02-01' }),
    item({ id: 'p2', kind: 'plan', type: 'housing_needs_assessment', outcome: 'adopted', date: '2023-02-01' }),
    item({ id: 'a' }), item({ id: 'b' })
  ])], { funds: { entries: [{ id: 'f', geoid: '0811111', status: 'adopted' }] } });
  const p = LSD.build(d).profile('0811111', TODAY);
  assert.deepEqual([p.parts.plans.points, p.parts.incentives.points, p.parts.council.points], [2, 2, 2]);
  assert.equal(p.bonus, 6);
  assert.equal(LSD.applyBonus(98, p.bonus), 100, 'capped at 100');
  assert.equal(LSD.applyBonus(null, p.bonus), null, 'a missing score stays missing');
});

test('windows: a plan older than 5 years and a vote older than 36 months do not count', () => {
  const d = docs([row('0811111', [
    item({ id: 'p', kind: 'plan', type: 'housing_plan', outcome: 'adopted', date: '2021-10-09' }),
    item({ id: 'a', date: '2023-10-09' })
  ])]);
  const p = LSD.build(d).profile('0811111', TODAY);
  assert.equal(p.bonus, 0);
  const d2 = docs([row('0811111', [
    item({ id: 'p', kind: 'plan', type: 'housing_plan', outcome: 'adopted', date: '2021-10-10' }),
    item({ id: 'a', date: '2023-10-10' })
  ])]);
  assert.equal(LSD.build(d2).profile('0811111', TODAY).bonus, 4, 'boundary day counts');
});

test('a year-only date counts as its earliest day, never as more recent than it is', () => {
  assert.equal(LSD.earliestDay('2023'), '2023-01-01');
  assert.equal(LSD.earliestDay('2023-11'), '2023-11-01');
  const d = docs([row('0811111', [item({ id: 'a', date: '2023' })])]);
  assert.equal(LSD.build(d).profile('0811111', TODAY).bonus, 0);
});

test('denials are listed and never add or subtract', () => {
  const d = docs([row('0811111', [item({ id: 'n', type: 'denial', outcome: 'denied' })])]);
  const p = LSD.build(d).profile('0811111', TODAY);
  assert.equal(p.bonus, 0);
  assert.equal(p.denials.length, 1);
});

test('a row past review_by stops counting and says overdue', () => {
  const d = docs([row('0811111', [item({ id: 'a' })], { review_by: '2026-10-09' })]);
  const p = LSD.build(d).profile('0811111', TODAY);
  assert.equal(p.bonus, 0);
  assert.equal(p.parts.council.state, 'overdue');
});

test('incentives: deferrals, rate discounts, one-off awards and IZ (scored by Civic) do not count', () => {
  const fees = { entries: [
    { id: 'a', geoid: '0811111', kind: 'program', measure: 'deferred' },
    { id: 'b', geoid: '0811111', kind: 'program', measure: 'rate_discount' },
    { id: 'c', geoid: '0811111', kind: 'project_award', measure: 'waived' }
  ], land_use: [{ id: 'd', geoid: '0811111', status: 'adopted', measure: 'inclusionary_zoning' }] };
  assert.equal(LSD.build(docs([], { fees })).profile('0811111', TODAY).bonus, 0);
  fees.entries.push({ id: 'e', geoid: '0811111', kind: 'program', measure: 'waived' });
  assert.equal(LSD.build(docs([], { fees })).profile('0811111', TODAY).bonus, 2);
});

test('nothing counts twice: evidence Civic already credits is listed but earns no bonus', () => {
  const d = docs([row('0811111', [
    item({ id: 'p', kind: 'plan', type: 'housing_plan', outcome: 'adopted', date: '2024-02-01' })
  ])], { funds: { entries: [{ id: 'f', geoid: '0811111', status: 'adopted' }] },
         fees: { entries: [], land_use: [{ id: 'l', geoid: '0811111', status: 'adopted', measure: 'density_bonus' }] } });
  const m = LSD.build(d);
  assert.equal(m.profile('0811111', TODAY).bonus, 4);
  const civic = m.profile('0811111', TODAY, { civic: { has_hna: true, has_local_funding: true } });
  assert.equal(civic.parts.plans.points, 0);
  assert.equal(civic.parts.plans.state, 'in_civic');
  assert.equal(civic.parts.plans.creditedInCivic.length, 1);
  assert.equal(civic.parts.incentives.points, 2, 'the density bonus still counts');
  assert.deepEqual(civic.parts.incentives.creditedInCivic.map((i) => i.record.id), ['f']);
  const onlyFund = LSD.build(docs([], { funds: { entries: [{ id: 'f', geoid: '0811111', status: 'adopted' }] } }));
  const p = onlyFund.profile('0811111', TODAY, { civic: { has_local_funding: true } });
  assert.equal(p.bonus, 0);
  assert.equal(p.parts.incentives.state, 'in_civic');
  assert.equal(onlyFund.profile('0811111', TODAY, { civic: { has_local_funding: null } }).bonus, 2, 'unknown in Civic is not credit');
});

test('the Finder passes the same Civic dimensions the brief generator uses', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/lihtc-opportunity-finder.js'), 'utf8');
  assert.match(src, /civic: civic_pre && civic_pre\.dimensions/);
  assert.match(src, /function civicForPlace\(placeGeoid, countyFips\) \{\s*return state\.policyScores\[placeGeoid\] \|\|\s*\(countyFips \? state\.policyScores\[countyFips\] : null\)/,
    'civicFor() in the generator mirrors civicForPlace(): own row, else county row');
});

test('a CDP is scored on its county; Denver county and city are one jurisdiction', () => {
  const d = docs([row('08097', [item({ id: 'a' })]), row('0820000', [item({ id: 'b' })])]);
  const m = LSD.build(d);
  assert.equal(m.profile('0899999', TODAY, { kind: 'cdp', county: '08097' }).bonus, 2);
  assert.equal(m.profile('0899999', TODAY, { kind: 'place', county: '08097' }).bonus, 0);
  assert.equal(m.profile('08031', TODAY).bonus, 2);
});

// ── The committed data and briefs ─────────────────────────────────────────
const real = loadDocs();
const model = LSD.build(real);

test('the scan is not vacuous: the committed file has checked rows with counted evidence', () => {
  assert.ok(real.support.jurisdictions.length >= 10, 'expected the brief jurisdictions to be checked');
  const scored = real.support.jurisdictions.filter((r) => model.profile(r.geoid, real.support.meta.as_of).bonus > 0);
  assert.ok(scored.length >= 5, `only ${scored.length} rows earn a bonus`);
});

test('every brief has a local-support row, and its section is what the generator writes', () => {
  const missing = [];
  for (const file of briefFiles()) {
    const brief = JSON.parse(fs.readFileSync(file, 'utf8'));
    const expected = applyTo(JSON.parse(JSON.stringify(brief)), real);
    const subject = brief.scope === 'cdp' ? brief.containing_county_fips : brief.geoid;
    if (!model.rows.get(subject === '08031' ? '0820000' : subject)) missing.push(brief.geoid);
    assert.deepEqual(brief.sections.find((s) => s.id === SECTION_ID), expected.sections.find((s) => s.id === SECTION_ID),
      `${brief.geoid}: stale local-support section — run node scripts/generate-brief-local-support-sections.mjs`);
    assert.deepEqual(brief.sources.filter((s) => /^ls\d+$/.test(s.id)), expected.sources.filter((s) => /^ls\d+$/.test(s.id)),
      `${brief.geoid}: stale ls* sources`);
  }
  assert.deepEqual(missing, [], 'briefs with no local-support row');
});

test('the bonus a brief states is the bonus the Finder module computes', () => {
  let checked = 0;
  for (const file of briefFiles()) {
    const brief = JSON.parse(fs.readFileSync(file, 'utf8'));
    const sec = brief.sections.find((s) => s.id === SECTION_ID);
    if (!sec) continue;
    const prof = model.profile(brief.geoid, real.support.meta.as_of,
      { kind: brief.scope, county: brief.containing_county_fips, civic: civicFor(brief, real) });
    const last = sec.paragraphs[sec.paragraphs.length - 1].text;
    const m = /local support bonus of \+(\d+) of a possible \+(\d+)/.exec(last);
    assert.ok(m, `${brief.geoid}: no bonus sentence`);
    assert.equal(Number(m[1]), prof.bonus, `${brief.geoid}: brief says +${m[1]}, module says +${prof.bonus}`);
    assert.equal(Number(m[2]), LSD.MAX_BONUS);
    checked += 1;
  }
  assert.ok(checked > 0);
});

test('sabotage: changing a counted item changes the generated section (the freshness check can fail)', () => {
  const r = real.support.jurisdictions.find((x) => (x.items || []).some((i) => i.kind === 'action'));
  const file = path.join(ROOT, 'data/jurisdiction-briefs', `${r.geoid}.json`);
  if (!fs.existsSync(file)) return;
  const brief = JSON.parse(fs.readFileSync(file, 'utf8'));
  const mutated = JSON.parse(JSON.stringify(real));
  const target = mutated.support.jurisdictions.find((x) => x.geoid === r.geoid).items.find((i) => i.kind === 'action');
  target.title += ' (mutated)';
  const a = sectionFor(brief, real).section;
  const b = sectionFor(brief, mutated).section;
  assert.notDeepEqual(a, b, 'mutation did not reach the section');
});

// ── The Finder applies the same bonus to every deal type ──────────────────
const finderSrc = fs.readFileSync(path.join(ROOT, 'js/lihtc-opportunity-finder.js'), 'utf8');
const pageSrc = fs.readFileSync(path.join(ROOT, 'lihtc-opportunity-finder.html'), 'utf8');
const SCORE_VARS = ['score9', 'score4', 'scorePreservation', 'scoreWorkforce', 'scoreProp123', 'scoreAny'];
function bonusedVars(src) {
  return SCORE_VARS.filter((v) => new RegExp(`\\b${v}\\s*=\\s*window\\.LocalSupportData \\? window\\.LocalSupportData\\.applyBonus\\(${v}, localSupportBonus\\)`).test(src));
}

test('the Finder adds the bonus to all six deal-type scores and to custom weights', () => {
  assert.deepEqual(bonusedVars(finderSrc), SCORE_VARS);
  assert.match(finderSrc, /applyBonus\(score, op\.localSupportBonus\)/, 'custom-weight scenarios must add it too');
  assert.match(finderSrc, /loadSoft\('data\/policy\/local-support\.json'\)/);
});

test('the page loads the scoring module before the Finder', () => {
  const lsd = pageSrc.indexOf('src="js/local-support-data.js"');
  const lid = pageSrc.indexOf('src="js/local-incentives-data.js"');
  const lof = pageSrc.indexOf('src="js/lihtc-opportunity-finder.js"');
  assert.ok(lid !== -1 && lsd !== -1 && lof !== -1 && lid < lsd && lsd < lof);
});

test('sabotage: dropping the bonus from one deal type fails the check above', () => {
  const mutated = finderSrc.replace('score4            = window.LocalSupportData ? window.LocalSupportData.applyBonus(score4, localSupportBonus) : score4;', '');
  assert.notEqual(mutated, finderSrc, 'mutation did not apply');
  assert.notDeepEqual(bonusedVars(mutated), SCORE_VARS);
});

if (failed) { console.error(`${failed} failed`); process.exit(1); }
