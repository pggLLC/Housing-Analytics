// Comprehensive mortgage affordability calculation model

// Function to calculate total monthly mortgage payment
function calculateMortgagePayment(principal, annualInterestRate, years) {
    // Convert annual rate to monthly and percentage
    let monthlyInterestRate = annualInterestRate / 100 / 12;
    let numberOfPayments = years * 12;

    // Calculate monthly payment
    let monthlyPayment = (principal * monthlyInterestRate) / (1 - Math.pow(1 + monthlyInterestRate, -numberOfPayments));
    return monthlyPayment;
}

// Function to calculate total housing cost
function calculateTotalHousingCost(mortgagePayment, propertyTaxes, insurance, HOA) {
    return mortgagePayment + propertyTaxes + insurance + HOA;
}

// Function to calculate affordability
function calculateAffordability(income, debt, mortgagePayment, propertyTaxes, insurance, HOA, dtiRatio) {
    let totalDebt = debt + mortgagePayment + propertyTaxes + insurance + HOA;
    let maxDebtAllowed = income * dtiRatio;
    return totalDebt <= maxDebtAllowed;
}

// Example inputs
const principal = 300000; // Loan amount
const downPayment = 60000; // Down payment
const annualInterestRate = 3.5; // Annual interest rate in percent
const years = 30; // Loan term
const propertyTaxes = 300; // Monthly property taxes
const insurance = 100; // Monthly insurance
const HOA = 50; // Monthly HOA
const income = 6000; // Monthly income
const debt = 700; // Monthly debt payments
const dtiRatio = 0.36; // Debt-to-Income ratio

// Calculations
const mortgagePayment = calculateMortgagePayment(principal - downPayment, annualInterestRate, years);
const totalHousingCost = calculateTotalHousingCost(mortgagePayment, propertyTaxes, insurance, HOA);
const isAffordable = calculateAffordability(income, debt, mortgagePayment, propertyTaxes, insurance, HOA, dtiRatio);

console.log(`Monthly Mortgage Payment: $${mortgagePayment.toFixed(2)}`);
console.log(`Total Monthly Housing Cost: $${totalHousingCost.toFixed(2)}`);
console.log(`Is the mortgage affordable? ${isAffordable ? 'Yes' : 'No'}`);