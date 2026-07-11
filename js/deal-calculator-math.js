(function (root, factory) {
  'use strict';

  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DealCalculatorMath = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function mortgageConstant(annualRate, termYears) {
    var monthlyRate = annualRate / 12;
    var totalMonths = termYears * 12;
    if (monthlyRate <= 0 || totalMonths <= 0) return 0;
    var factor = Math.pow(1 + monthlyRate, totalMonths);
    return (monthlyRate * factor / (factor - 1)) * 12;
  }

  return {
    mortgageConstant: mortgageConstant
  };
}));
