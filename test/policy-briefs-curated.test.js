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

// ── AHCIA (H.R. 2725 / S. 1515) brief: every figure comes from the records ──
// One brief covers both bill records. Its status claims must agree with each
// record's bill fields and latest action; each $, %, multiplier, count, date
// and section it states is bound to the record field it describes; and every
// provision it names must be one the record lists, with the enacted
// counterparts checked against their own records. Reword freely; change or
// swap a figure on either side and this fails.
{
  const house = legislation.entries.find((entry) => entry.id === 'ahcia-2025-hr2725');
  const senate = legislation.entries.find((entry) => entry.id === 'ahcia-2025-s1515');
  const brief = payload.briefs.find((item) => item.id === 'ahcia-2025-pending-provisions');
  assert.ok(house && senate && brief, 'both AHCIA records and the public brief must exist');
  assert.strictEqual(brief.is_curated, true);
  assert.strictEqual(brief.source_reviewed, true);
  assert.strictEqual(brief.related_data, 'data/policy/tax-credit-legislation.json');
  [house, senate].forEach((rec) => assert.strictEqual(rec.analysis_url, 'research-brief.html?id=' + brief.id, rec.id + ' must link the AHCIA brief'));
  assert.strictEqual(senate.provisions_same_as, house.id, 'the brief covers both bills only while the Senate record says its text matches the House bill');
  const provisions = house.provisions || [];
  assert.ok(provisions.length > 0 && house.latest_action && senate.latest_action, 'the AHCIA records must carry the provisions and latest actions the brief is checked against');
  const text = brief.title + ' ' + brief.summary + ' ' + brief.implications;
  let checked = 0;
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DATE_RE = new RegExp('(' + MONTH_NAMES.join('|') + ') (\\d{1,2}), (\\d{4})', 'g');
  const datesIn = (t) => [...t.matchAll(DATE_RE)]
    .map((m) => m[3] + '-' + String(MONTH_NAMES.indexOf(m[1]) + 1).padStart(2, '0') + '-' + m[2].padStart(2, '0'));
  const prov = (section) => provisions.find((p) => p.section === section);
  const allocation = prov('101');
  const bondTest = prov('313');
  const ceilingLaw = legislation.entries.find((entry) => entry.id === allocation.enacted_counterpart);
  const bondLaw = legislation.entries.find((entry) => entry.id === bondTest.enacted_counterpart);
  assert.ok(ceilingLaw && bondLaw && ceilingLaw.status === 'enacted' && bondLaw.status === 'enacted', 'the enacted counterparts the brief names must be enacted records');
  const ceilingPct = ceilingLaw.ceiling_increase ? Math.round((ceilingLaw.ceiling_increase.multiplier - 1) * 1000) / 10 : pcts(ceilingLaw.title)[0];
  const bondMinPct = bondLaw.bond_test ? bondLaw.bond_test.post_2025_issue_min_pct
    : Number((bondLaw.pricing_impact.match(/at least (\d+)% of basis/) || [])[1]);
  assert.ok(Number.isFinite(ceilingPct) && Number.isFinite(bondMinPct), 'the enacted counterparts must carry the figures the brief states');
  // Bind each figure to the provision it describes. For every "<number>
  // <unit>" in the brief, the binding whose context words sit nearest to it in
  // the same clause names the record value it must equal; every binding must
  // be used, and no figure may go unbound. Swapping two figures (or moving a
  // figure to another provision) therefore fails even though both values
  // exist in the record. A binding with side 'before' only counts context
  // words that come before the figure ('from 50% to 25%').
  const bindFigures = (t, bindings, what) => {
    const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
    const toNumber = (s) => (/^\$/.test(s) ? Number(s.replace(/[$,\s]/g, '')) : /^\d/.test(s) ? Number(s.replace(/,/g, '')) : WORDS.indexOf(s.toLowerCase()));
    const clauseOf = (at) => {
      const before = t.slice(0, at);
      const starts = [...before.matchAll(/[.;]\s+(?=[A-Z(])/g)].map((m) => m.index + m[0].length);
      const start = starts.length ? starts[starts.length - 1] : 0;
      const end = t.slice(at).search(/[.;]\s+(?=[A-Z(])|[.;]?$/);
      return [start, at + end];
    };
    const spans = [];
    let count = 0;
    const used = new Set();
    for (const unit of new Set(bindings.map((b) => b.unit))) {
      const re = unit === '$'
        ? /(\$\s?\d[\d,]*(?:\.\d+)?)/g
        : new RegExp('(?<![\\d.-])\\b(\\d[\\d,]*(?:\\.\\d+)?|' + WORDS.join('|') + ')\\s*(?:calendar\\s+)?(?:' + unit + ')(?![a-z])', 'gi');
      for (const m of t.matchAll(re)) {
        const at = m.index;
        const [cs, ce] = clauseOf(at);
        const clause = t.slice(cs, ce);
        let best = null;
        let bestDist = Infinity;
        bindings.filter((b) => b.unit === unit).forEach((b) => {
          for (const c of clause.matchAll(new RegExp(b.context.source, 'gi'))) {
            const cStart = cs + c.index;
            const cEnd = cStart + c[0].length;
            if (b.side === 'before' && cEnd > at) continue;
            const dist = cEnd <= at ? at - cEnd : cStart >= at + m[0].length ? cStart - (at + m[0].length) : 0;
            if (dist < bestDist) { bestDist = dist; best = b; }
          }
        });
        assert.ok(best, `${what}: "${m[0]}" is not tied to any provision the record carries (clause: ${clause})`);
        assert.strictEqual(toNumber(m[1]), best.value, `${what}: "${m[0]}" describes ${best.name}, which the record gives as ${best.value}`);
        used.add(best.name);
        spans.push([at, at + m[0].length]);
        count++;
      }
    }
    bindings.forEach((b) => assert.ok(b.optional || used.has(b.name), `${what}: brief must state ${b.name} (${b.value})`));
    return { count, spans };
  };
  const bound = bindFigures(text, [
    { name: 'section 101\'s 2025 per-resident amount', unit: '$', value: allocation.per_capita_2025, context: /per-resident|per resident/, side: 'before' },
    { name: 'section 101\'s 2025 small-state minimum', unit: '$', value: allocation.minimum_2025, context: /minimum/, side: 'before' },
    { name: 'the enacted ceiling increase', unit: '%|percent', value: ceilingPct, context: /raises|70422\(a\)/ },
    { name: 'section 313\'s current bond test', unit: '%|percent', value: bondTest.from_pct, context: /\bfrom\b|keeps/, side: 'before' },
    { name: 'section 313\'s proposed bond test', unit: '%|percent', value: bondTest.to_pct, context: /\bto\b|adds a/, side: 'before' },
    { name: 'the enacted post-2025 bond minimum', unit: '%|percent', value: bondMinPct, context: /together|at least/, side: 'before' },
    { name: 'the House cosponsor count', unit: 'cosponsors', value: house.bill.cosponsors.total, context: /H\.R\. 2725/, side: 'before' },
    { name: 'the Senate cosponsor count', unit: 'cosponsors', value: senate.bill.cosponsors.total, context: /S\. 1515/, side: 'before' },
  ], 'AHCIA brief');
  checked += bound.count;
  assert.ok(String(house.bill.number).includes('2725') && String(senate.bill.number).includes('1515'), 'the bound bill numbers must be the records\' bill numbers');
  // The multiplier: the only bare decimal, equal to section 101's.
  const bareDecimals = [...text.matchAll(/(?<![\d$.,])\d+\.\d+(?![\d.]|\s*(?:%|percent\b))/g)].map((m) => Number(m[0]));
  checked += bareDecimals.length;
  assert.deepStrictEqual(bareDecimals, [allocation.multiplier_2026], 'the brief\'s multiplier must be section 101\'s');

  // Dates: each is a record date; every record date is stated, each in the
  // context it belongs to.
  const recordDates = {
    [house.bill.introduced]: /H\.R\. 2725/, [senate.bill.introduced]: /S\. 1515/, [ceilingLaw.enacted_date]: /Public Law/,
    [bondTest.bond_issue_after]: /issued after|issue/, [house.last_verified]: /As of/,
  };
  assert.strictEqual(house.bill.introduced, house.latest_action.date, 'H.R. 2725 has no action after its introduction day');
  assert.strictEqual(senate.bill.introduced, senate.latest_action.date, 'S. 1515 has no action after its introduction day');
  assert.strictEqual(senate.last_verified, house.last_verified, 'both AHCIA records must be checked on the same day');
  const statedDates = [...text.matchAll(DATE_RE)];
  checked += statedDates.length;
  statedDates.forEach((m) => {
    const iso = datesIn(m[0])[0];
    assert.ok(iso in recordDates, `brief states ${iso}, which is not a date in the records`);
    const before = text.slice(Math.max(0, m.index - 120), m.index);
    assert.ok(recordDates[iso].test(before), `brief states ${iso} without the context the record gives it`);
  });
  Object.keys(recordDates).forEach((iso) => assert.ok(datesIn(text).includes(iso), `brief must state the record date ${iso}`));
  const recordYears = new Set([...Object.keys(recordDates).map((d) => Number(d.slice(0, 4))), 2026]);
  assert.ok(Object.keys(recordDates).some((d) => d.startsWith('2026')), 'the 2026 multiplier year must be one the records date');

  // Sections: each one cited is a provision the record lists or an enacted
  // counterpart's amending section; every pending provision is named, and
  // each enacted counterpart is cited next to its own provision.
  const cites = [...text.matchAll(/\bsections? (\d+(?:\([a-z]\))?)/gi)].map((m) => m[1]);
  checked += cites.length;
  const counterpartCites = [ceilingLaw, bondLaw].map((rec) => (rec.source_note.match(/section (70422\([a-z]\))/) || [])[1]);
  cites.forEach((c) => assert.ok(prov(c) || counterpartCites.includes(c), `brief cites section ${c}, which the records do not`));
  provisions.forEach((p) => assert.ok(cites.includes(p.section), `brief must name section ${p.section} (${p.title})`));
  const sentences = text.split(/(?<=\.)\s+/);
  [[allocation, counterpartCites[0]], [bondTest, counterpartCites[1]]].forEach(([p, cite]) => {
    const s = sentences.find((t) => new RegExp('Section ' + p.section + '\\b').test(t));
    assert.ok(s && s.includes(cite), `section ${p.section}'s sentence must cite its enacted counterpart ${cite}`);
  });
  // Pending provisions are named as not law.
  const pendingSentence = sentences.find((t) => provisions.filter((p) => p.status === 'pending').every((p) => t.includes('section ' + p.section)));
  assert.ok(pendingSentence && /\bnot law\b|\bnot enacted\b|\bpending\b/i.test(pendingSentence), 'the pending provisions must be named, together, as not law');

  // Per-bill facts, each compared on its own: every mention of a bill's
  // sponsor, committee and introduction date must belong to that bill (the
  // nearest bill number before it is its own), and each chamber named must be
  // followed by its own bill. Swapping any one of them between the bills fails.
  const billMentions = [house, senate].flatMap((rec) =>
    [...text.matchAll(new RegExp(rec.bill.number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s'), 'g'))].map((m) => ({ at: m.index, rec })));
  const billBefore = (at) => billMentions.filter((m) => m.at < at).sort((x, y) => y.at - x.at)[0];
  const billAfter = (at) => billMentions.filter((m) => m.at > at).sort((x, y) => x.at - y.at)[0];
  const introPhrase = (iso) => MONTH_NAMES[Number(iso.slice(5, 7)) - 1] + ' ' + Number(iso.slice(8, 10)) + ', ' + iso.slice(0, 4);
  [house, senate].forEach((rec) => {
    assert.strictEqual(rec.status, 'proposed');
    const facts = {
      sponsor: rec.bill.sponsor.match(/\b([A-Z][a-zA-Z]+) \(/)[1],
      committee: rec.bill.committee.replace(/^(House|Senate) /, ''),
      introduced: introPhrase(rec.bill.introduced),
    };
    Object.entries(facts).forEach(([what, value]) => {
      const hits = [...text.matchAll(new RegExp('\\b' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'))];
      assert.ok(hits.length > 0, `brief must state ${rec.bill.number}'s ${what} (${value})`);
      hits.forEach((h) => {
        checked++;
        const owner = billBefore(h.index);
        assert.ok(owner && owner.rec === rec, `"${value}" is ${rec.bill.number}'s ${what}, but the brief attaches it to ${owner ? owner.rec.bill.number : 'no bill'}`);
      });
    });
    [...text.matchAll(new RegExp('\\bin the ' + rec.bill.chamber + '\\b', 'g'))].forEach((h) => {
      checked++;
      const next = billAfter(h.index);
      assert.ok(next && next.rec === rec, `the ${rec.bill.chamber} must be followed by its own bill, ${rec.bill.number}`);
    });
    assert.ok(/referred/i.test(rec.latest_action.text), `${rec.id}'s latest action must be a referral for the brief to say so`);
  });
  assert.strictEqual(/neither is law|neither bill is law/i.test(text), house.status === 'proposed' && senate.status === 'proposed',
    'brief may say neither bill is law only while both records are proposed');
  assert.ok(/no action[^.]*after (?:its )?referral/i.test(text), 'brief must say no action followed the referrals, as both latest actions show');
  assert.ok(/same sections/i.test(text) === (senate.provisions_same_as === house.id), 'brief may say the bills have the same sections only when the Senate record says so');
  // Every source the records cite is linked.
  [house.source_url, senate.source_url, house.text_url, senate.text_url].forEach((url) =>
    assert.ok(brief.articles.some((article) => article.link === url), 'brief must link ' + url));
  // No figure left unbound.
  let rest = text;
  bound.spans.slice().sort((x, y) => y[0] - x[0]).forEach(([from, to]) => { rest = rest.slice(0, from) + ' '.repeat(to - from) + rest.slice(to); });
  rest = rest
    .replace(DATE_RE, ' ')
    .replace(/H\.R\. \d+|S\. \d+|Public Law \d+-\d+/g, ' ')
    .replace(/\bsections? \d+(?:\([a-z]\))?/gi, ' ')
    .replace(/(?<![\d$.,])\d+\.\d+/g, ' ')
    .replace(/(?<!\d)(?<!\d-)(?:19|20)\d{2}(?![\d)])/g, (y) => { checked++; assert.ok(recordYears.has(Number(y)), `brief names ${y}, which the records do not support`); return ' '; });
  const unbound = rest.match(/\$|%|\b(?:\d+|zero|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi) || [];
  assert.deepStrictEqual(unbound, [], 'AHCIA brief states figures that are not bound to a record field');
  assert.ok(checked >= 25, `only ${checked} AHCIA brief figures checked; the scan has drifted`);
  const claims = text.toLowerCase();
  ['will lower', 'will raise', 'will increase', 'will reduce', 'expected to', 'likely', 'guarantee', 'will pass'].forEach((phrase) => {
    assert.ok(!claims.includes(phrase), 'the AHCIA brief must not predict outcomes: ' + phrase);
  });
  console.log('AHCIA brief: ' + checked + ' figures checked against the records');
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
