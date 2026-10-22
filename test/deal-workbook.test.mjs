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
  ok(x.allowance === null && x.headroom === null, x.tier + '% ' + x.bedrooms + ' is left unchecked while the allowance is not set, not checked against $0');
});
const ownerPays = mut0((s) => { s.utilityAllowance = { applied: true, method: 'owner_pays_all', perBedroom: { efficiency: 0, '1BR': 0, '2BR': 0, '3BR': 0, '4BR': 0 } }; });
ok(ownerPays.rents.rows.every((x) => x.allowance === 0 && x.headroom === x.limit - x.rent) && !/did not apply a utility allowance/.test(ownerPays.findings.map((f) => f.text).join('\n')), 'owner pays all checks each rent against the full limit');

// A utility allowance comes off the limit: the calculator keys it 'efficiency', '1BR', '2BR'...
const withUa = mut0((s) => { s.utilityAllowance = { applied: true, perBedroom: { efficiency: 60, '1BR': 80, '2BR': 100, '3BR': 120, '4BR': 140 } }; });
ok(withUa.rents.rows.every((x) => x.headroom === x.limit - x.allowance - x.rent), 'room under the limit is limit less allowance less rent');
ok(withUa.rents.rows.every((x) => x.allowance === 100 && x.headroom === x.limit - 100 - x.rent), 'a 2BR utility allowance comes off each 2BR limit');
const withFees = mut0((s) => { s.utilityAllowance = { applied: true, perBedroom: { efficiency: 60, '1BR': 80, '2BR': 100, '3BR': 120, '4BR': 140 }, feesPerBedroom: { '2BR': 25 } }; });
ok(withFees.rents.rows.every((x) => x.headroom === x.limit - 125 - x.rent), 'tenant-paid fees come off the limit with the allowance');
const feeOver = mut0((s) => { s.utilityAllowance = { applied: true, perBedroom: { '2BR': 100 }, feesPerBedroom: { '2BR': 25 } }; s.result.pricedRows.find((x) => x.tier === 60 && x.bedrooms === '2BR').contractRent = 1500; });
ok(/less \$100 utility allowance less \$25 in resident-paid fees\)/.test(feeOver.findings.map((f) => f.text).join('\n')), 'an over-limit rent names the resident-paid fees taken off the limit');
ok(/no tax credits to lay out/.test(mut0((s) => { s.result.chfaRegime = false; s.rentLimits = { regime: 'home_high' }; }).error || ''), 'a non-tax-credit rent regime is turned away');
const oldSched = mut0((s) => { s.utilityAllowance = { applied: false, reason: 'included_in_schedule_rents' }; s.rentSchedule = { mode: 'schedule', sourceMeta: { tableYear: 2024, effectiveDate: '2024-05-01' } }; });
ok(oldSched.rentLimits.year === 2024 && /Rent limits are the 2024 tables/.test(oldSched.findings.map((f) => f.text).join('\n')), 'schedule rents carry the limit table they were priced from');
const withMarket = mut0((s) => { s.result.pricedRows.push({ tier: 'market', bedrooms: '2BR', units: 4, rent: 1900 }); });
const mrow = withMarket.rents.rows.find((x) => x.tier === 'market');
ok(mrow.rent === 1900 && mrow.annual === 1900 * 4 * 12 && /Market rate/.test(WB.render(withMarket)) && !/market%/.test(WB.render(withMarket)), 'market-rate rows show their rent');
const nullSrc = mut0((s) => { s.permanentFinancing.hardMortgages[0].principal = null; });
ok(!/<td class="sr-num">0%<\/td>/.test(WB.render(nullSrc)), 'an unknown source amount shows no share, not 0%');
const noLoans = mut0((s) => { s.result.obligations = { loans: [], unavailableReason: 'Enter the senior loan rate.' }; });
ok(/Loan details are not available: Enter the senior loan rate\./.test(WB.render(noLoans)), 'a missing loan schedule says why');
const sched = mut0((s) => { s.utilityAllowance = { applied: false, reason: 'included_in_schedule_rents' }; });
ok(sched.rentsFromSchedule && sched.rents.rows.every((x) => x.headroom == null), 'schedule rents are not re-checked against a zero allowance');
ok(/ok: Rents come from the Market Analysis rent schedule/.test(sched.findings.map((f) => f.level + ': ' + f.text).join('\n')) && !/did not apply a utility allowance/.test(sched.findings.map((f) => f.text).join('\n')), 'schedule rents raise no owner-pays-utilities warning');
const noRent = mut0((s) => { s.result.unavailable = Object.assign({}, s.result.unavailable, { annualRents: 'AMI limits did not load.' }); s.result.pricedRows.forEach((p) => { p.contractRent = null; }); });
ok(/AMI limits did not load\./.test(WB.render(noRent)) && /<table/.test(WB.render(noRent)), 'the rent reason shows even when row shells exist');
ok(/bad: 30% AMI 2BR rent of \$774 is \$100 over/.test(withUa.findings.map((f) => f.level + ': ' + f.text).join('\n')), 'a gross-limit rent with tenant-paid utilities is over the limit');
const uaGap = mut0((s) => { s.utilityAllowance = { applied: true, perBedroom: { '1BR': 80 } }; });
ok(uaGap.rents.rows.every((x) => x.allowance === null && x.headroom === null), 'an allowance missing for a size leaves that row unchecked, not checked against $0');

