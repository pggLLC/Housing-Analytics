// fred-commodities.js
// FRED Construction Material Price Integration
// Source: Federal Reserve Economic Data (FRED)
// Version: 1.0 - February 2026

const FREDCommodities = {
    // Data loaded from data/fred-data.json (fetched by GitHub Action)
    
    series: {
        steelMillProducts: {
            id: 'PCU331111331111',
            name: 'Steel Mill Products PPI',
            category: 'Steel & Metal',
            impact: 'Structural framing, rebar',
            share: '12-15%'
        },
        steelRebar: {
            id: 'WPU10170503',
            name: 'Steel Reinforcing Bar',
            category: 'Steel & Metal',
            impact: 'Concrete reinforcement',
            share: '8-10%'
        },
        copperWireCable: {
            id: 'PCU33142033142012',
            name: 'Copper Wire & Cable PPI',
            category: 'Steel & Metal',
            impact: 'Electrical systems',
            share: '7-10%'
        },
        copperBuildingWire: {
            id: 'WPU10210301',
            name: 'Copper Building Wire',
            category: 'Steel & Metal',
            impact: 'Electrical rough-in',
            share: '5-7%'
        },
        aluminumProducts: {
            id: 'PCU3313153313153',
            name: 'Aluminum Products PPI',
            category: 'Steel & Metal',
            impact: 'Windows, doors, cladding',
            share: '8-12%'
        },
        softwoodLumber: {
            id: 'PCU32121132121103',
            name: 'Softwood Lumber PPI',
            category: 'Wood Products',
            impact: 'Framing, structural',
            share: '15-20%'
        },
        framingLumber: {
            id: 'WPU0811',
            name: 'Framing Lumber Price',
            category: 'Wood Products',
            impact: 'Wood-frame construction',
            share: '12-18%'
        },
        plywoodSheathing: {
            id: 'WPU0812',
            name: 'Plywood Sheathing',
            category: 'Wood Products',
            impact: 'Subflooring, roof decking',
            share: '5-8%'
        },
        concreteProducts: {
            id: 'PCU32731327313',
            name: 'Concrete Products PPI',
            category: 'Concrete & Masonry',
            impact: 'Foundation, structural',
            share: '10-15%'
        },
        portlandCement: {
            id: 'WPU13310101',
            name: 'Portland Cement',
            category: 'Concrete & Masonry',
            impact: 'Concrete ingredient',
            share: '3-5%'
        },
        readyMixConcrete: {
            id: 'PCU32732032732021',
            name: 'Ready-Mix Concrete',
            category: 'Concrete & Masonry',
            impact: 'Foundation, slabs',
            share: '8-12%'
        },
        gypsumDrywall: {
            id: 'PCU32742032742012',
            name: 'Gypsum Drywall PPI',
            category: 'Interior Finishes',
            impact: 'Interior walls',
            share: '6-9%'
        },
        asphaltPaving: {
            id: 'PCU32412132412121',
            name: 'Asphalt Paving',
            category: 'Site Work',
            impact: 'Parking, paving',
            share: '3-5%'
        },
        insulationMaterials: {
            id: 'PCU32721432721412',
            name: 'Insulation Materials',
            category: 'Insulation',
            impact: 'Energy efficiency',
            share: '4-6%'
        },
        dieselFuel: {
            id: 'WPU057303',
            name: 'Diesel Fuel',
            category: 'Energy',
            impact: 'Transport, equipment',
            share: '2-4%'
        },
        naturalGas: {
            id: 'WPU0531',
            name: 'Natural Gas',
            category: 'Energy',
            impact: 'Production energy',
            share: '1-2%'
        },
        constructionWages: {
            id: 'CES2000000003',
            name: 'Construction Avg Hourly Wage',
            category: 'Labor',
            impact: 'Labor costs',
            share: '35-45%'
        },
        constructionMaterialsInput: {
            id: 'WPUSI012011',
            name: 'Construction Materials Input PPI',
            category: 'Composite Index',
            impact: 'Overall materials benchmark',
            share: '100%'
        }
    },
    
    // Reads from data/fred-data.json (populated by GitHub Action) — no CORS issues.
    _fredDataCache: null,
    async _loadData() {
        if (this._fredDataCache) return this._fredDataCache;
        this._fredDataCache = await DataService.getJSON(DataService.baseData('fred-data.json'));
        return this._fredDataCache;
    },
    async fetchSeries(seriesId, observationStart = null) {
        try {
            const data = await this._loadData();
            const entry = data.series && data.series[seriesId];
            if (!entry) return null;
            // Return in desc order to match original usage
            return [...entry.observations].reverse();
        } catch (error) {
            console.error(`Error reading ${seriesId}:`, error);
            return null;
        }
    },
    
    calculateYoYChange(observations) {
        if (!observations || observations.length < 13) return null;
        const latest = parseFloat(observations[0].value);
        const yearAgo = parseFloat(observations[12].value);
        return ((latest - yearAgo) / yearAgo * 100).toFixed(2);
    },
    
    async getAllCommodities() {
        const results = {};
        for (const [key, series] of Object.entries(this.series)) {
            const observations = await this.fetchSeries(series.id);
            if (observations && observations.length > 0) {
                results[key] = {
                    ...series,
                    current: parseFloat(observations[0].value),
                    date: observations[0].date,
                    yoyChange: this.calculateYoYChange(observations),
                    history: observations.slice(0, 12).reverse()
                };
            }
        }
        return results;
    },
    
    calculateProjectImpact(commodityData, projectBudget = 25000000) {
        const hardCosts = projectBudget * 0.70;
        const impacts = [];
        
        for (const [key, data] of Object.entries(commodityData)) {
            if (data.yoyChange && data.share) {
                const sharePercent = parseFloat(data.share.split('-')[0]) / 100;
                const costIncrease = hardCosts * sharePercent * (data.yoyChange / 100);
                impacts.push({
                    material: data.name,
                    yoyChange: data.yoyChange,
                    costImpact: costIncrease
                });
            }
        }
        return impacts.sort((a, b) => b.costImpact - a.costImpact);
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FREDCommodities;
}
