#!/usr/bin/env node
'use strict';
// HOME and Prop 123 rent-limit regimes in js/chfa-rent-limits.js. Every rent the
// module returns must agree with the data file it comes from, and a program
// limit that is missing must be unavailable, never the CHFA LIHTC value.
const assert = require('node:assert/strict');
const limits = require('../js/chfa-rent-limits.js');
const chfa = require('../data/chfa-income-rent-limits-2026.json');
const home = require('../data/hud-home-rent-limits-co-2026.json');
const rules = require('../data/policy/prop123-rental-rules.json');

const BEDROOMS = [['efficiency', '0', '0br'], ['1BR', '1', '1br'], ['2BR', '2', '2br'], ['3BR', '3', '3br'], ['4BR', '4', '4br']];
const PERSONS = { efficiency: [1], '1BR': [1, 2], '2BR': [3], '3BR': [4, 5], '4BR': [6] };

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + ': ' + e.message); }
}

test('HOME rents equal HUD\'s table in every county and bedroom size', () => {
  let checked = 0;
  for (const [fips, county] of Object.entries(home.counties)) {
    for (const [br, key] of BEDROOMS) {
      for (const [regime, field] of [['home_high', 'high_home'], ['home_low', 'low_home']]) {
        const r = limits.rentCeiling({ regime, homeTable: home, fips, tier: 50, bedrooms: br });
        assert.equal(r.grossRent, county[field][key], `${regime} ${fips} ${br}`);
        assert.equal(r.tableYear, home.meta.fiscal_year);
        assert.equal(r.sourceUrl, home.meta.source_page);
        checked++;
      }
    }
  }
  assert(checked >= 64 * 5 * 2, 'too few HOME cells checked');
});

test('HOME tiers must qualify: High HOME to 80% AMI, Low HOME to 50%', () => {
  const at = (regime, tier) => limits.rentCeiling({ regime, homeTable: home, fips: '08001', tier, bedrooms: '2BR' });
  assert.equal(at('home_high', 80).grossRent, home.counties['08001'].high_home['2']);
  assert.equal(at('home_high', 90).unavailableReason, 'tier_above_program');
  assert.equal(at('home_low', 50).grossRent, home.counties['08001'].low_home['2']);
  assert.equal(at('home_low', 60).unavailableReason, 'tier_above_program');
  // A deeper tier never lowers the HOME ceiling.
  assert.equal(at('home_low', 30).grossRent, at('home_low', 50).grossRent);
});

// Prop 123 caps gross rent at 30% of the unit's imputed income limit. The module
// returns the lower of CHFA's published rent and that rule, and the cells where
// CHFA publishes more than the rule must be the ones the rules file records.
test('Prop 123 rents are the lower of CHFA\'s cell and the 30% rule, and agree with the rules file', () => {
  const recorded = rules.rent_table_deviations.cells
    .filter((c) => c.published_max_rent > c.thirty_percent_rule_rent)
    .map((c) => `${c.fips} ${c.ami_pct} ${c.bedrooms}`).sort();
  const found = [];
  let checked = 0;
  for (const county of chfa.counties) {
    for (const tier of Object.keys(county.regular_tiers)) {
      const row = county.regular_tiers[tier];
      for (const [br, , key] of BEDROOMS) {
        const r = limits.rentCeiling({ regime: 'prop123', program: 'equity', prop123Rules: rules,
          chfaTable: chfa, fips: county.fips, tier: +tier, bedrooms: br });
        const ps = PERSONS[br];
        const rule = Math.floor(ps.reduce((s, p) => s + row.income_limits[`${p}p`], 0) / ps.length * 0.3 / 12);
        assert.equal(r.grossRent, Math.min(row.max_rents[key], rule), `${county.fips} ${tier} ${br}`);
        if (row.max_rents[key] > rule) {
          found.push(`${county.fips} ${tier} ${key}`);
          assert(r.caveats.some((c) => c.includes('which is the Prop 123 cap')), 'over-rule cell must say so');
        }
        checked++;
      }
    }
  }
  assert(checked > 3000, 'too few Prop 123 cells checked: ' + checked);
  assert.deepEqual(found.sort(), recorded);
});

