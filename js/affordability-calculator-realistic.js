/**
 * Realistic Affordability Calculator
 * Replaces the simplistic 3x income rule with accurate mortgage modeling
 * 
 * Factors included:
 * - Principal & Interest (using actual mortgage formulas)
 * - Property taxes (by county)
 * - Homeowner's insurance (by county/risk profile)
 * - PMI (when down payment < 20%)
 * - HOA fees (by county)
 * - Debt-to-Income ratios (standard 43% front-end, 28% back-end)
 * - Down payment options (5%, 10%, 20%)
 */

const COUNTY_TAX_RATES = {
  // Property tax rates as % of home value annually
  'Denver': 0.0065,
  'Boulder': 0.0058,
  'El Paso': 0.0052,
  'Douglas': 0.0048,
  'Arapahoe': 0.0055,
  'Jefferson': 0.0061,
  'Larimer': 0.0052,
  'Mesa': 0.0059,
  'Weld': 0.0054,
  'Adams': 0.0056,
  'default': 0.0059  // CO state average
};

const COUNTY_INSURANCE_RATES = {
  // Annual homeowner's insurance as % of home value
  'Denver': 0.0095,
  'Boulder': 0.0088,
  'El Paso': 0.0085,
  'Douglas': 0.0082,
  'default': 0.0090  // CO average
};

const COUNTY_HOA_AVERAGE = {
  // Average monthly HOA fees by county
  'Denver': 250,
  'Boulder': 300,
  'El Paso': 180,
  'Douglas': 200,
  'Arapahoe': 220,
  'default': 200
};

const PMI_RATE = 0.0055;  // 0.55% annually when down payment < 20%
const AFFORDABILITY_THRESHOLD_FRONT_END = 0.28;  // 28% for housing only
const AFFORDABILITY_THRESHOLD_BACK_END = 0.43;   // 43% for all debt

class RealisticAffordabilityCalculator {
  constructor(config = {}) {
    this.mortgageRate = config.mortgageRate || 0.065;  // 6.5% default, fetch from FRED
    this.county = config.county || 'default';
    this.downPaymentPct = config.downPaymentPct || 0.20;
    this.maxDTI_frontEnd = config.maxDTI_frontEnd || 0.28;
    this.maxDTI_backEnd = config.maxDTI_backEnd || 0.43;
    this.existingMonthlyDebt = config.existingMonthlyDebt || 0;  // other loans, cards, etc
  }

  /**
   * Calculate monthly P&I payment using standard amortization formula
   * @param {number} loanAmount - Principal loan amount
   * @param {number} monthlyRate - Monthly interest rate (annual / 12 / 100)
   * @param {number} months - Loan term in months (typically 360 for 30-year)
   * @returns {number} Monthly P&I payment
   */
  calculateMonthlyPI(loanAmount, monthlyRate, months = 360) {
    if (monthlyRate === 0) {
      return loanAmount / months;
    }
    const numerator = loanAmount * monthlyRate * Math.pow(1 + monthlyRate, months);
    const denominator = Math.pow(1 + monthlyRate, months) - 1;
    return numerator / denominator;
  }

  /**
   * Calculate PMI (Mortgage Insurance) monthly payment
   * Required when down payment < 20%
   */
  calculatePMI(loanAmount, downPaymentPct) {
    if (downPaymentPct >= 0.20) {
      return 0;  // No PMI required at 20% down
    }
    // PMI typically costs 0.4-0.6% annually; use 0.55% as middle estimate
    return (loanAmount * PMI_RATE) / 12;
  }

