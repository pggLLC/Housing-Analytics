#!/usr/bin/env node
'use strict';
// The Deal Calculator's HOME and Prop 123 rent settings. Every limit the page
// uses must equal what js/chfa-rent-limits.js resolves from the data files, the
// Prop 123 choices must agree with the rules file, and a limit the program does
// not allow must leave revenue unavailable rather than borrowing another rent.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const limits = require('../js/chfa-rent-limits.js');
const chfa = require('../data/chfa-income-rent-limits-2026.json');
const hud = require('../data/hud-fmr-income-limits.json');
const home = require('../data/hud-home-rent-limits-co-2026.json');
const rules = require('../data/policy/prop123-rental-rules.json');
const zori = require('../data/market/zori_rents_co.json');
const bedroomMix = require('../data/market/acs_renter_bedrooms_co.json');
const read = (p) => fs.readFileSync(p, 'utf8');
const settle = () => new Promise((r) => setImmediate(r));
const BEDROOMS = [['studio', 'efficiency'], ['1br', '1BR'], ['2br', '2BR'], ['3br', '3BR'], ['4br', '4BR']];
const TIERS = [20, 30, 40, 50, 60, 70, 80, 100, 110, 120];
const COUNTY = '08031';
const SUMMIT = '08117';

function change(w, id, value, event = 'change') {
  const el = w.document.getElementById(id);
  assert(el, id);
  if (el.type === 'checkbox') el.checked = value;
  else el.value = String(value);
  assert.equal(el.type === 'checkbox' ? el.checked : el.value, el.type === 'checkbox' ? value : String(value), `${id} has no option ${value}`);
  el.dispatchEvent(new w.Event(event, { bubbles: true }));
}

async function calculator() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!e.message.startsWith('Not implemented')) errors.push(e.message); });
  const w = new JSDOM('<main><div id="dealCalcMount"></div></main>', { url: 'https://example.org/deal-calculator.html', runScripts: 'outside-only', virtualConsole: vc }).window;
  w.setTimeout = () => 0;
  w.setInterval = () => 0;
  const files = [['chfa-income-rent-limits', chfa], ['hud-fmr-income-limits', hud], ['hud-home-rent-limits', home],
    ['prop123-rental-rules', rules], ['zori_rents_co', zori], ['acs_renter_bedrooms_co', bedroomMix]];
  w.fetch = (url) => {
    const hit = files.find(([k]) => String(url).includes(k));
    return Promise.resolve({ ok: !!hit, json: () => Promise.resolve(hit ? JSON.parse(JSON.stringify(hit[1])) : null) });
  };
  for (const file of ['js/components/zori-rent-utils.js', 'js/utils/format-money.js', 'js/data-connectors/hud-fmr.js', 'js/deal-calculator-math.js',
    'js/chfa-rent-limits.js', 'js/deal-engine.js', 'js/deal-calculator.js', 'js/deal-calculator-report-meta.js', 'js/deal-calculator-share.js']) {
    if (file === 'js/chfa-rent-limits.js') await w.HudFmr.load();
    w.eval(read(file));
  }
  for (let i = 0; i < 5; i++) await settle();
  assert.deepEqual(errors, [], 'no script errors');
  w.__DealCalc.setChfaRentTable(chfa);
  w.__DealCalc.updateAmiLimitsFromFmr(COUNTY);
  return w;
}

function pickOnly(w, tier) {
  for (const t of TIERS) { change(w, 'dc-units-' + t, 0, 'input'); change(w, 'dc-chk-' + t, t === tier, 'input'); }
  change(w, 'dc-units', 1, 'input');
  change(w, 'dc-units-' + tier, 1, 'input');
}
const rents = (w) => w.document.getElementById('dc-r-rents').textContent.trim();
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + ': ' + e.stack); }
}