test('Prop 123 program rules come from the rules file', () => {
  const at = (program, tier) => limits.rentCeiling({ regime: 'prop123', program, prop123Rules: rules,
    chfaTable: chfa, fips: '08001', tier, bedrooms: '2BR' });
  for (const p of rules.programs) {
    const r = at(p.id, 60);
    const income = p.income_rule;
    if (income.type === 'none') assert.equal(r.unavailableReason, 'prop123_no_unit_limits', p.id);
    else if (income.max_ami_pct == null) assert.equal(r.unavailableReason, 'prop123_limit_unconfirmed', p.id);
    else assert(r.grossRent > 0, p.id);
    if (income.per_unit_max_ami_pct != null) {
      assert.equal(at(p.id, income.per_unit_max_ami_pct + 10).unavailableReason,
        income.rural_resort_petition ? 'tier_above_program_without_petition' : 'tier_above_program', p.id);
    }
    if (income.type === 'project_average') {
      assert(at(p.id, 70).grossRent > 0, `${p.id}: a unit may sit above the project average`);
      assert(r.caveats.some((c) => c.includes(`${income.max_ami_pct}% AMI`)), `${p.id}: average caveat`);
    }
  }
});

// Petitions name jurisdictions and programs; only an approved one changes a limit.
test('approved rural resort petitions set the limit for the programs they cover', () => {
  const at = (program, tier, petitionJurisdiction, fips) => limits.rentCeiling({ regime: 'prop123', program, prop123Rules: rules,
    chfaTable: chfa, fips: fips || (rules.rural_resort_petitions.petitions.find((x) => x.jurisdiction === petitionJurisdiction) || { county_fips: ['08117'] }).county_fips[0],
    tier, bedrooms: '2BR', petitionJurisdiction });
  const petitions = rules.rural_resort_petitions.petitions;
  const approved = petitions.filter((x) => x.status === 'approved' && x.programs.includes('land_banking'));
  assert(approved.length >= 1, 'no approved Land Banking petition: the scan checked nothing');
  for (const x of approved) {
    const ok = at('land_banking', x.ami_pct_rental, x.jurisdiction);
    assert(ok.grossRent > 0, `${x.jurisdiction}: ${x.ami_pct_rental}% allowed`);
    assert.equal(ok.petition.amiPctRental, x.ami_pct_rental);
    assert(ok.caveats.some((c) => c.includes(x.jurisdiction)), 'petition caveat');
    assert.equal(at('land_banking', x.ami_pct_rental + 10, x.jurisdiction).unavailableReason, 'tier_above_program');
    if (x.programs.includes('equity')) {
      assert(at('equity', 60, x.jurisdiction).caveats.some((c) => c.includes(`average to ${x.ami_pct_rental}% AMI`)), 'equity average follows petition');
    }
  }
  for (const x of petitions.filter((y) => y.status !== 'approved' && y.programs.includes('land_banking'))) {
    const r = at('land_banking', 70, x.jurisdiction);
    assert.equal(r.unavailableReason, 'tier_above_program_without_petition', `${x.jurisdiction} (${x.status}) changes nothing`);
  }
  assert.equal(at('concessionary_debt_lihtc_gap', 60, approved[0].jurisdiction).petition, null, 'LIHTC programs take no petition');
  assert.equal(at('land_banking', 60, 'Nowhere').unavailableReason, 'prop123_petition_unknown');
  // A petition filed elsewhere cannot lift another county's limit.
  for (const x of approved) {
    assert(Array.isArray(x.county_fips) && x.county_fips.every((f) => /^08\d{3}$/.test(f)), `${x.jurisdiction}: county_fips`);
    assert.equal(at('land_banking', x.ami_pct_rental, x.jurisdiction, '08031').unavailableReason, 'prop123_petition_other_county', `${x.jurisdiction} from Denver`);
  }
});

