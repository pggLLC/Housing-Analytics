// CRA Expansion Impact Forecasting Module
// Models pricing scenarios if pending housing bills expand CRA credit

class CRAExpansionForecaster {
    constructor() {
        this.baselineScenario = {
            name: 'Current Policy (Baseline)',
            craMultiplier: 1.0,
            description: 'No CRA expansion - current Community Reinvestment Act rules'
        };
        
        this.scenarios = {
            moderate: {
                name: 'Moderate CRA Expansion',
                craMultiplier: 1.15,
                description: 'Expands LIHTC eligibility for CRA credit to more institutions',
                assumptions: [
                    'Credit union CRA equivalency enacted',
                    'Insurance company participation incentivized',
                    'Regional/community banks included',
                    '15-20% increase in investor pool'
                ]
            },
            aggressive: {
                name: 'Aggressive CRA Expansion',
                craMultiplier: 1.35,
                description: 'Major expansion of CRA framework to non-bank institutions',
                assumptions: [
                    'All credit unions subject to CRA',
                    'Insurance companies with CRA-like requirements',
                    'FinTech/non-bank lenders included',
                    'ESG mandate alignment',
                    '30-40% increase in investor pool'
                ]
            },
            transformative: {
                name: 'Transformative Reform',
                craMultiplier: 1.60,
                description: 'Complete restructuring of CRA with LIHTC as centerpiece',
                assumptions: [
                    'All financial institutions subject to CRA',
                    'LIHTC investments count double for CRA',
                    'Enhanced examination weight',
                    'Tax incentives for CRA investments',
                    '50-70% increase in investor pool'
                ]
            }
        };
    }

    // Forecast pricing under different CRA scenarios
    forecastPricingScenarios(currentPricing = 0.87, periods = 8) {
        const forecasts = {
            baseline: this.generateBaseline(currentPricing, periods),
            moderate: this.generateScenario(currentPricing, periods, this.scenarios.moderate),
            aggressive: this.generateScenario(currentPricing, periods, this.scenarios.aggressive),
            transformative: this.generateScenario(currentPricing, periods, this.scenarios.transformative)
        };
        
        return forecasts;
    }

    generateBaseline(startPrice, periods) {
        // Baseline: modest supply pressure, stable demand
        const forecast = [];
        let price = startPrice;
        
        for (let i = 1; i <= periods; i++) {
            // Slight downward pressure from increased 9% supply
            const supplyPressure = -0.005;
            // Offset by steady CRA demand
            const demandSupport = 0.003;
            
            price = price + supplyPressure + demandSupport;
            
            forecast.push({
                quarter: `Q${((i-1) % 4) + 1} ${2025 + Math.floor((i-1)/4)}`,
                price: Math.max(0.82, Math.min(0.92, price)),
                lower: Math.max(0.80, price - 0.03),
                upper: Math.min(0.94, price + 0.03)
            });
        }
        
        return forecast;
    }

    generateScenario(startPrice, periods, scenario) {
        const forecast = [];
        let price = startPrice;
        
        // CRA expansion takes 2-4 quarters to fully impact market
        const rampUpPeriods = 3;
        
        for (let i = 1; i <= periods; i++) {
            // Calculate CRA impact (ramps up over time)
            const rampUpFactor = Math.min(1, i / rampUpPeriods);
            const craImpact = (scenario.craMultiplier - 1) * 0.10 * rampUpFactor; // 10% base lift per multiplier point
            
            // Supply pressure continues
            const supplyPressure = -0.004;
            
            // Enhanced demand from CRA expansion
            const demandBoost = craImpact;
            
            // Price discovery volatility during transition
            const volatility = i <= rampUpPeriods ? 0.01 * Math.random() : 0.005 * Math.random();
            
            price = price + supplyPressure + demandBoost + volatility;
            
            forecast.push({
                quarter: `Q${((i-1) % 4) + 1} ${2025 + Math.floor((i-1)/4)}`,
                price: Math.max(0.82, Math.min(1.05, price)),
                lower: Math.max(0.80, price - 0.04),
                upper: Math.min(1.08, price + 0.04),
                craImpact: craImpact,
                scenario: scenario.name
            });
        }
        
        return forecast;
    }

    // Calculate NPV impact for developers
    calculateProjectImpact(creditAllocation, scenario, currentPricing = 0.87) {
        const baseline = currentPricing;
        const forecast = this.generateScenario(currentPricing, 8, scenario);
        const avgFuturePrice = forecast.reduce((sum, q) => sum + q.price, 0) / forecast.length;
        
        const baselineEquity = creditAllocation * baseline;
        const scenarioEquity = creditAllocation * avgFuturePrice;
        
        return {
            scenario: scenario.name,
            creditAllocation: creditAllocation,
            baselinePrice: baseline,
            scenarioPrice: avgFuturePrice,
            baselineEquity: baselineEquity,
            scenarioEquity: scenarioEquity,
            additionalEquity: scenarioEquity - baselineEquity,
            percentIncrease: ((scenarioEquity - baselineEquity) / baselineEquity * 100).toFixed(1) + '%'
        };
    }

