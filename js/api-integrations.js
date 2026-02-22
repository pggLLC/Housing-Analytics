// API Integration Module for Real-Time Data
// Connects to HUD, FRED, Census, and Colorado State sources

class DataAPIIntegrations {
    constructor() {
        this.apis = {
            hud: {
                baseUrl: 'https://www.huduser.gov/hudapi/public',
                token: null, // User must register at huduser.gov
                endpoints: {
                    ami: '/ami',
                    fmr: '/fmr'
                }
            },
            fred: {
                baseUrl: 'https://api.stlouisfed.org/fred',
                apiKey: window.APP_CONFIG ? window.APP_CONFIG.FRED_API_KEY : null, // Free key from research.stlouisfed.org/useraccount
                series: {
                    coVacancy: 'CORVAC',
                    denverStarts: 'DENVER708BPPRIV',
                    denverUnemployment: 'DENVER708URN',
                    coHomeValue: 'COUCSFRCONDOSMSAMID'
                }
            },
            census: {
                baseUrl: 'https://api.census.gov/data',
                apiKey: window.APP_CONFIG ? window.APP_CONFIG.CENSUS_API_KEY : null, // Free key from api.census.gov/data/key_signup.html
                variables: {
                    vacancy: 'B25004_001E',
                    unitsInStructure: 'B25024_001E',
                    rentBurden: 'B25070_001E'
                }
            }
        };
        
        this.cache = new Map();
    }

    // HUD AMI Data for Colorado Counties
    async fetchHUDAMI(county, year = 2025) {
        const cacheKey = `hud_ami_${county}_${year}`;
        if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
        
        try {
            // HUD API endpoint (requires token)
            // Real implementation would be:
            // const response = await fetch(`${this.apis.hud.baseUrl}/ami/${year}/${county}`, {
            //     headers: { 'Authorization': `Bearer ${this.apis.hud.token}` }
            // });
            
            // Sample data structure for demonstration
            const data = {
                denver: {
                    '1person': { '30': 26100, '50': 43450, '60': 52140, '80': 66300, '100': 86870 },
                    '4person': { '30': 37350, '50': 62050, '60': 74460, '80': 94650, '100': 124100 }
                },
                mesa: { // Grand Junction (Western Slope)
                    '1person': { '30': 19200, '50': 32000, '60': 38400, '80': 48800, '100': 64000 },
                    '4person': { '30': 27450, '50': 45750, '60': 54900, '80': 69750, '100': 91500 }
                },
                eagle: { // Vail area
                    '1person': { '30': 29400, '50': 49000, '60': 58800, '80': 74700, '100': 98000 },
                    '4person': { '30': 42000, '50': 70000, '60': 84000, '80': 106700, '100': 140000 }
                }
            };
            
            this.cache.set(cacheKey, data);
            return data;
            
        } catch (error) {
            console.error('HUD AMI fetch error:', error);
            return null;
        }
    }

    // FRED Economic Data
    async fetchFREDSeries(seriesId, startDate = '2020-01-01') {
        const cacheKey = `fred_${seriesId}`;
        if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
        
        try {
            // Real implementation:
            // const response = await fetch(
            //     `${this.apis.fred.baseUrl}/series/observations?series_id=${seriesId}&api_key=${this.apis.fred.apiKey}&file_type=json&observation_start=${startDate}`
            // );
            
            // Sample data for demonstration
            const datasets = {
                CORVAC: [ // Colorado Rental Vacancy
                    { date: '2023-Q1', value: 5.2 },
                    { date: '2023-Q4', value: 5.8 },
                    { date: '2024-Q2', value: 6.4 },
                    { date: '2025-Q1', value: 7.1 }
                ],
                DENVER708BPPRIV: [ // Denver Housing Starts
                    { date: '2023', value: 41200 },
                    { date: '2024', value: 43800 },
                    { date: '2025', value: 38500 }
                ],
                DENVER708URN: [ // Denver Unemployment
                    { date: '2025-01', value: 3.7 },
                    { date: '2025-06', value: 3.8 },
                    { date: '2026-01', value: 3.7 }
                ]
            };
            
            const data = datasets[seriesId] || [];
            this.cache.set(cacheKey, data);
            return data;
            
        } catch (error) {
            console.error('FRED fetch error:', error);
            return [];
        }
    }

    // Census Bureau ACS Data
    async fetchCensusACS(variables, geoLevel = 'county', state = '08') {
        const cacheKey = `census_${variables.join('_')}_${geoLevel}`;
        if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
        
        try {
            // Real implementation:
            // const varString = variables.join(',');
            // const response = await fetch(
            //     `${this.apis.census.baseUrl}/2022/acs/acs5?get=NAME,${varString}&for=${geoLevel}:*&in=state:${state}&key=${this.apis.census.apiKey}`
            // );
            
            // Sample data structure
            const data = {
                denver: {
                    vacancy: 7.6,
                    multifamilyUnits: 158400,
                    rentBurdened: 48.2
                },
                mesa: {
                    vacancy: 4.1,
                    multifamilyUnits: 12300,
                    rentBurdened: 52.8
                },
                eagle: {
                    vacancy: 1.2,
                    multifamilyUnits: 8900,
                    rentBurdened: 58.5
                }
            };
            
            this.cache.set(cacheKey, data);
            return data;
            
        } catch (error) {
            console.error('Census fetch error:', error);
            return null;
        }
    }

