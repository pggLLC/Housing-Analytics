// state-allocations-2026.js
// Complete state allocation data from CSV + estimated values
// Source: Novogradac - https://www.novoco.com/resource-centers/affordable-housing-tax-credits/2026-federal-lihtc-information-by-state

const StateAllocations2026 = {
    source: {
        name: 'Novogradac',
        url: 'https://www.novoco.com/resource-centers/affordable-housing-tax-credits/2026-federal-lihtc-information-by-state',
        lastUpdated: 'February 2026',
        updateFrequency: 'Quarterly',
        note: 'Check source URL for latest updates. Some states estimated pending official confirmation.'
    },
    
    states: {
        'AL': { name: 'Alabama', allocation: 17600000, population: 5074296, perCapita: 3.47, status: 'confirmed', source: 'CSV' },
        'AK': { name: 'Alaska', allocation: 3500000, population: 733583, perCapita: 4.77, status: 'confirmed', source: 'CSV' },
        'AZ': { name: 'Arizona', allocation: 25100000, population: 7151502, perCapita: 3.51, status: 'estimated', source: 'National average' },
        'AR': { name: 'Arkansas', allocation: 9500000, population: 3045637, perCapita: 3.12, status: 'confirmed', source: 'CSV' },
        'CA': { name: 'California', allocation: 134700000, population: 39538223, perCapita: 3.41, status: 'confirmed', source: 'CSV', note: 'Largest state allocation' },
        'CO': { name: 'Colorado', allocation: 20400000, population: 5773714, perCapita: 3.53, status: 'confirmed', source: 'CSV' },
        'CT': { name: 'Connecticut', allocation: 12600000, population: 3605944, perCapita: 3.50, status: 'confirmed', source: 'CSV' },
        'DE': { name: 'Delaware', allocation: 3400000, population: 989948, perCapita: 3.44, status: 'estimated', source: 'National average' },
        'DC': { name: 'District of Columbia', allocation: 2400000, population: 689545, perCapita: 3.48, status: 'estimated', source: 'National average' },
        'FL': { name: 'Florida', allocation: 79900000, population: 22244823, perCapita: 3.59, status: 'confirmed', source: 'CSV' },
        'GA': { name: 'Georgia', allocation: 39600000, population: 10711908, perCapita: 3.70, status: 'confirmed', source: 'CSV' },
        'HI': { name: 'Hawaii', allocation: 5000000, population: 1455271, perCapita: 3.44, status: 'estimated', source: 'National average' },
        'ID': { name: 'Idaho', allocation: 6300000, population: 1839106, perCapita: 3.43, status: 'estimated', source: 'National average' },
        'IL': { name: 'Illinois', allocation: 34000000, population: 12812508, perCapita: 2.65, status: 'confirmed', source: 'CSV', note: 'Lowest per capita among confirmed' },
        'IN': { name: 'Indiana', allocation: 23400000, population: 6785528, perCapita: 3.45, status: 'estimated', source: 'National average' },
        'IA': { name: 'Iowa', allocation: 11100000, population: 3190369, perCapita: 3.48, status: 'confirmed', source: 'CSV' },
        'KS': { name: 'Kansas', allocation: 10100000, population: 2937880, perCapita: 3.44, status: 'estimated', source: 'National average' },
        'KY': { name: 'Kentucky', allocation: 15700000, population: 4505836, perCapita: 3.48, status: 'confirmed', source: 'CSV' },
        'LA': { name: 'Louisiana', allocation: 15900000, population: 4657757, perCapita: 3.41, status: 'estimated', source: 'National average' },
        'ME': { name: 'Maine', allocation: 4700000, population: 1362359, perCapita: 3.45, status: 'estimated', source: 'National average' },
        'MD': { name: 'Maryland', allocation: 21100000, population: 6177224, perCapita: 3.42, status: 'estimated', source: 'National average' },
        'MA': { name: 'Massachusetts', allocation: 23900000, population: 7029917, perCapita: 3.40, status: 'estimated', source: 'National average' },
        'MI': { name: 'Michigan', allocation: 34900000, population: 10077331, perCapita: 3.46, status: 'confirmed', source: 'CSV' },
        'MN': { name: 'Minnesota', allocation: 19500000, population: 5706494, perCapita: 3.42, status: 'estimated', source: 'National average' },
        'MS': { name: 'Mississippi', allocation: 10200000, population: 2961279, perCapita: 3.44, status: 'estimated', source: 'National average' },
        'MO': { name: 'Missouri', allocation: 21300000, population: 6154913, perCapita: 3.46, status: 'confirmed', source: 'CSV' },
        'MT': { name: 'Montana', allocation: 3100000, population: 1084225, perCapita: 2.86, status: 'estimated', source: 'Calculation', note: 'Data not yet available' },
        'NE': { name: 'Nebraska', allocation: 6700000, population: 1961504, perCapita: 3.42, status: 'estimated', source: 'National average' },
        'NV': { name: 'Nevada', allocation: 10700000, population: 3104614, perCapita: 3.45, status: 'estimated', source: 'National average' },
        'NH': { name: 'New Hampshire', allocation: 4800000, population: 1377529, perCapita: 3.48, status: 'confirmed', source: 'CSV' },
        'NJ': { name: 'New Jersey', allocation: 33000000, population: 9288994, perCapita: 3.55, status: 'confirmed', source: 'CSV' },
        'NM': { name: 'New Mexico', allocation: 7300000, population: 2117522, perCapita: 3.45, status: 'confirmed', source: 'CSV' },
        'NY': { name: 'New York', allocation: 68100000, population: 20201249, perCapita: 3.37, status: 'confirmed', source: 'CSV' },
        'NC': { name: 'North Carolina', allocation: 37700000, population: 10439388, perCapita: 3.61, status: 'confirmed', source: 'CSV' },
        'ND': { name: 'North Dakota', allocation: 4000000, population: 779094, perCapita: 5.13, status: 'confirmed', source: 'CSV' },
        'OH': { name: 'Ohio', allocation: 40300000, population: 11799448, perCapita: 3.42, status: 'estimated', source: 'National average' },
        'OK': { name: 'Oklahoma', allocation: 13700000, population: 3959353, perCapita: 3.46, status: 'estimated', source: 'National average' },
        'OR': { name: 'Oregon', allocation: 14200000, population: 4237256, perCapita: 3.35, status: 'confirmed', source: 'CSV' },
        'PA': { name: 'Pennsylvania', allocation: 44400000, population: 13002700, perCapita: 3.41, status: 'estimated', source: 'National average' },
        'RI': { name: 'Rhode Island', allocation: 3700000, population: 1097379, perCapita: 3.37, status: 'estimated', source: 'National average' },
        'SC': { name: 'South Carolina', allocation: 18600000, population: 5118425, perCapita: 3.63, status: 'confirmed', source: 'CSV' },
        'SD': { name: 'South Dakota', allocation: 3100000, population: 886667, perCapita: 3.50, status: 'estimated', source: 'National average' },
        'TN': { name: 'Tennessee', allocation: 23700000, population: 6910840, perCapita: 3.43, status: 'estimated', source: 'National average' },
        'TX': { name: 'Texas', allocation: 106900000, population: 29145505, perCapita: 3.67, status: 'confirmed', source: 'CSV', note: 'Second largest allocation' },
        'UT': { name: 'Utah', allocation: 12000000, population: 3271616, perCapita: 3.67, status: 'confirmed', source: 'CSV' },
        'VT': { name: 'Vermont', allocation: 2200000, population: 643077, perCapita: 3.42, status: 'estimated', source: 'National average' },
        'VA': { name: 'Virginia', allocation: 30200000, population: 8631393, perCapita: 3.50, status: 'confirmed', source: 'CSV' },
        'WA': { name: 'Washington', allocation: 24600000, population: 7705281, perCapita: 3.19, status: 'confirmed', source: 'CSV' },
        'WV': { name: 'West Virginia', allocation: 6000000, population: 1793716, perCapita: 3.35, status: 'confirmed', source: 'CSV' },
        'WI': { name: 'Wisconsin', allocation: 20100000, population: 5893718, perCapita: 3.41, status: 'estimated', source: 'National average' },
        'WY': { name: 'Wyoming', allocation: 4000000, population: 576851, perCapita: 6.93, status: 'confirmed', source: 'CSV', note: 'Highest per capita' }
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = StateAllocations2026;
}

// Expose dataset for pages
try { window.StateAllocations2026 = StateAllocations2026; } catch(e) {}
