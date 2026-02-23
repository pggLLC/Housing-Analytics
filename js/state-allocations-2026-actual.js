// 2026 Federal LIHTC Information by State
// Source: Novogradac - https://www.novoco.com/resource-centers/affordable-housing-tax-credits/2026-federal-lihtc-information-by-state
// Data: Known LIHTC Ceiling allocations (as of February 2026)
// Updates available at source URL - check quarterly

const stateAllocations2026 = {
    'AL': { 
        name: 'Alabama',
        code: 'AL',
        credits9pct: 17618699,
        population: 5059903,
        perCapita: 3.48,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'AK': { 
        name: 'Alaska',
        code: 'AK',
        credits9pct: 3515779,
        population: 733391,
        perCapita: 4.79,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'AR': { 
        name: 'Arkansas',
        code: 'AR',
        credits9pct: 9500000,
        population: 3038970,
        perCapita: 3.13,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'CA': { 
        name: 'California',
        code: 'CA',
        credits9pct: 134697194,
        population: 39355703,
        perCapita: 3.42,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'CO': { 
        name: 'Colorado',
        code: 'CO',
        credits9pct: 20350796,
        population: 6012561,
        perCapita: 3.38,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'CT': { 
        name: 'Connecticut',
        code: 'CT',
        credits9pct: 12554036,
        population: 3609446,
        perCapita: 3.48,
        region: 'Northeast',
        dataStatus: 'confirmed'
    },
    'FL': { 
        name: 'Florida',
        code: 'FL',
        credits9pct: 79874812,
        population: 23462518,
        perCapita: 3.40,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'GA': { 
        name: 'Georgia',
        code: 'GA',
        credits9pct: 39579277,
        population: 11302748,
        perCapita: 3.50,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'IL': { 
        name: 'Illinois',
        code: 'IL',
        credits9pct: 34000000,
        population: 12719141,
        perCapita: 2.67,
        region: 'Midwest',
        dataStatus: 'confirmed'
    },
    'IA': { 
        name: 'Iowa',
        code: 'IA',
        credits9pct: 11091056,
        population: 3193079,
        perCapita: 3.48,
        region: 'Midwest',
        dataStatus: 'confirmed'
    },
    'KY': { 
        name: 'Kentucky',
        code: 'KY',
        credits9pct: 15673879,
        population: 4505837,
        perCapita: 3.48,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'MI': { 
        name: 'Michigan',
        code: 'MI',
        credits9pct: 34904568,
        population: 10127984,
        perCapita: 3.45,
        region: 'Midwest',
        dataStatus: 'confirmed'
    },
    'MO': { 
        name: 'Missouri',
        code: 'MO',
        credits9pct: 21334552,
        population: 6170732,
        perCapita: 3.46,
        region: 'Midwest',
        dataStatus: 'confirmed'
    },
    'MT': { 
        name: 'Montana',
        code: 'MT',
        credits9pct: 3050000, // Estimated based on $2.75/capita minimum
        population: 1106629,
        perCapita: 2.76,
        region: 'West',
        dataStatus: 'estimated',
        note: 'Data not available in source - using federal minimum'
    },
    'NH': { 
        name: 'New Hampshire',
        code: 'NH',
        credits9pct: 4813253,
        population: 1381189,
        perCapita: 3.48,
        region: 'Northeast',
        dataStatus: 'confirmed'
    },
    'NJ': { 
        name: 'New Jersey',
        code: 'NJ',
        credits9pct: 33032433,
        population: 9548215,
        perCapita: 3.46,
        region: 'Northeast',
        dataStatus: 'confirmed'
    },
    'NM': { 
        name: 'New Mexico',
        code: 'NM',
        credits9pct: 7276954,
        population: 2203199,
        perCapita: 3.30,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'NY': { 
        name: 'New York',
        code: 'NY',
        credits9pct: 68066519,
        population: 20002427,
        perCapita: 3.40,
        region: 'Northeast',
        dataStatus: 'confirmed'
    },
    'NC': { 
        name: 'North Carolina',
        code: 'NC',
        credits9pct: 37733218,
        population: 11197968,
        perCapita: 3.37,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'ND': { 
        name: 'North Dakota',
        code: 'ND',
        credits9pct: 3953600,
        population: 774948,
        perCapita: 5.10,
        region: 'Midwest',
        dataStatus: 'confirmed'
    },
    'OR': { 
        name: 'Oregon',
        code: 'OR',
        credits9pct: 14224083,
        population: 4237256,
        perCapita: 3.36,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'SC': { 
        name: 'South Carolina',
        code: 'SC',
        credits9pct: 18600000,
        population: 5570274,
        perCapita: 3.34,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'TX': { 
        name: 'Texas',
        code: 'TX',
        credits9pct: 106889479,
        population: 31709821,
        perCapita: 3.37,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'UT': { 
        name: 'Utah',
        code: 'UT',
        credits9pct: 11968342,
        population: 3538904,
        perCapita: 3.38,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'VA': { 
        name: 'Virginia',
        code: 'VA',
        credits9pct: 30249230,
        population: 8880107,
        perCapita: 3.41,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'WA': { 
        name: 'Washington',
        code: 'WA',
        credits9pct: 24580203,
        population: 8001020,
        perCapita: 3.07,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'WV': { 
        name: 'West Virginia',
        code: 'WV',
        credits9pct: 6046248,
        population: 1788146,
        perCapita: 3.38,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'WY': { 
        name: 'Wyoming',
        code: 'WY',
        credits9pct: 3953600,
        population: 580456,
        perCapita: 6.81,
        region: 'West',
        dataStatus: 'confirmed'
    },
    
    // States not in CSV - estimated using national average methodology
    // These will be updated when Novogradac publishes complete 2026 data
    'AZ': { 
        name: 'Arizona', 
        code: 'AZ',
        credits9pct: 25200000, 
        population: 7359197, 
        perCapita: 3.42, 
        region: 'West',
        dataStatus: 'estimated'
    },
    'DE': { 
        name: 'Delaware', 
        code: 'DE',
        credits9pct: 3500000, 
        population: 1018396, 
        perCapita: 3.44, 
        region: 'South',
        dataStatus: 'estimated'
    },
    'HI': { 
        name: 'Hawaii', 
        code: 'HI',
        credits9pct: 4900000, 
        population: 1435138, 
        perCapita: 3.42, 
        region: 'West',
        dataStatus: 'estimated'
    },
    'ID': { 
        name: 'Idaho', 
        code: 'ID',
        credits9pct: 6800000, 
        population: 1964726, 
        perCapita: 3.46, 
        region: 'West',
        dataStatus: 'estimated'
    },
    'IN': { 
        name: 'Indiana', 
        code: 'IN',
        credits9pct: 23500000, 
        population: 6833037, 
        perCapita: 3.44, 
        region: 'Midwest',
        dataStatus: 'estimated'
    },
    'KS': { 
        name: 'Kansas', 
        code: 'KS',
        credits9pct: 10100000, 
        population: 2940546, 
        perCapita: 3.43, 
        region: 'Midwest',
        dataStatus: 'estimated'
    },
    'LA': { 
        name: 'Louisiana', 
        code: 'LA',
        credits9pct: 15800000, 
        population: 4624047, 
        perCapita: 3.42, 
        region: 'South',
        dataStatus: 'estimated'
    },
    'ME': { 
        name: 'Maine', 
        code: 'ME',
        credits9pct: 4800000, 
        population: 1385340, 
        perCapita: 3.47, 
        region: 'Northeast',
        dataStatus: 'estimated'
    },
    'MD': { 
        name: 'Maryland', 
        code: 'MD',
        credits9pct: 21200000, 
        population: 6164660, 
        perCapita: 3.44, 
        region: 'South',
        dataStatus: 'estimated'
    },
    'MA': { 
        name: 'Massachusetts', 
        code: 'MA',
        credits9pct: 24000000, 
        population: 7001399, 
        perCapita: 3.43, 
        region: 'Northeast',
        dataStatus: 'estimated'
    },
    'MN': { 
        name: 'Minnesota', 
        code: 'MN',
        credits9pct: 19500000, 
        population: 5707390, 
        perCapita: 3.42, 
        region: 'Midwest',
        dataStatus: 'estimated'
    },
    'MS': { 
        name: 'Mississippi', 
        code: 'MS',
        credits9pct: 10100000, 
        population: 2939690, 
        perCapita: 3.44, 
        region: 'South',
        dataStatus: 'estimated'
    },
    'NE': { 
        name: 'Nebraska', 
        code: 'NE',
        credits9pct: 6800000, 
        population: 1978379, 
        perCapita: 3.44, 
        region: 'Midwest',
        dataStatus: 'estimated'
    },
    'NV': { 
        name: 'Nevada', 
        code: 'NV',
        credits9pct: 11200000, 
        population: 3194176, 
        perCapita: 3.51, 
        region: 'West',
        dataStatus: 'estimated'
    },
    'OH': { 
        name: 'Ohio', 
        code: 'OH',
        credits9pct: 40200000, 
        population: 11785935, 
        perCapita: 3.41, 
        region: 'Midwest',
        dataStatus: 'estimated'
    },
    'OK': { 
        name: 'Oklahoma', 
        code: 'OK',
        credits9pct: 13800000, 
        population: 4053824, 
        perCapita: 3.40, 
        region: 'South',
        dataStatus: 'estimated'
    },
    'PA': { 
        name: 'Pennsylvania', 
        code: 'PA',
        credits9pct: 44500000, 
        population: 12961683, 
        perCapita: 3.43, 
        region: 'Northeast',
        dataStatus: 'estimated'
    },
    'RI': { 
        name: 'Rhode Island', 
        code: 'RI',
        credits9pct: 3800000, 
        population: 1095610, 
        perCapita: 3.47, 
        region: 'Northeast',
        dataStatus: 'estimated'
    },
    'SD': { 
        name: 'South Dakota', 
        code: 'SD',
        credits9pct: 3100000, 
        population: 909824, 
        perCapita: 3.41, 
        region: 'Midwest',
        dataStatus: 'estimated'
    },
    'TN': { 
        name: 'Tennessee', 
        code: 'TN',
        credits9pct: 24200000, 
        population: 7126489, 
        perCapita: 3.40, 
        region: 'South',
        dataStatus: 'estimated'
    },
    'VT': { 
        name: 'Vermont', 
        code: 'VT',
        credits9pct: 2200000, 
        population: 647464, 
        perCapita: 3.40, 
        region: 'Northeast',
        dataStatus: 'estimated'
    },
    'WI': { 
        name: 'Wisconsin', 
        code: 'WI',
        credits9pct: 20300000, 
        population: 5910955, 
        perCapita: 3.43, 
        region: 'Midwest',
        dataStatus: 'estimated'
    }
};

// Calculate totals
const totals2026 = {
    totalCredits: 0,
    totalPopulation: 0,
    nationalPerCapita: 0,
    confirmedStates: 0,
    estimatedStates: 0
};

Object.values(stateAllocations2026).forEach(state => {
    totals2026.totalCredits += state.credits9pct;
    totals2026.totalPopulation += state.population;
    if (state.dataStatus === 'confirmed') {
        totals2026.confirmedStates++;
    } else {
        totals2026.estimatedStates++;
    }
});

totals2026.nationalPerCapita = (totals2026.totalCredits / totals2026.totalPopulation).toFixed(2);

// Regional summaries
const regionalSummaries2026 = {
    'Northeast': { credits: 0, population: 0, states: [], perCapita: 0 },
    'South': { credits: 0, population: 0, states: [], perCapita: 0 },
    'Midwest': { credits: 0, population: 0, states: [], perCapita: 0 },
    'West': { credits: 0, population: 0, states: [], perCapita: 0 }
};

Object.entries(stateAllocations2026).forEach(([code, data]) => {
    if (regionalSummaries2026[data.region]) {
        regionalSummaries2026[data.region].credits += data.credits9pct;
        regionalSummaries2026[data.region].population += data.population;
        regionalSummaries2026[data.region].states.push(code);
    }
});

// Calculate regional per capita
Object.keys(regionalSummaries2026).forEach(region => {
    const summary = regionalSummaries2026[region];
    summary.perCapita = (summary.credits / summary.population).toFixed(2);
});

// Top 10 states by allocation
const topStates2026 = Object.entries(stateAllocations2026)
    .sort((a, b) => b[1].credits9pct - a[1].credits9pct)
    .slice(0, 10)
    .map(([code, data]) => ({
        code,
        name: data.name,
        credits: data.credits9pct,
        perCapita: data.perCapita
    }));

// Data source information
const dataSource = {
    primary: 'Novogradac',
    url: 'https://www.novoco.com/resource-centers/affordable-housing-tax-credits/2026-federal-lihtc-information-by-state',
    lastUpdated: 'February 2026',
    updateFrequency: 'Quarterly',
    methodology: 'Based on U.S. Treasury allocations and state population estimates',
    note: 'Some states estimated pending official confirmation. Check source for updates.',
    federalMinimum: '$2.75 per capita (2025 baseline + inflation adjustment)'
};

// Export
if (typeof window !== 'undefined') {
    window.stateAllocations2026 = stateAllocations2026;
    window.lihtcTotals2026 = totals2026;
    window.regionalSummaries2026 = regionalSummaries2026;
    window.topStates2026 = topStates2026;
    window.lihtcDataSource = dataSource;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { 
        stateAllocations2026, 
        totals2026, 
        regionalSummaries2026, 
        topStates2026,
        dataSource 
    };
}

// Expose dataset for pages
try { window.StateAllocations2026 = StateAllocations2026; } catch(e) {}
