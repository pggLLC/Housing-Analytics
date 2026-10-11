'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const curatedPath = path.join(root, 'data', 'policy_briefs_curated.json');
const pagePath = path.join(root, 'policy-briefs.html');

assert.ok(fs.existsSync(curatedPath), 'curated policy brief feed must exist');

const payload = JSON.parse(fs.readFileSync(curatedPath, 'utf8'));
assert.ok(Array.isArray(payload.briefs), 'curated feed must expose a briefs array');

const hpop = payload.briefs.find((brief) => brief.id === 'minneapolis-fed-hpop-2026');
assert.ok(hpop, 'HPOP research brief must be present');
assert.strictEqual(hpop.is_curated, true, 'HPOP brief must be marked curated');
assert.strictEqual(hpop.source_reviewed, true, 'HPOP brief must be marked source-reviewed');
assert.match(hpop.summary, /53% of U\.S\. adults/);
// Corrected per source review (2026-07): the unverifiable "13.9%" figure was
// replaced with the verified ~12-point HPOP↔owner-occupancy gap, and the
// under-35 sentence now flags person-based vs household-based measures.
assert.match(hpop.summary, /about 12 points below/);
assert.match(hpop.summary, /adults under 35, HPOP was about 22%/);
assert.doesNotMatch(hpop.summary, /13\.9% of adults/, 'unverifiable 13.9% figure removed');
// Colorado detail (verified against Minneapolis Fed hpop_current.xlsx, 2024).
assert.match(hpop.summary, /Colorado, 2024 HPOP was 57\.2%/);
assert.match(hpop.summary, /Pueblo \(41\.5%\)/);
assert.match(hpop.summary, /not published for counties or places/);
assert.ok(
  hpop.articles.some((article) =>
    article.link === 'https://www.minneapolisfed.org/article/2026/new-homeownership-measure-puts-people-first'
  ),
  'HPOP brief must link the Minneapolis Fed primary article'
);
assert.ok(
  hpop.articles.some((article) =>
    article.link === 'https://www.minneapolisfed.org/community-development-and-engagement/data-and-resources/homeowners-to-population-data'
  ),
  'HPOP brief must link the Minneapolis Fed data and methodology page'
);

const claims = (hpop.title + ' ' + hpop.summary + ' ' + hpop.implications).toLowerCase();
[
  'true homeownership rate',
  'nearly 1 in 7',
  'guarantees a massive',
  'holding any ownership stake or title'
].forEach((unsupported) => {
  assert.ok(!claims.includes(unsupported), 'unsupported framing must not appear: ' + unsupported);
});

// ── Colorado fee-reduction brief: pinned to the dataset, not to its copy ──
// Every count the brief states is recomputed from data/policy/fee-reductions.json,
// and every $ or % it states must sit in a source quote of an entry (or legal
// basis) that the same sentence names. Reword the brief freely; change a
// number or attach it to the wrong town and this fails.
const fees = JSON.parse(fs.readFileSync(path.join(root, 'data', 'policy', 'fee-reductions.json'), 'utf8'));
const feeBrief = payload.briefs.find((brief) => brief.id === 'co-fee-reductions-2026');
assert.ok(feeBrief, 'Colorado fee-reduction brief must be present');
assert.strictEqual(feeBrief.is_curated, true);
assert.strictEqual(feeBrief.source_reviewed, true);
assert.strictEqual(feeBrief.related_data, 'data/policy/fee-reductions.json');
const feeText = feeBrief.title + ' ' + feeBrief.summary + ' ' + feeBrief.implications;

const coEntries = fees.entries.filter((e) => e.state === 'CO');
const oneTime = coEntries.filter((e) => e.recurrence === 'one_time');
const expectCount = (re, expected, what) => {
  const m = feeText.match(re);
  assert.ok(m, 'brief must state ' + what);
  assert.deepStrictEqual(m.slice(1).map(Number), expected, what + ' must match the dataset');
};
expectCount(/records of (\d+) Colorado jurisdictions/, [new Set(coEntries.map((e) => e.jurisdiction)).size], 'the jurisdiction count');
expectCount(/verified (\d+) local fee measures and (\d+) land-use/, [coEntries.length, fees.land_use.length], 'the entry counts');
expectCount(/(\d+) of (\d+) one-time fee measures need/, [oneTime.filter((e) => e.eligibility.by_right === false).length, oneTime.length], 'the discretionary share');
expectCount(/(\d+) of (\d+) fee measures do not say how/, [coEntries.filter((e) => e.backfill.method === 'not_specified').length, coEntries.length], 'the unstated-backfill share');
expectCount(/the (\d+) verified incentives in (\d+) jurisdictions/, [fees.land_use.length, new Set(fees.land_use.map((l) => l.jurisdiction)).size], 'the land-use counts');

