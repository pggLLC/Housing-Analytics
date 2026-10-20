// 2026 Federal LIHTC state ceilings
// Each state: the greater of $3.416 per resident or $3,953,600
// (IRS Rev. Proc. 2025-32, section 4.08: https://www.irs.gov/pub/irs-drop/rp-25-32.pdf),
// using the 2026 population figures in IRS Notice 2026-22
// (Internal Revenue Bulletin 2026-15: https://www.irs.gov/irb/2026-15_IRB).
// Same figures as data/allocations.json.

const stateAllocations2026 = {
    'AL': {
        name: 'Alabama',
        code: 'AL',
        credits9pct: 17739589,
        population: 5193088,
        perCapita: 3.42,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'AK': {
        name: 'Alaska',
        code: 'AK',
        credits9pct: 3953600,
        population: 737270,
        perCapita: 5.36,
        region: 'West',
        note: 'Small-state minimum ($3,953,600)',
        dataStatus: 'confirmed'
    },
    'AZ': {
        name: 'Arizona',
        code: 'AZ',
        credits9pct: 26042962,
        population: 7623818,
        perCapita: 3.42,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'AR': {
        name: 'Arkansas',
        code: 'AR',
        credits9pct: 10640126,
        population: 3114791,
        perCapita: 3.42,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'CA': {
        name: 'California',
        code: 'CA',
        credits9pct: 134437736,
        population: 39355309,
        perCapita: 3.42,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'CO': {
        name: 'Colorado',
        code: 'CO',
        credits9pct: 20538908,
        population: 6012561,
        perCapita: 3.42,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'CT': {
        name: 'Connecticut',
        code: 'CT',
        credits9pct: 12599902,
        population: 3688496,
        perCapita: 3.42,
        region: 'Northeast',
        dataStatus: 'confirmed'
    },
    'DE': {
        name: 'Delaware',
        code: 'DE',
        credits9pct: 3953600,
        population: 1059952,
        perCapita: 3.73,
        region: 'South',
        note: 'Small-state minimum ($3,953,600)',
        dataStatus: 'confirmed'
    },
    'DC': {
        name: 'District of Columbia',
        code: 'DC',
        credits9pct: 3953600,
        population: 693645,
        perCapita: 5.70,
        region: 'South',
        note: 'Small-state minimum ($3,953,600)',
        dataStatus: 'confirmed'
    },
    'FL': {
        name: 'Florida',
        code: 'FL',
        credits9pct: 80147961,
        population: 23462518,
        perCapita: 3.42,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'GA': {
        name: 'Georgia',
        code: 'GA',
        credits9pct: 38610187,
        population: 11302748,
        perCapita: 3.42,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'HI': {
        name: 'Hawaii',
        code: 'HI',
        credits9pct: 4894513,
        population: 1432820,
        perCapita: 3.42,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'ID': {
        name: 'Idaho',
        code: 'ID',
        credits9pct: 6933568,
        population: 2029733,
        perCapita: 3.42,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'IL': {
        name: 'Illinois',
        code: 'IL',
        credits9pct: 43448586,
        population: 12719141,
        perCapita: 3.42,
        region: 'Midwest',
        dataStatus: 'confirmed'
    },
    'IN': {
        name: 'Indiana',
        code: 'IN',
        credits9pct: 23820906,
        population: 6973333,
        perCapita: 3.42,
        region: 'Midwest',
        dataStatus: 'confirmed'
    },
    'IA': {
        name: 'Iowa',
        code: 'IA',
        credits9pct: 11062330,
        population: 3238387,
        perCapita: 3.42,
        region: 'Midwest',
        dataStatus: 'confirmed'
    },
    'KS': {
        name: 'Kansas',
        code: 'KS',
        credits9pct: 10170184,
        population: 2977220,
        perCapita: 3.42,
        region: 'Midwest',
        dataStatus: 'confirmed'
    },
    'KY': {
        name: 'Kentucky',
        code: 'KY',
        credits9pct: 15737047,
        population: 4606864,
        perCapita: 3.42,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'LA': {
        name: 'Louisiana',
        code: 'LA',
        credits9pct: 15775734,
        population: 4618189,
        perCapita: 3.42,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'ME': {
        name: 'Maine',
        code: 'ME',
        credits9pct: 4833210,
        population: 1414874,
        perCapita: 3.42,
        region: 'Northeast',
        dataStatus: 'confirmed'
    },
    'MD': {
        name: 'Maryland',
        code: 'MD',
        credits9pct: 21402425,
        population: 6265347,
        perCapita: 3.42,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'MA': {
        name: 'Massachusetts',
        code: 'MA',
        credits9pct: 24438351,
        population: 7154084,
        perCapita: 3.42,
        region: 'Northeast',
        dataStatus: 'confirmed'
    },
    'MI': {
        name: 'Michigan',
        code: 'MI',
        credits9pct: 34596852,
        population: 10127884,
        perCapita: 3.42,
        region: 'Midwest',
        dataStatus: 'confirmed'
    },
    'MN': {
        name: 'Minnesota',
        code: 'MN',
        credits9pct: 19916663,
        population: 5830405,
        perCapita: 3.42,
        region: 'Midwest',
        dataStatus: 'confirmed'
    },
    'MS': {
        name: 'Mississippi',
        code: 'MS',
        credits9pct: 10091411,
        population: 2954160,
        perCapita: 3.42,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'MO': {
        name: 'Missouri',
        code: 'MO',
        credits9pct: 21420168,
        population: 6270541,
        perCapita: 3.42,
        region: 'Midwest',
        dataStatus: 'confirmed'
    },
    'MT': {
        name: 'Montana',
        code: 'MT',
        credits9pct: 3953600,
        population: 1144694,
        perCapita: 3.45,
        region: 'West',
        note: 'Small-state minimum ($3,953,600)',
        dataStatus: 'confirmed'
    },
    'NE': {
        name: 'Nebraska',
        code: 'NE',
        credits9pct: 6893508,
        population: 2018006,
        perCapita: 3.42,
        region: 'Midwest',
        dataStatus: 'confirmed'
    },
    'NV': {
        name: 'Nevada',
        code: 'NV',
        credits9pct: 11211954,
        population: 3282188,
        perCapita: 3.42,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'NH': {
        name: 'New Hampshire',
        code: 'NH',
        credits9pct: 4834808,
        population: 1415342,
        perCapita: 3.42,
        region: 'Northeast',
        dataStatus: 'confirmed'
    },
    'NJ': {
        name: 'New Jersey',
        code: 'NJ',
        credits9pct: 32616702,
        population: 9548215,
        perCapita: 3.42,
        region: 'Northeast',
        dataStatus: 'confirmed'
    },
    'NM': {
        name: 'New Mexico',
        code: 'NM',
        credits9pct: 7260701,
        population: 2125498,
        perCapita: 3.42,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'NY': {
        name: 'New York',
        code: 'NY',
        credits9pct: 68328291,
        population: 20002427,
        perCapita: 3.42,
        region: 'Northeast',
        dataStatus: 'confirmed'
    },
    'NC': {
        name: 'North Carolina',
        code: 'NC',
        credits9pct: 38252259,
        population: 11197968,
        perCapita: 3.42,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'ND': {
        name: 'North Dakota',
        code: 'ND',
        credits9pct: 3953600,
        population: 799358,
        perCapita: 4.95,
        region: 'Midwest',
        note: 'Small-state minimum ($3,953,600)',
        dataStatus: 'confirmed'
    },
    'OH': {
        name: 'Ohio',
        code: 'OH',
        credits9pct: 40652142,
        population: 11900510,
        perCapita: 3.42,
        region: 'Midwest',
        dataStatus: 'confirmed'
    },
    'OK': {
        name: 'Oklahoma',
        code: 'OK',
        credits9pct: 14085152,
        population: 4123288,
        perCapita: 3.42,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'OR': {
        name: 'Oregon',
        code: 'OR',
        credits9pct: 14598570,
        population: 4273586,
        perCapita: 3.42,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'PA': {
        name: 'Pennsylvania',
        code: 'PA',
        credits9pct: 44611020,
        population: 13059432,
        perCapita: 3.42,
        region: 'Northeast',
        dataStatus: 'confirmed'
    },
    'RI': {
        name: 'Rhode Island',
        code: 'RI',
        credits9pct: 3953600,
        population: 1114521,
        perCapita: 3.55,
        region: 'Northeast',
        note: 'Small-state minimum ($3,953,600)',
        dataStatus: 'confirmed'
    },
    'SC': {
        name: 'South Carolina',
        code: 'SC',
        credits9pct: 19028056,
        population: 5570274,
        perCapita: 3.42,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'SD': {
        name: 'South Dakota',
        code: 'SD',
        credits9pct: 3953600,
        population: 935094,
        perCapita: 4.23,
        region: 'Midwest',
        note: 'Small-state minimum ($3,953,600)',
        dataStatus: 'confirmed'
    },
    'TN': {
        name: 'Tennessee',
        code: 'TN',
        credits9pct: 24988300,
        population: 7315076,
        perCapita: 3.42,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'TX': {
        name: 'Texas',
        code: 'TX',
        credits9pct: 108320749,
        population: 31709821,
        perCapita: 3.42,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'UT': {
        name: 'Utah',
        code: 'UT',
        credits9pct: 12088896,
        population: 3538904,
        perCapita: 3.42,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'VT': {
        name: 'Vermont',
        code: 'VT',
        credits9pct: 3953600,
        population: 644663,
        perCapita: 6.13,
        region: 'Northeast',
        note: 'Small-state minimum ($3,953,600)',
        dataStatus: 'confirmed'
    },
    'VA': {
        name: 'Virginia',
        code: 'VA',
        credits9pct: 30334446,
        population: 8880107,
        perCapita: 3.42,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'WA': {
        name: 'Washington',
        code: 'WA',
        credits9pct: 27331484,
        population: 8001020,
        perCapita: 3.42,
        region: 'West',
        dataStatus: 'confirmed'
    },
    'WV': {
        name: 'West Virginia',
        code: 'WV',
        credits9pct: 6033158,
        population: 1766147,
        perCapita: 3.42,
        region: 'South',
        dataStatus: 'confirmed'
    },
    'WI': {
        name: 'Wisconsin',
        code: 'WI',
        credits9pct: 20403040,
        population: 5972787,
        perCapita: 3.42,
        region: 'Midwest',
        dataStatus: 'confirmed'
    },
    'WY': {
        name: 'Wyoming',
        code: 'WY',
        credits9pct: 3953600,
        population: 588753,
        perCapita: 6.72,
        region: 'West',
        note: 'Small-state minimum ($3,953,600)',
        dataStatus: 'confirmed'
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
    primary: 'IRS Rev. Proc. 2025-32 and IRS Notice 2026-22',
    url: 'https://www.irs.gov/pub/irs-drop/rp-25-32.pdf',
    populationUrl: 'https://www.irs.gov/irb/2026-15_IRB',
    lastUpdated: 'April 6, 2026',
    updateFrequency: 'Annual',
    methodology: 'Greater of $3.416 per resident or $3,953,600, applied to the IRS 2026 resident population figures (Census Vintage 2025)',
    note: 'Per-capita ceiling only; carryforward, returned credits and national pool credits are not included.',
    federalMinimum: '$3,953,600 small-state minimum; $3.416 per resident otherwise (2026)'
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
