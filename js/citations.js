// Citation and Source Attribution Module
// Ensures all charts and articles have proper source attribution

const DataSources = {
    pricing: {
        primary: "Novogradac LIHTC Equity Pricing Trends",
        url: "https://www.novoco.com",
        updateFrequency: "Quarterly",
        lastUpdate: "June 2025",
        methodology: "Based on actual syndication reports from investors and syndicators",
        coverage: "National average from representative sample of transactions"
    },
    
    hud: {
        primary: "HUD Low-Income Housing Tax Credit Database",
        url: "https://www.huduser.gov/portal/datasets/lihtc.html",
        updateFrequency: "Annually",
        lastUpdate: "2024 data (published Q1 2026)",
        methodology: "Census of all LIHTC projects placed in service",
        coverage: "All 50 states, project-level detail"
    },
    
    census: {
        primary: "U.S. Census Bureau - Housing Starts",
        url: "https://www.census.gov/construction/nrc/",
        updateFrequency: "Monthly",
        lastUpdate: "January 2026",
        methodology: "Survey of building permits and housing starts",
        coverage: "National, regional, and state-level data"
    },
    
    stateHFA: {
        colorado: {
            primary: "Colorado Housing and Finance Authority (CHFA)",
            url: "https://www.chfainfo.com",
            updateFrequency: "Annual QAP releases",
            lastUpdate: "2026 QAP",
            methodology: "Official allocation data and awards",
            coverage: "All CHFA-administered programs"
        }
    },
    
    legislation: {
        primary: "Housing Finance Magazine",
        url: "https://www.housingfinance.com",
        reference: "House Approves Sweeping Housing Package",
        date: "February 9, 2026",
        additional: [
            "Congressional Record H.R. 6644",
            "Bipartisan Policy Center Housing Analysis"
        ]
    },
    
    commodities: {
        steel: {
            primary: "Producer Price Index (PPI) - BLS",
            url: "https://www.bls.gov/ppi/",
            additional: "Metal Construction News, Steel Market Update"
        },
        lumber: {
            primary: "National Association of Home Builders (NAHB)",
            url: "https://www.nahb.org",
            additional: "Random Lengths Lumber Pricing Service"
        },
        concrete: {
            primary: "Portland Cement Association",
            url: "https://www.cement.org",
            additional: "BLS Producer Price Index"
        },
        general: {
            primary: "Associated General Contractors (AGC)",
            url: "https://www.agc.org",
            reference: "Construction Cost Reports",
            additional: "Deloitte Engineering & Construction Industry Outlook"
        }
    },
    
    stocks: {
        primary: "Yahoo Finance / SEC Filings",
        url: "https://finance.yahoo.com",
        additional: [
            "Motley Fool REIT Analysis",
            "Company 10-K and 10-Q reports",
            "National Association of Real Estate Investment Trusts (NAREIT)"
        ]
    },
    
    forecasting: {
        methodology: "Proprietary econometric models",
        models: [
            "ARIMA (AutoRegressive Integrated Moving Average)",
            "VAR (Vector Autoregression)",
            "Multiple Linear Regression with external factors",
            "Probability-weighted scenario analysis"
        ],
        disclaimer: "Forecasts are estimates based on current market conditions and may vary"
    }
};

// Add citation to chart
function addChartCitation(chartId, sources) {
    const chartContainer = document.getElementById(chartId)?.parentElement;
    if (!chartContainer) return;
    
    const existingCitation = chartContainer.querySelector('.chart-citation');
    if (existingCitation) return; // Already has citation
    
    const citation = document.createElement('div');
    citation.className = 'chart-citation';
    citation.style.cssText = 'margin-top: 1rem; padding: 0.75rem; background: var(--color-background-alt); border-left: 3px solid var(--color-accent); font-size: 0.8125rem; color: var(--color-text-muted); line-height: 1.6;';
    
    let citationHTML = '<strong>Sources:</strong> ';
    
    if (typeof sources === 'string') {
        const source = DataSources[sources];
        if (source) {
            citationHTML += `${source.primary}`;
            if (source.url) {
                citationHTML += ` (<a href="${source.url}" target="_blank" style="color: var(--color-primary); text-decoration: underline;">${source.url}</a>)`;
            }
            if (source.lastUpdate) {
                citationHTML += ` • Last updated: ${source.lastUpdate}`;
            }
        }
    } else if (Array.isArray(sources)) {
        citationHTML += sources.map(s => {
            const source = DataSources[s];
            return source ? source.primary : s;
        }).join(', ');
    }
    
    citation.innerHTML = citationHTML;
    chartContainer.appendChild(citation);
}

