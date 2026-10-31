// The application tie-out on the gated Submittal review page: js/whitepaper/submittal-tieout.js, its
// limits in data/policy/chfa-2027-r*-scoring.json ("tie_out"), and how js/whitepaper/submittal-review.js uses it.
// Run: node test/submittal-tieout.test.mjs
// Uses a made-up deal; no client or project figures belong in this repository.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const T = require(path.join(ROOT, 'js/whitepaper/submittal-tieout.js'));
const SR = require(path.join(ROOT, 'js/whitepaper/submittal-review.js'));
const r1 = JSON.parse(read('data/policy/chfa-2027-r1-scoring.json'));
const r2 = JSON.parse(read('data/policy/chfa-2027-r2-scoring.json'));
const prop123 = JSON.parse(read('data/policy/prop123_jurisdictions.json'));

let checks = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } checks++; };

// ── Rules ───────────────────────────────────────────────────────────────────
ok(JSON.stringify(r1.tie_out) === JSON.stringify(r2.tie_out), 'both rounds use the same tie-out limits');
const fee = r1.tie_out.developer_fee;
ok(fee.page === 36 && /3\.M\.3/.test(fee.section) && /Developer Fee and Consultant Fee/.test(fee.quote), 'the fee limit cites QAP 3.M.3, p. 36');
ok(/minus the cost of land, developer fees, consultant fees, and project reserves/.test(fee.base_quote) && /Fifty percent of Acquisition cost/.test(fee.acquisition_quote), 'the fee base is quoted');
ok(fee.tiers.length === 2 && fee.tiers[0].min_units === 51 && fee.tiers[0].pct === 0.12 && fee.tiers[1].max_units === 50 && fee.tiers[1].pct === 0.15 && /51 units or more, 12%; 50 units or less, 15%/.test(fee.tiers_text), '12% at 51 homes or more, 15% at 50 or fewer');
ok(fee.boost_max_pct === 0.05 && /up to 5 percent/.test(fee.boost_quote), 'the supportive housing increase is up to 5 points');
ok(r1.tie_out.credit_amount.page === 33 && /smallest of the amounts/.test(r1.tie_out.credit_amount.quote), 'the credit amount rule cites QAP 3.M.1, p. 33');
ok(r1.underwriting.dcr_min === 1.15 && r2.underwriting.dcr_min === 1.15, 'both rounds keep the 1.15 coverage minimum');

// ── A made-up 40-home deal, matched figure for figure ───────────────────────
const engine = { totalDevelopmentCost: 16000000, eligibleBasis: 13500000, annualCredits: 1200000, equityPrice: 0.85, creditEquity: 10200000,
  stateCreditEquity: null, firstMortgage: 3000000, annualDebtService: 210000, dscr: 1.22, developerFee: 1600000, deferredDeveloperFee: 300000,
  annualRents: 520000, annualOperatingExpenses: 240000, annualReserves: 14000, fundingGap: 0 };
const mix = { 30: 4, 50: 16, 60: 20 };
const base = { deal: { mix, election: '40-60', place: '' }, claims: {}, thresholds: {}, engine, calculator: { mix, election: '40-60', stale: false } };
const app = { homes: 40, tdc: 16000000, basis: 13500000, credit: 1200000, price: 0.85, equity: 10200000, mortgage: 3000000, debtService: 210000, dscr: 1.22,
  fee: 1600000, consultant: 0, deferred: 300000, land: 600000, acquisition: 0, reserves: 400000, rents: 520000, opex: 240000, repReserve: 14000, gap: 0 };
const v = (a, extra) => Object.assign({}, base, { tieout: { app: a, ref: {} } }, extra || {});
const row = (res, id) => res.rows.find((r) => r.id === id);

const clean = T.check(r1, v(app), engine);
ok(clean.counts.red === 0 && clean.counts.yellow === 0, 'a matching application has no flags');
ok(clean.rows.filter((r) => !r.feeInput && r.id !== 'stateEquity').every((r) => r.flag === 'green'), 'every compared figure matches');
ok(row(clean, 'homes').model === 40, 'model homes come from the export\'s unit mix');
ok(row(clean, 'stateEquity').flag === 'open', 'a figure the application leaves blank stays open');
ok(clean.fee.status === 'ok' && clean.fee.pct === 0.15 && clean.fee.base === 16000000 - 600000 - 1600000 - 400000, 'fee base = cost less land, fees and reserves; 15% at 40 homes');