    // Key factors driving pricing under CRA expansion
    getPricingFactors() {
        return {
            demandFactors: [
                {
                    factor: 'Expanded Investor Base',
                    impact: 'Very Positive',
                    magnitude: '+15 to +70%',
                    timeline: '2-4 quarters',
                    description: 'Credit unions, insurance cos, non-banks enter market'
                },
                {
                    factor: 'CRA Examination Enhancement',
                    impact: 'Positive',
                    magnitude: '+5 to +15%',
                    timeline: '1-2 quarters',
                    description: 'LIHTC investments more valuable for CRA ratings'
                },
                {
                    factor: 'Competitive Bidding',
                    impact: 'Positive',
                    magnitude: '+3 to +8%',
                    timeline: 'Immediate',
                    description: 'More investors competing for same deals'
                }
            ],
            supplyFactors: [
                {
                    factor: 'Increased 9% Allocations',
                    impact: 'Negative',
                    magnitude: '-3 to -5%',
                    timeline: 'Ongoing',
                    description: '12% bump in credit ceiling remains'
                },
                {
                    factor: 'Lower 4% Bond Threshold',
                    impact: 'Neutral to Negative',
                    magnitude: '0 to -2%',
                    timeline: '2-4 quarters',
                    description: '50% → 25% may shift some 9% deals to 4%'
                }
            ],
            marketDynamics: [
                {
                    factor: 'Corporate Tax Rates',
                    impact: 'Variable',
                    magnitude: 'TBD',
                    description: 'Any corporate rate changes affect base demand'
                },
                {
                    factor: 'Interest Rates',
                    impact: 'Moderate Negative',
                    magnitude: '-2 to -4%',
                    description: 'Higher rates = higher opportunity cost'
                },
                {
                    factor: 'Economic Growth',
                    impact: 'Positive',
                    magnitude: '+3 to +7%',
                    description: 'Strong economy = higher bank profits = more tax appetite'
                }
            ]
        };
    }

    // Probability-weighted forecast
    generateProbabilityWeighted(currentPricing = 0.87, periods = 8) {
        const scenarios = {
            baseline: { weight: 0.40, forecast: this.generateBaseline(currentPricing, periods) },
            moderate: { weight: 0.35, forecast: this.generateScenario(currentPricing, periods, this.scenarios.moderate) },
            aggressive: { weight: 0.20, forecast: this.generateScenario(currentPricing, periods, this.scenarios.aggressive) },
            transformative: { weight: 0.05, forecast: this.generateScenario(currentPricing, periods, this.scenarios.transformative) }
        };
        
        const weighted = [];
        
        for (let i = 0; i < periods; i++) {
            let weightedPrice = 0;
            let weightedLower = 0;
            let weightedUpper = 0;
            
            for (const [name, scenario] of Object.entries(scenarios)) {
                weightedPrice += scenario.forecast[i].price * scenario.weight;
                weightedLower += scenario.forecast[i].lower * scenario.weight;
                weightedUpper += scenario.forecast[i].upper * scenario.weight;
            }
            
            weighted.push({
                quarter: scenarios.baseline.forecast[i].quarter,
                price: weightedPrice,
                lower: weightedLower,
                upper: weightedUpper
            });
        }
        
        return {
            forecast: weighted,
            scenarios: Object.entries(scenarios).map(([name, s]) => ({
                name: name,
                probability: (s.weight * 100).toFixed(0) + '%'
            }))
        };
    }

    // Legislative tracking
    getCurrentBills() {
        return {
            pending: [
                {
                    bill: 'Affordable Housing Credit Improvement Act (AHCIA)',
                    status: 'Introduced - both chambers',
                    craProvisions: 'Moderate - enhances CRA credit for LIHTC',
                    likelihood: 'Medium (40%)',
                    impact: 'Moderate scenario likely if passed'
                },
                {
                    bill: 'Community Reinvestment Act Modernization',
                    status: 'Under consideration',
                    craProvisions: 'Significant - expands institutions covered',
                    likelihood: 'Medium-Low (25%)',
                    impact: 'Aggressive scenario if passed'
                },
                {
                    bill: 'Neighborhood Homes Investment Act',
                    status: 'Introduced',
                    craProvisions: 'Indirect - creates competing tax credit',
                    likelihood: 'Low-Medium (30%)',
                    impact: 'Could reduce LIHTC demand (negative)'
                }
            ],
            timeline: {
                earlyAction: 'Q2-Q3 2026 if fast-tracked',
                normalProcess: 'Q4 2026 - Q2 2027',
                implementation: '2-4 quarters post-passage'
            }
        };
    }
}

// Export
if (typeof window !== 'undefined') {
    window.CRAExpansionForecaster = new CRAExpansionForecaster();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CRAExpansionForecaster };
}
