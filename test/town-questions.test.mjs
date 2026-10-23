#!/usr/bin/env node
/**
 * Contract for the Jurisdiction Report's "Questions for the town" and the timing and
 * structure added to "Ideal deal: structure and timing"
 * (js/whitepaper/town-questions.js, dealTiming and dealStructure in
 * js/whitepaper/jurisdiction-whitepaper.js).
 *
 * What it pins:
 *   - the real question bank stays out of this public repo; without it the report
 *     says the questions load on the gated site;
 *   - every pointed question prints the figure that raised it, and that figure
 *     equals the file it cites; a signal with missing data does not fire;
 *   - named people come only from researched contacts, never a state agency's
 *     staff, and a town's manager is never the county's;
 *   - timing is back-solved from data/chfa-qap-calendar.json: base case, stretch
 *     and not-realistic readings move with the date; the Phase I date is 12 months
 *     before the application; thresholds quote the scoring file;
 *   - scoring lines show only where the data supports them.
 * Sabotage cases mutate copies and prove each check fires.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const WP = require(join(ROOT, 'js/whitepaper/jurisdiction-whitepaper.js'));
const TQ = require(join(ROOT, 'js/whitepaper/town-questions.js'));
const FundingFit = require(join(ROOT, 'js/funding-fit.js'));
const MixCheck = require(join(ROOT, 'js/mix-check.js'));
const { loadSources } = await import(join(ROOT, 'scripts/whitepaper/build-whitepaper.mjs'));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const BASE = loadSources();
const BANK = JSON.parse(read('test/fixtures/town-questions-bank.json'));
const clone = (o) => JSON.parse(JSON.stringify(o));
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

function model(geoid, { today = '2026-10-22', bank = BANK, src = BASE, contacts = null } = {}) {
  const s = Object.assign({}, src, { townQuestions: bank });
  return WP.buildModel(s, geoid, { today, FundingFit, MixCheck, TownQuestions: TQ, contacts });
}
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const rowOf = (g) => BASE.rankingIndex.rankings.find((r) => r.geoid === g);

// ---- 1. The bank is private.
ok(!existsSync(join(ROOT, 'data/jurisdiction-briefs/_town-questions.json')), 'the private question bank must not be in the public repo');
ok(WP.SOURCE_FILES.townQuestions && WP.isOptional('townQuestions'), 'the question bank is an optional source');
{
  const m = model('0833640', { bank: null });
  ok(m.questions && m.questions.missing, 'no bank: questions marked missing');
  const html = WP.renderHtml(m);
  const qsec = html.slice(html.indexOf('id="questions"')).split('<h2')[0];
  ok(html.includes('id="questions"') && !/<ol>|<li>/.test(qsec) && /<p[^>]*>[^<]*\w/.test(qsec), 'no bank: the questions section explains itself and lists nothing');
}

// ---- 2. Pointed questions carry the figure that raised them, equal to its source.
const SAMPLE = ['0833640', '0805265', '0820000', '0862000', '08051', '08001', '0822035', '0828745'];
const fired = {};
for (const g of SAMPLE) {
  const m = model(g);
  const row = rowOf(g);
  ok(m.questions.pointed.length <= TQ.MAX_POINTED, `${g}: at most ${TQ.MAX_POINTED} pointed questions`);
  ok(!m.questions.pointed.some((q) => q.signal === 'no_such_signal'), `${g}: an unknown signal never fires`);
  for (const q of m.questions.pointed) {
    fired[q.signal] = (fired[q.signal] || 0) + 1;
    ok(q.evidence && q.source, `${g} ${q.id}: evidence and source printed`);
    ok(!/\{\w+\}/.test(q.ask), `${g} ${q.id}: every placeholder filled`);
    if (q.signal === 'deep_gap') ok(q.evidence.includes(fmt(row.metrics.ami_gap_30pct) + ' rental homes short'), `${g}: 30% gap matches the ranking index`);
    if (q.signal === 'tax_credit_drought' && row.metrics.latest_lihtc_year) ok(q.evidence.includes(String(row.metrics.latest_lihtc_year)), `${g}: drought year matches the ranking index`);
    if (q.signal === 'qct_partial') ok(q.evidence.startsWith(Math.round(row.metrics.qct_share_pct) + '%'), `${g}: QCT share matches the ranking index`);
    if (q.signal === 'commuters') ok(q.evidence.startsWith(fmt(row.metrics.in_commuters)), `${g}: in-commuters match the ranking index`);
  }
  const html = WP.renderHtml(m);
  ok(html.includes('id="questions"') && html.indexOf('id="deal"') < html.indexOf('id="questions"'), `${g}: questions follow the deal section`);
}
for (const s of ['tax_credit_drought', 'deep_gap', 'rent_above_market', 'qct_partial', 'commuters', 'land_banked']) {
  ok(fired[s] > 0, `signal ${s} fires somewhere in the sample`);
}

// A signal whose data is missing does not fire (unknown is not zero).
{
  const src = clone(BASE);
  const row = src.rankingIndex.rankings.find((r) => r.geoid === '0833640');
  row.metrics.in_commuters = null;
  row.metrics.qct_share_pct = null;
  row.metrics.seasonal_share_of_vacant = null;
  const ids = model('0833640', { src }).questions.pointed.map((q) => q.signal);
  ok(!ids.includes('commuters') && !ids.includes('qct_partial') && !ids.includes('seasonal_homes'), 'missing data raises no question');
}
// Sabotage: a changed figure changes the evidence.
{
  const src = clone(BASE);
  src.rankingIndex.rankings.find((r) => r.geoid === '0833640').metrics.ami_gap_30pct = 9999;
  const q = model('0833640', { src }).questions.pointed.find((x) => x.signal === 'deep_gap');
  ok(q && q.evidence.includes('9,999'), 'sabotage: evidence follows the data');
}

// Denver and Broomfield file Prop 123 as a city and county; the record is found.
ok(model('0820000').prop123.record, 'Denver: Prop 123 record found under its city-and-county name');
ok(!model('0820000').questions.pointed.some((q) => q.signal === 'prop123_not_filed'), 'Denver: no "not filed" question');

// ---- 3. Standard questions quote the QAP line they cite; an unknown line is dropped, not invented.
{
  const m = model('0833640');
  const s1 = m.questions.standard.find((q) => q.id === 'S1');
  const t16 = BASE.qapScoring.thresholds.find((t) => t.id === 'T16');
  ok(s1.qap && s1.qap.quote === t16.quote && s1.qap.section === 'Threshold 16', 'S1 quotes Threshold 16');
  const tpl = BANK.standard.find((q) => q.id === 'S1').ask;
  ok(tpl.includes('{name}'), 'the fixture S1 wording carries the {name} placeholder');
  ok(s1.ask === tpl.split('{name}').join(m.name) && !/\{\w+\}/.test(s1.ask), 'standard wording filled with the place name, no placeholder left');
  ok(m.questions.standard.find((q) => q.id === 'S3').qap === null, 'an unknown QAP id cites nothing');
}

// ---- 4. Contacts: matched on role, local roles stay local, state staff never.
{
  const contacts = { contacts: [
    { name: 'County Person', role: 'County Manager', org: 'Gunnison County', source_url: 'https://example.org/a', source_quote: 'q' },
    { name: 'State Person', role: 'Planner', org: 'CHFA Community Development', source_url: 'https://example.org/b', source_quote: 'q' },
    { name: 'Town Planner', role: 'Planning Director', org: 'City of Gunnison', source_url: 'https://example.org/c', source_quote: 'q' },
    { name: 'Authority Person', role: 'Director, Gunnison County Housing Authority', org: 'Gunnison County Housing Authority', source_url: 'https://example.org/d', source_quote: 'q' }
  ] };
  const q = model('0833640', { contacts }).questions.standard;
  const by = (role) => (q.find((x) => x.role === role).contact || {}).name || null;
  ok(by('manager') === null, 'a town manager question is not put to the county manager');
  ok(by('planner') === 'Town Planner', 'planner matched at the town, not at CHFA');
  ok(by('housing_authority') === 'Authority Person', 'housing authority may be county-wide');
}

// Role terms are plain phrases matched at a word start, never compiled as patterns.
{
  const c = (role, org = 'Town of X') => [{ name: 'P', role, org, source_url: 'https://example.com/p' }];
  const bank = { roles: { pw: { label: 'PW', match: ['utilit'] }, odd: { label: 'Odd', match: ['a.b(c'] }, pl: { label: 'PL', match: ['planner'] } }, exclude: ['DOLA'] };
  ok(TQ.contactFor('pw', bank, c('Utilities Director')), 'a phrase matches at the start of a word');
  ok(!TQ.contactFor('pl', bank, c('Transplanner')), 'a phrase inside another word does not match');
  ok(TQ.contactFor('odd', bank, c('Lead a.b(c')) && !TQ.contactFor('odd', bank, c('Lead aXb(c')), 'pattern characters are matched literally');
  ok(!TQ.contactFor('pw', bank, c('Utilities Director', 'DOLA')), 'an excluded agency is never matched');
}

// The section is named for the government asked; a CDP's questions go to its county.
for (const g of ['0833640', '0823300', '08051']) {
  const m = model(g);
  const expect = m.kind === 'cdp' ? m.countyName : m.name;
  ok(m.questions.gov.name === expect, `${g}: questions go to ${expect}`);
  const html = WP.renderHtml(m);
  const head = html.slice(html.indexOf('<h2 id="questions">'), html.indexOf('</h2>', html.indexOf('<h2 id="questions">')));
  ok(head.endsWith('Questions for ' + expect.replace(/&/g, '&amp;')), `${g}: the heading names ${expect}`);
}

// Senior growth is a county projection; a town's evidence says so.
{
  const need = { seniorGrowthPp: 7, rankingSource: 'r' };
  const town = TQ.SIGNALS.senior_growth({ kind: 'place', name: 'Bayfield', countyName: 'La Plata County', need });
  const county = TQ.SIGNALS.senior_growth({ kind: 'county', name: 'La Plata County', countyName: 'La Plata County', need });
  ok(town.evidence.includes('La Plata County') && town.evidence.includes('county projection') && town.vars.area === 'La Plata County', 'town: senior growth is labelled as its county\'s projection');
  ok(!county.evidence.includes('county projection') && county.vars.area === 'La Plata County', 'county: senior growth is its own');
}

// Consolidated city-county: "City and County of Denver" staff are Denver's own.
{
  const bank = { roles: { manager: { label: 'Manager', match: 'manager', local: true } } };
  const c = [{ name: 'A', role: 'City Manager', org: 'City and County of Denver', source_url: 'https://example.com/x' }, { name: 'B', role: 'County Manager', org: 'Adams County', source_url: 'https://example.com/y' }];
  const hit = TQ.contactFor('manager', bank, c, 'Denver', 'place');
  ok(hit && hit.name === 'A', 'Denver: City and County of Denver staff count as local');
  ok(!TQ.contactFor('manager', bank, [{ name: 'C', role: 'County Manager', org: 'Denver County Housing Board', source_url: 'https://example.com/z' }], 'Denver', 'place'), 'a separate county body is still not the town');
}

// A CDP has no government: its county's Prop 123 filing applies, and the ask names the county.
{
  const m = model('0823300');
  ok(m.kind === 'cdp', 'Edwards is a CDP');
  const nf = TQ.SIGNALS.prop123_not_filed(m);
  if (m.prop123.countyRecord) ok(nf === null, 'Edwards: the county filing counts, so no "not filed" question');
  const fake = { kind: 'cdp', name: 'Edwards', countyName: 'Eagle County', prop123: { record: null, countyRecord: null, source: 's' } };
  const s2 = TQ.SIGNALS.prop123_not_filed(fake);
  ok(s2 && /Eagle County/.test(s2.evidence) && !/Edwards/.test(s2.evidence), 'CDP without a county filing: evidence names the county');
  const bank = { roles: { manager: { label: 'Manager', match: 'manager', local: true } }, standard: [{ id: 'S', role: 'manager', ask: 'Ask {name}?' }], pointed: [] };
  const mm = Object.assign({}, m, { contacts: { researched: [{ name: 'E', role: 'County Manager', org: m.countyName + ' Government', source_url: 'https://example.com/e' }] } });
  const q = TQ.build(mm, bank, null, '2026-10-22').standard[0];
  ok(q.ask === 'Ask ' + m.countyName + '?' && q.contact && q.contact.name === 'E', 'CDP: questions are addressed to the county and its staff');
}

// ---- 5. Timing from the CHFA calendar.
{
  const t = model('0833640', { today: '2026-10-22' }).deal.timing;
  const r = (label) => t.rows.find((x) => x.label.startsWith(label));
  ok(r('2027 R1').reading === 'stretch' && r('2027 R1').daysToLoi === 40, '22 Oct 2026: 2027 R1 is the stretch, 40 days out');
  ok(r('2028 R1').reading === 'base', '22 Oct 2026: 2028 R1 is the base case');
  ok(r('2027 R2') && r('2027 R2').reading === 'base', 'the 4% route shows its base round');
  const ms = r('2028 R1').milestones;
  ok(ms.find((x) => /Phase I/.test(x.what)).what.includes('2027-02-01'), 'Phase I dated no earlier than 12 months before the 2028 R1 application');
  const t2 = BASE.qapScoring.thresholds.find((x) => x.id === 'T2');
  ok(ms.find((x) => x.ref && x.ref.id === 'T2').ref.quote === t2.quote, 'site control quotes Threshold 2');
  const late = model('0833640', { today: '2026-11-25' }).deal.timing;
  ok(late.rows.find((x) => x.label.startsWith('2027 R1')).reading === 'late', '25 Nov 2026: 2027 R1 is not realistic');
  const after = model('0833640', { today: '2027-03-01' }).deal.timing;
  ok(!after.rows.some((x) => x.label.startsWith('2027 R1')) && after.rows.find((x) => x.label.startsWith('2028 R1')), 'a round whose letter of intent has passed drops out');
  const html = WP.renderHtml(model('0833640'));
  const base = model('0833640').deal.timing.rows.find((x) => x.reading === 'base');
  const dealSec = html.slice(html.indexOf('id="deal"')).split('<h2')[0];
  ok(dealSec.includes(base.label) && dealSec.includes(base.deadline) && dealSec.includes(base.loi), 'the deal section shows the base-case round, letter of intent and application date from the timing');
  // Sabotage: a moved letter-of-intent date moves the reading.
  const src = clone(BASE);
  src.qapCalendar.events.find((e) => e.id === '2027-r1-loi').date = '2027-01-30';
  ok(model('0833640', { src }).deal.timing.rows.find((x) => x.label.startsWith('2027 R1')).reading === 'base', 'sabotage: a later letter of intent makes 2027 R1 the base case');
  // The rolling 4% bond path is shown beside the R2 rows, from the calendar's own entry.
  ok(t.rolling4 && /rolling/.test(t.rolling4.description), 'the rolling 4% bond path is in the timing');
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  ok(html.includes(esc(t.rolling4.description)) && html.includes(esc(t.rolling4.name)), 'the rolling 4% path agrees with the calendar entry it came from');
  const noRoll = clone(BASE); noRoll.qapCalendar.rolling_programs = [];
  ok(model('0833640', { src: noRoll }).deal.timing.rolling4 === null, 'no rolling entry in the calendar: none invented');
  const r1only = clone(BASE); r1only.qapCalendar.events = r1only.qapCalendar.events.filter((e) => !/-r2-/.test(e.id || ''));
  ok(model('0833640', { src: r1only }).deal.timing.rolling4, 'only R1 rounds left: the rolling 4% path still shows');
  const past = model('0833640', { today: '2031-01-01' });
  ok(past.deal.timing && past.deal.timing.rows.length === 0 && past.deal.timing.rolling4, 'all rounds passed: the rolling 4% path still shows');
  const pastHtml = WP.renderHtml(past);
  const pastTiming = pastHtml.slice(pastHtml.indexOf('<h3>Timing</h3>'));
  ok(pastTiming.includes(esc(past.deal.timing.rolling4.description)) && !/<th>Round<\/th>/.test(pastTiming.split('<h2')[0]), 'all rounds passed: the rolling path from the calendar shows, with no round table');
  // Expectation from the funding guide itself, so a dropped land banking line fails here.
  const lbProg = (BASE.fundingGuide.programs || []).find((p) => p.id === 'prop123-ahff-land-banking');
  ok(lbProg && lbProg.status === 'open' && lbProg.application_cycle, 'the funding guide has an open land banking cycle, so the next check runs');
  ok(past.deal.timing.landBanking && pastTiming.split('<h2')[0].includes(esc(lbProg.application_cycle)), 'all rounds passed: the open land banking cycle from the funding guide still shows');
  const lbClosed = clone(BASE); lbClosed.fundingGuide.programs.find((p) => p.id === 'prop123-ahff-land-banking').status = 'closed';
  ok(model('0833640', { src: lbClosed, today: '2031-01-01' }).deal.timing.landBanking === null, 'sabotage: a closed land banking program is not shown as open');
  const onlyRoll = clone(BASE); onlyRoll.qapCalendar.events = [];
  ok(model('0833640', { src: onlyRoll }).deal.timing.rolling4, 'calendar with only the rolling program: timing still shows it');
  const noCal = clone(BASE); noCal.qapCalendar = { events: [] };
  ok(model('0833640', { src: noCal }).deal.timing === null, 'no calendar: no timing, nothing invented');
}

// ---- 6. Scoring lines only where the data supports them.
{
  const lines = (g) => model(g).deal.structure.lines.map((l) => l.id);
  ok(!lines('0820000').includes('5B3b-nonmetro'), 'Denver: no non-metro line');
  const gun = model('0833640').deal.structure.lines.find((l) => l.id === '5B3b-nonmetro');
  ok(gun && gun.reading === 'check', 'Gunnison: non-metro is a line to confirm, never "likely"');
  for (const g of SAMPLE) {
    const m = model(g);
    if (!/9%/.test(m.deal.route)) ok(!m.deal.structure.lines.some((l) => l.id === '5B5-homeless'), `${g}: no 9% set-aside line off the 9% route`);
    for (const l of m.deal.structure.lines) {
      const src = BASE.qapScoring.lines.find((x) => x.id === l.id);
      ok(src && l.points === src.points && l.quote === src.quote, `${g} ${l.id}: points and quote match the scoring file`);
    }
  }
}

// Housing authority points: only agencies named as housing authorities, and only "to confirm".
let phaSeen = 0;
for (const g of SAMPLE.concat(['0818310', '0880040'])) {
  const l = model(g).deal.structure.lines.find((x) => x.id === '5B4b-pha');
  if (l) phaSeen++;
  if (l) ok(l.reading === 'check' && /housing authority/i.test(l.text) && !/Community Housing\b(?! Authority)/.test(l.text.split(' as ')[0]), `${g}: 5B4b only for a named housing authority, to confirm`);
}
ok(phaSeen > 0, 'the housing authority line still appears where a named housing authority is on file');
ok(!(model('0818310').deal.structure.lines.find((x) => x.id === '5B4b-pha') || { text: '' }).text.includes('Town of Crested Butte Community Housing'), 'Crested Butte: a town housing office is not offered as a PHA');

// The 51-80% band has no 80% shortage measure, so it never raises the burden question.
{
  const src = clone(BASE);
  const m0 = src.rankingIndex.rankings.find((r) => r.geoid === '0820000').metrics;
  m0.ami_gap_60pct = 0; m0.ami_gap_50pct = 5;
  const q = model('0820000', { src }).questions.pointed.find((x) => x.signal === 'burden_without_gap');
  ok(!q || /31–50%/.test(q.evidence), 'burden question never cites the 51–80% band');
}

// Unknown DDA coverage is never read as "no DDA".
for (const g of SAMPLE) {
  const m = model(g);
  if (m.need.ddaSharePct === null) ok(!m.questions.pointed.some((x) => x.signal === 'qct_partial'), `${g}: qct_partial needs a known DDA share`);
}
ok(TQ.SIGNALS.qct_partial({ need: { qctSharePct: 40, ddaSharePct: null, rankingSource: 'x' } }) === null, 'qct_partial does not fire when DDA share is unknown');

// Each figure in the rent evidence names the file it came from.
let rentSeen = 0;
for (const g of SAMPLE.concat(['0880040'])) {
  const m = model(g);
  const q = m.questions.pointed.find((x) => x.signal === 'rent_above_market');
  if (!q) continue;
  rentSeen++;
  if (/median gross rent/.test(q.evidence)) ok(q.source.includes(m.need.rankingSource), `${g}: median rent evidence cites the ranking index`);
  if (/fair market rent/.test(q.evidence)) ok(q.source.includes(m.rents.fmrSource), `${g}: FMR evidence cites the FMR file`);
}
ok(rentSeen > 0, 'the rent question fired somewhere, so its source check ran');

// The burden question cites both files: CHAS for the burden, the ranking index for the shortage.
for (const g of SAMPLE) {
  const m = model(g);
  const q = m.questions.pointed.find((x) => x.signal === 'burden_without_gap');
  if (q) ok(q.source.includes(m.need.chasSource) && q.source.includes(m.need.rankingSource), `${g}: burden evidence cites CHAS and the ranking index`);
}
{
  const s = TQ.SIGNALS.burden_without_gap({ need: { gap50: 0, gap60: 3, chasSource: 'chas.json', rankingSource: 'ranking.json', bands: [{ key: '31to50', label: '31–50% AMI', burdenedPct: 70 }] } });
  ok(s && s.source === 'chas.json; ranking.json', 'burden_without_gap names both sources');
}

// 5B4a never names an unverified steward; every structure line cites the files it used.
let npSeen = 0, prSeen = 0, stewSeen = 0;
for (const g of SAMPLE.concat(['0818310', '08051', '0803620'])) {
  const st = model(g).deal.structure;
  if (!st) continue;
  if (st.lines.some((x) => x.id === '5B4a-nonprofit')) npSeen++;
  if (st.lines.some((x) => x.id === '5B2a-priority')) prSeen++;
  const np = st.lines.find((x) => x.id === '5B4a-nonprofit');
  if (np) ok(np.reading === 'check' && !/on file:/.test(np.text) && !/Housing Resources/.test(np.text), `${g}: 5B4a names no unverified partner and is only "to confirm"`);
  if (np && model(g).landscape.stewards.length) { stewSeen++; ok(st.source.includes('data/policy/stewardship-providers.json'), `${g}: 5B4a cites the stewardship file its stewards came from`); }
  const pr = st.lines.find((x) => x.id === '5B2a-priority');
  if (pr) ok(pr.reading === 'check', `${g}: 5B2a is only "to confirm" until a project is matched`);
  if (pr) ok(/local-support\.json|landscape/.test(st.source), `${g}: 5B2a cites the support or landscape file`);
}
ok(npSeen > 0 && prSeen > 0 && stewSeen > 0, 'the nonprofit, community-priority and steward-cited lines appeared, so their checks ran');
{
  const cb = model('0818310');
  const pri = cb.deal.structure.lines.find((x) => x.id === '5B2a-priority');
  if (pri && cb.policy.support && cb.policy.support.items && cb.policy.support.items.length) ok(cb.deal.structure.source.includes('data/policy/local-support.json'), 'Crested Butte: the community-priority line cites local-support.json');
}

// Where 9% and 4% are both viable, the dated base case is the round's: the rolling 4%
// bond path from the calendar is named beside it in the summary and the deal headline.
{
  let both = 0, nine = 0;
  const amp = (x) => x.replace(/&/g, '&amp;');
  for (const g of SAMPLE.concat(['0820000', '08031'])) {
    const m = model(g);
    const t = m.deal.timing;
    const base = t && t.rows.find((r) => r.reading === 'base');
    if (!base || !t.rolling4) continue;
    const html = WP.renderHtml(m);
    const at = (id) => { const a = html.indexOf('id="' + id + '"'); return html.slice(a, html.indexOf('<h', a + 1)); };
    const summary = at('summary'), deal = at('deal').split('<table')[0];
    const roll = amp(t.rolling4.name);
    ok(summary.includes(amp(base.label)) && deal.includes(amp(base.label)), `${g}: the summary and deal headline give the dated base case`);
    if (/^9% or 4%/.test(m.deal.route)) {
      both++;
      ok(summary.includes(roll) && deal.includes(roll), `${g}: both 9% and 4% viable, so the rolling 4% path from the calendar is named beside the round`);
    } else if (/^9% competitive/.test(m.deal.route)) {
      nine++;
      ok(!summary.includes(roll) && !deal.includes(roll), `${g}: a 9%-first place keeps the round's base case alone`);
    }
  }
  ok(both > 0 && nine > 0, 'both route kinds appeared, so the rolling headline checks ran');
  // Sabotage: without the calendar's rolling entry, the headline names no rolling path.
  const noRoll = clone(BASE); noRoll.qapCalendar.rolling_programs = [];
  const name = amp(model('0820000').deal.timing.rolling4.name);
  const d = WP.renderHtml(model('0820000', { src: noRoll }));
  ok(!d.slice(d.indexOf('id="summary"'), d.indexOf('id="deal"')).includes(name), 'no rolling entry in the calendar: the summary names none');
}

// Late in a cycle the timing headline still shows: a stretch round with no base left,
// and the rolling 4% path, each from the timing model.
{
  const amp = (x) => x.replace(/&/g, '&amp;');
  const t0 = model('0820000').deal.timing;
  // The last letter of intent on the whole calendar, not just the rows shown today.
  const lastLoi = BASE.qapCalendar.events.filter((e) => /-loi$/.test(e.id || '')).map((e) => e.date).sort().pop();
  const day = new Date(Date.parse(lastLoi + 'T00:00:00Z') - (t0.stretchMinDays + 1) * 864e5).toISOString().slice(0, 10);
  const late = model('0820000', { today: day });
  const st = late.deal.timing.rows.find((r) => r.reading === 'stretch');
  ok(st && !late.deal.timing.rows.some((r) => r.reading === 'base') && late.deal.timing.rolling4, `${day}: no base round left, one stretch, rolling path on the calendar, so the next checks run`);
  const html = WP.renderHtml(late);
  const at = (id) => { const a = html.indexOf('id="' + id + '"'); return html.slice(a, html.indexOf('<h', a + 1)); };
  const summary = at('summary'), deal = at('deal').split('<table')[0];
  for (const [where, text] of [['summary', summary], ['deal headline', deal]]) {
    ok(text.includes(amp(st.label)) && text.includes(amp(late.deal.timing.rolling4.name)), `no base round: the ${where} names the stretch round and the rolling 4% path`);
  }
  // The stretch fallback points at the rolling path, since no base round is left.
  const timing = html.slice(html.indexOf('<h3>Timing</h3>'));
  const fallback = timing.slice(timing.indexOf('</ul>'), timing.indexOf('</p>', timing.indexOf('</ul>')));
  ok(fallback.includes(amp(late.deal.timing.rolling4.name)), 'no base round: the stretch fallback names the rolling 4% path');
  const early = WP.renderHtml(model('0820000'));
  const eTiming = early.slice(early.indexOf('<h3>Timing</h3>'));
  if (model('0820000').deal.timing.rows.some((r) => r.reading === 'stretch')) {
    ok(!eTiming.slice(eTiming.indexOf('</ul>'), eTiming.indexOf('</p>', eTiming.indexOf('</ul>'))).includes(amp(t0.rolling4.name)), 'with a base round, the stretch fallback is the base case');
  }
  const past = WP.renderHtml(model('0820000', { today: '2031-01-01' }));
  const pastSummary = past.slice(past.indexOf('id="summary"'), past.indexOf('<h', past.indexOf('id="summary"') + 1));
  ok(pastSummary.includes(amp(t0.rolling4.name)), 'all rounds passed: the summary still names the rolling 4% path');
}

// In a month CHFA takes no preliminary applications, the rolling headline gives the
// reopening date from the calendar instead of saying the route need not wait.
{
  const entry = BASE.qapCalendar.rolling_programs.find((p) => p.category === '4pct-rolling');
  const closed = entry.closed_months || [];
  ok(closed.length > 0 && closed.length < 12, 'the calendar lists the rolling path\'s closed months, so the next checks run');
  const pad = (n) => String(n).padStart(2, '0');
  const at = (html, id) => { const a = html.indexOf('id="' + id + '"'); return html.slice(a, html.indexOf('<h', a + 1)); };
  let checked = 0;
  for (const mo of closed) {
    const day = '2027-' + pad(mo) + '-10';
    const r4 = model('0820000', { today: day }).deal.timing.rolling4;
    let n = mo, y = 2027;
    do { n = n === 12 ? 1 : n + 1; if (n === 1) y++; } while (closed.includes(n));
    const want = y + '-' + pad(n) + '-01';
    ok(r4.closedNow && r4.reopens === want, `${day}: closed month, the window reopens ${want}`);
    const html = WP.renderHtml(model('0820000', { today: day }));
    ok(at(html, 'summary').includes(want) && at(html, 'deal').split('<table')[0].includes(want), `${day}: the summary and deal headline give the reopening date`);
    checked++;
  }
  const openMo = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((n) => !closed.includes(n) && n > 1);
  const openDay = '2027-' + pad(openMo) + '-10';
  const r4o = model('0820000', { today: openDay }).deal.timing.rolling4;
  ok(!r4o.closedNow && r4o.reopens === null, `${openDay}: open month, no reopening date`);
  ok(checked === closed.length, 'every closed month was checked');
  // Sabotage: without the calendar's closed months, a closed month reads as open.
  const noClosed = clone(BASE); noClosed.qapCalendar.rolling_programs.forEach((p) => { delete p.closed_months; });
  ok(!model('0820000', { today: '2027-' + pad(closed[0]) + '-10', src: noClosed }).deal.timing.rolling4.closedNow, 'no closed months on the calendar: none invented');
}

// A 9%-first place whose base round is a 4% one also sees the rolling 4% path.
{
  const amp = (x) => x.replace(/&/g, '&amp;');
  const no9 = clone(BASE); no9.qapCalendar.events = no9.qapCalendar.events.filter((e) => !/-r1-/.test(e.id || ''));
  const g = SAMPLE.find((x) => /^9% competitive/.test(model(x).deal.route));
  const m = model(g, { src: no9 });
  const base = m.deal.timing && m.deal.timing.rows.find((r) => r.reading === 'base');
  ok(g && base && base.credit === '4%' && m.deal.timing.rolling4, `${g}: 9%-first with only 4% rounds left, so the next check runs`);
  const html = WP.renderHtml(m);
  const summary = html.slice(html.indexOf('id="summary"'), html.indexOf('<h', html.indexOf('id="summary"') + 1));
  ok(summary.includes(amp(base.label)) && summary.includes(amp(m.deal.timing.rolling4.name)), `${g}: a 4% base round is shown with the rolling 4% path`);
}

// A county's no-money finding claims only the county's own search.
{
  const empty = { policy: { funds: [], fees: [], sources: ['s'] } };
  const county = TQ.SIGNALS.no_local_money(Object.assign({ kind: 'county', name: 'Denver County' }, empty)).evidence;
  const town = TQ.SIGNALS.no_local_money(Object.assign({ kind: 'place', name: 'Avon' }, empty)).evidence;
  ok(!/its county/.test(county) && /its county/.test(town), 'no_local_money names a containing county only for a town or CDP');
}

// Consolidated city-counties: "City and County of Denver" staff are local to both the
// Denver place report and the Denver County report.
{
  const bank = { roles: { manager: { label: 'Manager', match: ['manager'], local: true } }, standard: [{ id: 'S', role: 'manager', ask: 'Ask {name}?' }], pointed: [] };
  let seen = 0;
  for (const g of ['08031', '08014']) {
    const m = model(g);
    const bare = m.name.replace(/ County$/, '');
    ok(m.kind === 'county' && bare !== m.name, `${g} is a county report named "${m.name}", so the check runs`);
    const mm = Object.assign({}, m, { contacts: { researched: [{ name: 'R', role: 'City Manager', org: 'City and County of ' + bare, source_url: 'https://example.com/r' }], related: [] } });
    const q = TQ.build(mm, bank, null, '2026-10-22').standard[0];
    if (q.contact && q.contact.name === 'R') seen++;
  }
  ok(seen === 2, 'Denver and Broomfield county reports name the City and County staff contact');
  const ea = model('08037');
  const other = Object.assign({}, ea, { contacts: { researched: [{ name: 'X', role: 'Town Manager', org: 'Town of Avon', source_url: 'https://example.com/x' }], related: [] } });
  ok(!TQ.build(other, bank, null, '2026-10-22').standard[0].contact, 'a town manager is not offered as the county manager');
}

// A town's county contacts fill county-wide roles; local roles stay with the town's staff.
{
  const bank = { roles: { manager: { label: 'Manager', match: ['manager'], local: true }, housing_authority: { label: 'Housing authority', match: ['housing authority'] } },
    standard: [{ id: 'M', role: 'manager', ask: 'Ask {name}?' }, { id: 'H', role: 'housing_authority', ask: 'Ask {name}?' }], pointed: [] };
  const m = model('0804110');
  ok(m.kind === 'place' && m.countyName === 'Eagle County', 'Avon is a town report in Eagle County, so the next checks run');
  const mm = Object.assign({}, m, { contacts: { researched: [{ name: 'T', role: 'Town Manager', org: 'Town of Avon', source_url: 'https://example.com/t' }],
    related: [{ geoid: '08037', contacts: [{ name: 'C', role: 'County Manager', org: 'Eagle County', source_url: 'https://example.com/c' }, { name: 'H', role: 'Housing Authority Director', org: 'Eagle County Housing Authority', source_url: 'https://example.com/h' }] }] } });
  const q = TQ.build(mm, bank, null, '2026-10-22').standard;
  ok(q[0].contact && q[0].contact.name === 'T', 'the local manager role keeps the town manager, not the county manager');
  ok(q[1].contact && q[1].contact.name === 'H', 'the county housing authority director is named for the housing authority question');
  const county = model('08037');
  const cm = Object.assign({}, county, { contacts: { researched: [], related: [{ geoid: '0803620', contacts: [{ name: 'X', role: 'Housing Authority Director', org: 'Town of Avon', source_url: 'https://example.com/x' }] }] } });
  ok(!TQ.build(cm, bank, null, '2026-10-22').standard[1].contact, 'a county report does not borrow a town file\'s contacts');
}

// CDP: the county's researched contacts (held under related) are used for questions.
{
  const m = model('0823300');
  const bank = { roles: { manager: { label: 'Manager', match: 'manager', local: true } }, standard: [{ id: 'S', role: 'manager', ask: 'Ask {name}?' }], pointed: [] };
  const mm = Object.assign({}, m, { contacts: { researched: [], related: [{ geoid: '08037', name: m.countyName, contacts: [{ name: 'R', role: 'County Manager', org: m.countyName, source_url: 'https://example.com/r' }] }] } });
  const q = TQ.build(mm, bank, null, '2026-10-22').standard[0];
  ok(q.contact && q.contact.name === 'R', 'CDP: the county contact from the related file is named');
}

// The "never" drought question needs the boundary count to agree that nothing is mapped here.
{
  const base = { lihtc: { properties: [], latestAwardYear: null, scopeLabel: 'X', sources: ['s'], recencyBasis: 'never_funded' }, need: { rankingSource: 'r' } };
  ok(TQ.SIGNALS.tax_credit_drought(Object.assign({}, base, { lihtc: Object.assign({}, base.lihtc, { inBoundary: 9 }) }), '2026-10-22') === null, 'mapped projects in the boundary: no "never" question');
  ok(TQ.SIGNALS.tax_credit_drought(Object.assign({}, base, { lihtc: Object.assign({}, base.lihtc, { inBoundary: null }) }), '2026-10-22') === null, 'boundary count unknown: no "never" question');
  ok(TQ.SIGNALS.tax_credit_drought(Object.assign({}, base, { lihtc: Object.assign({}, base.lihtc, { inBoundary: 0 }) }), '2026-10-22') !== null, 'nothing mapped and nothing matched: the question fires');
  ok(TQ.SIGNALS.tax_credit_drought(Object.assign({}, base, { lihtc: Object.assign({}, base.lihtc, { inBoundary: 0, recencyBasis: null }) }), '2026-10-22') === null, 'no measured recency record: no "never" question');
  ok(TQ.SIGNALS.tax_credit_drought(Object.assign({}, base, { lihtc: Object.assign({}, base.lihtc, { inBoundary: 0, recencyBasis: 'award_year' }) }), '2026-10-22') === null, 'a recency record that is not "never funded": no "never" question');
  ok(model('0833640').lihtc.recencyBasis === (rowOf('0833640').metrics || {}).recency_basis, 'the model carries the ranking index recency basis');
  for (const g of SAMPLE) {
    const m = model(g);
    const q = m.questions.pointed.find((x) => x.signal === 'tax_credit_drought' && /No CHFA/.test(x.evidence));
    if (q) ok(m.lihtc.inBoundary === 0, `${g}: "never" question only when nothing is mapped in the boundary`);
  }
}

// 5B4a and 5B4b are either/or for one sponsor.
let bothSeen = 0;
for (const g of SAMPLE.concat(['0880040'])) {
  const st = model(g).deal.structure;
  const a = st && st.lines.find((x) => x.id === '5B4a-nonprofit'), b = st && st.lines.find((x) => x.id === '5B4b-pha');
  if (a && b) bothSeen++;
  if (a && b) ok(a.exclusiveWith === '5B4b-pha' && b.exclusiveWith === '5B4a-nonprofit', `${g}: the two sponsor lines are marked as alternatives`);
}
ok(bothSeen > 0, 'at least one sample place shows both sponsor lines, so the either/or check ran');

// A researched housing contact means a partner is on file.
{
  const loaded = { resortPrograms: true, stewardship: true, research: true };
  const m = { landscape: { authorities: [], stewards: [], research: { groups: [] }, loaded, sources: [] }, contacts: { orgs: [], partners: [], researched: [{ name: 'H', role: 'Housing Director', org: 'Town of X' }], related: [], resourcesLoaded: true, contactsLoaded: true } };
  ok(TQ.SIGNALS.no_partner(m) === null, 'a researched housing contact stops the "no partner" question');
  m.contacts.researched = [];
  ok(TQ.SIGNALS.no_partner(m) !== null, 'with nothing on file the question fires');
  for (const k of ['resortPrograms', 'stewardship', 'research']) {
    const mm = JSON.parse(JSON.stringify(m)); mm.landscape.loaded[k] = false;
    ok(TQ.SIGNALS.no_partner(mm) === null, `${k} not loaded: no "no partner" question`);
  }
  const mr = JSON.parse(JSON.stringify(m)); mr.contacts.resourcesLoaded = false;
  ok(TQ.SIGNALS.no_partner(mr) === null, 'local resources not loaded: no "no partner" question');
  const mc = JSON.parse(JSON.stringify(m)); mc.contacts.contactsLoaded = false;
  ok(TQ.SIGNALS.no_partner(mc) === null, 'a contact file failed to load: no "no partner" question');
  // The finding cites every file it searched, contacts and resources included.
  const ms = Object.assign(clone(m), { geoid: '0899999' });
  ms.contacts.related = [{ geoid: '08999', contacts: [] }];
  const src = TQ.SIGNALS.no_partner(ms).source;
  for (const f of ['data/jurisdiction-briefs/_contacts/0899999.json', 'data/jurisdiction-briefs/_contacts/08999.json', 'data/hna/local-resources.json']) ok(src.includes(f), `"no partner" cites ${f}`);
  // Through buildModel: a related file that loaded with no usable contact is dropped
  // from related but is still cited as searched.
  const g = '0823300', rel = WP.relatedGeoids(BASE, g);
  ok(rel.length > 0, 'the CDP has related places, so the next check runs');
  const built = WP.buildModel(Object.assign({}, BASE, { townQuestions: BANK }), g, { today: '2026-10-22', FundingFit, MixCheck, TownQuestions: TQ, localResources: {}, relatedContacts: rel.map((r) => ({ geoid: r, contacts: [] })) });
  ok(built.contacts.related.length === 0 && built.contacts.searchedGeoids.join() === [g].concat(rel).join(), 'empty related files are kept as searched');
  const mb = Object.assign({}, built, { landscape: m.landscape, contacts: Object.assign({}, built.contacts, { orgs: [], partners: [], researched: [] }) });
  const srcB = TQ.SIGNALS.no_partner(mb).source;
  for (const r of rel) ok(srcB.includes(`data/jurisdiction-briefs/_contacts/${r}.json`), `"no partner" cites the searched but empty related file ${r}`);
}

// A failed local-resources load stays unavailable.
{
  const s = Object.assign({}, BASE, { townQuestions: BANK });
  const opts = (o) => Object.assign({ today: '2026-10-22', FundingFit, MixCheck, TownQuestions: TQ }, o);
  ok(WP.buildModel(s, '0833640', opts({ localResources: null })).contacts.resourcesLoaded === false, 'no local-resources file: not counted as loaded');
  ok(WP.buildModel(s, '0833640', opts({ localResources: {} })).contacts.resourcesLoaded === true, 'a loaded local-resources file counts as loaded');
  ok(WP.buildModel(s, '0833640', opts({ contactsFailed: true })).contacts.contactsLoaded === false, 'a failed contact load is not counted as loaded');
  ok(WP.buildModel(s, '0833640', opts({ contacts: null })).contacts.contactsLoaded === true, 'an absent contact file is a finished search');
  const lsOk = WP.buildModel(s, '0833640', opts({ landscape: { geoid: '0833640' } })).landscape.loaded.research;
  ok(lsOk === true && WP.buildModel(s, '0833640', opts({ landscape: { geoid: '0833640' }, landscapeFailed: true })).landscape.loaded.research === false, 'a failed landscape load is not counted as searched, even with a county fallback');
  const page = read('developer-brief.html');
  ok((page.match(/trackedJson\(WP\.landscapePath\(/g) || []).length === 2 && /landscapeFailed: landscapeMisses\.length > 0/.test(page), 'developer-brief.html records failed landscape loads');
  ok(/contactsFailed: contactMisses\.length > 0/.test(page) && (page.match(/trackedJson\(WP\.contactsPath\(/g) || []).length === 2, 'developer-brief.html records failed contact loads for this place and related places');
}

// A county read from a town's landscape file is not searched county-wide.
{
  const rel = WP.relatedGeoids(BASE, '08051').filter((g) => g !== '08051');
  ok(rel.length >= 1, 'Gunnison County has a related place for the partial-research check');
  const s = Object.assign({}, BASE, { townQuestions: BANK });
  const opts = (o) => Object.assign({ today: '2026-10-22', FundingFit, MixCheck, TownQuestions: TQ }, o);
  const own = WP.buildModel(s, '08051', opts({ landscape: { geoid: '08051' } }));
  const one = WP.buildModel(s, '08051', opts({ relatedLandscape: [{ geoid: rel[0] }] }));
  ok(own.landscape.loaded.research === true, "the county's own landscape file counts as searched");
  ok(one.landscape.loaded.research === false, "a single town's file does not count as a county-wide search");
  ok(!one.questions.pointed.some((q) => q.signal === 'no_partner'), 'a town-file county fallback never asks the "no partner" question');
  const town = WP.buildModel(s, rel[0], opts({ landscape: { geoid: '08051' } }));
  ok(town.landscape.loaded.research === true, "a place read from its county's file counts as searched");
}

// Both routes viable: the base case is the earliest realistic round, whichever credit.
{
  const big = SAMPLE.concat(['0820000']).map((g) => model(g, { today: '2026-10-22' })).find((m) => /^9% or 4%/.test(m.deal.route));
  ok(big, 'a sample place has both routes viable');
  const t = big.deal.timing;
  const bases = t.rows.filter((r) => r.reading === 'base').map((r) => r.loi).sort();
  ok(t.rows.find((r) => r.reading === 'base').loi === bases[0], `${big.name}: base case is the earliest base round`);
}

// ---- 7. The page loads the module before the report and passes it in.
{
  const page = read('developer-brief.html');
  const a = page.indexOf('js/whitepaper/town-questions.js'), b = page.indexOf('js/whitepaper/jurisdiction-whitepaper.js');
  ok(a !== -1 && a < b, 'developer-brief.html loads town-questions.js before the report module');
  ok(/TownQuestions: window\.TownQuestions/.test(page), 'developer-brief.html passes TownQuestions to buildModel');
  // The option must sit inside the WP.buildModel(...) call, not just anywhere in the script.
  const passes = (text) => { const i = text.indexOf('WP.buildModel('); if (i === -1) return false; const j = text.indexOf('});', i); return /^\s*TownQuestions\s*(,|:)/m.test(text.slice(i, j)); };
  const cli = read('scripts/whitepaper/build-whitepaper.mjs');
  ok(passes(cli), 'the command-line build passes TownQuestions to buildModel');
  ok(!passes(cli.replace(/^\s*TownQuestions,\s*$/m, '')), 'sabotage: removing the option from the build call fails the check');
}

console.log(`town-questions: ${checks} checks passed`);
