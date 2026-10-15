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
// Located by the value each card renders, not by its wording.
function cardFor(valueId) {
  const at = index.indexOf(`id="${valueId}"`);
  assert.notEqual(at, -1, `index.html renders #${valueId}`);
  const start = index.lastIndexOf('<div class="home-snapshot__item"', at);
  return index.slice(start, index.indexOf('</div>', at));
}
const gap30Card = cardFor('snapGap30');
const gap60Card = cardFor('snapGap60');
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
// The cards show the matched shortfall: a home counts only for households
// who can afford it, so the wider tier can never show fewer homes short
// than the tier inside it. The pooled gap broke that (146,721 at ≤30%,
// 15,577 at ≤60%) and read as fewer people in the wider group. Pin the
// invariant on the data, and on every county, not on a number.
const matched = amiGapData.statewide.min_shortfall_matched_le_ami_pct;
assert(matched, 'statewide carries min_shortfall_matched_le_ami_pct, which the cards render');
for (const rec of [amiGapData.statewide, ...amiGapData.counties]) {
  const m = rec.min_shortfall_matched_le_ami_pct;
  assert(m && m['60'] >= m['30'] && m['30'] >= 0,
    `${rec.county_name}: ≤60% shortfall is at least the ≤30% one and never negative`);
  assert.equal(m['30'], Math.max(0, -rec.gap_units_minus_households_le_ami_pct['30'] - rec.renter_units_no_cash_rent),
    `${rec.county_name}: at ≤30% nothing is pooled, so the matched shortfall is the pooled one less the homes rented for no cash rent`);
}
// The data subtracts homes rented for no cash rent; the ≤30% card must say
// so whenever there are any, or its basis line no longer matches the number.
assert.equal(/no cash rent/i.test(gap30Note), amiGapData.statewide.renter_units_no_cash_rent > 0,
  '≤30% card names the no-cash-rent homes the statewide figure subtracts');
// It is a floor (higher-income renters occupy some counted homes), so the
// ≤60% card must say so.
assert(/at least|minimum/i.test(gap60Note) && /higher-income/i.test(gap60Note),
  '≤60% card says the figure is a minimum because higher-income households rent some counted homes');
