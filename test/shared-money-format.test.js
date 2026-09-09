#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const money = require('../js/utils/format-money.js');
const censusGeoSource = read('js/census-geo.js');

for (const [label, input, expected] of [
  ['null', null, '—'],
  ['undefined', undefined, '—'],
  ['empty string', '', '—'],
  ['zero', 0, '$0'],
  ['NaN', NaN, '—'],
  ['ACS not-available sentinel', -666666666, '—'],
  ['string ACS not-available sentinel', '-666666666.0', '—'],
]) {
  assert.equal(money.formatMoney(input), expected, `${label} follows the shared money-formatting contract`);
}

const censusFormatterBlock = censusGeoSource.match(
  /function formatNumber[^\n]+\n\s*function formatCurrency[^\n]+\n\s*function formatPct[^\n]+/,
);
assert(censusFormatterBlock, 'census-geo formatter block remains testable');
const censusFormatters = vm.runInNewContext(
  `${censusFormatterBlock[0]}; ({ formatNumber, formatCurrency, formatPct })`,
  { MoneyFormatter: money },
);
for (const [label, input, expected] of [
  ['null', null, '—'],
  ['empty string', '', '—'],
  ['zero', 0, '$0'],
  ['NaN', NaN, '—'],
  ['ACS not-available sentinel', -666666666, '—'],
  ['string ACS not-available sentinel', '-666666666.0', '—'],
]) {
  assert.equal(censusFormatters.formatCurrency(input), expected, `census-geo ${label} uses the shared money contract`);
}
assert.equal(censusFormatters.formatNumber(null), '—', 'census-geo number formatter does not coerce null to zero');
assert.equal(censusFormatters.formatNumber(-666666666), '—', 'census-geo number formatter rejects the ACS sentinel');
assert.equal(censusFormatters.formatNumber(0), '0', 'census-geo number formatter preserves a real zero');
assert.equal(censusFormatters.formatPct(''), '—', 'census-geo percent formatter does not coerce an empty string to zero');
assert.equal(censusFormatters.formatPct('-666666666.0'), '—', 'census-geo percent formatter rejects the string ACS sentinel');
assert.equal(censusFormatters.formatPct(0), '0.0%', 'census-geo percent formatter preserves a real zero');
assert(!censusGeoSource.includes('const val = Number(record[m.field])'), 'cached Census records reach the absence-aware formatter before numeric coercion');
assert(!censusGeoSource.includes('const val  = Number(record[m.key])'), 'live Census records reach the absence-aware formatter before numeric coercion');

global.window = global;
global.location = { search: '' };
delete require.cache[require.resolve('../js/hna/hna-utils.js')];
require('../js/hna/hna-utils.js');
assert.equal(global.HNAUtils.safeNum(-666666666), null, 'HNA safeNum rejects the numeric ACS sentinel');
assert.equal(global.HNAUtils.safeNum('-666666666.0'), null, 'HNA safeNum rejects the string ACS sentinel');
assert.equal(global.HNAUtils.safeNum(0), 0, 'HNA safeNum preserves a real zero');
assert.equal(global.HNAUtils.fmtMoney(0), '$0', 'HNA routes a real zero through the shared helper');

const targetFiles = [
  'js/index.js',
  'js/main.js',
  'js/market-analysis/market-analysis-utils.js',
  'js/pipeline.js',
  'js/data-connectors/hud-fmr.js',
  'js/hna/hna-utils.js',
  'js/census-multifamily.js',
  'js/components/funding-context-card.js',
  'js/colorado-deep-dive.js',
];
for (const relativePath of targetFiles) {
  const source = read(relativePath);
  assert(!/new Intl\.NumberFormat\([^)]*\{[\s\S]*?style:\s*['"]currency['"]/.test(source), `${relativePath} has no hand-rolled Intl currency formatter`);
}
const rawDollarConcatPaths = targetFiles.filter((relativePath) => /(['"])\$\1\s*\+/.test(read(relativePath)));
assert.deepEqual(
  rawDollarConcatPaths,
  ['js/components/funding-context-card.js'],
  'targeted files contain raw dollar concatenation only in the preserved compact funding-card variant',
);

assert(!/function\s+fmtCurrency\s*\(/.test(read('js/index.js')), 'unused homepage formatter is removed');
assert(!/function\s+formatCurrency\s*\(/.test(read('js/main.js')), 'dead main.js formatter is removed');
assert(!/formatCurrency\s*,/.test(read('js/main.js')), 'dead main.js formatter is not exported');
assert(read('js/market-analysis/market-analysis-utils.js').includes('moneyFormatter.formatMoney(n)'), 'market-analysis formatter delegates to the shared helper');
assert(read('js/data-connectors/hud-fmr.js').includes('moneyFormatter.formatMoney(n)'), 'HUD formatter delegates to the shared helper');
assert(read('js/hna/hna-utils.js').includes('return moneyFormatter.formatMoney(n)'), 'HNA formatter delegates to the shared helper');
assert(read('js/census-multifamily.js').includes('moneyFormatter.isAbsent(x) || Number(x) <= 0'), 'Census multifamily deliberately preserves its nonpositive-value omission rule');
assert(read('js/components/funding-context-card.js').includes('moneyFormatter.isAbsent(value) || +value <= 0'), 'funding cards use the shared absence check while retaining compact output and null omission');

const styleCurrencyPaths = [];
for (const relativePath of fs.readdirSync(path.join(ROOT, 'js'), { recursive: true })) {
  if (!relativePath.endsWith('.js')) continue;
  const normalized = path.join('js', relativePath).split(path.sep).join('/');
  if (/style\s*:\s*['"]currency['"]/.test(read(normalized))) styleCurrencyPaths.push(normalized);
}
const allowedBespokeCurrencyPaths = [
  'js/project-market-study/market-study-page.js',
  'js/project-market-study/market-study-report.js',
];
assert.equal(allowedBespokeCurrencyPaths.length, 2, 'exactly two deliberately guarded bespoke currency formatters remain allowlisted');
assert.deepEqual(styleCurrencyPaths.sort(), [
  ...allowedBespokeCurrencyPaths,
  'js/utils/format-money.js',
].sort(), 'repository currency-style grep stays pinned to the shared helper and two guarded market-study display engines');

for (const [html, consumer] of [
  ['market-analysis.html', 'js/market-analysis/market-analysis-utils.js'],
  ['pipeline.html', 'js/pipeline.js'],
  ['deal-calculator.html', 'js/data-connectors/hud-fmr.js'],
  ['housing-needs-assessment.html', 'js/hna/hna-utils.js'],
  ['census-dashboard.html', 'js/census-multifamily.js'],
  ['colorado-deep-dive.html', 'js/colorado-deep-dive.js'],
  ['economic-dashboard.html', 'js/census-geo.js'],
]) {
  const source = read(html);
  const helperIndex = source.indexOf('js/utils/format-money.js');
  const consumerIndex = source.indexOf(consumer);
  assert(helperIndex >= 0 && consumerIndex >= 0 && helperIndex < consumerIndex, `${html} loads the shared money helper before ${consumer}`);
}

console.log('shared-money-format: PASS');