// ── Findings ───────────────────────────────────────────────────────────────
const texts = (mm) => mm.findings.map((f) => f.level + ': ' + f.text).join('\n');
ok(/bad: The deal is \$[\d,]+ short/.test(texts(m)), 'a funding gap is a finding');
ok(/warn: The Deal Calculator did not apply a utility allowance \(allowance_reference_missing\), so each rent is an upper bound/.test(texts(m)), 'an unset utility allowance is called out with its reason');
const uaText = mut0((s) => { s.utilityAllowance = { applied: false, reason: 'allowance_bedroom_missing:2BR', reasonText: 'Utility allowance missing for bedroom size (2BR)' }; });
ok(/\(Utility allowance missing for bedroom size \(2BR\)\)/.test(texts(uaText)), 'the calculator\'s own wording for the reason is shown');
ok(/warn: CHFA HTF is modeled interest-only to maturity/.test(texts(m)), 'an interest-only loan is called out');
ok(/ok: Debt coverage on all must-pay debt stays at or above 1\.20x/.test(texts(m)), 'coverage above CHFA\'s minimum is "already right"');
ok(m.findings.findIndex((f) => f.level === 'ok') > m.findings.findIndex((f) => f.level === 'bad'), 'problems come before what is already right');

// Sabotage: each guard fires when its figure is pushed past CHFA's line, and not before.
const mut = (fn) => { const s = fixture(); fn(s); return WB.build(s, rules); };
// Every line below is read from CHFA's rules file, so a change to an adopted minimum moves the test with it.
const R = rules.rules, $m = WB.money, p1 = (v) => (v * 100).toFixed(1) + '%', x2 = (v) => v.toFixed(2) + 'x';
const PUPA = R.pupa_minimum.per_unit_annual, PUPA8 = R.pupa_minimum.per_unit_annual_section8, TAX = 900;
const opexCase = (opex, tax) => texts(mut((s) => { s.result.operatingSummary.perUnitYear = opex; s.result.propTaxPerUnit = tax; }));
ok(opexCase(PUPA - 600 - TAX, TAX).includes(`bad: Operating cost plus property tax of ${$m(PUPA - 600)} a unit is under CHFA's ${$m(PUPA)}`), 'operating cost plus tax under the minimum is flagged');
ok(!/Operating cost/.test(opexCase(PUPA8 - TAX, TAX)), 'property tax counts toward both minimums');
ok(opexCase(PUPA - 500, null).includes(`warn: Operating cost of ${$m(PUPA - 500)} a unit is under CHFA's ${$m(PUPA)} minimum before property tax`), 'without the tax, a low cost is a question, not a failure');
const exempt = mut((s) => { s.result.operatingSummary.perUnitYear = PUPA - 300; s.result.propTaxPerUnit = TAX; s.result.netPropTax = 0; });
ok(exempt.operating.taxPerUnit === 0 && texts(exempt).includes(`bad: Operating cost of ${$m(PUPA - 300)} a unit is under`), 'a tax exemption is counted: the net tax, not the gross input');
ok(opexCase(PUPA + 100 - TAX, TAX).includes(`warn: Operating cost plus property tax of ${$m(PUPA + 100)} a unit meets CHFA's ${$m(PUPA)} minimum but not the ${$m(PUPA8)}`), 'a cost between the two minimums is flagged for Section 8');
ok(!/Operating cost/.test(opexCase(PUPA8 - TAX, TAX)), 'operating cost plus tax at the Section 8 minimum is not flagged');
const VAC = R.pro_forma_vacancy.rate, RG = R.pro_forma_rent_growth.rate, EG = R.pro_forma_expense_growth.rate;
ok(texts(mut((s) => { s.result.vacancyRate = VAC - 0.02; })).includes(`warn: Vacancy of ${p1(VAC - 0.02)}`), 'vacancy under CHFA\'s rate is flagged');
ok(texts(mut((s) => { s.result.exit.rentGrowth = RG + 0.01; })).includes(`warn: Rents grow ${p1(RG + 0.01)}`), 'rent growth over CHFA\'s rate is flagged');
ok(texts(mut((s) => { s.result.exit.expGrowth = EG - 0.01; })).includes(`warn: Costs grow ${p1(EG - 0.01)}`), 'cost growth under CHFA\'s rate is flagged');
const FAM = R.replacement_reserve_minimum.family_per_unit_annual, SEN = R.replacement_reserve_minimum.senior_per_unit_annual;
ok(texts(mut((s) => { s.result.repReservePerUnit = SEN - 50; })).includes(`bad: Replacement reserve of ${$m(SEN - 50)}`), 'a reserve under CHFA\'s minimum is flagged');
ok(texts(mut((s) => { s.result.repReservePerUnit = (FAM + SEN) / 2; })).includes(`warn: Replacement reserve of ${$m((FAM + SEN) / 2)} a unit is under CHFA's ${$m(FAM)} family minimum (it meets the ${$m(SEN)} senior minimum`), 'a reserve between the two minimums is a question about the deal type, not a failure');
ok(/warn: Debt coverage was measured for 5 of the first 15 years/.test(texts(mut((s) => { s.result.coverage.years = s.result.coverage.years.slice(0, 5); }))) && !/ok: Debt coverage/.test(texts(mut((s) => { s.result.coverage.years = s.result.coverage.years.slice(0, 5); }))), 'a five-year projection never passes coverage');
ok(/warn: Debt coverage was measured for 14 of/.test(texts(mut((s) => { s.result.coverage.years[9].unavailableReason = 'x'; }))), 'a year with unknown debt service blocks the coverage pass');
ok(/ok: Debt coverage on all must-pay debt stays at or above/.test(texts(m)), 'fifteen measured years pass coverage');
const long = mut((s) => { const y = JSON.parse(JSON.stringify(s.result.coverage.years[14])); y.year = 35; y.allMustPayCoverage = 0.97; s.result.coverage.years.push(y); s.result.coverage.weakestAllMustPay = { year: 35, ratio: 0.97 }; });
ok(long.exec.weakest.year <= 15 && !/year 35/.test(texts(long)), 'a weak year 35 does not count against the 15-year coverage test');
const DS = R.min_debt_coverage.min_coverage, HI = R.high_coverage_credit_reduction.threshold;
ok(texts(mut((s) => { s.result.coverage.years[2].allMustPayCoverage = DS - 0.05; })).includes(`bad: Debt coverage on all must-pay debt falls to ${x2(DS - 0.05)} in year 3`), 'coverage under CHFA\'s minimum is flagged with its year');
ok(texts(mut((s) => { s.result.projection.rows[0].dscr = HI + 0.05; })).includes(`warn: Year-one coverage of ${x2(HI + 0.05)}`), 'year-one coverage over CHFA\'s high-coverage line is flagged');
ok(!/Year-one coverage/.test(texts(m)), 'year-one coverage of 1.20 is not flagged');
ok(/bad: 60% AMI 2BR rent of \$1,600 is over its \$1,549 gross limit before any utility allowance, by at least \$51/.test(texts(mut((s) => { s.result.pricedRows.find((x) => x.tier === 60).contractRent = 1600; }))), 'a rent over its gross limit is flagged even with the allowance unset');
const noPay = mut((s) => { s.result.exit.dfYr = null; s.result.projection.rows.forEach((y) => { y.deferredFeePaid = 10000; }); });
ok(/bad: The deferred fee is not paid off in 15 years: \$610,000 of \$760,000/.test(texts(noPay)), 'an unpaid deferred fee is flagged with what is still owed');
ok(/\$610,000 still owed at year 15/.test(WB.render(noPay)) && !/paid off<\/div>/.test(WB.render(noPay)), 'the fee tile calls an unpaid fee owed, not paid off');
const unknownFee = mut((s) => { s.result.exit.dfYr = null; s.result.projection.rows[4].deferredFeePaid = null; s.result.projection.rows[4].unavailableReason = 'loan matured'; });
ok(/warn: Whether the deferred fee is paid off in 15 years is not known: year 5 is not projected \(loan matured\)/.test(texts(unknownFee)) && !/Not in 15 yrs/.test(WB.render(unknownFee)), 'an incomplete cash flow leaves the fee payoff unknown, not unpaid');
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
ok(!noRules.error && !/CHFA's/.test(texts(noRules).replace(/CHFA HTF/g, '').replace(/warn: CHFA's underwriting rules did not load[^\n]*/, '')), 'without the rules file, nothing is compared against a CHFA minimum');
ok(/warn: CHFA's underwriting rules did not load/.test(texts(noRules)) && !/Nothing in the figures needs a second look/.test(WB.render(noRules)), 'without the rules file, the workbook says the CHFA checks were not run');
{
  const html = WB.render(m);
  const tables = html.match(/<table[^>]*>/g);
  ok(/id="wbCF"|Cash flow/.test(html) && tables.length >= 5, 'the workbook has its statement tables');
  ok((html.match(/<table class="sr-table" data-no-sort>/g) || []).length >= 4, 'sources, uses, operating and cash flow statements opt out of sorting');
}
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
ok(WB.queryFrom('https://example.com/search?q=housing') === null && WB.queryFrom('https://example.com/a=b') === null, 'a link to another page gives nothing');
ok(WB.queryFrom('?units=60') === 'units=60' && WB.queryFrom('units=60') === 'units=60' && WB.queryFrom('/deal-calculator?units=60') === 'units=60', 'a bare query string or the calculator path still gives its settings');
ok(WB.queryFrom('just some text') === null && WB.queryFrom({}) === null, 'anything else gives nothing');

// ── Gating ─────────────────────────────────────────────────────────────────
const page = read('developer-deal-workbook.html');
ok(/<meta name="robots" content="noindex, nofollow">/.test(page) && /js\/developer-gate\.js/.test(page), 'the page is noindex and carries the developer gate');
ok(Nav.PAGES ? Nav.PAGES.some((p) => p.href === 'developer-deal-workbook.html') : /developer-deal-workbook\.html/.test(read('js/whitepaper/developer-nav.js')), 'the developer menu lists the page');
ok(read('scripts/build-public-site.mjs').includes("'developer-deal-workbook.html'"), 'the public build leaves the page out');
ok((read('scripts/audit/public-artifact-guard.mjs').match(/'developer-deal-workbook\.html'/g) || []).length === 2, 'the public artifact guard blocks the page and links to it');

// ── Waiting for the calculator ─────────────────────────────────────────────
// A fake frame whose output never changes: it may only count as settled once no data request is in flight.
function fakeFrameDoc(win) {
  let onload = null;
  const frame = { style: {}, setAttribute() {}, remove() {}, addEventListener(e, fn) { if (e === 'load') onload = fn; }, contentWindow: win };
  return { baseURI: 'http://localhost/a/p.html', createElement: () => frame, body: { appendChild: () => setTimeout(() => onload(), 0) } };
}
{
  let pending = 1;
  const win = { __DealCalc: { getResult: () => ({}), getOutputRecords: () => [1] }, __dealCalcPendingFetches: () => pending };
  const t0 = Date.now();
  setTimeout(() => { pending = 0; }, 120);
  await WB.loadFrame(fakeFrameDoc(win), 'units=1', 5000, 10);
  ok(Date.now() - t0 >= 120, 'the workbook waits for the calculator\'s data requests before reading it');
  let removed = false, failed = null;
  const stuck = fakeFrameDoc({ __DealCalc: { getResult: () => ({}), getOutputRecords: () => [1] }, __dealCalcPendingFetches: () => 1 });
  const fr = stuck.createElement(); fr.remove = () => { removed = true; };
  await WB.loadFrame(stuck, 'units=1', 60, 10).catch((e) => { failed = e; });
  ok(failed && removed, 'a calculator that never settles is removed when the wait times out');
  // A frame that never fires load still times out and is removed.
  let gone = false, hung = null;
  const neverLoads = { baseURI: 'http://localhost/a/p.html', body: { appendChild() {} },
    createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, remove() { gone = true; } }) };
  await WB.loadFrame(neverLoads, 'units=1', 50, 10).catch((e) => { hung = e; });
  ok(hung && gone, 'a calculator page that never loads times out and is removed');
  ok(/__dealCalcPendingFetches/.test(read('deal-calculator.html')) && read('deal-calculator.html').indexOf('__dealCalcPendingFetches') < read('deal-calculator.html').indexOf('js/path-resolver.js'), 'the calculator counts its data requests from its first script');
}

