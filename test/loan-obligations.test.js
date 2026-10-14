'use strict';
// Invented fixtures only. Independent expected figures are in the issue fixture.
const assert = require('node:assert/strict');
const engine = require('../js/deal-engine');
const { inputsFor } = require('./helpers/deal-engine-inputs.cjs');
const fixture = require('./fixtures/loan-obligations/invented.json');
assert.equal(fixture.invented, true);
const f = fixture.cases;
const schedule = (loan, noi = 1000000) => engine.loanObligations([{ id: 'invented', ...loan }], Array(50).fill(noi));
const round = (n, p = 0) => Number(n.toFixed(p));
let cases = 0;
let s = schedule(f.accrue).loans[0].rows;
assert.equal(round(s[14].balance), f.accrue.expected.balance);
assert(s.slice(0,15).every(r => r.due === 0 && r.paid === 0)); cases++;
s = schedule(f.mustPay).loans[0].rows;
assert.equal(round(s[0].due), f.mustPay.expected.due); cases++;
s = schedule(f.ioThenAmortize).loans[0].rows;
assert.deepEqual(s.slice(0,2).map(r => r.due), [80000,80000]);
assert.equal(round(s[2].due), f.ioThenAmortize.expected.due);
assert.equal(round(s[14].maturityDue), f.ioThenAmortize.expected.maturityDue); cases++;
s = schedule(f.fullIo).loans[0].rows;
assert(s.slice(0,35).every(r => r.due === f.fullIo.expected.due));
assert.equal(s[34].maturityDue, f.fullIo.expected.maturityDue); cases++;
const coverage = engine.loanObligations([
  {id:'senior',senior:true,loanType:'interest_only',amount:9000000,rate:5,term:35,maturity:35,priority:1}, f.mustPay
], [f.coverage.noi]).years[0];
assert.equal(coverage.seniorDebtService, f.coverage.seniorService);
assert.equal(round(coverage.seniorCoverage,2), f.coverage.expected.senior);
assert.equal(round(coverage.allMustPayCoverage,2), f.coverage.expected.all); cases++;
function enteredInput() {
  const i = inputsFor('A');
  Object.assign(i.fields, {'dc-auto-noi':false,'dc-noi':String(f.enteredSenior.noi),'dc-senior-mode':'entered',
    'dc-senior-amount':String(f.enteredSenior.amount),'dc-rate':'6.5','dc-term':'35'});
  i.tranches = [{id:1,...f.fullIo}]; return i;
}
let i = enteredInput(), r = engine.computeDeal(i);
assert.equal(r.mortgage, f.enteredSenior.amount);
assert.equal(round(r.annualDebtService), f.enteredSenior.expected.due);
assert.equal(round(r.baseDSCR,3), f.enteredSenior.expected.senior);
assert.equal(round(r.allMustPayDSCR,3), f.enteredSenior.expected.all); cases++;
assert.equal(cases, Object.keys(f).length, 'every acceptance case checked');
for (const [field, value] of [['dc-dcr','0.9'],['dc-dcr','2.1'],['dc-rate','1'],['dc-rate','13'],['dc-dcr',''],['dc-rate',''],['dc-term','']]) {
  i = enteredInput(); i.fields[field] = value; r = engine.computeDeal(i);
  for (const key of ['mortgage','annualDebtService','allMustPayDSCR','stress','waterfall']) {
    assert.equal(r[key],null,field + ': blocked ' + key); assert(r.unavailable[key]);
  }
}
for (const field of ['amount','rate','term','maturity','priority']) {
  for (const value of [null,'']) {
    const bad = schedule({...f.mustPay,[field]:value});
    assert.equal(bad.loans,null,field + ': no default'); assert(bad.unavailableReason);
  }
}
for (const [field,value] of [['amount',-1],['rate',21],['term',51],['maturity',51],['priority',13]]) {
  assert(schedule({...f.mustPay,[field]:value}).unavailableReason, field + ': rejects out-of-range terms');
}
assert(schedule({...f.mustPay, loanType:'unknown'}).unavailableReason);
assert(schedule({...f.ioThenAmortize,ioYears:15}).unavailableReason);
assert(schedule({...f.mustPay,loanType:'cash_flow',cashflowPayPct:null}).unavailableReason);
const zeroRate = schedule({...f.mustPay,rate:0}).loans[0].rows[0];
assert.equal(zeroRate.due,2000000/30, 'explicit 0% soft loan amortizes principal');
// Priority, residual share, no payments when residual is zero, annual accrual.
const cashLoans = [
  {id:'mandatory',...f.fullIo, priority:1},
  {id:'later',...f.accrue, loanType:'cash_flow', cashflowPayPct:50, priority:8},
  {id:'earlier',...f.accrue, loanType:'cash_flow', cashflowPayPct:50, priority:4}
];
s = engine.loanObligations(cashLoans,[120000]);
assert.equal(s.loans[2].rows[0].paid,50000);
assert.equal(s.loans[1].rows[0].paid,25000);
assert.equal(s.loans[1].rows[0].accrued,5000);
assert.equal(s.loans[1].rows[0].balance,1005000);
assert.equal(s.years[0].mustPayDebtService,20000);
assert.equal(s.years[0].cashFlow,25000);
s = engine.loanObligations(cashLoans,[0]);
assert.equal(s.loans[0].rows[0].paid,0);
assert.equal(s.loans[0].rows[0].unpaid,20000);
assert.equal(s.loans[1].rows[0].paid,0);
assert.equal(s.loans[1].rows[0].balance,1030000);
s = schedule({...f.accrue,loanType:'forgivable'}).loans[0].rows;
assert.equal(s[14].balance,0); assert.equal(round(s[14].forgiven),1557967); assert.equal(s[14].maturityDue,0);
assert.equal(s[15].balance,0, 'forgiven loan does not reappear');
assert.equal(schedule(f.fullIo).years[35].allMustPayCoverage,null, 'no assumed free debt after unpaid maturity');
assert(schedule(f.fullIo).years[35].unavailableReason);
// The pro forma, exit balances, and stresses all consume the same obligations.
i = inputsFor('A'); i.tranches = [{id:1,...f.ioThenAmortize}];
Object.assign(i.fields, {'dc-senior-mode':'entered','dc-senior-amount':'4000000','pf-rent-growth':'0','pf-exp-growth':'0'});
r = engine.computeDeal(i);
assert.equal(r.coverage.weakestAllMustPay.year,3);
assert.equal(r.coverage.weakestSenior.year,1);
assert.equal(r.projection.rows[2].debtService,r.obligations.years[2].mustPayDebtService);
assert.equal(r.exit.softBal,r.obligations.loans[1].rows[14].balance);
assert.equal(r.stress.rent10.dscr,r.stress.rent10.noi/r.allMustPayDebtService);
assert.equal(r.stressBase.dscr,r.allMustPayDSCR);
assert.equal(r.coverage.years.length,15);
assert(r.coverage.years.every(row => Object.hasOwn(row,'seniorCoverage') && Object.hasOwn(row,'allMustPayCoverage')));
i = inputsFor('A'); i.tranches = [{id:1,...f.accrue}]; r = engine.computeDeal(i);
assert.equal(round(r.exit.softBal),1557967, 'exit grows accrued loan instead of amortizing');
assert.equal(r.totalSoftDebtService,0);
i = inputsFor('A'); i.tranches = [{id:1,...f.mustPay}]; r = engine.computeDeal(i);
assert.equal(round(r.allMustPayDSCR,9),1.2, 'sizing reserves must-pay soft service');
assert(r.baseDSCR > r.allMustPayDSCR);
i = inputsFor('A'); i.fields['dc-opex']=''; r = engine.computeDeal(i);
assert.equal(r.stress,null, 'unknown costs are not substituted with zero');
assert.equal(r.obligations.years,null);
assert(r.obligations.unavailableReason);
i = inputsFor('A'); i.fields['dc-senior-mode']='entered'; i.fields['dc-senior-amount']='0'; i.fields['dc-deferred-auto-balance']=false;
r = engine.computeDeal(i);
assert(r.exit.dfYr > 0, 'cash flow can repay deferred fees even with no senior mortgage');
assert.equal(r.baseDSCR,null, 'no debt is not a fake zero coverage');
const unknownCash = engine.loanObligations([{id:'invented',...f.mustPay}], [null]);
assert.equal(unknownCash.loans[0].rows[0].paid,null);
assert(unknownCash.loans[0].rows[0].unavailableReason);
console.log('loan-obligations: PASS — all 6 acceptance cases; ranges, absence, priority, residuals, forgiveness, maturity, coverage, stress and exit agreement (invented only)');
