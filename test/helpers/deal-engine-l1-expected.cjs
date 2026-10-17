'use strict';
// Explicit L1 corrections to the pre-E1 invented golden. No broad re-recording.
// B is a $1m loan with accrued interest, so 1m * 1.03^15 = $1,557,967;
// resale $12,463,284.11350537 - senior $6,262,519.992006887 - that balance
// = $4,642,797. Regular payment is $0, not the former $50,592 amortization.
module.exports = function expectedFigures(scenario, original) {
  const figures = {...original};
  if (scenario === 'B') {
    // Repeated container text follows the same displayed repayment label.
    const label = require('../../js/deal-engine').LOAN_TYPES.accrue_defer;
    for (const key of Object.keys(figures)) if (typeof figures[key] === 'string') {
      figures[key] = figures[key].replaceAll('$1,000,000 loans @ $50,592/yr debt service', '$1,000,000 loans @ $0/yr debt service')
        .replaceAll('↳ CHFA HTF — 3% · 30y  $1,000,000 ($50,592/yr)  5.0%', '↳ CHFA HTF — ' + label + ' · 3% · maturity year 30  $1,000,000  5.0%');
    }
    figures['dc-exit-softbal'] = '$1,557,967';
    figures['dc-exit-net'] = '$4,642,797';
    figures['dc-exit-summary'] = figures['dc-exit-summary'].replace('$610,506','$1,557,967').replace('$5,590,258','$4,642,797');
  }
  return figures;
};