// ── Unknown versus none ────────────────────────────────────────────────────
const feeUnknown = mut0((s) => { s.result.deferredDevFee = null; s.result.unavailable = Object.assign({}, s.result.unavailable, { deferredDevFee: 'Operating inputs are incomplete.' }); });
ok(/Deferred fee: not known, Operating inputs are incomplete\./.test(WB.render(feeUnknown)) && !/No deferred developer fee/.test(WB.render(feeUnknown)), 'an unknown deferred fee is shown as unknown with its reason, not as none');
ok(/warn: The deferred developer fee is not known: Operating inputs are incomplete\./.test(feeUnknown.findings.map((f) => f.level + ': ' + f.text).join('\n')), 'an unknown deferred fee is a finding');
const feeNone = mut0((s) => { s.result.deferredDevFee = 0; });
ok(/No deferred developer fee/.test(WB.render(feeNone)), 'a zero deferred fee still reads as none');
const noItems = mut0((s) => { const b = s.result.budget; Object.keys(b.groups).forEach((k) => { b.groups[k] = 0; }); b.itemized = 0; b.notItemized = s.result.tdc; });
ok(noItems.uses.rows.length === 0 && /Not itemized/.test(WB.render(noItems)), 'a budget with nothing itemized shows its Not itemized line');

