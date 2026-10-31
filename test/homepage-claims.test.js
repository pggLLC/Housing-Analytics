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

// The need-score explainer names both halves of overall_need_score with the
// shares the ranking builder uses (AXIS_WEIGHTS), not the need half alone.
{
  const builder = fs.readFileSync(path.join(ROOT, 'scripts', 'hna', 'build_ranking_index.py'), 'utf8');
  const axis = builder.match(/AXIS_WEIGHTS = \{\s*"community_need": ([0-9.]+),\s*"opportunity": ([0-9.]+),/);
  assert(axis, 'AXIS_WEIGHTS not found in scripts/hna/build_ranking_index.py');
  const needPct = Math.round(Number(axis[1]) * 100);
  const oppPct = Math.round(Number(axis[2]) * 100);
  const m = index.match(/home-opening__map-explainer" data-measure-text="need">([\s\S]*?)<\/span>/);
  assert(m, 'index.html must keep the need-score explainer');
  const text = m[1].replace(/\s+/g, ' ');
  assert(text.includes(`(${needPct}%) is need`), `need-score explainer must give the need share as ${needPct}%`);
  assert(text.includes(`(${oppPct}%) is opportunity`), `need-score explainer must give the opportunity share as ${oppPct}%`);
}

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
// The data's own arithmetic, for every county and the state: available =
// occupied within the group + vacant; HUD's shortfall = households − homes,
// floored at 0; the nested figure never falls as the tier widens.
const tierOrder = Object.keys(aaData.statewide.tiers).sort((a, b) => a - b);
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
// The cards show HUD's shortfall, which a reader can check against the two
// counts beside it. If the wider card ever showed fewer homes short than the
// narrower one, the nested rule would be needed here too: fail until then.
const st = aaData.statewide.tiers;
assert(st['50'].homes_short >= st['30'].homes_short,
  'statewide ≤50% shortfall is at least the ≤30% one; if not, the homepage needs the nested figure and a note saying so');
// The vintage the cards show is the data's.
for (const tier of GAP_TIERS) {
  assert(gapCards[tier].html.includes(`id="snapGapVintage${tier}"`), `≤${tier}% card shows the data vintage`);
}

// Under HUD's count, each card keeps the ACS 2024 minimum (paul,
// 2026-10-15: show both, HUD's figure on top). Pinned to
// data/co_ami_gap_by_county.json, which js/index.js renders it from.
const amiGapData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'co_ami_gap_by_county.json'), 'utf8'));
assert(indexJs.includes("DS.baseData('co_ami_gap_by_county.json')"), 'js/index.js renders the 2024 minimum from data/co_ami_gap_by_county.json');
const minNote = {};
for (const [tier, minTier] of [['30', '30'], ['50', '60']]) {
  const notes = new JSDOM(gapCards[tier].html).window.document.querySelectorAll('.home-snapshot__note');
  assert.equal(notes.length, 2, `≤${tier}% card shows HUD's count and the 2024 minimum`);
  minNote[minTier] = { html: notes[1].innerHTML, text: notes[1].textContent.trim() };
  assert(minNote[minTier].html.includes('href="data/co_ami_gap_by_county.json"'), `2024 ≤${minTier}% note links its file`);
  assert(minNote[minTier].html.includes(`id="snapMin${minTier}"`) && minNote[minTier].html.includes(`id="snapMinYear${minTier}"`),
    `2024 ≤${minTier}% note shows its figure and the ACS year from the data`);
  const named = [...minNote[minTier].text.matchAll(/≤(\d+)% AMI/g)].map((m) => m[1]).filter((n) => n !== '30');
  assert(named.every((n) => n === minTier) && amiGapData.statewide.min_shortfall_matched_le_ami_pct[minTier] != null,
    `2024 ≤${minTier}% note names the tier it renders, which the data carries`);
}
assert.equal(amiGapData.statewide.demand_tenure, 'renter', 'fixture: the gap demand side is renter households');
assert(/renter households/i.test(minNote['30'].text) && /afford/i.test(minNote['30'].text), '2024 ≤30% note states its basis');
assert.equal(/no cash rent/i.test(minNote['30'].text), amiGapData.statewide.renter_units_no_cash_rent > 0,
  '2024 ≤30% note names the no-cash-rent homes the figure subtracts');