const money = (t) => (t.match(/\$\s?\d[\d,]*(?:\.\d+)?/g) || []).map((x) => Number(x.replace(/[$,\s]/g, '')));
const pcts = (t) => (t.match(/\d+(?:\.\d+)?(?=\)?\s*(?:%|percent\b))/g) || []).map(Number);
const shortName = (j) => j.replace(/^(City and County of|City of|Town of)\s+/, '').replace(/,.*$/, '');
const evidenceOf = (item) => {
  const quotes = item.evidence.map((ev) => ev.quote).join(' ');
  const tableFigures = item.evidence.flatMap((ev) => ev.table_figures || []).join(' ');
  return { amounts: new Set(money(quotes + ' ' + tableFigures)), pcts: new Set(pcts(quotes)) };
};
// A figure belongs to the nearest jurisdiction named before it in the same
// sentence (or, failing that, the first one named after it); a statute
// figure belongs to the statute the sentence cites.
const jurisdictionNames = [...new Set(coEntries.map((e) => shortName(e.jurisdiction)))];
let figuresChecked = 0;
feeText.split(/(?<=\.)\s+(?=[A-Z])/).forEach((sentence) => {
  const mentions = [];
  jurisdictionNames.forEach((name) => {
    let at = sentence.indexOf(name);
    while (at !== -1) { mentions.push({ name, at }); at = sentence.indexOf(name, at + name.length); }
  });
  const statutes = fees.meta.legal_basis.filter((l) =>
    (/29-20-104\.5/.test(sentence) && /29-20-104\.5/.test(l.citation)) ||
    (/TABOR/.test(sentence) && l.topic === 'enterprise_tabor'));
  const ownerAt = (pos) => {
    const before = mentions.filter((m) => m.at < pos).sort((a, b) => b.at - a.at)[0];
    const after = mentions.filter((m) => m.at > pos).sort((a, b) => a.at - b.at)[0];
    return (before || after || {}).name;
  };
  const backingAt = (pos) => {
    const owner = ownerAt(pos);
    const items = coEntries.filter((e) => shortName(e.jurisdiction) === owner).concat(statutes);
    return { owner, backing: items.map(evidenceOf) };
  };
  for (const m of sentence.matchAll(/\$\s?\d[\d,]*(?:\.\d+)?/g)) {
    figuresChecked++;
    const amount = Number(m[0].replace(/[$,\s]/g, ''));
    const { owner, backing } = backingAt(m.index);
    assert.ok(backing.some((b) => b.amounts.has(amount)),
      `brief states $${amount} for ${owner || 'no named jurisdiction'}, but its entries do not quote it: "${sentence.slice(0, 120)}…"`);
  }
  for (const m of sentence.matchAll(/(\d+(?:\.\d+)?)(?=\)?\s*(?:%|percent\b))/g)) {
    figuresChecked++;
    const { owner, backing } = backingAt(m.index);
    assert.ok(backing.some((b) => b.pcts.has(Number(m[1]))),
      `brief states ${m[1]}% for ${owner || 'no named jurisdiction'}, but its entries do not quote it: "${sentence.slice(0, 120)}…"`);
  }
});
assert.ok(figuresChecked >= 12, `only ${figuresChecked} brief figures checked; the scan has drifted`);

// A deferral is never presented as a saving, and the brief says what it is (PC-5).
const deferralSentence = feeText.split(/(?<=\.)\s+/).find((s) => /Deferrals/.test(s));
assert.ok(deferralSentence && /still owed/.test(deferralSentence), 'deferrals must be described as still owed');
assert.match(feeBrief.summary, /Screening context, not a study/);
const feeClaims = feeText.toLowerCase();
[
  'saves developers', 'free of fees', 'fee-free', 'required by state law', 'state law requires',
  'must waive', 'guarantee', 'every colorado', 'all colorado towns', 'deferral saves', 'deferrals save'
].forEach((unsupported) => {
  assert.ok(!feeClaims.includes(unsupported), 'unsupported framing must not appear in the fee brief: ' + unsupported);
});

