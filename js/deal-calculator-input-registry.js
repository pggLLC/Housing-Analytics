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
    'dc-noi-allowance-status': 'Utility allowance basis used in scheduled rent revenue.'
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
  var tranche = {
    prog: 'Soft-funding program selected for this tranche.', amount: 'Dollars assigned to this soft-funding tranche.',
    rate: 'Annual interest rate for this tranche.', term: 'Amortization period for this tranche.',
    cfpay: 'Share of tranche debt service paid from annual operating cash flow.',
    accrue: 'Whether tranche interest is paid currently or accrued until exit.', priority: 'Payment order in the cash-flow waterfall.'
  };
  Object.keys(tranche).forEach(function (key) { add('tranche-' + key, tranche[key]); });
  function get(id) { return fields[id] || fields[id.replace(/^ip-tr-\d+-/, 'tranche-')] || null; }
  var api = { fields: fields, get: get };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DealCalculatorInputRegistry = api;
}(typeof window !== 'undefined' ? window : null));