// Both cards count homes, not people (#2220 follow-up: read as people).
for (const [tier, card] of [['≤30%', gap30Card], ['≤60%', gap60Card]]) {
  const key = new JSDOM(card).window.document.querySelector('.home-snapshot__key').textContent;
  assert(/homes/i.test(key), `${tier} card's heading names homes, the unit of the number`);
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

// HUD's full count sits under each ACS figure (paul, 2026-10-15: "show
// both"). Pinned to data/hna/chas_affordable_available.json, which
// js/index.js renders it from: what counts as available, the tier each note
// names, the ≤30%-inside-≤50% relationship, and why the two figures differ.
const AA_FILE = 'data/hna/chas_affordable_available.json';
const aaData = JSON.parse(fs.readFileSync(path.join(ROOT, AA_FILE), 'utf8'));
assert(indexJs.includes("DS.baseData('hna/chas_affordable_available.json')"),
  'js/index.js renders the HUD count from ' + AA_FILE);
const hudNote = {};
for (const [tier, card] of [['30', gap30Card], ['50', gap60Card]]) {
  const doc = new JSDOM(card).window.document;
  const notes = doc.querySelectorAll('.home-snapshot__note');
  assert.equal(notes.length, 2, `the card holding HUD's ≤${tier}% count shows both figures`);
  const html = notes[1].innerHTML;
  hudNote[tier] = { html, text: notes[1].textContent.trim() };
  assert(html.includes(`href="${AA_FILE}"`), `HUD ≤${tier}% note links the file js/index.js renders it from`);
  for (const id of ['', 'Households', 'Homes', 'Per100']) {
    assert(html.includes(`id="snapAa${tier}${id}"`), `HUD ≤${tier}% note shows its ${id || 'shortfall'} figure`);
  }
  assert(html.includes(`id="snapAaVintage${tier}"`), `HUD ≤${tier}% note shows the data vintage`);
  // The tier the note names (if any) is the one it renders, and the data carries it.
  const named = [...hudNote[tier].text.matchAll(/≤(\d+)% AMI/g)].map((m) => m[1]);
  assert(named.every((n) => n === tier) && aaData.statewide.tiers[tier], `HUD ≤${tier}% note names only the tier it renders`);
}
// Which homes count: the method in the data, stated on the ≤30% note.
assert(/vacant for rent/.test(aaData.meta.method) && /rented by a household at or below the tier/.test(aaData.meta.method),
  'fixture: the data counts vacant homes and homes rented within the group');
assert(/vacant/i.test(hudNote['30'].text) && /rented (by someone )?(in|within) (that|the) group/i.test(hudNote['30'].text) && /higher-income/i.test(hudNote['30'].text),
  'HUD ≤30% note says which homes count: vacant or rented within the group, not by higher-income households');
// Why the two differ, in terms both files carry: the ACS figure's year and
// one statewide limit; HUD's per-area limits.
assert(/for each area/.test(aaData.meta.income_basis), 'fixture: HUD income basis is per area');
const differ = hudNote['30'].text;
assert(differ.includes(`ACS ${amiGapData.meta.acs_year}`), 'the ≤30% note names the ACS year the figure above is built on');
assert(/statewide income limit/i.test(differ) && /each county/i.test(differ),
  'the ≤30% note says the ACS figure uses one statewide limit and HUD uses each county\'s');
// Tiers are cumulative in the data, so the ≤50% note says it includes ≤30%,
// and "no 60% figure" is true exactly while the data has no 60% tier.
const st = aaData.statewide.tiers;
assert(st['50'].renter_households >= st['30'].renter_households, 'fixture: ≤50% contains ≤30% households');
assert(/≤30%/.test(hudNote['50'].text) && /includ/i.test(hudNote['50'].text), 'HUD ≤50% note says it includes the ≤30% households');
assert.equal(/no 60% figure/i.test(hudNote['50'].text), !('60' in st), 'HUD ≤50% note says there is no 60% figure exactly when the data has none');
assert(/each county/i.test(hudNote['50'].text) && !/statewide AMI/i.test(hudNote['50'].text), 'HUD ≤50% note says its income limits are set for each county');
// The data's own arithmetic, for every county and the state.
const tierOrder = Object.keys(st).sort((a, b) => a - b);
for (const [name, rec] of [['statewide', aaData.statewide], ...Object.entries(aaData.counties)]) {
  let worst = 0;
  for (const tier of tierOrder) {
    const r = rec.tiers[tier];
    assert.equal(r.affordable_available_homes, r.occupied_by_group + r.vacant_for_rent, `${name} ≤${tier}%: available = occupied within group + vacant`);
    assert.equal(r.homes_short, Math.max(0, r.renter_households - r.affordable_available_homes), `${name} ≤${tier}%: HUD shortfall = households − homes`);
    worst = Math.max(worst, r.renter_households - r.affordable_available_homes);
    assert.equal(r.homes_short_nested, worst, `${name} ≤${tier}%: nested shortfall is the largest gap at this tier or any inside it`);
  }
}
// The homepage shows HUD's per-tier figure; if the wider tier ever showed
// fewer homes short, the nested figure and a note saying so would be needed.
assert(st['50'].homes_short >= st['30'].homes_short,
  'statewide ≤50% shortfall is at least the ≤30% one; if not, the homepage needs the nested figure and a note saying so');

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
    getJSON: (value) => value === 'co_ami_gap_by_county.json' ? Promise.resolve(amiGap)
      : value === 'hna/chas_affordable_available.json' ? Promise.resolve(aaData)
      : Promise.reject(new Error('not used by this fixture')),
  };

  const indexModule = path.join(ROOT, 'js', 'index.js');
  delete require.cache[require.resolve(indexModule)];
  require(indexModule);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The headline is the statewide matched shortfall in the data file.
  // Pinned to the data rather than to a number, so a rebuild of the AMI gap
  // (new ACS vintage, new HUD state median) does not need a test edit.
  const shown = (tier) => amiGap.statewide.min_shortfall_matched_le_ami_pct[tier].toLocaleString('en-US');
  assert.equal(document.getElementById('snapGap30').textContent, shown('30'), '≤30% headline renders the data file\'s statewide shortfall');
  assert.equal(document.getElementById('snapGap60').textContent, shown('60'), '≤60% headline renders the data file\'s statewide shortfall');

  // HUD's count under each, from the statewide record, pinned to the data
  // rather than a number so a new CHAS vintage needs no test edit.
  const text = (id) => document.getElementById(id).textContent;
  for (const tier of ['30', '50']) {
    const r = aaData.statewide.tiers[tier];
    assert.equal(text(`snapAa${tier}`), r.homes_short.toLocaleString('en-US'), `HUD ≤${tier}% renders the statewide homes short`);
    assert.equal(r.homes_short, r.renter_households - r.affordable_available_homes, `HUD ≤${tier}% equals the households minus the homes shown beside it`);
    assert.equal(text(`snapAa${tier}Households`), r.renter_households.toLocaleString('en-US'), `HUD ≤${tier}% renders the statewide households`);
    assert.equal(text(`snapAa${tier}Homes`), r.affordable_available_homes.toLocaleString('en-US'), `HUD ≤${tier}% renders the statewide available homes`);
    assert.equal(text(`snapAa${tier}Per100`), String(Math.round(100 * r.affordable_available_homes / r.renter_households)),
      `HUD ≤${tier}% renders homes per 100 households from the data's own counts`);
    assert.equal(text(`snapAaVintage${tier}`), aaData.meta.vintage, `HUD ≤${tier}% renders the data vintage`);
  }
}

assertRenderedGapFigures()
  .then(() => console.log('homepage-claims: PASS'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