const legislation = JSON.parse(fs.readFileSync(path.join(root, 'data', 'policy', 'tax-credit-legislation.json'), 'utf8'));
const hb = legislation.entries.find((entry) => entry.id === 'hb26-1065-transit-housing-investment-zones');
const hbBrief = payload.briefs.find((brief) => brief.id === 'hb26-1065-thiz-qap-2026');
assert.ok(hb && hbBrief, 'HB26-1065 record and public brief must both exist');
assert.strictEqual(hbBrief.is_curated, true);
assert.strictEqual(hbBrief.source_reviewed, true);
assert.strictEqual(hbBrief.related_data, 'data/policy/tax-credit-legislation.json');
assert.strictEqual(hb.analysis_url, 'research-brief.html?id=hb26-1065-thiz-qap-2026');
assert.strictEqual(payload.meta.brief_count, payload.briefs.length);
assert.match(hbBrief.summary, /in lieu of standard state credit, not in addition to it/i);
assert.match(hbBrief.summary, /not final until adopted/i);
assert.match(hbBrief.implications, /do not themselves establish THIZ eligibility/i);
const hbBriefText = hbBrief.summary + ' ' + hbBrief.implications;
const statesNoRuralSetAside = (text) =>
  /(?:\bno\b|\bnot\b|\bdo(?:es)? not\b)[^.]{0,120}\brural\b[^.]{0,80}\bset-aside\b/i.test(text);
assert.match(
  hb.source_note,
  /no rural credit set-aside, bonus, or enhanced credit/i,
  'canonical HB26-1065 evidence must retain the no-rural-set-aside finding'
);
assert.ok(
  statesNoRuralSetAside(hbBriefText) && statesNoRuralSetAside(hb.source_note),
  'brief and canonical HB26-1065 record must agree that there is no rural set-aside'
);

const hbBriefDollars = [...hbBrief.summary.matchAll(/\$\s*([\d,]+)/g)]
  .map((match) => Number(match[1].replace(/,/g, '')))
  .sort((a, b) => a - b);
const hbCanonicalDollars = [
  8333333,
  ...Object.values(hb.tz_credit_pairing.nine_percent).filter(Number.isFinite),
  ...Object.values(hb.tz_credit_pairing.four_percent_round_two).filter(Number.isFinite)
].sort((a, b) => a - b);
assert.deepStrictEqual(
  hbBriefDollars,
  hbCanonicalDollars,
  'brief dollar amounts must equal the statutory cap and canonical QAP pairing values'
);
assert.ok(hbBrief.articles.some((article) => article.link === hb.source_url));
assert.ok(hbBrief.articles.some((article) => article.link === hb.tz_credit_pairing.source_url));

// ── P.L. 119-21 §70422(a) ceiling brief: every figure comes from the record ──
// Each $ amount, percentage, multiplier, date, year and citation the brief
// states must be a value of the canonical legislation record (or be derived
// from one), and the record's key values must all be stated. Reword the brief
// freely; change a figure on either side and this fails.
const ceiling = legislation.entries.find((entry) => entry.id === 'obbba-lihtc-ceiling-12pct');
const ceilingBrief = payload.briefs.find((brief) => brief.id === 'obbba-lihtc-ceiling-12pct-2026');
assert.ok(ceiling && ceilingBrief, 'LIHTC ceiling record and public brief must both exist');
assert.strictEqual(ceilingBrief.is_curated, true);
assert.strictEqual(ceilingBrief.source_reviewed, true);
assert.strictEqual(ceilingBrief.related_data, 'data/policy/tax-credit-legislation.json');
assert.strictEqual(ceiling.analysis_url, 'research-brief.html?id=' + ceilingBrief.id);
const inc = ceiling.ceiling_increase;
const y26 = ceiling.ceiling_2026;
assert.ok(inc && y26, 'ceiling record must carry the statutory change and the IRS figures it is checked against');
const ceilingText = ceilingBrief.title + ' ' + ceilingBrief.summary + ' ' + ceilingBrief.implications;
let ceilingChecked = 0;
const sameSet = (stated, canonical, what) => {
  ceilingChecked += stated.length;
  assert.deepStrictEqual([...new Set(stated)].sort(), [...new Set(canonical)].sort(), what);
};
const pctOf = (multiplier) => Math.round((multiplier - 1) * 1000) / 10;

