// Regional Analysis Page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const colors = {
        primary: '#1a3a52',
        primaryLight: '#2d5573',
        accent: '#d4a574',
        success: '#27ae60',
        info: '#3498db'
    };
    
    // Initialize Leaflet map
    const map = L.map('map').setView([39.8283, -98.5795], 4);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    
    // Add state markers (simplified - in production would use GeoJSON)
    const stateData = [
        { name: 'California', lat: 36.7783, lng: -119.4179, allocation: 1842, perCapita: 47 },
        { name: 'New York', lat: 43.2994, lng: -74.2179, allocation: 1456, perCapita: 75 },
        { name: 'Texas', lat: 31.9686, lng: -99.9018, allocation: 1289, perCapita: 44 },
        { name: 'Florida', lat: 27.6648, lng: -81.5158, allocation: 987, perCapita: 46 },
        { name: 'Illinois', lat: 40.6331, lng: -89.3985, allocation: 845, perCapita: 67 }
    ];
    
    stateData.forEach(state => {
        const radius = Math.sqrt(state.allocation) * 0.8;
        const circle = L.circle([state.lat, state.lng], {
            color: colors.primary,
            fillColor: colors.accent,
            fillOpacity: 0.5,
            radius: radius * 1000
        }).addTo(map);
        
        circle.bindPopup(`
            <strong>${state.name}</strong><br>
            Total Allocation: $${state.allocation}M<br>
            Per Capita: $${state.perCapita}
        `);
    });
    
    // Per Capita Chart
    const perCapitaCtx = document.getElementById('per-capita-chart');
    if (perCapitaCtx) {
        new Chart(perCapitaCtx, {
            type: 'bar',
            data: {
                labels: ['VT', 'ME', 'ND', 'MT', 'NY', 'MA', 'IL', 'RI', 'CT', 'HI', 'OR', 'WA', 'CA', 'FL', 'TX'],
                datasets: [{
                    label: 'Per Capita Allocation ($)',
                    data: [89, 82, 78, 76, 75, 72, 67, 65, 63, 61, 58, 54, 47, 46, 44],
                    backgroundColor: colors.primary,
                    borderColor: colors.primaryLight,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return '$' + context.parsed.x + ' per capita';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '$' + value;
                            }
                        },
                        grid: {
                            color: 'rgba(0, 0, 0, 0.05)'
                        }
                    },
                    y: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    }
    
    // Regional Pie Chart
    const regionalPieCtx = document.getElementById('regional-pie-chart');
    if (regionalPieCtx) {
        new Chart(regionalPieCtx, {
            type: 'doughnut',
            data: {
                labels: ['South', 'West', 'Northeast', 'Midwest'],
                datasets: [{
                    data: [34, 27, 23, 16],
                    backgroundColor: [
                        colors.primary,
                        colors.accent,
                        colors.info,
                        colors.success
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
    
    // Regional Trends Chart
    const trendsCtx = document.getElementById('regional-trends-chart');
    if (trendsCtx) {
        new Chart(trendsCtx, {
            type: 'line',
            data: {
                labels: ['2021', '2022', '2023', '2024', '2025'],
                datasets: [
                    {
                        label: 'Northeast',
                        data: [2.4, 2.6, 2.7, 2.8, 2.9],
                        borderColor: colors.info,
                        backgroundColor: 'rgba(52, 152, 219, 0.1)',
                        borderWidth: 2,
                        tension: 0.4
                    },
                    {
                        label: 'South',
                        data: [3.6, 3.8, 4.0, 4.1, 4.2],
                        borderColor: colors.primary,
                        backgroundColor: 'rgba(26, 58, 82, 0.1)',
                        borderWidth: 2,
                        tension: 0.4
                    },
                    {
                        label: 'Midwest',
                        data: [1.8, 1.9, 2.0, 2.0, 2.1],
                        borderColor: colors.success,
                        backgroundColor: 'rgba(39, 174, 96, 0.1)',
                        borderWidth: 2,
                        tension: 0.4
                    },
                    {
                        label: 'West',
                        data: [2.9, 3.1, 3.2, 3.3, 3.3],
                        borderColor: colors.accent,
                        backgroundColor: 'rgba(212, 165, 116, 0.1)',
                        borderWidth: 2,
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
                                return context.dataset.label + ': $' + context.parsed.y + 'B';
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '$' + value + 'B';
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
    
    // State selector functionality
    const stateSelect = document.getElementById('state-select');
    const metroSelect = document.getElementById('metro-select');
    const stateProfile = document.getElementById('state-profile');
    
    const metrosByState = {
        'CA': ['Los Angeles-Long Beach', 'San Francisco-Oakland', 'San Diego', 'Sacramento'],
        'CO': ['Denver-Aurora-Lakewood', 'Colorado Springs', 'Fort Collins', 'Boulder', 'Pueblo'],
        'NY': ['New York-Newark-Jersey City', 'Buffalo-Niagara Falls', 'Rochester'],
        'TX': ['Dallas-Fort Worth', 'Houston-The Woodlands', 'Austin', 'San Antonio'],
        'FL': ['Miami-Fort Lauderdale', 'Tampa-St. Petersburg', 'Orlando'],
        'IL': ['Chicago-Naperville-Elgin', 'Springfield', 'Peoria']
    };
    
    const stateProfiles = {
        'CA': { allocation: '$1.84B', perCapita: '$47', projects: 312, units: '42,680' },
        'CO': { allocation: '$287M', perCapita: '$49', projects: 78, units: '8,940' },
        'NY': { allocation: '$1.46B', perCapita: '$75', projects: 268, units: '38,120' },
        'TX': { allocation: '$1.29B', perCapita: '$44', projects: 294, units: '45,860' },
        'FL': { allocation: '$987M', perCapita: '$46', projects: 221, units: '32,450' },
        'IL': { allocation: '$845M', perCapita: '$67', projects: 186, units: '26,340' }
    };
    
    if (stateSelect) {
        stateSelect.addEventListener('change', function() {
            const state = this.value;
            
            if (state && metrosByState[state]) {
                metroSelect.innerHTML = '<option value="">All Metro Areas</option>';
                metrosByState[state].forEach(metro => {
                    const option = document.createElement('option');
                    option.value = metro;
                    option.textContent = metro;
                    metroSelect.appendChild(option);
                });
                metroSelect.disabled = false;
                
                // Show state profile
                if (stateProfiles[state]) {
                    const profile = stateProfiles[state];
                    document.getElementById('profile-title').textContent = this.options[this.selectedIndex].text + ' Profile';
                    document.getElementById('state-allocation').textContent = profile.allocation;
                    document.getElementById('state-per-capita').textContent = profile.perCapita;
                    document.getElementById('state-projects').textContent = profile.projects;
                    document.getElementById('state-units').textContent = profile.units;
                    stateProfile.style.display = 'block';
                }
            } else {
                metroSelect.innerHTML = '<option value="">Select State First</option>';
                metroSelect.disabled = true;
                stateProfile.style.display = 'none';
            }
        });
    }
});
