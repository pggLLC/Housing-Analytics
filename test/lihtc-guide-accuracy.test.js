const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(read(relPath));
}

function formatMillions(value) {
  assert.equal(value % 1_000_000, 0, 'allocation authority is expressed in whole millions');
  return `$${value / 1_000_000}M`;
}

const guide = read('lihtc-guide-for-stakeholders.html');

assert(guide.includes('HB 24-1434'), 'guide names HB 24-1434 for the Colorado state LIHTC');
assert(guide.includes('https://leg.colorado.gov/bills/hb24-1434'), 'guide links to HB24-1434');
assert(!guide.includes('HB 24-1007'), 'guide does not name HB 24-1007 for the Colorado state LIHTC');
assert(!guide.includes('hb24-1007'), 'guide does not link to HB24-1007');

assert(!guide.includes('newly enacted for 2025'), 'guide does not imply Colorado AHTC was newly enacted for 2025');
assert(!guide.includes('Colorado enacted a state LIHTC effective for 2025'), 'guide describes acceleration/expansion, not creation');

assert(!guide.includes('$10M of state credits annually'), 'guide does not retain the stale $10M annual cap');
assert(guide.includes('Annual authority:'), 'guide labels the state credit figure as annual authority');
assert(guide.includes('set by HB 24-1434'), 'annual-authority line references HB 24-1434');

const equityFactors = readJson('data/market/colorado-equity-pricing-factors.json');
const authorityByYear = equityFactors.factors.state_affordable_housing_tax_credit.allocation_authority_by_year;
const expected2026Authority = formatMillions(authorityByYear['2026']);
const annualAuthorityLine = guide.match(/<li><strong>Annual authority:<\/strong>[^<]+<\/li>/);
assert(annualAuthorityLine, 'guide has an annual-authority list item');
assert(
  annualAuthorityLine[0].includes(expected2026Authority),
  `annual-authority line contains repo 2026 authority (${expected2026Authority})`,
);

assert(!guide.includes('$2.75 per capita'), 'guide no longer contains stale federal $2.75 per-capita figure');
assert(guide.includes('IRS §42 per-capita multiplier plus a small-state minimum'), 'guide uses durable federal allocation language');

console.log(`lihtc-guide-accuracy: PASS (${expected2026Authority} 2026 Colorado AHTC authority)`);