// Tolerances
ok(row(T.check(r1, v({ ...app, tdc: 16150000 }), engine), 'tdc').flag === 'green', 'cost within 1% matches');
ok(row(T.check(r1, v({ ...app, tdc: 16300000 }), engine), 'tdc').flag === 'yellow', 'cost 1.9% over differs');
ok(/\$300,000 \(1\.9%\) higher than the model/.test(row(T.check(r1, v({ ...app, tdc: 16300000 }), engine), 'tdc').notes[0]), 'the difference is spelled out');
ok(row(T.check(r1, v({ ...app, price: 0.86 }), engine), 'price').flag === 'green' && row(T.check(r1, v({ ...app, price: 0.87 }), engine), 'price').flag === 'yellow', 'equity price matches within one cent');
ok(row(T.check(r1, v({ ...app, homes: 41 }), engine), 'homes').flag === 'yellow', 'one home off differs');
ok(row(T.check(r1, v({ ...app, deferred: 300900 }), engine), 'deferred').flag === 'green', 'deferred fee has a $1,000 floor');
ok(row(T.check(r1, v({ ...app, opex: 244000 }), engine), 'opex').flag === 'green' && row(T.check(r1, v({ ...app, opex: 250000 }), engine), 'opex').flag === 'yellow', 'operations match within 2%');

