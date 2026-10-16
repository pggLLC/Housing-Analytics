/** Field explanations for the screening calculator. Source metadata is bound at prefill time. */
(function (root) {
  'use strict';
  var fields = {};
  function add(id, definition, status, why) {
    fields[id] = { definition: definition, status: status || 'assumption',
      why: why || 'A starting assumption for screening. Replace it with your project evidence.' };
  }
  var definitions = {
    'dc-tdc': 'Total cost to develop the project, in dollars.',
    'dc-gross-sf': 'Total building floor area, including circulation and common areas.',
    'dc-gsf-standard': 'Bedroom-size benchmark used for the optional floor-area estimate.',
    'dc-gsf-efficiency': 'Residential net area divided by gross building area.',
    'dc-units': 'Total homes in the project.',
    'dc-sale-target-ami': 'Income target for the ownership affordability screen, as a percent of AMI.',
    'dc-rent-limit-regime': 'The rent-limit source used for this scenario.',
    'dc-prop123-program': 'The Prop 123 program whose income and rent rules apply.',
    'dc-prop123-petition': 'An approved rural resort petition that replaces the program\u2019s AMI limit.',
    'dc-minimum-set-aside': 'The selected federal LIHTC minimum set-aside test.',
    'dc-county-select': 'County whose income limits and rent benchmarks apply to the site.',
    'dc-coords-lat': 'Latitude of the project site.',
    'dc-coords-lon': 'Longitude of the project site.',
    'dc-noi': 'Annual net operating income entered for the manual NOI option.',
    'dc-vacancy': 'Share of scheduled revenue lost to vacancy, in percent.',
    'dc-opex': 'Monthly operating expense per home.',
    'dc-rep-reserve': 'Annual replacement reserve per home.',
    'dc-prop-tax': 'Annual property tax per home before the selected exemption.',
    'dc-tax-exempt': 'Share of property taxes exempted in the scenario.',
    'dc-senior-mode': 'Size the senior loan from NOI or keep an entered principal amount.',
    'dc-senior-amount': 'Entered senior loan principal; coverage is measured, not assumed.',
    'dc-senior-type': 'Selected senior repayment obligation; verify the loan agreement.',
    'dc-senior-maturity': 'Year principal becomes due, separately from amortization.',
    'dc-senior-io-years': 'Years of interest-only payments before amortization starts.',
    'dc-senior-priority': 'Payment priority within must-pay or contingent loans.',
    'dc-senior-cfpay': 'Percentage of remaining positive cash paid to a contingent senior loan.',
    'dc-dcr': 'Required net operating income divided by annual debt service.',
    'dc-rate': 'Annual interest rate assumed for the permanent mortgage.',
    'dc-term': 'Permanent mortgage amortization period, in years.',
    'dc-equity-price': 'Dollars of investor equity assumed per dollar of tax credit.',
    'dc-exit-hold': 'Years until the modeled sale.',
    'dc-exit-cap': 'Capitalization rate used to estimate resale value from NOI.',
    'dc-own-resale-years': 'Years before the ownership resale screen.',
    'dc-own-resale-principal': 'Mortgage principal at the start of the resale scenario.',
    'dc-own-resale-costs': 'Transaction costs in the ownership resale scenario.',
    'dc-own-resale-appreciation': 'Annual price appreciation assumed in the resale scenario.',
    'dc-const-rent-stress': 'Rent reduction in the standalone stress scenario, in percent.',
    'dc-const-vac-stress': 'Vacancy increase in the standalone stress scenario, in percentage points.',
    'dc-const-opex-stress': 'Expense increase in the standalone stress scenario, in percent.',
    'dc-const-comb-rent': 'Rent reduction in the combined stress scenario, in percent.',
    'dc-const-comb-vac': 'Vacancy increase in the combined stress scenario, in percentage points.',
    'dc-const-comb-opex': 'Expense increase in the combined stress scenario, in percent.',
    'dc-const-rent-burden': 'Income share allocated to gross rent in the non-CHFA formula.',
    'dc-const-owner-piti': 'Income share allocated to ownership housing costs.',
    'dc-const-owner-down': 'Buyer down payment share.',
    'dc-const-owner-rate': 'Interest rate assumed for the buyer mortgage.',
    'dc-const-owner-term': 'Buyer mortgage amortization period.',
    'dc-const-owner-tax': 'Annual property tax rate assumed for ownership.',
    'dc-const-owner-ins': 'Annual insurance rate assumed for ownership.',
    'dc-const-owner-hoa': 'Monthly homeowner association cost.',
    'dc-wf-lp-equity': 'Limited partner equity contribution.',
    'dc-wf-catchup': 'Selected general partner catch-up treatment.',
    'pf-rent-growth': 'Annual rent growth in the pro forma.',
    'pf-exp-growth': 'Annual expense growth in the pro forma.',
    'pf-years': 'Projection horizon in years.',
    'dc-formula-ceiling-eg': 'Gross monthly rent ceiling for a two-bedroom home at 60% AMI.',
    'dc-rent-limit-example': 'Gross monthly rent ceiling for a two-bedroom home at 60% AMI.',
    'dc-fmr-note': 'Gross monthly rent ceilings by income tier for two-bedroom homes.',
    'dc-rent-ach-fmr-grid': 'HUD fair market rents by bedroom size.',
    'dc-rent-allowance-status': 'Utility allowance and fees used to convert gross rent to contract rent.',
    'dc-noi-allowance-status': 'Utility allowance basis used in scheduled rent revenue.',
    'dc-res-sf': 'Floor area of all residential rental units, excluding common areas.',
    'dc-restricted-sf': 'Floor area of the units counted as LIHTC units, for the floor-space fraction. Leave out restricted units that are not LIHTC units.',
    'dc-boost-designation': 'The QCT, DDA, SADDA or CHFA designation claimed for the 30% basis boost.',
    'dc-boost-evidence': 'Evidence supporting the basis-boost designation.',
    'dc-boost-pct': 'Basis boost percentage in CHFA\'s letter (CHFA state designation only, up to 30%).',
    'dc-credit-requested': 'Annual federal credit requested in the application.',
    'dc-credit-awarded': 'Annual federal credit awarded by CHFA.',
    'dc-ioi': 'Whether the builder has an identity of interest with the developer or owner.',
    'dc-state-awarded': 'Whether CHFA has awarded the state credit entered; only an award counts as a source.',
    'dc-acq-42d2': 'Whether an existing building purchase meets 26 U.S.C. 42(d)(2), including a rehabilitation that earns its own credit under 42(e), so its price can count in eligible basis.',
    'dc-special-pop': 'Whether the project serves people experiencing homelessness or special populations (CHFA developer fee base).',
    'dc-state-path': 'Which CHFA state credit application the state credit comes from; each has its own limit.',
    'dc-state-annual': 'Annual state housing tax credit for the project.',
    'dc-state-standard-annual': 'Annual standard state credit paired with a Round Two accelerated credit.',
    'dc-state-price': 'Dollars of investor equity per dollar of state credit.'
  };
  Object.keys(definitions).forEach(function (id) { add(id, definitions[id]); });
  ['dc-tdc', 'dc-units', 'dc-noi'].forEach(function (id) {
    fields[id].status = 'illustrative';
    fields[id].why = 'A worked example to demonstrate the screen, not a value for decisions. Enter your project figure.';
  });
  ['dc-gross-sf', 'dc-county-select', 'dc-coords-lat', 'dc-coords-lon'].forEach(function (id) {
    fields[id].status = 'needs-source'; fields[id].why = 'No project-specific source has been supplied.';
  });
  [20, 30, 40, 50, 60, 70, 80, 100, 110, 120].forEach(function (tier) {
    add('dc-units-' + tier, 'Homes assigned to the ' + tier + '% AMI tier.', 'illustrative',
      'An example unit allocation; replace it with your project mix or prefill from local need.');
    add('dc-br-' + tier, 'Bedroom size for the ' + tier + '% AMI tier when the split grid is off.');
    ['studio', '1br', '2br', '3br', '4br'].forEach(function (br) {
      add('dc-units-' + tier + '-' + br, br + ' homes at ' + tier + '% AMI in the split grid.', 'illustrative',
        'An empty example allocation, not a measured local need.');
    });
  });
  add('dc-market-bedroom', 'Bedroom size for unrestricted homes when the grid has no bedroom mix.');
  add('dc-market-rent-mode', 'Use local ZORI distributed by HUD FMR ratios and ACS renter bedroom mix or your sourced market-rent overrides.');
  add('dc-market-rent-source', 'Source, date and geography supporting your unrestricted market-rent overrides.', 'needs-source', 'An override requires its survey or comparable-rent citation.');
  ['studio', '1br', '2br', '3br', '4br'].forEach(function (br) {
    add('dc-market-rent-' + br, 'Monthly rent for unrestricted ' + br + ' homes; no utility allowance is deducted.', 'needs-source', 'Local ZORI and renter bedroom mix or your market-rent source is required.');
    fields['dc-market-rent-' + br].dataSource = 'county-zori-bedroom-estimate';
  });
  // Only these fields can be derived from a page-owned source record.
  ['dc-formula-ceiling-eg', 'dc-rent-limit-example', 'dc-fmr-note', 'dc-rent-ach-fmr-grid'].forEach(function (id) {
    fields[id].dataSource = 'rent-limit-table';
  });
  ['dc-units', 'dc-vacancy'].forEach(function (id) { fields[id].dataSource = 'subject-schedule'; });
  ['dc-rent-allowance-status', 'dc-noi-allowance-status'].forEach(function (id) { fields[id].dataSource = 'subject-allowance'; });
  Object.keys(fields).filter(function (id) { return /^dc-(units|br)-\d/.test(id); }).forEach(function (id) {
    fields[id].dataSource = 'local-need-or-schedule';
  });
  var tranche = {
    prog: 'Soft-funding program selected for this tranche.', amount: 'Dollars assigned to this soft-funding tranche.',
    rate: 'Annual interest rate for this tranche.', term: 'Amortization period for this tranche.',
    cfpay: 'Share of remaining positive cash after must-pay debt, for a contingent loan.',
    type: 'Repayment obligation; forgiveness assumes the agreement conditions are met.',
    maturity: 'Year principal is due or conditionally forgiven.', io: 'Interest-only years before amortization starts.',
    accrue: 'Whether tranche interest is paid currently or accrued until exit.', priority: 'Payment order in the cash-flow waterfall.'
  };
  tranche.fed = 'Whether this source contains federal money; a federally funded grant reduces eligible basis.';
  Object.keys(tranche).forEach(function (key) { add('tranche-' + key, tranche[key]); });
  ['fed', 'state'].forEach(function (src) {
    ['closing', 'completion', 'stabilization'].forEach(function (stage) {
      add('dc-' + src + '-payin-' + stage, 'Share of ' + (src === 'fed' ? 'federal' : 'state') + ' credit equity paid in at ' + stage + ', in percent.');
    });
  });
  ['dc-res-sf', 'dc-restricted-sf', 'dc-boost-evidence'].forEach(function (id) {
    fields[id].status = 'needs-source'; fields[id].why = 'No project-specific source has been supplied.';
  });
  // #2160: itemized cost lines (js/deal-cost-basis.js). The prefilled amounts
  // are an INVENTED example budget, so they are illustrative.
  add('cost-amount', 'Dollars on this development budget line.', 'illustrative',
    'An invented example budget line; replace it with your project budget.');
  add('cost-basis', 'Whether this cost line is in eligible basis, partly in it, or not in it.');
  add('cost-eligible', 'The part of this cost line that is in eligible basis.', 'illustrative',
    'An invented example; replace it with your cost certification or budget.');
  add('cost-used', 'Contingency proposed for use so far.', 'illustrative', 'An invented example; replace it with your draw records.');
  function costKey(id) {
    var m = /^dc-cost-[a-z_]+(-basis|-eligible|-used)?$/.exec(id);
    return m ? 'cost-' + (m[1] ? m[1].slice(1) : 'amount') : null;
  }
  function get(id) { return fields[id] || fields[id.replace(/^ip-tr-\d+-/, 'tranche-')] || fields[costKey(id)] || null; }
  var api = { fields: fields, get: get };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DealCalculatorInputRegistry = api;
}(typeof window !== 'undefined' ? window : null));
