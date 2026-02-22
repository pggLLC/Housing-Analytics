// Dashboard Charts and Interactions - Enhanced with Real-time Data

document.addEventListener('DOMContentLoaded', async function() {
    // Chart.js default configuration
    Chart.defaults.font.family = "'DM Sans', sans-serif";
    Chart.defaults.color = '#6c7a89';
    
    const colors = {
        primary: '#1a3a52',
        primaryLight: '#2d5573',
        accent: '#d4a574',
        success: '#27ae60',
        warning: '#f39c12',
        error: '#c0392b',
        info: '#3498db'
    };
    
    // Initialize data service
    const dataService = window.LIHTCDataService;
    
    // Show live data indicator
    addLiveIndicator();
    
    // Subscribe to data updates
    dataService.subscribe('novoco_pricing', updatePricingData);
    dataService.subscribe('hud_allocations', updateAllocationData);
    dataService.subscribe('census_housing', updateHousingData);
    
    // Load initial data
    await loadDashboardData();
    
    // LIHTC Allocations by State Chart
    const allocationsCtx = document.getElementById('allocations-chart');
    if (allocationsCtx) {
        new Chart(allocationsCtx, {
            type: 'bar',
            data: {
                labels: ['CA', 'NY', 'TX', 'FL', 'IL', 'PA', 'CO', 'GA', 'NC', 'MI'],
                datasets: [{
                    label: 'Total Allocation ($M)',
                    data: [1842, 1456, 1289, 987, 845, 732, 287, 654, 612, 587],
                    backgroundColor: colors.primary,
                    borderColor: colors.primaryLight,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return '$' + context.parsed.y + 'M';
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '$' + value + 'M';
                            }
                        },
                        grid: {
                            color: 'rgba(0, 0, 0, 0.05)'
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    }
    
    // Tax Credit Pricing Trends Chart
    const pricingCtx = document.getElementById('pricing-chart');
    if (pricingCtx) {
        new Chart(pricingCtx, {
            type: 'line',
            data: {
                labels: ['Q1 2023', 'Q2 2023', 'Q3 2023', 'Q4 2023', 'Q1 2024', 'Q2 2024', 'Q3 2024', 'Q4 2024', 'Q1 2025', 'Q2 2025'],
                datasets: [
                    {
                        label: '9% Credit Price',
                        data: [0.88, 0.89, 0.90, 0.91, 0.89, 0.88, 0.86, 0.85, 0.87, 0.87],
                        borderColor: colors.primary,
                        backgroundColor: 'rgba(26, 58, 82, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: '4% Credit Price',
                        data: [0.87, 0.85, 0.86, 0.87, 0.85, 0.87, 0.82, 0.81, 0.79, 0.79],
                        borderColor: colors.accent,
                        backgroundColor: 'rgba(212, 165, 116, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'end'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': $' + context.parsed.y.toFixed(2);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        min: 0.75,
                        max: 1.00,
                        ticks: {
                            callback: function(value) {
                                return '$' + value.toFixed(2);
                            }
                        },
                        grid: {
                            color: 'rgba(0, 0, 0, 0.05)'
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    }
    
    // Housing Starts by Quarter Chart  
    const startsCtx = document.getElementById('starts-chart');
    if (startsCtx) {
        new Chart(startsCtx, {
            type: 'line',
            data: {
                labels: ['Q1 2023', 'Q2 2023', 'Q3 2023', 'Q4 2023', 'Q1 2024', 'Q2 2024', 'Q3 2024', 'Q4 2024', 'Q1 2025'],
                datasets: [{
                    label: 'Multifamily Starts (000s)',
                    data: [128, 135, 142, 138, 145, 152, 148, 141, 138],
                    borderColor: colors.info,
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.parsed.y + 'K units';
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        min: 120,
                        ticks: {
                            callback: function(value) {
                                return value + 'K';
                            }
                        },
                        grid: {
                            color: 'rgba(0, 0, 0, 0.05)'
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    }
    
    // Credit Type Distribution Chart
    const creditTypeCtx = document.getElementById('credit-type-chart');
    if (creditTypeCtx) {
        new Chart(creditTypeCtx, {
            type: 'doughnut',
            data: {
                labels: ['9% Competitive', '4% Non-Competitive', 'Other Programs'],
                datasets: [{
                    data: [62, 33, 5],
                    backgroundColor: [
                        colors.primary,
                        colors.accent,
                        colors.info
                    ],
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 15,
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.label + ': ' + context.parsed + '%';
                            }
                        }
                    }
                }
            }
        });
    }
    
    // Load dashboard data from service
    async function loadDashboardData() {
        try {
            const pricing = await dataService.getCurrentPricing();
            const hudData = await dataService.fetchHUDData();
            
            // Update metrics
            if (pricing) {
                const avgPricing = document.getElementById('avg-pricing');
                if (avgPricing) avgPricing.textContent = '$' + pricing['9percent'].toFixed(2);
            }
            
            if (hudData) {
                let total = 0;
                for (const state in hudData.stateAllocations) {
                    total += hudData.stateAllocations[state].total;
                }
                const totalEl = document.getElementById('total-allocations');
                if (totalEl) totalEl.textContent = '$' + (total / 1000000000).toFixed(1) + 'B';
            }
            
            console.log('Dashboard data loaded successfully');
        } catch (error) {
            console.error('Error loading dashboard data:', error);
        }
    }
    
    // Update handlers for live data
    function updatePricingData(data) {
        const avgPricing = document.getElementById('avg-pricing');
        if (avgPricing && data.current) {
            avgPricing.textContent = '$' + data.current['9percent'].toFixed(2);
            flashUpdate(avgPricing);
        }
    }
    
    function updateAllocationData(data) {
        // Update allocation displays
        console.log('Allocation data updated:', data);
    }
    
    function updateHousingData(data) {
        const housingStarts = document.getElementById('housing-starts');
        if (housingStarts && data.nationalStarts && data.nationalStarts.length > 0) {
            const latest = data.nationalStarts[data.nationalStarts.length - 1];
            housingStarts.textContent = (latest.starts / 1000).toFixed(0) + 'K';
            flashUpdate(housingStarts);
        }
    }
    
    // Visual feedback for live updates
    function flashUpdate(element) {
        element.style.transition = 'background-color 0.3s';
        element.style.backgroundColor = 'rgba(212, 165, 116, 0.2)';
        setTimeout(() => {
            element.style.backgroundColor = '';
        }, 1000);
    }
    
    // Add live data indicator
    function addLiveIndicator() {
        const header = document.querySelector('.dashboard-header');
        if (header) {
            const indicator = document.createElement('div');
            indicator.style.cssText = 'display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; background: rgba(39, 174, 96, 0.1); border: 1px solid rgba(39, 174, 96, 0.3); border-radius: 20px; font-size: 0.875rem; margin-left: 1rem;';
            indicator.innerHTML = '<span style="width: 8px; height: 8px; background: #27ae60; border-radius: 50%; animation: pulse 2s infinite;"></span><span style="color: #27ae60; font-weight: 600;">Live Data</span>';
            
            const style = document.createElement('style');
            style.textContent = '@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }';
            document.head.appendChild(style);
            
            header.appendChild(indicator);
        }
    }
    
    // Filter functionality
    const yearFilter = document.getElementById('year-filter');
    const regionFilter = document.getElementById('region-filter');
    const metricFilter = document.getElementById('metric-filter');
    
    function updateDashboard() {
        const year = yearFilter ? yearFilter.value : '2025';
        const region = regionFilter ? regionFilter.value : 'national';
        const metric = metricFilter ? metricFilter.value : 'allocations';
        
        console.log('Updating dashboard:', { year, region, metric });
        updateKeyMetrics(year, region);
    }
    
    function updateKeyMetrics(year, region) {
        const metrics = {
            '2025': {
                'national': {
                    allocations: '$12.8B',
                    pricing: '$0.87',
                    starts: '138K',
                    foreclosures: '0.9%'
                },
                'northeast': {
                    allocations: '$2.9B',
                    pricing: '$0.86',
                    starts: '31K',
                    foreclosures: '0.7%'
                },
                'south': {
                    allocations: '$4.4B',
                    pricing: '$0.83',
                    starts: '46K',
                    foreclosures: '1.0%'
                },
                'midwest': {
                    allocations: '$2.1B',
                    pricing: '$0.82',
                    starts: '26K',
                    foreclosures: '0.8%'
                },
                'west': {
                    allocations: '$3.4B',
                    pricing: '$0.85',
                    starts: '35K',
                    foreclosures: '0.9%'
                }
            }
        };
        
        const data = metrics[year] && metrics[year][region] ? metrics[year][region] : metrics['2025']['national'];
        
        const totalAllocations = document.getElementById('total-allocations');
        const avgPricing = document.getElementById('avg-pricing');
        const housingStarts = document.getElementById('housing-starts');
        const foreclosureRate = document.getElementById('foreclosure-rate');
        
        if (totalAllocations) totalAllocations.textContent = data.allocations;
        if (avgPricing) avgPricing.textContent = data.pricing;
        if (housingStarts) housingStarts.textContent = data.starts;
        if (foreclosureRate) foreclosureRate.textContent = data.foreclosures;
    }
    
    // Add event listeners to filters
    if (yearFilter) yearFilter.addEventListener('change', updateDashboard);
    if (regionFilter) regionFilter.addEventListener('change', updateDashboard);
    if (metricFilter) metricFilter.addEventListener('change', updateDashboard);
});