// Add article attribution
function addArticleAttribution(articleId, sources) {
    const article = document.getElementById(articleId) || document.querySelector('article');
    if (!article) return;
    
    const existingAttr = article.querySelector('.article-attribution');
    if (existingAttr) return;
    
    const attribution = document.createElement('div');
    attribution.className = 'article-attribution';
    attribution.style.cssText = 'margin-top: 3rem; padding: 2rem; background: var(--color-background-alt); border-radius: 8px; font-size: 0.9375rem; line-height: 1.7;';
    
    let html = '<h3 style="font-size: 1.125rem; margin-bottom: 1rem; color: var(--color-primary);">Data Sources & Methodology</h3>';
    
    if (sources.primary) {
        html += '<div style="margin-bottom: 1.5rem;"><strong>Primary Sources:</strong><ul style="margin-top: 0.5rem; margin-left: 1.5rem;">';
        sources.primary.forEach(source => {
            const s = DataSources[source] || { primary: source };
            html += `<li>${s.primary}`;
            if (s.url) html += ` - <a href="${s.url}" target="_blank" style="color: var(--color-primary);">${s.url}</a>`;
            if (s.lastUpdate) html += ` (${s.lastUpdate})`;
            html += '</li>';
        });
        html += '</ul></div>';
    }
    
    if (sources.methodology) {
        html += '<div style="margin-bottom: 1.5rem;"><strong>Methodology:</strong><div style="margin-top: 0.5rem; color: var(--color-text-light);">';
        html += sources.methodology;
        html += '</div></div>';
    }
    
    if (sources.disclaimer) {
        html += '<div style="padding: 1rem; background: rgba(243, 156, 18, 0.1); border-left: 3px solid var(--color-warning); border-radius: 4px; font-size: 0.875rem;"><strong>Disclaimer:</strong> ';
        html += sources.disclaimer;
        html += '</div>';
    }
    
    attribution.innerHTML = html;
    article.appendChild(attribution);
}

// Auto-initialize citations on page load
document.addEventListener('DOMContentLoaded', function() {
    // Dashboard citations
    if (document.getElementById('allocations-chart')) {
        addChartCitation('allocations-chart', 'hud');
    }
    if (document.getElementById('pricing-chart')) {
        addChartCitation('pricing-chart', 'pricing');
    }
    if (document.getElementById('starts-chart')) {
        addChartCitation('starts-chart', 'census');
    }
    
    // Regional page citations
    if (document.getElementById('per-capita-chart')) {
        addChartCitation('per-capita-chart', 'hud');
    }
    
    // Colorado page citations
    if (document.getElementById('co-pricing-forecast')) {
        const container = document.getElementById('co-pricing-forecast')?.parentElement;
        if (container) {
            const citation = document.createElement('div');
            citation.className = 'chart-citation';
            citation.style.cssText = 'margin-top: 1rem; padding: 0.75rem; background: var(--color-background-alt); border-left: 3px solid var(--color-accent); font-size: 0.8125rem; color: var(--color-text-muted); line-height: 1.6;';
            citation.innerHTML = '<strong>Sources:</strong> Novogradac LIHTC Pricing (June 2025), CHFA allocation data • <strong>Forecast Model:</strong> ARIMA with 95% confidence intervals';
            container.appendChild(citation);
        }
    }
    
    // CRA expansion page citations
    if (document.getElementById('scenarios-chart')) {
        const container = document.getElementById('scenarios-chart')?.parentElement;
        if (container) {
            const citation = document.createElement('div');
            citation.className = 'chart-citation';
            citation.style.cssText = 'margin-top: 1rem; padding: 0.75rem; background: var(--color-background-alt); border-left: 3px solid var(--color-accent); font-size: 0.8125rem; color: var(--color-text-muted); line-height: 1.6;';
            citation.innerHTML = '<strong>Methodology:</strong> Proprietary econometric model combining policy impact analysis, historical CRA expansion precedents, and probability-weighted scenario forecasting • <strong>Base Data:</strong> Novogradac June 2025 pricing, Congressional bill text (AHCIA, CRA Modernization Act) • <strong>Disclaimer:</strong> Forecasts are estimates; actual outcomes may vary significantly based on legislative specifics and implementation';
            container.appendChild(citation);
        }
    }
    
    // Commodities chart citation
    if (document.getElementById('commodities-chart')) {
        const container = document.getElementById('commodities-chart')?.parentElement;
        if (container) {
            const citation = document.createElement('div');
            citation.className = 'chart-citation';
            citation.style.cssText = 'margin-top: 1rem; padding: 0.75rem; background: var(--color-background-alt); border-left: 3px solid var(--color-accent); font-size: 0.8125rem; color: var(--color-text-muted); line-height: 1.6;';
            citation.innerHTML = '<strong>Sources:</strong> BLS Producer Price Index (PPI), NAHB Lumber Market Reports, AGC Construction Cost Reports, Random Lengths Pricing Service • <strong>Data:</strong> Q4 2025 actual, Q1-Q4 2026 forecast based on futures markets and analyst consensus • <strong>Last Updated:</strong> February 2026';
            container.appendChild(citation);
        }
    }
});

// Make available globally
if (typeof window !== 'undefined') {
    window.DataSources = DataSources;
    window.addChartCitation = addChartCitation;
    window.addArticleAttribution = addArticleAttribution;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DataSources, addChartCitation, addArticleAttribution };
}
