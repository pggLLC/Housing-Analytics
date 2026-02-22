// National Regional Map - All 50 States Color-Coded by HUD Region

const regionalMapData = {
    regions: {
        northeast: {
            name: 'Northeast',
            color: '#3498db',
            states: ['CT', 'ME', 'MA', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT'],
            totalAllocation: 2900000000,
            avgPricing: 0.86
        },
        south: {
            name: 'South',
            color: '#e74c3c',
            states: ['AL', 'AR', 'DE', 'FL', 'GA', 'KY', 'LA', 'MD', 'MS', 'NC', 'OK', 'SC', 'TN', 'TX', 'VA', 'WV'],
            totalAllocation: 4400000000,
            avgPricing: 0.83
        },
        midwest: {
            name: 'Midwest',
            color: '#f39c12',
            states: ['IL', 'IN', 'IA', 'KS', 'MI', 'MN', 'MO', 'NE', 'ND', 'OH', 'SD', 'WI'],
            totalAllocation: 2100000000,
            avgPricing: 0.82
        },
        west: {
            name: 'West',
            color: '#27ae60',
            states: ['AK', 'AZ', 'CA', 'CO', 'HI', 'ID', 'MT', 'NV', 'NM', 'OR', 'UT', 'WA', 'WY'],
            totalAllocation: 3400000000,
            avgPricing: 0.85
        }
    },
    
    stateAllocations: {
        'CA': 1842000000, 'NY': 1456000000, 'TX': 1289000000, 'FL': 987000000,
        'IL': 845000000, 'PA': 732000000, 'OH': 689000000, 'GA': 654000000,
        'NC': 612000000, 'MI': 587000000, 'NJ': 498000000, 'VA': 467000000,
        'WA': 445000000, 'MA': 428000000, 'TN': 412000000, 'IN': 398000000,
        'MO': 385000000, 'AZ': 372000000, 'WI': 356000000, 'MD': 342000000,
        'MN': 328000000, 'CO': 287000000, 'SC': 276000000, 'AL': 268000000,
        'LA': 258000000, 'KY': 245000000, 'OR': 238000000, 'OK': 225000000,
        'CT': 218000000, 'IA': 198000000, 'MS': 187000000, 'AR': 178000000,
        'KS': 165000000, 'NV': 156000000, 'UT': 148000000, 'NM': 138000000,
        'WV': 128000000, 'NE': 118000000, 'ID': 108000000, 'ME': 98000000,
        'NH': 88000000, 'HI': 82000000, 'RI': 75000000, 'MT': 68000000,
        'DE': 58000000, 'SD': 52000000, 'ND': 45000000, 'AK': 38000000,
        'VT': 32000000, 'WY': 28000000
    }
};

function getRegionForState(state) {
    for (const [regionKey, regionData] of Object.entries(regionalMapData.regions)) {
        if (regionData.states.includes(state)) {
            return regionKey;
        }
    }
    return null;
}

function getRegionColor(state) {
    const region = getRegionForState(state);
    return region ? regionalMapData.regions[region].color : '#95a5a6';
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { regionalMapData, getRegionForState, getRegionColor };
}
