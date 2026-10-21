// The gated Submittal review page (developer-submittal-review.html, js/whitepaper/submittal-review.js)
// and its rules file (data/policy/chfa-2027-r1-scoring.json). Run: node test/submittal-review.test.mjs
// Uses a made-up deal; no client or project figures belong in this repository.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SR = require(path.join(ROOT, 'js/whitepaper/submittal-review.js'));
const Nav = (() => { const g = {}; new Function('window', 'document', read('js/whitepaper/developer-nav.js'))(g, undefined); return g.DeveloperNav || g; })();
const rules = JSON.parse(read('data/policy/chfa-2027-r1-scoring.json'));
const prop123 = JSON.parse(read('data/policy/prop123_jurisdictions.json'));
const places = JSON.parse(read('data/co-place-centroids.json'));
prop123.places = Object.values(places.byGeoid).map((p) => p.name); // as start() attaches it

let checks = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } checks++; };
const near = (a, b, msg) => ok(Math.abs(a - b) < 1e-6, msg + ` (${a} vs ${b})`);

// ── Rules file: every line is sourced, and its status is honest ─────────────
ok(rules.status === 'draft' || rules.status === 'adopted', 'rules carry a status');
ok(/^\d{4}-\d{2}-\d{2}$/.test(rules.checked_at) && /^\d{4}-\d{2}-\d{2}$/.test(rules.review_by), 'rules carry checked and review-by dates');
ok(new Date().toISOString().slice(0, 10) <= rules.review_by, 'the rules are past their review-by date: re-check CHFA\'s QAP page for adoption and re-copy');
ok(/^https:\/\/www\.chfainfo\.com\//.test(rules.source.url), 'rules cite CHFA\'s PDF');
ok(rules.minimum_score.points === 130 && /130 points/.test(rules.minimum_score.quote), 'the 9% minimum is quoted');
const sourced = (l) => typeof l.quote === 'string' && l.quote.length > 20 && Number.isInteger(l.page) && l.page > 0;
ok(rules.lines.every(sourced), 'every scoring line has a quote and a page');
ok(rules.thresholds.every(sourced), 'every threshold has a quote and a page');
ok([rules.targeting, rules.eli_targeting, rules.targeting.lowest_ami_bonus, rules.gap_pilot.doh, rules.gap_pilot.oedit].every((x) => x.quote && x.quote.length > 20), 'targeting and gap-fund rules are quoted');
rules.lines.filter((l) => typeof l.points === 'number').forEach((l) => {
  const words = { 1: /one point|\(one point\)/i, 2: /two points/i, 3: /three points/i, 5: /five points/i, 7: /seven points/i, 15: /fifteen points/i, 40: /40 points/ };
  if (words[l.points]) ok(words[l.points].test(l.quote), `${l.id}: the quote states ${l.points} points`);
});
ok(rules.gap_pilot.doh.per_unit === 45000 && /\$45,000 per unit and a maximum of \$2\.5 million/.test(rules.gap_pilot.doh.quote), 'DOH Round One amounts match the quote');
ok(rules.gap_pilot.oedit.per_unit === 40000 && /\$40,000 per unit and a maximum of \$2\.25 million/.test(rules.gap_pilot.oedit.quote), 'OEDIT Round One amounts match the quote');
ok(/48% or below for Round One/.test(rules.gap_pilot.doh.eligibility_quote) && rules.gap_pilot.doh.midpoint_max === 48, 'DOH midpoint line matches the quote');
ok(!/confidential|trade secret/i.test(JSON.stringify(rules)), 'nothing marked confidential is cited');
if (rules.status === 'draft') ok(/not adopted/i.test(rules.status_note), 'draft rules say "not adopted"');

// ── Made-up deal: 60 homes, 6 at 30%, 12 at 40%, 18 at 50%, 24 at 60% ──────
const mix = { 30: 6, 40: 12, 50: 18, 60: 24 };
const mp = SR.amiMidpoint(mix);
near(mp.value, (6 * 30 + 12 * 40 + 18 * 50 + 24 * 60) / 60, 'AMI midpoint is units x AMI over units');
const tp = SR.targetingPoints(rules, mix);
near(tp.points, 18 / 60 * 92.5 + 18 / 60 * 72.5 + 24 / 60 * 50, 'targeting = share x weight, 30% units counted in the 40% row');
ok(SR.targetingPoints(rules, { 60: 10, 80: 10 }, 'average-income').points === 25, 'under Average Income, 80% units earn no targeting points but count in the total');
ok(SR.targetingPoints(rules, { 60: 10, 80: 10 }, '40-60').points === 50, 'under 40-60, 80% units are not tax credit units and leave the denominator');

// ELI: 10% exactly is 5 points both ways; 12% is 5 ("at least") or 10 ("up to"), and the lower counts.
let e = SR.eliPoints(rules, mix);
ok(e.points === 5 && !e.differs, '10% at 30% AMI earns 5 points either way');
e = SR.eliPoints(rules, { 30: 6, 60: 44 });
ok(e.atLeast === 5 && e.upTo === 10 && e.points === 5 && e.differs, '12% earns the lower reading and flags the wording');
ok(SR.eliPoints(rules, { 60: 50 }).points === 0, 'no 30% units, no ELI points');

// Score: auto lines, claims, exclusions.
let s = SR.score(rules, { mix }, {});
const line = (sc, id) => sc.lines.filter((l) => l.id === id)[0];
ok(line(s, '5A2-extended-use').points === 40, '25-year extended use counts 40 for 9%');
ok(line(s, '5B3a-mixed').points === 0, 'an all-tax-credit deal does not earn mixed-income points');
ok(line(s, '5A1d-eli').status === 'not claimed', 'ELI needs a claim (services)');
near(s.total, tp.points + 40, 'unclaimed score is targeting plus extended use');
ok(!s.meets && s.primaryOk, 'primary criteria met but under 130');
ok(s.addable[0].id === '5B3e-nosmoking' || s.addable[0].rank === 1, 'cheapest points come first');
ok(line(s, '5B1-need').status === 'needs entry', 'housing need asks for CHFA\'s tier points');

s = SR.score(rules, { mix }, { '5A1d-eli': true, '5B5-homeless': true, '5B4a-nonprofit': true, '5B4b-pha': true, '5B1-need': 6, '5B3e-nosmoking': true });
ok(line(s, '5A1d-eli').status === 'excluded' && line(s, '5B5-homeless').points === 15, 'ELI and homeless set-aside cannot both count; the larger stays');
ok(line(s, '5B4a-nonprofit').status === 'excluded' && line(s, '5B4b-pha').points === 7, 'one sponsor line counts');
ok(line(s, '5B1-need').points === 6, 'entered housing need points count');
ok(SR.score(rules, { mix: { 60: 48, market: 12 } }, {}).lines.filter((l) => l.id === '5B3a-mixed')[0].points === 5, '80% tax credit units earns mixed income');

// Prop 123 and the gap-fund lane.
const filed = prop123.jurisdictions.find((j) => j.next_cycle && j.next_cycle.submitted);
const firstOnly = prop123.jurisdictions.find((j) => !j.next_cycle && j.status);
ok(SR.prop123Status(prop123, filed.name).status === 'yes', 'a 2027-2029 filing makes a place Prop 123 eligible');
if (firstOnly) ok(SR.prop123Status(prop123, firstOnly.name).status === 'to-confirm', 'a first-cycle-only place is "to confirm"');
ok(SR.prop123Status(prop123, 'Town of Aguilar').status === 'no', 'a real town not on DOLA\'s list is not eligible');

let lane = SR.gapLane(rules, { mix: { 30: 20, 40: 20, 50: 20 } }, { status: 'no' });
ok(lane.lane === 'DOH' && lane.kind === 'cash flow loan at 2%' && lane.amount === 2500000 && lane.capped, 'midpoint 40% goes to DOH, capped at $2.5M');
lane = SR.gapLane(rules, { mix: { 30: 20, 40: 20, 50: 20 }, sponsor: 'nonprofit' }, { status: 'no' });
ok(lane.kind === 'grant', 'DOH gives nonprofits a grant');
lane = SR.gapLane(rules, { mix }, { status: 'yes', text: 'filed' });
ok(lane.lane === 'OEDIT' && lane.amount === 2250000 && lane.mustPay, 'over 48% in a Prop 123 place goes to OEDIT, capped at $2.25M');
lane = SR.gapLane(rules, { mix }, { status: 'no' });
ok(lane.lane === 'DOH fallback' && lane.flags.some((f) => /unconfirmed|does not say/i.test(f)), 'outside Prop 123 the DOH fallback is flagged unconfirmed');
lane = SR.gapLane(rules, { mix, supportive: true }, { status: 'no' });
ok(lane.lane === 'DOH', 'supportive housing qualifies for DOH at any midpoint');
lane = SR.gapLane(rules, { mix: { 40: 16, 50: 30, 60: 4 } }, { status: 'yes', text: '' });
ok(lane.flags.some((f) => /half a point/.test(f)), 'a midpoint within half a point of 48% is flagged');

// One unit up a tier moves the midpoint.
const b = SR.bumpOneUnit(mix);
ok(b.from === 50 && b.to === 60 && b.mix[50] === 17 && b.mix[60] === 25, 'the stress test moves one unit from the highest tier under 60%');

const as = SR.amiStress(rules, prop123, { deal: { mix: { 40: 10, 50: 40 } }, claims: {} });
ok(as && as.laneBefore === 'DOH' && as.laneAfter !== 'DOH' && /lane flips/.test(as.fails), 'the AMI test reports a lane flip');
ok(rules.underwriting.dcr_min === 1.15 && /1\.15 to 1\.0/.test(rules.underwriting.quote), 'the coverage minimum is CHFA\'s, quoted');
ok(/under CHFA's 1\.15x minimum/.test(SR.stressFails(rules, { engine: { dscr: 1.1 } }, {})), 'coverage under 1.15x fails');
ok(SR.stressFails(rules, { scoreBefore: 120, scoreAfter: 119 }, {}) === '', 'a score already under 130 is not a new failure');

// Thresholds and credit cap.
const th = SR.thresholdStatus(rules, { T2: 'ready', T3: 'missing' }, { rehab: false });
ok(th.missing === 1 && th.rows.find((r) => r.id === 'T4').answer === 'na', 'rehab-only thresholds do not apply to new construction');
ok(SR.creditCheck(rules, 1850000).status === 'over' && SR.creditCheck(rules, 1600000).status === 'ok', 'the 9% credit cap is checked');
// Codex review on fc2a5fd1e: $1.7M-$1.8M depends on whether pilot gap funds are available (3.L.1).
const between = SR.creditCheck(rules, 1750000);
ok(between.status === 'depends' && between.cap === 1700000 && between.altCap === 1800000, 'a request between the pilot and 3.L.1 caps is flagged, not called over');
// Codex review on 894c38f97: other active applications count against the cap.
ok(SR.creditCheck(rules, 1000000, 1000000).status === 'over' && SR.creditCheck(rules, 1000000, 0).status === 'ok', 'the applicant-wide cap counts other active applications');
ok(SR.creditCheck(rules, 1000000).applicantKnown === false && /other active applications/.test(SR.review(rules, prop123, { deal: { mix: { 60: 50 }, place: '' }, claims: {}, thresholds: {}, engine: { annualCredits: 1000000 } }).risks.map((x) => x.text).join(' ')), 'the applicant check stays open until other applications are entered');
// Codex review on 93a02299b: the paired state credit is a fixed amount; failed Versions-table opens are reported.
ok(SR.stateCreditCheck(rules, 650000).status === 'ok' && SR.stateCreditCheck(rules, 600000).status === 'depends' && SR.stateCreditCheck(rules, 700000).status === 'off' && SR.stateCreditCheck(rules, null).status === 'none', 'the paired state credit is checked against the fixed amounts');
ok(/Standard state credit \$700,000 is not the fixed amount/.test(SR.review(rules, prop123, { deal: { mix: { 60: 50 }, place: '', stateCredits: 700000 }, claims: {}, thresholds: {}, engine: {} }).risks.map((x) => x.text).join(' ')), 'an off-amount state credit request is flagged');
ok(/openLatest\(v\)\.then\(function \(ok\) \{ if \(!ok\) flash/.test(read('js/whitepaper/submittal-review.js')), 'a Versions-table open that fails says so');
// Codex review on 758e670d4: the cap uses the request, not modeled capacity; state-credit thresholds are conditional.
{
  const reqBase = { url: 'http://127.0.0.1:8799/d?rate-9=0.09', outputs: { annualCredits: { value: 1900000 } }, inputs: { units: '10', 'units-60': '10' } };
  const blankReq = SR.fromCalculatorExport(reqBase);
  ok(blankReq.requested === null && blankReq.engine.annualCredits === 1900000, 'a blank calculator request stays unknown while modeled capacity is kept');
  const withReq = SR.fromCalculatorExport({ ...reqBase, inputs: { ...reqBase.inputs, 'credit-requested': '1650000', 'state-annual': '650000' } });
  ok(withReq.requested === 1650000 && withReq.stateAnnual === 650000, 'the export\'s request and state credit are read from its inputs');
  const capRev = SR.review(rules, prop123, { deal: { mix: { 60: 10 }, place: '', creditRequested: null }, claims: {}, thresholds: {}, engine: { annualCredits: 1900000 }, calculator: { stale: false } });
  ok(capRev.credit.status === 'unknown', 'modeled capacity alone is not checked against the cap');
  ok(SR.review(rules, prop123, { deal: { mix: { 60: 10 }, place: '', creditRequested: 1900000 }, claims: {}, thresholds: {}, engine: {} }).credit.status === 'over', 'the requested credit is checked against the cap');
  const noState = SR.thresholdStatus(rules, {}, { mix: { 60: 10 } });
  const withState = SR.thresholdStatus(rules, {}, { mix: { 60: 10 }, stateCredits: 650000 });
  const row = (st, id) => st.rows.filter((x) => x.id === id)[0].answer;
  ok(row(noState, 'T15') === 'na' && row(noState, 'T16') === 'na' && row(withState, 'T15') === 'unchecked' && row(withState, 'T16') === 'unchecked', 'state-credit thresholds apply only when state credit is requested');
}
// Codex review on 0d0ddd308: a replacing 4% or non-CHFA export drops the earlier model's credits; failed comparison reads say so.
{
  const src = read('js/whitepaper/submittal-review.js');
  ok(/if \(hadCalc\) \{ v\.deal\.creditRequested = null; v\.deal\.stateCredits = null; \}/.test(src), 'credits from a replaced 9% export are cleared');
  ok(/if \(vs\.some\(function \(x\) \{ return !x; \}\)\) \{ \$\('srCompare'\)\.innerHTML = failed/.test(src) && /function \(\) \{ if \(tok === compareTok\) \$\('srCompare'\)\.innerHTML = failed; \}/.test(src), 'a comparison with an unreadable version shows that instead of a partial table');
}
// The Third Draft strikes the 60% cap on the 40% row (red strikethrough, printed pp. 41-42), so it is not applied.
ok(Math.abs(SR.targetingPoints(rules, { 40: 100 }, '40-60').points - 92.5) < 1e-9 && !rules.targeting.forty_cap && !/sr-subsidy/.test(read('developer-submittal-review.html')), 'the struck 40% row cap is not applied');

// Whole review and summary.
const r = SR.review(rules, prop123, { deal: { mix, place: filed.name }, claims: {}, thresholds: { T3: 'missing' }, engine: { fundingGap: 300000, annualCredits: 1800000 } });
ok(r.risks.some((x) => x.level === 'red' && /threshold/.test(x.text)) && r.risks.some((x) => /cap/.test(x.text)), 'red flags name the missing item and the credit cap');
ok(SR.summaryLines(r).length === 5, 'each version has a five-line summary');
const cmp = SR.compareTable(rules, prop123, [{ label: 'A', deal: { mix }, claims: {} }, { label: 'B', deal: { mix: b.mix }, claims: {} }]);
ok(/sr-diff/.test(cmp) && /AMI midpoint/.test(cmp), 'the comparison highlights changed rows');
ok(!/<script/i.test(SR.compareTable(rules, prop123, [{ label: '<script>x</script>', deal: { mix }, claims: {} }, { label: 'B', deal: { mix }, claims: {} }])), 'labels are escaped');

// Calculator export: the unit mix and results come across; the query is kept, the origin is not.
const exp = SR.fromCalculatorExport({ exportedAt: '2026-10-21T00:00:00Z', url: 'https://cohoanalytics.com/deal-calculator.html?rate-9=0.09&units=60&units-30=6&units-60=24',
  inputs: { units: '60', 'units-30': '6', 'units-40': '12', 'units-50': '18', 'units-60': '24' }, outputs: { fundingGap: { value: 120000 }, dscr: { value: null, unavailableReason: 'x' } } });
ok(exp.mix[30] === 6 && exp.mix[60] === 24 && !exp.mix.market && exp.engine.fundingGap === 120000 && exp.engine.dscr === null, 'an export fills the mix and keeps unavailable results as null');
ok(exp.nine && !/cohoanalytics/.test(exp.query), 'the stress runner gets the settings, not the exporting site');
ok(SR.fromCalculatorExport({ foo: 1 }) === null, 'other JSON is refused');

// Codex review on bbc4a0302: the set-aside election picks the targeting table, the rate value (not the key) says 9%,
// every hard-cost line is stressed, an edited deal sets the export's results aside, and a missing Prop 123 list is "unknown".
const exp4 = SR.fromCalculatorExport({ url: 'http://127.0.0.1:8799/deal-calculator.html?rate-9=0.04&minimum-set-aside=20-50&units=10&units-60=10', inputs: { 'units-60': 10, units: 10 }, outputs: {} });
ok(exp4.nine === false, 'rate-9=0.04 is a 4% export');
ok(exp4.election === '20-50', 'the export carries its set-aside election');
ok(SR.fromCalculatorExport({ url: 'http://127.0.0.1:8799/d?units=1', inputs: { 'rate-9': '0.09', 'minimum-set-aside': 'average-income' }, outputs: {} }).election === 'average-income', 'election read from the export inputs');
const t2050 = SR.targetingPoints(rules, { 50: 20, 60: 80 }, '20-50'), t4060 = SR.targetingPoints(rules, { 50: 20, 60: 80 }, '40-60');
near(t2050.points, 0.2 * 72.5, '20-50: 60% units have no row in the table');
near(t4060.points, 0.2 * 72.5 + 0.8 * 50, '40-60 keeps the 60% row');
ok(rules.targeting.tables['20-50'].rows.indexOf(60) === -1 && rules.targeting.tables['20-50'].page === 41, '20-50 table is sourced and has no 60% row');
ok(SR.score(rules, { mix: { 50: 20, 60: 80 }, election: '20-50' }, {}).lines[0].points < SR.score(rules, { mix: { 50: 20, 60: 80 } }, {}).lines[0].points, 'score uses the election');
const basis = require(path.join(ROOT, 'js/deal-cost-basis.js'));
ok(basis.HARD_COST_IDS.every((id) => SR.HARD_COST_IDS.indexOf(id) !== -1), 'the +10% test covers every canonical hard-cost line');
ok(SR.sameDeal({ mix: { 30: 6, 60: 24, 40: 0 }, election: '40-60' }, { mix: { 30: 6, 60: 24 }, election: '40-60' }), 'an unchanged deal still matches its export');
ok(!SR.sameDeal({ mix: { 30: 7, 60: 24 }, election: '40-60' }, { mix: { 30: 6, 60: 24 }, election: '40-60' }), 'an edited mix no longer matches its export');
ok(!SR.sameDeal({ mix: { 30: 6, 60: 24 }, election: '20-50' }, { mix: { 30: 6, 60: 24 }, election: '40-60' }), 'an edited election no longer matches its export');
const staleReview = SR.review(rules, prop123, { deal: { mix: { 30: 7, 60: 24 } }, claims: {}, thresholds: {}, engine: { fundingGap: 99, annualCredits: 2000000 }, calculator: { stale: true } });
ok(staleReview.engine.fundingGap === undefined && staleReview.credit.status === 'unknown' && /export it again/.test(staleReview.risks.map((x) => x.text).join(' ')), 'a stale export hides its gap and credit and says so');
ok(SR.prop123Status(null, 'Town of Bayfield').status === 'unknown', 'no Prop 123 list means unknown, not "not listed"');
const unk = SR.gapLane(rules, { mix: { 60: 50 } }, SR.prop123Status(null, 'Anywhere'));
ok(unk.lane === 'unknown' && unk.amount === undefined, 'no OEDIT or fallback lane until the Prop 123 list loads');
ok(SR.gapLane(rules, { mix: { 30: 20, 40: 20 } }, SR.prop123Status(null, 'Anywhere')).lane === 'DOH', 'DOH eligibility does not need the Prop 123 list');
ok(/id="sr-election"/.test(read('developer-submittal-review.html')), 'the page has the set-aside election');

// Codex review on b15d1da9e: 70/80% units by election, the midpoint's two readings, the set-aside test, failed device saves.
const wf = { 60: 80, 80: 20 };
ok(SR.mixTotals(wf, '40-60').restricted === 80 && SR.mixTotals(wf, 'average-income').restricted === 100, '80% units are tax credit units only under Average Income');
ok(SR.score(rules, { mix: wf, election: '40-60' }, {}).lines.find((l) => l.id === '5B3a-mixed').status === 'counted', 'a 40-60 deal with 20% workforce units earns the mixed-income points');
const engine = require(path.join(ROOT, 'js/deal-engine.js'));
for (const [el, m] of [['20-50', { 50: 10, 60: 90 }], ['20-50', { 50: 20, 60: 80 }], ['40-60', { 60: 39, market: 61 }], ['40-60', { 60: 40, market: 60 }], ['average-income', { 40: 50, 80: 50 }], ['average-income', { 50: 50, 70: 50 }], ['average-income', { 60: 50, market: 50 }]]) {
  const total = Object.values(m).reduce((a, b) => a + b, 0), byPct = Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'market'));
  ok(SR.setAsideCheck(m, el).qualifies === engine.evaluateMinimumSetAside(el, total, byPct).qualifies, `set-aside test agrees with the Deal Calculator engine (${el} ${JSON.stringify(m)})`);
}
const thin = SR.score(rules, { mix: { 50: 10, 60: 90 }, election: '20-50' }, {});
ok(!thin.primaryOk && !thin.meets && /does not meet the 20-50 election/.test(SR.review(rules, prop123, { deal: { mix: { 50: 10, 60: 90 }, election: '20-50' }, claims: {}, thresholds: {}, engine: {} }).risks[0].text), 'a deal that misses its set-aside is not eligible whatever its points');
const mpMix = SR.amiMidpoint({ 60: 48, market: 12 });
near(mpMix.value, 60, 'midpoint over units with an AMI'); near(mpMix.overTotal, 48, 'midpoint over total units');
const split = SR.gapLane(rules, { mix: { 60: 48, market: 12 } }, { status: 'yes', text: '' });
ok(split.lane === 'unknown' && split.amount === undefined && /Ask CHFA/.test(split.flags.join(' ')), 'when the two midpoint readings straddle 48%, no lane is chosen');
ok(SR.gapLane(rules, { mix: { 60: 50, market: 5 } }, { status: 'yes', text: 'filed' }).lane === 'OEDIT', 'when both readings agree the lane resolves');
const fullStore = SR.makeStore(() => Promise.reject(new Error('offline')), { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } });
let saveErr = null;
await fullStore.save({ name: 'X', data: {} }).catch((e) => { saveErr = e; });
ok(saveErr && /would not keep it/.test(saveErr.message), 'a device save that the browser refuses is reported as not saved');

// Codex review on c733f11cf: no midpoint means no lane, bedroom splits and unticked tiers, conditional "does not apply", blocked storage.
for (const st of [{ status: 'no' }, { status: 'yes', text: '' }]) {
  const l = SR.gapLane(rules, { mix: { market: 20 } }, st);
  ok(l.lane === 'unknown' && l.amount === undefined, 'market units alone give no lane (' + st.status + ')');
}
ok(SR.gapLane(rules, { mix: { market: 20 }, supportive: true }, { status: 'no' }).lane === 'DOH', 'supportive housing still resolves without a midpoint');
const splitExp = SR.fromCalculatorExport({ url: 'http://127.0.0.1:8799/d?rate-9=0.09', outputs: {},
  inputs: { units: '30', 'chk-30': '1', 'units-30': '15', 'units-30-1br': '6', 'units-30-2br': '4', 'chk-60': '1', 'units-60': '20', 'chk-50': '0', 'units-50': '9' } });
ok(splitExp.mix[30] === 10 && splitExp.mix[60] === 20 && !splitExp.mix[50], 'a bedroom split replaces the tier total and an unticked tier counts nothing');
const thNa = SR.thresholdStatus(rules, { T2: 'na', T4: 'na' }, {});
ok(thNa.rows.find((r) => r.id === 'T2').answer === 'unchecked' && thNa.rows.find((r) => r.id === 'T4').answer === 'na', 'only conditional thresholds can be marked as not applying');
const thHtml = SR.formHtml(rules).thresholds;
ok(/data-threshold="T4"[^]*?value="na"/.test(thHtml) && !/data-threshold="T2"><option value="">Not checked<\/option><option value="ready">Ready<\/option><option value="missing">Missing<\/option><option value="na"/.test(thHtml), 'the "Does not apply" choice appears only on conditional thresholds');
ok(/setItem: function \(\) \{ throw new Error\('storage blocked'\); \}/.test(read('js/whitepaper/submittal-review.js')), 'blocked localStorage falls back to a store whose writes fail');

// Codex review on c491541d9: every calculator AMI band, and the active rent schedule.
const hiExp = SR.fromCalculatorExport({ url: 'http://127.0.0.1:8799/d?rate-9=0.09', outputs: {}, inputs: { units: '60', 'units-40': '50', 'units-100': '10' } });
ok(hiExp.mix[100] === 10 && !hiExp.mix.market, '100% AMI units keep their AMI instead of becoming market units');
near(SR.amiMidpoint(hiExp.mix).value, 50, 'a 100% band counts in the midpoint');
const schedExp = SR.fromCalculatorExport({ url: 'http://127.0.0.1:8799/d?rate-9=0.09', outputs: {}, inputs: { units: '40', 'units-60': '40' },
  rentSchedule: { mode: 'schedule', rows: [{ tier: 30, units: 6 }, { tier: 50, units: 20 }, { tier: 50, units: 4 }, { tier: 'market', units: 10 }] } });
ok(schedExp.mix[30] === 6 && schedExp.mix[50] === 24 && schedExp.mix.market === 10 && !schedExp.mix[60], 'an active rent schedule is the unit mix, not the hidden manual grid');
ok(SR.fromCalculatorExport({ url: 'http://127.0.0.1:8799/d', outputs: {}, inputs: { units: '10', 'units-60': '10' }, rentSchedule: { mode: 'manual', rows: [{ tier: 30, units: 99 }] } }).mix[60] === 10, 'a manual-mode export still reads the grid');
ok(['100', '110', '120'].every((t) => read('developer-submittal-review.html').includes('id="sr-mix-' + t + '"')), 'the form has the 100-120% bands');

// Codex review on 5950acd95: a schedule tier outside the form's bands (90%) keeps its AMI.
const s90 = SR.fromCalculatorExport({ url: 'http://127.0.0.1:8799/d?rate-9=0.09', outputs: {}, inputs: {}, rentSchedule: { mode: 'schedule', rows: [{ tier: 40, units: 40 }, { tier: 90, units: 20 }] } });
ok(s90.mix[90] === 20 && !s90.mix.market, 'a 90% schedule row stays a 90% tier');
near(SR.amiMidpoint(s90.mix).value, (40 * 40 + 20 * 90) / 60, '90% units count in the midpoint');
ok(SR.gapLane(rules, { mix: s90.mix }, { status: 'yes', text: 'filed' }).lane === 'OEDIT', 'a 56.67% midpoint takes the OEDIT lane');
ok(SR.mixTotals(s90.mix, '40-60').restricted === 40 && SR.mixTotals(s90.mix, '40-60').total === 60, '90% units are not tax credit units but count in the total');
ok(!SR.sameDeal({ mix: { 40: 40 } }, { mix: s90.mix }), 'dropping the 90% tier makes the export stale');

// Codex review on 09373d457: every imported tier scores.
near(SR.targetingPoints(rules, { 35: 10, 60: 10 }).points, 0.5 * 92.5 + 0.5 * 50, 'a 35% tier earns the 40% row');
ok(SR.eliPoints(rules, { 25: 10, 60: 40 }).units === 10, 'a 25% tier counts as extremely low income');

// Device fallback store saves versions without overwriting.
const mem = {}; const st = SR.makeStore(() => Promise.reject(new Error('offline')), { getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = v; } });
const s1 = await st.save({ name: 'Made-up site', label: 'one', data: { a: 1 } });
const s2 = await st.save({ deal: s1.deal, name: 'Made-up site', label: 'two', data: { a: 2 } });
const vs = await st.versions(s1.deal);
ok(st.mode() === 'device' && vs.versions.length === 2 && s1.v !== s2.v, 'offline saves keep every version on the device');

// ── Page wiring ────────────────────────────────────────────────────────────
const page = read('developer-submittal-review.html');
ok(Nav.PAGES ? Nav.PAGES.some((p) => p.href === 'developer-submittal-review.html') : /developer-submittal-review\.html/.test(read('js/whitepaper/developer-nav.js')), 'the developer menu lists the page');
ok(read('scripts/build-public-site.mjs').includes("'developer-submittal-review.html'"), 'the public build leaves the page out');
ok((read('scripts/audit/public-artifact-guard.mjs').match(/'developer-submittal-review\.html'/g) || []).length === 2, 'the public artifact guard blocks the page and links to it');
ok(/<meta name="robots" content="noindex, nofollow">/.test(page) && page.includes('js/whitepaper/submittal-review.js'), 'the page is noindex and loads its script');
ok(!fs.readdirSync(path.join(ROOT, 'data')).some((f) => /deals?-store|submittal-.*\.json/i.test(f)), 'no saved deals in this repository');
['Fruita', 'Orchard'].forEach((w) => ok(!new RegExp(w, 'i').test(page + read('js/whitepaper/submittal-review.js') + JSON.stringify(rules)), `no ${w} project figures in the page, script or rules`));

// Codex review on f57fbc545: unfiled next-cycle places, imported tiers in the AMI stress, conditional thresholds that apply.
const unfiled = SR.gapLane(rules, { mix: { 50: 10, 60: 40 } }, { status: 'to-confirm', name: 'Test County', text: 'Test County has no 2027-2029 filing.' });
ok(unfiled.lane === 'unknown' && unfiled.amount === undefined && /files a 2027-2029/.test(unfiled.text), 'a place without a 2027-2029 filing gets no OEDIT amount');
ok(SR.gapLane(rules, { mix: { 50: 10, 60: 40 } }, { status: 'yes', text: '' }).lane === 'OEDIT', 'a filed place still gets the OEDIT lane');
const b35 = SR.bumpOneUnit({ 35: 10, 60: 40 });
ok(b35 && b35.from === 35 && b35.to === 40 && b35.mix[35] === 9 && b35.mix[40] === 1, 'the AMI stress moves an imported 35% unit to the next band');
const b45 = SR.bumpOneUnit({ 40: 5, 45: 3, 60: 40 });
ok(b45 && b45.from === 45 && b45.to === 50, 'the AMI stress takes the highest imported tier under 60%');
const thRehab = SR.thresholdStatus(rules, { T4: 'na' }, { rehab: true });
ok(thRehab.rows.find((r) => r.id === 'T4').answer === 'unchecked', 'a rehab deal cannot mark the rehab threshold as not applying');
ok(SR.thresholdStatus(rules, { T4: 'na' }, { rehab: false }).rows.find((r) => r.id === 'T4').answer === 'na', 'new construction can mark it as not applying');
const t17 = rules.thresholds.find((t) => t.applies === 'existing_credit');
if (t17) ok(SR.thresholdStatus(rules, { [t17.id]: 'na' }, { existingCredit: true }).rows.find((r) => r.id === t17.id).answer === 'unchecked', 'an existing-credit deal cannot mark that threshold as not applying');

// Codex review on 0d6fc3d83: election-specific tax credit guidance; "New deal" starts blank.
// The guidance is written from SET_ASIDE; check it against the ceilings and against what the scorer counts.
const note = SR.taxCreditNote();
ok(page.includes('id="sr-mix-note">' + note + '<'), 'the page carries the guidance generated from SET_ASIDE');
for (const [e, c] of Object.entries(SR.SET_ASIDE)) {
  ok(new RegExp((e === 'average-income' ? 'Average Income' : e) + '[^.]*units at or under ' + c.creditCeiling + '% are tax credit units').test(note), 'the note gives the ' + e + ' ceiling of ' + c.creditCeiling + '%');
  ok(SR.mixTotals({ [c.creditCeiling]: 1, [c.creditCeiling + 10]: 1 }, e).restricted === 1, 'the scorer counts tax credit units up to ' + c.creditCeiling + '% under ' + e);
}
ok(/if \(!state\.deal\) clearForm\(\);/.test(read('js/whitepaper/submittal-review.js')) && /function clearForm\(\) \{ state\.version = blankVersion\(\);/.test(read('js/whitepaper/submittal-review.js')), 'choosing "New deal" clears the loaded version');

// Codex review on 596f5ed78: same-name city and county, set-aside in the AMI stress, T17 wording, document reads bound to their version.
const amb = SR.prop123Status(prop123, 'Pueblo');
ok(amb.status === 'ambiguous' && /Pueblo County/.test(amb.text) && /City of Pueblo/.test(amb.text), 'a bare shared name asks for the city or the county');
ok(SR.prop123Status(prop123, 'Pueblo County').status !== 'ambiguous' && SR.prop123Status(prop123, 'City of Pueblo').status !== 'ambiguous', 'a named city or county still resolves');
const ambLane = SR.gapLane(rules, { mix: { 50: 10, 60: 40 } }, amb);
ok(ambLane.lane === 'unknown' && ambLane.amount === undefined, 'an ambiguous place gets no OEDIT amount');
const sa20 = SR.amiStress(rules, prop123, { deal: { mix: { 50: 10, 60: 40 }, election: '20-50' }, claims: {} });
ok(sa20 && sa20.setAsideBefore === true && sa20.setAsideAfter === false && /set-aside election/.test(sa20.fails), 'the AMI stress fails when the set-aside breaks');
const t17r = rules.thresholds.find((t) => t.id === 'T17');
ok(/year 10 or later of Extended Use/.test(t17r.label) && /year 25 or later beginning with the first year/.test(t17r.quote), 'T17 states the year-10 Extended Use test');
ok(/if \(state\.version !== started\)/.test(read('js/whitepaper/submittal-review.js')), 'a file read finished after navigation is not added to another version');

// Codex review on fa7d3aac5: sponsor lines follow the general partner; late reads and deal loads are dropped.
const spFor = SR.score(rules, { mix, sponsor: 'for-profit' }, { '5B4b-pha': true, '5B4a-nonprofit': true });
ok(spFor.lines.filter((l) => /^5B4/.test(l.id)).every((l) => l.status === 'excluded' && l.points === 0), 'a for-profit general partner gets no nonprofit or housing authority points');
const spNp = SR.score(rules, { mix, sponsor: 'nonprofit' }, { '5B4b-pha': true, '5B4a-nonprofit': true });
ok(spNp.lines.find((l) => l.id === '5B4a-nonprofit').points === 5 && spNp.lines.find((l) => l.id === '5B4b-pha').points === 0, 'a nonprofit general partner gets the nonprofit line only');
const spPha = SR.score(rules, { mix, sponsor: 'pha' }, { '5B4b-pha': true });
ok(spPha.lines.find((l) => l.id === '5B4b-pha').points === 7, 'a housing authority general partner gets the housing authority line');
const srcJs = read('js/whitepaper/submittal-review.js');
ok(/var v = started, hadCalc = !!v.calculator;/.test(srcJs) && /was not imported: another deal or version was opened/.test(srcJs), 'a calculator import finished after navigation is dropped');
ok(/if \(state\.deal !== deal\) return; \/\/ another deal was picked/.test(srcJs) && /key = deal \+ '\/' \+ v/.test(srcJs), 'a late version list or version from another deal is dropped');

// Codex review on 9466d2780: an empty place stays unresolved; late saves and version opens are dropped.
const noPlace = SR.prop123Status(prop123, '');
ok(noPlace.status === 'missing', 'an empty town or county is not read as "outside DOLA\'s list"');
const noPlaceLane = SR.gapLane(rules, { mix: { 50: 10, 60: 40 } }, noPlace);
ok(noPlaceLane.lane === 'unknown' && noPlaceLane.amount === undefined && /town or county is entered/.test(noPlaceLane.text), 'no gap-fund amount until the place is entered');
const srcJs2 = read('js/whitepaper/submittal-review.js');
ok(/if \(t !== state\.nav\) return true; openVersion\(rec\)/.test(srcJs2) && !/getVersion\([^)]*\)\.then\(openVersion\)/.test(srcJs2), 'only the latest version open lands');
ok(/if \(state\.nav !== nav \|\| state\.version !== ver\)/.test(srcJs2), 'a save that finishes after navigation does not move the open deal');

// Codex review on e11845a22: an unmatched or unincorporated place stays unresolved; calculator tier counts are whole and non-negative.
const typo = SR.prop123Status(prop123, 'Town of Bayfeld');
ok(typo.status === 'unmatched' && SR.gapLane(rules, { mix: { 50: 10, 60: 40 } }, typo).amount === undefined, 'a misspelled place gets no DOH fallback amount');
ok(SR.prop123Status(prop123, 'Highlands Ranch').status === 'unmatched' && /enter its county/.test(SR.prop123Status(prop123, 'Highlands Ranch').text), 'an unincorporated place asks for its county');
ok(SR.prop123Status(prop123, 'Jackson County').status === 'no', 'a real county not on DOLA\'s list is not eligible');
ok(SR.prop123Status(prop123, 'Lake City').status !== 'unmatched', 'a town whose name ends in "City" still matches');
// Codex review on fc2a5fd1e: "City" inside a CDP's proper name is not a legal form.
const coCity = SR.prop123Status(prop123, 'Colorado City');
ok(coCity.status === 'unmatched' && /enter its county/.test(coCity.text), 'Colorado City CDP asks for its county instead of a spelling check');
const noReg = Object.assign({}, prop123, { places: undefined });
ok(SR.prop123Status(noReg, 'Town of Aguilar').status === 'unmatched', 'without the Census place list an unlisted town stays unresolved');
const normExp = SR.fromCalculatorExport({ url: 'http://127.0.0.1:8799/d?rate-9=0.09', outputs: {}, inputs: { units: '10', 'units-40': '-5', 'units-60': '2.9' } });
ok(!normExp.mix[40] && normExp.mix[60] === 2 && normExp.mix.market === 8, 'calculator tier counts are normalized like the engine');

// Codex review on e11845a22: the 20% band is stressed too.
const b20 = SR.bumpOneUnit({ 20: 30, 60: 70 });
ok(b20 && b20.from === 20 && b20.to === 30, 'the AMI stress moves a 20% unit when it is the only tier under 60%');
const as20 = SR.amiStress(rules, prop123, { deal: { mix: { 20: 30, 60: 70 }, place: filed.name }, claims: {} });
ok(as20 && as20.laneBefore === 'DOH' && as20.laneAfter === 'OEDIT' && /lane flips/.test(as20.fails), 'a 20% bump that crosses 48% shows the lane flip');

// Codex review on 10981b5c7: typed counts are whole and non-negative; 4% exports keep only the mix; skipped stress tests are "Not run".
const srcJs3 = read('js/whitepaper/submittal-review.js');
ok(/d\.mix\[t\] = n > 0 \? Math\.floor\(n\) : 0/.test(srcJs3), 'typed unit counts are normalized to whole, non-negative numbers');
const r4 = SR.review(rules, prop123, { deal: { mix: { 60: 50 }, place: filed.name, calc4: true }, claims: {}, engine: {} });
ok(r4.risks.some((x) => /export was set to 4%/.test(x.text)), 'a 4% export is flagged and its model results are not used');
ok(/v\.calculator = null; v\.engine = \{\};/.test(srcJs3), 'a 4% export does not keep the engine results or enable stress tests');
const skipHtml = SR.stressHtml ? SR.stressHtml(rules, { base: {}, tests: [{ label: 'Loan rate +1.5 points', why: '', note: 'No loan rate entered.', engine: {}, skipped: true, fails: '' }] }) : null;
if (skipHtml) ok(/Not run/.test(skipHtml) && !/Holds/.test(skipHtml), 'a skipped stress test reads "Not run", not "Holds"');
else ok(/t\.skipped \? '<span class="sr-muted">Not run<\/span>'/.test(srcJs3), 'a skipped stress test reads "Not run", not "Holds"');

// Codex review on 99ffe0d29: over-full tier counts, skipped runs in the comparison, rehab and preservation claims.
const over = SR.fromCalculatorExport({ url: 'http://127.0.0.1:8799/d?rate-9=0.09', outputs: {}, inputs: { units: '10', 'units-40': '8', 'units-60': '8' } });
ok(over && over.error && /16 homes in AMI tiers but 10 total/.test(over.error) && !over.mix, 'an export with more tier units than homes is refused');
const cmpSkip = SR.compareTable(rules, prop123, [{ v: 'a', label: 'A', deal: { mix: { 60: 50 } }, claims: {}, stress: [{ fails: '' }, { fails: 'gap opens', skipped: false }, { fails: '', skipped: true }] }]);
ok(/1 of 2 \(1 not run\)/.test(cmpSkip), 'the comparison counts skipped stress tests apart');
const cond = SR.score(rules, { mix }, { '5B3c-rehab': true, '5B3d-preservation': true });
ok(cond.lines.filter((l) => /^5B3[cd]/.test(l.id)).every((l) => l.status === 'excluded' && l.points === 0), 'rehab and preservation points need the rehab and existing-credit flags');
const condOk = SR.score(rules, { mix, rehab: true, existingCredit: true }, { '5B3c-rehab': true, '5B3d-preservation': true });
ok(condOk.lines.find((l) => l.id === '5B3c-rehab').points === 5 && condOk.lines.find((l) => l.id === '5B3d-preservation').points === 15, 'with the flags set the points count');

// Codex review on b35f038b1: a bare name that is a county and a town asks even when only one is on DOLA's list.
ok(SR.prop123Status(prop123, 'Alamosa').status === 'ambiguous' && SR.prop123Status(prop123, 'Kit Carson').status === 'ambiguous', 'Alamosa and Kit Carson ask for the city or town or the county');
ok(SR.prop123Status(prop123, 'Alamosa County').status !== 'ambiguous' && SR.prop123Status(prop123, 'City of Alamosa').status !== 'ambiguous', 'naming the county or the city resolves it');
ok(SR.prop123Status(prop123, 'Lake City').status !== 'ambiguous', 'a town with no same-name county is not ambiguous');
ok(SR.prop123Status(prop123, 'Denver').status !== 'ambiguous' && SR.prop123Status(prop123, 'Broomfield').status !== 'ambiguous', 'the consolidated city and counties are one place');

// Codex review on b35f038b1: 44px compare targets; a late deal-list refresh does not move the selector.
const srcJs4 = read('js/whitepaper/submittal-review.js');
ok(/<label class="sr-pick-wrap"><input type="checkbox" class="sr-pick"/.test(srcJs4) && /\.sr-pick-wrap \{[^}]*min-width: 44px; min-height: 44px/.test(page), 'the compare checkbox has a 44px target');
ok(/\$\('sr-deal'\)\.value = \(state\.nav === nav && selectId\) \|\| state\.deal \|\| '';/.test(srcJs4), 'a late deal-list refresh keeps the deal that is open');

// Codex review on 8b85d2d62: the comparison clears on a deal change; whole housing-need points; no save while a deal opens.
const srcJs5 = read('js/whitepaper/submittal-review.js');
ok(/state\.loading = !!state\.deal;[^\n]*\n\s*drawCompare\(\);/.test(srcJs5), 'changing deals redraws the comparison');
ok(/v\.claims\[id\] = el\.type === 'checkbox' \? el\.checked : \(n > 0 \? Math\.floor\(n\) : null\)/.test(srcJs5), 'typed claim points are whole and non-negative');
ok(/if \(state\.loading \|\| state\.opening\) \{ flash\('Wait for the deal to finish opening/.test(srcJs5) && /if \(state\.deal === deal\) state\.loading = false;/.test(srcJs5), 'saving waits until the picked deal has opened');

// Codex review on 851cbe4f6: rent regime, whole total homes, failed opens, stale comparisons, negative credits.
{
  const base = { inputs: { 'rate-9': '0.09', units: '10', 'units-60': '10' }, outputs: {}, url: 'http://127.0.0.1:8799/deal-calculator.html?rate-9=0.09' };
  const home = SR.fromCalculatorExport({ ...base, inputs: { ...base.inputs, 'rent-limit-regime': 'home_low' } });
  ok(home.nine && home.chfa === false && home.regime === 'Low HOME', 'a 9% export with HOME rents is flagged as non-CHFA');
  ok(SR.fromCalculatorExport(base).chfa === true, 'an export with no rent setting is read as the calculator default, CHFA LIHTC');
  const frac = SR.fromCalculatorExport({ ...base, inputs: { ...base.inputs, units: '10.9' } });
  ok(!frac.mix.market, 'a fractional total-home count does not invent a market-rate home');
}
const srcJs6 = read('js/whitepaper/submittal-review.js');
ok(/v\.deal\.calcRegime = c\.nine && !c\.chfa/.test(srcJs6) && /if \(c\.nine && c\.chfa\)/.test(srcJs6), 'only a 9% CHFA-rent export brings engine results and stress tests');
ok(/\.catch\(function \(e\) \{\s*if \(state\.deal !== deal\) return;\s*clearForm\(\)/.test(srcJs6), 'a failed deal open clears the form before saving is allowed again');
ok(/if \(tok !== compareTok\) return;/.test(srcJs6), 'a superseded comparison read is dropped');
ok(/d\.creditRequested = ac != null && ac >= 0 \? ac : null/.test(srcJs6), 'a negative annual credit entry is not stored');

// Codex review on 733c63730: consolidated city forms, unreadable versions, device-store renames.
for (const q of ['City of Denver', 'Denver County', 'City of Broomfield', 'City and County of Denver']) {
  const st = SR.prop123Status(prop123, q).status;
  ok(st !== 'unmatched' && st !== 'missing' && st !== 'ambiguous', q + ' finds the consolidated city and county record (' + st + ')');
}
const srcJs7 = read('js/whitepaper/submittal-review.js');
ok(/if \(t !== state\.nav\) return true; openVersion\(rec\); return !!rec;/.test(srcJs7) && /openLatest\(pick\)\.then\(function \(ok\) \{ if \(!ok && state\.deal === deal\) \{ clearForm\(\)/.test(srcJs7), 'a version that reads as empty clears the form on a deal pick');
ok(/d\.name = body\.name;/.test(srcJs7), 'saving on this device keeps a renamed deal\'s new name');

// Codex review on 017fa683c: ownership-mode exports are refused before any unit mix is applied.
ok(!!SR.fromCalculatorExport({ dealMode: 'ownership', inputs: { units: '12' }, outputs: {}, url: 'http://127.0.0.1:8799/deal-calculator.html' }).error, 'an ownership-mode export is refused');
ok(!SR.fromCalculatorExport({ dealMode: 'rental', inputs: { 'rate-9': '0.09', units: '10', 'units-60': '10' }, outputs: {}, url: 'http://127.0.0.1:8799/deal-calculator.html' }).error, 'a rental-mode export still imports');

// Codex review on 966fa921d: a stale "Does not apply" is reset in the form; Save waits for a version open.
const srcJs8 = read('js/whitepaper/submittal-review.js');
ok(/if \(el\.value === 'na' && rule && \(!rule\.applies \|\| applies\)\) el\.value = '';/.test(srcJs8), 'ticking a condition clears its "Does not apply" answer in the form and the saved version');
ok(/state\.opening = t;/.test(srcJs8) && /if \(state\.loading \|\| state\.opening\)/.test(srcJs8), 'saving waits while a version is opening');

// Codex review on 966fa921d: a stress run with no gap and no coverage is "Not run", not "Holds".
const srcJs9 = read('js/whitepaper/submittal-review.js');
ok(/else if \(e\.fundingGap == null && e\.dscr == null\) \{[\s\S]{0,300}skipped: true/.test(srcJs9), 'a stress run the calculator could not compute is not counted as holding');

console.log(`submittal-review: ${checks} checks passed`);
