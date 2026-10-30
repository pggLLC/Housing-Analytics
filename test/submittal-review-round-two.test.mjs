// Round Two (federal 4% with accelerated and standard state credit) on the gated Submittal review page:
// its rules file (data/policy/chfa-2027-r2-scoring.json) and the 4% path in js/whitepaper/submittal-review.js.
// Run: node test/submittal-review-round-two.test.mjs
// Uses a made-up deal; no client or project figures belong in this repository.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SR = require(path.join(ROOT, 'js/whitepaper/submittal-review.js'));
const r1 = JSON.parse(read('data/policy/chfa-2027-r1-scoring.json'));
const r2 = JSON.parse(read('data/policy/chfa-2027-r2-scoring.json'));
const prop123 = JSON.parse(read('data/policy/prop123_jurisdictions.json'));

let checks = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } checks++; };
const risksOf = (r) => r.risks.map((x) => x.text).join(' ');

// ── Rules file ──────────────────────────────────────────────────────────────
ok(SR.ROUNDS.r1 === 'data/policy/chfa-2027-r1-scoring.json' && SR.ROUNDS.r2 === 'data/policy/chfa-2027-r2-scoring.json', 'each round has its own rules file');
ok(r1.round.id === 'r1' && r1.round.federal === '9' && r2.round.id === 'r2' && r2.round.federal === '4', 'each rules file names its round and federal rate');
ok(r2.status === r1.status && r2.source.url === r1.source.url, 'Round Two cites the same QAP, with the same status');
ok(new Date().toISOString().slice(0, 10) <= r2.review_by, 'the Round Two rules are past their review-by date: re-check CHFA\'s QAP page and re-copy');
ok(r2.round.loi_due === '2027-06-01' && r2.round.application_due === '2027-08-02' && /June 1, 2027/.test(r2.round.quote) && /August 2, 2027/.test(r2.round.quote), 'Round Two dates match the quote');
ok(r2.minimum_score.points === 115 && /minimum of 115 points/.test(r2.minimum_score.quote), 'the 115-point minimum is quoted');
const sourced = (l) => typeof l.quote === 'string' && l.quote.length > 20 && Number.isInteger(l.page) && l.page > 0;
ok(r2.lines.every(sourced) && r2.thresholds.every(sourced), 'every Round Two line and threshold has a quote and a page');
const eu = r2.lines.find((l) => l.id === '5A2-extended-use');
ok(eu.auto === 'extended_use_choice' && eu.options['15'] === 25 && eu.options['25'] === 40 && /25 points/.test(eu.quote) && /40 points/.test(eu.quote), 'extended use is 25 points for 15 years and 40 for 25, as quoted');
ok(/minimum extended-use period of 15 years/.test(eu.quote_minimum) && /competitive state credit/.test(eu.unconfirmed), 'the 15- versus 25-year question is quoted and flagged');
ok(!r2.thresholds.some((t) => t.id === 'T18') && /exempted for Round Two/.test(r2.threshold_18_quote.quote), 'Threshold #18 is left out, with the exemption quoted');
ok(['T15', 'T16'].every((id) => { const t = r2.thresholds.find((x) => x.id === id); return t && !t.applies; }), 'the state credit thresholds always apply in Round Two');
const cc = r2.credit_caps;
ok(cc.accelerated_fixed_annual === 1000000 && cc.standard_max_annual === 675000 && /fixed amount of \$1,000,000 in 2027/.test(cc.quote) && /up to \$675,000 in 2027/.test(cc.quote), 'Round Two state credit amounts match the quote');
ok(cc.without_pilot.accelerated_fixed_annual === 1100000 && cc.without_pilot.standard_max_annual === 800000 && /\$1,100,000 in 2027/.test(cc.without_pilot.quote) && /up to \$800,000/.test(cc.without_pilot.quote), 'the 3.L.1 amounts match the quote');
const g = r2.gap_pilot;
ok(g.doh.per_unit === 35000 && g.doh.max === 3200000 && /\$35,000 per unit and a maximum of \$3\.2 million/.test(g.doh.quote), 'DOH Round Two amounts match the quote');
ok(g.oedit.per_unit === 30000 && g.oedit.max === 2600000 && /\$30,000 per unit and a maximum of \$2\.6 million/.test(g.oedit.quote), 'OEDIT Round Two amounts match the quote');
ok(g.doh.midpoint_max === 52 && /52% or below for Round Two/.test(g.doh.eligibility_quote), 'the Round Two DOH midpoint line matches the quote');
ok(JSON.stringify(r2.targeting) === JSON.stringify(r1.targeting) && JSON.stringify(r2.eli_targeting) === JSON.stringify(r1.eli_targeting), 'targeting is scored the same in both rounds');

