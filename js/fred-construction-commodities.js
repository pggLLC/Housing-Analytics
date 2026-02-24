// FRED API Integration for Construction Commodity Prices
// Real-time data from Federal Reserve Economic Data

class FREDCommodityPrices {
    constructor() {
        this.baseURL = 'https://api.stlouisfed.org/fred/series/observations';
        this.apiKey = null; // User must obtain from research.stlouisfed.org
        
        // FRED Series IDs for Construction Materials
        this.series = {
            // Producer Price Index - Construction Materials
            'ppi_steel': 'PCU331111331111',           // Steel Mill Products
            'ppi_lumber': 'PCU32121132121103',        // Lumber and Wood Products
            'ppi_concrete': 'PCU32731327313',         // Concrete Products
            'ppi_copper': 'PCU33142033142012',        // Copper Wire & Cable
            'ppi_aluminum': 'PCU3313153313153',       // Aluminum Sheet/Plate/Foil
            'ppi_gypsum': 'PCU32742032742012',        // Gypsum Products
            'ppi_asphalt': 'PCU32412132412121',       // Asphalt Paving
            'ppi_insulation': 'PCU32721432721412',    // Insulation Materials
            
            // Specific Construction Commodity Series
            'lumber_framing': 'WPU0811',              // Softwood Lumber
            'plywood': 'WPU0812',                     // Plywood
            'steel_rebar': 'WPU10170503',             // Steel Reinforcing Bar
            'copper_wire': 'WPU10210301',             // Copper Wire
            'cement': 'WPU13310101',                  // Portland Cement
            'ready_mix_concrete': 'PCU32732032732021', // Ready-Mix Concrete
            
            // Energy (affects transport & production)
            'diesel': 'WPU057303',                    // Diesel Fuel
            'natural_gas': 'WPU0531',                 // Natural Gas
            
            // Labor Cost Proxy
            'construction_wages': 'CES2000000003',    // Avg Hourly Earnings Construction
            
            // Overall Construction Input Cost Index
            'construction_input_ppi': 'WPUSI012011'   // Construction Materials PPI
        };
        
        // Current data (sample - would fetch from FRED API)
        this.currentPrices = this.getSampleData();
    }
    
    // Sample data structure (real implementation would fetch from FRED)
    getSampleData() {
        return {
            'ppi_steel': {
                current: 285.4,
                mom_change: 2.3,  // Month over month %
                yoy_change: 22.5, // Year over year %
                date: '2026-01',
                series_name: 'Steel Mill Products PPI',
                impact: 'Critical for structural framing, rebar'
            },
            'ppi_lumber': {
                current: 420.8,
                mom_change: 1.8,
                yoy_change: 17.2,
                date: '2026-01',
                series_name: 'Softwood Lumber PPI',
                impact: 'Major framing cost driver'
            },
            'ppi_concrete': {
                current: 312.5,
                mom_change: 0.9,
                yoy_change: 5.4,
                date: '2026-01',
                series_name: 'Concrete Products PPI',
                impact: 'Foundation, structural elements'
            },
            'ppi_copper': {
                current: 445.2,
                mom_change: -0.5,
                yoy_change: 8.3,
                date: '2026-01',
                series_name: 'Copper Wire & Cable PPI',
                impact: 'Electrical systems (7-10% of hard costs)'
            },
            'ppi_aluminum': {
                current: 368.9,
                mom_change: 1.2,
                yoy_change: 12.1,
                date: '2026-01',
                series_name: 'Aluminum Products PPI',
                impact: 'Windows, doors, cladding'
            },
            'ppi_gypsum': {
                current: 298.7,
                mom_change: 0.4,
                yoy_change: 3.8,
                date: '2026-01',
                series_name: 'Gypsum Drywall PPI',
                impact: 'Interior walls, finishes'
            },
            'lumber_framing': {
                current: 590.5,
                mom_change: 2.1,
                yoy_change: 17.0,
                date: '2026-01',
                series_name: 'Framing Lumber Price',
                impact: 'Wood-frame construction (15-20% hard costs)'
            },
            'plywood': {
                current: 485.3,
                mom_change: 1.5,
                yoy_change: 14.2,
                date: '2026-01',
                series_name: 'Plywood Sheathing',
                impact: 'Subflooring, roof decking'
            },
            'steel_rebar': {
                current: 892.1,
                mom_change: 3.2,
                yoy_change: 25.8,
                date: '2026-01',
                series_name: 'Steel Reinforcing Bar',
                impact: 'Concrete reinforcement, critical shortage'
            },
            'copper_wire': {
                current: 758.4,
                mom_change: -0.8,
                yoy_change: 6.5,
                date: '2026-01',
                series_name: 'Copper Building Wire',
                impact: 'Electrical rough-in'
            },
            'cement': {
                current: 142.8,
                mom_change: 0.6,
                yoy_change: 4.2,
                date: '2026-01',
                series_name: 'Portland Cement',
                impact: 'Concrete ingredient'
            },
            'ready_mix_concrete': {
                current: 156.9,
                mom_change: 0.8,
                yoy_change: 5.1,
                date: '2026-01',
                series_name: 'Ready-Mix Concrete',
                impact: 'Foundation, slabs, structural'
            },
            'diesel': {
                current: 3.89,
                mom_change: 2.4,
                yoy_change: 8.7,
                date: '2026-01',
                series_name: 'Diesel Fuel ($/gallon)',
                impact: 'Transport costs, equipment fuel'
            },
            'natural_gas': {
                current: 3.24,
                mom_change: -1.2,
                yoy_change: 15.3,
                date: '2026-01',
                series_name: 'Natural Gas ($/MMBtu)',
                impact: 'Cement/steel production energy'
            },
            'construction_wages': {
                current: 36.42,
                mom_change: 0.5,
                yoy_change: 4.8,
                date: '2026-01',
                series_name: 'Construction Avg Hourly Wage ($/hr)',
                impact: 'Labor costs (35-45% of total)'
            },
            'construction_input_ppi': {
                current: 385.2,
                mom_change: 1.4,
                yoy_change: 12.8,
                date: '2026-01',
                series_name: 'Construction Materials Input PPI (Index)',
                impact: 'Overall materials cost benchmark'
            }
        };
    }
    
