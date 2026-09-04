// fred-commodities.js
// FRED Construction Material Price Integration
// Source: Federal Reserve Economic Data (FRED)
// Version: 1.0 - February 2026

const STALE_MONTHS = 15;

const FREDCommodities = {
    // Data loaded from data/fred-data.json (fetched by GitHub Action)
    
    series: {
        steelMillProducts: {
            id: 'PCU331110331110',
            name: 'Iron and Steel Mills PPI',
            category: 'Steel & Metal',
            impact: 'Structural framing, rebar',
            share: '12-15%'
        },
        copperWireCable: {
            id: 'PCU331420331420A',
            name: 'Copper Wire & Cable PPI',
            category: 'Steel & Metal',
            impact: 'Electrical systems',
            share: '7-10%'
        },
        copperBuildingWire: {
            id: 'WPU10260306',
            name: 'Building Wire and Cable',
            category: 'Steel & Metal',
            impact: 'Electrical rough-in',
            share: '5-7%'
        },
        aluminumProducts: {
            id: 'PCU331315331315',
            name: 'Aluminum Sheet, Plate, and Foil PPI',
            category: 'Steel & Metal',
            impact: 'Windows, doors, cladding',
            share: '8-12%'
        },
        softwoodLumber: {
            id: 'PCU3211133211133',
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
            id: 'PCU327310327310',
            name: 'Ready-Mix Concrete PPI',
            category: 'Concrete & Masonry',
            impact: 'Foundation, structural',
            share: '10-15%'
        },
        portlandCement: {
            id: 'WPU1322',
            name: 'Cement, Hydraulic',
            category: 'Concrete & Masonry',
            impact: 'Concrete ingredient',
            share: '3-5%'
        },
        readyMixConcrete: {
            id: 'PCU327320327320',
            name: 'Ready-Mix Concrete',
            category: 'Concrete & Masonry',
            impact: 'Foundation, slabs',
            share: '8-12%'
        },
        gypsumDrywall: {
            id: 'PCU327420327420',
            name: 'Gypsum Product Manufacturing',
            category: 'Interior Finishes',
            impact: 'Interior walls',
            share: '6-9%'
        },
        asphaltPaving: {
            id: 'PCU324121324121',
            name: 'Asphalt Paving',
            category: 'Site Work',
            impact: 'Parking, paving',
            share: '3-5%'
        },
        insulationMaterials: {
            id: 'WPU1392',
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
            if (entry.status && entry.status !== 'ok') {
                return {
                    status: entry.status,
                    unavailableReason: entry.unavailable_reason,
                    observations: []
                };
            }
            // Return in desc order to match original usage
            return { status: 'ok', unavailableReason: null, observations: [...entry.observations].reverse() };
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

    _parseDate(value) {
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    },

    _monthsBetween(laterDate, earlierDate) {
        return ((laterDate.getFullYear() - earlierDate.getFullYear()) * 12)
            + (laterDate.getMonth() - earlierDate.getMonth());
    },

    _isSeriesStale(observations, updated) {
        const latestObservation = this._parseDate(observations && observations[0] && observations[0].date);
        const dataUpdated = this._parseDate(updated);
        if (!latestObservation || !dataUpdated) return false;
        return this._monthsBetween(dataUpdated, latestObservation) > STALE_MONTHS;
    },
    
    async getAllCommodities() {
        const fredData = await this._loadData();
        const updated = fredData && fredData.updated;
        const results = {};
        for (const [key, series] of Object.entries(this.series)) {
            const fetched = await this.fetchSeries(series.id);
            if (fetched && fetched.status !== 'ok') {
                results[key] = {
                    ...series,
                    status: fetched.status,
                    unavailableReason: fetched.unavailableReason
                };
                continue;
            }
            const observations = fetched && fetched.observations;
            if (observations && observations.length > 0) {
                if (this._isSeriesStale(observations, updated)) continue;
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
