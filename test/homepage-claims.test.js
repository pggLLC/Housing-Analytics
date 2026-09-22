#!/usr/bin/env node
// test/homepage-claims.test.js
//
// Metric-trust Package D: homepage public-claim accuracy guard.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const indexJs = fs.readFileSync(path.join(ROOT, 'js', 'index.js'), 'utf8');

function htmlBlock(startNeedle, endNeedle) {
  const start = index.indexOf(startNeedle);
  assert.notEqual(start, -1, `index.html must include ${startNeedle}`);
  const end = index.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `index.html must include ${endNeedle} after ${startNeedle}`);
  return index.slice(start, end);
}

assert(!index.includes('Educational Guide'), 'homepage must not describe itself as an Educational Guide');

for (const banned of [
  'quarter-million',
  'quarter\u2011million',
  'quarter&#8209;million',
  '250,000'
]) {
  assert(!index.includes(banned), `homepage must not contain unsupported shortage claim: ${banned}`);
}

assert(index.includes('id="snapHouseholds"'), 'statewide household-count card must include #snapHouseholds');
assert(
  index.includes('CO Households (total)') && index.includes('data/hna/summary/08.json') && index.includes('ACS DP02_0001E'),
  'statewide household-count card must disclose the statewide ACS summary source'
);
assert(
  indexJs.includes("DS.baseData('hna/summary/08.json')") &&
  indexJs.includes('DP02_0001E') &&
  indexJs.includes("setText('snapHouseholds'"),
  'js/index.js must fetch statewide households from data/hna/summary/08.json acsProfile.DP02_0001E'
);

const lead = htmlBlock('<p class="home-opening__lead">', '</p>');
assert(
  lead.includes('roughly half of renters now spend more than 30%') &&
  /ACS B25070|HUD CHAS/.test(lead),
  'hero renter cost-burden sentence must carry an ACS/CHAS source reference'
);
// Owner-selected framing: statewide cost burden across BOTH tenures, not the
// supply-gap figure. Verified against data/hna/chas_affordability_gap.json
// (HUD CHAS 2018-2022): 363,912 renter + 329,976 owner = 693,888 burdened
// households, 30.5% of the 2,277,884-household CHAS universe. The percentage
// must come from CHAS's own denominator -- dividing by the ACS DP02_0001E
// household total (2,479,892) yields a wrong 28.0% and mixes vintages.
assert(
  lead.includes('694,000') &&
  /nearly 1 in 3/i.test(lead) &&
  lead.includes('data/hna/chas_affordability_gap.json'),
  'hero cost-burden claim must use the verified 694,000 / nearly-1-in-3 HUD CHAS framing'
);
assert(
  /HUD CHAS 2018/.test(lead),
  'hero cost-burden claim must disclose the CHAS 2018-2022 vintage inline'
);

// The two cumulative AMI cards. What is pinned below is what each card has
// to AGREE with — the data file js/index.js renders it from, and the other
// card — never the sentence used to say it (#1746: three copy edits on
// 2026-09-22 were each held by this block asserting the previous wording).
// Reword freely. A rewording that stops stating the basis, drops the
// ≤30%-inside-≤60% relationship the data has, shows an AMI figure the data
// does not carry, or loses the occupancy caveat, fails.
const amiGapData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'co_ami_gap_by_county.json'), 'utf8'));
const statewideGap = amiGapData.statewide.gap_units_minus_households_le_ami_pct;
const gap30Card = htmlBlock('<span class="home-snapshot__key">CO rental deficit ≤30% AMI', '</div>');
const gap60Card = htmlBlock('<span class="home-snapshot__key">CO rental deficit ≤60% AMI', '</div>');
const gap30Note = new JSDOM(gap30Card).window.document.querySelector('.home-snapshot__note').textContent.trim();
const gap60Note = new JSDOM(gap60Card).window.document.querySelector('.home-snapshot__note').textContent.trim();
assert.notEqual(gap30Note, gap60Note, 'the two cumulative AMI cards must not carry identical sublabels');
for (const [tier, card] of [['≤30%', gap30Card], ['≤60%', gap60Card]]) {
  assert(card.includes('data/co_ami_gap_by_county.json'),
    `${tier} card links the file js/index.js renders its figure from`);
}
// Basis: the figure is renter households against homes they can afford
// (statewide.demand_tenure is "renter"; gap = units − households). Each card
// must say so in those terms, in whatever sentence.
assert.equal(amiGapData.statewide.demand_tenure, 'renter', 'fixture: the gap demand side is renter households');
assert(/renter households/i.test(gap30Note) && /afford/i.test(gap30Note),
  '≤30% card states its basis: renter households against what they can afford');
// The tiers are cumulative in the data (≤60% contains ≤30%), so the ≤60%
// card must say it includes the ≤30% group — the reader otherwise adds them.
assert(/≤30%/.test(gap60Note) && /includ/i.test(gap60Note),
  '≤60% card states that it includes the ≤30% households (the data tiers are cumulative)');
// In the data the WIDER tier's deficit is the smaller number. That reads as
// a contradiction, so the card must acknowledge it and attribute it to the
// count of affordable homes, not to need falling. If the data ever flips,
// drop this requirement with it — that is why it is conditional.
if (-statewideGap['60'] < -statewideGap['30']) {
  assert(/smaller/i.test(gap60Note) && /need/i.test(gap60Note) && /homes|units/i.test(gap60Note),
    '≤60% deficit is smaller than ≤30% in the data, so the card must explain why (need vs counted homes)');
}
// The AMI figure shown must be the one the data was built on, for the
// household size the data names (ami_4person) — a copy edit cannot leave a
// stale number behind.
const amiShown = /AMI[^$]{0,40}\$([\d,]+)/.exec(gap60Note);
assert(amiShown, '≤60% card states the statewide AMI dollar basis');
assert.equal(Number(amiShown[1].replace(/,/g, '')), amiGapData.statewide.ami_4person,
  'the AMI figure on the homepage equals statewide.ami_4person in data/co_ami_gap_by_county.json');
assert(/4-person/.test(gap60Note), 'the AMI basis names the 4-person household the data uses');
// Occupancy caveat: the counted homes are occupied, not necessarily vacant or
// available — the claim, in any words.
assert(/occupied/i.test(gap60Note) && /vacant|available/i.test(gap60Note),
  '≤60% card carries the occupancy caveat (occupied; not necessarily vacant/available)');

const routes = htmlBlock('<nav class="home-job-routes"', '</nav>');
assert(
  routes.includes('Plan ownership') &&
  routes.includes('Screen affordable for-sale options') &&
  routes.includes('housing-needs-assessment.html#affordable-ownership-need-section') &&
  routes.includes('deal-calculator.html'),
  'Find Opportunity routing must include an affordable ownership path'
);

async function assertRenderedGapFigures() {
  const dom = new JSDOM(index, { url: 'http://127.0.0.1/index.html' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;

  const amiGap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'co_ami_gap_by_county.json'), 'utf8'));
  window.DataService = {
    baseData: (value) => value,
    getJSON: (value) => value === 'co_ami_gap_by_county.json'
      ? Promise.resolve(amiGap)
      : Promise.reject(new Error('not used by this fixture')),
  };

  const indexModule = path.join(ROOT, 'js', 'index.js');
  delete require.cache[require.resolve(indexModule)];
  require(indexModule);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(document.getElementById('snapGap30').textContent, '135,587', '≤30% headline renders unchanged');
  assert.equal(document.getElementById('snapGap60').textContent, '83,490', '≤60% headline renders unchanged');
}

assertRenderedGapFigures()
  .then(() => console.log('homepage-claims: PASS'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