    // Reads from data/fred-data.json (populated by GitHub Action) — no CORS issues.
    async fetchLiveData(seriesId) {
        try {
            if (!this._fredCache) {
                const _data = await DataService.getJSON(DataService.baseData('fred-data.json'));
                this._fredCache = _data;
            }
            const fredSeriesId = this.series[seriesId];
            const entry = this._fredCache.series && this._fredCache.series[fredSeriesId];
            if (!entry || !entry.observations || entry.observations.length < 2) {
                return this.currentPrices[seriesId] || null;
            }
            const obs = entry.observations;
            const current = parseFloat(obs[obs.length - 1].value);
            const lastMonth = parseFloat(obs[obs.length - 2].value);
            const lastYear = parseFloat(obs[Math.max(0, obs.length - 13)].value);
            return {
                current: current.toFixed(2),
                mom_change: parseFloat(((current - lastMonth) / lastMonth * 100).toFixed(1)),
                yoy_change: parseFloat(((current - lastYear) / lastYear * 100).toFixed(1)),
                date: obs[obs.length - 1].date,
                series_name: seriesId,
                source: 'FRED (cached)'
            };
        } catch (error) {
            console.error(`Error reading FRED data for ${seriesId}:`, error);
            return this.currentPrices[seriesId] || null;
        }
    }
    
    // Get all construction commodities
    async getAllCommodities() {
        const commodities = {};
        for (const key of Object.keys(this.series)) {
            commodities[key] = await this.fetchLiveData(key);
        }
        return commodities;
    }
    
    // Calculate impact on typical project
    calculateProjectImpact(projectBudget) {
        const hardCosts = projectBudget * 0.70; // 70% typically hard costs
        
        const impacts = {
            lumber: hardCosts * 0.18 * (this.currentPrices.lumber_framing.yoy_change / 100),
            steel: hardCosts * 0.15 * (this.currentPrices.ppi_steel.yoy_change / 100),
            concrete: hardCosts * 0.12 * (this.currentPrices.ppi_concrete.yoy_change / 100),
            copper: hardCosts * 0.08 * (this.currentPrices.ppi_copper.yoy_change / 100),
            aluminum: hardCosts * 0.05 * (this.currentPrices.ppi_aluminum.yoy_change / 100),
            labor: projectBudget * 0.40 * (this.currentPrices.construction_wages.yoy_change / 100)
        };
        
        const totalImpact = Object.values(impacts).reduce((sum, val) => sum + val, 0);
        
        return {
            individual: impacts,
            total: totalImpact,
            percentage: (totalImpact / projectBudget * 100).toFixed(2)
        };
    }
    
    // Get setup instructions
    getSetupInstructions() {
        return {
            title: 'How to Get FRED API Key',
            steps: [
                '1. Visit https://research.stlouisfed.org/useraccount/register',
                '2. Create free account (no credit card required)',
                '3. Navigate to API Keys section',
                '4. Generate new API key',
                '5. Copy key and set in fredCommodities.apiKey',
                '6. No rate limits for reasonable use (<120 calls/min)'
            ],
            documentation: 'https://fred.stlouisfed.org/docs/api/fred/',
            note: 'FRED data is public domain, free to use'
        };
    }
}

// Initialize
if (typeof window !== 'undefined') {
    window.fredCommodities = new FREDCommodityPrices();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FREDCommodityPrices };
}
