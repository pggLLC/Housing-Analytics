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
// Reword freely. A rewording that drops the tier relationship the data has,
// names a tier the data does not carry, or misstates what counts as an
// available home, fails.
const AA_FILE = 'data/hna/chas_affordable_available.json';
const aaData = JSON.parse(fs.readFileSync(path.join(ROOT, AA_FILE), 'utf8'));
assert(indexJs.includes("DS.baseData('hna/chas_affordable_available.json')"),
  'js/index.js renders the shortfall cards from data/hna/chas_affordable_available.json');
// Located by the value each card renders, not by its wording.
function cardFor(valueId) {
  const at = index.indexOf(`id="${valueId}"`);
  assert.notEqual(at, -1, `index.html renders #${valueId}`);
  const start = index.lastIndexOf('<div class="home-snapshot__item"', at);
  return index.slice(start, index.indexOf('</div>', at));
}
const GAP_TIERS = ['30', '50'];
const gapCards = {};
for (const tier of GAP_TIERS) {
  const doc = new JSDOM(cardFor(`snapGap${tier}`)).window.document;
  gapCards[tier] = {
    html: cardFor(`snapGap${tier}`),
    key: doc.querySelector('.home-snapshot__key').textContent,
    note: doc.querySelector('.home-snapshot__note').textContent.trim(),
  };
}
assert.notEqual(gapCards['30'].note, gapCards['50'].note, 'the two cumulative AMI cards must not carry identical sublabels');
for (const tier of GAP_TIERS) {
  const card = gapCards[tier];
  assert(card.html.includes(`href="${AA_FILE}"`), `≤${tier}% card links the file js/index.js renders its figure from`);
  // The tier in the heading is a tier the data carries, and it is this card's tier.
  const named = /≤(\d+)%/.exec(card.key);
  assert(named && named[1] === tier && aaData.statewide.tiers[named[1]],
    `≤${tier}% card's heading names the data tier it renders`);
  // Homes, not people (#2220 follow-up: the numbers were read as people).
  assert(/homes/i.test(card.key), `≤${tier}% card's heading names homes, the unit of the number`);
  // The value the card renders for each figure exists in the note.
  for (const id of ['Households', 'Homes', 'Per100']) {
    assert(card.html.includes(`id="snapGap${tier}${id}"`), `≤${tier}% card shows the ${id} figure behind its shortfall`);
  }
}
// What counts as available is the method in the data: vacant for rent, or
// rented by a household inside the group. The ≤30% card states it.
assert(/vacant for rent/.test(aaData.meta.method) && /rented by a household at or below the tier/.test(aaData.meta.method),
  'fixture: the data counts vacant homes and homes rented within the group');
assert(/vacant/i.test(gapCards['30'].note) && /rented by someone in that group|rented within the group/i.test(gapCards['30'].note),
  '≤30% card says which homes count: vacant, or rented within the group');
assert(/higher-income/i.test(gapCards['30'].note),
  '≤30% card says cheap homes rented by higher-income households do not count');
// Tiers are cumulative in the data, so the ≤50% card must say it includes ≤30%.
const t = aaData.statewide.tiers;
assert(t['50'].renter_households >= t['30'].renter_households, 'fixture: ≤50% contains ≤30% households');
assert(/≤30%/.test(gapCards['50'].note) && /includ/i.test(gapCards['50'].note),
  '≤50% card states that it includes the ≤30% households (the data tiers are cumulative)');
// "No 60% figure" is true only while the data has no 60% tier.
assert.equal(/no 60% figure/i.test(gapCards['50'].note), !('60' in t),
  '≤50% card says there is no 60% figure exactly when the data has no 60% tier');
// Income limits: the data measures each household against its own area's
// median, not one statewide figure; the card must not claim otherwise.
assert(/for each area/.test(aaData.meta.income_basis), 'fixture: income basis is per area');
assert(/each county/i.test(gapCards['50'].note) && !/statewide AMI/i.test(gapCards['50'].note),
  '≤50% card says income limits are set for each county');
// The data's own arithmetic. Per county: available = occupied within the
// group + vacant, and homes short never falls as the tier widens (homes
// renting above what the lower group can pay do not close its shortfall).
// Statewide: the sum of the county shortfalls.
const tierOrder = Object.keys(aaData.statewide.tiers).sort((a, b) => a - b);
const countyShort = Object.fromEntries(tierOrder.map((k) => [k, 0]));
for (const [name, rec] of Object.entries(aaData.counties)) {
  let worst = 0;
  for (const tier of tierOrder) {
    const r = rec.tiers[tier];
    assert.equal(r.affordable_available_homes, r.occupied_by_group + r.vacant_for_rent, `${name} ≤${tier}%: available = occupied within group + vacant`);
    worst = Math.max(worst, r.renter_households - r.affordable_available_homes);
    assert.equal(r.homes_short, worst, `${name} ≤${tier}%: homes short is the largest gap at this tier or any inside it`);
    countyShort[tier] += worst;
  }
}
for (const tier of tierOrder) {
  assert.equal(aaData.statewide.tiers[tier].homes_short, countyShort[tier], `statewide ≤${tier}% homes short is the county sum`);
}
// When the headline is not simply households minus homes, the card says why.
for (const tier of GAP_TIERS) {
  const r = aaData.statewide.tiers[tier];
  assert.equal(/county by county/i.test(gapCards[tier].note), r.homes_short !== r.renter_households - r.affordable_available_homes,
    `≤${tier}% card explains the county-by-county count exactly when its headline differs from households − homes`);
}
assert.equal(/never fewer homes short than at ≤30%/i.test(gapCards['50'].note),
  Object.values(aaData.counties).some((c) => c.tiers['50'].renter_households - c.tiers['50'].affordable_available_homes < c.tiers['30'].homes_short),
  '≤50% card says it carries the ≤30% shortfall forward exactly when some county needs it');
// The vintage the cards show is the data's.
for (const tier of GAP_TIERS) {
  assert(gapCards[tier].html.includes(`id="snapGapVintage${tier}"`), `≤${tier}% card shows the data vintage`);
}

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

  window.DataService = {
    baseData: (value) => value,
    getJSON: (value) => value === 'hna/chas_affordable_available.json'
      ? Promise.resolve(aaData)
      : Promise.reject(new Error('not used by this fixture')),
  };

  const indexModule = path.join(ROOT, 'js', 'index.js');
  delete require.cache[require.resolve(indexModule)];
  require(indexModule);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Every figure is the statewide record in the data file, pinned to the
  // data rather than to a number, so a new CHAS vintage needs no test edit.
  const text = (id) => document.getElementById(id).textContent;
  for (const tier of GAP_TIERS) {
    const r = aaData.statewide.tiers[tier];
    assert.equal(text(`snapGap${tier}`), r.homes_short.toLocaleString('en-US'), `≤${tier}% headline renders the statewide homes short`);
    assert.equal(text(`snapGap${tier}Households`), r.renter_households.toLocaleString('en-US'), `≤${tier}% note renders the statewide households`);
    assert.equal(text(`snapGap${tier}Homes`), r.affordable_available_homes.toLocaleString('en-US'), `≤${tier}% note renders the statewide available homes`);
    assert.equal(text(`snapGap${tier}Per100`), String(Math.round(100 * r.affordable_available_homes / r.renter_households)),
      `≤${tier}% note renders homes per 100 households from the data's own counts`);
    assert.equal(text(`snapGapVintage${tier}`), aaData.meta.vintage, `≤${tier}% note renders the data vintage`);
  }
}

assertRenderedGapFigures()
  .then(() => console.log('homepage-claims: PASS'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
