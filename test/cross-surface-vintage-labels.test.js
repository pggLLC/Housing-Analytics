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

console.log('\nCross-surface vintage label guards');
console.log('='.repeat(44));

const hudFmr = read('js/data-connectors/hud-fmr.js');
assertIncludes(hudFmr, 'FY2026 FMR / mo', 'HUD FMR connector table header');
const staleFmrTableHeader = 'FY20' + '25 FMR / mo';
const staleHudFmrVintage = 'HUD FMR FY20' + '25';
assertExcludes(hudFmr, staleFmrTableHeader, 'HUD FMR connector stale table header');

const hnaExport = read('js/hna/hna-export.js');
assertIncludes(hnaExport, 'HUD FMR FY2026', 'HNA export FMR vintage');
assertExcludes(hnaExport, staleHudFmrVintage, 'HNA export stale FMR vintage');

const developerBrief = read('developer-brief.html');
assertIncludes(developerBrief, 'HUD FMR FY2026', 'developer brief FMR source link');
assertExcludes(developerBrief, staleHudFmrVintage, 'developer brief stale FMR link');
assertExcludes(developerBrief, "HUD FMR FY25'", 'developer brief stale FY25 source label');

const dealCalculator = read('js/deal-calculator.js');
assertIncludes(dealCalculator, 'HUD FMR FY2026', 'Deal Calculator FMR source link');
assertExcludes(dealCalculator, staleHudFmrVintage, 'Deal Calculator stale FMR source link');

['housing-needs-assessment.html', 'deal-calculator.html', 'market-analysis.html'].forEach((relPath) => {
  const src = read(relPath);
  assertIncludes(src, 'FMR FY2026 · IL FY2025', `${relPath} split FMR/IL data-quality vintage`);
  assertExcludes(
    src,
    "{ name: 'HUD FMR / Income Limits', status: 'primary', vintage: 'FY2025'",
    `${relPath} stale combined FMR/IL data-quality vintage`
  );
});

const hnaHtml = read('housing-needs-assessment.html');
assertIncludes(hnaHtml, 'HUD MTSP Income Limits FY2025', 'HNA MTSP income-limit label remains FY2025');
assertIncludes(hnaHtml, 'HUD MTSP FY2025', 'HNA MTSP data-vintage remains FY2025');
assertIncludes(developerBrief, 'HUD MTSP Income Limits FY2025', 'developer brief MTSP income-limit label remains FY2025');
assertIncludes(hnaExport, 'HUD MTSP FY2025', 'HNA export MTSP label remains FY2025');

const lof = read('lihtc-opportunity-finder.html');
const lofJs = read('js/lihtc-opportunity-finder.js');
assertIncludes(lof, 'HUD QCT 2026', 'LIHTC Opportunity Finder QCT vintage');
assertIncludes(lof, 'HUD DDA 2026', 'LIHTC Opportunity Finder DDA vintage');
assertExcludes(lof, 'HUD QCT 2025', 'LIHTC Opportunity Finder stale QCT vintage');
assertExcludes(lof, 'HUD DDA 2025', 'LIHTC Opportunity Finder stale DDA vintage');
assertIncludes(lof, 'datasets/dda.html', 'LIHTC Opportunity Finder DDA source link');
assertIncludes(
  lof,
  '2BR FMR (FY2026) minus LIHTC 60% AMI 2BR max rent (from HUD income limits FY2025)',
  'LIHTC Opportunity Finder capture label splits FMR and income-limit vintages'
);
assertIncludes(lofJs, 'HUD FMR FY2026 + IL FY2025', 'LIHTC Opportunity Finder runtime capture comment splits vintages');
assertIncludes(lofJs, 'HUD FMR FY2026 + Income Limits FY2025', 'LIHTC Opportunity Finder runtime capture label splits vintages');

const market = read('market-analysis.html');
const marketJs = read('js/market-analysis.js');
assertExcludes(market, 'ACSDP5Y2024', 'Market Analysis ACS tract-metric links use 2023 table URLs');
assertIncludes(
  market,
  "{ name: 'Census ACS Tract Metrics', status: 'primary', vintage: '2023'",
  'Market Analysis ACS Tract Metrics inventory vintage'
);
assertIncludes(marketJs, 'HUD FMR FY2026', 'Market Analysis export FMR vintage');
assertExcludes(marketJs, staleHudFmrVintage, 'Market Analysis export stale FMR vintage');

const inventory = read('js/data-source-inventory.js');
assertIncludes(
  inventory,
  'HUD Fair Market Rents by bedroom size for all 64 Colorado counties (FY2026). Combined with income limits.',
  'Data source inventory FMR entry vintage'
);

console.log('cross-surface-vintage-labels: PASS');
