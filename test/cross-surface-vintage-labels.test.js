'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function assertIncludes(src, needle, label) {
  assert(src.includes(needle), `${label}: expected to find "${needle}"`);
}

function assertExcludes(src, needle, label) {
  assert(!src.includes(needle), `${label}: expected not to find "${needle}"`);
}

// Current vintages come from the data, so a refresh to FY2027 (and the label
// rewrite scripts/sync-hud-vintage-labels.mjs does with it) stays green.
const hudMeta = JSON.parse(read('data/hud-fmr-income-limits.json')).meta;
const FMR_FY = `FY${hudMeta.fiscal_year}`;
const IL_FY = `FY${hudMeta.income_limits_fiscal_year}`;
const QCT_YEAR = JSON.parse(read('data/qct-colorado.json')).designationYear
  ?? Number(/_(\d{4}) FeatureServer/.exec(JSON.parse(read('data/qct-colorado.json')).source)[1]);
const DDA_YEAR = JSON.parse(read('data/dda-colorado.json')).designationYear
  ?? Number(/_(\d{4}) FeatureServer/.exec(JSON.parse(read('data/dda-colorado.json')).source)[1]);

console.log('\nCross-surface vintage label guards');
console.log('='.repeat(44));

const hudFmr = read('js/data-connectors/hud-fmr.js');
assertIncludes(hudFmr, `${FMR_FY} FMR / mo`, 'HUD FMR connector table header');
const staleFmrTableHeader = 'FY20' + '25 FMR / mo';
const staleHudFmrVintage = 'HUD FMR FY20' + '25';
const staleHudFmrVintageSpaced = 'HUD FMR FY 20' + '25';
assertExcludes(hudFmr, staleFmrTableHeader, 'HUD FMR connector stale table header');
assertExcludes(hudFmr, staleHudFmrVintageSpaced, 'HUD FMR connector stale spaced vintage');

const hnaExport = read('js/hna/hna-export.js');
assertIncludes(hnaExport, `HUD FMR ${FMR_FY}`, 'HNA export FMR vintage');
assertExcludes(hnaExport, staleHudFmrVintage, 'HNA export stale FMR vintage');
assertExcludes(hnaExport, staleHudFmrVintageSpaced, 'HNA export stale spaced FMR vintage');

const developerBrief = read('developer-brief.html');
assertIncludes(developerBrief, `HUD FMR ${FMR_FY}`, 'developer brief FMR source link');
assertExcludes(developerBrief, staleHudFmrVintage, 'developer brief stale FMR link');
assertExcludes(developerBrief, staleHudFmrVintageSpaced, 'developer brief stale spaced FMR link');
assertExcludes(developerBrief, "HUD FMR FY25'", 'developer brief stale FY25 source label');

const dealCalculator = read('js/deal-calculator.js');
assertIncludes(dealCalculator, `HUD FMR ${FMR_FY}`, 'Deal Calculator FMR source link');
assertExcludes(dealCalculator, staleHudFmrVintage, 'Deal Calculator stale FMR source link');
assertExcludes(dealCalculator, staleHudFmrVintageSpaced, 'Deal Calculator stale spaced FMR source link');

const amiGap = read('js/co-ami-gap.js');
const staleCountyIncomeLimits = 'FY 20' + '25 Income Limits';
assertIncludes(amiGap, `FY ${hudMeta.income_limits_fiscal_year} county Income Limits`, 'AMI-gap county tooltip uses the current Income Limits vintage');
assertExcludes(amiGap, staleCountyIncomeLimits, 'AMI-gap has no stale FY2025 county Income Limits label');
// The statewide benchmark's year is read from the AMI-gap file's meta, never typed.
assertIncludes(amiGap, 'fy(meta.statewide_ami_year)', 'AMI-gap names the statewide benchmark year from the data file');
assertExcludes(amiGap, 'statewide benchmark remains FY', 'AMI-gap has no typed statewide benchmark year');

