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
    },

    /* ── Colorado-specific sources (Phase B) ────────────────────────── */
    acs5yr: {
        primary: "U.S. Census Bureau — American Community Survey 5-Year Estimates",
        url: "https://data.census.gov",
        updateFrequency: "Annual (Dec release)",
        lastUpdate: "2020–2024 (ACS 2024)",
        methodology: "5-year pooled survey estimates with margins of error",
        coverage: "All CO tracts, places, counties",
        geography: "Census tract / place / county",
        vintage: "2024"
    },
    hudFmr: {
        primary: "HUD Fair Market Rents",
        url: "https://www.huduser.gov/portal/datasets/fmr.html",
        updateFrequency: "Annual (Oct)",
        lastUpdate: "FY2025",
        methodology: "40th percentile gross rent from ACS + CPI adjustment",
        coverage: "All CO counties and metro areas",
        geography: "County / CBSA"
    },
    hudIl: {
        primary: "HUD Income Limits",
        url: "https://www.huduser.gov/portal/datasets/il.html",
        updateFrequency: "Annual (Apr)",
        lastUpdate: "FY2025",
        methodology: "Area Median Income derived from ACS",
        coverage: "All CO counties and metro areas",
        geography: "County / CBSA"
    },
    hudChas: {
        primary: "HUD CHAS (Comprehensive Housing Affordability Strategy)",
        url: "https://www.huduser.gov/portal/datasets/cp.html",
        updateFrequency: "Annual",
        lastUpdate: "2017–2021",
        methodology: "Custom tabulations of ACS data for housing need categories",
        coverage: "All CO counties, tracts",
        geography: "County / tract"
    },
    fred: {
        primary: "Federal Reserve Economic Data (FRED)",
        url: "https://fred.stlouisfed.org",
        updateFrequency: "Daily (rates) / Monthly (CPI, employment)",
        lastUpdate: "Live",
        methodology: "Official government statistics aggregated by Federal Reserve Bank of St. Louis",
        coverage: "National / state / MSA",
        geography: "National / state"
    },
    lehd: {
        primary: "LEHD LODES Origin-Destination Employment Statistics",
        url: "https://lehd.ces.census.gov/data/",
        updateFrequency: "Annual (Apr/May release, 2-year lag)",
        lastUpdate: "2023",
        methodology: "Administrative records linked to Census geographies",
        coverage: "All CO census blocks → aggregated to tracts",
        geography: "Census block / tract"
    },
    dola: {
        primary: "Colorado State Demography Office (DOLA SDO)",
        url: "https://demography.dola.colorado.gov/",
        updateFrequency: "Annual",
        lastUpdate: "2023",
        methodology: "Component-method population estimates and projections",
        coverage: "All CO counties",
        geography: "County"
    },
    nhpd: {
        primary: "National Housing Preservation Database (NHPD)",
        url: "https://preservationdatabase.org/",
        updateFrequency: "Quarterly",
        lastUpdate: "2026 Q1",
        methodology: "Consolidated federal subsidy records (Section 8, HOME, LIHTC, Section 202)",
        coverage: "All federally assisted properties in CO",
        geography: "Property-level (geocoded)"
    },
    chfa: {
        primary: "Colorado Housing and Finance Authority (CHFA)",
        url: "https://www.chfainfo.com",
        updateFrequency: "Ongoing (allocation rounds)",
        lastUpdate: "2026",
        methodology: "Official LIHTC awards, QAP scoring, multifamily portfolio",
        coverage: "All CHFA-administered programs",
        geography: "Project-level / county"
    },
    chfaAffordableHousing: {
        primary: "CHFA Colorado Affordable Housing Database",
        url: "https://chfa.maps.arcgis.com/apps/instant/basic/index.html?appid=d90075bcf7e041b99b219e7b241a21db",
        updateFrequency: "Ongoing",
        lastUpdate: "Apr 2026",
        methodology: "Comprehensive inventory of affordable multifamily properties across Colorado including LIHTC, Section 8, HOME, public housing, and other subsidized projects",
        coverage: "1,688 affordable housing properties statewide",
        geography: "Property-level (geocoded)"
    },
    osmAmenities: {
        primary: "OpenStreetMap Contributors",
        url: "https://www.openstreetmap.org",
        updateFrequency: "Weekly refresh via Overpass API",
        lastUpdate: "Apr 2026",
        methodology: "Community-contributed POI data (schools, transit, grocery, healthcare, parks)",
        coverage: "All CO",
        geography: "Point locations"
    },
    blsPpi: {
        primary: "Bureau of Labor Statistics — Producer Price Index",
        url: "https://www.bls.gov/ppi/",
        updateFrequency: "Monthly",
        lastUpdate: "Mar 2026",
        methodology: "Survey of producers for commodity input costs",
        coverage: "National (steel, lumber, concrete, copper, cement)",
        geography: "National"
    },
    prop123: {
        primary: "Colorado DOLA — Proposition 123 Compliance",
        url: "https://cdola.colorado.gov/proposition-123",
        updateFrequency: "Annual filings",
        lastUpdate: "2025 filings",
        methodology: "Jurisdiction-reported housing production vs. baseline growth targets",
        coverage: "265 opt-in jurisdictions",
        geography: "Municipality / county"
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

/**
 * addSourceBadge — lightweight source attribution for any container.
 * Usage:  addSourceBadge('containerId', 'acs5yr')             — single source
 *         addSourceBadge('containerId', ['acs5yr', 'hudFmr']) — multiple sources
 *         addSourceBadge(domElement, 'fred', { showGeo: true, showVintage: true })
 */
function addSourceBadge(target, sourceKeys, opts) {
    opts = opts || {};
    var container = typeof target === 'string' ? document.getElementById(target) : target;
    if (!container) return;
    if (container.querySelector('.kpi-source, .chart-source')) return; // already has one

    var keys = Array.isArray(sourceKeys) ? sourceKeys : [sourceKeys];
    var parts = [];
    keys.forEach(function (k) {
        var s = DataSources[k] || { primary: k };
        var label = s.primary || k;
        var link = s.url ? '<a href="' + s.url + '" target="_blank" rel="noopener">' + label + '</a>' : label;
        var extra = '';
        if (opts.showVintage && s.vintage)  extra += ' · ' + s.vintage;
        if (opts.showVintage && s.lastUpdate && !s.vintage) extra += ' · ' + s.lastUpdate;
        if (opts.showGeo && s.geography)    extra += ' · ' + s.geography;
        if (opts.showFreq && s.updateFrequency) extra += ' · ' + s.updateFrequency;
        parts.push(link + extra);
    });

    var badge = document.createElement('div');
    badge.className = opts.className || 'kpi-source';
    badge.innerHTML = 'Source: ' + parts.join(' | ');
    container.appendChild(badge);
}

/**
 * addDataQualitySummary — drop-in panel showing primary/fallback data and freshness.
 * Appended to the target container.
 */
function addDataQualitySummary(target, config) {
    var container = typeof target === 'string' ? document.getElementById(target) : target;
    if (!container || container.querySelector('.dq-summary')) return;

    var html = '<div class="dq-summary" style="margin-top:var(--sp3);padding:var(--sp3);background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);font-size:.78rem;color:var(--muted);line-height:1.7;">';
    html += '<strong style="color:var(--text)">Data Sources & Quality</strong>';

    if (config.primary) {
        html += '<div style="margin-top:.4rem">🟢 <strong>Primary:</strong> ';
        config.primary.forEach(function (p, i) {
            var s = DataSources[p] || { primary: p };
            var link = s.url ? '<a href="' + s.url + '" target="_blank" rel="noopener" style="color:var(--accent)">' + s.primary + '</a>' : s.primary;
            html += (i > 0 ? ' · ' : '') + link;
        });
        html += '</div>';
    }
    if (config.fallback) {
        html += '<div>🟡 <strong>Fallback:</strong> ' + config.fallback + '</div>';
    }
    if (config.geography) {
        html += '<div>📍 <strong>Coverage:</strong> ' + config.geography + '</div>';
    }
    if (config.freshness) {
        html += '<div>🕐 <strong>Freshness:</strong> ' + config.freshness + '</div>';
    }
    if (config.limitations) {
        html += '<div>⚠️ <strong>Limitations:</strong> ' + config.limitations + '</div>';
    }
    html += '</div>';

    var el = document.createElement('div');
    el.innerHTML = html;
    container.appendChild(el.firstChild);
}

// Make available globally
if (typeof window !== 'undefined') {
    window.DataSources = DataSources;
    window.addChartCitation = addChartCitation;
    window.addArticleAttribution = addArticleAttribution;
    window.addSourceBadge = addSourceBadge;
    window.addDataQualitySummary = addDataQualitySummary;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DataSources, addChartCitation, addArticleAttribution };
}