// ── Signed gap and a payoff after the exit hold ────────────────────────────
const surplus = mut0((s) => { s.result.fundingGap = 0; s.result.gap = -50000; });
ok(surplus.exec.gap === -50000 && /ok: Sources exceed costs by \$50,000/.test(surplus.findings.map((f) => f.level + ': ' + f.text).join('\n')) && /\$50,000<\/div>Surplus: sources exceed costs/.test(WB.render(surplus)), 'a surplus is reported from the signed gap');
const shortHold = mut0((s) => { s.result.exit.dfYr = null; s.result.deferredDevFee = 100000; s.result.projection.rows.forEach((y) => { y.deferredFeePaid = 10000; }); });
ok(shortHold.exec.paybackYear === 10 && !/Not in 15 yrs/.test(WB.render(shortHold)), 'a payoff after a short exit hold but by year 15 is found from the cash flow');

const residue = mut0((s) => { s.result.exit.dfYr = null; s.result.deferredDevFee = 100000; s.result.projection.rows.forEach((y, i) => { y.deferredFeePaid = i === 9 ? 10000 - 7.45e-9 : 10000; }); });
ok(residue.exec.paybackYear === 10, 'a floating-point residue on a paid fee still counts as paid');
const noCalcCredit = mut0((s) => { s.result.costBasis.basis.calculatedCredit = null; });
ok(noCalcCredit.basis.rate === null, 'an unavailable calculated credit leaves the credit rate unknown, not 0%');

