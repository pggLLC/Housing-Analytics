/**
 * chart-population-audit.mjs
 *
 * Headless Chrome audit that opens HNA at a known county AND a known
 * place, waits for renderers to settle, then asserts that every
 * named Chart.js canvas in EXPECTED_CHARTS has a real Chart instance
 * attached with at least one non-zero data point.
 *
 * Why
 * ---
 * This session has shipped a long string of "tests pass but UI broken"
 * fixes (chartRentBurdenBins reading wrong DP04 codes, chartLehd
 * expecting a flows[] array that doesn't exist, chartPyramid expecting
 * a cohorts[] shape, chartOwnerCostBurden reading non-existent count
 * fields, etc.). The existing test suite is source-grep only — it
 * can confirm a renderer function exists, but not that it actually
 * paints pixels in a browser.
 *
 * This script closes that gap. If a renderer regresses and a chart
 * goes empty, this audit fails CI before the user has to file a bug.
 *
 * Usage
 * -----
 *   AUDIT_BASE_URL=http://127.0.0.1:8080 \
 *     node scripts/audit/chart-population-audit.mjs
 *
 * Exits non-zero when any expected chart is missing, unattached, or
 * has all-zero data. Writes a JSON report to:
 *   audit-report/chart-population/{timestamp}.json
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL  = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:8080';
const TIMEOUT   = parseInt(process.env.PAGE_TIMEOUT_MS || '60000', 10);
const SETTLE_MS = parseInt(process.env.CHART_SETTLE_MS || '8000', 10);
const REPORT_DIR = path.resolve(__dirname, '..', '..', 'audit-report', 'chart-population');

// Only charts that should render from CACHED data are listed. Three
// HNA charts (chartIncomeDistribution, chartHousingAge,
// chartBedroomMix) get their data from fetchAcsExtended's batchA
// — which only runs against the live Census API and isn't reachable
// from the CI/preview sandbox. They're deliberately left out of the
// audit so green CI doesn't depend on Census being up; a separate
// future pass could add a mocked-API fixture or pre-bake those
// fields into the cached summaries.
const EXPECTED = [
  // ── County selection (Adams 08001): fullest coverage ──
  { fixture: 'hna-adams',  url: '/housing-needs-assessment.html?geoType=county&geoid=08001&auto=1', chart: 'chartTenure',           note: 'owner vs renter doughnut' },
  { fixture: 'hna-adams',  url: '/housing-needs-assessment.html?geoType=county&geoid=08001&auto=1', chart: 'chartStock',            note: 'housing-stock structure type' },
  { fixture: 'hna-adams',  url: '/housing-needs-assessment.html?geoType=county&geoid=08001&auto=1', chart: 'chartRentBurdenBins',   note: 'rent burden GRAPI bins' },
  { fixture: 'hna-adams',  url: '/housing-needs-assessment.html?geoType=county&geoid=08001&auto=1', chart: 'chartMode',             note: 'commute mode share' },
  { fixture: 'hna-adams',  url: '/housing-needs-assessment.html?geoType=county&geoid=08001&auto=1', chart: 'chartLehd',             note: 'commute inflow/outflow' },
  { fixture: 'hna-adams',  url: '/housing-needs-assessment.html?geoType=county&geoid=08001&auto=1', chart: 'chartPyramid',          note: 'age pyramid (county DOLA)' },
  { fixture: 'hna-adams',  url: '/housing-needs-assessment.html?geoType=county&geoid=08001&auto=1', chart: 'chartSenior',           note: 'senior age cohorts' },
  { fixture: 'hna-adams',  url: '/housing-needs-assessment.html?geoType=county&geoid=08001&auto=1', chart: 'chartWage',             note: 'LEHD WAC wage tiers' },
  { fixture: 'hna-adams',  url: '/housing-needs-assessment.html?geoType=county&geoid=08001&auto=1', chart: 'chartIndustry',         note: 'LEHD top industries' },
  { fixture: 'hna-adams',  url: '/housing-needs-assessment.html?geoType=county&geoid=08001&auto=1', chart: 'chartEmploymentTrend',  note: 'LEHD annualEmployment' },
  { fixture: 'hna-adams',  url: '/housing-needs-assessment.html?geoType=county&geoid=08001&auto=1', chart: 'chartWageTrend',        note: 'LEHD annualWages' },
  { fixture: 'hna-adams',  url: '/housing-needs-assessment.html?geoType=county&geoid=08001&auto=1', chart: 'chartIndustryAnalysis', note: 'LEHD industry share' },
  { fixture: 'hna-adams',  url: '/housing-needs-assessment.html?geoType=county&geoid=08001&auto=1', chart: 'chartWageGaps',         note: 'wage gap percent bars' },
  // ── Place selection (Paonia 0857300): place-apportioned LEHD ──
  { fixture: 'hna-paonia', url: '/housing-needs-assessment.html?geoType=place&geoid=0857300&auto=1', chart: 'chartLehd',         note: 'commute flows (apportioned from Delta)' },
  { fixture: 'hna-paonia', url: '/housing-needs-assessment.html?geoType=place&geoid=0857300&auto=1', chart: 'chartWage',         note: 'wage tiers (apportioned)' },
  { fixture: 'hna-paonia', url: '/housing-needs-assessment.html?geoType=place&geoid=0857300&auto=1', chart: 'chartIndustry',     note: 'industries (apportioned)' },
  { fixture: 'hna-paonia', url: '/housing-needs-assessment.html?geoType=place&geoid=0857300&auto=1', chart: 'chartEmploymentTrend', note: 'employment trend (apportioned)' },

  // ── Scenario Builder (Step 4): renders a default scenario on load ──
  { fixture: 'scenario-builder', url: '/hna-scenario-builder.html', chart: 'sbProjectionChart',
    note: 'default scenario projection line' },

  // ── Colorado Deep Dive: charts that paint on initial page load ──
  // (The remaining ~9 canvases on this page only render after the user
  // picks a county / metric in the dropdowns — out of scope here.)
  //
  // F160 — Dropped two stale entries (`confidence-chart`, `comparison-chart`)
  // that no longer exist in colorado-deep-dive.html. Both were on the
  // state-comparison tab that was removed in commit a36035c0
  // ("M2 — colorado-deep-dive state-comparison tab cleanup") but the
  // audit fixture wasn't updated, so the workflow has been failing
  // every scheduled run since with `canvas-missing`. Kept the 4 charts
  // that actually render on initial load.
  { fixture: 'colorado-deep-dive', url: '/colorado-deep-dive.html', chart: 'ami-need-chart',
    note: 'AMI-band need overview' },
  { fixture: 'colorado-deep-dive', url: '/colorado-deep-dive.html', chart: 'concessions-chart',
    note: 'developer concessions trend' },
  { fixture: 'colorado-deep-dive', url: '/colorado-deep-dive.html', chart: 'foreclosure-chart',
    note: 'foreclosure rate trend' },
  { fixture: 'colorado-deep-dive', url: '/colorado-deep-dive.html', chart: 'chartLihtcTimeline',
    note: 'LIHTC allocation timeline' },
];

function _summarize(results) {
  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  return { total: results.length, passed, failed };
}

async function _probeFixture(page, fixtureUrl, charts) {
  await page.goto(BASE_URL + fixtureUrl, { waitUntil: 'load', timeout: TIMEOUT });
  // Sub-county selections need the geoType/geoSelect change events to
  // fire to actually re-render. The auto=1 URL flow triggers this on
  // load; the SETTLE_MS wait covers fetchAcsExtended + LEHD load +
  // place-LEHD init + chart-rendering pipelines.
  await page.waitForTimeout(SETTLE_MS);
  // For place selections, the URL-param flow doesn't always populate
  // the workflow stepper. Manually trigger the change events to make
  // sure renderers fire with the right geoType/geoid.
  const params = new URL(BASE_URL + fixtureUrl).searchParams;
  const targetGeoType = params.get('geoType');
  const targetGeoid   = params.get('geoid');
  if (targetGeoType && targetGeoid) {
    await page.evaluate(([gt, gid]) => {
      const gtEl = window.HNAState && window.HNAState.els && window.HNAState.els.geoType;
      const gsEl = window.HNAState && window.HNAState.els && window.HNAState.els.geoSelect;
      if (!gtEl || !gsEl) return;
      if (gtEl.value !== gt) {
        gtEl.value = gt;
        gtEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
      setTimeout(() => {
        gsEl.value = gid;
        gsEl.dispatchEvent(new Event('change', { bubbles: true }));
      }, 200);
    }, [targetGeoType, targetGeoid]);
    await page.waitForTimeout(SETTLE_MS);
  }
  // Now probe every expected chart.
  return await page.evaluate((expectedIds) => {
    return expectedIds.map((id) => {
      const c = document.getElementById(id);
      if (!c) return { id, ok: false, reason: 'canvas-missing' };
      const chart = window.Chart && window.Chart.getChart && window.Chart.getChart(c);
      if (!chart) return { id, ok: false, reason: 'chart-not-attached' };
      const ds = (chart.data && chart.data.datasets) || [];
      const flat = [].concat(...ds.map(d => (d.data || [])));
      const finiteVals = flat.filter(v => typeof v === 'number' && Number.isFinite(v));
      if (!finiteVals.length) return { id, ok: false, reason: 'no-finite-data' };
      const nonZero = finiteVals.filter(v => v !== 0).length;
      if (!nonZero) return { id, ok: false, reason: 'all-zero-data', sample: finiteVals.slice(0, 6) };
      return { id, ok: true, dataLen: finiteVals.length, nonZeroLen: nonZero, sample: finiteVals.slice(0, 4) };
    });
  }, charts);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();

  // Group expectations by URL so we only navigate once per fixture.
  const byUrl = new Map();
  for (const e of EXPECTED) {
    if (!byUrl.has(e.url)) byUrl.set(e.url, []);
    byUrl.get(e.url).push(e);
  }

  const allResults = [];
  for (const [url, items] of byUrl) {
    process.stdout.write(`[chart-audit] ${url} … `);
    let probed;
    try {
      probed = await _probeFixture(page, url, items.map(i => i.chart));
    } catch (e) {
      process.stdout.write('FATAL: ' + e.message + '\n');
      probed = items.map(i => ({ id: i.chart, ok: false, reason: 'navigation-fatal: ' + e.message }));
    }
    const merged = items.map((it, idx) => ({
      fixture: it.fixture, url: it.url, chart: it.chart, note: it.note, ...probed[idx],
    }));
    const sum = _summarize(merged);
    process.stdout.write(`${sum.passed}/${sum.total} OK\n`);
    for (const r of merged) {
      const tag = r.ok ? '   ✅' : '   ❌';
      process.stdout.write(`${tag} ${r.chart.padEnd(28)} ${r.ok ? '' : '— ' + r.reason}\n`);
    }
    allResults.push(...merged);
  }

  await browser.close();

  // Persist report.
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(REPORT_DIR, `${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(allResults, null, 2));

  const sum = _summarize(allResults);
  console.log(`\n[chart-audit] ${sum.passed}/${sum.total} charts pass.`);
  console.log(`              Report: ${path.relative(process.cwd(), reportPath)}`);
  process.exit(sum.failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[chart-audit] fatal:', err);
  process.exit(2);
});