// Why it differs from HUD's: one statewide limit (the data's own figure) against HUD's per-area limits.
const amiShown = /AMI[^$]{0,40}\$([\d,]+)/.exec(minNote['30'].text);
assert(amiShown && Number(amiShown[1].replace(/,/g, '')) === amiGapData.statewide.ami_4person && /4-person/.test(minNote['30'].text),
  'the statewide AMI on the homepage equals statewide.ami_4person for the 4-person household the data uses');
assert(/for each area/.test(aaData.meta.income_basis) && /each county/i.test(minNote['30'].text),
  '2024 ≤30% note says HUD uses each county\'s limits, as the HUD data does');
assert(/higher-income/i.test(minNote['30'].text), '2024 ≤30% note says it counts homes higher-income households rent');
assert(/includ/i.test(minNote['60'].text) && /≤30%/.test(minNote['60'].text), '2024 ≤60% note says it includes the ≤30% households');
assert(/at least|minimum/i.test(minNote['60'].text) && /occupied/i.test(minNote['60'].text) && /vacant|available/i.test(minNote['60'].text),
  '2024 ≤60% note says it is a minimum and carries the occupancy caveat');
for (const rec of [amiGapData.statewide, ...amiGapData.counties]) {
  const m = rec.min_shortfall_matched_le_ami_pct;
  assert(m && m['60'] >= m['30'] && m['30'] >= 0, `${rec.county_name}: ≤60% minimum is at least the ≤30% one and never negative`);
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
    getJSON: (value) => value === 'hna/chas_affordable_available.json' ? Promise.resolve(aaData)
      : value === 'co_ami_gap_by_county.json' ? Promise.resolve(amiGapData)
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
    assert.equal(r.homes_short, r.renter_households - r.affordable_available_homes, `≤${tier}% headline equals the households minus the homes shown beside it`);
    assert.equal(text(`snapGap${tier}Households`), r.renter_households.toLocaleString('en-US'), `≤${tier}% note renders the statewide households`);
    assert.equal(text(`snapGap${tier}Homes`), r.affordable_available_homes.toLocaleString('en-US'), `≤${tier}% note renders the statewide available homes`);
    assert.equal(text(`snapGap${tier}Per100`), String(Math.round(100 * r.affordable_available_homes / r.renter_households)),
      `≤${tier}% note renders homes per 100 households from the data's own counts`);
    assert.equal(text(`snapGapVintage${tier}`), aaData.meta.vintage, `≤${tier}% note renders the data vintage`);
  }
  for (const tier of ['30', '60']) {
    assert.equal(text(`snapMin${tier}`), amiGapData.statewide.min_shortfall_matched_le_ami_pct[tier].toLocaleString('en-US'), `2024 ≤${tier}% renders the data's statewide minimum`);
    assert.equal(text(`snapMinYear${tier}`), String(amiGapData.meta.acs_year), `2024 ≤${tier}% renders the data's ACS year`);
  }
}

// The homepage's opening names the audience AGENTS.md's persona pass
// defines (owner decision 2026-10-15): practitioners in finance, planning,
// development and local government come first, learners are welcomed after.
// Agreement, not wording: the persona's own fields are read from AGENTS.md.
{
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8').replace(/\s+/g, ' ');
  const persona = agents.match(/someone who works in housing (.+?) and knows the field/);
  assert(persona, 'AGENTS.md defines the practitioner persona');
  const fields = persona[1].replace(/,? or /, ', ').split(/,\s*/).map((f) => f.trim().split(' ')[0]).filter(Boolean);
  assert(fields.length >= 4, `persona fields read from AGENTS.md (${fields.join(', ')})`);
  const stems = { finance: /financ/i, planning: /plan/i, development: /develop/i, local: /govern/i };
  const lead = new JSDOM(index).window.document.querySelector('.home-opening__lead').textContent.replace(/\s+/g, ' ');
  const learnerAt = lead.search(/learn|new to (the field|housing)|student/i);
  assert(learnerAt > 0, 'the opening welcomes people learning the field');
  for (const f of fields) {
    const re = stems[f] || new RegExp(f.slice(0, 5), 'i');
    const at = lead.search(re);
    assert(at >= 0 && at < learnerAt, `the opening names "${f}" before it welcomes learners`);
  }
  assert(!/anyone can read/i.test(lead) || lead.search(/anyone can read/i) > learnerAt, 'the opening does not lead with a general-public audience');
}

assertRenderedGapFigures()
  .then(() => console.log('homepage-claims: PASS'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
