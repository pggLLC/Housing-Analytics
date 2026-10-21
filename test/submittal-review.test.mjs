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
ok(SR.targetingPoints(rules, { 60: 10, 80: 10 }).points === 25, 'units over 60% earn no targeting points but count in the total');

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
ok(SR.prop123Status(prop123, 'Nowhere Junction').status === 'no', 'an unlisted place is not eligible');

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
ok(SR.creditCheck(rules, 1750000).status === 'over' && SR.creditCheck(rules, 1600000).status === 'ok', 'the 9% credit cap is checked');

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

console.log(`submittal-review: ${checks} checks passed`);