// Deal breakers
const credit = row(T.check(r1, v({ ...app, credit: 1300000 }), engine), 'credit');
ok(credit.flag === 'red' && /\$100,000 a year more than the model supports/.test(credit.notes[0]) && /QAP 3\.M\.1, p\. 33/.test(credit.notes[0]), 'asking for more credit than the model supports is a deal breaker');
ok(row(T.check(r1, v({ ...app, credit: 1100000 }), engine), 'credit').flag === 'yellow', 'asking for less only differs');
// The model's credit is the lesser of capacity and an entered request: above a binding-free request is not a deal breaker.
{
  const atReq = row(T.check(r1, v({ ...app, credit: 1300000 }), { ...engine, creditRequestInput: 1200000 }), 'credit');
  ok(atReq.flag === 'yellow' && /used the request entered in the Deal Calculator/.test(atReq.notes[0]), 'above a model request that did not bind only differs: capacity may be higher');
  const binding = row(T.check(r1, v({ ...app, credit: 1300000 }), { ...engine, creditRequestInput: 1500000 }), 'credit');
  ok(binding.flag === 'red', 'when capacity cut the entered request, the model figure is capacity and a higher ask is a deal breaker');
  const award = row(T.check(r1, v({ ...app, credit: 1300000 }), { ...engine, creditAwardInput: 1200000 }), 'credit');
  ok(award.flag === 'yellow' && /used the award/.test(award.notes[0]), 'an entered award is not capacity either');
}
const low = row(T.check(r1, v({ ...app, dscr: 1.12 }), engine), 'dscr');
ok(low.flag === 'red' && /Under CHFA's 1\.15 minimum \(QAP 3\.D, p\. 40\)/.test(low.notes[0]), 'coverage under 1.15 is a deal breaker');
const gap = row(T.check(r1, v({ ...app, gap: 250000 }), engine), 'gap');
ok(gap.flag === 'red' && /\$250,000 short/.test(gap.notes[0]), 'an unbalanced sources and uses is a deal breaker');
ok(row(T.check(r1, v(app), { ...engine, fundingGap: 400000 }), 'gap').flag === 'yellow', 'a balanced application over a model gap differs');

// Developer fee limit: 15% of $13.4M = $2.01M at 40 homes
const over = T.check(r1, v({ ...app, fee: 2200000 }), { ...engine, developerFee: 2200000 });
ok(over.fee.status === 'over' && row(over, 'fee').flag === 'red' && /over the 15% limit/.test(row(over, 'fee').notes[0]) && /QAP 3\.M\.3, p\. 36/.test(row(over, 'fee').notes[0]), 'a fee over the limit is a deal breaker');
const withConsultant = T.check(r1, v({ ...app, fee: 1900000, consultant: 300000 }), { ...engine, developerFee: 1900000 });
ok(withConsultant.fee.status === 'over', 'the consultant fee counts toward the limit');
const big = T.check(r1, v({ ...app, homes: 60, fee: 1700000 }), engine);
ok(big.fee.pct === 0.12, '12% at 60 homes');
const supportive = T.check(r1, v({ ...app, fee: 2200000 }, { deal: { ...base.deal, supportive: true } }), { ...engine, developerFee: 2200000 });
ok(supportive.fee.status === 'boost' && row(supportive, 'fee').flag === 'yellow' && /supportive housing increase/.test(row(supportive, 'fee').notes[0]), 'a supportive deal within the 5-point increase is flagged, not failed');
const rehab = T.check(r1, v({ ...app, acquisition: undefined }, { deal: { ...base.deal, rehab: true } }), engine);
ok(rehab.fee.status === 'open' && /building acquisition/.test(row(rehab, 'fee').notes.join(' ')), 'a rehab deal needs the acquisition cost to test the fee');
const acq = T.check(r1, v({ ...app, acquisition: 2000000 }, { deal: { ...base.deal, rehab: true } }), engine);
ok(acq.fee.acquisitionOff === 1000000 && acq.fee.base === clean.fee.base - 1000000, 'half of acquisition comes off the fee base');
ok(T.check(r1, v({ ...app, land: null }), engine).fee.status === 'open', 'no land, no fee test');
const noConsultant = T.check(r1, v({ ...app, fee: 1800000, consultant: null }), engine);
ok(noConsultant.fee.status === 'open' && /consultant fee/.test(row(noConsultant, 'fee').notes.join(' ')), 'a blank consultant fee is not taken as $0: the fee test waits for it');

// No export, or a stale one: no model figures, rules still apply
const none = T.check(r1, v({ ...app, dscr: 1.1 }, { calculator: null }), {});
ok(row(none, 'tdc').flag === 'info' && /load a Deal Calculator export/.test(row(none, 'tdc').notes[0]), 'without an export the figure is noted, not compared');
ok(row(none, 'dscr').flag === 'red' && row(none, 'homes').model === 40, 'the coverage rule still applies, and homes come from the form');

// ── In the review ───────────────────────────────────────────────────────────
const rev = SR.review(r1, prop123, v({ ...app, dscr: 1.1, tdc: 16300000 }));
const texts = rev.risks.map((x) => x.level + ': ' + x.text).join(' | ');
ok(/red: Tie-out, lowest must-pay debt coverage/.test(texts), 'a tie-out deal breaker is a red risk');
ok(/yellow: 1 application figure differs from the model: total development cost/.test(texts), 'differences are one yellow risk');
ok(rev.tieout.counts.red === 1 && rev.tieout.counts.yellow === 1, 'the review carries the tie-out');
const stale = SR.review(r1, prop123, v(app, { calculator: { mix, election: '40-60', stale: true } }));
ok(stale.tieout.rows.every((r) => r.model == null || r.id === 'homes'), 'a stale export gives no model figures');
ok(SR.review(r1, prop123, { deal: { mix }, claims: {}, thresholds: {}, engine: {} }).tieout.counts.entered === 0, 'a version saved before the tie-out works');
const cmp = SR.compareTable(r1, prop123, [v(app), v({ ...app, dscr: 1.1 })]);
ok(/Application tie-out/.test(cmp) && /0 red, 0 yellow, 15 green/.test(cmp) && /1 red, 0 yellow, 14 green/.test(cmp), 'versions compare their tie-out');
const hist = SR.historyModel(r1, prop123, [Object.assign(v(app), { n: 1 })]);
ok(hist.rows[0].tieout === '0 red, 0 yellow, 15 green' && /Application tie-out/.test(SR.historyCsv(hist)), 'the history and its CSV carry the tie-out');
ok(SR.review(r2, prop123, Object.assign(v({ ...app, fee: 2200000 }), { round: 'r2' })).risks.some((x) => /over the 15% limit/.test(x.text)), 'Round Two applies the same fee limit');

// Export and CSV
const exp = SR.fromCalculatorExport({ url: 'http://127.0.0.1:8799/d?rate-9=0.09', inputs: { units: '40', 'units-60': '40', 'equity-price': '0.86', 'credit-requested': '900000' },
  outputs: { eligibleBasis: { value: 1 }, developerFee: { value: 2 }, annualDebtService: { value: 3 }, annualRents: { value: 4 }, annualOperatingExpenses: { value: 5 }, annualReserves: { value: 6 } } });
ok(exp.engine.equityPrice === 0.86 && exp.engine.eligibleBasis === 1 && exp.engine.developerFee === 2 && exp.engine.annualDebtService === 3 && exp.engine.annualRents === 4 && exp.engine.annualOperatingExpenses === 5 && exp.engine.annualReserves === 6 && exp.engine.creditRequestInput === 900000 && exp.engine.creditAwardInput === null, 'the export brings the figures the tie-out compares');
const csv = T.csv(T.check(r1, { ...v(app), tieout: { app, ref: { tdc: '=Dev Budget!F12' } } }, engine));
ok(csv.startsWith('Figure,Application,Where in the application,Model,Flag,Note') && /'=Dev Budget!F12/.test(csv), 'the CSV has a header, and a reference starting with = is not a formula');

// Page
const html = read('developer-submittal-review.html');
ok(/id="srTie"/.test(html) && /id="sr-tie-csv"/.test(html) && html.indexOf('submittal-tieout.js') < html.indexOf('submittal-review.js"'), 'the page has the tie-out and loads it first');
ok(/id="srTieCard"/.test(html) && html.indexOf('id="srTieCard"') < html.indexOf('</form>'), 'the tie-out inputs are inside the form, so typing re-checks them');
const f = T.formHtml();
ok(/^Qualified basis/.test(T.ROWS.find((r) => r.id === 'basis').label) && /basis\.qualifiedBasis/.test(read('js/deal-engine.js').match(/var eligibleBasis\s*=.*$/m)[0]), 'the basis row is qualified basis, which is what the export calls eligibleBasis');
ok(T.ROWS.every((r) => f.includes('data-tie="' + r.id + '"') && f.includes('data-tieref="' + r.id + '"') && f.includes('for="sr-tie-' + r.id + '"')), 'every row has a labelled input and a reference field');
ok(/Deal breaker/.test(T.outHtml(row(T.check(r1, v({ ...app, gap: 5 }), engine), 'gap'))), 'a flag is written in words, not color alone');

// Saved and opened again: the figures and references come back (real page markup in jsdom, device store).
{
  const dom = new JSDOM(read('developer-submittal-review.html'), { url: 'http://127.0.0.1/developer-submittal-review.html' });
  const d = dom.window.document;
  const fh = SR.formHtml(r1);
  d.getElementById('srClaims').innerHTML = fh.claims; d.getElementById('srThresholds').innerHTML = fh.thresholds; d.getElementById('srTie').innerHTML = T.formHtml();
  const mem = {};
  const store = SR.makeStore(() => Promise.reject(new Error('offline')), { getItem: (k) => mem[k] || null, setItem: (k, val) => { mem[k] = val; } });
  const saved = await store.save({ name: 'Invented Site', label: 'with tie-out', data: { deal: { mix: { 60: 40 } }, tieout: { app: { tdc: 16000000, dscr: 1.1 }, ref: { dscr: 'Proforma, row 40' } } } });
  SR.mount(d, r1, prop123, store);
  const tick = () => new Promise((res) => setTimeout(res, 20));
  await tick();
  d.getElementById('sr-deal').value = saved.deal; d.getElementById('sr-deal').dispatchEvent(new dom.window.Event('change')); await tick(); await tick();
  ok(d.getElementById('sr-tie-tdc').value === '16000000' && d.getElementById('sr-tie-dscr').value === '1.1' && d.querySelector('[data-tieref="dscr"]').value === 'Proforma, row 40', 'opening a saved version restores its tie-out figures and references');
  ok(/Deal breaker/.test(d.getElementById('sr-tie-out-dscr').textContent) && /1 deal breaker/.test(d.getElementById('srTieSummary').textContent), 'and flags them again');
}

console.log('submittal-tieout: ' + checks + ' checks passed');