(async () => {
  await test('HOME settings use HUD\'s table and refuse tiers above the program\'s income limit', async () => {
    const w = await calculator();
    try {
      for (const [regime, field, maxTier] of [['home_high', 'high_home', 80], ['home_low', 'low_home', 50]]) {
        change(w, 'dc-rent-limit-regime', regime);
        assert(w.document.getElementById('dc-const-rent-burden').disabled, 'rent burden does not apply to HOME');
        const byBr = w.__DealCalc.getAmiLimitsByBr();
        let priced = 0;
        for (const tier of TIERS) BEDROOMS.forEach(([br, moduleBr], i) => {
          const expected = tier <= maxTier ? home.counties[COUNTY][field][String(i)] : null;
          assert.equal(byBr[tier][br], expected, `${regime} ${tier} ${br}`);
          assert.equal(limits.rentCeiling({ regime, homeTable: home, fips: COUNTY, tier, bedrooms: moduleBr }).grossRent, expected);
          if (expected != null) priced++;
        });
        assert(priced > 0, regime + ': nothing priced');
        assert(!w.document.getElementById('dc-rent-limit-caveats').hidden, regime + ': HOME caveats shown');
        pickOnly(w, 50);
        assert.equal(rents(w), money(home.counties[COUNTY][field]['2'] * 12), regime + ': rent roll uses the HOME rent');
        pickOnly(w, maxTier + 10 > 80 ? 100 : 60);
        assert(!/\$\s*\d/.test(rents(w)), regime + ': a tier above the limit leaves revenue unavailable');
      }
    } finally { w.close(); }
  });

  await test('Prop 123 programs offered agree with the rules file, and rents follow the chosen program', async () => {
    const w = await calculator();
    try {
      change(w, 'dc-rent-limit-regime', 'prop123');
      assert(!w.document.getElementById('dc-prop123-choices').hidden, 'program choices shown');
      const offered = [...w.document.getElementById('dc-prop123-program').options].map((o) => o.value).filter(Boolean);
      const expected = rules.programs.filter((p) => p.income_rule.type !== 'none' && p.income_rule.max_ami_pct != null && !p.id.includes('lihtc')).map((p) => p.id);
      assert(expected.length >= 2, 'rules file offers too few programs: the scan checked nothing');
      assert.deepEqual(offered, expected);
      const petitions = [...w.document.getElementById('dc-prop123-petition').options].map((o) => o.value).filter(Boolean);
      assert.deepEqual(petitions, rules.rural_resort_petitions.petitions.filter((x) => x.status === 'approved' && x.county_fips.includes(COUNTY)).map((x) => x.jurisdiction));

      // No program chosen: nothing is priced, and the page says why.
      assert(Object.values(w.__DealCalc.getAmiLimitsByBr()).every((row) => Object.values(row).every((v) => v === null)));
      assert(w.document.getElementById('dc-rent-limit-example').textContent.includes(limits.unavailableMessage('prop123_program_missing')));

      for (const program of expected) {
        change(w, 'dc-prop123-program', program);
        const byBr = w.__DealCalc.getAmiLimitsByBr();
        for (const tier of TIERS) for (const [br, moduleBr] of BEDROOMS) {
          const r = limits.rentCeiling({ regime: 'prop123', program, prop123Rules: rules, chfaTable: chfa, fips: COUNTY, tier, bedrooms: moduleBr });
          assert.equal(byBr[tier][br], r.grossRent, `${program} ${tier} ${br}`);
        }
      }
      change(w, 'dc-prop123-program', 'equity');
      assert(w.document.getElementById('dc-rent-limit-caveats').textContent.includes('project average'), 'project-average caveat shown');
      assert(w.document.getElementById('dc-rent-limit-caption').textContent.includes(rules.programs.find((p) => p.id === 'equity').name));
    } finally { w.close(); }
  });

  await test('an approved rural resort petition lifts the Land Banking cap; without it the tier is refused', async () => {
    const w = await calculator();
    try {
      w.__DealCalc.updateAmiLimitsFromFmr(SUMMIT);
      change(w, 'dc-rent-limit-regime', 'prop123');
      change(w, 'dc-prop123-program', 'land_banking');
      assert.equal(w.__DealCalc.getAmiLimitsByBr()[80]['2br'], null, 'above 60% without a petition');
      pickOnly(w, 80);
      assert(!/\$\s*\d/.test(rents(w)), 'revenue unavailable above the cap');
      const summit = rules.rural_resort_petitions.petitions.find((x) => x.jurisdiction === 'Summit County' && x.status === 'approved');
      assert(summit, 'Summit County petition is approved in the rules file');
      change(w, 'dc-prop123-petition', summit.jurisdiction);
      const expected = limits.rentCeiling({ regime: 'prop123', program: 'land_banking', prop123Rules: rules, chfaTable: chfa,
        fips: SUMMIT, tier: 80, bedrooms: '2BR', petitionJurisdiction: summit.jurisdiction }).grossRent;
      assert(expected > 0);
      assert.equal(w.__DealCalc.getAmiLimitsByBr()[80]['2br'], expected);
      assert.equal(rents(w), money(expected * 12));
      assert(w.document.getElementById('dc-rent-limit-caveats').textContent.includes('Summit County'));
      const offered = [...w.document.getElementById('dc-prop123-petition').options].map((o) => o.value).filter(Boolean);
      assert.deepEqual(offered, rules.rural_resort_petitions.petitions.filter((x) => x.status === 'approved' && x.county_fips.includes(SUMMIT)).map((x) => x.jurisdiction));
      // Moving the project to another county drops the petition and its higher limit.
      w.__DealCalc.updateAmiLimitsFromFmr(COUNTY);
      assert.equal(w.document.getElementById('dc-prop123-petition').value, '', 'petition cleared outside its county');
      assert(![...w.document.getElementById('dc-prop123-petition').options].some((o) => o.value === summit.jurisdiction), 'Summit petition not offered in Denver');
      assert.equal(w.__DealCalc.getAmiLimitsByBr()[80]['2br'], null, 'above 60% again outside Summit County');
    } finally { w.close(); }
  });

  await test('a mix above a project-average program\'s limit leaves revenue unavailable', async () => {
    const w = await calculator();
    try {
      change(w, 'dc-rent-limit-regime', 'prop123');
      const averaged = rules.programs.filter((p) => p.income_rule.type === 'project_average' && p.income_rule.max_ami_pct != null && !p.id.includes('lihtc'));
      assert(averaged.length >= 2, 'no project-average programs offered: the scan checked nothing');
      for (const p of averaged) {
        change(w, 'dc-prop123-program', p.id);
        pickOnly(w, 120);
        assert(!/\$\s*\d/.test(rents(w)), p.id + ': all 120% AMI units leave revenue unavailable');
        assert(w.__DealCalc.getResult().rentsUnknownReason.includes(`at most ${p.income_rule.max_ami_pct}% AMI`), p.id + ': the reason names the limit');
        const tier = [...TIERS].reverse().find((t) => t <= p.income_rule.max_ami_pct);
        pickOnly(w, tier);
        assert.equal(rents(w), money(w.__DealCalc.getAmiLimitsByBr()[tier]['2br'] * 12), p.id + ': a mix at the limit prices');
      }
    } finally { w.close(); }
  });

  await test('switching back to CHFA LIHTC restores the published CHFA rents', async () => {
    const w = await calculator();
    try {
      change(w, 'dc-rent-limit-regime', 'home_low');
      change(w, 'dc-rent-limit-regime', 'chfa_lihtc');
      const county = chfa.counties.find((c) => c.fips === COUNTY);
      assert.equal(w.__DealCalc.getAmiLimitsByBr()[60]['2br'], county.regular_tiers['60'].max_rents['2br']);
      assert(w.document.getElementById('dc-prop123-choices').hidden);
      assert(w.document.getElementById('dc-rent-limit-caveats').hidden);
    } finally { w.close(); }
  });

  console.log(`\ndeal-calc-rent-programs: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
