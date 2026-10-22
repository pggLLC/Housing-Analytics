// The gated Deal workbook page (developer-deal-workbook.html, js/whitepaper/deal-workbook.js).
// Run: node test/deal-workbook.test.mjs
// The fixture is an INVENTED deal captured from the Deal Calculator engine (its default inputs plus an
// invented interest-only soft loan). No client or project figures belong in this repository.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const WB = require(path.join(ROOT, 'js/whitepaper/deal-workbook.js'));
const Nav = (() => { const g = {}; new Function('window', 'document', read('js/whitepaper/developer-nav.js'))(g, undefined); return g.DeveloperNav || g; })();
const rules = JSON.parse(read('data/policy/lihtc-underwriting-rules.json'));
const fixture = () => JSON.parse(read('test/fixtures/deal-workbook/invented-deal.json'));

let checks = 0;
const mut0 = (fn) => { const s = fixture(); fn(s); return WB.build(s, rules); };
const ok = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } checks++; };
const near = (a, b, msg) => ok(a != null && Math.abs(a - b) < 0.5, msg + ` (${a} vs ${b})`);

ok(/INVENTED/.test(fixture()._note), 'the fixture says it is invented');

// ── The workbook repeats the engine; it never recalculates ──────────────────
const snap = fixture();
const r = snap.result;
const m = WB.build(snap, rules);
ok(!m.error, 'an invented rental deal builds');
near(m.exec.credit, r.annualCredits, 'yearly credit is the engine\'s');
near(m.exec.gap, r.fundingGap, 'funding gap is the engine\'s');
ok(m.exec.weakest && m.exec.weakest.year === r.coverage.weakestAllMustPay.year && m.exec.weakest.ratio === r.coverage.weakestAllMustPay.ratio, 'weakest coverage is the engine\'s all-must-pay figure');
ok(m.exec.paybackYear === r.exit.dfYr, 'deferred fee payback year is the engine\'s');
ok(m.cashFlow.rows.length === 15, 'the cash flow runs 15 years');
r.projection.rows.slice(0, 15).forEach((y, i) => {
  near(m.cashFlow.rows[i].noi, y.noi, 'year ' + y.year + ' NOI is the engine\'s');
  near(m.cashFlow.rows[i].cashFlow, y.cashFlow, 'year ' + y.year + ' cash flow is the engine\'s');
});
// Deferred fee owed falls by what each year pays, and reaches zero in the payback year.
const pay = m.exec.paybackYear;
ok(pay != null && m.cashFlow.rows[pay - 1].feeOwed === 0 && m.cashFlow.rows[pay - 2].feeOwed > 0, 'the fee balance reaches zero in the payback year, not before');
near(m.cashFlow.rows[0].feeOwed, r.deferredDevFee - r.projection.rows[0].deferredFeePaid, 'year-1 fee balance is the fee less year-1 payment');