// ── Scoring ─────────────────────────────────────────────────────────────────
const deal = { mix: { 30: 6, 50: 20, 60: 24 }, place: '', election: '40-60' };
const base = SR.score(r2, deal, {}, {});
const euLine = base.lines.find((l) => l.id === '5A2-extended-use');
ok(euLine.points === 25 && euLine.possible === 40 && euLine.status === 'counted', 'unchosen, extended use counts the 15-year minimum (25 points)');
ok(base.minimum === 115, 'Round Two scores against 115');
ok(base.addable.some((a) => a.id === '5A2-extended-use' && a.points === 15), 'electing 25 years shows as 15 points to add');
const longer = SR.score(r2, deal, { '5A2-extended-use': 25 }, {});
ok(longer.lines.find((l) => l.id === '5A2-extended-use').points === 40 && longer.total - base.total === 15, 'electing 25 years adds 15 points');
ok(!longer.addable.some((a) => a.id === '5A2-extended-use'), 'nothing is left to add once 25 years are elected');
ok(SR.score(r2, deal, {}, { T14: 'missing' }).lines.find((l) => l.id === '5A2-extended-use').points === 0, 'a missing extended-use election earns no points');
ok(SR.score(r1, deal, {}, {}).lines.find((l) => l.id === '5A2-extended-use').points === 40, 'Round One still counts the required 25-year election');

// ── State credit ────────────────────────────────────────────────────────────
ok(SR.roundTwoStateCheck(r2, 1000000, 675000).status === 'depends' && SR.roundTwoStateCheck(r2, 1000000, 675000).basis === 'pilot' && SR.roundTwoStateCheck(r2, 1000000, 675000).standardStatus === 'ok', 'the pilot amounts pass, flagged to confirm');
ok(SR.roundTwoStateCheck(r2, 1100000, 800000).basis === 'no_pilot' && SR.roundTwoStateCheck(r2, 1100000, 800000).standardStatus === 'depends', 'the 3.L.1 amounts depend on pilot funds');
ok(SR.roundTwoStateCheck(r2, 1300000, null).status === 'off' && SR.roundTwoStateCheck(r2, 1000000, 900000).standardStatus === 'over', 'other amounts are flagged');
const rev = (d, extra) => SR.review(r2, prop123, Object.assign({ round: 'r2', deal: Object.assign({}, deal, d), claims: {}, thresholds: {}, engine: {} }, extra || {}));
ok(/not the fixed amount CHFA accepts in Round Two/.test(risksOf(rev({ stateCredits: 1300000 }))), 'an off accelerated amount is a red flag');
ok(/over the Round Two limit/.test(risksOf(rev({ stateCredits: 1000000, stateStandard: 900000 }))), 'a standard amount over both limits is a red flag');
ok(/without accelerated state credit/.test(risksOf(rev({ stateStandard: 500000 }))), 'standard credit alone is a red flag');
ok(/No accelerated state credit entered/.test(risksOf(rev({}))), 'a blank state credit request is noted');
const fedOnly = rev({ creditRequested: 2500000 });
ok(fedOnly.credit.status === 'na' && !/cap \(QAP 3\.L/.test(risksOf(fedOnly)), 'the 9% federal credit cap is not applied to a 4% deal');
ok(/set to 9%/.test(risksOf(rev({ calc9: true, calc4: false }))) && !/set to 4%/.test(risksOf(rev({ calc4: true, calc9: false }))), 'a 9% export is the mismatch in Round Two, not a 4% one');
ok(/saved on the Round One \(9%\) review/.test(risksOf(SR.review(r2, prop123, { deal, claims: {}, thresholds: {}, engine: {} }))), 'a version saved before rounds existed is flagged as Round One');
ok(!/saved on the/.test(risksOf(rev({}))), 'a Round Two version is not flagged');
ok(SR.review(r2, prop123, { round: 'r2', deal: { mix: { 50: 60 }, place: '' }, claims: {}, thresholds: {}, engine: {} }).lane.lane === 'DOH', 'the Round Two DOH line (52%) is used for the gap-fund lane');
const lane = SR.gapLane(r2, { mix: { 50: 100 }, supportive: false, applicant: 'nonprofit' }, null);
ok(lane.amount === 3200000 && lane.capped, 'DOH Round Two money is capped at $3.2 million');

// ── Calculator export and page ──────────────────────────────────────────────
const exp = SR.fromCalculatorExport({ url: 'http://127.0.0.1:8799/d?rate-9=0.04', inputs: { units: '10', 'units-60': '10', 'state-annual': '1000000', 'state-standard-annual': '675000' }, outputs: {} });
ok(exp.nine === false && exp.stateAnnual === 1000000 && exp.stateStandard === 675000, 'a 4% export brings its accelerated and standard state credit');
const html = read('developer-submittal-review.html');
ok(/id="srRoundNav"/.test(html) && /href="\?round=r2"/.test(html) && /id="sr-state-standard"/.test(html), 'the page links to Round Two and has the paired standard credit field');
ok(/<label for="sr-state-standard" hidden>/.test(html), 'the paired standard field stays hidden on Round One');
const f = SR.formHtml(r2);
ok(/data-claim="5A2-extended-use"[^>]*data-default="15"/.test(f.claims) && /25 years \(40 points\)/.test(f.claims), 'Round Two asks for the extended-use term');
ok(!/data-threshold="T18"/.test(f.thresholds), 'Round Two does not ask for Threshold #18');

console.log('submittal-review-round-two: ' + checks + ' checks passed');