  /**
   * Calculate total monthly housing payment
   * @param {number} homePrice - Purchase price
   * @param {number} downPaymentPct - Down payment as decimal (0.05, 0.10, 0.20)
   * @returns {object} Detailed payment breakdown
   */
  calculateMonthlyHousingPayment(homePrice, downPaymentPct) {
    const downPaymentAmount = homePrice * downPaymentPct;
    const loanAmount = homePrice - downPaymentAmount;

    // P&I calculation
    const monthlyRate = this.mortgageRate / 12 / 100;
    const monthlyPI = this.calculateMonthlyPI(loanAmount, monthlyRate);

    // PMI (if applicable)
    const monthlyPMI = this.calculatePMI(loanAmount, downPaymentPct);

    // Property taxes (annual → monthly)
    const taxRate = COUNTY_TAX_RATES[this.county] || COUNTY_TAX_RATES.default;
    const monthlyPropertyTax = (homePrice * taxRate) / 12;

    // Insurance (annual → monthly)
    const insuranceRate = COUNTY_INSURANCE_RATES[this.county] || COUNTY_INSURANCE_RATES.default;
    const monthlyInsurance = (homePrice * insuranceRate) / 12;

    // HOA fees
    const monthlyHOA = COUNTY_HOA_AVERAGE[this.county] || COUNTY_HOA_AVERAGE.default;

    // Total housing payment (PITI + HOA)
    const totalMonthlyHousing = monthlyPI + monthlyPMI + monthlyPropertyTax + monthlyInsurance + monthlyHOA;

    return {
      homePrice,
      downPaymentPct,
      downPaymentAmount,
      loanAmount,
      monthlyPI,
      monthlyPMI,
      monthlyPropertyTax,
      monthlyInsurance,
      monthlyHOA,
      totalMonthlyHousing,
      // Detailed breakdown for UI display
      breakdown: {
        'Principal & Interest': monthlyPI.toFixed(2),
        'PMI (if applicable)': monthlyPMI.toFixed(2),
        'Property Tax': monthlyPropertyTax.toFixed(2),
        'Insurance': monthlyInsurance.toFixed(2),
        'HOA': monthlyHOA.toFixed(2),
        'TOTAL': totalMonthlyHousing.toFixed(2)
      }
    };
  }

  /**
   * Calculate maximum affordable home price based on income
   * @param {number} grossMonthlyIncome - Monthly gross income
   * @param {number} downPaymentPct - Down payment as decimal
   * @returns {object} Maximum affordable price & DTI analysis
   */
  calculateMaxAffordablePrice(grossMonthlyIncome, downPaymentPct = 0.20) {
    // Max housing payment at 28% front-end DTI
    const maxHousingPayment = grossMonthlyIncome * this.maxDTI_frontEnd;

    // Back-end check: total debt including housing
    const maxTotalDebt = grossMonthlyIncome * this.maxDTI_backEnd;
    const availableForHousing = maxTotalDebt - this.existingMonthlyDebt;

    // Use the more restrictive of the two
    const targetMonthlyPayment = Math.min(maxHousingPayment, availableForHousing);

    if (targetMonthlyPayment <= 0) {
      return { error: 'Existing debt exceeds borrowing capacity' };
    }

    // Reverse engineer from payment to price
    // We need to solve: totalMonthlyHousing = f(homePrice)
    // Use binary search since the relationship is non-linear (due to PMI, taxes, etc)

    let minPrice = 0;
    let maxPrice = grossMonthlyIncome * 12 * 5;  // Upper bound: 5x annual income
    let optimalPrice = 0;

    // Binary search for price that yields target payment
    for (let i = 0; i < 20; i++) {
      const testPrice = (minPrice + maxPrice) / 2;
      const payment = this.calculateMonthlyHousingPayment(testPrice, downPaymentPct);
      
      if (payment.totalMonthlyHousing < targetMonthlyPayment) {
        minPrice = testPrice;
        optimalPrice = testPrice;
      } else {
        maxPrice = testPrice;
      }
    }

    const finalPayment = this.calculateMonthlyHousingPayment(optimalPrice, downPaymentPct);

    return {
      grossMonthlyIncome,
      maxHousingPayment,
      maxTotalDebt,
      existingMonthlyDebt,
      targetMonthlyPayment,
      maxAffordablePrice: Math.floor(optimalPrice),
      estimatedMonthlyPayment: finalPayment.totalMonthlyHousing.toFixed(2),
      downPaymentPct,
      paymentBreakdown: finalPayment.breakdown,
      DTI_frontEnd: ((finalPayment.totalMonthlyHousing) / grossMonthlyIncome * 100).toFixed(1),
      DTI_backEnd: ((finalPayment.totalMonthlyHousing + this.existingMonthlyDebt) / grossMonthlyIncome * 100).toFixed(1)
    };
  }