const noEquity = mut0((s) => { s.permanentFinancing.taxCredit.nine = null; s.result.unavailable = Object.assign({}, s.result.unavailable, { annualCredits: 'Eligible basis is incomplete.' }); });
ok(noEquity.sources.rows.some((x) => x.amount === null && /Federal 9% credit equity: not known, Eligible basis is incomplete\./.test(x.label)), 'an unsized federal credit stays in the sources as unknown, with the reason');
ok(!mut0((s) => { s.permanentFinancing.taxCredit.four = null; }).sources.rows.some((x) => /4% credit/.test(x.label)), 'the other credit type is not listed for a 9% deal');

const stateOpen = mut0((s) => { s.permanentFinancing.taxCredit.state = null; s.result.costBasis.stateCredit = { entered: true, reason: 'Enter the state credit price.' }; });
ok(stateOpen.sources.rows.some((x) => x.amount === null && /Colorado state credit equity: not known, Enter the state credit price\./.test(x.label)), 'an entered but unsized state credit stays in the sources as unknown');
ok(!mut0((s) => { s.permanentFinancing.taxCredit.state = null; }).sources.rows.some((x) => /state credit/.test(x.label)), 'no state credit row when none is entered');
const opsGone = mut0((s) => { s.result.operatingSummary.perUnitYear = null; s.result.operatingSummary.reason = 'Enter the insurance line.'; s.result.repReservePerUnit = null; s.result.vacancyRate = null; s.result.exit.rentGrowth = null;
  s.result.unavailable = Object.assign({}, s.result.unavailable, { repReservePerUnit: 'Enter the reserve.', vacancyRate: 'Enter vacancy.', 'exit.rentGrowth': 'Enter growth rates.' }); });
const og = opsGone.findings.map((f) => f.level + ': ' + f.text).join('\n');
ok(og.includes("warn: CHFA's operating cost check did not run: Enter the insurance line.") && og.includes("warn: CHFA's replacement reserve check did not run: Enter the reserve.") &&
  og.includes("warn: CHFA's vacancy check did not run: Enter vacancy.") && og.includes("warn: CHFA's rent growth check did not run: Enter growth rates."), 'each CHFA check that could not run says so, with the engine\'s reason');