['housing-needs-assessment.html', 'deal-calculator.html', 'market-analysis.html'].forEach((relPath) => {
  const src = read(relPath);
  assertIncludes(src, `FMR ${FMR_FY} · IL ${IL_FY}`, `${relPath} current FMR/IL data-quality vintage`);
  assertExcludes(
    src,
    "{ name: 'HUD FMR / Income Limits', status: 'primary', vintage: 'FY2025'",
    `${relPath} stale combined FMR/IL data-quality vintage`
  );
});

const hnaHtml = read('housing-needs-assessment.html');
const coloradoDeepDive = read('colorado-deep-dive.html');

function withoutStatewideBenchmarkDisclosure(src) {
  return src.split(/[.!?\n]/).filter((segment) => {
    const lower = segment.toLowerCase();
    const isStatewideBenchmark = lower.includes('statewide benchmark');
    const isFy2025 = lower.includes('fy 2025') || lower.includes('fy2025');
    return !(isStatewideBenchmark && isFy2025);
  }).join('\n');
}

function hasStaleIncomeLimitVintageNearLabel(src) {
  const lower = withoutStatewideBenchmarkDisclosure(src).toLowerCase();
  return ['fy2025', 'fy 2025'].some((needle) => {
    let fromIndex = 0;
    let index = lower.indexOf(needle, fromIndex);
    while (index !== -1) {
      const nearby = lower.slice(Math.max(0, index - 60), Math.min(lower.length, index + 60));
      if (nearby.includes('income limits') || nearby.includes('mtsp')) return true;
      fromIndex = index + needle.length;
      index = lower.indexOf(needle, fromIndex);
    }
    return false;
  });
}

[
  ['housing-needs-assessment.html', hnaHtml],
  ['colorado-deep-dive.html', coloradoDeepDive],
  ['developer-brief.html', developerBrief],
  ['js/hna/hna-export.js', hnaExport],
].forEach(([relPath, src]) => {
  assert(
    !hasStaleIncomeLimitVintageNearLabel(src),
    `${relPath}: FY2025 must not appear within 60 characters of Income Limits or MTSP`
  );
});
assertIncludes(hnaHtml, `HUD MTSP ${IL_FY} county Income Limits`, 'HNA MTSP income-limit label uses the data Income Limits year');
assertIncludes(hnaHtml, `HUD MTSP ${IL_FY}`, 'HNA MTSP data-vintage uses the data Income Limits year');
assertIncludes(developerBrief, `HUD MTSP ${IL_FY} county Income Limits`, 'developer brief MTSP label uses the data Income Limits year');
assertIncludes(hnaExport, `HUD MTSP ${IL_FY} county Income Limits`, 'HNA export MTSP label uses the data Income Limits year');