// Dollars: exactly the IRS per-capita amount and small-state minimum.
sameSet(money(ceilingText), [y26.per_capita, y26.small_state_minimum],
  'brief dollar amounts must equal the record\'s 2026 per-capita amount and small-state minimum');
// Percentages: the increase and the earlier increase, both derived from the
// record's multipliers, plus the credit type the record's own title names.
const titlePcts = pcts(ceiling.title);
sameSet(pcts(ceilingText), [pctOf(inc.multiplier), pctOf(inc.previous_multiplier), ...titlePcts],
  'brief percentages must equal the record\'s multipliers (and the credit type in its title)');
assert.ok(titlePcts.includes(pctOf(inc.multiplier)), 'the record title\'s increase must agree with its multiplier');
// Bare decimals (not $, not %): the statutory multiplier.
const bareDecimals = (t) => [...t.matchAll(/(?<![\d$.,])\d+\.\d+(?![\d.]|\s*(?:%|percent\b))/g)].map((m) => Number(m[0]));
sameSet(bareDecimals(ceilingText), [inc.multiplier], 'brief multipliers must equal the record\'s multiplier');

// Dates: every full date is a record date; the enactment and start dates are stated.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const statedDates = [...ceilingText.matchAll(new RegExp('(' + MONTHS.join('|') + ') (\\d{1,2}), (\\d{4})', 'g'))]
  .map((m) => m[3] + '-' + String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0') + '-' + m[2].padStart(2, '0'));
const recordDates = [ceiling.enacted_date, inc.applies_after, ceiling.effective_date];
ceilingChecked += statedDates.length;
statedDates.forEach((date) => assert.ok(recordDates.includes(date), `brief states ${date}, which is not a date in the record`));
[ceiling.enacted_date, inc.applies_after].forEach((date) => assert.ok(statedDates.includes(date), `brief must state the record date ${date}`));
const dayAfter = new Date(inc.applies_after + 'T00:00:00Z');
dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
assert.strictEqual(dayAfter.toISOString().slice(0, 10), ceiling.effective_date, 'effective date must be the day after the statutory cutoff');
assert.strictEqual(y26.year, Number(ceiling.effective_date.slice(0, 4)), 'the IRS figures must be for the first year the change applies');
const firstDollar = ceilingText.search(/\$\s?\d/);
assert.ok(firstDollar > 0 && ceilingText.slice(Math.max(0, firstDollar - 120), firstDollar).includes(String(y26.year)),
  'the IRS amounts must be stated for the record\'s year');
// Years: every year named is one the record supports; the earlier window matches.
const revProcNo = (y26.source.match(/Rev\. Proc\. (\d{4}-\d+)/) || [])[1];
const recordYears = new Set([
  ...recordDates.map((date) => Number(date.slice(0, 4))), y26.year, ...inc.previous_years, Number(String(revProcNo).slice(0, 4))
]);
const statedYears = [...ceilingText.matchAll(/(?<![\d-])(?:19|20)\d{2}(?![\d)])/g)].map((m) => Number(m[0]));
ceilingChecked += statedYears.length;
statedYears.forEach((year) => assert.ok(recordYears.has(year), `brief names ${year}, which the record does not support`));
// A year range is two years joined by any connective (through / to / and /
// a dash), optionally introduced by "from" or "between"; its endpoints are
// what must agree with the record, not the word that joins them.
const yearRanges = [...ceilingText.matchAll(/\b((?:19|20)\d{2})\s*(?:through|thru|to|until|and|[-–—])\s*((?:19|20)\d{2})\b/gi)]
  .map((m) => [Number(m[1]), Number(m[2])]);
assert.ok(yearRanges.length > 0, 'brief must state the years of the earlier increase');
const previousWindow = [Math.min(...inc.previous_years), Math.max(...inc.previous_years)];
ceilingChecked += yearRanges.length;
yearRanges.forEach((range) => assert.deepStrictEqual(range, previousWindow,
  `brief states the year range ${range.join('-')}, but the record's earlier increase covers ${previousWindow.join('-')}`));