test('every petition names the county it applies in', () => {
  const counties = new Set(chfa.counties.map((c) => c.fips));
  for (const x of rules.rural_resort_petitions.petitions) {
    assert(Array.isArray(x.county_fips) && x.county_fips.length > 0, x.jurisdiction);
    for (const f of x.county_fips) assert(counties.has(f), `${x.jurisdiction}: ${f} is not a Colorado county in the CHFA table`);
  }
});

// Equity and Concessionary Debt limit the project average, not each unit, so
// every tier prices; the mix as a whole must still qualify.
test('project-average programs flag a mix above the program average', () => {
  const avg = (program, units, petitionJurisdiction, fips = '08031') => limits.prop123ProjectAverage({ prop123Rules: rules, program, units, petitionJurisdiction, fips });
  const averaged = rules.programs.filter((p) => p.income_rule.type === 'project_average' && p.income_rule.max_ami_pct != null);
  assert(averaged.length >= 2, 'no project-average programs: the scan checked nothing');
  for (const p of averaged) {
    const max = p.income_rule.max_ami_pct;
    const at = avg(p.id, [{ tier: max, units: 10 }]);
    assert(at.applies && !at.exceeds && at.averageAmiPct === max && at.maxAmiPct === max, p.id + ' at the limit');
    assert(avg(p.id, [{ tier: 120, units: 1 }]).exceeds, p.id + ': all 120% units exceed');
    const mixed = avg(p.id, [{ tier: max + 20, units: 1 }, { tier: max - 20, units: 1 }]);
    assert(!mixed.exceeds && mixed.averageAmiPct === max, p.id + ': units above and below may balance');
  }
  const land = avg('land_banking', [{ tier: 120, units: 1 }]);
  assert(!land.applies && !land.exceeds, 'Land Banking caps each unit instead');
  const summit = rules.rural_resort_petitions.petitions.find((x) => x.jurisdiction === 'Summit County' && x.status === 'approved');
  const lifted = avg('equity', [{ tier: summit.ami_pct_rental, units: 1 }], summit.jurisdiction, summit.county_fips[0]);
  assert(lifted.maxAmiPct === summit.ami_pct_rental && !lifted.exceeds, 'approved petition sets the average limit');
  assert.equal(avg('equity', [{ tier: 60, units: 1 }], summit.jurisdiction, '08031').unavailableReason, 'prop123_petition_other_county');
});

test('a missing program limit is unavailable, never the CHFA LIHTC rent', () => {
  const base = { chfaTable: chfa, fips: '08001', tier: 60, bedrooms: '2BR' };
  const cases = [
    [{ regime: 'home_high' }, 'home_table_missing'],
    [{ regime: 'home_low', homeTable: home, fips: '08999' }, 'county_missing'],
    [{ regime: 'prop123', program: 'equity' }, 'prop123_rules_missing'],
    [{ regime: 'prop123', prop123Rules: rules }, 'prop123_program_missing'],
    [{ regime: 'prop123', prop123Rules: rules, program: 'concessionary_debt_modular' }, 'prop123_no_unit_limits'],
    [{ regime: 'prop123', prop123Rules: rules, program: 'doh_supportive_housing' }, 'prop123_limit_unconfirmed'],
    [{ regime: 'prop123', prop123Rules: rules, program: 'equity', useHera: true }, 'prop123_hera_not_allowed'],
    [{ regime: 'prop123', prop123Rules: rules, program: 'equity', tier: 85 }, 'tier_missing'],
    [{ regime: 'prop123', prop123Rules: rules, program: 'land_banking', tier: 70 }, 'tier_above_program_without_petition'],
    [{ regime: 'prop123', prop123Rules: rules, program: 'land_banking', petitionJurisdiction: 'Nowhere' }, 'prop123_petition_unknown']
  ];
  for (const [extra, reason] of cases) {
    const r = limits.rentCeiling({ ...base, ...extra });
    assert.equal(r.grossRent, null, reason);
    assert.equal(r.unavailableReason, reason);
    assert.notEqual(limits.unavailableMessage(reason), 'Rent unavailable', `${reason} needs its own message`);
  }
});

console.log(`\nrent-limit-programs: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