const lof = read('lihtc-opportunity-finder.html');
const lofJs = read('js/lihtc-opportunity-finder.js');
assertIncludes(lof, `HUD QCT ${QCT_YEAR}`, 'LIHTC Opportunity Finder QCT vintage');
assertIncludes(lof, `HUD DDA ${DDA_YEAR}`, 'LIHTC Opportunity Finder DDA vintage');
assertExcludes(lof, 'HUD QCT 2025', 'LIHTC Opportunity Finder stale QCT vintage');
assertExcludes(lof, 'HUD DDA 2025', 'LIHTC Opportunity Finder stale DDA vintage');
assertIncludes(lof, 'datasets/qct.html', 'LIHTC Opportunity Finder consolidated QCT/DDA source link');
assertExcludes(lof, 'datasets/dda.html', 'LIHTC Opportunity Finder retired DDA source link');
// Compare rendered amounts and source vintages with the files, without
// pinning the retired HUD-income formula or the surrounding label wording.
const { JSDOM } = require('jsdom');
const vm = require('node:vm');
const chfa = JSON.parse(read('data/chfa-income-rent-limits-2026.json'));
const hud = JSON.parse(read('data/hud-fmr-income-limits.json'));
const limits = require('../js/chfa-rent-limits.js');
const doc = new JSDOM(lof).window;
const captureHeading = doc.document.querySelector('th[data-sort="captureAdvantage"]').title;
assert(captureHeading.includes('FMR (FY' + hud.meta.fiscal_year + ')'), 'capture heading agrees with the HUD file vintage');
assert(captureHeading.includes('CHFA ' + chfa.meta.fiscal_year), 'capture heading agrees with the CHFA file vintage');
assert(/CHFA.*60%.*2BR.*gross/.test(captureHeading), 'heading identifies the published CHFA gross limit');
assert(!/from HUD income limits/i.test(captureHeading), 'heading does not claim a HUD-income rent calculation');
const context = { window: { ChfaRentLimits: limits }, document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } } };
vm.runInNewContext(lofJs, context);
const finder = context.window.__LOF._test;
for (const fips of ['08031', '08077']) {
  // The oracle is the published table, not the module's lookup or metadata adapter.
  const expected = chfa.counties.find((c) => c.fips === fips).regular_tiers['60'].max_rents['2br'];
  assert(Number.isFinite(expected), 'non-vacuous published limit');
  const hudCounty = hud.counties.find((c) => c.fips === fips);
  const record = finder.marketForCounty(chfa, fips, hudCounty, hud.meta);
  const rendered = doc.document.createElement('div');
  rendered.innerHTML = finder.captureCell({ market: record });
  const capture = rendered.querySelector('span').title;
  assert(capture.includes('$' + expected.toLocaleString()), 'runtime label names the published CHFA amount');
  assert(capture.includes('CHFA ' + chfa.meta.fiscal_year), 'runtime label names the CHFA table year');
  assert(capture.includes('HUD FMR FY' + hud.meta.fiscal_year), 'capture tooltip agrees with the HUD file vintage');
  rendered.innerHTML = finder.marketCaptureFacts(record);
  assert(rendered.textContent.includes('$' + expected.toLocaleString()), 'detail label names the published CHFA amount');
  assert(rendered.textContent.includes('CHFA ' + chfa.meta.fiscal_year), 'detail label names the CHFA table year');
  assert(rendered.textContent.includes(chfa.meta.effective_date), 'detail label names the table effective date');
  assert(rendered.textContent.includes('HUD FMR FY' + hud.meta.fiscal_year), 'detail FMR source uses the same HUD vintage');
  // A changed metadata year must change the rendered year; a current literal is insufficient.
  const changedMeta = { ...hud.meta, fiscal_year: hud.meta.fiscal_year + 1 };
  const changed = finder.marketForCounty(chfa, fips, hudCounty, changedMeta);
  rendered.innerHTML = finder.captureCell({ market: changed });
  assert(rendered.querySelector('span').title.includes('HUD FMR FY' + changedMeta.fiscal_year), 'tooltip reads the supplied HUD metadata');
  const undated = finder.marketForCounty(chfa, fips, hudCounty, null);
  rendered.innerHTML = finder.captureCell({ market: undated });
  assert(!/HUD FMR FY\d/.test(rendered.querySelector('span').title), 'missing metadata never invents a fiscal year');
}
doc.close();

const market = read('market-analysis.html');
const marketJs = read('js/market-analysis.js');
// The tract-metric labels must name the vintage in the data file.
const tractVintage = JSON.parse(read('data/market/acs_tract_metrics_co.json')).meta.vintage;
const staleTractYear = String(Number(tractVintage) - 1);
assertExcludes(market, 'ACSDP5Y' + staleTractYear, `Market Analysis ACS tract-metric links use ${tractVintage} table URLs`);
assertIncludes(
  market,
  `{ name: 'Census ACS Tract Metrics', status: 'primary', vintage: '${tractVintage}'`,
  'Market Analysis ACS Tract Metrics inventory vintage'
);
assertIncludes(marketJs, `HUD FMR ${FMR_FY}`, 'Market Analysis export FMR vintage');
assertExcludes(marketJs, staleHudFmrVintage, 'Market Analysis export stale FMR vintage');

const inventory = read('js/data-source-inventory.js');
assertIncludes(
  inventory,
  `HUD Fair Market Rents by bedroom size for all 64 Colorado counties (${FMR_FY}). Combined with income limits.`,
  'Data source inventory FMR entry vintage'
);

console.log('cross-surface-vintage-labels: PASS');