  /**
   * Calculate income needed to afford a given home price
   * @param {number} homePrice - Purchase price
   * @param {number} downPaymentPct - Down payment as decimal
   * @returns {object} Required income & affordability metrics
   */
  calculateIncomeNeededToBuy(homePrice, downPaymentPct = 0.20) {
    const payment = this.calculateMonthlyHousingPayment(homePrice, downPaymentPct);
    
    // Need gross income such that housing ≤ 28% of income
    const incomeNeededFrontEnd = payment.totalMonthlyHousing / this.maxDTI_frontEnd;
    
    // For back-end, assume other debt is $200/mo average consumer debt
    const assumedOtherDebt = 200;
    const incomeNeededBackEnd = (payment.totalMonthlyHousing + assumedOtherDebt) / this.maxDTI_backEnd;
    
    const requiredMonthlyIncome = Math.max(incomeNeededFrontEnd, incomeNeededBackEnd);
    const requiredAnnualIncome = requiredMonthlyIncome * 12;

    return {
      homePrice,
      downPaymentPct,
      monthlyPayment: payment.totalMonthlyHousing.toFixed(2),
      requiredMonthlyIncome: requiredMonthlyIncome.toFixed(2),
      requiredAnnualIncome: requiredAnnualIncome.toFixed(0),
      paymentBreakdown: payment.breakdown,
      assumptions: {
        mortgageRate: this.mortgageRate,
        county: this.county,
        assumedOtherDebt: assumedOtherDebt
      }
    };
  }

  /**
   * Calculate affordability gap for a geography
   * @param {number} medianHHIncome - Median household income
   * @param {number} medianHomePrice - Median home price
   * @returns {object} Affordability gap analysis
   */
  calculateAffordabilityGap(medianHHIncome, medianHomePrice, downPaymentPct = 0.20) {
    const incomeNeeded = this.calculateIncomeNeededToBuy(medianHomePrice, downPaymentPct);
    const gapDollars = (medianHHIncome - parseFloat(incomeNeeded.requiredAnnualIncome));
    const gapPercent = (gapDollars / medianHHIncome) * 100;

    return {
      medianHHIncome,
      medianHomePrice,
      downPaymentPct,
      requiredAnnualIncome: parseFloat(incomeNeeded.requiredAnnualIncome),
      gapDollars: Math.round(gapDollars),
      gapPercent: gapPercent.toFixed(1),
      status: gapPercent < 0 ? 'AFFORDABLE' : 'GAP EXISTS',
      interpretation: gapPercent < -10 ? 'Strong affordability' : 
                      gapPercent < 0 ? 'Slightly affordable' :
                      gapPercent < 25 ? 'Moderate gap' :
                      gapPercent < 50 ? 'Significant gap' :
                      'Critical gap',
      monthlyPayment: incomeNeeded.monthlyPayment,
      paymentBreakdown: incomeNeeded.paymentBreakdown
    };
  }

  /**
   * Scenario comparison: what if down payment was different?
   */
  compareDownPaymentScenarios(medianHHIncome, medianHomePrice) {
    const scenarios = [0.05, 0.10, 0.20].map(downPct => {
      const calc = this.calculateIncomeNeededToBuy(medianHomePrice, downPct);
      return {
        downPaymentPct: (downPct * 100).toFixed(0) + '%',
        downPaymentAmount: Math.round(medianHomePrice * downPct),
        monthlyPayment: parseFloat(calc.monthlyPayment),
        requiredAnnualIncome: parseFloat(calc.requiredAnnualIncome),
        gap: ((medianHHIncome - parseFloat(calc.requiredAnnualIncome)) / medianHHIncome * 100).toFixed(1)
      };
    });
    return { scenarios };
  }
}

// Export for use in Node/modules or browser globals
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RealisticAffordabilityCalculator;
}