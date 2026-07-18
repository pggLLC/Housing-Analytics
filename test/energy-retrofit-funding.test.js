'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const softFunding = require(path.join(root, 'data', 'policy', 'soft-funding-status.json'));
const homeownership = require(path.join(root, 'data', 'policy', 'homeownership-programs.json'));
const legislation = require(path.join(root, 'data', 'policy', 'tax-credit-legislation.json'));

const ENERGY_PROGRAM_IDS = [
  'CEO-WAP',
  'CEO-IRA-HOME-ENERGY-REBATES',
  'CEO-SOLAR-FOR-ALL',
  'CEO-BUILDING-ELECTRIFICATION-GRANTS',
  'CEO-LBD-SHOWCASE'
];

const OWNER_PROGRAM_TO_CARD = {
  'CEO-WAP': 'colorado-wap-weatherization',
  'CEO-IRA-HOME-ENERGY-REBATES': 'colorado-home-energy-rebates-hear-homes',
  'CEO-SOLAR-FOR-ALL': 'colorado-solar-for-all-watch'
};

const WATCHLIST_IDS = [
  'ira-home-energy-rebates-colorado-watch',
  'ggrf-solar-for-all-colorado-watch'
];

const OFFICIAL_HOSTS = new Set([
  'www.energy.gov',
  'energy.gov',
  'www.epa.gov',
  'epa.gov',
  'federalfunds.colorado.gov',
  'www.colorado.gov',
  'colorado.gov',
  'cdphe.colorado.gov',
  'www.leg.colorado.gov',
  'leg.colorado.gov',
  'content.govdelivery.com'
]);

function assertIsoDate(value, label) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value || ''), `${label} is an ISO date`);
}

function assertOfficialUrl(value, label) {
  assert(/^https:\/\//.test(value || ''), `${label} uses https`);
  const host = new URL(value).hostname;
  assert(OFFICIAL_HOSTS.has(host), `${label} uses an official or official-distribution host: ${host}`);
}

console.log('\nEnergy retrofit funding coverage tests');
console.log('='.repeat(46));

assert.strictEqual(softFunding.lastUpdated, '2026-07-18', 'soft funding vintage records this verification pass');

const programs = softFunding.programs || {};
ENERGY_PROGRAM_IDS.forEach((id) => {
  const program = programs[id];
  assert(program, `energy-retrofit program present: ${id}`);
  assert(Array.isArray(program.useCases) && program.useCases.length > 0, `${id} is tagged by use case`);
  assert(program.useCases.every((useCase) => [
    'multifamily-retrofit',
    'multifamily-new-construction',
    'owner-occupied'
  ].includes(useCase)), `${id} has allowed use-case tags`);
  assertOfficialUrl(program.contactUrl, `${id} contactUrl`);
  assertIsoDate(program.last_verified, `${id} last_verified`);
  assertIsoDate(program.review_by, `${id} review_by`);
  assert(program.source_note && program.source_note.includes('verified 2026-07-18'), `${id} records verification evidence`);
});

[
  'CEO-IRA-HOME-ENERGY-REBATES',
  'CEO-SOLAR-FOR-ALL',
  'CEO-BUILDING-ELECTRIFICATION-GRANTS'
].forEach((id) => {
  const program = programs[id];
  assert(['VERIFY', 'rule-pending'].includes(program.status), `${id} remains VERIFY/rule-pending under volatility rule`);
  assert.strictEqual(program.available, null, `${id} does not invent available dollars`);
  assert.strictEqual(program.capacity, null, `${id} does not invent capacity`);
  assert(/VERIFY|volatile|rescission|Statutory/.test(program.warning || program.description), `${id} carries volatility/verification warning`);
});

assert.strictEqual(programs['CEO-SOLAR-FOR-ALL'].available, null, 'Solar for All watch item cannot be treated as available subsidy');
assert(programs['CEO-SOLAR-FOR-ALL'].relatedSourceUrls.some((url) => url === 'https://www.epa.gov/aboutepa/greenhouse-gas-reduction-fund'), 'Solar for All cites EPA GGRF status');

const homeCardIds = new Set((homeownership.programs || []).map((program) => program.id));
Object.entries(OWNER_PROGRAM_TO_CARD).forEach(([programId, cardId]) => {
  assert(programs[programId].useCases.includes('owner-occupied'), `${programId} is owner-occupied`);
  assert(homeCardIds.has(cardId), `${programId} has matching Help for Homebuyers card ${cardId}`);
});

const verifyCards = homeownership.programs.filter((program) => [
  'colorado-home-energy-rebates-hear-homes',
  'colorado-solar-for-all-watch'
].includes(program.id));
assert.strictEqual(verifyCards.length, 2, 'two volatile owner energy cards are present');
verifyCards.forEach((program) => {
  assert.strictEqual(program.status, 'VERIFY', `${program.id} renders as VERIFY`);
  assert.strictEqual(program.benefit_amount, null, `${program.id} does not invent a benefit amount`);
  assert(/^VERIFY/.test(program.what_its_worth), `${program.id} exposes VERIFY in benefit copy`);
});

const watchIds = new Set((legislation.entries || []).map((entry) => entry.id));
WATCHLIST_IDS.forEach((id) => {
  const entry = legislation.entries.find((candidate) => candidate.id === id);
  assert(watchIds.has(id), `volatile federal energy program has watchlist entry: ${id}`);
  assert.strictEqual(entry.scope, 'homebuyer', `${id} is scoped to homebuyer/owner context`);
  assert.strictEqual(entry.status, 'rule-pending', `${id} is not presented as enacted available funding`);
  assertOfficialUrl(entry.source_url, `${id} source_url`);
  assertIsoDate(entry.review_by, `${id} review_by`);
});

const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
assert(packageJson.includes('test:energy-retrofit-funding'), 'npm script exists');
assert(packageJson.includes('npm run test:energy-retrofit-funding'), 'test:ci includes energy-retrofit guard');

console.log('All Energy Retrofit Funding tests passed.');