// Legal citations and claims.
const citesOf = (t) => [...t.matchAll(/\b70422\([a-z]\)/g)].map((m) => m[0]);
citesOf(ceilingText).forEach((cite) => {
  ceilingChecked++;
  assert.ok(ceiling.source_note.includes(cite), `brief cites section ${cite}, which the record does not`);
});
assert.ok(ceilingText.includes('70422(a)') && inc.statute.includes('section 70422(a)'), 'brief and record must cite the same amending section');
const amended = inc.statute.match(/42\(h\)\(3\)\([A-Z]\)/)[0];
assert.ok(ceilingText.includes(amended), 'brief must cite the amended Code provision ' + amended);
(ceilingText.match(/42\(h\)\(\d\)\([A-Z]\)/g) || []).forEach((c) => assert.strictEqual(c, amended, 'brief cites a Code provision the record does not: ' + c));
const plNo = (t) => (t.match(/Public Law (\d+-\d+)/) || [])[1];
assert.ok(plNo(ceilingText) && plNo(ceilingText) === plNo(ceiling.source_note), 'brief and record must name the same Public Law');
assert.ok(revProcNo && ceilingText.includes('Rev. Proc. ' + revProcNo), 'brief must cite the IRS Rev. Proc. the record cites');
// "No end year" is true only if the record carries no sunset and no end year.
const statesNoEnd = (t) => /\b(?:no end year|no sunset|permanent)\b/i.test(t);
assert.strictEqual(statesNoEnd(ceilingText), ceiling.sunset_date === null && inc.end_year === null,
  'brief may call the increase permanent only when the record has no sunset or end year');
assert.ok(statesNoEnd(ceilingText), 'the record has no end year, so the brief must say so');
// The brief names 70422(b) as the only other §42 change; the record must agree and track it.
if (/70422\(b\)/.test(ceilingText)) {
  const bond = legislation.entries.find((entry) => entry !== ceiling && /70422\(b\)/.test(entry.source_note || ''));
  assert.ok(bond && ceiling.source_note.includes(bond.id), 'the 70422(b) record the brief points to must exist and be named by the ceiling record');
}
assert.strictEqual(ceiling.status, 'enacted');
assert.ok(/\bapproved\b|\bsigned\b|\benacted\b/i.test(ceilingBrief.summary), 'brief must describe the record as enacted law');
// Every source the record cites for these figures is linked from the brief.
[inc.source_url, inc.pre_amendment_text_url, y26.source_url].forEach((url) =>
  assert.ok(ceilingBrief.articles.some((article) => article.link === url), 'brief must link ' + url));
[inc.last_verified, y26.last_verified].forEach((d) => assert.strictEqual(d, ceiling.last_verified));
assert.ok(ceilingChecked >= 15, `only ${ceilingChecked} ceiling-brief figures checked; the scan has drifted`);
const ceilingClaims = ceilingText.toLowerCase();
['will lower', 'will raise', 'will increase', 'will reduce', 'expected to', 'likely', 'guarantee'].forEach((phrase) => {
  assert.ok(!ceilingClaims.includes(phrase), 'the ceiling brief must not predict outcomes: ' + phrase);
});

