#!/usr/bin/env node
// test/homepage-claims.test.js
//
// Metric-trust Package D: homepage public-claim accuracy guard.
//
// 13 Nov 2026: Home was rebuilt (index.html draws hub/home.js, which reads the same data files the old
// js/index.js read). Every guard below keeps what it was for and reads the page as drawn, so a figure is held to
// the file it comes from and a sentence to the data it describes. Where the rebuilt page says something in a
// different place (the ≤50% count is a row under "More Colorado numbers", not a second card), the comment says so.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const home = require('./helpers/render-home');

const ROOT = path.resolve(__dirname, '..');
const json = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const n = (v) => Math.round(v).toLocaleString('en-US');

(async () => {
const index = await home.renderHome();
const text = home.text(index);
const hubHome = fs.readFileSync(path.join(ROOT, 'hub', 'home.js'), 'utf8');

assert(!text.includes('Educational Guide'), 'homepage must not describe itself as an Educational Guide');

// The need-score explainer names both halves of overall_need_score with the
// shares the ranking builder uses (AXIS_WEIGHTS), not the need half alone.
{
  const builder = fs.readFileSync(path.join(ROOT, 'scripts', 'hna', 'build_ranking_index.py'), 'utf8');
  const axis = builder.match(/AXIS_WEIGHTS = \{\s*"community_need": ([0-9.]+),\s*"opportunity": ([0-9.]+),/);
  assert(axis, 'AXIS_WEIGHTS not found in scripts/hna/build_ranking_index.py');
  const needPct = Math.round(Number(axis[1]) * 100);
  const oppPct = Math.round(Number(axis[2]) * 100);
  // The explainer is the map's own text for its "Priority score" measure (hub/county-need.js), shown when that
  // measure is picked; Home also carries a short version it shows if the map cannot load (hub/home.js).
  const mapSrc = fs.readFileSync(path.join(ROOT, 'hub', 'county-need.js'), 'utf8');
  const m = mapSrc.match(/\{ id: 'need', label: '([^']+)'[\s\S]*?what: '([^']+)'/);
  assert(m, 'the county map must keep the need-score explainer (measure "need" in hub/county-need.js)');
  assert(index.includes(m[1]), 'Home must offer the priority score as a map measure, by the name its explainer uses');
  assert(/need and opportunity/i.test(m[1]), 'the measure\'s name says the score is need and opportunity, not need alone');
  assert(m[2].includes(`(${needPct}%) is need`), `need-score explainer must give the need share as ${needPct}%`);
  assert(m[2].includes(`(${oppPct}%) is opportunity`), `need-score explainer must give the opportunity share as ${oppPct}%`);
  const short = hubHome.match(/The priority score is[^']*/);
  assert(short, 'hub/home.js must keep the short need-score explainer for when the map cannot load');
  assert(new RegExp(`\\b${needPct}% need\\b`).test(short[0]) && new RegExp(`\\b${oppPct}% opportunity\\b`).test(short[0]) && /not need alone/.test(short[0]),
    `the short need-score explainer must give the shares as ${needPct}% need and ${oppPct}% opportunity, and say it is not need alone`);
}

for (const banned of [
  'quarter-million',
  'quarter‑million',
  'quarter&#8209;million',
  '250,000'
]) {
  assert(!index.includes(banned) && !text.includes(banned), `homepage must not contain unsupported shortage claim: ${banned}`);
}

// One fact row under "More Colorado numbers": its figure, its label and its source line.
const facts = [...index.matchAll(/<li><span class="fact-value">([\s\S]*?)<\/span><span class="fact-label">([\s\S]*?)<\/span><span class="fact-source">([\s\S]*?)<\/span><\/li>/g)]
  .map((m) => ({ value: home.text(m[1]), label: home.text(m[2]), source: home.text(m[3]), html: m[0] }));
assert(facts.length >= 4, `only ${facts.length} fact rows parsed from Home`);
const fact = (re, what) => { const f = facts.find((x) => re.test(x.label)); assert(f, `Home must keep the ${what} row`); return f; };

// Statewide households: the ACS profile figure in data/hna/summary/08.json, with its table named.
{
  const households = Number(json('data/hna/summary/08.json').acsProfile.DP02_0001E);
  const row = fact(/^Colorado households$/, 'statewide household-count');
  assert.equal(row.value, n(households), 'statewide household count must be data/hna/summary/08.json acsProfile.DP02_0001E');
  assert(/ACS/.test(row.source) && /DP02/.test(row.source), 'statewide household-count row must disclose the statewide ACS summary source');
  assert(hubHome.includes('data/hna/summary/08.json') && hubHome.includes('DP02_0001E'), 'hub/home.js must read statewide households from data/hna/summary/08.json acsProfile.DP02_0001E');
}

// Owner-selected framing: statewide cost burden across BOTH tenures, not the
// supply-gap figure. Verified against data/hna/chas_affordability_gap.json
// (HUD CHAS 2018-2022): 363,912 renter + 329,976 owner = 693,888 burdened
// households, 30.5% of the 2,277,884-household CHAS universe. The percentage
// must come from CHAS's own denominator -- dividing by the ACS DP02_0001E
// household total (2,479,892) yields a wrong 28.0% and mixes vintages.
// The page computes the sentence from that file; this recomputes it here and holds the sentence to it.
{
  const lead = (/<p class="hg-burden">([\s\S]*?)<\/p>/.exec(index) || [])[1];
  assert(lead, 'Home must keep the statewide cost-burden sentence');
  const leadText = home.text(lead);
  const chas = json('data/hna/chas_affordability_gap.json');
  const counties = Array.isArray(chas.counties) ? chas.counties : Object.values(chas.counties);
  let burdened = 0, all = 0;
  for (const c of counties) for (const k of ['renter_hh_by_ami', 'owner_hh_by_ami']) for (const b of Object.values(c[k] || {})) { burdened += b.cost_burdened_30pct || 0; all += b.total || 0; }
  assert(burdened > 0 && all > burdened, 'fixture: the CHAS file carries burdened and total households by tenure');
  assert(leadText.includes(n(Math.round(burdened / 1000) * 1000)), `cost-burden sentence must give the CHAS count (${n(Math.round(burdened / 1000) * 1000)}), renters and owners together`);
  const share = burdened / all;
  if (/nearly 1 in 3/i.test(leadText)) assert(share > 0.28 && share < 1 / 3 + 0.007, `the sentence says "nearly 1 in 3" but CHAS says ${(share * 100).toFixed(1)}%`);
  else assert(leadText.includes(Math.round(share * 100) + '% of'), 'cost-burden sentence must state the CHAS share when it is not "nearly 1 in 3"');
  assert(/HUD CHAS 2018/.test(leadText), 'cost-burden claim must disclose the CHAS 2018-2022 vintage inline');
  assert(/ACS/.test(leadText) && /roughly half of renters/.test(leadText), 'renter cost-burden sentence must carry an ACS source reference');
  assert(/homeowners|owners/i.test(leadText), 'the sentence must say the count includes homeowners');
  // No ACS household total in the same breath: the share is CHAS's own.
  assert(!leadText.includes(n(Number(json('data/hna/summary/08.json').acsProfile.DP02_0001E))), 'cost-burden sentence must not mix in the ACS household total');
}

// The two cumulative AMI figures. What is pinned below is what each has to AGREE with — the data file it is
// drawn from, and the other figure — never the sentence used to say it (#1746: three copy edits on 2026-09-22
// were each held by this block asserting the previous wording). Reword freely. A rewording that drops the tier
// relationship the data has, names a tier the data does not carry, or misstates what counts as an available
// home, fails.
// On the rebuilt page the ≤30% figure is a card under "Colorado at a glance" and the ≤50% figure is a row under
// "More Colorado numbers".
const AA_FILE = 'data/hna/chas_affordable_available.json';
const aaData = json(AA_FILE);
assert(hubHome.includes(AA_FILE), 'hub/home.js draws the shortfall figures from data/hna/chas_affordable_available.json');
const cards = [...index.matchAll(/<article class="hg-card"><h3>([\s\S]*?)<\/h3><p class="hg-value">([\s\S]*?)<\/p>([\s\S]*?)<\/article>/g)]
  .map((m) => ({ key: home.text(m[1]), value: home.text(m[2]), note: home.text(m[3]), html: m[0] }));
assert(cards.length >= 3, `only ${cards.length} "at a glance" cards parsed from Home`);
const card30 = cards.find((c) => /≤30%/.test(c.key));
assert(card30, 'Home must keep the ≤30% AMI shortfall card');
const row50 = fact(/≤50%/, '≤50% AMI shortfall');
const gapCards = { 30: { key: card30.key, value: card30.value, note: card30.note }, 50: { key: row50.label, value: row50.value, note: row50.source } };
const GAP_TIERS = ['30', '50'];
assert.notEqual(gapCards['30'].note, gapCards['50'].note, 'the two cumulative AMI figures must not carry identical notes');
for (const tier of GAP_TIERS) {
  const card = gapCards[tier];
  // The tier in the heading is a tier the data carries, and it is this figure's tier.
  const named = /≤(\d+)%/.exec(card.key);
  assert(named && named[1] === tier && aaData.statewide.tiers[named[1]], `≤${tier}% figure's heading names the data tier it renders`);
  // Homes, not people (#2220 follow-up: the numbers were read as people).
  assert(/homes/i.test(card.key), `≤${tier}% figure's heading names homes, the unit of the number`);
  // Every figure is the statewide record in the data file, pinned to the data rather than to a number, so a new
  // CHAS vintage needs no test edit.
  const r = aaData.statewide.tiers[tier];
  assert.equal(card.value, n(r.homes_short), `≤${tier}% headline renders the statewide homes short`);
  assert.equal(r.homes_short, r.renter_households - r.affordable_available_homes, `≤${tier}% headline equals the households minus the homes shown beside it`);
  assert(card.note.includes(n(r.renter_households)), `≤${tier}% note renders the statewide households`);
  assert(card.note.includes(n(r.affordable_available_homes)), `≤${tier}% note renders the statewide available homes`);
  assert(new RegExp(`\\b${Math.round(100 * r.affordable_available_homes / r.renter_households)} (for every 100|per 100)`).test(card.note),
    `≤${tier}% note renders homes per 100 households from the data's own counts`);
  // The vintage shown is the data's.
  assert(card.note.includes('HUD CHAS ' + aaData.meta.vintage), `≤${tier}% note renders the data vintage`);
}
assert(/not people/i.test(gapCards['30'].note), '≤30% card says the number counts homes, not people');
// What counts as available is the method in the data: vacant for rent, or
// rented by a household inside the group. The ≤30% card states it.
assert(/vacant for rent/.test(aaData.meta.method) && /rented by a household at or below the tier/.test(aaData.meta.method),
  'fixture: the data counts vacant homes and homes rented within the group');
// Read from the paragraph that explains HUD's count, not the ACS note under it (which also names higher-income renters).
const hudPara = [...card30.html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => home.text(m[1])).find((x) => x.includes(n(aaData.statewide.tiers['30'].affordable_available_homes)));
assert(hudPara, 'the ≤30% card explains HUD\'s count in its own paragraph');
assert(/vacant/i.test(hudPara) && /rented by someone in that group|rented within the group/i.test(hudPara),
  '≤30% card says which homes count: vacant, or rented within the group');
assert(/higher-income[^.]*(don’t|do not|don't) count/i.test(hudPara),
  '≤30% card says cheap homes rented by higher-income households do not count');
assert(/vacant/i.test(gapCards['50'].note) && /rented within the group/i.test(gapCards['50'].note), '≤50% row says which homes count');
// Tiers are cumulative in the data, so the ≤50% figure must say it includes ≤30%.
const t = aaData.statewide.tiers;
assert(t['50'].renter_households >= t['30'].renter_households, 'fixture: ≤50% contains ≤30% households');
assert(/≤30%/.test(gapCards['50'].key + ' ' + gapCards['50'].note) && /includ/i.test(gapCards['50'].key + ' ' + gapCards['50'].note),
  '≤50% figure states that it includes the ≤30% households (the data tiers are cumulative)');
// "No 60% tier" is true only while the data has no 60% tier.
assert.equal(/no 60% (figure|tier)/i.test(gapCards['50'].note), !('60' in t),
  '≤50% row says HUD has no 60% tier exactly when the data has no 60% tier');
// Income limits: the data measures each household against its own area's
// median, not one statewide figure; the page must not claim otherwise for HUD's count.
assert(/for each area/.test(aaData.meta.income_basis), 'fixture: income basis is per area');
assert(/each county/i.test(gapCards['30'].note), 'the ≤30% card says HUD uses each county\'s own limits');
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
// Under HUD's count, each figure keeps the ACS minimum (paul, 2026-10-15: show both, HUD's figure on top).
// Pinned to data/co_ami_gap_by_county.json, which hub/home.js draws it from.
const amiGapData = json('data/co_ami_gap_by_county.json');
assert(hubHome.includes('data/co_ami_gap_by_county.json'), 'hub/home.js draws the ACS minimum from data/co_ami_gap_by_county.json');
const acsYear = String(amiGapData.meta.acs_year);
const minNote = {};
{
  // ≤30%: the second paragraph under "How this is counted" on the ≤30% card.
  const paras = [...card30.html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => home.text(m[1]));
  minNote['30'] = paras.find((x) => /minimum/i.test(x) && x.includes(n(amiGapData.statewide.min_shortfall_matched_le_ami_pct['30'])));
  assert(minNote['30'], 'the ≤30% card shows HUD\'s count and the ACS minimum from the data');
  assert(card30.html.indexOf(n(aaData.statewide.tiers['30'].homes_short)) < card30.html.indexOf(n(amiGapData.statewide.min_shortfall_matched_le_ami_pct['30'])),
    'HUD\'s count comes before the ACS minimum on the ≤30% card');
  // ≤60%: rides on the ≤50% row, as a floor by a different method.
  minNote['60'] = gapCards['50'].note.slice(gapCards['50'].note.search(/The ACS/));
  assert(minNote['60'].includes(n(amiGapData.statewide.min_shortfall_matched_le_ami_pct['60'])), 'the ≤50% row shows the ACS ≤60% floor from the data');
}
for (const tier of ['30', '60']) {
  assert(minNote[tier].includes(acsYear), `ACS ≤${tier}% note shows the ACS year from the data`);
  assert(amiGapData.statewide.min_shortfall_matched_le_ami_pct[tier] != null, `the data carries the ≤${tier}% minimum`);
}
assert(/≤60% AMI/.test(minNote['60']) && !/≤(?!60)\d+% AMI/.test(minNote['60']), 'ACS ≤60% note names the tier it renders, which the data carries');
assert.equal(amiGapData.statewide.demand_tenure, 'renter', 'fixture: the gap demand side is renter households');
assert(/renter households/i.test(minNote['30']) && /afford/i.test(minNote['30']), 'ACS ≤30% note states its basis');
assert.equal(/no cash rent/i.test(minNote['30']), amiGapData.statewide.renter_units_no_cash_rent > 0,
  'ACS ≤30% note names the no-cash-rent homes the figure subtracts');
// Why it differs from HUD's: one statewide limit (the data's own figure) against HUD's per-area limits.
const amiShown = /AMI[^$]{0,40}\$([\d,]+)/.exec(minNote['30']);
assert(amiShown && Number(amiShown[1].replace(/,/g, '')) === amiGapData.statewide.ami_4person && /4-person/.test(minNote['30']),
  'the statewide AMI on the homepage equals statewide.ami_4person for the 4-person household the data uses');
assert(!/\$1\d\d,\d{3} for a 4-person/.test(hubHome), 'hub/home.js types the statewide AMI instead of reading statewide.ami_4person');
assert(minNote['30'].includes('FY' + amiGapData.meta.hud_income_limits_year), 'ACS ≤30% note names the HUD income-limit year the data records');
assert(/for each area/.test(aaData.meta.income_basis) && /each county/i.test(minNote['30']),
  'ACS ≤30% note says HUD uses each county\'s limits, as the HUD data does');
assert(/higher-income/i.test(minNote['30']), 'ACS ≤30% note says it counts homes higher-income households rent');
assert(/floor|at least|minimum/i.test(minNote['60']) && /occupied/i.test(minNote['60']),
  'ACS ≤60% note says it is a floor and carries the occupancy caveat');
assert(/lower/i.test(minNote['60']) === (amiGapData.statewide.min_shortfall_matched_le_ami_pct['60'] < aaData.statewide.tiers['50'].homes_short),
  'the ≤50% row says the ACS ≤60% floor is lower exactly when it is');
for (const rec of [amiGapData.statewide, ...amiGapData.counties]) {
  const m = rec.min_shortfall_matched_le_ami_pct;
  assert(m && m['60'] >= m['30'] && m['30'] >= 0, `${rec.county_name}: ≤60% minimum is at least the ≤30% one and never negative`);
}

// Ownership has a way in from Home, and it is the for-sale study, not the rental calculator.
{
  const own = home.links(index).filter((l) => /for-sale|ownership/i.test(l.text) && /^#\//.test(l.raw));
  assert(own.length >= 1 && own.every((l) => home.rebuilds(l.raw) === 'for-sale-market-study.html'),
    'Home must include an affordable ownership path, to the for-sale market study');
  assert(home.links(index).some((l) => home.rebuilds(l.raw) === 'deal-calculator.html'), 'Home must still link the Deal Calculator');
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
  // On the rebuilt page (paul, 13 Nov 2026: "follow your recommendation") the headline is for everyone and the
  // opening under it says who the site works for; the full audience statement is under "who it is for". Both
  // are held: the opening names people who work on housing before anything else, and the audience statement
  // names each persona field before it welcomes learners.
  const opening = home.text((/<p class="lede">([\s\S]*?)<\/p>/.exec(index) || [])[1] || '');
  assert(/people working on it|people who work on/i.test(opening), 'the opening says the site is for the people working on housing');
  assert(!/anyone can read/i.test(opening), 'the opening does not lead with a general-public audience');
  const sentences = text.split(/(?<=[.!?:])\s+/);
  const at = sentences.findIndex((x) => /learning the field|new to (the field|housing)|student/i.test(x));
  assert(at > 0, 'Home welcomes people learning the field');
  const lead = sentences.slice(Math.max(0, at - 2), at + 1).join(' ');
  const learnerAt = lead.search(/learning the field|new to (the field|housing)|student/i);
  for (const f of fields) {
    const re = stems[f] || new RegExp(f.slice(0, 5), 'i');
    const where = lead.search(re);
    assert(where >= 0 && where < learnerAt, `the audience statement names "${f}" before it welcomes learners`);
  }
}

// Every ACS year Home names is the year of the data it describes. Until 13 Nov 2026
// scripts/sync-hud-vintage-labels.mjs rewrote these in index.html; hub/home.js is built from the lab and cannot be
// rewritten here, so a new vintage must fail this until the lab follows.
{
  const acs = Number(amiGapData.meta.acs_year);
  const tract = Number(String(json('data/market/acs_tract_metrics_co.json').meta.vintage).match(/\d{4}/g).pop());
  const profile = Number(json('data/hna/summary/08.json').acsProfile._acsYear);
  assert(acs === tract && acs === profile, `fixture: the ACS files Home draws on share one year (gap ${acs}, tracts ${tract}, profile ${profile})`);
  const tables = [...index.matchAll(/data\.census\.gov\/table\/ACS(?:DP|DT|ST)5Y(\d{4})\./g)].map((m) => Number(m[1]));
  assert(tables.length >= 3, `only ${tables.length} Census table links found on Home`);
  for (const y of tables) assert.equal(y, acs, `a Census table link on Home names ${y}; the data is ACS ${acs}`);
  const spans = [...text.matchAll(/ACS (\d{4})[–-](\d{4})/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert(spans.length >= 3, `only ${spans.length} ACS 5-year labels found on Home`);
  for (const [from, to] of spans) assert(to === acs && from === acs - 4, `Home says "ACS ${from}–${to}"; the data is ACS ${acs - 4}–${acs}`);
}

// A figure the data cannot support is a dash, never a 0 (#1480) and never a typed fallback.
{
  const LabHome = (await home.boot()).win.LabHome;
  assert(LabHome && typeof LabHome.homeFigures === 'function', 'hub/home.js exposes homeFigures for this guard');
  const f = LabHome.homeFigures({ snap: { values: { renter_cost_burden_pct: null, average_lihtc_preservation_units_per_year: null } }, aa: null, gap: null, proj: { housing_need: { incremental_units_needed_dola: [1, null] } }, sum: null, burden: null });
  assert(Number.isNaN(f.burden), 'a null burden share is unknown, not 0');
  assert(Number.isNaN(f.need), 'a null 20-year need is unknown, not 0');
  assert(Number.isNaN(f.households), 'a missing household total is unknown, not 0');
  assert(Number.isNaN(f.presPerYr), 'a null preservation pace is unknown, not 0');
  assert(Number.isNaN(f.allBurdened) && Number.isNaN(f.allBurdenedShare), 'no CHAS file gives no burdened count');
}

console.log('homepage-claims: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