ok(!texts(mut0((s) => { s.result.operatingSummary.perUnitYear = PUPA8 + 500; s.result.propTaxPerUnit = null; s.result.netPropTax = null; })).includes("CHFA's operating cost plus property tax check did not run"), 'a cost that alone meets the Section 8 minimum passes whatever the tax');
ok(texts(mut0((s) => { s.result.operatingSummary.perUnitYear = (PUPA + PUPA8) / 2; s.result.propTaxPerUnit = null; s.result.netPropTax = null; })).includes("CHFA's operating cost plus property tax check did not run"), 'a missing tax between the two minimums still says the full check did not run');
ok(!/check did not run/.test(texts(m)), 'a complete deal has no skipped checks');

const addOut = mut0((s) => { s.permanentFinancing.taxCredit.added = 0; s.result.creditStack = { federal: 1, state: 0, added: 0, label: 'Transformational Housing credit', counted: false, reason: 'Transformational Housing credit is not counted in the sources: Enter the program year.' }; });
ok(addOut.sources.rows.some((x) => x.amount === null && /Transformational Housing credit: not counted, Transformational Housing credit is not counted in the sources: Enter the program year\./.test(x.label)), 'an added credit the engine left out stays in the sources with its reason');
ok(!m.sources.rows.some((x) => /not counted/.test(x.label)), 'no added-credit row when none is entered');
const covGone = mut0((s) => { s.result.coverage.years.forEach((y) => { y.allMustPayCoverage = null; y.seniorCoverage = null; y.unavailableReason = 'NOI is unavailable for loan payments.'; }); s.result.unavailable = Object.assign({}, s.result.unavailable); delete s.result.unavailable.coverage; });
ok(covGone.coverage.reason === 'NOI is unavailable for loan payments.' && /warn: Debt coverage is not available: NOI is unavailable for loan payments\./.test(texts(covGone)), 'coverage with no measurable year carries the row reason into a finding');

const matured = texts(mut((s) => { s.result.coverage.years.slice(9).forEach((y) => { y.allMustPayCoverage = null; y.seniorCoverage = null; y.unavailableReason = 'Loan maturity requires a repayment or refinancing assumption.'; }); }));
ok(/warn: Debt coverage was measured for 9 of the first 15 years .*later years are not measured: Loan maturity requires a repayment or refinancing assumption\./.test(matured) && !/project 15 years/.test(matured), 'partial coverage names the row reason, not the horizon, when all 15 rows exist');
ok(/set the calculator to project 15 years\./.test(texts(mut((s) => { s.result.coverage.years = s.result.coverage.years.slice(0, 5); }))), 'a short projection still asks for 15 years');
const hist = mut0((s) => { s.permanentFinancing.historic = [{ id: 'h1', program: 'historic_tc', amount: 400000 }, { id: 'h2', program: 'historic_tc', amount: null }]; s.permanentFinancing.taxCredit.historic = null; });
ok(hist.sources.rows.some((x) => x.label === 'Historic credit equity' && x.amount === 400000) && hist.sources.rows.some((x) => x.amount === null && /Historic credit equity: not known/.test(x.label)), 'a historic tranche without an amount stays in the sources as unknown');

const noMort = mut0((s) => { s.permanentFinancing.hardMortgages.forEach((h) => { if (h.source === 'senior') h.principal = null; }); s.result.mortgage = null; s.result.unavailable = Object.assign({}, s.result.unavailable, { mortgage: 'Operating inputs are incomplete.' }); });
ok(noMort.sources.rows.some((x) => x.amount === null && x.label === 'First mortgage: not known, Operating inputs are incomplete.'), 'an unsized first mortgage keeps the engine reason');
ok(m.sources.rows.some((x) => x.label === 'First mortgage' && x.amount > 0), 'a sized first mortgage keeps its plain label');
const blankGov = mut0((s) => { s.permanentFinancing.government = [{ id: 'g1', program: null, label: 'County loan', amount: null }]; });
ok(blankGov.sources.rows.some((x) => x.amount === null && x.label === 'County loan: not known, enter the amount'), 'a classified source with no amount says so');
const stopped = mut0((s) => { s.result.costBasis.basis.reasons = { eligibleBasis: 'Confirm the building purchase meets 26 U.S.C. 42(d)(2).' }; s.result.costBasis.basis.qualifiedBasis = null; });
ok(stopped.basis.stopReason && /warn: Eligible and qualified basis were not fully calculated: Confirm the building purchase/.test(texts(stopped)) && WB.render(stopped).includes('Basis not fully calculated'), 'a stopped basis calculation says why');
ok(!m.basis.stopReason && !/not fully calculated/.test(texts(m)), 'a complete basis has no stop reason');
const ungrouped = mut0((s) => { s.permanentFinancing.unclassified = [{ id: 'u1', program: null, label: 'Foundation loan', amount: 250000, reason: "Choose where this source counts in DOH's layout." }]; });
ok(ungrouped.sources.rows.some((x) => x.amount === 250000 && x.label === "Foundation loan: not yet grouped, Choose where this source counts in DOH's layout."), 'a source with no DOH group keeps its reason');

