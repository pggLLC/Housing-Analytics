// Financials (step 5): the public site's own Deal Engine, from the pinned copy, fed the scenario's saved
// rent schedule the same way deal-calculator.html feeds it (schedule mode). This file does no deal
// arithmetic of its own; every figure and every "unavailable" reason comes from DealEngine.computeDeal.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var P = global.LabProjects;
  var esc = Shell.esc;
  var VENDOR = global.LAB_VENDOR;

  // Same constants and defaults as js/deal-calculator.js at the pin (qa/financials.test.js checks the fixture agrees).
  var DEAL_AMI_BANDS = [20, 30, 40, 50, 60, 70, 80, 100, 110, 120];
  var SPLIT_BR_TYPES = ['studio', '1br', '2br', '3br', '4br'];
  var RENT_BEDROOMS = { studio: 'efficiency', '1br': '1BR', '2br': '2BR', '3br': '3BR', '4br': '4BR' };
  var CONSTANTS = { rentBurdenPct: 0.30, rentStressPct: 0.10, vacStressPp: 0.05, opexStressPct: 0.10, combinedRentPct: 0.05, combinedVacPp: 0.03, combinedOpexPct: 0.05 };
  var CREDIT_RATES = { '9': 0.09, '4': 0.04 };
  var FALLBACK_EQUITY = { credit_9pct: 0.82, credit_4pct: 0.83 };

  // Every cost line on the live page: the Colorado Division of Housing's nine groups and line names, ids, the
  // starting basis choice and the lines never in basis (DealCostBasis.GROUPS, LINE_TEMPLATE, NEVER_IN_BASIS).
  // Amounts start blank, and a blank line carries no cost. A visitor can change any line's basis choice except a
  // line that is never in basis, as on the live page. Contingency lines also ask how much is proposed for use so
  // far (DealCostBasis.CONTINGENCY_KINDS).
  var BASIS_CHOICES = [['eligible', 'In basis'], ['partial', 'Partly in basis'], ['ineligible', 'Not in basis']];
  function CB() { return global.DealCostBasis; }
  function costIds() { return CB().LINE_TEMPLATE.map(function (t) { return t.id; }); }
  function lineBasis(d, t) {
    if (CB().NEVER_IN_BASIS[t.id]) return 'ineligible';
    var v = (d.basis || {})[t.id];
    return v === 'eligible' || v === 'partial' || v === 'ineligible' ? v : t.basis;
  }

  // Visitor-entered screening inputs and what the live page calls them. Defaults are the live page's.
  var INPUTS = [
    { id: 'dc-tdc', label: 'Total development cost ($)', value: '', step: '1000' },
    { id: 'dc-gross-sf', label: 'Gross building area (SF), optional', value: '', step: '1000', note: 'All built space, including halls and common space. Used for cost per square foot.' },
    { id: 'dc-res-sf', label: 'Residential floor area (SF), optional', value: '', step: '1000', note: 'Floor space of all rental homes, without halls or common space.' },
    { id: 'dc-restricted-sf', label: 'Floor area of the tax credit homes (SF)', value: '', step: '100', note: 'Needed only when some homes rent at market rate. The credit is figured on the smaller of the home share and the floor-space share.' },
    { id: 'dc-credit', label: 'Credit type', options: [['9', '9% competitive'], ['4', '4% with bonds']], value: '9' },
    { id: 'dc-minimum-set-aside', label: 'Federal minimum set-aside election', options: [['20-50', '20-50 election'], ['40-60', '40-60 election (default)'], ['average-income', 'Average Income Test (20-80% designations)']], value: '40-60',
      note: 'Changes which homes earn credit (26 U.S.C. 42(g)(1)); it does not change the homes you entered.' },
    { id: 'dc-equity-price', label: 'Equity price per credit dollar', value: '', step: '0.01' },
    // The 30% basis boost, as the live page asks for it: a designation, its evidence, and for a CHFA boost the
    // percentage in CHFA's letter. With no designation there is no boost.
    { id: 'dc-boost-designation', label: '30% basis boost', options: [['none', 'No boost'], ['qct', 'Qualified Census Tract (QCT)'], ['dda', 'Difficult Development Area (DDA)'],
      ['sadda', 'Small Area DDA (SADDA)'], ['chfa', 'CHFA basis boost (9% only)']], value: 'none' },
    { id: 'dc-boost-evidence', label: 'Evidence for the boost', type: 'text', value: '', placeholder: 'HUD map or list for the tract, or CHFA letter and date' },
    { id: 'dc-boost-pct', label: 'CHFA basis boost only: percentage in CHFA\u2019s letter (up to 30)', value: '', step: '1',
      // The live page's two notes under the boost (dc-boost-help, dc-dda-2027), word for word, with its three links.
      after: '<p class="note field-after" id="dc-boost-help">A QCT, DDA or SADDA boost raises eligible basis by 30% once; a CHFA boost raises it once by the percentage in CHFA\u2019s letter, up to 30%. It needs a designation and the evidence for it, never applies to buying an existing building, and the CHFA boost cannot be combined with a QCT, DDA or SADDA.</p>' +
        '<p class="note field-after" id="dc-dda-2027">HUD\u2019s 2027 lists apply to 9% credits allocated after December 31, 2026, which is every 2027 round. A 4% bond deal uses them only if, after that date, its bonds are issued and its buildings placed in service. They add Archuleta and Chaffee counties and ZIP 80433 as DDAs, and drop San Miguel County and ZIPs 80129, 80249, 80465 and 80913. This site\u2019s maps show the 2026 lists until January. ' +
        '<a href="https://www.huduser.gov/portal/Datasets/qct/DDA2027NM.PDF">HUD 2027 county list \u2197</a> \u00b7 <a href="https://www.huduser.gov/portal/Datasets/qct/DDA2027M.PDF">HUD 2027 ZIP list \u2197</a> \u00b7 ' +
        '<a href="https://www.federalregister.gov/documents/2026/10/06/2026-20390/statutorily-mandated-designation-of-difficult-development-areas-and-qualified-census-tracts-for-2027">Federal Register, October 6, 2026 \u2197</a></p>' },
    { id: 'dc-deferred-pct', label: 'Deferred developer fee cap (% of the fee)', value: '40', step: '1' },
    { id: 'dc-deferred-auto-balance', type: 'checkbox', label: 'Auto-balance the gap with deferred fee: defer more fee, up to the cap, to close any remaining gap. Untick to defer exactly the percentage above.', value: 'yes' },
    { id: 'dc-deferred-repay-cap', type: 'checkbox', label: 'Defer no more than 15 years of cash flow repays: any fee above what years 1 to 15 repay becomes gap. CHFA reviews whether cash flow can repay the deferred fee (2027-2028 QAP section 2.B, Criteria for Approval).', value: 'yes' },
    { id: 'dc-rep-reserve', label: 'Replacement reserve ($ per home per year)', value: '350', step: '5' },
    { id: 'dc-prop-tax', label: 'Property tax ($ per home per year)', value: '900', step: '10' },
    { id: 'dc-tax-exempt', label: 'Property tax exemption', options: [['0', 'None (0%)'], ['50', 'Partial (50%), nonprofit'], ['100', 'Full (100%), housing authority']], value: '0',
      note: 'Housing authority ownership or a nonprofit partnership may qualify for a property tax exemption. Confirm it with the county assessor.' },
    { id: 'dc-dcr', label: 'Debt coverage ratio required', value: '1.20', step: '0.01' },
    { id: 'dc-rate', label: 'Permanent loan rate (%)', value: '6.5', step: '0.05' },
    // The live page's spread box in its perm-rate hint (calculator move piece C). Blank uses the published assumption.
    { id: 'dc-perm-spread', label: 'Spread over the 10-year Treasury (points)', value: '', step: '0.05', min: '0', max: '5', placeholder: 'COHO assumption',
      note: 'For the rate hint under Most-likely case: the latest 10-year Treasury plus this spread. Blank uses COHO\u2019s screening assumption. The loan rate changes only when you choose the hinted rate there.' },
    { id: 'dc-term', label: 'Amortization (years)', value: '35', step: '1' },
    // Exit and projection, with the live page's labels, defaults and ranges (Year-15 Exit Analysis and the
    // pro forma's Projection Assumptions).
    { id: 'dc-exit-hold', group: 'exit', label: 'Hold period (years)', value: '15', step: '1', min: '5', max: '30' },
    { id: 'dc-exit-cap', group: 'exit', label: 'Exit cap rate (%)', value: '6.5', step: '0.05', min: '3.0', max: '12.0' },
    { id: 'pf-rent-growth', group: 'exit', label: 'Annual rent growth (%)', value: '2', step: '0.25', min: '-3', max: '5' },
    { id: 'pf-exp-growth', group: 'exit', label: 'Annual expense growth (%)', value: '3', step: '0.25', min: '0', max: '6' },
    { id: 'pf-years', group: 'exit', label: 'Projection years', value: '15', step: '1', min: '5', max: '50' }
  ];
  // The partnership terms, with the live page's labels, defaults and ranges (Capital event waterfall). The engine's
    // own defaults are the same, so a draft saved before these existed gives the same split.
  var WF_INPUTS = [
    { id: 'dc-wf-lp-equity', group: 'waterfall', label: 'Investor equity paid in ($)', value: '', step: '50000', min: '0', placeholder: 'automatic', note: 'Blank uses what the investor pays for the credits. Enter an amount to model a different buy-in.' },
    { id: 'dc-wf-pref', group: 'waterfall', label: 'Investor preferred return (%)', value: '8', step: '0.25', min: '0', max: '15', note: 'Accrues until paid. Set by the partnership agreement.' },
    { id: 'dc-wf-gp-residual', group: 'waterfall', label: 'Sponsor share of what is left (%)', value: '30', step: '5', min: '0', max: '100', note: 'After every tier above it is paid; the investor gets the rest. Set by the partnership agreement.' },
    { id: 'dc-wf-catchup', group: 'waterfall', label: 'Sponsor catch-up', options: [['none', 'No catch-up'], ['full', 'Full catch-up']], value: 'none', note: 'Most tax credit deals skip it, because the investor\u2019s return is the credits, not cash.' },
    { id: 'dc-wf-lp-ops-share', group: 'waterfall', label: 'Investor share of yearly cash (%)', value: '99.99', step: '0.01', min: '0', max: '100', note: 'Cash left after loan payments and the deferred fee. Set by the partnership agreement.' },
    { id: 'dc-wf-exit', group: 'waterfall', label: 'How the investor exits', options: [['sale', 'Sale, split by the waterfall'], ['buyout', 'Sponsor buys the investor out']], value: 'sale' },
    { id: 'dc-wf-buyout', group: 'waterfall', label: 'Buyout price paid to the investor ($)', value: '', step: '1000', min: '0', placeholder: 'needed for a buyout', note: 'Under a \u00a742(i)(7) right of first refusal the property price can be as low as the debt plus the investor\u2019s exit taxes. Use the price your agreement sets.' }
  ];

  // Every control on the screen: the deal inputs, then the partnership terms (checked in qa/financials-3l.test.js).
  // The live page's five stress sliders (3L part 2). Each is read by the engine's sliderImpacts; none resizes a loan.
  // A blank equity price follows the base case's price, so the slider starts where the deal is.
  var STRESS_INPUTS = [
    { id: 'dc-stress-equity-price', group: 'stress', label: 'Equity price', value: '', min: '0.70', max: '1.10', step: '0.01', fmt: function (v) { return '$' + v.toFixed(2) + ' per credit dollar'; },
      note: 'What investors pay per dollar of credit. It starts at the base case\u2019s price, shown under Most-likely case.' },
    { id: 'dc-stress-tdc-overrun', group: 'stress', label: 'Cost overrun', value: '0', min: '0', max: '25', step: '1', fmt: function (v) { return '+' + v.toFixed(0) + '% of total cost'; },
      note: 'Cost above the total entered, beyond any contingency already in the budget.' },
    { id: 'dc-stress-rent-low', group: 'stress', label: 'Rent cut, 30% to 50% AMI homes', value: '0', min: '0', max: '20', step: '1', fmt: function (v) { return '\u2212' + v.toFixed(0) + '%'; },
      note: 'Cuts rent only on homes at 30% to 50% AMI, after vacancy; other homes and other income are unchanged.' },
    { id: 'dc-stress-leaseup', group: 'stress', label: 'Lease-up to full occupancy', value: '12', min: '6', max: '36', step: '3', fmt: function (v) { return v.toFixed(0) + ' months'; },
      note: 'Occupancy rises in a straight line from empty to full over these months.' },
    { id: 'dc-stress-dscr-floor', group: 'stress', label: 'Lender\u2019s coverage floor', value: '1.15', min: '1.10', max: '1.40', step: '0.05', fmt: function (v) { return v.toFixed(2) + 'x'; },
      note: 'CHFA\u2019s minimum is 1.15x, as in the coverage check below. Other lenders may set a higher floor.' }
  ];

  // The loan stack (3L): the first mortgage's terms, the bridge loan and asset management fee, with the live page's
  // labels, defaults and ranges (Debt Sizing and the DOH 15-year pro forma). The engine reads each one.
  var LOAN_TYPE_OPTIONS = [['amortizing', 'Must-pay amortizing'], ['io_then_amortizing', 'Interest-only then amortizing'],
    ['interest_only', 'Interest-only to maturity'], ['cash_flow', 'Cash-flow contingent'], ['accrue_defer', 'Accrue and defer'], ['forgivable', 'Forgivable']];
  var LOAN_INPUTS = [
    { id: 'dc-senior-mode', group: 'senior', label: 'First mortgage amount', options: [['sized', 'Size from NOI and target DCR'], ['entered', 'Enter loan amount']], value: 'sized',
      note: 'Sized: the largest loan the income carries at the coverage below. Entered: a lender quote or term sheet.' },
    { id: 'dc-senior-amount', group: 'senior', label: 'Entered first mortgage ($)', value: '', step: '1000', min: '0', placeholder: 'only when entered', note: 'Used only when the amount is entered.' },
    { id: 'dc-senior-type', group: 'senior', label: 'Repayment', options: LOAN_TYPE_OPTIONS, value: 'amortizing' },
    { id: 'dc-senior-maturity', group: 'senior', label: 'Maturity (years)', value: '35', step: '1', min: '1', max: '50', note: 'A balance left at maturity is due then (a balloon).' },
    { id: 'dc-senior-io-years', group: 'senior', label: 'Interest-only years (before amortization)', value: '2', step: '1', min: '0', max: '49', note: 'Used only for interest-only then amortizing.' },
    { id: 'dc-senior-priority', group: 'senior', label: 'Priority (1 paid first)', value: '1', step: '1', min: '1', max: '12' },
    { id: 'dc-senior-cfpay', group: 'senior', label: 'Share of cash left over (%), cash-flow loans only', value: '100', step: '1', min: '0', max: '100' },
    { id: 'dc-bridge-ds', group: 'bridge', label: 'Bridge-loan payments ($ a year)', value: '0', step: '1000', min: '0', note: 'A required payment, ahead of the asset management fee and cash-flow loans.' },
    { id: 'dc-bridge-years', group: 'bridge', label: 'Years of bridge-loan payments', value: '0', step: '1', min: '0', max: '50' },
    { id: 'dc-asset-mgmt-fee', group: 'bridge', label: 'Asset management fee, year 1 ($ a year)', value: '0', step: '500', min: '0', note: 'Paid from cash after the mortgages; any unpaid part carries forward.' },
    { id: 'dc-asset-mgmt-growth', group: 'bridge', label: 'Asset management fee increase (% a year)', value: '3', step: '0.5', min: '0', max: '10' }
  ];
  // The construction loan and tax-exempt bonds (live Debt Sizing, "Tax-exempt bonds and construction loan"), then the
  // lender schedule inputs (live "Lender schedules" panel, js/deal-lender-schedules-view.js), with the live labels,
  // defaults and ranges. The engine's bond test, interest check and schedules read each one.
  var YES_NO = [['', 'Not answered'], ['no', 'No'], ['yes', 'Yes']];
  var LS_INPUTS = [
    { id: 'dc-bond-amount', group: 'constr', label: 'Tax-exempt bonds ($)', value: '', step: '1000', min: '0', placeholder: 'not entered', note: '4% deals only. Needed for the bond test.' },
    { id: 'dc-bond-post2025', group: 'constr', label: 'Bonds from an issue dated after 2025?', options: [['', 'Not known'], ['yes', 'Yes'], ['no', 'No']], value: '' },
    { id: 'dc-constr-loan', group: 'constr', label: 'Construction loan ($)', value: '', step: '1000', min: '0', placeholder: 'not entered' },
    { id: 'dc-constr-rate', group: 'constr', label: 'Construction loan rate (%)', value: '', step: '0.05', min: '0', max: '20', placeholder: 'not entered' },
    { id: 'dc-constr-months', group: 'constr', label: 'Loan months, closing to payoff', value: '', step: '1', min: '1', max: '60', placeholder: 'not entered' },
    { id: 'dc-constr-draw', group: 'constr', label: 'Average share drawn (%)', value: '', step: '1', min: '1', max: '100', placeholder: 'not entered', note: 'Used only for the quick interest estimate; the draw schedule below works month by month.' },
    { id: 'dc-fed-payin-closing', group: 'payin', label: 'At closing', value: '', step: '1', min: '0', max: '100', placeholder: '\u2014' },
    { id: 'dc-fed-payin-completion', group: 'payin', label: 'At completion', value: '', step: '1', min: '0', max: '100', placeholder: '\u2014' },
    { id: 'dc-fed-payin-stabilization', group: 'payin', label: 'At stabilization', value: '', step: '1', min: '0', max: '100', placeholder: '\u2014' },
    { id: 'dc-chfa-sec8-full', group: 'ls-min', label: 'Project-based Section 8 on every home?', options: YES_NO, value: '', note: 'Lowers the vacancy floor to 5% and raises the cost floor to $5,000.' },
    { id: 'dc-chfa-senior', group: 'ls-min', label: 'Senior housing?', options: YES_NO, value: '', note: 'Senior projects use a $300 reserve floor instead of $350.' },
    { id: 'dc-draw-curve', group: 'ls-draw', label: 'How construction spending runs', options: [['scurve', 'S-curve'], ['straight', 'Straight line'], ['front', 'Front-loaded']], value: 'scurve', note: 'An S-curve is typical: slow site work, a fast middle, a slow finish.' },
    { id: 'dc-draw-convert-months', group: 'ls-draw', label: 'Months from completion to conversion', value: '6', step: '1', min: '0', max: '36', note: 'Lease-up and stabilization before the permanent loan funds.' },
    { id: 'dc-draw-retainage', group: 'ls-draw', label: 'Retainage (%)', value: '10', step: '0.5', min: '0', max: '15', note: 'Held from each contractor draw until completion. The construction contract sets it.' },
    { id: 'dc-draw-fee-closing', group: 'ls-draw', label: 'Paid developer fee at closing (%)', value: '25', step: '5', min: '0', max: '100', note: 'The rest of the paid fee comes at conversion.' },
    { id: 'dc-draw-soft-closing', group: 'ls-draw', label: 'Soft costs paid at closing (%)', value: '40', step: '5', min: '0', max: '100', note: 'Design, permits and fees often come due at closing; the rest is spread over the build.' },
    { id: 'dc-draw-soft-sources', group: 'ls-draw', label: 'Soft loans and grants fund', options: [['closing', 'At closing'], ['conversion', 'At conversion']], value: 'closing', note: 'Some public lenders fund at closing, others only at conversion.' },
    { id: 'dc-conv-rate-bp', group: 'ls-conv', label: 'Permanent rate rise (basis points)', value: '50', step: '5', min: '0', max: '300', note: 'If the rate is not locked, a higher rate sizes a smaller loan.' },
    { id: 'dc-conv-noi-cut', group: 'ls-conv', label: 'Income below plan (%)', value: '5', step: '1', min: '0', max: '30', note: 'Lower rents or higher costs at stabilization.' },
    { id: 'dc-conv-credit-delivered', group: 'ls-conv', label: 'Credits delivered (%)', value: '100', step: '1', min: '50', max: '100', note: 'Below 100% triggers the investor\u2019s downward adjuster.' },
    { id: 'dc-pf-mgmt-pct', group: 'ls-budget', label: 'Management fee (% of collected income)', value: '', step: '0.5', min: '0', max: '15', placeholder: 'not entered', note: 'Split out of the operating budget so it follows income. Blank keeps it in operating costs.' },
    { id: 'dc-pf-tax-growth', group: 'ls-budget', label: 'Property tax growth (%/yr)', value: '', step: '0.5', min: '0', max: '10', placeholder: 'not entered', note: 'Blank uses the expense growth rate.' },
    { id: 'dc-pf-reserve-growth', group: 'ls-budget', label: 'Replacement reserve growth (%/yr)', value: '', step: '0.5', min: '0', max: '10', placeholder: 'not entered', note: 'Blank uses the expense growth rate.' },
    { id: 'dc-pf-capital-needs', group: 'ls-reserves', type: 'text', label: 'Capital needs (year:amount; \u2026)', value: '', placeholder: '12:180000; 15:95000', note: 'From a capital needs assessment.' },
    { id: 'dc-pf-reserve-yield', group: 'ls-reserves', label: 'Interest on the reserve (%/yr)', value: '', step: '0.25', min: '0', max: '8', placeholder: 'not entered', note: 'Blank earns nothing.' },
    { id: 'dc-after-taxes', group: 'ls-exit', label: 'Exit taxes for the minimum price ($)', value: '', step: '1000', min: '0', placeholder: 'not entered', note: 'The investor\u2019s taxes on the sale.' },
    { id: 'dc-after-refi-rate', group: 'ls-exit', label: 'Refinance rate (%)', value: '', step: '0.05', min: '0', max: '15', placeholder: 'not entered' },
    { id: 'dc-after-refi-term', group: 'ls-exit', label: 'Refinance amortization (years)', value: '35', step: '1', min: '5', max: '40' },
    { id: 'dc-after-refi-dcr', group: 'ls-exit', label: 'Refinance coverage (x)', value: '1.20', step: '0.05', min: '1', max: '2' },
    { id: 'dc-after-refi-cost', group: 'ls-exit', label: 'Refinance costs (% of loan)', value: '2', step: '0.25', min: '0', max: '10' },
    { id: 'dc-after-land-pct', group: 'ls-exit', label: 'Land share of the price (%)', value: '10', step: '1', min: '0', max: '60', note: 'Land earns no acquisition credit.' },
    { id: 'dc-after-rehab-per-home', group: 'ls-exit', label: 'Rehabilitation per home ($)', value: '', step: '1000', min: '0', max: '400000', placeholder: 'not entered', note: 'For a resyndication.' },
    { id: 'dc-after-rehab-rate', group: 'ls-exit', label: 'Rehabilitation credit rate (%)', value: '4', step: '0.05', min: '3', max: '10', note: 'About 4% with bonds.' },
    { id: 'dc-after-resyn-price', group: 'ls-exit', label: 'Credit price, resyndication ($ per $1)', value: '', step: '0.01', min: '0.5', max: '1.2', placeholder: 'not entered' }
  ];
  // Inputs the engine reads that Codex's wave 3 review found missing (finding 2), with the live page's labels, options
  // and defaults: building type for CHFA's cost limits, the fee and acquisition questions, federal grant allocation, the
  // federal credit requested and awarded, state credit with its pay-in, an added credit, and the expense target.
  var CHECK = 'checkbox';
  // The live page's market cap on restricted rents (HA #2859): the most the market pays a month for each size, after
  // utilities, from a market study. Blank means no cap; the engine underwrites a restricted rent above it at the cap.
  var RENT_CAP_INPUTS = [['studio', 'Studio'], ['1br', '1BR'], ['2br', '2BR'], ['3br', '3BR'], ['4br', '4BR']].map(function (b) {
    return { id: 'dc-rent-cap-' + b[0], group: 'rentcap', label: b[1] + ' ($ a month)', value: '', step: '1', min: '0', placeholder: 'none' };
  }).concat([{ id: 'dc-rent-cap-source', group: 'rentcap', type: 'text', label: 'Source of the cap (market study, date)', value: '', placeholder: 'not entered' }]);
  var CREDIT_INPUTS = [
    { id: 'dc-building-type', group: 'costs', label: 'Building type, for CHFA\u2019s cost basis limits', options: [['', 'Not chosen'], ['elevator', 'Elevator'], ['walk_up', 'Walk-up']], value: '',
      note: 'Needed for CHFA\u2019s per-unit cost limits in CHFA\u2019s 2027 Common Application (V9). With the box below ticked, those limits set the credit when they are the lowest of CHFA\u2019s three methods.' },
    // The live page's "Plan to CHFA's cost basis limit" (HA #2859): on unless unticked; the engine applies Method Three
    // when it is the lowest of the three methods. A draft saved before the box existed starts ticked (draftFor).
    { id: 'dc-plan-cost-limit', group: 'costs', type: CHECK, label: 'Plan to CHFA\u2019s cost basis limit', value: 'yes',
      note: 'CHFA reserves the least of three methods (2027-28 QAP, 3.M.1). When the cost basis limit (Method Three) is lowest, it sets the credit. Untick to see the credit before the limit.' },
    { id: 'dc-ioi', group: 'devfee', type: CHECK, label: 'The builder has an identity of interest with the developer or owner (lowers CHFA\u2019s contractor fee limit)', value: '' },
    { id: 'dc-special-pop', group: 'devfee', type: CHECK, label: 'The project serves people experiencing homelessness or special populations (CHFA then keeps all of an acquisition in the developer fee base)', value: '' },
    { id: 'dc-acq-42d2', group: 'devfee', type: CHECK, label: 'Any existing building purchase meets 26 U.S.C. 42(d)(2): bought from an unrelated party, not placed in service during the ten years before you bought it, and rehabilitated enough to earn its own credit under 42(e)', value: '',
      note: 'Needed before a building purchase counts in basis.' },
    { id: 'dc-grant-acq', group: 'devfee', label: 'Federal grant money that paid for the building purchase ($)', value: '', step: '1000', min: '0', placeholder: 'not entered',
      note: 'Needed when a grant covers both a purchase and other basis on a 9% deal, where the purchase earns 4% and the rest 9%, or under a basis boost, which skips the purchase.' },
    { id: 'dc-grant-outside', group: 'devfee', label: 'Federal grant money that paid for costs outside eligible basis ($)', value: '', step: '1000', min: '0', placeholder: 'not entered',
      note: 'Land, reserves or fees above CHFA\u2019s limits. Enter 0 if none: a federal grant reduces basis only by what it paid for in basis.' },
    { id: 'dc-credit-requested', group: 'credit', label: 'Annual federal credit requested ($)', value: '', step: '1000', min: '0', placeholder: 'not entered' },
    { id: 'dc-credit-awarded', group: 'credit', label: 'Annual federal credit awarded ($)', value: '', step: '1000', min: '0', placeholder: 'not entered',
      note: 'Equity uses the award when you enter one, otherwise the request (up to capacity), otherwise the capacity.' },
    // CHFA's per-project limits depend on the credit year and, under the 2027-2028 plan, on the 3.B.9 pilot (QAP 3.L, 3.L.1).
    { id: 'dc-qap-year', group: 'credit', label: 'CHFA credit year (sets the per-project limits)', value: '2027', options: [['2027', '2027 (2027-2028 plan)'], ['2028', '2028 (2027-2028 plan)'], ['2026', '2026 (2025-2026 plan)']] },
    { id: 'dc-pilot-gap', group: 'credit', label: 'State gap funds through CHFA\u2019s 3.B.9 pilot', value: 'yes', options: [['yes', 'Available: QAP 3.L limits'], ['no', 'Not available: QAP 3.L.1 limits']] },
    { id: 'dc-state-path', group: 'state', label: 'CHFA state credit application (each has its own limit)', value: '', options: [['', 'Not answered (a 9% deal uses the 9% pairing)'],
      ['with_9pct', 'Paired with a 9% application: a fixed amount a year, set by the credit year'], ['round_two', 'Round Two with 4%: accelerated plus paired standard credit, each with a limit set by the credit year'],
      ['bond_fall', '4% bond deal applying Sept to Nov: $10,000 per unit, up to $700,000 a year']] },
    { id: 'dc-state-annual', group: 'state', label: 'Annual state credit ($)', value: '', step: '1000', min: '0', placeholder: 'none' },
    { id: 'dc-state-standard-annual', group: 'state', label: 'Round Two only: paired standard state credit, annual ($)', value: '', step: '1000', min: '0', placeholder: 'none' },
    // Paul's decision (1 November 2026): $0.72 stays an explicit, editable COHO starting assumption here.
    { id: 'dc-state-price', group: 'state', label: 'Price per $1 of state credit', value: '0.72', step: '0.01', min: '0', max: '1.5',
      note: 'Starts at $0.72, COHO\u2019s own starting assumption from Colorado tax credit applications. No public source prices the Colorado state credit; replace it with a syndicator\u2019s quote. The full Deal Calculator starts blank.' },
    { id: 'dc-state-fees', group: 'state', label: 'State credit investor fees, total ($)', value: '', step: '1000', min: '0', placeholder: 'none' },
    { id: 'dc-state-awarded', group: 'state', type: CHECK, label: 'CHFA has awarded this state credit (a proposed amount does not count: CHFA sizes it with a three-test calculation this calculator does not model)', value: '' },
    { id: 'dc-state-payin-closing', group: 'state-payin', label: 'At closing', value: '', step: '1', min: '0', max: '100', placeholder: '\u2014' },
    { id: 'dc-state-payin-completion', group: 'state-payin', label: 'At completion', value: '', step: '1', min: '0', max: '100', placeholder: '\u2014' },
    { id: 'dc-state-payin-stabilization', group: 'state-payin', label: 'At stabilization', value: '', step: '1', min: '0', max: '100', placeholder: '\u2014' },
    { id: 'dc-add-kind', group: 'added', label: 'Added credit', value: '', options: [['', 'None'], ['tz', 'Colorado Transit Zone credit (HB26-1065)'],
      ['designation', 'Another location- or designation-based credit'], ['other', 'Another credit, not tied to location']],
      note: 'The Transit Zone credit counts only when Market Analysis places the site inside a zone on OEDIT\u2019s map, as on the full Deal Calculator; this page has no map test, so it stays uncounted here.' },
    { id: 'dc-add-evidence', group: 'added', type: 'text', label: 'Eligibility evidence (the designation, map or letter showing the site qualifies)', value: '', placeholder: 'not entered' },
    { id: 'dc-add-annual', group: 'added', label: 'Annual credit ($)', value: '', step: '1000', min: '1', placeholder: 'none' },
    { id: 'dc-add-years', group: 'added', label: 'Years claimed', value: '', step: '1', min: '1', placeholder: 'not entered' },
    { id: 'dc-add-price', group: 'added', label: 'Investor price per $1 of credit', value: '', step: '0.01', min: '0.01', max: '1.5', placeholder: 'not entered' },
    { id: 'dc-add-fees', group: 'added', label: 'New investor fees, total ($)', value: '', step: '1000', min: '0', placeholder: 'none' },
    { id: 'dc-add-program-year', group: 'added', label: 'Program year', value: '', step: '1', min: '2000', max: '2100', placeholder: 'not entered' },
    { id: 'dc-add-mode', group: 'added', label: 'Adds or replaces', value: '', options: [['', 'Not answered'], ['supplement', 'Adds to the other credits'], ['substitute', 'Replaces part of another credit']] },
    { id: 'dc-add-displaces', group: 'added', label: 'Credit it replaces', value: '', options: [['', 'Not answered'], ['state', 'Colorado state credit'], ['federal', 'Federal credit']] },
    { id: 'dc-add-displaced-annual', group: 'added', label: 'Annual amount it replaces ($)', value: '', step: '1000', min: '1', placeholder: 'none' },
    { id: 'dc-add-fed-cut', group: 'added', label: 'Cut to the annual federal credit, if the allocator makes one ($)', value: '', step: '1000', min: '0', placeholder: 'none' },
    { id: 'dc-add-payin-closing', group: 'added-payin', label: 'At closing', value: '', step: '1', min: '0', max: '100', placeholder: '\u2014' },
    { id: 'dc-add-payin-completion', group: 'added-payin', label: 'At completion', value: '', step: '1', min: '0', max: '100', placeholder: '\u2014' },
    { id: 'dc-add-payin-stabilization', group: 'added-payin', label: 'At stabilization', value: '', step: '1', min: '0', max: '100', placeholder: '\u2014' },
    { id: 'dc-opex-target', group: 'opex', label: 'Expense target someone gave you ($ per home per year, optional)', value: '', step: '50', min: '0', placeholder: 'not entered',
      note: 'Checked against the line items, never used in place of them.' }
  ];
  // Finding 3: the live page's net operating income choice and its stress-case settings, with its labels, defaults and
  // ranges. Rent burden stays at 30%: the live page disables it for published CHFA rents, which a saved schedule uses.
  var NOI_INPUTS = [
    { id: 'dc-auto-noi', group: 'noi', label: 'Net operating income', options: [['yes', 'Compute from the rents and the operating budget'], ['no', 'Enter it myself']], value: 'yes',
      note: 'The full Deal Calculator computes it by default. An entered figure replaces the rents, vacancy and budget in every result, so its breakdown is not shown.' },
    { id: 'dc-noi', group: 'noi', label: 'Net operating income you entered ($ a year)', value: '0', step: '1000', min: '0', note: 'Used only when you enter it yourself.' }
  ];
  var CONST_INPUTS = [
    { id: 'dc-const-rent-stress', key: 'rentStressPct', group: 'stressconst', label: 'Rent stress (\u2212%)', value: '10', step: '1', min: '0', max: '50' },
    { id: 'dc-const-vac-stress', key: 'vacStressPp', group: 'stressconst', label: 'Vacancy stress (+ points)', value: '5', step: '1', min: '0', max: '50' },
    { id: 'dc-const-opex-stress', key: 'opexStressPct', group: 'stressconst', label: 'Operating cost stress (+%)', value: '10', step: '1', min: '0', max: '50' },
    { id: 'dc-const-comb-rent', key: 'combinedRentPct', group: 'stressconst', label: 'Combined case: rent (\u2212%)', value: '5', step: '1', min: '0', max: '50' },
    { id: 'dc-const-comb-vac', key: 'combinedVacPp', group: 'stressconst', label: 'Combined case: vacancy (+ points)', value: '3', step: '1', min: '0', max: '50' },
    { id: 'dc-const-comb-opex', key: 'combinedOpexPct', group: 'stressconst', label: 'Combined case: operating cost (+%)', value: '5', step: '1', min: '0', max: '50' }
  ];
  // The live page's rule (deal-calculator.js, _constMap): a value at or above zero, divided by 100; anything else keeps
  // the default.
  function constantsFrom(fields) {
    var c = Object.assign({}, CONSTANTS);
    CONST_INPUTS.forEach(function (i) { var v = parseFloat(fields[i.id]); if (isFinite(v) && v >= 0) c[i.key] = v * 0.01; });
    return c;
  }
  var CHECKBOX_IDS = INPUTS.concat(CREDIT_INPUTS).filter(function (i) { return i.type === CHECK; }).map(function (i) { return i.id; });
  // The live page's soft-funding programs (Soft Funding Stack). Retired labels stay so saved deals load; never offered new.
  var SOFT_PROGRAMS = [['chfa_htf', 'CHFA HTF (retired label; use CHFA HOF or CMF)', true], ['prop123', 'Prop 123'], ['local_pha', 'Local PHA / Housing Trust'],
    ['chfa_cmf', 'CHFA Capital Magnet Fund'], ['dola_htf', 'DOLA HTF (retired label; use DOH HDG or HDLF)', true], ['home', 'HOME'], ['cdbg', 'CDBG'], ['nhtf', 'NHTF'],
    ['impact_fee_loan', 'Impact Fee Loan / Waiver'], ['sponsor_loan', 'Sponsor / Affiliate Loan'], ['historic_tc', 'Historic Tax Credit (cash equiv.)'],
    ['nmtc', 'NMTC (cash equiv.)'], ['seller_carry', 'Seller-carry note'], ['other', 'Other / custom']];
  var FEDERAL_FUND_DEFAULTS = { home: 'federal', cdbg: 'federal', nhtf: 'federal', chfa_cmf: 'federal', prop123: 'nonfederal' };
  var MAX_TRANCHES = 5;
  // Which record in data/policy/soft-funding-status.json each program option reads, as the live page's program
  // reference (F197, SOFT_REFERENCE) maps them. A program with no record has no verified terms.
  // Where the amount comes from when the program reference publishes no cap: who sets it and the page that says so,
  // each read on the date given. None of it is a COHO estimate.
  var DOH_RESOURCES = 'https://doh.colorado.gov/colorado-division-housing-resources';
  var AMOUNT_SOURCE = {
    home: { text: 'DOH publishes no HOME cap. Each award is sized project by project in a competitive round, based on timing, availability and department priorities. Cities and counties that get HOME directly from HUD award their own, so ask them first.', url: DOH_RESOURCES, label: 'Colorado Division of Housing funding resources', checked: '2026-11-01' },
    nhtf: { text: 'DOH publishes no Housing Trust Fund cap. Awards are sized project by project in a DOH round, for units at 30% of area median income or below. Ask DOH for the next round.', url: DOH_RESOURCES, label: 'Colorado Division of Housing funding resources', checked: '2026-11-01' },
    cdbg: { text: 'No published CDBG cap. Cities and counties that get CDBG directly from HUD award their own; elsewhere, DOH funds projects one at a time when money is available.', url: 'https://doh.colorado.gov/community-development-block-grant-cdbg', label: 'Colorado Division of Housing CDBG', checked: '2026-11-01' },
    nmtc: { text: 'The amount is set by a Community Development Entity that holds an allocation, not by the CDFI Fund. Ask a CDE with a current allocation for a term sheet.', url: 'https://www.cdfifund.gov/programs-training/programs/new-markets-tax-credit', label: 'CDFI Fund, New Markets Tax Credit', checked: '2026-10-26' },
    historic_tc: { text: 'The federal credit is 20 percent of qualified rehabilitation expenditures. Enter its cash value: the credit times the price your investor quotes.', url: 'https://www.law.cornell.edu/uscode/text/26/47', label: '26 U.S.C. 47(a)(2)', checked: '2026-11-01' },
    impact_fee_loan: { text: 'The local government sets the amount. Ask its planning or finance department for its fee schedule and waiver policy.' },
    local_pha: { text: 'No statewide cap. The housing authority or local trust sets the amount; use its award letter or term sheet.' },
    sponsor_loan: { text: 'No program cap. The sponsor sets the amount; use the loan agreement.' },
    seller_carry: { text: 'No program cap. The seller sets the amount; use the purchase agreement or note.' },
    other: { text: 'Use the lender\u2019s or funder\u2019s term sheet or commitment letter for the amount.' }
  };
  // One line on where the amount comes from: the published cap with its page and date, or who sets it and how to get it.
  function amountSource(t, rec) {
    var cap = rec && rec.max_rule && rec.max_rule.max_amount, amt = Number(t.amount);
    var link = function (url, label, checked) {
      url = httpsUrl(url);
      return url ? ' <span class="metric-source"><a href="' + esc(url) + '">' + esc(label) + ' \u2197</a>' + (checked ? ', checked ' + esc(checked) : '') + '</span>' : '';
    };
    if (typeof cap === 'number' && isFinite(cap)) {
      return '<p data-program-cap data-cap-source="published">Published project cap: ' + esc(money(cap)) + '.' + link(rec.source_url, rec.name, rec.last_verified) +
        (amt > cap ? ' <strong class="over">The amount entered is above it.</strong>' : '') + '</p>';
    }
    var how = AMOUNT_SOURCE[t.program];
    if (!how) return '<p data-program-cap data-cap-source="none">No published project cap. Use the funder\u2019s term sheet or award letter for the amount.</p>';
    return '<p data-program-cap data-cap-source="how">' + esc(how.text) + link(how.url, how.label, how.checked) + '</p>';
  }
  var SOFT_REFERENCE = { chfa_htf: 'CHFA-HTF', prop123: 'PROP123-AHTF', chfa_cmf: 'CHFA-CMF', dola_htf: 'DOLA-HTF', home: 'HOME-CO', nhtf: 'NHTF-CO', nmtc: 'NMTC-CO' };
  var IMPACT_FEE_NOTE = 'C.R.S. 29-20-104.5(5): a local government \"may waive\" an impact fee on low- or moderate-income or affordable employee housing as it defines it — permitted, not required. Subsection (6) allows deferring collection to building permit or certificate of occupancy. Water/sewer taps are often charged by a separate district.';
  // The live page's first row and the row its "Add" button makes.
  function seedTranche() { return { program: 'other', amount: '0', mode: 'loan', loanType: 'amortizing', rate: '3', term: '30', maturity: '30', ioYears: '2', cashflowPayPct: '100', priority: '5', fundSource: '' }; }
  function addedTranche() { return { program: 'prop123', amount: '0', mode: 'loan', loanType: 'accrue_defer', rate: '0', term: '30', maturity: '30', ioYears: '2', cashflowPayPct: '0', priority: '8', fundSource: 'nonfederal' }; }
  var TRANCHE_KEYS = ['program', 'amount', 'mode', 'loanType', 'rate', 'term', 'maturity', 'ioYears', 'cashflowPayPct', 'priority', 'fundSource'];
  // Finding 6: where each starting value comes from. "rule" cites the adopted rule in the pinned
  // data/policy/lihtc-underwriting-rules.json, with its source link and the file's check date; "tool" is the live
  // calculator's own screening default; "example" is the live page's illustration; "agreement" and "lender" are terms
  // a partnership agreement, investor letter, management agreement, construction contract or lender sets. No range is
  // added that a source does not give.
  var KIND_TEXT = {
    tool: 'Tool default from the full Deal Calculator, for screening. Not a Colorado benchmark.',
    example: 'Illustration from the full Deal Calculator. Replace it with your own figure.',
    agreement: 'Set by your partnership agreement, investor letter or management agreement.',
    lender: 'Set by your lender\u2019s term sheet or construction contract.'
  };
  var SOURCE_TAGS = {
    'dc-dcr': ['tool', 'min_debt_coverage'], 'dc-deferred-auto-balance': ['tool'], 'dc-deferred-repay-cap': ['tool', 'deferred_fee_repayment_review'], 'dc-rate': ['lender'], 'dc-term': ['lender'], 'dc-deferred-pct': ['tool', 'deferred_fee_repayment_review'],
    'dc-rep-reserve': ['tool', 'replacement_reserve_minimum'], 'dc-prop-tax': ['example'], 'dc-equity-price': ['equity'],
    'dc-exit-hold': ['tool'], 'dc-exit-cap': ['tool'], 'pf-rent-growth': ['tool', 'pro_forma_rent_growth'], 'pf-exp-growth': ['tool', 'pro_forma_expense_growth'], 'pf-years': ['tool'],
    'dc-wf-lp-equity': ['agreement'], 'dc-wf-pref': ['agreement'], 'dc-wf-gp-residual': ['agreement'], 'dc-wf-catchup': ['agreement'], 'dc-wf-lp-ops-share': ['agreement'], 'dc-wf-exit': ['agreement'], 'dc-wf-buyout': ['agreement'],
    'dc-stress-equity-price': ['tool'], 'dc-stress-tdc-overrun': ['tool'], 'dc-stress-rent-low': ['tool'], 'dc-stress-leaseup': ['tool'], 'dc-stress-dscr-floor': ['tool', 'min_debt_coverage'],
    'dc-senior-mode': ['lender'], 'dc-senior-amount': ['lender'], 'dc-senior-type': ['lender'], 'dc-senior-maturity': ['lender'], 'dc-senior-io-years': ['lender'], 'dc-senior-priority': ['lender'], 'dc-senior-cfpay': ['lender'],
    'dc-bridge-ds': ['lender'], 'dc-bridge-years': ['lender'], 'dc-asset-mgmt-fee': ['agreement'], 'dc-asset-mgmt-growth': ['agreement'],
    'dc-constr-loan': ['lender'], 'dc-constr-rate': ['lender'], 'dc-constr-months': ['lender'], 'dc-constr-draw': ['lender'],
    'dc-fed-payin-closing': ['agreement'], 'dc-fed-payin-completion': ['agreement'], 'dc-fed-payin-stabilization': ['agreement'],
    'dc-draw-curve': ['tool'], 'dc-draw-convert-months': ['tool'], 'dc-draw-retainage': ['lender'], 'dc-draw-fee-closing': ['agreement'], 'dc-draw-soft-closing': ['tool'], 'dc-draw-soft-sources': ['lender'],
    'dc-conv-rate-bp': ['tool'], 'dc-conv-noi-cut': ['tool'], 'dc-conv-credit-delivered': ['tool'], 'dc-pf-mgmt-pct': ['agreement'], 'dc-pf-tax-growth': ['tool'], 'dc-pf-reserve-growth': ['tool'],
    'dc-pf-reserve-yield': ['tool'], 'dc-after-refi-rate': ['lender'], 'dc-after-refi-term': ['lender'], 'dc-after-refi-dcr': ['lender'], 'dc-after-refi-cost': ['lender'], 'dc-after-land-pct': ['tool'],
    'dc-after-rehab-rate': ['tool'], 'dc-after-resyn-price': ['agreement'],
    'dc-qap-year': ['tool', 'credit_cap_federal_9pct'], 'dc-pilot-gap': ['tool', 'credit_cap_federal_9pct'],
    'dc-state-price': ['coho'], 'dc-state-payin-closing': ['agreement'], 'dc-state-payin-completion': ['agreement'], 'dc-state-payin-stabilization': ['agreement'],
    'dc-add-price': ['agreement'], 'dc-add-fees': ['agreement'], 'dc-add-payin-closing': ['agreement'], 'dc-add-payin-completion': ['agreement'], 'dc-add-payin-stabilization': ['agreement'],
    'dc-const-rent-stress': ['tool'], 'dc-const-vac-stress': ['tool'], 'dc-const-opex-stress': ['tool'], 'dc-const-comb-rent': ['tool'], 'dc-const-comb-vac': ['tool'], 'dc-const-comb-opex': ['tool']
  };
  // The tag under a field: who sets it, and for a CHFA rule its verbatim quote, location, link and check date.
  function sourceTag(i) {
    var t = SOURCE_TAGS[i.id];
    if (!t) return '';
    var html = '';
    if (t[0] === 'equity') {
      var m = data.equity && data.equity.meta;
      html = 'Blank uses the Novogradac national average' + (m && m.as_of ? ' as of ' + esc(m.as_of) : '') + (m && httpsUrl(m.source_url) ? ' (<a href="' + esc(m.source_url) + '">Novogradac \u2197</a>)' : '') + '. Replace it with your investor\u2019s letter of intent.';
    } else if (t[0] === 'coho') {
      html = 'COHO starting assumption, kept on purpose and editable. No public source.';
    } else html = esc(KIND_TEXT[t[0]]);
    var rules = data.rules, rule = t[1] && rules && rules.rules && rules.rules[t[1]];
    if (rule && rule.status === 'adopted') {
      var src = rules.sources[rule.source] || {};
      var quote = String(rule.quote || '').split(/(?<=\.)\s/)[0];
      html += ' CHFA rule: \u201c' + esc(quote) + '\u201d ' + (httpsUrl(src.url) ? '<a href="' + esc(src.url) + '">' + esc(src.title || rule.source) + ', ' + esc(rule.location) + ' \u2197</a>' : esc((src.title || rule.source) + ', ' + rule.location)) +
        ', checked ' + esc(rules.meta && rules.meta.last_verified || '') + '.';
    }
    return '<small class="src" data-src="' + esc(t[0]) + '">' + html + '</small>';
  }

  // The DOH loan type and maximum-loan-by-value fields (calc-doh.js, calculator move piece C).
  var DOH = function () { return global.LabCalcDoh || null; };
  // The site and scale helpers (calc-site.js): gross area from the homes, site coordinates, pre-fill, concept.
  var SITE = function () { return global.LabCalcSite || null; };
  var FIELDS = INPUTS.concat(LOAN_INPUTS, LS_INPUTS, WF_INPUTS, STRESS_INPUTS, CREDIT_INPUTS, RENT_CAP_INPUTS, NOI_INPUTS, CONST_INPUTS, DOH() ? DOH().INPUTS : [], SITE() ? SITE().INPUTS : []);

  var data = { chfa: null, hud: null, equity: null, rules: null, error: null, loading: false, rateHint: undefined };
  function loadData() {
    if (data.loading || data.rules || data.error) return;
    data.loading = true;
    var get = function (f) { return fetch(VENDOR + f).then(function (r) { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); }); };
    Promise.all([get('data/chfa-income-rent-limits-2026.json'), get('data/hud-fmr-income-limits.json'),
      get('data/market/novogradac-equity-pricing.json'), get('data/policy/lihtc-underwriting-rules.json')])
      .then(function (r) { data.chfa = r[0]; data.hud = r[1]; data.equity = r[2]; data.rules = r[3]; Shell.render(); })
      .catch(function (e) { data.error = 'The data did not load (' + e.message + '). Reload the page to try again.'; Shell.render(); });
    // CHFA's 2027 Common Application cost limits, which the live page loads for its cost-limit check. Optional, as on
    // the live page: a miss leaves the check saying the tables are unavailable.
    get('data/policy/chfa-common-app-tables.json').then(function (t) { data.commonApp = t; Shell.render(); }).catch(function () { data.commonApp = null; Shell.render(); });
    // The live page's soft-funding program reference and the Prop 123 entry of its policy timeline. Optional: a miss
    // leaves each source card saying its terms did not load.
    Promise.all([get('data/policy/soft-funding-status.json'), get('data/policy/policy-timeline.json').catch(function () { return null; })]).then(function (r) {
      data.soft = r[0]; data.prop123 = r[1] && (r[1].events || []).filter(function (e) { return e.id === 'prop123'; })[0] || null; Shell.render();
    }).catch(function () { data.soft = null; Shell.render(); });
    // The live page's rate hint: the latest 10-year Treasury plus its stated spread. Optional; a miss shows a reason.
    Promise.all([get('data/fred-data.json'), get('data/policy/lihtc-assumptions.json')]).then(function (r) {
      var obs = (r[0].series && r[0].series.DGS10 && r[0].series.DGS10.observations) || [], t10 = null;
      for (var i = obs.length - 1; i >= 0 && !t10; i--) { var v = Number(obs[i].value); if (obs[i].value !== '.' && obs[i].value !== '' && isFinite(v) && v > 0) t10 = { value: v, date: obs[i].date }; }
      var a = r[1].permRateSpreadOverTreasury, spread = a && isFinite(a.spreadPct) && a.spreadPct >= 0 ? a.spreadPct : null;
      data.rateHint = t10 && spread != null ? { t10: t10.value, date: t10.date, spread: spread } : null;
      Shell.render();
    }).catch(function () { data.rateHint = null; Shell.render(); });
  }

  function money(n) { return n == null ? null : (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US'); }
  function pct(n, d) { return n == null ? null : (n * 100).toFixed(d == null ? 1 : d) + '%'; }
  function ratio(n) { return n == null ? null : n.toFixed(2) + 'x'; }

  // DOH's operating budget lines, per home per year (js/deal-operating-budget.js at the pin). A new draft starts
  // from the live page's own invented example, which totals $5,400 a year ($450 a month), so it is marked as an
  // example and not a benchmark. Taxes and the replacement reserve stay on their own inputs, as on the live page.
  function OB() { return global.DealOperatingBudget; }
  function exampleOperating() {
    var lines = {}, income = {};
    OB().LINE_TEMPLATE.forEach(function (t) { lines[t.id] = String(OB().EXAMPLE_BUDGET[t.id]); });
    OB().INCOME_TEMPLATE.forEach(function (t) { income[t.id] = String(OB().EXAMPLE_INCOME[t.id]); });
    return { lines: lines, income: income };
  }
  function emptyDraft() {
    var fields = {};
    FIELDS.forEach(function (i) { fields[i.id] = i.value; });
    var costs = {};
    costIds().forEach(function (id) { costs[id] = ''; });
    var op = exampleOperating();
    return { fields: fields, costs: costs, basis: {}, parts: {}, used: {}, opLines: op.lines, opIncome: op.income, opExample: true, tranches: [seedTranche()], grid: null };
  }
  // Drafts saved before a field existed get its default; a field the lab no longer shows is dropped.
  function draftFor(p, scenarioId) {
    var o = p.overrides[scenarioId] && p.overrides[scenarioId].financialsDraft;
    var d = emptyDraft();
    if (!o) return d;
    FIELDS.forEach(function (i) { if (o.fields && o.fields[i.id] != null) d.fields[i.id] = String(o.fields[i.id]); });
    costIds().forEach(function (id) { if (o.costs && o.costs[id] != null) d.costs[id] = String(o.costs[id]); });
    // A draft saved before the basis choice existed keeps each line's starting choice, which is what it ran with.
    d.basis = Object.assign({}, o.basis); d.parts = Object.assign({}, o.parts); d.used = Object.assign({}, o.used);
    // The unit grid's fields (calc-grid.js), for a scenario whose homes are typed there.
    d.grid = o.grid && typeof o.grid === 'object' ? JSON.parse(JSON.stringify(o.grid)) : null;
    if (Array.isArray(o.tranches) && o.tranches.length) d.tranches = o.tranches.slice(0, MAX_TRANCHES).map(function (t) {
      var c = {}; TRANCHE_KEYS.forEach(function (k) { c[k] = t[k] == null ? '' : String(t[k]); });
      // The DOH answers on a source (calc-doh.js). One saved before they existed starts at the program's defaults.
      if (DOH()) DOH().KEYS.forEach(function (k) { if (t[k] != null) c[k] = String(t[k]); });
      return c;
    });
    if (o.opLines) {
      OB().LINE_TEMPLATE.forEach(function (t) { d.opLines[t.id] = o.opLines[t.id] == null ? '' : String(o.opLines[t.id]); });
      OB().INCOME_TEMPLATE.forEach(function (t) { d.opIncome[t.id] = o.opIncome && o.opIncome[t.id] != null ? String(o.opIncome[t.id]) : ''; });
      d.opExample = !!o.opExample;
    } else if (o.fields && o.fields['dc-opex'] != null) {
      // A draft saved with the old single monthly figure moves it, times 12, into "Other expenses, Other" and
      // empties every other line, the live page's own rule for old share links, so its results are unchanged.
      var old = OB().legacyOperatingFields(function (key) { return key === 'opex' ? o.fields['dc-opex'] : null; });
      OB().LINE_TEMPLATE.forEach(function (t) { d.opLines[t.id] = old['op-' + t.id] || ''; });
      OB().INCOME_TEMPLATE.forEach(function (t) { d.opIncome[t.id] = old['op-income-' + t.id] || ''; });
      d.opExample = false; d.opMoved = true;
    }
    return d;
  }

  function currentSchedule(p, scenarioId) {
    return p.attachments.filter(function (a) { return a.scenarioId === scenarioId && a.kind === 'rent-schedule' && a.state !== 'replaced'; })[0] || null;
  }

  function equityDefault(creditType, equityDoc) {
    var nat = equityDoc && equityDoc.pricing && equityDoc.pricing.national_avg;
    var nine = nat && typeof nat.credit_9pct === 'number' ? nat.credit_9pct : null;
    var four = nat && typeof nat.credit_4pct === 'number' ? nat.credit_4pct : null;
    var d = nine && four ? { credit_9pct: nine, credit_4pct: four } : FALLBACK_EQUITY;
    return creditType === '4' ? d.credit_4pct : d.credit_9pct;
  }

  // Builds exactly what deal-calculator.html's readDealInputs() hands to DealEngine.computeDeal,
  // for a rental deal whose unit mix comes from the saved Market Analysis-style schedule. With mods.grid (a scenario
  // whose homes are typed in the unit grid) there is no schedule to read: everything here that is not about homes
  // and rents is built the same way, and calc-grid.js then sets the homes and rents as the live page's grid does.
  function buildInputs(draft, scheduleSnapshot, sources, mods) {
    var C = mods.ChfaRentLimits, B = mods.DealCostBasis;
    var G = mods.grid || null;
    var subject = G ? { county_fips: G.grid['dc-county-select'] || null } : scheduleSnapshot.subject, result = G ? {} : scheduleSnapshot.result;
    var fips = subject.county_fips;
    var fields = {};
    FIELDS.forEach(function (i) { fields[i.id] = draft.fields[i.id]; });
    // The live page reads these as ticked boxes (true or false); the engine tests each with !!.
    CHECKBOX_IDS.forEach(function (id) { fields[id] = draft.fields[id] === 'yes' || draft.fields[id] === true; });
    var credit = draft.fields['dc-credit'] === '4' ? '4' : '9';
    fields['dc-mode-rental'] = true; fields['dc-mode-ownership'] = false;
    fields['dc-rate-9'] = credit === '9'; fields['dc-rate-4'] = credit === '4';
    fields['dc-units'] = String(result.scheduledUnits || '');
    fields['dc-vacancy'] = result.vacancyRate == null ? '' : String(result.vacancyRate * 100);
    fields['dc-county-select'] = fips;
    fields['dc-rent-limit-regime'] = 'chfa_lihtc';
    fields['dc-minimum-set-aside'] = SET_ASIDE_HELP[draft.fields['dc-minimum-set-aside']] ? draft.fields['dc-minimum-set-aside'] : '40-60';
    fields['dc-unit-mix-source'] = 'auto';
    fields['dc-unrepresented-schedule-rows'] = '[]';
    fields['dc-auto-noi'] = draft.fields['dc-auto-noi'] !== 'no';
    // A blank manual NOI stays blank: the engine reads it as unknown and holds the mortgage and gap (Codex, #2794).
    fields['dc-noi'] = draft.fields['dc-noi'] == null ? '' : String(draft.fields['dc-noi']);
    fields['dc-achievable-cap'] = false; fields['dc-qct-dda'] = false;
    if (SITE()) SITE().engineFields(fields, draft); else { fields['dc-gsf-standard'] = ''; fields['dc-gsf-efficiency'] = '0.80'; }
    fields['dc-market-rent-mode'] = 'zori'; fields['dc-market-bedroom'] = '2br'; fields['dc-market-rent-source'] = '';
    DEAL_AMI_BANDS.forEach(function (t) {
      fields['dc-chk-' + t] = false; fields['dc-units-' + t] = '0'; fields['dc-br-' + t] = '2br';
      SPLIT_BR_TYPES.forEach(function (br) { fields['dc-units-' + t + '-' + br] = '0'; });
    });
    fields['dc-const-rent-burden'] = '30';
    var constants = constantsFrom(fields);
    if (fields['dc-equity-price'] === '') fields['dc-equity-price'] = String(equityDefault(credit, sources.equity));
    if (!fields['dc-stress-equity-price']) fields['dc-stress-equity-price'] = fields['dc-equity-price'];

    var amiLimits = {}, amiLimitsByBr = {};
    DEAL_AMI_BANDS.forEach(function (tier) {
      amiLimitsByBr[tier] = {};
      SPLIT_BR_TYPES.forEach(function (br) {
        amiLimitsByBr[tier][br] = C.rentCeiling({ regime: 'chfa_lihtc', chfaTable: sources.chfa, fips: fips, tier: tier, bedrooms: RENT_BEDROOMS[br], rentBurden: CONSTANTS.rentBurdenPct, useHera: false }).grossRent;
      });
      amiLimits[tier] = amiLimitsByBr[tier]['2br'];
    });
    var county = (sources.hud && sources.hud.counties || []).filter(function (c) { return c.fips === fips; })[0];
    // Each line is read the way the live page's readCostLines reads it: amount, the basis choice, the part in basis,
    // and the use so far for a contingency, each blank unless the visitor entered it. The example budget's amounts,
    // parts and uses are never sent.
    var blank = function (v) { return v == null || v === '' ? null : String(v); };
    var parts = draft.parts || {}, used = draft.used || {};
    var costLines = B.LINE_TEMPLATE.map(function (t) {
      var line = { id: t.id, label: t.label, group: t.group, basis: lineBasis(draft, t), amount: blank((draft.costs || {})[t.id]), eligibleAmount: blank(parts[t.id]) };
      if (B.CONTINGENCY_KINDS[t.id]) line.used = blank(used[t.id]);
      return line;
    });
    var out = {
      fields: fields,
      resolvedDealMix: G ? null : C.dealMixFromSchedule(result, { countyFips: fips, regime: 'chfa_lihtc' }),
      amiLimits: amiLimits, amiLimitsByBr: amiLimitsByBr, countyFips: fips, creditRate: CREDIT_RATES[credit],
      constants: constants, utilityAllowance: { applied: false, reason: 'schedule_rents_are_net' },
      equityPriceDefault: equityDefault(credit, sources.equity), minimumSetAsideElection: fields['dc-minimum-set-aside'], regime: 'chfa_lihtc',
      perBrMarket: null, manualMarket: null, hasUnitMixWarning: false,
      // As window.DealCalcSoftTranches() hands them over: numbers, a blank as null, the ids the live rows carry.
      tranches: (draft.tranches && draft.tranches.length ? draft.tranches : [seedTranche()]).map(function (t, i) {
        var n = function (v) { return v == null || String(v).trim() === '' ? null : Number(v); };
        var row = { id: i + 1, program: t.program, amount: n(t.amount), mode: t.mode === 'grant' ? 'grant' : 'loan', loanType: t.loanType,
          rate: n(t.rate), term: n(t.term), maturity: n(t.maturity), ioYears: n(t.ioYears), cashflowPayPct: n(t.cashflowPayPct), priority: n(t.priority),
          fundSource: t.fundSource || '' };
        // Where the source counts for DOH, what it pays for, its status and whether it is a state request. The
        // engine carries these through to the DOH tables; it prices nothing from them.
        if (DOH()) { var doh = DOH().engine(t); row.doh = doh.doh; row.stateRequest = doh.stateRequest; row.status = doh.status; row.activity = doh.activity; }
        return row;
      }),
      costLines: costLines, costRules: sources.rules, chfaCommonAppTables: sources.commonApp == null ? null : sources.commonApp,
      // Read the way the live page's readOperatingLines reads them: a blank line is null, never 0.
      operatingLines: OB().LINE_TEMPLATE.map(function (t) { return { id: t.id, label: t.label, group: t.group, amount: blank((draft.opLines || {})[t.id]) }; }),
      otherIncomeLines: OB().INCOME_TEMPLATE.map(function (t) { return { id: t.id, label: t.label, amount: blank((draft.opIncome || {})[t.id]) }; }),
      fmrData: county ? county.fmr : null
    };
    return G ? global.LabCalcGrid.inputs(out, G, sources) : out;
  }
  // The engine inputs for a scenario: from its unit grid when its homes are typed there, else from its saved rent
  // schedule. Null when it has neither yet, or the grid's own files are still loading.
  function inputsFor(p, scenarioId, d) {
    var mods = { ChfaRentLimits: global.ChfaRentLimits, DealCostBasis: global.DealCostBasis };
    var G = global.LabCalcGrid ? global.LabCalcGrid.ctx(p, scenarioId, d) : null;
    if (G) {
      // Start the grid's files here too: the comparison table reaches a grid scenario from a page that never opened one.
      if (!global.LabCalcGrid.ready()) { global.LabCalcGrid.load(); return null; }
      mods.grid = G; return buildInputs(d, null, data, mods);
    }
    var sched = currentSchedule(p, scenarioId);
    return sched ? buildInputs(d, sched.snapshot, data, mods) : null;
  }

  function unavailable(result, path) {
    return result.unavailable && result.unavailable[path] || 'Not available for these inputs.';
  }
  // The live page's help for each federal minimum set-aside election, and its status line from the engine's own test
  // (DealEngine.evaluateMinimumSetAside, result.minimumSetAsideResult).
  var SET_ASIDE_HELP = {
    '20-50': 'The 20-50 election requires at least 20% of residential units at 50% AMI or below, and only units at 50% AMI or below are low-income units under it (26 U.S.C. 42(g)(1)(A) and 42(i)(3)(A)). Units above 50% AMI earn no credit under this election.',
    '40-60': 'The default 40-60 election requires at least 40% of residential units at 60% AMI or below.',
    'average-income': 'The Average Income Test permits 20%-80% designations when at least 40% of units are in the group and their designated average is no more than 60% AMI. CHFA currently requires every residential unit in a Colorado AIT project to be designated low-income.'
  };
  function setAsideStatus(r) {
    var m = r.minimumSetAsideResult;
    if (!m) return '';
    var share = m.minimumSharePct == null ? 'not available' : m.minimumSharePct.toFixed(1) + '%';
    var detail = m.setAsideUnits + ' of ' + m.totalUnits + ' units in the minimum set-aside (' + share + ').' +
      (m.election === 'average-income' ? ' Designated AIT average: ' + (m.averageAmiPct == null ? 'not available' : m.averageAmiPct.toFixed(1) + '% AMI') + '.' : '');
    return '<div class="set-aside ' + (m.qualifies ? 'is-ok' : 'is-bad') + '" data-role="set-aside" role="status"><p><strong>' + esc(m.qualifies ? 'Qualifies under this screening test.' : 'Does not qualify under this screening test.') + '</strong> ' +
      esc(detail + (m.qualifies ? ' ' + m.countedLihtcUnits + ' units count toward the applicable-fraction screen.' : ' Reason: ' + m.reason + '. No units are counted toward qualified basis.')) + '</p>' +
      '<p class="note">' + esc(SET_ASIDE_HELP[m.election]) + '</p></div>';
  }

  // What the deal assumes about the 30% basis boost, in words every summary uses: a HUD designation (QCT, DDA or
  // Small Area DDA) or CHFA's discretionary boost, with the percentage the engine applied, or none.
  var BOOST_SHORT = { qct: 'QCT', dda: 'DDA', sadda: 'Small Area DDA', chfa: 'CHFA discretionary' };
  function boostTag(r, fields) {
    var b = r && r.costBasis && r.costBasis.basis && r.costBasis.basis.boost, key = fields && fields['dc-boost-designation'] || 'none';
    var name = BOOST_SHORT[key];
    if (b && b.applied) {
      var p = Math.round((b.multiplier - 1) * 100);
      return { kind: key === 'chfa' ? 'discretionary' : 'hud', short: name + ' boost ' + p + '%',
        text: key === 'chfa' ? 'CHFA discretionary basis boost, ' + p + '% (CHFA must award it: 26 U.S.C. 42(d)(5)(B)(v); CHFA QAP Section 3.M.2)' : name + ' basis boost, ' + p + '% (HUD designation)' };
    }
    if (name) return { kind: 'not-applied', short: name + ' boost not applied', text: name + ' boost picked but not applied: ' + (b && b.reason || 'not available') };
    return { kind: 'none', short: 'No boost', text: 'No basis boost assumed' };
  }
  // Eligible basis to qualified basis, line by line from the engine's own basis (result.costBasis.basis).
  function basisSection(r, fields) {
    var b = r.costBasis && r.costBasis.basis, tag = boostTag(r, fields);
    if (!b) return '';
    var why = function (k) { return (b.reasons && b.reasons[k]) || 'Not available for these inputs.'; };
    var rows = [['Eligible basis', b.eligibleBasis == null ? why('eligibleBasis') : money(b.eligibleBasis), 'Itemized costs that count toward basis.']];
    if (b.feeReduction > 0) rows.push(['Less developer fee above CHFA\u2019s limit', money(-b.feeReduction)]);
    if (b.grantReduction > 0) rows.push(['Less federal grants', money(-b.grantReduction), '26 U.S.C. 42(d)(5)(A).']);
    rows.push(['Basis before the boost', b.afterGrant == null ? why('afterGrant') : money(b.afterGrant)]);
    rows.push(['Basis boost', tag.text, b.boost && b.boost.applied && b.boost.citation ? b.boost.citation : null]);
    if (b.boost && b.boost.applied && b.boostedBasis != null && b.afterGrant != null) rows.push(['Added by the boost', money(b.boostedBasis - b.afterGrant), 'Acquisition basis is never boosted.']);
    rows.push(['Basis after the boost', b.boostedBasis == null ? why('afterGrant') : money(b.boostedBasis)]);
    rows.push(['Applicable fraction', b.applicableFraction == null ? why('applicableFraction') : pct(b.applicableFraction)]);
    rows.push(['Qualified basis', b.qualifiedBasis == null ? why('applicableFraction') : money(b.qualifiedBasis), 'The credit is figured on this.']);
    return '<section class="fin-section" aria-labelledby="fin-basis" data-role="basis"><h2 id="fin-basis">Eligible basis and the boost</h2>' +
      '<dl class="basis-dl">' + rows.map(function (x) {
        return '<div' + (x[0] === 'Basis boost' ? ' class="boost-' + tag.kind + '"' : '') + '><dt>' + esc(x[0]) + (x[2] ? '<small>' + esc(x[2]) + '</small>' : '') + '</dt><dd>' + esc(x[1]) + '</dd></div>';
      }).join('') + '</dl></section>';
  }

  function card(title, value, result, path, why) {
    return '<div class="fin-card"><h3>' + esc(title) + '</h3>' +
      (value == null ? '<p class="big unavail">Unavailable</p><p class="why">' + esc(unavailable(result, path)) + '</p>'
        : '<p class="big">' + esc(value) + '</p>' + (why ? '<p class="why">' + esc(why) + '</p>' : '')) + '</div>';
  }

  // Sources and uses, stress, exit and the year-by-year projection: each is the engine's own result, laid out
  // the way the live Deal Calculator shows it. Nothing here adds, rounds into, or re-derives a figure.
  var dash = function (v, f) { return v == null || !isFinite(v) ? '\u2014' : f(v); };
  // The rows of the sources and uses table, from the engine's own result. The table below and the lender
  // download (site/lender-export.js) both read them, so the two never disagree. Each source is
  // [label, amount, result path, colour key, reason]; each use is [label, amount].
  function sourcesUsesRows(r) {
    var B = global.DealCostBasis;
    if (!r.budget || !r.budget.groups) return null;
    var uses = B.GROUPS.filter(function (g) { return r.budget.groups[g.id]; }).map(function (g) { return [g.label, r.budget.groups[g.id]]; });
    if (r.budget.notItemized) uses.push(['Not itemized (outside eligible basis)', r.budget.notItemized]);
    // Each soft source on its own line, from the engine's own breakdown; with none entered, the two totals show $0.
    var soft = (r.trancheBreakdown || []).length && isFinite(r.totalLoanPrincipal)
      ? r.trancheBreakdown.map(function (t) { return [programLabel(t.program) + (t.mode === 'grant' ? ' (grant)' : ' (loan)'), t.amount, t.mode === 'grant' ? 'totalGrant' : 'totalLoanPrincipal', 'soft']; })
      : [['Soft loans', r.totalLoanPrincipal, 'totalLoanPrincipal', 'soft'], ['Grants', r.totalGrant, 'totalGrant', 'soft']];
    // The equity the gap counts, as the live table shows it: federal, state when one is entered, and an added credit
    // once it is counted, each less what an added credit replaces or cuts (result.creditStack).
    var cs = r.creditStack || { federal: r.equity, state: r.stateEquity, added: 0 };
    var num = function (v) { return v == null || !isFinite(v) ? null : v; };
    var sc = r.costBasis && r.costBasis.stateCredit;
    var credits = [['Federal credit equity', num(cs.federal), 'equity', 'equity']];
    if (sc && sc.entered) credits.push(['State credit equity', num(cs.state), null, 'equity', sc.reason]);
    if (cs.counted) credits.push([(cs.label || 'Added credit') + ' equity, after its investor fees', num(cs.added), null, 'equity']);
    var sources = credits.concat([['First mortgage', r.mortgage, 'mortgage', 'mortgage']], soft, [
      ['Deferred developer fee', r.deferredDevFee, 'deferredDevFee', 'fee'], ['Still to fund (gap)', r.gap != null && r.gap > 0 ? r.gap : r.gap == null ? null : 0, 'gap', 'gap']]);
    if (r.gap != null && r.gap < 0) sources.push(['Sources above the cost', -r.gap, 'gap', null]);
    return { sources: sources, uses: uses, credits: cs, tdc: r.tdc };
  }
  function sourcesUses(r) {
    var su = sourcesUsesRows(r);
    // In its own section, like the full table: a bare heading that starts with "Sources" is read by the shared
    // sources fold (templates.js) as a source list, and it folded everything after it, the Save button included.
    if (!su) return '<section class="fin-section" aria-labelledby="fin-su"><h2 id="fin-su">Sources and uses</h2><p class="note">' + esc(unavailable(r, 'budget.groups')) + '</p></section>';
    var sources = su.sources, uses = su.uses, cs = su.credits, tdc = su.tdc;
    var known = sources.every(function (x) { return x[1] != null; });
    var whole = sources.reduce(function (t, x) { return t + (x[3] && x[1] > 0 ? x[1] : 0); }, 0);
    var bar = known && whole > 0 ? '<div class="stack-bar" role="img" aria-label="' + esc(sources.filter(function (x) { return x[3] && x[1] > 0; }).map(function (x) { return x[0] + ' ' + pct(x[1] / whole, 0); }).join(', ')) + '">' +
      sources.filter(function (x) { return x[3] && x[1] > 0; }).map(function (x) {
        return '<span class="seg seg-' + x[3] + '" style="width:' + (x[1] / whole * 100).toFixed(2) + '%" title="' + esc(x[0] + ': ' + money(x[1])) + '"></span>';
      }).join('') + '</div>' : '';
    var rows = function (list, withReason) {
      return list.map(function (x) {
        return '<tr><th scope="row">' + (x[3] ? '<span class="key seg-' + x[3] + '" aria-hidden="true"></span>' : '') + esc(x[0]) + '</th><td class="num">' +
          (x[1] == null ? 'Unavailable' + (withReason ? '<small class="why">' + esc(x[4] || unavailable(r, x[2])) + '</small>' : '') : esc(money(x[1]))) + '</td></tr>';
      }).join('');
    };
    return '<section class="fin-section" aria-labelledby="fin-su"><h2 id="fin-su">Sources and uses</h2>' + bar +
      '<div class="su-grid"><div class="table-scroll" role="region" aria-label="Sources" tabindex="0"><table><caption>Sources</caption><tbody>' + rows(sources, true) +
      '</tbody><tfoot><tr><th scope="row">Total development cost</th><td class="num">' + esc(dash(tdc, money)) + '</td></tr></tfoot></table></div>' +
      '<div class="table-scroll" role="region" aria-label="Uses" tabindex="0"><table><caption>Uses, by the Division of Housing\u2019s cost categories</caption><tbody>' + rows(uses, false) +
      '</tbody><tfoot><tr><th scope="row">Total development cost</th><td class="num">' + esc(dash(tdc, money)) + '</td></tr></tfoot></table></div></div>' +
      (!cs.counted && cs.reason ? '<p class="note">' + esc(cs.reason) + '</p>' : '') + repayCapNote(r) +
      '<p class="note">Tax-credit equity, the first mortgage, the soft sources and the deferred fee pay for the project as a whole. Soft sources are entered under Loans and other sources; state and added credits under Tax credits.</p></section>';
  }
  // The 15-year limit on the deferred fee (CHFA reviews repayment under 2027-2028 QAP 2.B), in the live page's words: when it cuts the deferral,
  // or why it could not be checked.
  function repayCapNote(r) {
    var c = r && r.deferredRepayCap;
    if (!c || !c.on) return '';
    if (c.reason) return '<p class="note">15-year limit on the deferred fee: ' + esc(c.reason) + '</p>';
    if (c.binds) return '<p class="note">The deferred fee is held to ' + esc(money(c.repayable)) + ', what cash flow repays in years 1 to ' + esc(String(c.years)) +
      '. The cap percentage alone would allow ' + esc(money(c.bySlider)) + ' (CHFA reviews repayment under 2027-2028 QAP section 2.B). The rest is gap.</p>';
    return '';
  }
  // Case names follow the stress settings the engine ran with (inputs.constants), as on the live page.
  function pts(v) { return String(Math.round(v * 1000) / 10); }
  function combinedLabel(c) { return 'rent \u2212' + pts(c.combinedRentPct) + '%, vacancy +' + pts(c.combinedVacPp) + ' points, expenses +' + pts(c.combinedOpexPct) + '%'; }
  function stressTable(r, c) {
    c = c || CONSTANTS;
    var rowsOf = [['Base / stabilized', r.stressBase, ''], ['Rent \u2212' + pts(c.rentStressPct) + '%', r.stress && r.stress.rent10, 'Soft market or concessions'],
      ['Vacancy +' + pts(c.vacStressPp) + ' points', r.stress && r.stress.vac5, 'Slow lease-up or turnover spike'], ['Operating expenses +' + pts(c.opexStressPct) + '%', r.stress && r.stress.opex10, 'Insurance, utility or repair costs rise'],
      ['Combined: ' + combinedLabel(c), r.stress && r.stress.combined, 'The downside lenders usually underwrite against']];
    if (!r.stress) return '<section class="fin-section"><h2>Stress cases</h2><p class="note">' + esc(unavailable(r, 'stress')) + '</p></section>';
    return '<section class="fin-section" aria-labelledby="fin-stress"><h2 id="fin-stress">Stress cases</h2><div class="table-scroll" role="region" aria-label="Stress cases" tabindex="0"><table class="stress-table">' +
      '<thead><tr><th scope="col">Case</th><th scope="col" class="num">NOI</th><th scope="col" class="num">Coverage</th><th scope="col" class="num">Vs ' + esc(ratio(r.dcr) || '') + ' target</th></tr></thead><tbody>' +
      rowsOf.map(function (x) {
        var v = x[1] || {};
        var m = v.margin == null || !isFinite(v.margin) ? '\u2014' : (v.margin >= 0 ? '+' : '') + (Math.abs(v.margin) < 0.005 ? 0 : v.margin).toFixed(2);
        var dscr = v.dscr == null || !isFinite(v.dscr) ? '\u2014' : v.dscr.toFixed(2) + 'x';
        return '<tr' + (v.dscr != null && v.dscr < 1 ? ' class="below-one"' : '') + '><th scope="row">' + esc(x[0]) + (x[2] ? '<small class="why">' + esc(x[2]) + '</small>' : '') + '</th>' +
          '<td class="num">' + esc(dash(v.noi, money)) + '</td><td class="num">' + esc(dscr) + '</td><td class="num">' + esc(m) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="note">NOI is net operating income. Coverage is NOI over every required loan payment: the first mortgage plus any must-pay soft loan. The loan stays at its sized amount in each case. Below 1.00x the property does not cover its required payments. The full Deal Calculator\u2019s defaults are tool settings for screening, not a lender\u2019s or CHFA\u2019s required cases; change them under Stress case settings.</p></section>';
  }
  function exitSummary(r, inputs) {
    var e = r.exit || {};
    var hold = e.holdYears, tdc = r.tdc;
    // A figure the engine leaves blank shows the engine's own reason, never a concluded value.
    var known = function (v) { return v != null && isFinite(v); };
    var why = function (key, v, fmt) { return known(v) ? fmt(v) : 'Unavailable \u2014 ' + unavailable(r, 'exit.' + key); };
    var yearLabel = known(hold) ? 'Year-' + hold : 'Exit-year';
    var items = [[yearLabel + ' stabilized NOI', why('nNoi', e.nNoi, money)], ['Resale value (NOI \u00f7 exit cap)', why('resale', e.resale, money)],
      ['Remaining 1st mortgage balance', tdc > 0 ? why('firstMortBal', e.firstMortBal, money) : '\u2014'], ['Remaining soft-loan balance', tdc > 0 ? why('softBal', e.softBal, money) : '\u2014']];
    if (e.assetMgmtOwed > 0) items.push(['Accrued asset management fee owed', money(e.assetMgmtOwed)]);
    items.push(['Net sale proceeds (before selling costs)', why('netProceeds', e.netProceeds, money)], ['Deferred fee payback year', why('dfYr', e.dfYr || null, function (v) { return 'Year ' + v; })],
      ['Return on the deferred fee, counting all partnership cash and sale proceeds (includes the investor\u2019s share)', why('irr', e.irr, function (v) { return (v * 100).toFixed(1) + '%'; })]);
    var notes = [];
    // As on the live page: with no exit-year NOI the notes give the engine's reason and nothing else.
    if (!known(e.nNoi)) notes.push(unavailable(r, 'exit.nNoi'));
    else {
      if (known(e.rentGrowth) && known(e.expGrowth)) notes.push('Year-' + hold + ' NOI with rents changing ' + (e.rentGrowth * 100).toFixed(1) + '%/yr and ' + (e.expGrowth * 100).toFixed(1) + '%/yr expense inflation.');
      if (known(e.resale)) notes.push('Resale capitalizes NOI at ' + (e.exitCap * 100).toFixed(2) + '% exit cap.');
      if (known(e.netProceeds)) notes.push('Net sale proceeds are before selling costs (broker, transfer and closing costs are not subtracted).');
      if (known(e.irr)) notes.push('This return counts every dollar of yearly cash and sale proceeds as coming back on the deferred fee (' + money(r.deferredDevFee) + '), including the investor\u2019s share, so it overstates what the sponsor keeps. The sponsor\u2019s own return, from the partnership split, is in the waterfall below. Neither counts predevelopment spending, other GP equity or tax benefits.');
    }
    return '<section class="fin-section" aria-labelledby="fin-exit"><h2 id="fin-exit">' + esc(yearLabel) + ' exit</h2>' +
      '<dl class="exit-list" data-role="exit">' + items.map(function (x) { return '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>'; }).join('') + '</dl>' +
      (notes.length ? '<p class="note">' + esc(notes.join(' ')) + '</p>' : '') + '</section>';
  }
  // The live page's line chart of net operating income, debt service and cash flow (pf-chart), from the same
  // projection rows as the table under it. A year the engine could not compute is left off its line.
  function projectionChart(list) {
    var V = global.LabViz;
    if (!V || list.length < 2) return '';
    function pts(k) { return list.filter(function (x) { return x[k] != null && isFinite(x[k]); }).map(function (x) { return [x.year, Math.round(x[k])]; }); }
    var end = list[list.length - 1].year;
    return '<div data-role="pf-chart">' + V.multiLine({ title: 'Net operating income, debt service and cash flow by year',
      label: 'Line chart: net operating income, debt service and cash flow over the projection period',
      series: [{ label: 'Net operating income', color: V.COLORS.homes, points: pts('noi') },
        { label: 'Debt service', color: V.COLORS.blue, dash: true, points: pts('debtService') },
        { label: 'Cash flow', color: V.COLORS.households, points: pts('cashFlow') }],
      xTicks: list.map(function (x) { return x.year; }).filter(function (y) { return y === 1 || y === end || (y % 5 === 0 && end - y > 1); }), xName: 'year',
      note: 'The same figures as the table below. The key gives each line in year ' + end + '.' }) + '</div>';
  }
  function projectionTable(r) {
    var pr = r.projection;
    if (!pr || !pr.rows) return '<section class="fin-section"><h2>Operating projection</h2><p class="note">' + esc(unavailable(r, 'projection')) + '</p></section>';
    var list = pr.rows.filter(function (x) { return x.year <= pr.years; });
    var cols = [['Income after vacancy', 'egi'], ['Operating expenses', 'opex'], ['Replacement reserve', 'repReserve'], ['Property tax', 'propTax'],
      ['Net operating income', 'noi'], ['Debt service', 'debtService'], ['Cash flow', 'cashFlow'], ['Deferred fee paid', 'deferredFeePaid']];
    var reasons = list.map(function (x) { return x.unavailableReason; }).filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; });
    return '<section class="fin-section" aria-labelledby="fin-proj"><h2 id="fin-proj">' + esc(String(pr.years)) + '-year operating projection</h2>' + projectionChart(list) +
      '<div class="table-scroll" role="region" aria-label="Operating projection" tabindex="0"><table class="proj-table"><thead><tr><th scope="col">Year</th>' +
      cols.map(function (c) { return '<th scope="col" class="num">' + esc(c[0]) + '</th>'; }).join('') + '<th scope="col" class="num">Coverage</th></tr></thead><tbody>' +
      list.map(function (x) {
        return '<tr' + (x.dscr != null && isFinite(x.dscr) && x.dscr < 1.15 && x.year <= 15 ? ' class="below-min"' : '') + '><th scope="row">' + esc(String(x.year)) + '</th>' + cols.map(function (c) { return '<td class="num">' + esc(dash(x[c[1]], money)) + '</td>'; }).join('') +
          '<td class="num">' + esc(dash(x.dscr, function (v) { return v.toFixed(2) + 'x'; })) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (reasons.length ? '<p class="note">' + esc(reasons.join(' ')) + '</p>' : '') + coverageCheck(r) +
      '<p class="note">Cash left after the must-pay loans goes to any bridge-loan payment, then the asset management fee, then the deferred developer fee, then cash-flow loans, as on the full Deal Calculator (the order of CHFA\u2019s 2027 Common Application DOH proforma).</p></section>';
  }

  // The loan stack the visitor enters: the first mortgage's terms, up to five soft sources, then the bridge loan
  // and asset management fee, each read by the engine as the live page's Debt Sizing and Soft Funding Stack do.
  function programLabel(id) { var o = SOFT_PROGRAMS.filter(function (x) { return x[0] === id; })[0]; return o ? o[1] : String(id || 'Other'); }
  var TYPE_LABEL = {}; LOAN_TYPE_OPTIONS.forEach(function (o) { TYPE_LABEL[o[0]] = o[1]; });
  // Every loan the engine carried, in the order it pays them: amount, terms, what is paid in year 1, and what is
  // left at the exit year, each from the engine's own loan schedule (result.obligations).
  function loanTable(r) {
    var ob = r.obligations;
    if (!ob || !ob.loans) return '<section class="fin-section"><h2>Loan stack</h2><p class="note">' + esc(ob && ob.unavailableReason || unavailable(r, 'obligations')) + '</p></section>';
    var hold = r.exit && r.exit.holdYears;
    var loans = ob.loans.slice().sort(function (a, b) { return a.priority - b.priority || (b.senior ? 1 : 0) - (a.senior ? 1 : 0); });
    var row = function (l, y) { return l.rows[y - 1] || null; };
    var cell = function (v) { return v == null || !isFinite(v) ? '\u2014' : esc(money(v)); };
    return '<section class="fin-section" aria-labelledby="fin-loans"><h2 id="fin-loans">Loan stack</h2>' +
      '<div class="table-scroll" role="region" aria-label="Loan stack" tabindex="0"><table class="loan-table"><thead><tr><th scope="col">Loan</th><th scope="col" class="num">Amount</th><th scope="col">Terms</th>' +
      '<th scope="col" class="num">Paid, year 1</th><th scope="col" class="num">Left' + (hold ? ' after year ' + esc(String(hold)) : '') + '</th><th scope="col">At maturity</th></tr></thead><tbody>' +
      loans.map(function (l) {
        var y1 = row(l, 1), end = hold ? row(l, hold) : null, last = row(l, l.maturity);
        var at = l.amount === 0 ? '\u2014' : last == null ? 'After the projection' : last.unavailableReason ? last.unavailableReason : last.forgiven > 0 ? esc(money(last.forgiven)) + ' forgiven' : last.maturityDue > 0.5 ? esc(money(last.maturityDue)) + ' due' : 'Paid off';
        return '<tr><th scope="row">' + esc(l.senior ? 'First mortgage' : programLabel(l.program)) + '<small class="why">Priority ' + esc(String(l.priority)) + '</small></th>' +
          '<td class="num">' + cell(l.amount) + '</td><td>' + esc(TYPE_LABEL[l.type] || l.type) + '<small class="why">' + esc(l.rate + '%, ' + l.amortization + '-year amortization, ' + l.maturity + '-year maturity') + '</small></td>' +
          '<td class="num">' + (y1 && y1.unavailableReason ? esc(y1.unavailableReason) : cell(y1 && y1.paid)) + '</td><td class="num">' + (end && end.unavailableReason ? esc(end.unavailableReason) : cell(end && end.balance)) + '</td><td>' + at + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="note">Must-pay loans are paid first, by priority; cash-flow loans share what is left. A balance due at maturity needs a refinance or a payoff the projection does not assume.</p></section>';
  }
  function httpsUrl(u) { try { return new URL(u).protocol === 'https:' ? u : ''; } catch (e) { return ''; } }
  // What the program reference publishes for the picked program: the record's own description, cap, terms, source
  // note and check date, with its official page. Nothing here is a COHO estimate.
  function programReference(t) {
    if (data.soft === undefined) return '<p class="note" role="status">Loading the program reference…</p>';
    if (data.soft === null) return '<p class="note">The program reference did not load.</p>';
    var rec = SOFT_REFERENCE[t.program] && (data.soft.programs || {})[SOFT_REFERENCE[t.program]];
    var extra = t.program === 'impact_fee_loan' ? '<p class="note">' + esc(IMPACT_FEE_NOTE) + '</p>' : '';
    if (!rec) return '<div class="prog-ref" data-program-reference="' + esc(t.program) + '"><p class="note" data-unavailable-reason="program_terms_missing">No verified program record. Confirm the terms with the funder.</p>' + amountSource(t, null) + extra + '</div>';
    var timeline = t.program === 'prop123' && data.prop123;
    var url = httpsUrl(timeline && rec.status === 'retired' ? rec.source_url : rec.source_url);
    return '<div class="prog-ref" data-program-reference="' + esc(t.program) + '" data-program-id="' + esc(SOFT_REFERENCE[t.program]) + '">' +
      '<p><strong>' + esc(rec.name) + '</strong>' + (rec.funding_type ? ' · ' + esc(rec.funding_type.replace(/_/g, ' ')) : '') + '</p>' +
      '<p>' + esc((timeline && timeline.detail) || rec.description || 'No verified description in the program reference.') + '</p>' +
      (rec.status === 'retired' ? '<p class="callout">' + esc(rec.source_note) + '</p>'
        : amountSource(t, rec) +
          // The program publishes an amortizing loan; a different repayment picked here is named, not changed.
          (rec.funding_type === 'amortizing_loan' && (t.mode || 'loan') === 'loan' && (t.loanType || 'amortizing') !== 'amortizing'
            ? '<p data-program-repayment><strong class="over">The program publishes a must-pay amortizing loan; the repayment picked below is ' + esc((TYPE_LABEL[t.loanType] || t.loanType).toLowerCase()) + '.</strong></p>' : '') +
          '<p class="note">' + esc(rec.max_rule && rec.max_rule.text ? rec.max_rule.text + ' ' : '') + esc(rec.source_note || '') + '</p>') + extra +
      '<p class="metric-source">' + (url ? '<a href="' + esc(url) + '">' + esc(url.replace(/^https:\/\//, '').replace(/\/$/, '')) + ' ↗</a>' : 'Source unavailable') +
      ', checked ' + esc(rec.last_verified || 'date unavailable') + (timeline ? '; Prop 123 summary: <a href="' + esc(httpsUrl(timeline.source_url)) + '">Colorado Secretary of State ↗</a>' : '') + '</p></div>';
  }
  function trancheRow(t, i, count) {
    var name = function (k) { return 'tr:' + i + ':' + k; };
    var num = function (k, label, attrs, note) {
      return '<label class="field"><span>' + esc(label) + '</span><input name="' + name(k) + '" type="number" inputmode="decimal"' + attrs + ' value="' + esc(t[k]) + '">' + (note ? '<small class="note">' + esc(note) + '</small>' : '') + '</label>';
    };
    var opt = function (o) { return '<option value="' + o[0] + '"' + (o[0] === t.program ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; };
    var retired = SOFT_PROGRAMS.filter(function (o) { return o[2]; });
    var progs = SOFT_PROGRAMS.filter(function (o) { return !o[2]; }).map(opt).join('') +
      (retired.some(function (o) { return o[0] === t.program; }) ? '<optgroup label="Retired labels (no current program)">' + retired.map(opt).join('') + '</optgroup>' : '');
    var grant = t.mode === 'grant';
    return '<fieldset class="tranche" data-tranche="' + i + '"><legend>Source ' + (i + 1) + '</legend>' +
      '<div class="tranche-head"><label class="field"><span>Program</span><select name="' + name('program') + '">' + progs + '</select></label>' +
      '<div class="seg-toggle" role="radiogroup" aria-label="Source ' + (i + 1) + ': loan or grant">' + [['loan', 'Loan'], ['grant', 'Grant']].map(function (m) {
        return '<label><input type="radio" name="' + name('mode') + '" value="' + m[0] + '"' + ((t.mode || 'loan') === m[0] ? ' checked' : '') + '> ' + m[1] + '</label>';
      }).join('') + '</div>' +
      (count > 1 ? '<button type="button" class="link-button" data-action="remove-tranche" data-idx="' + i + '" aria-label="Remove source ' + (i + 1) + '">Remove</button>' : '') + '</div>' +
      programReference(t) +
      '<div class="field-grid">' + num('amount', 'Amount ($)', ' min="0" step="10000"') +
      (grant ? '' : '<label class="field"><span>Repayment</span><select name="' + name('loanType') + '">' + LOAN_TYPE_OPTIONS.map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === (t.loanType || 'amortizing') ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>' +
        num('rate', 'Rate (%)', ' min="0" max="20" step="0.1"') + num('term', 'Amortization (years)', ' min="1" max="50" step="1"')) +
      '<label class="field"><span>Federal money in this source?</span><select name="' + name('fundSource') + '">' +
        [['', 'Not answered'], ['federal', 'Yes: a grant with federal money reduces eligible basis'], ['nonfederal', 'No federal money']].map(function (o) {
          return '<option value="' + o[0] + '"' + ((t.fundSource || '') === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label></div>' +
      (DOH() ? '<details class="tranche-more" id="tr-doh-' + i + '"><summary>For a Division of Housing (DOH) application</summary>' +
        '<p class="note">Where this source sits in DOH\u2019s tables under Full result. These answers change no figure.</p>' + DOH().trancheFields(t, i) + '</details>' : '') +
      (grant ? '' : '<details class="tranche-more" id="tr-more-' + i + '"><summary>Maturity and cash-flow priority</summary><div class="field-grid">' +
        num('maturity', 'Maturity (years)', ' min="1" max="50" step="1"') + num('ioYears', 'Interest-only years', ' min="0" max="49" step="1"', 'Used only for interest-only then amortizing.') +
        num('cashflowPayPct', 'Share of cash left over (%)', ' min="0" max="100" step="1"', 'Cash-flow loans only.') + num('priority', 'Priority (1 paid first)', ' min="1" max="12" step="1"') +
        '</div><p class="note">Cash-flow loans get their share of the cash left after must-pay debt, in priority order. Unpaid interest compounds yearly. A forgivable loan is forgiven at maturity only if the agreement’s conditions are met. Confirm the terms with the lender.</p></details>') +
      '</fieldset>';
  }
  function loanStackInputs(d) {
    var tr = d.tranches && d.tranches.length ? d.tranches : [seedTranche()];
    return '<h2>Loans and other sources</h2>' +
      '<h3>First mortgage</h3><p class="note">The rate, amortization and coverage are under Assumptions.</p>' + fieldGrid(d, 'senior') +
      '<h3>Soft funding</h3><p class="note">Up to five sources below the first mortgage. A loan is paid by the repayment you pick; a grant fills the gap at closing, and a grant with federal money reduces eligible basis (<a href="https://www.law.cornell.edu/uscode/text/26/42">26 U.S.C. 42(d)(5)(A) ↗</a>). The federal-money answer starts at the full Deal Calculator\u2019s default for the program: HOME, CDBG, the National Housing Trust Fund and the Capital Magnet Fund are federal; Prop 123 is state money; any other program is left for you to answer.</p>' +
      '<div class="tranches">' + tr.map(function (t, i) { return trancheRow(t, i, tr.length); }).join('') + '</div>' +
      (tr.length < MAX_TRANCHES ? '<button type="button" class="button-link secondary" data-action="add-tranche">Add a source</button>' : '<p class="note">Five sources is the most the Deal Calculator takes.</p>') +
      '<h3>Construction loan and tax-exempt bonds</h3><p class="note">Blank until you have a lender\u2019s quote. The bond test, the interest check and the draw schedule under Lender schedules read these.</p>' + fieldGrid(d, 'constr') +
      '<h4>Federal equity pay-in (% of federal equity)</h4><p class="note">From the investor\u2019s letter of intent; the three should add to 100%. The draw schedule needs them.</p>' + fieldGrid(d, 'payin') +
      '<h3>Bridge loan and asset management fee</h3>' + fieldGrid(d, 'bridge') +
      (DOH() ? '<h3>Maximum loan by value (DOH quick calculation)</h3><p class="note">Beside sizing by coverage: value at a cap rate, or an appraised value, times a loan-to-value ratio. Leave blank to skip. The answer is under Permanent financing, Colorado DOH layout.</p>' + fieldGrid(d, 'dohmax') : '');
  }

  function fieldGrid(d, group) {
    return '<div class="field-grid">' + FIELDS.filter(function (i) { return (i.group || null) === group; }).map(function (i) {
      var v = d.fields[i.id];
      if (i.type === CHECK) return '<label class="field check"><input name="' + i.id + '" type="checkbox" value="yes"' + (v === 'yes' ? ' checked' : '') + '><span>' + esc(i.label) + '</span>' + (i.note ? '<small class="note">' + esc(i.note) + '</small>' : '') + sourceTag(i) + '</label>';
      var ctl = i.options
        ? '<select name="' + i.id + '">' + (v != null && v !== '' && !i.options.some(function (o) { return o[0] === v; }) ? [[v, v + ' (saved earlier)']] : []).concat(i.options).map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'
        : i.type === 'text'
        ? '<input name="' + i.id + '" type="text" maxlength="200" value="' + esc(v) + '" placeholder="' + esc(i.placeholder || '') + '">'
        : '<input name="' + i.id + '" type="number" step="' + i.step + '"' + (i.min ? ' min="' + i.min + '"' : '') + (i.max ? ' max="' + i.max + '"' : '') + ' inputmode="decimal" value="' + esc(v) + '"' +
          (i.id === 'dc-equity-price' ? ' placeholder="' + equityDefault(d.fields['dc-credit'] === '4' ? '4' : '9', data.equity) + '"' : i.id === 'dc-boost-pct' ? ' placeholder="not entered"' : i.placeholder ? ' placeholder="' + esc(i.placeholder) + '"' : '') + '>';
      return '<label class="field"><span>' + esc(i.label) + '</span>' + ctl + (i.note ? '<small class="note">' + esc(i.note) + '</small>' : '') + sourceTag(i) + '</label>' + (i.after || '');
    }).join('') + '</div>';
  }

  // CHFA's coverage tests over the first 15 years, as the engine reports them (DealCostBasis.underwritingCheck).
  function coverageCheck(r) {
    var u = r.costBasis && r.costBasis.underwriting;
    if (!u) return '';
    var m = u.minimum, h = u.high, out = [];
    var cite = function (st) { return st && st.citation ? ' (' + st.citation + ')' : ''; };
    if (m.passes === true) out.push('<li class="ok">Meets CHFA\u2019s 1.15x minimum every year: the lowest coverage is ' + esc(ratio(m.lowest)) + esc(cite(m.status)) + '.</li>');
    else if (m.passes === false) out.push('<li class="bad">Below CHFA\u2019s 1.15x minimum: the lowest coverage in the first 15 years is ' + esc(ratio(m.lowest)) + esc(cite(m.status)) + '.</li>');
    else if (m.reason) out.push('<li>CHFA minimum coverage: ' + esc(m.reason) + '</li>');
    if (h.exceeds === true) out.push('<li class="warn">Year 1 coverage is ' + esc(ratio(h.firstYear)) + ', above 1.30x, so CHFA may award less credit' + esc(cite(h.status)) + '. The calculator flags it and does not cut the credit.</li>');
    else if (h.exceeds === false) out.push('<li class="ok">Year 1 coverage is ' + esc(ratio(h.firstYear)) + ', not above CHFA\u2019s 1.30x high-coverage line.</li>');
    return out.length ? '<ul class="fin-checks" data-role="coverage-check">' + out.join('') + '</ul>' : '';
  }

  // The partnership waterfall: the live page's terms, then the engine's split of the sale (result.waterfall).
  function waterfallSection(d, r) {
    var wf = r.waterfall, E = global.DealEngine, why = function (k) { return unavailable(r, k); };
    var auto = E.investorCapital ? E.investorCapital(r) : null;
    var head = '<section class="fin-section" aria-labelledby="fin-wf"><h2 id="fin-wf">Partnership waterfall</h2>' +
      '<p>Who puts money in, and who is paid each year and at the sale. Every term is an input; the defaults are a starting point, not your partnership agreement.' +
      (auto != null ? ' The investor pays ' + esc(money(auto)) + ' for the credits.' : '') + '</p>' + fieldGrid(d, 'waterfall');
    if (!wf) return head + '<p class="note">Unavailable \u2014 ' + esc(why('waterfall')) + '</p></section>';
    var pctOf = function (v) { return wf.grossProceeds > 0 && v / wf.grossProceeds * 100 >= 0.05 ? (v / wf.grossProceeds * 100).toFixed(1) + '%' : '\u2014'; };
    var multiple = function (v, k) { return v != null && isFinite(v) ? v.toFixed(2) + 'x' : 'Unavailable \u2014 ' + why(k); };
    var rate = function (v, k) { return v != null && isFinite(v) ? (Math.abs(v) < 0.0005 ? 0 : v * 100).toFixed(1) + '%' : 'Unavailable \u2014 ' + why(k); };
    var annual = (wf.annual || []).map(function (y) {
      return '<tr' + (y.year === wf.hold ? ' class="exit-row"' : '') + '><th scope="row">Year ' + esc(String(y.year)) + (y.year === wf.hold ? ' (sale)' : '') + '</th><td class="num">' + esc(dash(y.lp, money)) + '</td><td class="num">' + esc(dash(y.gp, money)) +
        '</td><td class="num">' + esc(dash(y.cumLp, money)) + '</td><td class="num">' + esc(dash(y.cumGp, money)) + '</td></tr>';
    }).join('');
    // Gemini round 16, pick 1 (paul 11-05): the sale's finding in words, summed by who is paid, from the engine's tiers.
    var who = [], by = {};
    wf.tiers.forEach(function (t) {
      var k = /^LP/.test(t.recipient) ? 'the investor' : /GP|Sponsor|Developer/.test(t.recipient) ? 'the sponsor' : /lender/i.test(t.recipient) ? 'lenders' : t.recipient.toLowerCase();
      if (!(k in by)) { by[k] = 0; who.push(k); }
      by[k] += t.amount || 0;
    });
    var finding = wf.grossProceeds > 0 ? 'When the building sells for ' + money(wf.grossProceeds) + ': ' + who.map(function (k) { return k + ' ' + money(by[k]); }).join(', ') + '.' : '';
    return head + (finding ? '<p class="wf-finding" data-role="wf-finding">' + esc(finding) + '</p>' : '') +
      '<div class="table-scroll" role="region" aria-label="Sale waterfall" tabindex="0"><table class="wf-table"><caption>The sale, paid out in this order</caption><thead><tr><th scope="col">Tier</th><th scope="col" class="num">Amount</th><th scope="col" class="num">Share of the sale</th><th scope="col">Paid to</th></tr></thead><tbody>' +
      wf.tiers.map(function (t) { return '<tr' + (t.amount > 0 ? '' : ' class="zero"') + '><th scope="row">' + esc(t.name) + '</th><td class="num">' + esc(money(t.amount)) + '</td><td class="num">' + esc(pctOf(t.amount)) + '</td><td>' + esc(t.recipient) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><th scope="row">Sale value</th><td class="num">' + esc(money(wf.grossProceeds)) + '</td><td colspan="2">Before the payoffs above, and before selling costs</td></tr></tfoot></table></div>' +
      '<dl class="exit-list" data-role="waterfall"><div><dt>Investor cash received</dt><dd>' + esc(dash(wf.lpTotal, money)) + '</dd></div>' +
      '<div><dt>Investor cash multiple</dt><dd>' + esc(multiple(wf.lpMultiple, 'waterfall.lpMultiple')) + '</dd></div>' +
      '<div><dt>Investor cash return a year (credits not counted)</dt><dd>' + esc(rate(wf.lpCashIrr, 'waterfall.lpCashIrr')) + '</dd></div>' +
      '<div><dt>Sponsor cash received</dt><dd>' + esc(dash(wf.gpTotal, money)) + '</dd></div>' +
      '<div><dt>Sponsor\u2019s own return a year on the deferred fee</dt><dd>' + esc(rate(wf.sponsorIrr, 'waterfall.sponsorIrr')) + '</dd></div></dl>' +
      '<p class="note">The investor\u2019s main return is the tax credits (' + esc(dash(wf.annualCredits, money)) + ' a year for 10 years), not cash. This shows only the cash side.</p>' +
      (annual ? '<details class="wf-annual"><summary>Year by year: investor and sponsor cash</summary><div class="table-scroll" role="region" aria-label="Year-by-year investor and sponsor cash" tabindex="0"><table><thead><tr><th scope="col">Year</th><th scope="col" class="num">Investor</th><th scope="col" class="num">Sponsor</th><th scope="col" class="num">Investor to date</th><th scope="col" class="num">Sponsor to date</th></tr></thead><tbody>' +
        '<tr><th scope="row">Year 0</th><td class="num">' + esc(money(-wf.lpEquity)) + '</td><td class="num">$0</td><td class="num">' + esc(money(-wf.lpEquity)) + '</td><td class="num">$0</td></tr>' + annual + '</tbody></table></div>' +
        '<p class="note">Yearly cash after loan payments and the deferred fee, split ' + esc(String(+(wf.terms.lpOpsShare * 100).toFixed(2))) + '% investor, ' + esc(String(+((1 - wf.terms.lpOpsShare) * 100).toFixed(2))) + '% sponsor. The sale year adds the waterfall above.</p></details>' : '') +
      '</section>';
  }

  // Interest rate against equity price: the funding gap at each pair, each cell a fresh run of the same engine on the
  // same inputs with only those two changed. Steps match the live page's rate slider (0.5 points) and a 5-cent price step.
  var RATE_STEPS = [-1, -0.5, 0, 0.5, 1], PRICE_STEPS = [-0.10, -0.05, 0, 0.05, 0.10];
  // The answer first: the gap in one figure, what pays for the cost in one bar, three tiles, and how the rent
  // pays the loan. Every figure is the engine run below (the same `r`); nothing here is computed differently.
  function answerPanel(r, inputs) {
    var gapKnown = r.gap != null && isFinite(r.gap);
    var hero = !gapKnown ? '<p class="ans-hero ans-none">Not yet</p><p class="ans-sub">' + esc(unavailable(r, 'gap')) + '</p>'
      : r.gap > 0 ? '<p class="ans-hero">' + esc(money(r.gap)) + '</p><p class="ans-sub">' + esc(pct(r.gap / r.tdc, 0)) + ' of the ' + esc(money(r.tdc)) + ' cost is not yet paid for.</p>'
      : '<p class="ans-hero ans-ok">Covered</p><p class="ans-sub">Modeled sources meet the ' + esc(money(r.tdc)) + ' cost' + (r.gap < 0 ? ', with ' + esc(money(-r.gap)) + ' to spare' : '') + '.</p>';
    var cs = r.creditStack || { federal: r.equity, state: r.stateEquity, added: 0 };
    var soft = (isFinite(r.totalLoanPrincipal) ? r.totalLoanPrincipal : 0) + (isFinite(r.totalGrant) ? r.totalGrant : 0);
    var parts = [['Federal credit equity', cs.federal, 'equity'], ['State credit equity', cs.state, 'equity seg-state'], [(cs.label || 'Added credit') + ' equity', cs.counted ? cs.added : 0, 'equity seg-state'],
      ['First mortgage', r.mortgage, 'mortgage'], ['Soft loans and grants', soft, 'soft'], ['Deferred developer fee', r.deferredDevFee, 'fee'], ['Gap to fill', gapKnown && r.gap > 0 ? r.gap : 0, 'gap']]
      .filter(function (x) { return x[1] != null && isFinite(x[1]) && x[1] > 0; });
    var whole = parts.reduce(function (t, x) { return t + x[1]; }, 0);
    // Gemini round 16, picks 1 and 2 (paul 11-05): the finding is the heading, and the bar's label leads with it.
    var finding = !gapKnown ? 'Funding gap' : r.gap > 0 ? 'This deal is ' + money(r.gap) + ' short, ' + pct(r.gap / r.tdc, 0) + ' of its cost; this is what pays for the rest'
      : 'This deal\u2019s sources cover its ' + money(r.tdc) + ' cost';
    // Gemini round 15, pick 1 (paul 11-05): the card's colour matches the news. Under 5% of cost is a small gap.
    var tone = global.LabTpl.gapTone(r.gap, r.tdc);
    var bar = whole > 0 ? '<div class="stack-bar ans-bar" role="img" aria-label="' + esc((gapKnown ? finding + '. ' : '') + parts.map(function (x) { return x[0] + ' ' + money(x[1]); }).join(', ') + '. Source: the Deal Calculator\u2019s engine.') + '">' +
      parts.map(function (x) { return '<span class="seg seg-' + x[2] + '" style="width:' + (x[1] / whole * 100).toFixed(2) + '%"></span>'; }).join('') + '</div>' +
      '<ul class="ans-legend">' + parts.map(function (x) { return '<li><i class="seg seg-' + x[2] + '" aria-hidden="true"></i><span>' + esc(x[0]) + '</span><b>' + esc(money(x[1])) + '</b></li>'; }).join('') + '</ul>' : '';
    var rule = data.rules && data.rules.rules && data.rules.rules.min_debt_coverage;
    var tiles = [
      [r.dcr != null ? ratio(r.dcr) : '—', 'Coverage the loan is sized at' + (rule && rule.min_coverage ? ' (CHFA minimum ' + rule.min_coverage.toFixed(2) + 'x)' : '')],
      [r.breakEvenOcc != null ? pct(r.breakEvenOcc, 0) : '—', 'Break-even occupancy'],
      [isFinite(Number(inputs.fields['dc-equity-price'])) ? '$' + Number(inputs.fields['dc-equity-price']).toFixed(2) : '—', 'Equity price per $1 of federal credit']
    ];
    var gross = (r.annualRents || 0) + (r.annualOtherIncome || 0), egi = r.effectiveGrossIncome;
    var flow = '';
    if ([gross, egi, r.noi, r.annualDebtService].every(function (v) { return v != null && isFinite(v); }) && gross > 0) {
      var W = function (v) { return Math.max(0, Math.min(100, v / gross * 100)).toFixed(1) + '%'; };
      var row = function (label, left, width, cls, value, strong) {
        return '<li' + (strong ? ' class="strong"' : '') + '><span class="fl-l">' + esc(label) + '</span><span class="fl-t"><span class="fl-b ' + cls + '" style="left:' + left + ';width:' + width + '"></span></span><span class="fl-v">' + esc(value) + '</span></li>';
      };
      flow = '<section class="ans-card" aria-labelledby="ans-flow"><h3 id="ans-flow" class="ans-k">How the rent pays the loan, per year</h3><ul class="ans-flow">' +
        row('Rent and other income', '0%', W(gross), 'fl-in', money(gross)) +
        row('Vacancy', W(egi), W(gross - egi), 'fl-out', '−' + money(gross - egi)) +
        row('Operating, taxes, reserve', W(r.noi), W(egi - r.noi), 'fl-out', '−' + money(egi - r.noi)) +
        row('Net operating income', '0%', W(r.noi), 'fl-noi', money(r.noi), true) +
        row('First mortgage payment', '0%', W(r.annualDebtService), 'fl-debt', money(r.annualDebtService)) +
        '</ul><p class="note">Scheduled rent from the saved rent schedule; costs from the operating budget below.</p></section>';
    }
    return '<section class="ans" aria-labelledby="ans-gap"><div class="ans-card' + (tone ? ' tone-' + tone : '') + '"><h2 id="ans-gap" class="ans-k">' + esc(finding) + '</h2>' + global.LabTpl.toneBadge(tone) + hero + bar + '</div>' +
      '<ul class="ans-tiles">' + tiles.map(function (t) { return '<li><b>' + esc(t[0]) + '</b><span>' + esc(t[1]) + '</span></li>'; }).join('') + '</ul>' +
      flow + '</section><p class="ans-change">Change the inputs:</p>';
  }

  function stepOpen(id, title, sub, body) {
    return '<details class="fin-step" id="' + id + '"><summary><span class="fs-t">' + esc(title) + '</span>' + (sub ? '<span class="fs-s">' + esc(sub) + '</span>' : '') + '</summary><div class="fs-body">' + body + '</div></details>';
  }

  function rateGrid(inputs, r) {
    var baseRate = Number(inputs.fields['dc-rate']), basePrice = Number(inputs.fields['dc-equity-price']);
    var h = '<section class="fin-section" aria-labelledby="fin-grid"><h2 id="fin-grid">Interest rate and equity price</h2>';
    if (!isFinite(baseRate) || !isFinite(basePrice) || r.gap == null) return h + '<p class="note">Unavailable \u2014 ' + esc(unavailable(r, 'gap')) + '</p></section>';
    var rates = RATE_STEPS.map(function (x) { return Math.round((baseRate + x) * 100) / 100; }).filter(function (x) { return x > 0; });
    var prices = PRICE_STEPS.map(function (x) { return Math.round((basePrice + x) * 100) / 100; }).filter(function (x) { return x > 0; });
    var cells = rates.map(function (rt) {
      return prices.map(function (pr) {
        var f = Object.assign({}, inputs.fields); f['dc-rate'] = String(rt); f['dc-equity-price'] = String(pr);
        var x = global.DealEngine.computeDeal(Object.assign({}, inputs, { fields: f, skipSchedules: true }));
        return { rate: rt, price: pr, gap: x.gap, mortgage: x.mortgage };
      });
    });
    var all = [].concat.apply([], cells).map(function (c) { return c.gap; }).filter(function (g) { return g != null && g > 0; });
    var top = all.length ? Math.max.apply(null, all) : 0;
    var shade = function (g) { return g == null ? '' : g <= 0 ? ' class="covered"' : ' style="--g:' + (top > 0 ? (0.12 + 0.6 * g / top).toFixed(2) : 0) + '"'; };
    return h + '<p>The funding gap as the permanent loan rate and the equity price move. The loan is re-sized at each rate; the middle cell is the run above.</p>' +
      '<div class="table-scroll" role="region" aria-label="Funding gap by interest rate and equity price" tabindex="0"><table class="rate-grid"><caption>Funding gap. Rows: permanent loan rate. Columns: equity price per credit dollar.</caption><thead><tr><th scope="col">Rate</th>' +
      prices.map(function (pr) { return '<th scope="col" class="num">$' + pr.toFixed(2) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      cells.map(function (row) {
        return '<tr><th scope="row">' + row[0].rate.toFixed(2) + '%</th>' + row.map(function (c) {
          var mid = c.rate === Math.round(baseRate * 100) / 100 && c.price === Math.round(basePrice * 100) / 100;
          return '<td class="num' + (mid ? ' mid' : '') + '"' + shade(c.gap).replace(' class="covered"', '') + (c.gap != null && c.gap <= 0 ? ' data-covered="1"' : '') + ' title="Loan ' + esc(dash(c.mortgage, money)) + '">' +
            esc(c.gap == null ? '\u2014' : c.gap <= 0 ? 'Covered' : money(c.gap)) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="note">Darker is a bigger gap. \u201cCovered\u201d means modeled sources meet the cost. Hover a cell for the loan it supports.</p></section>';
  }

  // The most-likely case: the base run's main assumptions, each with where it comes from and its date.
  function mostLikely(d, inputs, r) {
    var price = Number(inputs.fields['dc-equity-price']), credit = inputs.fields['dc-rate-4'] ? '4' : '9';
    var priceSource = d.fields['dc-equity-price'] === ''
      ? 'Novogradac national average for ' + credit + '% deals, as of ' + (data.equity.meta.as_of || 'its latest update')
      : 'Entered under Assumptions';
    var hint = data.rateHint, rate = Number(d.fields['dc-rate']);
    // As on the live page, a spread typed by the reader replaces the assumption in the hint; a blank or negative one does not.
    var typed = d.fields['dc-perm-spread'], own = typed != null && String(typed).trim() !== '' && isFinite(Number(typed)) && Number(typed) >= 0;
    var spread = hint ? (own ? Number(typed) : hint.spread) : null;
    var hintRate = hint ? Math.round((hint.t10 + spread) * 100) / 100 : null;
    var rateSource = hint === undefined ? 'Loading the latest 10-year Treasury…'
      : !hint ? 'The 10-year Treasury did not load, so the rate is as entered.'
      : '10-year Treasury ' + hint.t10.toFixed(2) + '% (FRED, ' + hint.date + ') plus ' + spread.toFixed(2) + ' points = ' + hintRate.toFixed(2) + '%. ' +
        (own ? 'The spread is the one you entered under Loans, credits and terms.' : 'The spread is a COHO screening assumption with no published source: use your lender’s quote, or enter your own spread under Loans, credits and terms.');
    var useRate = hint && isFinite(rate) && Math.abs(rate - hintRate) >= 0.005
      ? ' <button type="button" class="link-button" data-action="use-rate" data-rate="' + hintRate.toFixed(2) + '">Use ' + hintRate.toFixed(2) + '%</button>' : '';
    var rows = [
      ['Equity price', '$' + price.toFixed(2) + ' per credit dollar', priceSource],
      ['Permanent loan rate', esc(d.fields['dc-rate']) + '%', rateSource, useRate],
      ['Coverage the loan is sized to', ratio(r.dcr) || '—', 'Entered under Assumptions. CHFA’s floor is 1.15x.'],
      inputs.resolvedDealMix.available ? ['Rent limits', 'CHFA ' + data.chfa.meta.fiscal_year, 'CHFA rent table effective ' + data.chfa.meta.effective_date + ', applied to the saved rent schedule']
        : ['Rent limits', esc((RENT_REGIMES.filter(function (o) { return o[0] === inputs.regime; })[0] || ['', inputs.regime])[1]), 'Chosen under Homes and rents'],
      inputs.resolvedDealMix.available ? ['Vacancy', pct(inputs.resolvedDealMix.vacancyRate), 'From the saved rent schedule'] : ['Vacancy', pct(r.vacancyRate), 'Entered under Homes and rents'],
      ['Operating budget', d.opExample ? 'An invented example' : 'Your budget', d.opExample ? 'Replace it with your own budget before relying on the result.' : 'Entered under Operating budget']
    ];
    return '<section class="fin-section" aria-labelledby="fin-likely"><h2 id="fin-likely">Most-likely case</h2>' +
      '<p class="note">The result above runs on these assumptions. Change any of them above; the stress settings below then test the deal against this case.</p>' +
      '<dl class="likely-list">' + rows.map(function (x) {
        return '<div><dt>' + esc(x[0]) + '</dt><dd><strong>' + esc(x[1]) + '</strong>' + (x[3] || '') + '<small>' + esc(x[2]) + '</small></dd></div>';
      }).join('') + '</dl></section>';
  }

  // The five stress sliders. Each line is what the engine's sliderImpacts returns for that setting; loans keep their sized amounts.
  function stressSliders(d, inputs, r) {
    var im = r.sliderImpacts, why = function (k) { return unavailable(r, 'sliderImpacts.' + k); };
    var cut = im && im.rentCut;
    var line = {
      'dc-stress-equity-price': !im || im.equity == null ? 'Unavailable — ' + why('equity')
        : 'Equity ' + money(im.equity) + ', ' + (Math.abs(im.equityDelta) < 0.5 ? 'the same as the base case' : (im.equityDelta > 0 ? money(im.equityDelta) + ' more' : money(-im.equityDelta) + ' less') + ' than the base case') + ' (' + money(im.baseEquity) + ').',
      'dc-stress-tdc-overrun': !im || im.tdc == null ? 'Unavailable — ' + why('tdc')
        : 'Total cost ' + money(im.tdc) + (im.overrun > 0 ? ', ' + money(im.overrun) + ' over. Nothing else pays for it, so it adds to the gap.' : ', no overrun.'),
      'dc-stress-rent-low': !cut ? 'Unavailable — ' + why('rentCut')
        : !cut.deepUnits ? 'No homes at 30% to 50% AMI, so the cut changes nothing.'
        : cut.deepUnits + ' homes at 30% to 50% AMI bring ' + money(cut.deepRents) + ' a year. ' + (cut.pct > 0 ? 'The cut lowers NOI by ' + money(cut.noiLoss) + ' to ' + money(cut.noi) +
          (cut.coverage != null ? '; first-mortgage coverage ' + ratio(cut.baseCoverage) + ' → ' + ratio(cut.coverage) + '.' : '.') : 'Move the slider to cut them.'),
      'dc-stress-leaseup': !im || im.year1Loss == null ? 'Unavailable — ' + why('year1Loss')
        : 'About ' + money(im.year1Loss) + ' of first-year NOI lost while the homes fill. A funded lease-up reserve covers it.',
      'dc-stress-dscr-floor': !cut || cut.coverage == null ? 'Unavailable — ' + (cut ? 'there is no first-mortgage payment to test.' : why('rentCut'))
        : 'Coverage ' + ratio(cut.coverage) + (cut.noiLoss > 0 ? ' after the rent cut ' : ' ') + (cut.meetsFloor ? 'meets' : 'falls short of') + ' a ' + ratio(cut.floor) + ' floor. ' +
          (cut.supportedLoan != null ? 'At that floor the NOI carries about a ' + money(cut.supportedLoan) + ' loan against ' + money(cut.loan) + ' as sized (' + (cut.loanRoom >= 0 ? money(cut.loanRoom) + ' of room' : money(-cut.loanRoom) + ' too large') + ').' : '')
    };
    // Where each slider starts and, for the coverage floor, the target: figures this page already cites (slider.js draws them).
    var SL = global.LabSlider, basePrice = Number(inputs.fields['dc-equity-price']);
    var dcrRule = data.rules && data.rules.rules && data.rules.rules.min_debt_coverage, dcrMin = dcrRule && Number(dcrRule.min_coverage);
    var aim = {
      'dc-stress-equity-price': isFinite(basePrice) && basePrice > 0 ? { mark: basePrice, markText: 'The base case price, $' + basePrice.toFixed(2) + ', shown under Most-likely case.' } : null,
      'dc-stress-tdc-overrun': { mark: 0, markText: '0%: the budget as entered.' },
      'dc-stress-rent-low': { mark: 0, markText: '0%: rents as entered.' },
      'dc-stress-leaseup': { mark: 12, markText: '12 months: the calculator’s starting setting.' },
      'dc-stress-dscr-floor': dcrMin > 0 ? { band: [dcrMin, 1.40], text: 'Target: CHFA’s minimum, ' + dcrMin.toFixed(2) + 'x, or higher (source below).' } : null
    };
    return '<section class="fin-section" aria-labelledby="fin-sliders"><h2 id="fin-sliders">Stress sliders</h2>' +
      '<p class="note">The Deal Calculator’s five stress controls. Move a slider and its line redraws. Each line shows what its setting does to this deal; no loan is resized.</p>' +
      '<div class="stress-sliders">' + STRESS_INPUTS.map(function (i) {
        var raw = d.fields[i.id] === '' || d.fields[i.id] == null ? inputs.fields[i.id] : d.fields[i.id], v = Number(raw);
        return '<div class="stress-slider"><label for="' + i.id + '"><span>' + esc(i.label) + '</span> <output for="' + i.id + '">' + esc(isFinite(v) ? i.fmt(v) : '—') + '</output></label>' +
          '<input type="range" id="' + i.id + '" name="' + i.id + '" min="' + i.min + '" max="' + i.max + '" step="' + i.step + '" value="' + esc(String(raw)) + '"' +
            (SL && aim[i.id] ? SL.attrs('plain', '', aim[i.id].band) + ' aria-describedby="' + i.id + '-target"' : '') + '>' +
          (SL && aim[i.id] ? SL.scale(Object.assign({ id: i.id, min: i.min, max: i.max, value: v }, aim[i.id])) : '') +
          '<p class="impact" data-role="' + i.id + '-impact">' + esc(line[i.id]) + '</p><p class="note">' + esc(i.note) + '</p>' + sourceTag(i) + '</div>';
      }).join('') + '</div></section>';
  }

  // The engine's own fee, credit and cost checks for the inputs above (result.costBasis and result.expenseTarget),
  // the figures the live page shows beside each input. Nothing here re-derives a figure.
  function creditChecks(r) {
    var cb = r.costBasis;
    if (!cb) return '';
    var rows = [];
    var b = cb.basis || {};
    var basisWord = { awarded: 'the award entered', requested: 'the request entered', capacity: 'the credit the costs support', 'cost basis limit': 'CHFA\u2019s cost basis limit (Method Three)' };
    rows.push(['Federal credit used for equity', b.creditForEquity == null ? ((b.reasons || {}).capacity || 'Not available for these inputs.') : money(b.creditForEquity) + ' a year, from ' + (basisWord[b.creditForEquityBasis] || 'the engine')]);
    var fee = function (t, what) {
      if (!t) return null;
      return t.passes == null ? (t.reason || 'Not tested.') : money(t.fee) + ' against a limit of ' + money(t.limit) + (t.passes ? ': within it.' : ': ' + money(t.excess) + ' above it, taken out of basis.');
    };
    rows.push(['Contractor fee (builder profit and overhead)', fee(cb.contractorFee)]);
    rows.push(['Developer fee, before deferral', fee(cb.developerFee)]);
    var clm = b.costLimitMethod;
    var plan = b.costLimitPlan || {};
    if (clm && clm.checked != null) rows.push(['CHFA cost limits (' + (clm.draft ? 'draft ' : '') + '2027 Common Application)', clm.credit != null ? money(clm.credit) + ' a year under the per-unit limits. ' +
      (plan.applied ? 'The lowest of CHFA\u2019s three methods, so it sets the credit, down from ' + money(plan.before) + ' a year. ' : plan.on === false ? 'A check only: \u201cPlan to CHFA\u2019s cost basis limit\u201d is unticked. ' : '') + (clm.reason || '') : (clm.reason || 'Choose a building type.')]);
    var gm = b.gapMethod || {};
    if (gm.binding && gm.capacityBefore != null && b.capacity != null) rows.push(['Credit trimmed to the need', money(gm.capacityBefore - b.capacity) + ' a year. Sources would exceed the cost by about ' +
      money((gm.capacityBefore - b.capacity) * 10 * (r.equityPrice || 0)) + ' at the full credit. CHFA would likely trim the credit to the gap (Method Two), so the deal shows no gap rather than a surplus.']);
    var sc = cb.stateCredit;
    if (sc && sc.entered) rows.push(['State credit', sc.equity != null ? money(sc.allowedAnnual) + ' a year for ' + sc.years + ' years at $' + Number(sc.price).toFixed(2) + ': ' + money(sc.equity) + ' after fees.' : sc.reason]);
    var ac = cb.addedCredit;
    if (ac && ac.entered) rows.push([ac.label || 'Added credit', ac.net != null ? money(ac.net) + ' net new equity.' : ac.reason]);
    var et = r.expenseTarget;
    if (et && et.entered) rows.push(['Expense target', et.reason ? et.reason : money(et.target) + ' a home a year against ' + money(et.used) + ' in the line items. Coverage would be ' + ratio(et.coverageAtTarget) + ' at the target and is ' + ratio(et.coverageUsed) + ' as budgeted.']);
    return '<section class="fin-section" aria-labelledby="fin-checks" data-role="credit-checks"><h2 id="fin-checks">Fee, credit and cost checks</h2><dl class="basis-dl">' +
      rows.filter(function (x) { return x[1] != null; }).map(function (x) { return '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>'; }).join('') + '</dl></section>';
  }
  // The live page's fold under its rents, with its note on which rents the cap lowered (result.rentCapBindings).
  function rentCapInputs(d, r) {
    var b = (r && r.rentCapBindings) || [];
    var open = b.length || RENT_CAP_INPUTS.some(function (i) { return d.fields[i.id] != null && String(d.fields[i.id]).trim() !== ''; });
    return '<details class="tranche-more" data-role="rent-cap"' + (open ? ' open' : '') + '><summary>Market cap on restricted rents (optional)</summary>' +
      '<p class="note">When a market study finds a tier\u2019s limit is above what the market pays, the deal underwrites at the lower rent. Enter the most the market pays a month for each size, after utilities. Blank means no cap.</p>' +
      fieldGrid(d, 'rentcap') +
      (b.length ? '<p class="note" role="status" data-role="rent-cap-note">The cap lowers ' + b.length + ' rent' + (b.length === 1 ? '' : 's') + ': ' +
        esc(b.map(function (x) { return x.tier + '% ' + String(x.br).toUpperCase() + ' ' + money(x.limit) + ' to ' + money(x.cap); }).join(', ')) + '.</p>' : '') + '</details>';
  }
  function creditInputs(d) {
    return '<h2>Tax credits</h2>' +
      '<h3>Federal credit requested and awarded</h3>' + fieldGrid(d, 'credit') +
      '<h3>State credit</h3><p class="note">State credit equity is a separate source from federal equity: each annual amount, within CHFA’s limit for the application, over the six-year allocation. CHFA’s limits apply per project and per applicant, with its affiliates; these figures assume no other active applications. A proposed amount is not counted until you tick that CHFA has awarded it.</p>' + fieldGrid(d, 'state') +
      '<h4>State equity pay-in (% of state equity)</h4>' + fieldGrid(d, 'state-payin') +
      '<h3>Added credit: Transit Zone or another credit</h3><p class="note">A credit can add to the others or replace part of one. Replacing a credit brings no new cash, and an allocator may cut another award when a source is added, so the engine counts the net new equity. Once its figures are entered and its eligibility is shown, it is counted in the sources.</p>' + fieldGrid(d, 'added') +
      '<h4>Added credit equity pay-in (% of its gross equity)</h4>' + fieldGrid(d, 'added-payin');
  }

  // The live page's rent limit setting, shown as it applies here. A mix taken from a saved schedule runs only under
  // CHFA LIHTC: the shared ChfaRentLimits.dealMixFromSchedule refuses any other setting (schedule_requires_chfa_setting).
  // In schedule mode the engine also ignores the market-rent source, the 70%-120% AMI market cap and manual market
  // rents (deal-engine.js: capOn needs !scheduleMode; manualMarket is read only without a mix), because each market
  // row carries the rent and source entered on the schedule.
  var RENT_REGIMES = [['chfa_lihtc', 'CHFA LIHTC'], ['home_high', 'HOME, High HOME rents (HUD)'], ['home_low', 'HOME, Low HOME rents (HUD)'], ['prop123', 'Prop 123 (Colorado affordable housing fund)'],
    ['ami_formula', 'Other AMI-restricted rental (non-CHFA formula)'], ['market', 'Market-rate (unrestricted)']];
  function rentLimitsFixed(p, s) {
    return '<div class="field-grid" data-role="rent-regime"><label class="field"><span>Rent limits</span><select name="dc-rent-limit-regime" disabled aria-describedby="rent-regime-why">' +
      RENT_REGIMES.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === 'chfa_lihtc' ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>' +
      '<small class="note" id="rent-regime-why">Fixed at CHFA LIHTC because the homes and rents come from a saved rent schedule, which the shared engine prices only under CHFA limits. ' +
      'Rent burden stays at 30%, as on the full Deal Calculator for published CHFA rents. Market-rate homes use the rent and source entered on the schedule. HOME, Prop 123 (with its program and rural resort petition), other AMI formulas and market-rate pricing use the unit grid: <a href="#/convert/' + esc(p.projectId) + '/' + esc(s.scenarioId) + '">copy these homes into the unit grid</a>, or change the rents in <a href="#/homes/' + esc(p.projectId) + '/' + esc(s.scenarioId) + '">Homes and affordability</a>.</small></label></div>';
  }

  // The live page's cost table (costTableHtml): one closed group per DOH category with its subtotal, each line with its
  // amount and basis choice, the part in basis for a line partly in basis, and the use so far for a contingency.
  function costGroupsHtml(d, inputs, money$) {
    var byGroup = {};
    inputs.costLines.forEach(function (l) { (byGroup[l.group] = byGroup[l.group] || []).push(l); });
    return '<div class="cost-groups" data-role="cost-lines">' + CB().GROUPS.map(function (g) {
      var lines = byGroup[g.id] || [];
      var entered = lines.filter(function (l) { return l.amount != null; });
      var subtotal = entered.reduce(function (t, l) { return t + (Number(l.amount) || 0); }, 0);
      var rows = lines.map(function (l) {
        var fixed = CB().NEVER_IN_BASIS[l.id];
        var sel = '<select name="basis:' + esc(l.id) + '" aria-label="' + esc(l.label) + ': in eligible basis?"' + (fixed ? ' disabled title="' + esc(fixed) + '"' : '') + '>' +
          (fixed ? '<option value="ineligible" selected>Not in basis</option>' : BASIS_CHOICES.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === l.basis ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('')) + '</select>';
        var extra = l.basis === 'partial' ? '<label class="cost-extra">Part in basis ($) ' + money$('part:' + l.id, (d.parts || {})[l.id], l.label + ': part in basis ($)') + '</label>' : '';
        if (CB().CONTINGENCY_KINDS[l.id]) extra += '<label class="cost-extra">Proposed use so far ($) ' + money$('used:' + l.id, (d.used || {})[l.id], l.label + ': proposed use so far ($)') + '</label>';
        return '<tr data-cost-line="' + esc(l.id) + '"><th scope="row">' + esc(l.label) + '</th><td>' + sel + '</td>' +
          '<td class="num">' + money$('cost:' + l.id, (d.costs || {})[l.id], l.label + ' ($)') + extra + '</td></tr>';
      }).join('');
      return '<details class="cost-group" id="cost-group-' + esc(g.id) + '" data-cost-group="' + esc(g.id) + '"' + (entered.length ? ' open' : '') + '>' +
        '<summary><span>' + esc(g.label) + '</span><span class="sub">' + esc(lines.length + ' lines' + (entered.length ? ', ' + entered.length + ' entered, ' + money(subtotal) : '')) + '</span></summary>' +
        '<div class="table-scroll cost-table" role="region" aria-label="' + esc(g.label) + ' costs" tabindex="0"><table><thead><tr><th scope="col">Line</th><th scope="col">Basis</th><th scope="col" class="num">Amount ($)</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>';
    }).join('') + '<p class="note">Land and the reserve lines are never in eligible basis, so their choice is fixed: eligible basis is the building\u2019s adjusted basis (<a href="https://www.law.cornell.edu/uscode/text/26/42">26 U.S.C. 42(d)(1) \u2197</a>), and reserves are cash held for operations.</p></div>';
  }

  function financialsView(params, parts) {
    var p = P.get(parts[1]);
    var s = p && p.scenarios.filter(function (x) { return x.scenarioId === parts[2]; })[0];
    if (!s) return '<a class="back-link" href="#/projects">\u2190 Projects</a><h1>Deal not in this browser</h1><p class="lede">Projects are saved in the browser that made them, so this address opens only there.</p><p>To pass a deal on, open Financials where it was made and use \u201cCopy share link\u201d or \u201cDownload deal file\u201d. A deal file opens here: <a href="#/open-deal">open a shared deal</a>.</p>';
    var back = '<a class="back-link" href="#/homes/' + esc(p.projectId) + '/' + esc(s.scenarioId) + '">← Homes and affordability</a>';
    // A scenario whose homes are typed in the unit grid (calc-grid.js) runs from the grid; any other runs from its
    // saved rent schedule.
    var manual = global.LabCalcGrid && p.overrides[s.scenarioId] && p.overrides[s.scenarioId].manualMix;
    var head = back + '<h1>Financials</h1><p class="lede">' + esc(p.name) + ', ' + esc(s.name) + '. Run on the site’s Deal Engine with ' + (manual ? 'the homes typed in this scenario’s unit grid' : 'this scenario’s saved rents') + '. Every figure and every reason comes from that engine.</p>';
    var sched = manual ? null : currentSchedule(p, s.scenarioId);
    if (!manual && !sched) return head + '<p class="callout">Save a rent schedule in Homes and affordability first.</p>';
    loadData();
    if (manual) global.LabCalcGrid.load();
    if (data.error) return head + '<p class="callout">' + esc(data.error) + '</p>';
    if (!data.rules || (manual && !global.LabCalcGrid.ready())) return head + '<p role="status">Loading the rent, FMR, pricing and cost-rule data…</p>';
    var d = draftFor(p, s.scenarioId);
    var G = manual ? global.LabCalcGrid.ctx(p, s.scenarioId, d) : null;
    var inputs = buildInputs(d, sched && sched.snapshot, data, { ChfaRentLimits: global.ChfaRentLimits, DealCostBasis: global.DealCostBasis, grid: G });
    var r = global.DealEngine.computeDeal(inputs);
    var saved = p.attachments.filter(function (a) { return a.scenarioId === s.scenarioId && a.kind === 'financials' && a.state !== 'replaced'; })[0];
    var money$ = function (name, value, label) {
      return '<input name="' + esc(name) + '" type="number" min="0" step="1000" inputmode="numeric" value="' + esc(value == null ? '' : value) + '" placeholder="not entered" aria-label="' + esc(label) + '">';
    };
    var costGroups = costGroupsHtml(d, inputs, money$);
    var sum = r.costBasis && r.costBasis.summary;
    var entered = costIds().filter(function (id) { return d.costs[id] !== '' && d.costs[id] != null; }).length;
    var costSub = entered + ' of ' + costIds().length + ' lines' + (isFinite(Number(d.fields['dc-tdc'])) && Number(d.fields['dc-tdc']) > 0 ? ', ' + money(Number(d.fields['dc-tdc'])) : '');
    return head + (global.LabDealFile ? global.LabDealFile.openedNote(p) : '') +
      (sched && sched.state === 'stale' ? '<p class="callout">The rent schedule is out of date: ' + esc(sched.staleReason) + '. Save it again in Homes and affordability before relying on these figures.</p>' : '') +
      (saved ? '<p class="note">' + (global.LabProjects.isTemporary && global.LabProjects.isTemporary(p.projectId) ? 'Kept for this visit only, because this browser is not storing data. Download the deal file to keep it. Last kept ' : 'Saved to the project ') + esc(Shell.when(saved.attachedAt)) + (saved.state === 'stale' ? ' (out of date: ' + esc(saved.staleReason) + ')' : '') + '. Changes below are a draft until you save again.</p>' : '') +
      (G ? '<div class="callout" data-role="grid-summary">From the unit grid: ' + esc(String(r.units)) + ' homes, ' + esc(money(r.annualRents) || 'rents unavailable') + ' scheduled rent per year, vacancy ' + esc(pct(r.vacancyRate) || 'not set') + '. <a href="' + esc(location.hash.split('?')[0]) + '" data-jump="fin-step-homes">Change the homes or rents</a>.</div>'
        : '<div class="callout">From the saved schedule: ' + esc(String(r.units)) + ' homes, ' + esc(money(r.annualRents) || 'rents unavailable') + ' scheduled rent per year, vacancy ' + esc(pct(inputs.resolvedDealMix.vacancyRate)) + '. <a href="#/homes/' + esc(p.projectId) + '/' + esc(s.scenarioId) + '">Change the homes or rents</a>.</div>') +
      answerPanel(r, inputs) +
      '<form class="homes" data-action="financials" novalidate>' +
      (G ? stepOpen('fin-step-homes', 'Homes and rents', global.LabCalcGrid.sub(r, G), global.LabCalcGrid.section(p, s, G, inputs, r, data)).replace('<details ', r.units > 0 ? '<details ' : '<details open ') : '') +
      stepOpen('fin-step-costs', 'Costs', costSub, '<h2>Costs</h2><p class="note">Every line on the full Deal Calculator, in the Colorado Division of Housing\u2019s nine groups. Open a group to enter its lines. A blank line carries no cost; anything not itemized is treated as outside eligible basis, as on the full Deal Calculator. Each line starts at that calculator\u2019s basis choice; change it where your deal differs. A line partly in basis needs its part in basis before the engine will price basis. The developer fee is its own line under Developer fee; the engine tests it against CHFA\u2019s limit.</p>' +
      costGroups + '<div class="actions"><button type="button" class="button-link secondary" data-action="use-cost-total">Make total development cost match the cost lines</button>' +
      '<button type="button" class="button-link secondary" data-action="clear-costs">Clear the cost lines</button></div>' + fieldGrid(d, 'costs') +
      '<h3>Developer fee, building purchase and federal grants</h3><p class="note">These answers set CHFA\u2019s fee limits and what a building purchase and a federal grant do to basis.</p>' + fieldGrid(d, 'devfee') +
      (function () {
        var tdc = Number(d.fields['dc-tdc']);
        if (!isFinite(tdc) || tdc <= 0) return '<p class="note">Enter a total development cost above.</p>';
        var itemized = inputs.costLines.reduce(function (t, l) { return t + (Number(l.amount) || 0); }, 0);
        var left = tdc - itemized;
        return '<p class="note" role="status">Itemized ' + esc(money(itemized)) + ' of ' + esc(money(tdc)) + '. ' +
          (Math.abs(left) < 1 ? 'Nothing left to place.' : left > 0 ? esc(money(left)) + ' still to place; the engine needs the whole cost itemized before it can test the developer fee against CHFA\u2019s limit.' : 'Itemized costs are ' + esc(money(-left)) + ' above the total.') + '</p>';
      }())) +
      stepOpen('fin-step-budget', 'Operating budget', r.annualOpex != null ? money(r.annualOpex) + ' a year' : '', operatingBudget(d, inputs, r)) +
      stepOpen('fin-step-assumptions', 'Loans, credits and terms', r.interestRate != null ? r.interestRate + '% loan, $' + Number(inputs.fields['dc-equity-price']).toFixed(2) + ' equity' : '',
        '<h2>Assumptions</h2>' + (G ? '' : rentLimitsFixed(p, s)) + rentCapInputs(d, r) + (global.LabCalcTax ? global.LabCalcTax.callout(p, d) : '') + fieldGrid(d, null) + (SITE() ? SITE().area(d, inputs, G) : '') + creditInputs(d) + loanStackInputs(d) + '<h2>Exit and projection</h2>' + fieldGrid(d, 'exit')) +
      stepOpen('fin-step-stress', 'Stress settings', combinedLabel(inputs.constants), '<h2>Stress case settings</h2><p class="note">How far each stress case moves rent, vacancy and operating cost. The full Deal Calculator\u2019s defaults are tool settings for screening, not a lender\u2019s or CHFA\u2019s required cases. The sliders under Full result test one change at a time.</p>' + fieldGrid(d, 'stressconst') + '<div class="actions"><button type="button" class="button-link secondary" data-action="reset-stress-settings">Reset to the Deal Calculator\u2019s defaults</button></div>') +
      '<h2>Full result</h2><p class="note jump-links">Jump to <a href="' + esc(location.hash.split('?')[0]) + '" data-jump="fin-sliders">Stress sliders</a> · <a href="' + esc(location.hash.split('?')[0]) + '" data-jump="fin-ls">Lender schedules</a></p>' + setAsideStatus(r) + (function () { var t = boostTag(r, inputs.fields); return '<p class="boost-tag boost-' + t.kind + '" data-role="boost-tag">' + esc(t.text) + '</p>'; }()) + '<div class="fin-grid">' +
      card('Net operating income', money(r.noi), r, 'noi') +
      card('Supportable first mortgage', money(r.mortgage), r, 'mortgage', r.mortgage != null ? 'At ' + ratio(r.dcr) + ' coverage, ' + r.interestRate + '% over ' + r.term + ' years' : null) +
      card('Annual tax credits', money(r.annualCredits), r, 'annualCredits', r.annualCredits != null ? 'Qualified basis ' + money(r.eligibleBasis) + ', after the boost and the ' + pct(r.applicableFraction, 0) + ' applicable fraction' : null) +
      card('Tax-credit equity', money(r.equity), r, 'equity', r.equity != null ? 'At $' + Number(inputs.fields['dc-equity-price']).toFixed(2) + ' per credit dollar over 10 years' : null) +
      card('Deferred developer fee', money(r.deferredDevFee), r, 'deferredDevFee') +
      card('Funding gap', money(r.gap), r, 'gap', r.gap != null ? (r.gap > 0 ? 'Still to fund after equity, mortgage and deferred fee' : 'Modeled sources cover the costs') : null) +
      card('Coverage after stress', ratio(r.stress && r.stress.combined && r.stress.combined.dscr), r, 'stress', combinedLabel(inputs.constants).replace(/^r/, 'R') + ' together') +
      card('Break-even occupancy', pct(r.breakEvenOcc), r, 'breakEvenOcc') +
      '</div>' +
      (sum && sum.reason ? '<p class="callout"><strong>Costs:</strong> ' + esc(sum.reason) + '</p>' : '') +
      basisSection(r, inputs.fields) + creditChecks(r) + (global.LabCalcGrid ? global.LabCalcGrid.tables(r, inputs, G, data) : '') + (global.LabCalcComps ? global.LabCalcComps.render(inputs) : '') +
      mostLikely(d, inputs, r) + sourcesUses(r) + loanTable(r) + (DOH() ? DOH().sections(r, d.fields) : '') + stressTable(r, inputs.constants) + stressSliders(d, inputs, r) + rateGrid(inputs, r) + exitSummary(r, inputs) + projectionTable(r) +
      (global.LabLenderExport ? global.LabLenderExport.remember(r, s.name) : '') + (global.LabLenderSchedules ? global.LabLenderSchedules.render(d, r, fieldGrid) : '') + waterfallSection(d, r) + (SITE() ? SITE().concept(d, inputs, r) : '') + (global.LabCalcOutcome ? global.LabCalcOutcome.render(p, d, inputs, r, G) : '') +
      '<p class="note">Calculated by the COHO Deal Calculator. CHFA ' + esc(data.chfa.meta.fiscal_year) + ' rent table effective ' + esc(data.chfa.meta.effective_date) + '; HUD ' + esc(data.hud.meta && data.hud.meta.fiscal_year ? 'FY' + data.hud.meta.fiscal_year + ' ' : '') + 'Fair Market Rents; equity pricing Novogradac national average as of ' + esc(data.equity.meta.as_of || '') + '. Screening only, not underwriting.</p>' +
      '<div class="actions"><button type="submit">Save to ' + esc(s.name) + '</button>' +
      '<a class="button-link secondary" href="#/project/' + esc(p.projectId) + '">Back to the project</a></div></form>' +
      (global.LabDealFile ? global.LabDealFile.panel(p, s) : '') +
      (global.LabDealExtras ? global.LabDealExtras.render(p, s, d, inputs, r, data) : '') +
      (global.LabCalcChecks ? global.LabCalcChecks.render(p, s) : '');
  }

  // DOH's four expense groups and other income, per home per year, with the engine's own totals. Taxes and the
  // replacement reserve are entered under Assumptions and counted in DOH's "Other expenses" group, as on the live page.
  function operatingBudget(d, inputs, r) {
    var sum = OB().summarizeOperating(inputs.operatingLines, inputs.otherIncomeLines);
    var perYear = function (v) { return v == null || !isFinite(v) ? '\u2014' : esc(money(v)); };
    var box = function (name, value, label) {
      return '<input name="' + esc(name) + '" type="number" min="0" step="10" inputmode="numeric" value="' + esc(value == null ? '' : value) + '" placeholder="not entered" aria-label="' + esc(label) + '">';
    };
    var groups = OB().GROUPS.map(function (g) {
      // Taxes and the reserve sit where DOH's sheet puts them, before the line each precedes.
      var rows = [];
      OB().LINE_TEMPLATE.filter(function (t) { return t.group === g.id; }).forEach(function (t) {
        OB().SEPARATE_LINES.filter(function (x) { return x.before === t.id; }).forEach(function (x) {
          var v = d.fields[x.input];
          rows.push('<tr class="sep-line"><th scope="row">' + esc(x.label) + '</th><td class="num">' + esc(v === '' || v == null ? 'not entered' : money(Number(v))) + ' <small>(under Assumptions)</small></td></tr>');
        });
        rows.push('<tr><th scope="row">' + esc(t.label) + '</th><td class="num">' + box('op:' + t.id, d.opLines[t.id], t.label + ' ($ per home per year)') + '</td></tr>');
      });
      var hasSep = OB().SEPARATE_LINES.some(function (x) { return x.group === g.id; });
      return '<tbody><tr class="group-row"><th scope="rowgroup" colspan="2">' + esc(g.label) + (hasSep ? ' <small>(lines entered here)</small>' : '') +
        ' <span class="sub">' + (sum.reason ? '' : perYear(sum.groups[g.id])) + '</span></th></tr>' + rows.join('') + '</tbody>';
    }).join('');
    var income = '<tbody><tr class="group-row"><th scope="rowgroup" colspan="2">Other income <span class="sub">' + (sum.reason ? '' : perYear(sum.otherIncomePerUnitYear)) + '</span></th></tr>' +
      OB().INCOME_TEMPLATE.map(function (t) {
        return '<tr><th scope="row">' + esc(t.label) + '</th><td class="num">' + box('opinc:' + t.id, d.opIncome[t.id], t.label + ' ($ per home per year)') + '</td></tr>';
      }).join('') + '</tbody>';
    var pupa = OB().pupaExpenses(sum, d.fields['dc-prop-tax'], d.fields['dc-rep-reserve']);
    var units = r.units;
    var totals = sum.reason ? '<p class="callout" role="status"><strong>Operating budget:</strong> ' + esc(sum.reason) + '</p>'
      : '<dl class="op-totals" role="status">' +
        '<div><dt>Operating lines</dt><dd>' + perYear(sum.perUnitYear) + ' per home a year (' + perYear(sum.perUnitMonth) + ' a month)</dd></div>' +
        '<div><dt>With taxes and reserve (DOH\u2019s P.U.P.A.)</dt><dd>' + (pupa.value == null ? esc(pupa.reason) : perYear(pupa.value) + ' per home a year') + '</dd></div>' +
        (units > 0 ? '<div><dt>Operating lines, whole property</dt><dd>' + perYear(sum.perUnitYear * units) + ' a year for ' + esc(String(units)) + ' homes</dd></div>' : '') +
        '<div><dt>Other income</dt><dd>' + perYear(sum.otherIncomePerUnitYear) + ' per home a year, added to rent before vacancy</dd></div></dl>';
    return '<h2>Operating budget</h2>' + fieldGrid(d, 'noi') +
      (d.fields['dc-auto-noi'] === 'no' ? '<p class="callout">Net operating income is the figure you entered. The rents, vacancy and budget below do not change the results until you switch back to computing it.</p>' : '') +
      '<p class="note">Dollars per home per year, in the Colorado Division of Housing\u2019s operating pro forma lines, as on the full Deal Calculator. A blank line is nothing budgeted on it; a budget with every line blank is unknown, not $0.</p>' +
      (d.opExample ? '<p class="callout">These amounts are an invented example ($5,400 a home a year). They are not a benchmark: replace them with your own budget.</p>' : '') +
      (d.opMoved ? '<p class="callout">This draft was saved with one monthly operating figure. It now sits in \u201cOther expenses, Other\u201d at 12 times that figure, so its results are unchanged. Spread it across the lines when you can.</p>' : '') +
      '<div class="table-scroll op-table" role="region" aria-label="Operating budget" tabindex="0"><table><thead><tr><th scope="col">Line</th><th scope="col" class="num">$ per home per year</th></tr></thead>' +
      groups + income + '</table></div>' + totals + fieldGrid(d, 'opex');
  }

  Shell.views.financials = financialsView;

  var main = document.getElementById('main');
  function route() { return (location.hash || '').slice(2).split('?')[0].split('/'); }
  function readDraft(form, d) {
    var fd = new FormData(form);
    FIELDS.forEach(function (i) {
      // An unticked box sends nothing, so a box on the form reads as ticked or not, never as unchanged.
      if (i.type === CHECK) { if (!form.querySelector || form.querySelector('[name="' + i.id + '"]')) d.fields[i.id] = fd.get(i.id) != null ? 'yes' : ''; return; }
      d.fields[i.id] = fd.get(i.id) == null ? d.fields[i.id] : String(fd.get(i.id));
    });
    if (SITE()) SITE().read(d);
    costIds().forEach(function (id) {
      var v = fd.get('cost:' + id), part = fd.get('part:' + id), use = fd.get('used:' + id), b = fd.get('basis:' + id);
      d.costs[id] = v == null ? d.costs[id] : String(v);
      if (b != null) { d.basis = d.basis || {}; d.basis[id] = String(b); }
      if (part != null) { d.parts = d.parts || {}; d.parts[id] = String(part); }
      if (use != null) { d.used = d.used || {}; d.used[id] = String(use); }
    });
    var touched = false;
    OB().LINE_TEMPLATE.forEach(function (t) { var v = fd.get('op:' + t.id); if (v != null) { if (String(v) !== d.opLines[t.id]) touched = true; d.opLines[t.id] = String(v); } });
    OB().INCOME_TEMPLATE.forEach(function (t) { var v = fd.get('opinc:' + t.id); if (v != null) { if (String(v) !== d.opIncome[t.id]) touched = true; d.opIncome[t.id] = String(v); } });
    if (touched) d.opExample = false;
    (d.tranches || []).forEach(function (t, i) {
      var before = t.program;
      TRANCHE_KEYS.forEach(function (k) { var v = fd.get('tr:' + i + ':' + k); if (v != null) t[k] = String(v); });
      // As on the live page, picking another program resets the federal-money answer to that program's default.
      if (t.program !== before) t.fundSource = FEDERAL_FUND_DEFAULTS[t.program] || '';
      // The DOH answers follow the same rule: read from the row, and reset to the new program's own when it changes.
      if (DOH()) { DOH().read(fd, t, i); if (t.program !== before) DOH().programChanged(t); }
    });
    // The unit grid, when it is on the form (a scenario whose homes are typed there).
    if (global.LabCalcGrid && fd.get('dc-unit-mix-source') === 'manual') {
      var at = route(), gp = P.get(at[1]);
      if (gp) global.LabCalcGrid.read(fd, form, d, global.LabCalcGrid.ctx(gp, at[2], d));
    }
    return d;
  }
  // A redraw keeps each section the reader opened or closed (by its id) as they left it.
  function renderKeepingOpen() {
    var open = {};
    Array.prototype.forEach.call(main.querySelectorAll('details[id]'), function (el) { open[el.id] = el.open; });
    Shell.render();
    Object.keys(open).forEach(function (id) { var el = document.getElementById(id); if (el && el.tagName === 'DETAILS') el.open = open[id]; });
  }
  main.addEventListener('change', function (ev) {
    var form = ev.target.form;
    if (!form || form.dataset.action !== 'financials') return;
    var parts = route(), name = ev.target.name;
    P.setOverride(parts[1], parts[2], 'financialsDraft', readDraft(form, draftFor(P.get(parts[1]), parts[2])));
    // Redrawn once the click or Tab that left the field has finished, with focus where the reader moved (redraw.js).
    if (global.LabRedraw) return global.LabRedraw.after(renderKeepingOpen);
    renderKeepingOpen();
    var again = main.querySelector('[name="' + name + '"]');
    if (again) again.focus();
  });
  main.addEventListener('input', function (ev) {
    var i = STRESS_INPUTS.filter(function (x) { return x.id === ev.target.id; })[0];
    var out = i && main.querySelector('output[for="' + i.id + '"]');
    if (out) out.textContent = i.fmt(Number(ev.target.value));
  });
  main.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('button[data-action="add-tranche"], button[data-action="remove-tranche"]');
    if (t && t.form && t.form.dataset.action === 'financials') {
      var at = route(), dr = readDraft(t.form, draftFor(P.get(at[1]), at[2]));
      if (!dr.tranches || !dr.tranches.length) dr.tranches = [seedTranche()];
      if (t.dataset.action === 'add-tranche' && dr.tranches.length < MAX_TRANCHES) dr.tranches.push(addedTranche());
      if (t.dataset.action === 'remove-tranche') { dr.tranches.splice(Number(t.dataset.idx), 1); if (!dr.tranches.length) dr.tranches.push(seedTranche()); }
      P.setOverride(at[1], at[2], 'financialsDraft', dr);
      renderKeepingOpen();
      var focus = main.querySelector(t.dataset.action === 'add-tranche' ? '[data-tranche="' + (dr.tranches.length - 1) + '"] select' : '[data-action="add-tranche"]');
      if (focus) focus.focus();
      return;
    }
    // The live page's cost and stress-setting buttons: total from the lines, clear the lines, reset the settings.
    var cbtn = ev.target.closest && ev.target.closest('button[data-action="use-cost-total"], button[data-action="clear-costs"], button[data-action="reset-stress-settings"]');
    if (cbtn && cbtn.form && cbtn.form.dataset.action === 'financials') {
      var cp = route(), cd = readDraft(cbtn.form, draftFor(P.get(cp[1]), cp[2]));
      if (cbtn.dataset.action === 'use-cost-total') {
        var sum = costIds().reduce(function (t, id) { var v = Number(cd.costs[id]); return t + (cd.costs[id] !== '' && isFinite(v) ? v : 0); }, 0);
        if (!(sum > 0)) return;
        cd.fields['dc-tdc'] = String(Math.round(sum));
      } else if (cbtn.dataset.action === 'clear-costs') {
        costIds().forEach(function (id) { cd.costs[id] = ''; });
        cd.parts = {}; cd.used = {};
      } else CONST_INPUTS.forEach(function (i) { cd.fields[i.id] = i.value; });
      P.setOverride(cp[1], cp[2], 'financialsDraft', cd);
      renderKeepingOpen();
      var again = main.querySelector('button[data-action="' + cbtn.dataset.action + '"]');
      if (again) again.focus();
      return;
    }
    var b = ev.target.closest && ev.target.closest('button[data-action="use-rate"]');
    if (!b) return;
    var parts = route(), d = draftFor(P.get(parts[1]), parts[2]);
    d.fields['dc-rate'] = b.dataset.rate;
    P.setOverride(parts[1], parts[2], 'financialsDraft', d);
    Shell.render();
  });
  main.addEventListener('submit', function (ev) {
    var form = ev.target;
    if (form.dataset.action !== 'financials') return;
    // Redraw any change still waiting first, so Save reads the form as that change left it (as on Homes).
    if (global.LabRedraw) { global.LabRedraw.flush(); form = main.querySelector('form[data-action="financials"]') || form; }
    var parts = route();
    var p = P.get(parts[1]);
    var d = readDraft(form, draftFor(p, parts[2]));
    P.setOverride(parts[1], parts[2], 'financialsDraft', d);
    // A run from the unit grid names no schedule: its homes and rents are in snapshot.inputs.
    var G = global.LabCalcGrid ? global.LabCalcGrid.ctx(p, parts[2], d) : null;
    var sched = G ? null : currentSchedule(p, parts[2]);
    var inputs = buildInputs(d, sched && sched.snapshot, data, { ChfaRentLimits: global.ChfaRentLimits, DealCostBasis: global.DealCostBasis, grid: G });
    var r = global.DealEngine.computeDeal(inputs);
    P.attach(parts[1], parts[2], {
      kind: 'financials', label: (r.gap == null ? 'Run, gap unavailable' : 'Gap ' + money(r.gap)) + ' \u00b7 ' + boostTag(r, inputs.fields).short,
      snapshot: { inputs: JSON.parse(JSON.stringify(inputs)), result: JSON.parse(JSON.stringify(r)), scheduleAttachmentId: sched ? sched.attachmentId : null },
      sourceDates: { chfaTable: data.chfa.meta.effective_date, equityPricing: data.equity.meta.as_of || null },
      methodVersions: { dealEngine: 'Housing-Analytics ' + (global.LAB_PIN || '') + ' js/deal-engine.js' },
      origin: { route: '#/financials/' + parts[1] + '/' + parts[2] }
    });
    Shell.render();
  });

  global.LabFinancials = { setAsideStatus: setAsideStatus, SET_ASIDE_HELP: SET_ASIDE_HELP, boostTag: boostTag, basisSection: basisSection, LS_INPUTS: LS_INPUTS, fieldGrid: function (d, g) { return fieldGrid(d, g); }, SOFT_REFERENCE: SOFT_REFERENCE, AMOUNT_SOURCE: AMOUNT_SOURCE, IMPACT_FEE_NOTE: IMPACT_FEE_NOTE, programReference: programReference, _data: data, LOAN_INPUTS: LOAN_INPUTS, SOFT_PROGRAMS: SOFT_PROGRAMS, FEDERAL_FUND_DEFAULTS: FEDERAL_FUND_DEFAULTS, seedTranche: seedTranche, addedTranche: addedTranche, readDraft: readDraft, WF_INPUTS: WF_INPUTS, STRESS_INPUTS: STRESS_INPUTS, RATE_STEPS: RATE_STEPS, PRICE_STEPS: PRICE_STEPS, buildInputs: buildInputs, inputsFor: inputsFor, currentSchedule: currentSchedule, emptyDraft: emptyDraft, draftFor: draftFor, equityDefault: equityDefault, INPUTS: INPUTS, exitSummary: exitSummary, costIds: costIds, lineBasis: lineBasis, costGroupsHtml: costGroupsHtml, CONSTANTS: CONSTANTS, CREDIT_RATES: CREDIT_RATES, SOURCE_TAGS: SOURCE_TAGS, sourceTag: sourceTag, CREDIT_INPUTS: CREDIT_INPUTS, RENT_CAP_INPUTS: RENT_CAP_INPUTS, rentCapInputs: rentCapInputs, CHECKBOX_IDS: CHECKBOX_IDS, NOI_INPUTS: NOI_INPUTS, CONST_INPUTS: CONST_INPUTS, constantsFrom: constantsFrom, stressTable: stressTable, rentLimitsFixed: rentLimitsFixed, creditChecks: creditChecks, sourcesUses: sourcesUses, sourcesUsesRows: sourcesUsesRows, unavailable: unavailable };
})(window);
