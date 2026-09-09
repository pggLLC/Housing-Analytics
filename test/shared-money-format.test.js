#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const money = require('../js/utils/format-money.js');

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
assert.deepEqual(styleCurrencyPaths.sort(), [
  'js/census-geo.js',
  'js/census-stats.js',
  'js/project-market-study/market-study-page.js',
  'js/project-market-study/market-study-report.js',
  'js/utils/format-money.js',
], 'repository currency-style grep stays pinned to the shared helper and pre-existing out-of-scope display engines');

for (const [html, consumer] of [
  ['market-analysis.html', 'js/market-analysis/market-analysis-utils.js'],
  ['pipeline.html', 'js/pipeline.js'],
  ['deal-calculator.html', 'js/data-connectors/hud-fmr.js'],
  ['housing-needs-assessment.html', 'js/hna/hna-utils.js'],
  ['census-dashboard.html', 'js/census-multifamily.js'],
  ['colorado-deep-dive.html', 'js/colorado-deep-dive.js'],
]) {
  const source = read(html);
  const helperIndex = source.indexOf('js/utils/format-money.js');
  const consumerIndex = source.indexOf(consumer);
  assert(helperIndex >= 0 && consumerIndex >= 0 && helperIndex < consumerIndex, `${html} loads the shared money helper before ${consumer}`);
}

console.log('shared-money-format: PASS');
