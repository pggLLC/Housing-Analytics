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
const staleHudFmrVintageSpaced = 'HUD FMR FY 20' + '25';
assertExcludes(hudFmr, staleFmrTableHeader, 'HUD FMR connector stale table header');
assertExcludes(hudFmr, staleHudFmrVintageSpaced, 'HUD FMR connector stale spaced vintage');

const hnaExport = read('js/hna/hna-export.js');
assertIncludes(hnaExport, 'HUD FMR FY2026', 'HNA export FMR vintage');
assertExcludes(hnaExport, staleHudFmrVintage, 'HNA export stale FMR vintage');
assertExcludes(hnaExport, staleHudFmrVintageSpaced, 'HNA export stale spaced FMR vintage');

const developerBrief = read('developer-brief.html');
assertIncludes(developerBrief, 'HUD FMR FY2026', 'developer brief FMR source link');
assertExcludes(developerBrief, staleHudFmrVintage, 'developer brief stale FMR link');
assertExcludes(developerBrief, staleHudFmrVintageSpaced, 'developer brief stale spaced FMR link');
assertExcludes(developerBrief, "HUD FMR FY25'", 'developer brief stale FY25 source label');

const dealCalculator = read('js/deal-calculator.js');
assertIncludes(dealCalculator, 'HUD FMR FY2026', 'Deal Calculator FMR source link');
assertExcludes(dealCalculator, staleHudFmrVintage, 'Deal Calculator stale FMR source link');
assertExcludes(dealCalculator, staleHudFmrVintageSpaced, 'Deal Calculator stale spaced FMR source link');

const amiGap = read('js/co-ami-gap.js');
const staleCountyIncomeLimits = 'FY 20' + '25 Income Limits';
assertIncludes(amiGap, 'FY 2026 county Income Limits', 'AMI-gap county tooltip uses the current Income Limits vintage');
assertExcludes(amiGap, staleCountyIncomeLimits, 'AMI-gap has no stale FY2025 county Income Limits label');
assertIncludes(amiGap, 'statewide benchmark remains FY 2025', 'AMI-gap preserves the separate FY2025 statewide disclosure');

['housing-needs-assessment.html', 'deal-calculator.html', 'market-analysis.html'].forEach((relPath) => {
  const src = read(relPath);
  assertIncludes(src, 'FMR FY2026 · IL FY2026', `${relPath} current FMR/IL data-quality vintage`);
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
assertIncludes(hnaHtml, 'HUD MTSP FY2026 county Income Limits', 'HNA MTSP income-limit label uses FY2026 county data');
assertIncludes(hnaHtml, 'HUD MTSP FY2026', 'HNA MTSP data-vintage uses FY2026');
assertIncludes(developerBrief, 'HUD MTSP FY2026 county Income Limits', 'developer brief MTSP label uses FY2026 county data');
assertIncludes(hnaExport, 'HUD MTSP FY2026 county Income Limits', 'HNA export MTSP label uses FY2026 county data');

const lof = read('lihtc-opportunity-finder.html');
const lofJs = read('js/lihtc-opportunity-finder.js');
assertIncludes(lof, 'HUD QCT 2026', 'LIHTC Opportunity Finder QCT vintage');
assertIncludes(lof, 'HUD DDA 2026', 'LIHTC Opportunity Finder DDA vintage');
assertExcludes(lof, 'HUD QCT 2025', 'LIHTC Opportunity Finder stale QCT vintage');
assertExcludes(lof, 'HUD DDA 2025', 'LIHTC Opportunity Finder stale DDA vintage');
assertIncludes(lof, 'datasets/qct.html', 'LIHTC Opportunity Finder consolidated QCT/DDA source link');
assertExcludes(lof, 'datasets/dda.html', 'LIHTC Opportunity Finder retired DDA source link');
assertIncludes(
  lof,
  '2BR FMR (FY2026) minus LIHTC 60% AMI 2BR max rent (from HUD income limits FY2026)',
  'LIHTC Opportunity Finder capture label splits FMR and income-limit vintages'
);
assertIncludes(lofJs, 'HUD FMR FY2026 + IL FY2026', 'LIHTC Opportunity Finder runtime capture comment uses current vintages');
assertIncludes(lofJs, 'HUD FMR FY2026 + Income Limits FY2026', 'LIHTC Opportunity Finder runtime capture label uses current vintages');

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
