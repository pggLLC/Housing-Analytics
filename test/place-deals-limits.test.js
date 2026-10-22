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

// 5. Which geography. Off the HNA: the workflow jurisdiction, a town resolving to its county.
//    On the HNA: the geography the report shows (a ?geoid= link can differ from the saved
//    jurisdiction), and nothing for statewide, combined or regional views.
function ctxFor(jurisdiction, hnaCurrent) {
  const dom = new JSDOM('<main></main>', { runScripts: 'outside-only', url: 'http://127.0.0.1/hna-what-to-do.html' });
  dom.window.WorkflowState = { getJurisdiction: () => jurisdiction };
  if (hnaCurrent !== undefined) dom.window.HNAState = { state: { current: hnaCurrent } };
  dom.window.eval(source);
  return JSON.parse(JSON.stringify(dom.window.PlaceDealsLimits._context()));  // plain object across the JSDOM realm
}
assert.deepEqual(ctxFor({ geoType: 'place', geoid: '0828745', name: 'Fruita (city)', countyFips: '08077' }),
  { kind: 'place', fips: '08077', place: 'Fruita (city)', placeGeoid: '0828745' });
assert.deepEqual(ctxFor({ geoType: 'county', geoid: '08077', countyFips: '08077' }), { kind: 'county', fips: '08077', place: null, placeGeoid: null });
assert.equal(ctxFor({ geoType: 'county', geoid: '077' }).fips, '08077');
assert.equal(ctxFor({ geoType: 'state', geoid: '08' }).kind, 'none');
assert.equal(ctxFor(null).kind, 'none');
const savedDenver = { geoType: 'county', geoid: '08031', countyFips: '08031' };
assert.equal(ctxFor(savedDenver, { geoType: 'county', geoid: '08077' }).fips, '08077', 'HNA geography must win over the saved jurisdiction');
assert.deepEqual(ctxFor(savedDenver, { geoType: 'place', geoid: '0828745', label: 'Fruita (city)', contextCounty: '08077' }),
  { kind: 'place', fips: '08077', place: 'Fruita (city)', placeGeoid: '0828745' });
assert.equal(ctxFor(savedDenver, { geoType: 'place', geoid: '0828745', contextCounty: '077' }).fips, '08077');
assert.equal(ctxFor(savedDenver, { geoType: 'combined', geoid: 'combined', label: 'Two towns' }).kind, 'area');
assert.equal(ctxFor(savedDenver, { geoType: 'regional-comparison', geoid: 'region:x' }).kind, 'area');
assert.equal(ctxFor(savedDenver, { geoType: 'state', geoid: '08' }).kind, 'none');
assert.equal(ctxFor(savedDenver, null).kind, 'loading');

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

  // 9. A town in two counties shows both: Erie (0824950) spans Weld and Boulder.
  {
    const d2 = new JSDOM('<div id="l" data-chfa-limits></div><div id="d" data-place-deals></div>', { runScripts: 'outside-only', url: 'http://127.0.0.1/hna-what-to-do.html' });
    const w2 = d2.window;
    w2.HNAState = { state: { current: { geoType: 'place', geoid: '0824950', label: 'Erie (town)', contextCounty: '08123' } } };
    w2.fetch = (url) => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(read(url))) });
    w2.eval(source);
    await new Promise((r) => setTimeout(r, 50));
    const lim = w2.document.getElementById('l');
    const opts = [...lim.querySelectorAll('select option')].map((o) => o.textContent);
    assert.deepEqual(opts, ['Weld County (most residents)', 'Boulder County'], 'Erie should offer both counties');
    assert.ok(lim.textContent.includes('Limits for Weld County'));
    const sel = lim.querySelector('select');
    sel.value = '1'; sel.dispatchEvent(new w2.Event('change'));
    assert.ok(lim.textContent.includes('Limits for Boulder County'), 'picking Boulder should show Boulder limits');
    const dl = w2.document.getElementById('d');
    assert.ok(dl.textContent.includes('Weld and Boulder counties'), 'deals should cover both counties');
    assert.ok(dl.textContent.includes('All write-ups for Boulder County'));
  }

  // 10. The five-card preview for a town in several counties keeps each county that has a
  //     write-up (Aurora: Arapahoe, Adams, Douglas), and links only to counties that have one
  //     (Brook Forest: Jefferson yes, Clear Creek none yet).
  async function dealsFor(current) {
    const d3 = new JSDOM('<div id="d" data-place-deals></div>', { runScripts: 'outside-only', url: 'http://127.0.0.1/hna-what-to-do.html' });
    d3.window.HNAState = { state: { current } };
    d3.window.fetch = (url) => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(read(url))) });
    d3.window.eval(source);
    await new Promise((r) => setTimeout(r, 50));
    return d3.window.document.getElementById('d');
  }
  {
    const el = await dealsFor({ geoType: 'place', geoid: '0804000', label: 'Aurora (city)', contextCounty: '08005' });
    const metas = [...el.querySelectorAll('.pdl-deal__meta')].map((m) => m.textContent);
    assert.equal(metas.length, 5);
    for (const c of ['Arapahoe', 'Adams', 'Douglas']) {
      if (deals.some((d) => d.county === c)) assert.ok(metas.some((m) => m.includes(c + ' County')), 'Aurora preview is missing ' + c + ' County');
    }
    const bf = await dealsFor({ geoType: 'place', geoid: '0808950', label: 'Brook Forest (CDP)', contextCounty: '08059' });
    const hrefs = [...bf.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    assert.ok(hrefs.includes('deal-summary.html?county=Jefferson'));
    assert.ok(!hrefs.some((h) => /county=Clear/.test(h)), 'no link to a county without write-ups');
  }

  // 11. deal-summary.html?county=<county with no write-up> keeps that county selected (empty
  //     list), instead of falling back to every write-up.
  {
    const html = '<article data-deal-summary><div data-ds-view></div></article>';
    const d4 = new JSDOM(html, { runScripts: 'outside-only', url: 'http://127.0.0.1/deal-summary.html?county=Clear%20Creek' });
    d4.window.fetch = (url) => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(read(url))) });
    d4.window.eval(ds);
    await new Promise((r) => setTimeout(r, 50));
    const doc = d4.window.document;
    assert.equal(doc.getElementById('dsCounty').value, 'Clear Creek');
    assert.ok(doc.querySelector('[data-ds-count]').textContent.startsWith('Showing 0 of'), doc.querySelector('[data-ds-count]').textContent);
  }

  console.log('place-deals-limits: PASS (' + deals.length + ' write-ups, ' + limits.counties.length + ' counties)');
})().catch((e) => { console.error(e); process.exit(1); });
