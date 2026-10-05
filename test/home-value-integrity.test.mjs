import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { countyHpiAdjustment, buildCountyAcsRows } from '../scripts/hna/build_home_value_cascade.mjs';
import { buildPlaceholder } from '../scripts/generate-car-placeholder.mjs';
import { parseCountyRows, applyCountyPriceFloor } from '../scripts/fetch-car-showingtime.mjs';
const require = createRequire(import.meta.url);
const StudyGeography = require('../js/project-market-study/study-geography.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = p => JSON.parse(read(p));
const hpi = json('data/market/fhfa_hpi_subcounty_co.json');
const cascade = json('data/hna/home-value-cascade.json');
const registry = json('data/hna/geography-registry.json');
const reports = fs.readdirSync(path.join(ROOT, 'data')).filter(f => /^car-market-report-\d{4}-\d{2}\.json$/.test(f)).sort().map(f => json('data/' + f));

// Run the builder, rather than checking only yesterday's artifact. A restored
// CAGR must fail before anyone regenerates or commits data with the bad formula.
test('county values agree with actual annual FHFA change from the ACS dollar year', () => {
  const built = buildCountyAcsRows(registry, hpi).counties;
  let adjusted = 0, unadjusted = 0;
  for (const [fips, row] of Object.entries(built)) {
    const profile = json(`data/hna/summary/${fips}.json`).acsProfile;
    const year = Number(profile._acsYear);
    const series = hpi.counties[fips];
    const base = series?.hpi_by_year?.[year], latest = series?.hpi_by_year?.[series.latest_year];
    if (base > 0 && latest > 0) {
      adjusted++;
      const expected = Math.round(profile.DP04_0089E * latest / base);
      assert.equal(row.value, expected, `${fips}: actual HPI(${series.latest_year}) / HPI(${year})`);
      assert.equal(cascade.counties[fips].value, expected, `${fips}: committed cascade agrees`);
      assert.equal(row.fhfa_hpi.acs_dollar_year, year);
      assert.equal(row.fhfa_hpi.hpi_base, base);
      assert.equal(row.fhfa_hpi.hpi_latest, latest);
      const baseline = StudyGeography.localBaseline({ geoid: fips, geoLevel: 'county' }, { homeValueCascade: { counties: built } }).home_value;
      assert.equal(baseline.classification, 'modeled');
      assert.equal(baseline.method, row.method);
      assert.equal(baseline.as_of, row.as_of);
      assert.ok(baseline.source.includes(row.method));
    } else {
      unadjusted++;
      assert.equal(row.value, profile.DP04_0089E, `${fips}: no invented annual change`);
      assert.equal(row.source, 'acs_raw');
      assert.match(row.as_of, /unadjusted/i);
      assert.ok(row.method);
    }
  }
  assert.equal(adjusted + unadjusted, 64);
  assert.ok(adjusted > 0);
  const missing = structuredClone(hpi.counties['08031']);
  delete missing.hpi_by_year['2024'];
  assert.equal(countyHpiAdjustment(missing, 2024), null, 'a 10-year index does not fill a missing annual observation');
  missing.hpi_by_year['2024'] = null;
  assert.equal(countyHpiAdjustment(missing, 2024), null);
  console.log(`Checked ${adjusted} annual adjustments and ${unadjusted} unadjusted ACS counties`);
});

test('county estimates stay within 10% of well-sampled published CAR single-family medians', () => {
  const report = reports.findLast(r => r.estimated_scopes?.counties === false && Object.keys(r.counties || {}).length);
  assert.ok(report, 'a published county report is required');
  let checked = 0;
  for (const [fips, county] of Object.entries(report.counties)) {
    const sf = county.single_family;
    if (!(sf?.closed_sales >= 20 && sf.median_sale_price > 0)) continue;
    checked++;
    const row = cascade.counties[fips];
    assert.ok(Number.isFinite(row.value), `${fips}: benchmarked county value exists`);
    assert.ok(row.value <= sf.median_sale_price * 1.1,
      `${fips}: modeled ${row.value} exceeds 110% of CAR ${sf.median_sale_price} (${sf.closed_sales} sales, ${report.month})`);
  }
  assert.ok(checked > 0);
  console.log(`Benchmarked ${checked} counties against CAR ${report.month}`);
});

test('placeholders never compound prices and retain the last real month', () => {
  const real = { month: '2026-01', estimated: false, estimated_scopes: { statewide: false, metro: false },
    statewide: { median_sale_price: 600000, median_price_per_sqft: 300, active_listings: 100 },
    metro_areas: { denver: { name: 'Denver', median_sale_price: 620000, median_price_per_sqft: 310, active_listings: 80 } } };
  for (const previous of [null, real, buildPlaceholder('2026-02', real)]) {
    const next = buildPlaceholder('2026-03', previous);
    for (const row of [next.statewide, ...Object.values(next.metro_areas)]) {
      assert.equal(row.median_sale_price, null);
      assert.equal(row.median_price_per_sqft, null);
      assert.equal(row.estimated_reason, 'price_not_published_by_car');
    }
    if (previous) {
      assert.equal(next.statewide.last_real_price_month, real.month);
      assert.equal(next.metro_areas.denver.last_real_price_month, real.month);
      assert.equal(next.estimated_scopes.statewide, true, 'tracking values remain labelled estimated');
    }
  }
});

test('county price floor suppresses small samples, preserves a measured median at ten sales', () => {
  const fixture = parseCountyRows(read('test/fixtures/car-showingtime/202605-0SF.htm'));
  assert.equal(fixture['08125'].closed_sales, 2);
  assert.equal(fixture['08125'].median_sale_price, null);
  assert.equal(fixture['08125'].median_sale_price_unavailable_reason, 'fewer_than_10_closed_sales');
  for (const count of [null, 0, 2, 9, 10, 20]) {
    const row = applyCountyPriceFloor({ closed_sales: count, median_sale_price: 500000, median_sale_price_yoy_pct: 2 });
    assert.equal(row.median_sale_price, count >= 10 ? 500000 : null);
    if (!(count >= 10)) assert.ok(row.median_sale_price_unavailable_reason);
  }
  let checked = 0;
  for (const report of reports) for (const county of Object.values(report.counties || {})) {
    for (const row of [county.single_family, county.townhouse_condo]) {
      checked++;
      if (!(row.closed_sales >= 10)) {
        assert.equal(row.median_sale_price, null);
        assert.ok(row.median_sale_price_unavailable_reason);
      }
    }
  }
  assert.ok(checked > 0);
});

function hnaPage(page) {
  const html = read(page);
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://127.0.0.1/' + page });
  const script = [...dom.window.document.scripts].find(s => s.textContent.includes('function renderCARFallback('));
  assert.ok(script, `${page}: real CAR renderer exists`);
  dom.window.HNAState = { state: { current: { geoType: 'county', geoid: '08125' } } };
  // Prevent initialization network calls; invoke the real renderer with controlled reports.
  dom.window.document.addEventListener = () => {};
  dom.window.eval(script.textContent);
  return dom;
}

for (const page of ['housing-needs-assessment.html', 'hna-where-its-heading.html']) {
  test(`${page}: estimated prices never render, even from an older unsanitized cache`, async () => {
    const dom = hnaPage(page), document = dom.window.document;
    try {
      let checked = 0;
      for (const original of reports) {
        const report = structuredClone(original);
        // Deliberately put numbers back in the estimated rows. File cleanup alone
        // cannot satisfy this test; the actual rendering path must reject them.
        if (report.estimated_scopes.statewide) report.statewide.median_sale_price = 987654;
        if (report.estimated_scopes.metro) for (const row of Object.values(report.metro_areas)) row.median_sale_price = 876543;
        dom.window.__HNA_CAR_TEST__.renderCARFallback(report);
        const scopes = [[document.getElementById('bridgeStatewideCard'), report.estimated_scopes.statewide],
          [document.getElementById('bridgeRegionGrid'), report.estimated_scopes.metro]];
        assert.ok(scopes.every(([scope]) => scope));
        for (const [scope, estimated] of scopes) {
          checked++;
          if (estimated) assert.ok(scope.querySelector('[data-car-price-unavailable="price_not_published_by_car"]'));
          assert.ok(!/\$987|\$876/.test(scope.textContent), 'estimated values must not become prices');
        }
      }
      assert.equal(checked, reports.length * 2);
      assert.ok(checked > 0);
      const report = buildPlaceholder('2026-03', { month: '2026-01', statewide: { median_sale_price: 123456 }, metro_areas: {} });
      dom.window.__HNA_CAR_TEST__.renderCARFallback(report);
      assert.ok(document.getElementById('bridgeStatewideCard').textContent.includes('2026-01'));
      // County sample floor also protects old cache entries written before the rule.
      report.estimated_scopes.counties = false;
      report.counties = { '08125': { name: 'Yuma County', single_family: { closed_sales: 2, median_sale_price: 70000 } } };
      dom.window.__HNA_CAR_TEST__.renderCARFallback(report);
      assert.ok(document.querySelector('[data-car-price-unavailable="fewer_than_10_closed_sales"]'));
      assert.ok(!document.getElementById('bridgeRegionGrid').textContent.includes('$70'));
      report.counties['08125'].single_family.closed_sales = 10;
      dom.window.__HNA_CAR_TEST__.renderCARFallback(report);
      assert.equal(document.querySelector('[data-car-price]').getAttribute('data-car-price'), '70000');
      let rendered = null;
      assert.equal(await dom.window.__HNA_CAR_TEST__.tryLoadCARFallback({ urls: ['fixture'],
        fetcher: async () => ({ ok: true, json: async () => report }), render: data => { rendered = data; } }), true);
      assert.equal(rendered, report, 'null statewide price does not discard usable county data');
    } finally { dom.window.close(); }
  });
}

test('Deep Dive suppresses both estimated statewide price figures and labels tracking estimates', async () => {
  const html = read('colorado-deep-dive.html');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  try {
    const { window } = dom;
    Object.defineProperty(window.document, 'readyState', { value: 'complete' });
    const script = [...window.document.scripts].find(s => s.textContent.includes('HousingDataIntegration.loadCARData()'));
    assert.ok(script);
    for (const estimated of [true, false]) {
      window.HousingDataIntegration = { loadCARData: async () => ({ month: '2026-08', estimated_scopes: { statewide: estimated },
        statewide: { median_sale_price: 987654, median_price_per_sqft: 987, active_listings: 100, last_real_price_month: '2026-01' } }) };
      window.eval(script.textContent);
      await new Promise(resolve => setImmediate(resolve));
      if (estimated) {
        // The policy tab used to write these same cards again from the old,
        // unflagged February placeholder. Exercise that late writer too.
        window.DataService = { baseData: name => 'data/' + name, getJSON: async url =>
          url.includes('car-market') ? json('data/car-market.json') : {} };
        window.eval(read('js/utils/format-money.js'));
        window.eval(read('js/colorado-deep-dive.js'));
        window.coloradoDeepDive.activateTab('tab-policy-simulator', { updateHash: false });
        await new Promise(resolve => setImmediate(resolve));
      }
      for (const id of ['carMedianPrice', 'carPricePerSqFt']) {
        const value = window.document.getElementById(id).textContent;
        assert.equal(value.includes('$'), !estimated, `${id}: only real prices are figures`);
        if (estimated) assert.ok(value.includes('2026-01'));
      }
      if (estimated) assert.match(window.document.getElementById('carFreshness').textContent, /estimated/i);
    }
  } finally { dom.window.close(); }
});