const noMustPay = mut0((s) => { s.result.coverage.years.forEach((y) => { y.allMustPayCoverage = null; y.seniorCoverage = null; y.unavailableReason = null; }); s.result.unavailable = Object.assign({}, s.result.unavailable); delete s.result.unavailable.coverage; delete s.result.unavailable.allMustPayDSCR; });
ok(!noMustPay.coverage.full && noMustPay.coverage.known15 === 0 && /warn: Debt coverage is not available: Coverage requires positive must-pay debt service\./.test(texts(noMustPay)), 'null ratios with no row reason count as unmeasured and say why');

const VAC8 = R.pro_forma_vacancy.rate_full_section8;
ok(texts(mut((s) => { s.result.vacancyRate = VAC8 - 0.01; })).includes(`bad: Vacancy of ${p1(VAC8 - 0.01)} is under CHFA's ${Math.round(VAC * 100)}% minimum and under the ${Math.round(VAC8 * 100)}%`), 'vacancy under the Section 8 floor fails');
ok(texts(mut((s) => { s.result.vacancyRate = (VAC + VAC8) / 2; })).includes(`warn: Vacancy of ${p1((VAC + VAC8) / 2)}`) && !/bad: Vacancy/.test(texts(mut((s) => { s.result.vacancyRate = (VAC + VAC8) / 2; }))), 'vacancy between the two floors is a question');
const never = new Promise(() => {});
ok((await WB.settleWithin(never, 20)) === null, 'a stalled rules request settles as null');
ok((await WB.settleWithin(Promise.resolve({ a: 1 }), 1000)).a === 1 && (await WB.settleWithin(Promise.reject(new Error('x')), 1000)) === null, 'settled requests pass through, failures become null');

const gapGone = WB.render(mut0((s) => { s.result.gap = null; s.result.fundingGap = null; s.result.unavailable = Object.assign({}, s.result.unavailable, { fundingGap: 'Operating inputs are incomplete.' }); }));
const gapTile = gapGone.split('Funding gap: Operating inputs are incomplete.')[0].split('<div').slice(-2).join('<div');
ok(gapGone.includes('Funding gap: Operating inputs are incomplete.') && !/sr-ok|sr-bad/.test(gapTile), 'an unknown funding gap gets no pass or fail colour');

const fiveYr = mut0((s) => { s.result.projection.years = 5; });
ok(fiveYr.cashFlow.rows.length === 5 && fiveYr.cashFlow.rows[4].year === 5, 'the cash flow stops at the calculator\'s forecast horizon');
ok(WB.render(fiveYr).includes('>5-year cash flow</h2>') && !WB.render(fiveYr).includes('15-year cash flow'), 'the cash flow heading names the forecast horizon');
const withAm = mut0((s) => { s.result.projection.rows.forEach((y) => { y.assetMgmtFee = 7500; y.cashFlow = y.cashFlow == null ? null : y.cashFlow - 7500; }); });
const amHtml = WB.render(withAm);
ok(withAm.cashFlow.rows[0].assetMgmt === 7500 && amHtml.includes('Asset management fee paid') && amHtml.includes('-$7,500'), 'asset management fees paid show between debt service and cash flow');
ok(!WB.render(m).includes('Bridge loan payments'), 'a deduction the deal does not have is left out');

const shortLoan = mut0((s) => { s.result.projection.years = 5; const l = s.result.obligations.loans.find((x) => x.senior); l.maturity = 10; l.rows[9].maturityDue = 2800000; l.rows[4].balance = 3100000; });
const sl = shortLoan.loans.find((l) => l.label === 'First mortgage');
ok(sl.balloon == null && sl.balance15 === 3100000 && !/matures in year 10/.test(texts(shortLoan)) && WB.render(shortLoan).includes('Owed after year 5'), 'loan balances and balloons stop at the forecast horizon');