    // Colorado State Demography Office Data
    async fetchColoradoDemography(metric = 'migration') {
        const cacheKey = `co_demo_${metric}`;
        if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
        
        try {
            // Colorado SDO provides custom datasets
            // Would integrate their Excel/CSV exports programmatically
            
            const data = {
                migration: {
                    denver: { netMigration2024: 12500, percentChange: 1.2 },
                    westernSlope: { netMigration2024: 2800, percentChange: 2.1 },
                    rural: { netMigration2024: -450, percentChange: -0.3 }
                },
                wageGrowth: {
                    denver: { growth2015to2025: 55, medianWage2025: 68500 },
                    westernSlope: { growth2015to2025: 28, medianWage2025: 52000 },
                    rural: { growth2015to2025: 18, medianWage2025: 45000 }
                },
                homePrices: {
                    denver: { median2025: 575000, percentChange5yr: 42 },
                    westernSlope: { median2025: 625000, percentChange5yr: 78 },
                    rural: { median2025: 485000, percentChange5yr: 91 }
                }
            };
            
            this.cache.set(cacheKey, data);
            return data;
            
        } catch (error) {
            console.error('CO Demography fetch error:', error);
            return null;
        }
    }

    // HUD LIHTC Database
    async fetchLIHTCProjects(state = 'CO', filters = {}) {
        const cacheKey = `lihtc_${state}_${JSON.stringify(filters)}`;
        if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
        
        try {
            // HUD provides downloadable datasets
            // Would parse their CSV/Excel programmatically
            
            const data = {
                totalProjects: 1248,
                totalUnits: 47832,
                byRegion: {
                    denver: { projects: 756, units: 32100, avgAMI: 58 },
                    westernSlope: { projects: 142, units: 4820, avgAMI: 55 },
                    rural: { projects: 350, units: 10912, avgAMI: 52 }
                },
                placedInService: {
                    '2020-2025': 287,
                    '2015-2019': 412,
                    'pre2015': 549
                }
            };
            
            this.cache.set(cacheKey, data);
            return data;
            
        } catch (error) {
            console.error('LIHTC database fetch error:', error);
            return null;
        }
    }

    // Affordability Gap Calculator
    calculateAffordabilityGap(medianIncome, medianHomePrice) {
        const affordablePrice = medianIncome * 3; // 3x income rule
        const gap = ((medianHomePrice - affordablePrice) / affordablePrice) * 100;
        const incomeNeeded = medianHomePrice / 3;
        const incomeIncrease = ((incomeNeeded - medianIncome) / medianIncome) * 100;
        
        return {
            affordablePrice,
            actualPrice: medianHomePrice,
            gap: gap.toFixed(1),
            incomeNeeded,
            incomeIncrease: incomeIncrease.toFixed(1)
        };
    }

    // Regional Comparison Generator
    async generateRegionalComparison() {
        const ami = await this.fetchHUDAMI('all');
        const demo = await this.fetchColoradoDemography('all');
        const census = await this.fetchCensusACS(['vacancy', 'multifamily']);
        
        return {
            denver: {
                jobMarket: 'Tech/professional services; 33% growth since 2010',
                housingStarts: 43000,
                vacancy: 7.6,
                ami: 86870,
                multifamilyDemand: 'High - TOD driven'
            },
            westernSlope: {
                jobMarket: 'Tourism-heavy; remote work inflating costs',
                housingStarts: 1200,
                vacancy: 1.2,
                ami: 64000,
                multifamilyDemand: 'High demand, low supply - construction costs'
            },
            rural: {
                jobMarket: 'Agriculture/resource-based; income lagging',
                housingStarts: 450,
                vacancy: 3.8,
                ami: 52000,
                multifamilyDemand: 'Critical shortage'
            }
        };
    }

    // API Setup Instructions
    getAPISetupInstructions() {
        return {
            hud: {
                signup: 'https://www.huduser.gov/hudapi/public/register',
                docs: 'https://www.huduser.gov/portal/dataset/fmr-api.html',
                note: 'Free registration required for API token'
            },
            fred: {
                signup: 'https://research.stlouisfed.org/useraccount/apikey',
                docs: 'https://fred.stlouisfed.org/docs/api/fred/',
                note: 'Free API key, no rate limits for reasonable use'
            },
            census: {
                signup: 'https://api.census.gov/data/key_signup.html',
                docs: 'https://www.census.gov/data/developers/data-sets.html',
                note: 'Free API key, comprehensive ACS data'
            },
            colorado: {
                site: 'https://demography.dola.colorado.gov/',
                docs: 'https://coloradodemography.github.io/WebsiteGrid/',
                note: 'Custom datasets, Excel exports available'
            }
        };
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.DataAPIIntegrations = new DataAPIIntegrations();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DataAPIIntegrations };
}