// Sources add to the engine's total; uses add to total development cost.
const srcSum = m.sources.rows.reduce((s, x) => s + x.amount, 0);
near(srcSum, snap.permanentFinancing.totals.totalSources, 'sources add to the engine\'s total sources');
near(m.sources.total + m.sources.gap, m.sources.tdc, 'sources plus gap equal total development cost');
near(m.uses.rows.reduce((s, x) => s + x.amount, 0) + (m.uses.notItemized || 0), m.uses.tdc, 'uses add to total development cost');
ok(m.sources.rows.some((x) => /CHFA HTF/.test(x.label)) && !m.sources.rows.some((x) => /^Source \(/.test(x.label)), 'a soft source is named by its program');

// Rent roll: every row is checked against its CHFA gross limit for that size and tier.
ok(m.rents.rows.length === r.pricedRows.length, 'every priced row is in the rent roll');
m.rents.rows.forEach((x) => {
  ok(x.limit === snap.amiByBr[x.tier][x.bedrooms.toLowerCase()], x.tier + '% ' + x.bedrooms + ' limit is CHFA\'s for that size');
  ok(x.headroom === x.limit - x.allowance - x.rent, x.tier + '% ' + x.bedrooms + ' room under the limit is limit less allowance less rent');
});

// A utility allowance comes off the limit: the calculator keys it 'efficiency', '1BR', '2BR'...
const withUa = mut0((s) => { s.utilityAllowance = { applied: true, perBedroom: { efficiency: 60, '1BR': 80, '2BR': 100, '3BR': 120, '4BR': 140 } }; });
ok(withUa.rents.rows.every((x) => x.allowance === 100 && x.headroom === x.limit - 100 - x.rent), 'a 2BR utility allowance comes off each 2BR limit');
ok(/bad: 30% AMI 2BR rent of \$774 is \$100 over/.test(withUa.findings.map((f) => f.level + ': ' + f.text).join('\n')), 'a gross-limit rent with tenant-paid utilities is over the limit');
const uaGap = mut0((s) => { s.utilityAllowance = { applied: true, perBedroom: { '1BR': 80 } }; });
ok(uaGap.rents.rows.every((x) => x.allowance === null && x.headroom === null), 'an allowance missing for a size leaves that row unchecked, not checked against $0');

// ── Findings ───────────────────────────────────────────────────────────────
const texts = (mm) => mm.findings.map((f) => f.level + ': ' + f.text).join('\n');
ok(/bad: The deal is \$[\d,]+ short/.test(texts(m)), 'a funding gap is a finding');
ok(/warn: No utility allowance is applied/.test(texts(m)), 'no utility allowance is called out');
ok(/warn: CHFA HTF is modeled interest-only to maturity/.test(texts(m)), 'an interest-only loan is called out');
ok(/ok: Debt coverage on all must-pay debt stays at or above 1\.20x/.test(texts(m)), 'coverage above CHFA\'s minimum is "already right"');
ok(m.findings.findIndex((f) => f.level === 'ok') > m.findings.findIndex((f) => f.level === 'bad'), 'problems come before what is already right');

// Sabotage: each guard fires when its figure is pushed past CHFA's line, and not before.
const mut = (fn) => { const s = fixture(); fn(s); return WB.build(s, rules); };
ok(/bad: Operating cost of \$4,000/.test(texts(mut((s) => { s.result.operatingSummary.perUnitYear = 4000; }))), 'operating cost under $4,500 is flagged');
ok(!/Operating cost of/.test(texts(mut((s) => { s.result.operatingSummary.perUnitYear = 4500; }))), 'operating cost at $4,500 is not flagged');
ok(/warn: Vacancy of 5\.0%/.test(texts(mut((s) => { s.result.vacancyRate = 0.05; }))), 'vacancy under 7% is flagged');
ok(/warn: Rents grow 3\.0%/.test(texts(mut((s) => { s.result.exit.rentGrowth = 0.03; }))), 'rent growth over 2% is flagged');
ok(/warn: Costs grow 2\.0%/.test(texts(mut((s) => { s.result.exit.expGrowth = 0.02; }))), 'cost growth under 3% is flagged');
ok(/bad: Replacement reserve of \$250/.test(texts(mut((s) => { s.result.repReservePerUnit = 250; }))), 'a reserve under CHFA\'s minimum is flagged');
ok(/bad: Replacement reserve of \$325 a unit is under CHFA's \$350 family minimum \(it meets the \$300 senior minimum/.test(texts(mut((s) => { s.result.repReservePerUnit = 325; }))), 'a $325 reserve is held to the family minimum');
ok(/warn: Debt coverage was measured for 5 of the first 15 years/.test(texts(mut((s) => { s.result.coverage.years = s.result.coverage.years.slice(0, 5); }))) && !/ok: Debt coverage/.test(texts(mut((s) => { s.result.coverage.years = s.result.coverage.years.slice(0, 5); }))), 'a five-year projection never passes coverage');
ok(/warn: Debt coverage was measured for 14 of/.test(texts(mut((s) => { s.result.coverage.years[9].unavailableReason = 'x'; }))), 'a year with unknown debt service blocks the coverage pass');
ok(/ok: Debt coverage on all must-pay debt stays at or above/.test(texts(m)), 'fifteen measured years pass coverage');
ok(/bad: Debt coverage on all must-pay debt falls to 1\.10x in year 3/.test(texts(mut((s) => { s.result.coverage.weakestAllMustPay = { year: 3, ratio: 1.1 }; }))), 'coverage under 1.15 is flagged with its year');
ok(/warn: Year-one coverage of 1\.35x/.test(texts(mut((s) => { s.result.projection.rows[0].dscr = 1.35; }))), 'year-one coverage over 1.30 is flagged');
ok(!/Year-one coverage/.test(texts(m)), 'year-one coverage of 1.20 is not flagged');
ok(/bad: 60% AMI 2BR rent of \$1,600 is \$51 over/.test(texts(mut((s) => { s.result.pricedRows.find((x) => x.tier === 60).contractRent = 1600; }))), 'a rent over its limit is flagged');
const noPay = mut((s) => { s.result.exit.dfYr = null; s.result.projection.rows.forEach((y) => { y.deferredFeePaid = 10000; }); });
ok(/bad: The deferred fee is not paid off in 15 years: \$610,000 of \$760,000/.test(texts(noPay)), 'an unpaid deferred fee is flagged with what is still owed');
const unknownFee = mut((s) => { s.result.exit.dfYr = null; s.result.projection.rows[11].deferredFeePaid = null; s.result.projection.rows[11].unavailableReason = 'loan matured'; });
ok(/warn: Whether the deferred fee is paid off in 15 years is not known: year 12 is not projected \(loan matured\)/.test(texts(unknownFee)) && !/Not in 15 yrs/.test(WB.render(unknownFee)), 'an incomplete cash flow leaves the fee payoff unknown, not unpaid');
const balloon = mut((s) => { const l = s.result.obligations.loans.find((x) => x.senior); l.maturity = 10; l.rows[9].maturityDue = 2800000; l.rows.slice(10).forEach((x) => { x.balance = null; }); });
ok(/warn: First mortgage matures in year 10 with \$2,800,000 due/.test(texts(balloon)), 'a balloon inside 15 years is read from the maturity-year row');
const late = mut((s) => { s.result.exit.dfYr = 20; s.result.projection.rows.forEach((y) => { y.deferredFeePaid = 10000; }); });
ok(late.exec.paybackYear == null && /bad: The deferred fee is not paid off in 15 years: .*\(paid off in year 20\)/.test(texts(late)), 'a payoff in year 20 counts as unpaid in the 15-year workbook');
ok(/does not cover|for-sale|rental tax credit/.test(mut((s) => { s.mode = 'ownership'; }).error || ''), 'an ownership-mode deal is turned away');
const withOwner = mut0((s) => { s.permanentFinancing.owner = [{ id: 'sponsor_loan', program: 'sponsor_loan', amount: 250000 }]; s.permanentFinancing.totals.totalSources += 250000; });
near(withOwner.sources.rows.reduce((t, x) => t + x.amount, 0), withOwner.sources.total, 'owner equity is listed, so sources still add to the total');
const io = mut((s) => { const l = s.result.obligations.loans.find((x) => !x.senior); l.type = 'amortizing'; });
ok(!/interest-only/.test(texts(io)), 'an amortizing soft loan raises no interest-only note');

// Unknowns stay unknown: no rules file means no CHFA comparisons, never a comparison against 0.
const noRules = WB.build(fixture(), null);
ok(!noRules.error && !/CHFA's/.test(texts(noRules).replace(/CHFA HTF/g, '')), 'without the rules file, nothing is compared against a CHFA minimum');
const blank = mut((s) => { s.result.fundingGap = null; s.result.unavailable.fundingGap = 'Select a county to load AMI rent limits.'; });
ok(blank.exec.gap === null && /Funding gap is not available: Select a county/.test(texts(blank)), 'an unavailable gap carries its reason, not $0');
ok(!!WB.build({ result: null }, rules).error, 'no engine result is an error, not an empty workbook');

// ── Render ─────────────────────────────────────────────────────────────────
const html = WB.render(m, 'Invented test deal');
['Executive view', 'Sources and uses', 'Eligible basis and credits', 'Rents by AMI tier', 'Operating costs and assumptions', 'Loans', '15-year cash flow'].forEach((h) => ok(html.includes(h), 'the workbook has "' + h + '"'));
ok(html.indexOf('Executive view') < html.indexOf('Sources and uses'), 'executive view comes first');
ok(!/NaN|undefined/.test(html), 'no NaN or undefined on the page');
ok(WB.render(mut((s) => { s.result.fundingGap = null; }), '').includes('Funding gap:'), 'a missing gap shows its reason in the tile');
ok(!/<script/i.test(WB.render(m, '<script>x</script>')), 'a deal name is escaped');

// ── Opening a deal ─────────────────────────────────────────────────────────
ok(WB.queryFrom('https://cohoanalytics.com/deal-calculator.html?county-select=08067&units=60#x') === 'county-select=08067&units=60', 'a share link gives its settings');
ok(WB.queryFrom({ url: 'http://localhost/deal-calculator.html?units=60' }) === 'units=60', 'an export file gives its settings');
ok(WB.queryFrom({ data: { calculator: { query: 'units=12' } } }) === 'units=12', 'a saved Submittal review version gives its settings');
ok(WB.calcUrl('units=60&county-select=08067', 'http://localhost/a/developer-deal-workbook.html') === 'http://localhost/a/deal-calculator.html?units=60&county-select=08067', 'the calculator link stays on the same folder');
ok(WB.calcUrl('"><script>x</script>&units=1', 'http://localhost/a/p.html').indexOf('<') === -1, 'pasted markup is encoded, never passed through');
ok(new URL(WB.calcUrl('javascript:alert(1)', 'http://localhost/a/p.html')).protocol === 'http:', 'a pasted script link cannot change where the link goes');
ok(WB.queryFrom('just some text') === null && WB.queryFrom({}) === null, 'anything else gives nothing');

// ── Gating ─────────────────────────────────────────────────────────────────
const page = read('developer-deal-workbook.html');
ok(/<meta name="robots" content="noindex, nofollow">/.test(page) && /js\/developer-gate\.js/.test(page), 'the page is noindex and carries the developer gate');
ok(Nav.PAGES ? Nav.PAGES.some((p) => p.href === 'developer-deal-workbook.html') : /developer-deal-workbook\.html/.test(read('js/whitepaper/developer-nav.js')), 'the developer menu lists the page');
ok(read('scripts/build-public-site.mjs').includes("'developer-deal-workbook.html'"), 'the public build leaves the page out');
ok((read('scripts/audit/public-artifact-guard.mjs').match(/'developer-deal-workbook\.html'/g) || []).length === 2, 'the public artifact guard blocks the page and links to it');

console.log(`deal-workbook: ${checks} checks passed`);