// ── ROAD to Housing Act (P.L. 119-101) brief: every figure comes from the record ──
// Each %, count, full date, year and section the brief states must be a value
// of the canonical hr6644-road-act record, and the record's provisions must
// all be stated. Reword the brief freely; change a figure or a section on
// either side and this fails.
{
  const road = legislation.entries.find((entry) => entry.id === 'hr6644-road-act');
  const brief = payload.briefs.find((item) => item.id === 'hr6644-road-act-2026');
  assert.ok(road && brief, 'ROAD Act record and public brief must both exist');
  assert.strictEqual(brief.is_curated, true);
  assert.strictEqual(brief.source_reviewed, true);
  assert.strictEqual(brief.related_data, 'data/policy/tax-credit-legislation.json');
  assert.strictEqual(road.analysis_url, 'research-brief.html?id=' + brief.id);
  const law = road.public_law;
  const provisions = road.provisions || [];
  assert.ok(law && provisions.length > 0 && road.implementation_check, 'ROAD Act record must carry the law, its provisions and the implementation check');
  const text = brief.title + ' ' + brief.summary + ' ' + brief.implications;
  let checked = 0;
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DATE_RE = new RegExp('(' + MONTH_NAMES.join('|') + ') (\\d{1,2}), (\\d{4})', 'g');
  const datesIn = (t) => [...t.matchAll(DATE_RE)]
    .map((m) => m[3] + '-' + String(MONTH_NAMES.indexOf(m[1]) + 1).padStart(2, '0') + '-' + m[2].padStart(2, '0'));

  // Dollars: the record has none.
  assert.deepStrictEqual(money(text), [], 'the ROAD Act record carries no dollar amount, so the brief may state none');
  // Percentages: the CDBG cap, and it must be stated.
  const caps = provisions.filter((p) => Number.isFinite(p.cap_pct)).map((p) => p.cap_pct);
  const statedPcts = pcts(text);
  checked += statedPcts.length;
  statedPcts.forEach((p) => assert.ok(caps.includes(p), `brief states ${p}%, which is not a cap in the record`));
  caps.forEach((p) => assert.ok(statedPcts.includes(p), `brief must state the record's ${p}% cap`));

  // Dates: every full date is a record date, and every record date is stated.
  const recordDates = [road.enacted_date, law.presented_date, law.final_passage_date, road.implementation_check.searched];
  const stated = datesIn(text);
  checked += stated.length;
  stated.forEach((d) => assert.ok(recordDates.includes(d), `brief states ${d}, which is not a date in the record`));
  recordDates.forEach((d) => assert.ok(stated.includes(d), `brief must state the record date ${d}`));
  assert.strictEqual(road.effective_date, road.enacted_date, 'the ROAD Act took effect on enactment');
  const statedYears = [...text.matchAll(/(?<![\d-])(?:19|20)\d{2}(?![\d)])/g)].map((m) => Number(m[0]));
  checked += statedYears.length;
  statedYears.forEach((y) => assert.ok(recordDates.some((d) => Number(d.slice(0, 4)) === y), `brief names ${y}, which the record does not support`));

  // Sections: every section the brief cites is a record provision (or the
  // section 42 it cites), and every record provision is cited.
  const sectionCites = [...text.matchAll(/\bsections? (\d+(?:\([a-z0-9]+\))*)/gi)].map((m) => m[1]);
  const recordSections = provisions.map((p) => p.section);
  const otherCites = ['42', ...provisions.map((p) => p.cites).filter(Boolean)];
  checked += sectionCites.length;
  sectionCites.forEach((s) => assert.ok(recordSections.some((r) => r === s || r.startsWith(s + '(')) || otherCites.includes(s), `brief cites section ${s}, which the record does not`));
  recordSections.forEach((s) => assert.ok(sectionCites.includes(s), `brief must cite the record's section ${s}`));
  // Other figures: once dates, years, percentages, citations and the law's
  // own identifiers are removed, every remaining number (digits or a number
  // word) must be a figure of the provision it is checked against.
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const rest = text
    .replace(DATE_RE, ' ')
    .replace(/Public Law \d+-\d+|H\.R\. \d+|\b21st\b/g, ' ')
    .replace(/\bsections? \d+(?:\([a-z0-9]+\))*/gi, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:%|percent\b)/g, ' ')
    .replace(/(?<![\d-])(?:19|20)\d{2}(?![\d)])/g, ' ');
  const figures = [...rest.matchAll(new RegExp('\\b(\\d+|' + WORDS.join('|') + ')\\b', 'gi'))]
    .map((m) => (/^\d+$/.test(m[1]) ? Number(m[1]) : WORDS.indexOf(m[1].toLowerCase())));
  const numericKeys = ['previous_deadline_months', 'small_project_max_units', 'infill_site_max_acres', 'rulemaking_deadline_years', 'lookback_months', 'category_count'];
  const recordFigures = provisions.flatMap((p) => numericKeys.filter((k) => Number.isFinite(p[k])).map((k) => p[k]));
  // A bare count of provisions ('three provisions') may not exceed the record's provision count.
  checked += figures.length;
  figures.forEach((n) => assert.ok(recordFigures.includes(n) || n <= provisions.length, `brief states the figure ${n}, which is not in the record`));
  recordFigures.forEach((n) => assert.ok(figures.includes(n), `brief must state the record figure ${n}`));
  const homeNepa = provisions.find((p) => Array.isArray(p.exempt_categories));
  assert.strictEqual(homeNepa.category_count, homeNepa.exempt_categories.length, 'the exemption count must equal the listed categories');

  // Legal claims, each tied to the record field that makes it true.
  const plNo = (t) => (t.match(/Public Law (\d+-\d+)/) || [])[1];
  assert.ok(plNo(text) === law.number && plNo(road.title) === law.number, 'brief, record title and record must name the same Public Law');
  const hr = (t) => (t.match(/H\.R\. (\d+)/) || [])[1];
  assert.ok(hr(text) && hr(text) === hr(road.source_note), 'brief and record must name the same bill');
  assert.strictEqual(/without (?:his|the President's|a) signature/i.test(text), /^without/.test(law.became_law),
    'brief may say the law took effect without signature only when the record does');
  assert.strictEqual(/does not amend section 42\b/i.test(text), road.amends_irc_section_42 === false,
    'brief may say section 42 is not amended only when the record says so');
  assert.strictEqual(/found no HUD (?:rule|notice)/i.test(text), road.implementation_check.found === null,
    'brief may say no HUD implementation was found only when the record records none');
  // Conditions the statute attaches, stated wherever the brief states the
  // figure they govern. Each is read from the record's provision, which must
  // itself say it; drop the condition on either side and this fails.
  const sentencesWith = (n, unit) => text.split(/(?<=\.)\s+/).filter((t) => new RegExp('\\b' + n + ' ' + unit).test(t));
  const rules = provisions.find((p) => p.rulemaking);
  assert.ok(rules && /determines necessary/.test(rules.rulemaking), 'the record must say what rules HUD must issue');
  const ruleSentences = sentencesWith(rules.rulemaking_deadline_years, 'years?');
  assert.ok(ruleSentences.length > 0, 'brief must state the rulemaking deadline');
  ruleSentences.forEach((t) => { checked++; assert.ok(/\b(?:any|such) rules\b[^.]*\bnecessary\b|\bdetermines? (?:to be )?necessary\b/i.test(t),
    'the record says HUD issues only the rules it determines necessary; this sentence does not: ' + t); });
  const inspection = provisions.find((p) => p.inspection_results);
  assert.ok(inspection && /performed/.test(inspection.inspection_results) && /obtain/.test(inspection.inspection_results), 'the record must say whose inspection counts');
  const inspectionSentences = sentencesWith(inspection.lookback_months, 'months');
  assert.ok(inspectionSentences.length > 0, 'brief must state the inspection look-back');
  inspectionSentences.forEach((t) => { checked++; assert.ok(/\bperform/i.test(t) && /\b(?:obtain|available|access)/i.test(t),
    'the record lets an inspection count if the agency performed it or can obtain it; this sentence must say both: ' + t); });
  const cdbg = provisions.find((p) => Number.isFinite(p.cap_pct));
  assert.ok(/appropriated after the date of enactment/.test(cdbg.applies_to), 'the record must say which CDBG amounts the new activity applies to');
  text.split(/(?<=\.)\s+/).filter((t) => pcts(t).includes(cdbg.cap_pct)).forEach((t) => { checked++;
    assert.ok(/appropriated after (?:the date of )?(?:enactment|the law)/i.test(t), 'the CDBG cap sentence must say it applies only to amounts appropriated after enactment: ' + t); });
  assert.strictEqual(road.status, 'enacted');
  // Every source the record cites is linked from the brief.
  [law.source_url, road.source_url, ...provisions.map((p) => p.pre_amendment_text_url).filter(Boolean)].forEach((url) =>
    assert.ok(brief.articles.some((article) => article.link === url), 'brief must link ' + url));
  assert.strictEqual(law.last_verified, road.last_verified);
  assert.ok(checked >= 20, `only ${checked} ROAD Act brief figures checked; the scan has drifted`);
  const claims = text.toLowerCase();
  ['will lower', 'will raise', 'will increase', 'will reduce', 'expected to', 'likely', 'guarantee'].forEach((phrase) => {
    assert.ok(!claims.includes(phrase), 'the ROAD Act brief must not predict outcomes: ' + phrase);
  });
  console.log('ROAD Act brief: ' + checked + ' figures checked against the record');
}

const page = fs.readFileSync(pagePath, 'utf8');
assert.match(page, /CURATED_BRIEFS_URL/);
assert.match(page, /data\/policy_briefs_curated\.json/);
// Housing News lists curated briefs through the Research & Analysis list
// (js/components/research-catalog.js), which keeps only is_curated briefs
// and labels the source-reviewed ones.
assert.match(page, /js\/components\/research-catalog\.js/);
const catalogJs = fs.readFileSync(path.join(root, 'js', 'components', 'research-catalog.js'), 'utf8');
assert.match(catalogJs, /b\.is_curated/);
assert.match(catalogJs, /Source-reviewed/);
assert.match(page, /Promise\.all\(\[/);

console.log('policy briefs curated feed regression tests passed (' + ceilingChecked + ' LIHTC ceiling-brief figures checked against the record)');
