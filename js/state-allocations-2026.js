// state-allocations-2026.js
// 2026 state LIHTC ceilings: the greater of $3.416 per resident or $3,953,600
// (IRS Rev. Proc. 2025-32, section 4.08), applied to the 2026 resident
// population figures in IRS Notice 2026-22 (Census Vintage 2025 estimates).
// Same figures as data/allocations.json.

const StateAllocations2026 = {
    source: {
        name: 'IRS Rev. Proc. 2025-32 and IRS Notice 2026-22',
        url: 'https://www.irs.gov/pub/irs-drop/rp-25-32.pdf',
        populationUrl: 'https://www.irs.gov/irb/2026-15_IRB',
        lastUpdated: 'April 6, 2026',
        updateFrequency: 'Annual',
        note: 'Per-capita ceiling only: $3.416 per resident or the $3,953,600 small-state minimum, whichever is greater. Carryforward, returned credits and national pool credits are not included.'
    },
    
    states: {
        'AL': { name: 'Alabama', allocation: 17739589, population: 5193088, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'AK': { name: 'Alaska', allocation: 3953600, population: 737270, perCapita: 5.36, status: 'confirmed', source: 'small-state minimum' },
        'AZ': { name: 'Arizona', allocation: 26042962, population: 7623818, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'AR': { name: 'Arkansas', allocation: 10640126, population: 3114791, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'CA': { name: 'California', allocation: 134437736, population: 39355309, perCapita: 3.42, status: 'confirmed', source: 'per-capita', note: 'Largest state allocation' },
        'CO': { name: 'Colorado', allocation: 20538908, population: 6012561, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'CT': { name: 'Connecticut', allocation: 12599902, population: 3688496, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'DE': { name: 'Delaware', allocation: 3953600, population: 1059952, perCapita: 3.73, status: 'confirmed', source: 'small-state minimum' },
        'DC': { name: 'District of Columbia', allocation: 3953600, population: 693645, perCapita: 5.70, status: 'confirmed', source: 'small-state minimum' },
        'FL': { name: 'Florida', allocation: 80147961, population: 23462518, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'GA': { name: 'Georgia', allocation: 38610187, population: 11302748, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'HI': { name: 'Hawaii', allocation: 4894513, population: 1432820, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'ID': { name: 'Idaho', allocation: 6933568, population: 2029733, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'IL': { name: 'Illinois', allocation: 43448586, population: 12719141, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'IN': { name: 'Indiana', allocation: 23820906, population: 6973333, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'IA': { name: 'Iowa', allocation: 11062330, population: 3238387, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'KS': { name: 'Kansas', allocation: 10170184, population: 2977220, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'KY': { name: 'Kentucky', allocation: 15737047, population: 4606864, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'LA': { name: 'Louisiana', allocation: 15775734, population: 4618189, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'ME': { name: 'Maine', allocation: 4833210, population: 1414874, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'MD': { name: 'Maryland', allocation: 21402425, population: 6265347, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'MA': { name: 'Massachusetts', allocation: 24438351, population: 7154084, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'MI': { name: 'Michigan', allocation: 34596852, population: 10127884, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'MN': { name: 'Minnesota', allocation: 19916663, population: 5830405, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'MS': { name: 'Mississippi', allocation: 10091411, population: 2954160, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'MO': { name: 'Missouri', allocation: 21420168, population: 6270541, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'MT': { name: 'Montana', allocation: 3953600, population: 1144694, perCapita: 3.45, status: 'confirmed', source: 'small-state minimum' },
        'NE': { name: 'Nebraska', allocation: 6893508, population: 2018006, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'NV': { name: 'Nevada', allocation: 11211954, population: 3282188, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'NH': { name: 'New Hampshire', allocation: 4834808, population: 1415342, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'NJ': { name: 'New Jersey', allocation: 32616702, population: 9548215, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'NM': { name: 'New Mexico', allocation: 7260701, population: 2125498, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'NY': { name: 'New York', allocation: 68328291, population: 20002427, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'NC': { name: 'North Carolina', allocation: 38252259, population: 11197968, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'ND': { name: 'North Dakota', allocation: 3953600, population: 799358, perCapita: 4.95, status: 'confirmed', source: 'small-state minimum' },
        'OH': { name: 'Ohio', allocation: 40652142, population: 11900510, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'OK': { name: 'Oklahoma', allocation: 14085152, population: 4123288, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'OR': { name: 'Oregon', allocation: 14598570, population: 4273586, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'PA': { name: 'Pennsylvania', allocation: 44611020, population: 13059432, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'RI': { name: 'Rhode Island', allocation: 3953600, population: 1114521, perCapita: 3.55, status: 'confirmed', source: 'small-state minimum' },
        'SC': { name: 'South Carolina', allocation: 19028056, population: 5570274, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'SD': { name: 'South Dakota', allocation: 3953600, population: 935094, perCapita: 4.23, status: 'confirmed', source: 'small-state minimum' },
        'TN': { name: 'Tennessee', allocation: 24988300, population: 7315076, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'TX': { name: 'Texas', allocation: 108320749, population: 31709821, perCapita: 3.42, status: 'confirmed', source: 'per-capita', note: 'Second largest allocation' },
        'UT': { name: 'Utah', allocation: 12088896, population: 3538904, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'VT': { name: 'Vermont', allocation: 3953600, population: 644663, perCapita: 6.13, status: 'confirmed', source: 'small-state minimum' },
        'VA': { name: 'Virginia', allocation: 30334446, population: 8880107, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'WA': { name: 'Washington', allocation: 27331484, population: 8001020, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'WV': { name: 'West Virginia', allocation: 6033158, population: 1766147, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'WI': { name: 'Wisconsin', allocation: 20403040, population: 5972787, perCapita: 3.42, status: 'confirmed', source: 'per-capita' },
        'WY': { name: 'Wyoming', allocation: 3953600, population: 588753, perCapita: 6.72, status: 'confirmed', source: 'small-state minimum', note: 'Highest per capita (small-state minimum)' }
    },
    
    getStats() {
        const allStates = Object.values(this.states);
        const confirmed = allStates.filter(s => s.status === 'confirmed');
        const estimated = allStates.filter(s => s.status === 'estimated');
        const totalAllocation = allStates.reduce((sum, s) => sum + s.allocation, 0);
        const totalPopulation = allStates.reduce((sum, s) => sum + s.population, 0);
        
        return {
            totalStates: allStates.length,
            confirmedStates: confirmed.length,
            estimatedStates: estimated.length,
            totalAllocation: totalAllocation,
            totalPopulation: totalPopulation,
            avgPerCapita: (totalAllocation / totalPopulation).toFixed(2),
            largestAllocation: allStates.reduce((max, s) => s.allocation > max.allocation ? s : max),
            smallestAllocation: allStates.reduce((min, s) => s.allocation < min.allocation ? s : min),
            highestPerCapita: allStates.reduce((max, s) => s.perCapita > max.perCapita ? s : max),
            lowestPerCapita: allStates.reduce((min, s) => s.perCapita < min.perCapita ? s : min)
        };
    },
    
    getState(abbr) {
        return this.states[abbr.toUpperCase()] || null;
    },
    
    getStateColor(allocation) {
        if (allocation >= 100000000) return '#8B4513';
        if (allocation >= 50000000) return '#A0522D';
        if (allocation >= 25000000) return '#BC8F8F';
        if (allocation >= 10000000) return '#D4A574';
        return '#E8DCC4';
    }
};

// Each record's postal code is its key. Pages read it as `s.abbr` (chart
// labels, region and state filters), so copy the key onto the record.
Object.keys(StateAllocations2026.states).forEach(abbr => {
    StateAllocations2026.states[abbr].abbr = abbr;
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = StateAllocations2026;
}

// Expose dataset for pages
try { window.StateAllocations2026 = StateAllocations2026; } catch(e) {}
