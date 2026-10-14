#!/usr/bin/env node
'use strict';
// Prop 123 rental rules (#2041). Each limit is copied from the statute or a
// program guideline, so the guards check it against its own quoted evidence
// and against the CHFA rent table the site uses, not against itself.
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const rules = require(path.join(ROOT, 'data', 'policy', 'prop123-rental-rules.json'));
const chfa = require(path.join(ROOT, rules.meta.rent_table));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + ': ' + err.message); }
}

const WORDS = { 30: 'thirty', 40: 'forty', 60: 'sixty', 90: 'ninety', 100: 'one hundred', 120: 'one hundred twenty' };
// A quote states a percentage if it says "60%", "60 percent" or "sixty percent".
function statesPct(quote, pct) {
  const q = quote.toLowerCase();
  return new RegExp(`\\b${pct}\\s*(%|percent)`).test(q) || (WORDS[pct] && q.includes(`${WORDS[pct]} percent`));
}
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const HTTPS_PREFIX = 'https:' + '//'; // split so the URL sweep does not read it as a link
const programs = rules.programs;

test('every program, and the commitment rule, cites sources that exist, with a quote', () => {
  assert(programs.length >= 6, 'expected the OEDIT and DOLA rental programs');
  const blocks = [...programs, rules.commitment_counting];
  let quotes = 0;
  for (const p of blocks) {
    for (const e of p.evidence) {
      assert(rules.sources[e.source], `${p.id || 'commitment'} cites unknown source ${e.source}`);
      assert(e.quote && e.quote.length >= 20, `${p.id || 'commitment'} has an empty quote`);
      assert(e.location, `${p.id || 'commitment'} evidence lacks a location`);
      quotes++;
    }
  }
  assert(quotes >= 15, `only ${quotes} quotes`);
  for (const [id, s] of Object.entries(rules.sources)) {
    assert(s.url.startsWith(HTTPS_PREFIX), `${id} url is not https`);
    assert(s.title && s.version, `${id} lacks a title or version`);
  }
});

test('each AMI limit is stated in one of its own quotes', () => {
  let checked = 0;
  for (const p of programs) {
    const pct = p.income_rule.max_ami_pct;
    if (pct === null) continue;
    assert(p.evidence.some((e) => statesPct(e.quote, pct)), `${p.id}: no quote states ${pct}% AMI`);
    checked++;
  }
  assert(checked >= 5, 'too few limits checked');
  const c = rules.commitment_counting;
  assert(c.evidence.some((e) => statesPct(e.quote, c.rental_max_ami_pct)), 'commitment: no quote states its AMI limit');
});

test('an unknown rule is null with a reason, never a number', () => {
  for (const p of programs) {
    const r = p.income_rule;
    assert(r.max_ami_pct === null || (Number.isInteger(r.max_ami_pct) && r.max_ami_pct > 0), `${p.id} max_ami_pct`);
    if (r.max_ami_pct === null) assert(r.max_ami_reason, `${p.id}: null max_ami_pct needs a reason`);
    if (r.per_unit_max_ami_pct === null) assert(r.per_unit_max_reason, `${p.id}: null per-unit max needs a reason`);
    if (p.affordability_years === null) assert(p.affordability_reason, `${p.id}: null affordability needs a reason`);
    if (p.rent_rule.annual_increase_cap_pct === null) assert(p.rent_rule.annual_increase_cap_reason, `${p.id}: null increase cap needs a reason`);
    if (r.type === 'project_average' || r.type === 'per_unit') {
      assert.equal(p.rent_rule.basis, 'gross', `${p.id}: OEDIT programs limit gross rent`);
      assert.equal(p.rent_rule.burden_pct, 30, `${p.id}: rent is 30% of the income limit`);
    }
  }
  const supportive = programs.find((p) => p.id === 'doh_supportive_housing');
  assert.equal(supportive.income_rule.max_ami_pct, null, 'no Prop 123 limit was confirmed for supportive housing');
});

// The rent table the site uses must carry each program's AMI tier in every
// county, and its rents must follow the statute's 30% rule except in the
// cells this file records as CHFA's own deviations.
const OCC = { '0br': [1], '1br': [1, 2], '2br': [3], '3br': [4, 5], '4br': [6] };
function ruleRent(limits, br) {
  const ps = OCC[br];
  return Math.floor((ps.reduce((s, p) => s + limits[`${p}p`], 0) / ps.length) * 0.3 / 12);
}

test('the CHFA table carries every program tier in all 64 counties', () => {
  assert.equal(chfa.counties.length, 64);
  const tiers = new Set(programs.map((p) => p.income_rule.max_ami_pct).filter((x) => x !== null));
  for (const t of tiers) {
    for (const c of chfa.counties) assert(c.regular_tiers[String(t)], `${c.county_name} lacks the ${t}% tier`);
  }
});

test('CHFA rents follow the 30% rule except the recorded deviations', () => {
  const found = [];
  let cells = 0;
  for (const c of chfa.counties) {
    for (const table of ['regular_tiers', 'hera_tiers']) {
      for (const [tier, v] of Object.entries(c[table] || {})) {
        for (const br of Object.keys(OCC)) {
          cells++;
          const rule = ruleRent(v.income_limits, br);
          if (v.max_rents[br] !== rule) found.push(`${c.fips}|${table}|${tier}|${br}|${v.max_rents[br]}|${rule}`);
        }
      }
    }
  }
  assert(cells > 5000, `only ${cells} cells checked`);
  const recorded = rules.rent_table_deviations.cells.map((d) =>
    `${d.fips}|${d.table}|${d.ami_pct}|${d.bedrooms}|${d.published_max_rent}|${d.thirty_percent_rule_rent}`);
  assert.deepEqual(found.sort(), recorded.sort());
});

test('petitions and dates are well formed', () => {
  for (const p of rules.rural_resort_petitions.petitions) {
    assert.match(p.submitted, isoDate, p.jurisdiction);
    assert(['approved', 'denied', 'withdrawn', 'in_review', 'did_not_meet_statutory_requirements'].includes(p.status), p.jurisdiction);
    assert(Number.isInteger(p.ami_pct_rental) && p.ami_pct_rental > 0, p.jurisdiction);
  }
  assert.match(rules.meta.last_verified, isoDate);
  assert.match(rules.meta.review_by, isoDate);
  assert(rules.meta.review_by > rules.meta.last_verified, 'review_by must follow last_verified');
});

console.log(`\nprop123-rental-rules: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
