#!/usr/bin/env node
// test/place-deals-limits.test.js
//
// The Housing Needs Assessment pages show the awarded deals with a write-up in
// the picked county and CHFA's 2026 rent and income limits for it
// (js/components/place-deals-limits.js). Both are looked up by county, so a
// county name that differs between data/deals/index.json and the CHFA limits
// file would silently show "no deals" for that county.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const deals = JSON.parse(read('data/deals/index.json')).deals;
const limits = JSON.parse(read('data/chfa-income-rent-limits-2026.json'));
const source = read('js/components/place-deals-limits.js');

// 1. Every county a deal write-up names is one CHFA's limits file knows.
const limitNames = new Set(limits.counties.map((c) => c.county_name));
const unknown = [...new Set(deals.map((d) => d.county))].filter((c) => !limitNames.has(c));
assert.deepEqual(unknown, [], 'deal write-up counties missing from the CHFA limits file: ' + unknown.join(', '));
assert.equal(limits.counties.length, 64, 'CHFA limits should cover all 64 counties');
for (const c of limits.counties) {
  assert.match(c.fips, /^08\d{3}$/, c.county_name + ' fips');
  assert.ok(c.regular_tiers && c.regular_tiers['60'], c.county_name + ' has no 60% tier');
}

// 2. Spot check against CHFA's PDF, "2026 Income Limit and Maximum Rent Tables
//    for All Colorado Counties" (HUD effective May 1, 2026), Adams row:
//    "Adams 60% 1,512 1,620 1,944 2,247 2,506 60,480 69,120 77,760 86,400 ..."
const adams = limits.counties.find((c) => c.county_name === 'Adams').regular_tiers['60'];
assert.deepEqual(adams.max_rents, { '0br': 1512, '1br': 1620, '2br': 1944, '3br': 2247, '4br': 2506 });
assert.equal(adams.income_limits['4p'], 86400);

// 3. Mounts are on the canonical page and carried into the generated views.
const canon = read('housing-needs-assessment.html');
assert.ok(canon.includes('js/components/place-deals-limits.js'), 'component not loaded on the full report');
assert.ok(canon.includes('data-place-deals'), 'deals mount missing from the full report');
assert.ok(canon.includes('data-chfa-limits'), 'limits mount missing from the full report');
assert.ok(read('hna-what-to-do.html').includes('data-place-deals'), 'deals mount missing from What to do');
assert.ok(read('hna-what-households-can-afford.html').includes('data-chfa-limits'), 'limits mount missing from What households can afford');

// 4. Deal Summaries is in the header menu.
assert.ok(/label:\s*"Deal Summaries",\s*href:\s*"deal-summary\.html"/.test(read('js/navigation.js')), 'Deal Summaries not in the menu');

// 5. County resolution: a town resolves to its county, a state pick to nothing.
function countyFor(jurisdiction) {
  const dom = new JSDOM('<main></main>', { runScripts: 'outside-only', url: 'http://127.0.0.1/hna-what-to-do.html' });
  dom.window.WorkflowState = { getJurisdiction: () => jurisdiction };
  dom.window.eval(source);
  const c = dom.window.PlaceDealsLimits._currentCounty();
  return c ? JSON.parse(JSON.stringify(c)) : c;  // plain object across the JSDOM realm
}
assert.deepEqual(countyFor({ geoType: 'place', geoid: '0828745', name: 'Fruita (city)', countyFips: '08077' }), { fips: '08077', place: 'Fruita (city)' });
assert.deepEqual(countyFor({ geoType: 'county', geoid: '08077', countyFips: '08077' }), { fips: '08077', place: null });
assert.equal(countyFor({ geoType: 'county', geoid: '077' }).fips, '08077');
assert.equal(countyFor({ geoType: 'state', geoid: '08' }), null);
assert.equal(countyFor(null), null);

// 6. AMI range label from a write-up's income mix.
const dom = new JSDOM('', { runScripts: 'outside-only' });
dom.window.eval(source);
const range = dom.window.PlaceDealsLimits._amiRange;
assert.equal(range([{ level: '30% AMI' }, { level: '70% AMI' }, { level: '50% AMI' }]), '30–70% AMI');
assert.equal(range([{ level: '60% AMI' }]), '60% AMI');
assert.equal(range([{ level: 'Manager unit' }]), '');

// 7. A slower render for a county the user has left must not overwrite the newer one.
(async () => {
  const dom = new JSDOM('<div id="m" data-place-deals></div>', { runScripts: 'outside-only', url: 'http://127.0.0.1/hna-what-to-do.html' });
  const w = dom.window;
  let juris = { geoType: 'county', geoid: '08031', countyFips: '08031' };
  w.WorkflowState = { getJurisdiction: () => juris };
  const files = {
    'data/deals/index.json': { deals },
    'data/chfa-income-rent-limits-2026.json': limits,
  };
  const held = [];
  w.fetch = (url) => {
    const body = files[url] || JSON.parse(read(url));
    const res = { ok: true, json: () => Promise.resolve(body) };
    if (/data\/deals\/.+-denver\.json$/.test(url)) return new Promise((r) => held.push(() => r(res)));
    return Promise.resolve(res);
  };
  w.eval(source);
  const mount = w.document.getElementById('m');
  w.PlaceDealsLimits._renderDeals(mount);          // Denver: detail files held
  await new Promise((r) => setTimeout(r, 20));
  juris = { geoType: 'county', geoid: '08077', countyFips: '08077' };
  w.PlaceDealsLimits._renderDeals(mount);          // Mesa: resolves at once
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(mount.textContent.includes('Mesa County'), 'Mesa render did not land');
  held.forEach((f) => f());                        // Denver finally arrives
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(mount.textContent.includes('Mesa County') && !mount.textContent.includes('Denver County'), 'stale Denver render overwrote Mesa');

  // 8. Paired 9% + 4% awards match both credit filters (js/deal-summary.js).
  const ds = read('js/deal-summary.js');
  const hasCredit = new Function(ds.match(/function hasCredit[\s\S]*?\n  \}\n/)[0] + '; return hasCredit;')();
  const paired = '2025 Federal 9% (Round One) and 4% housing tax credits (paired)';
  assert.ok(hasCredit(paired, '9%') && hasCredit(paired, '4%') && !hasCredit(paired, 'Other'));
  assert.ok(hasCredit('2025 Middle-Income Housing Tax Credit (MIHTC)', 'Other'));

  console.log('place-deals-limits: PASS (' + deals.length + ' write-ups, ' + limits.counties.length + ' counties)');
})().catch((e) => { console.error(e); process.exit(1); });