{
  const els = {}, el = (id) => els[id] || (els[id] = { id, innerHTML: '', textContent: '', value: '', hidden: true, files: [], handlers: {}, addEventListener(t, f) { this.handlers[t] = f; } });
  const doc = { getElementById: el, baseURI: 'https://example.org/developer-deal-workbook.html', querySelectorAll: () => [] };
  const saved = { fetch: globalThis.fetch, window: globalThis.window };
  globalThis.fetch = () => Promise.reject(new Error('offline'));
  globalThis.window = { addEventListener() {} };
  WB.start(doc);
  el('wbOut').innerHTML = '<p>Deal A</p>'; el('wbPrint').hidden = false; el('wbOpenCalc').hidden = false;
  el('wbLink').value = 'https://example.org/not-a-share-link';
  el('wbOpenLink').handlers.click();
  ok(el('wbOut').innerHTML === '' && el('wbPrint').hidden && el('wbOpenCalc').hidden && /no Deal Calculator settings/.test(el('wbStatus').textContent), 'an invalid new input clears the last deal and its print button');
  await new Promise((r) => setTimeout(r, 0));
  ok(/team site only/.test(el('wbDeals').innerHTML), 'a refused saved-deal list says the deals are on the team site');
  // A saved version that fails to load clears the last deal too.
  el('wbOut').innerHTML = '<p>Deal A</p>'; el('wbPrint').hidden = false;
  el('wbDeals').value = 'd1'; el('wbDeals').selectedOptions = [{ textContent: 'Deal B' }]; el('wbVersions').value = '3';
  el('wbOpenSaved').handlers.click();
  await new Promise((r) => setTimeout(r, 0));
  ok(el('wbOut').innerHTML === '' && el('wbPrint').hidden && /That version did not load/.test(el('wbStatus').textContent), 'a saved version that fails clears the last deal');
  // A saved version whose request never answers says it is loading, then that it did not load.
  globalThis.fetch = () => new Promise(() => {});
  for (const k of Object.keys(els)) els[k].handlers = {};
  WB.start(doc, 30);
  el('wbOpenSaved').handlers.click();
  ok(/Loading that saved version/.test(el('wbStatus').textContent), 'a saved version says it is loading');
  await new Promise((r) => setTimeout(r, 60));
  ok(/That version did not load/.test(el('wbStatus').textContent), 'a saved version that never answers times out and says so');
  ok(/Saved deals did not load/.test(el('wbDeals').innerHTML), 'a saved-deal list that never answers times out and says so');
  globalThis.fetch = saved.fetch; if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
}
const feeOpen = mut0((s) => { s.permanentFinancing.deferredDevFee = null; s.result.unavailable = Object.assign({}, s.result.unavailable, { deferredDevFee: 'Operating inputs are incomplete.' }); });
ok(feeOpen.sources.rows.some((x) => x.amount === null && x.label === 'Deferred developer fee: not known, Operating inputs are incomplete.'), 'an unknown deferred fee stays in the sources with its reason');

{
  // The calculator's request counter: a response counts until its body has arrived, not just its headers.
  const html = read('deal-calculator.html');
  const src = html.slice(html.indexOf('window.__dealCalcPendingFetches') > -1 ? html.lastIndexOf('<script>', html.indexOf('window.__dealCalcPendingFetches')) + 8 : 0, html.indexOf('</script>', html.indexOf('window.__dealCalcPendingFetches')));
  let release;
  const body = new ReadableStream({ start(c) { release = () => { c.enqueue(new TextEncoder().encode('{"a":1}')); c.close(); }; } });
  const win = { fetch: () => Promise.resolve(new Response(body)) };
  new Function('window', src)(win);
  const res = await win.fetch('data/big.json');
  await new Promise((r) => setTimeout(r, 0));
  ok(win.__dealCalcPendingFetches() === 1, 'a request whose body is still downloading still counts as pending');
  release();
  const parsed = await res.json();
  await new Promise((r) => setTimeout(r, 0));
  ok(parsed.a === 1 && win.__dealCalcPendingFetches() === 0, 'the request stops counting once its body has arrived, and the page can still read it');
}
const badBudget = mut0((s) => { s.result.budget.reason = 'Line 4 has no amount.'; });
ok(badBudget.uses.rows.length === 0 && badBudget.uses.reason === 'Line 4 has no amount.', 'a budget the engine could not read shows its reason, not partial groups');

console.log(`deal-workbook: ${checks} checks passed`);
