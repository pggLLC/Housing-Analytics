// js/data-source-inventory.js
// Registry of 63 data sources used or explicitly tracked by Housing Analytics.
// Exposed as window.DataSourceInventory.

(function () {
  'use strict';

  // ── Status helpers ──────────────────────────────────────────────
  var MS_PER_DAY = 86400000;

  function daysSince(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / MS_PER_DAY);
  }

  function isLiveApi(source) {
    if (!source) return false;
    // OSM Overpass, transit GTFS feeds, etc. don't have a snapshot date —
    // they're fetched on demand. Tag them as 'live' instead of 'unknown' so
    // the dashboard tells the truth: there's no missing freshness stamp,
    // the source genuinely doesn't have one.
    var freq = String(source.updateFrequency || '').toLowerCase();
    if (freq.indexOf('real-time') !== -1) return true;
    if (freq === 'live' || freq === 'on-demand' || freq.indexOf('live api') !== -1) return true;
    return false;
  }

  function computeStatus(source) {
    if (isLiveApi(source)) return 'live';
    var days = daysSince(source.lastUpdated);
    if (days === null) return 'unknown';
    var threshold = source.maxAgeDays || 90;
    var aging = Math.floor(threshold * 0.7);
    if (days <= aging) return 'current';
    if (days <= threshold) return 'aging';
    return 'stale';
  }

  function freshnessScore(source) {
    if (isLiveApi(source)) return 100;        // always fresh by definition
    var days = daysSince(source.lastUpdated);
    if (days === null) return null;
    var max = source.maxAgeDays || 90;
    return Math.max(0, Math.round(100 * (1 - days / max)));
  }

  var SOURCES = [
    // ── LIHTC / Housing ─────────────────────────────────────────
    {
      id: 'hud-lihtc-co',
      name: 'HUD LIHTC Colorado',
      category: 'LIHTC / Housing',
      format: 'GeoJSON',
      provider: 'HUD / ArcGIS',
      url: 'https://hudgis-hud.opendata.arcgis.com/',
      localFile: 'data/market/hud_lihtc_co.geojson',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Weekly',
      maxAgeDays: 10,
      geoUnit: 'Project',
      coverage: 'Colorado statewide',
      features: 926,
      description: 'HUD-schema LIHTC project GeoJSON for Colorado (fallback layer). Was the primary source through April 2026; superseded by data/chfa-lihtc.json after CHFA live service migration. Still rebuilt periodically for offline / fallback use. window.HudLihtc.load() now tries chfa-lihtc.json first (Tier 1) and falls back to this file only if CHFA cache is unavailable.',
      tags: ['lihtc', 'affordable-housing', 'colorado'],
      apiEndpoint: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer/0',
      alternatives: [
        { title: 'HUD LIHTC Database', description: 'Download full national LIHTC dataset from HUD', url: 'https://lihtc.huduser.gov/' },
        { title: 'HUD EGIS Open Data', description: 'HUD geospatial open data portal with LIHTC layers', url: 'https://hudgis-hud.opendata.arcgis.com/' },
        { title: 'Novogradac LIHTC Mapping Tool', description: 'Interactive LIHTC project map from Novogradac', url: 'https://www.novoco.com/resource-centers/low-income-housing-tax-credits/lihtc-mapping-tool' }
      ]
    },
    {
      id: 'chfa-lihtc',
      name: 'CHFA LIHTC Portfolio',
      category: 'LIHTC / Housing',
      format: 'JSON',
      provider: 'CHFA ArcGIS FeatureServer (public)',
      url: 'https://www.chfainfo.com/',
      localFile: 'data/chfa-lihtc.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Daily',
      maxAgeDays: 2,
      geoUnit: 'Project',
      coverage: 'Colorado statewide',
      features: 926,
      description: 'Canonical LIHTC project cache for Colorado (926 features through 2025). Fetched daily from CHFA\'s HousingTaxCreditProperties_view FeatureServer by scripts/fetch-chfa-lihtc.js. PRIMARY source site-wide for the Opportunity Finder, Colorado Deep Dive, Historical Trends, CHFA Portfolio, landing page, and PMA market-analysis tool via window.HudLihtc.load().',
      tags: ['chfa', 'lihtc', 'colorado'],
      apiEndpoint: 'https://services3.arcgis.com/gSW3qyxbcpEXSMfe/arcgis/rest/services/HousingTaxCreditProperties_view/FeatureServer/0'
    },
    {
      id: 'lihtc-trends-county',
      name: 'LIHTC Trends by County',
      category: 'LIHTC / Housing',
      format: 'JSON',
      provider: 'HUD / Internal',
      url: null,
      localFile: 'data/lihtc-trends-by-county.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 365,
      geoUnit: 'County',
      coverage: 'Colorado — 64 counties',
      features: 64,
      description: 'Annual LIHTC unit production trends aggregated by county (2010–2024).',
      tags: ['lihtc', 'county', 'trends'],
      apiEndpoint: null
    },
    {
      id: 'co-historical-allocations',
      name: 'Colorado LIHTC Historical Allocations',
      category: 'LIHTC / Housing',
      format: 'JSON',
      provider: 'HUD / IRS / CHFA / Novogradac',
      url: 'https://lihtc.huduser.gov/',
      localFile: 'data/co-historical-allocations.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 365,
      geoUnit: 'State',
      coverage: 'Colorado statewide',
      features: 38,
      description: 'Colorado LIHTC allocation history 1988–2025: annual project counts, low-income units, IRS per-capita floor, and state allocation authority. See docs/LIHTC_HISTORICAL_METHODOLOGY.md.',
      tags: ['lihtc', 'historical', 'allocation', 'colorado', 'irs', 'chfa'],
      apiEndpoint: null
    },
    // ── QCT / DDA ────────────────────────────────────────────────
    {
      id: 'qct-colorado',
      name: 'Qualified Census Tracts (QCT) CO',
      category: 'QCT / DDA',
      format: 'JSON',
      provider: 'HUD ArcGIS',
      url: 'https://hudgis-hud.opendata.arcgis.com/',
      localFile: 'data/qct-colorado.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 365,
      geoUnit: 'Census Tract',
      coverage: 'Colorado statewide',
      features: 224,
      description: 'HUD Qualified Census Tract designations for Colorado. Used for LIHTC boost calculations.',
      tags: ['qct', 'census-tract', 'hud'],
      apiEndpoint: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Qualified_Census_Tracts_2026/FeatureServer/0'
    },
    {
      id: 'dda-colorado',
      name: 'Difficult Development Areas (DDA) CO',
      category: 'QCT / DDA',
      format: 'JSON',
      provider: 'HUD ArcGIS',
      url: 'https://hudgis-hud.opendata.arcgis.com/',
      localFile: 'data/dda-colorado.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 365,
      geoUnit: 'HUD Metro/Non-Metro',
      coverage: 'Colorado statewide',
      features: 10,
      description: 'HUD Difficult Development Area designations. Enables 130% basis boost for LIHTC projects.',
      tags: ['dda', 'hud', 'basis-boost'],
      apiEndpoint: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Difficult_Development_Areas_2026/FeatureServer/0'
    },
    // ── Policy ───────────────────────────────────────────────────
    {
      id: 'prop123-jurisdictions',
      name: 'Prop 123 Jurisdictions',
      category: 'Policy',
      format: 'JSON',
      provider: 'DOLA / Internal',
      url: 'https://cdola.colorado.gov/prop123',
      localFile: 'data/policy/prop123_jurisdictions.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'As-filed',
      maxAgeDays: 180,
      geoUnit: 'Municipality / County',
      coverage: 'Colorado — committed jurisdictions',
      features: 217,
      description: 'Local government Proposition 123 affordable housing commitment filings with DOLA. 217 jurisdictions committed, projecting 22,988 new affordable units by end of 2026.',
      tags: ['prop123', 'policy', 'dola'],
      apiEndpoint: null
    },
    // ── Economic ─────────────────────────────────────────────────
    {
      id: 'fred-data',
      name: 'FRED Economic Series',
      category: 'Economic',
      format: 'JSON',
      provider: 'St. Louis Fed (FRED)',
      url: 'https://fred.stlouisfed.org/',
      localFile: 'data/fred-data.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Daily',
      maxAgeDays: 35,
      geoUnit: 'State / National',
      coverage: 'Colorado + National',
      features: 62,
      description: '62 FRED economic series: CPI, unemployment, wage indices, housing starts, mortgage rates, and construction inputs.',
      tags: ['fred', 'economic', 'cpi', 'unemployment'],
      apiEndpoint: 'https://api.stlouisfed.org/fred/series/observations',
      alternatives: [
        { title: 'FRED Website', description: 'Browse and download any economic series from the St. Louis Fed', url: 'https://fred.stlouisfed.org/' },
        { title: 'BLS Data Tools', description: 'Bureau of Labor Statistics direct data access', url: 'https://www.bls.gov/data/' },
        { title: 'FRED API Docs', description: 'Full API documentation for custom series queries', url: 'https://fred.stlouisfed.org/docs/api/fred/' }
      ]
    },
    {
      id: 'economic-indicators',
      name: 'Colorado Economic Indicators',
      category: 'Economic',
      format: 'JSON',
      provider: 'BLS / FRED / Internal',
      url: null,
      localFile: null,
      lastUpdated: null,
      updateFrequency: 'Not available',
      maxAgeDays: 45,
      geoUnit: 'State / County',
      coverage: 'Unavailable — no committed local snapshot',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'No committed local snapshot is present, so no record count is available.',
      description: 'Planned consolidated Colorado economic indicators. No committed local snapshot is present, so this inventory entry has no record count.',
      tags: ['economic', 'employment', 'wages'],
      apiEndpoint: null
    },
    // F208 — Article pipeline outputs (county-level cost indicators +
    // ElasticNetCV driver ranking). Powers article-co-housing-costs.html
    // and (via build_article_indicator_geojson.mjs) the choropleth layers
    // on data-map-browser.html.
    {
      id: 'co-housing-costs-indicators',
      name: 'CO County Housing-Cost Indicators (article pipeline)',
      category: 'Economic',
      format: 'CSV + GeoJSON',
      provider: 'ACS / FHFA / BLS QCEW / Census BPS',
      url: null,
      localFile: 'assets/co-housing-costs/snapshots/acs_county_latest.csv',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Monthly',
      maxAgeDays: 45,
      geoUnit: 'County',
      coverage: 'Colorado — 64 counties',
      features: 64,
      description: 'County-level housing cost indicators (median gross rent, vacancy rate, rent burden ≥30%, median household income) joined with TIGER boundaries for choropleth rendering. Source CSV regenerated monthly by scripts/build_co_housing_costs_insight.py; the joined GeoJSON (data/processed/co_county_housing_indicators.geojson) is regenerated by scripts/build_article_indicator_geojson.mjs and surfaces as toggleable layers on data-map-browser.html.',
      tags: ['acs', 'fhfa', 'qcew', 'permits', 'choropleth', 'article'],
      apiEndpoint: null,
      alternatives: [
        { title: 'Article page', description: 'Interactive analysis with 8 county maps + driver ranking table', url: 'article-co-housing-costs.html' },
        { title: 'Joined GeoJSON', description: 'County boundaries + indicators ready for choropleth rendering', url: 'data/processed/co_county_housing_indicators.geojson' },
        { title: 'ElasticNetCV driver ranking', description: 'Standardized coefficients ranking the strongest HPI drivers', url: 'assets/co-housing-costs/snapshots/drivers_ranking.csv' },
      ]
    },
    {
      id: 'construction-commodities',
      name: 'Construction Commodity Prices',
      category: 'Economic',
      format: 'JSON',
      provider: 'BLS PPI / FRED',
      url: 'https://www.bls.gov/ppi/',
      localFile: null,
      lastUpdated: null,
      updateFrequency: 'Not available',
      maxAgeDays: 45,
      geoUnit: 'National',
      coverage: 'Unavailable — no committed local snapshot',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'No committed local snapshot is present, so no record count is available.',
      description: 'Planned construction-material price series. No committed local snapshot is present, so this inventory entry has no record count.',
      tags: ['ppi', 'construction', 'materials', 'bls'],
      apiEndpoint: 'https://api.bls.gov/publicAPI/v2/timeseries/data/'
    },
    // ── Demographics ─────────────────────────────────────────────
    {
      id: 'acs-state',
      name: 'ACS State Demographics',
      category: 'Demographics',
      format: 'JSON',
      provider: 'Census Bureau ACS',
      url: 'https://api.census.gov/',
      localFile: 'data/census-acs-state.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'State',
      coverage: 'United States states and areas (Colorado included)',
      features: 52,
      description: 'ACS 5-year state and area records for housing units, tenure, income, and age demographics; Colorado is one of 52 records.',
      tags: ['acs', 'census', 'demographics'],
      apiEndpoint: 'https://api.census.gov/data/2024/acs/acs5',
      alternatives: [
        { title: 'Census Bureau Data Explorer', description: 'Interactive census data tables', url: 'https://data.census.gov/' },
        { title: 'IPUMS USA', description: 'Integrated Public Use Microdata Series from University of Minnesota', url: 'https://usa.ipums.org/usa/' }
      ]
    },
    {
      id: 'co-demographics',
      name: 'Colorado State Demographics',
      category: 'Demographics',
      format: 'JSON',
      provider: 'Census Bureau ACS',
      url: 'https://api.census.gov/',
      localFile: 'data/co-demographics.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'State',
      coverage: 'Colorado statewide summary',
      features: 1,
      description: 'One Colorado statewide ACS 5-year demographic summary record.',
      tags: ['acs', 'county', 'demographics'],
      apiEndpoint: 'https://api.census.gov/data/2024/acs/acs5',
      alternatives: [
        { title: 'DOLA State Demography Office', description: 'Colorado-specific demographic data and projections', url: 'https://demography.dola.colorado.gov/' },
        { title: 'Census Bureau Quick Facts', description: 'Easy access to county-level census data', url: 'https://www.census.gov/quickfacts/CO' }
      ]
    },
    {
      id: 'acs-tract-metrics',
      name: 'ACS Tract-Level Metrics',
      category: 'Demographics',
      format: 'JSON',
      provider: 'Census Bureau ACS',
      url: 'https://api.census.gov/',
      localFile: 'data/market/acs_tract_metrics_co.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Census Tract',
      coverage: 'Colorado — 1,447 tracts',
      features: 1447,
      description: 'Census tract-level ACS metrics: income, rent burden, housing units, tenure for Colorado.',
      tags: ['acs', 'tract', 'income', 'rent-burden'],
      apiEndpoint: 'https://api.census.gov/data/2024/acs/acs5',
      alternatives: [
        { title: 'Census Bureau API', description: 'Direct 5-year ACS estimates via Census API', url: 'https://api.census.gov/data/2024/acs/acs5' },
        { title: 'PolicyMap', description: 'Tract-level demographic and housing data explorer', url: 'https://www.policymap.com/' },
        { title: 'NHGIS', description: 'National Historical GIS tract-level data with boundaries', url: 'https://www.nhgis.org/' }
      ]
    },
    {
      id: 'dola-sya',
      name: 'DOLA Single Year of Age Projections',
      category: 'Demographics',
      format: 'JSON',
      provider: 'DOLA',
      url: 'https://demography.dola.colorado.gov/',
      localFile: 'data/hna/dola_sya/',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Biennial',
      maxAgeDays: 730,
      geoUnit: 'County',
      coverage: 'Colorado — 64 counties',
      features: 64,
      description: 'DOLA single-year-of-age population projections by county through 2050. pyramidYear=2024.',
      tags: ['dola', 'projections', 'age', 'county'],
      apiEndpoint: null
    },
    // ── Market ───────────────────────────────────────────────────
    {
      id: 'tract-centroids-co',
      name: 'Colorado Tract Centroids',
      category: 'Market / GIS',
      format: 'JSON',
      provider: 'Census TIGER / Internal',
      url: null,
      localFile: 'data/market/tract_centroids_co.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Decennial',
      maxAgeDays: 3650,
      geoUnit: 'Census Tract',
      coverage: 'Colorado — 1,447 tracts',
      features: 1447,
      description: 'Lat/lon centroids for all Colorado census tracts. Used for map clustering and distance calculations.',
      tags: ['census', 'tract', 'centroids', 'gis'],
      apiEndpoint: null
    },
    {
      id: 'lodes-co',
      name: 'LODES Origin-Destination Data CO',
      category: 'Market / GIS',
      format: 'JSON',
      provider: 'Census LEHD',
      url: 'https://lehd.ces.census.gov/',
      localFile: 'data/market/lodes_co.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Census Tract',
      coverage: 'Colorado statewide',
      features: 1447,
      description: 'LEHD Origin-Destination Employment Statistics for Colorado. Used for commute pattern analysis and PMA employment scoring.',
      tags: ['lodes', 'commute', 'employment', 'gis'],
      apiEndpoint: 'https://lehd.ces.census.gov/data/',
      alternatives: [
        { title: 'OnTheMap Tool', description: 'Census Bureau interactive LODES visualization', url: 'https://onthemap.ces.census.gov/' }
      ]
    },
    {
      id: 'cde-schools-co',
      name: 'CDE Schools Data CO',
      category: 'Market / GIS',
      format: 'JSON',
      provider: 'Colorado Department of Education',
      url: 'https://www.cde.state.co.us/',
      localFile: null,
      lastUpdated: '2026-09-09',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Point',
      coverage: 'Unavailable — no committed local snapshot',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'The synthetic fixture was deleted, so no committed snapshot and no record count are available. Real data must come from the source linked in alternatives.',
      description: 'Colorado school performance. The synthetic fixture was deleted on 2026-09-09, so there is no committed snapshot and no record count. Excluded from production PMA scoring until a real CDE source is wired in — see alternatives.',
      tags: ['cde', 'schools', 'education', 'market-analysis'],
      apiEndpoint: null,
      alternatives: [
        { title: 'CDE School Performance Frameworks', description: 'Colorado school performance data from CDE', url: 'https://ed.cde.state.co.us/accountability/performanceframeworks' }
      ]
    },
    {
      id: 'cdle-job-postings-co',
      name: 'CDLE Job Postings CO',
      category: 'Market / GIS',
      format: 'JSON',
      provider: 'Colorado Department of Labor & Employment',
      url: 'https://www.colmigateway.com/',
      localFile: null,
      lastUpdated: '2026-09-09',
      updateFrequency: 'Quarterly',
      maxAgeDays: 120,
      geoUnit: 'County / Region',
      coverage: 'Unavailable — no committed local snapshot',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'The synthetic fixture was deleted, so no committed snapshot and no record count are available. Real data must come from the source linked in alternatives.',
      description: 'Colorado labor-market indicators. The synthetic fixture was deleted on 2026-09-09, so there is no committed snapshot and no record count. Excluded from production PMA scoring until a real CDLE source is wired in — see alternatives.',
      tags: ['cdle', 'jobs', 'labor-market', 'employment'],
      apiEndpoint: null,
      alternatives: [
        { title: 'CDLE COLMI Gateway', description: 'Colorado Labor Market Information gateway', url: 'https://www.colmigateway.com/' },
        { title: 'BLS Occupational Outlook', description: 'National occupational employment projections', url: 'https://www.bls.gov/emp/' }
      ]
    },
    {
      id: 'cdot-traffic-co',
      name: 'CDOT Traffic Counts CO',
      category: 'Market / GIS',
      format: 'JSON',
      provider: 'Colorado Department of Transportation',
      url: 'https://www.codot.gov/',
      localFile: null,
      lastUpdated: '2026-09-09',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Road Segment',
      coverage: 'Unavailable — no committed local snapshot',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'The synthetic fixture was deleted, so no committed snapshot and no record count are available. Real data must come from the source linked in alternatives.',
      description: 'Colorado traffic counts. The synthetic fixture was deleted on 2026-09-09, so there is no committed snapshot and no record count. Excluded from production PMA scoring until a real CDOT source is wired in — see alternatives.',
      tags: ['cdot', 'traffic', 'transportation', 'gis'],
      apiEndpoint: null,
      alternatives: [
        { title: 'CDOT Data Portal', description: 'Colorado transportation open data', url: 'https://data.cdot.colorado.gov/' }
      ]
    },
    {
      id: 'car-market-report',
      name: 'CAR Market Report',
      category: 'Market',
      format: 'JSON',
      provider: 'Colorado Association of Realtors',
      url: 'https://www.coloradorealtors.com/',
      localFile: 'data/car-market-report-2026-04.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Monthly',
      maxAgeDays: 45,
      geoUnit: 'Metro Area / Statewide',
      coverage: 'Colorado statewide + major metros',
      features: 6,
      description: 'CAR monthly market report with six metro-area records plus a separate statewide summary: median sale price, active listings, days on market, and price/sqft.',
      tags: ['car', 'market', 'sales', 'listings'],
      apiEndpoint: null
    },
    {
      id: 'ami-gap',
      name: 'AMI Gap by County',
      category: 'Affordability',
      format: 'JSON',
      provider: 'HUD',
      url: 'https://www.huduser.gov/portal/datasets/fmr.html',
      localFile: 'data/hud-fmr-income-limits.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'FMR Area / County',
      coverage: 'Colorado statewide',
      features: 64,
      description: 'HUD Fair Market Rents by bedroom size for all 64 Colorado counties (FY2026). Combined with income limits.',
      tags: ['fmr', 'hud', 'rent', 'affordability'],
      apiEndpoint: 'https://www.huduser.gov/hudapi/public/fmr',
      alternatives: [
        { title: 'HUD FMR Dataset', description: 'Annual Fair Market Rents download from HUD User', url: 'https://www.huduser.gov/portal/datasets/fmr.html' },
        { title: 'HUD Income Limits Dataset', description: 'Annual income limits by county from HUD User', url: 'https://www.huduser.gov/portal/datasets/il.html' }
      ]
    },
    {
      id: 'hud-fair-market-rents',
      name: 'HUD Fair Market Rents',
      category: 'Affordability',
      format: 'JSON',
      provider: 'HUD',
      url: 'https://www.huduser.gov/portal/datasets/il.html',
      localFile: 'data/hud-fmr-income-limits.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'County',
      coverage: 'Colorado statewide',
      features: 64,
      description: 'HUD Area Median Income and income limits (30%, 50%, 80% AMI) for all 64 Colorado counties. Combined with FMR data.',
      tags: ['ami', 'income-limits', 'hud'],
      apiEndpoint: 'https://www.huduser.gov/hudapi/public/income'
    },
    // ── Zillow ──────────────────────────────────────────────────
    {
      id: 'hud-income-limits',
      name: 'HUD Income Limits',
      category: 'Affordability',
      format: 'JSON',
      provider: 'HUD',
      url: 'https://www.huduser.gov/portal/datasets/il.html',
      localFile: 'data/hud-fmr-income-limits.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'County',
      coverage: 'Colorado statewide',
      features: 64,
      description: 'HUD Area Median Income and income limits (30%, 50%, 60%, 80% AMI) for Colorado counties.',
      tags: ['ami', 'income-limits', 'hud'],
      apiEndpoint: 'https://www.huduser.gov/hudapi/public/acs'
    },
    // ── Zillow ──────────────────────────────────────────────────
    {
      id: 'zillow-zhvi',
      name: 'Zillow ZHVI — Metro',
      category: 'Market',
      format: 'JSON',
      provider: 'Zillow',
      url: 'https://www.zillow.com/research/data/',
      localFile: 'data/market/zillow_co_metros.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Monthly',
      maxAgeDays: 45,
      geoUnit: 'Metro Area',
      coverage: 'Colorado metros',
      features: 6,
      description: 'Zillow Home Value Index (ZHVI) for Colorado metro areas. Monthly series 2010–present.',
      tags: ['zillow', 'zhvi', 'home-values'],
      apiEndpoint: null
    },
    {
      id: 'zillow-zori',
      name: 'Zillow ZORI — Rent Index',
      category: 'Market',
      format: 'JSON',
      provider: 'Zillow',
      url: 'https://www.zillow.com/research/data/',
      localFile: 'data/market/zillow_co_metros.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Monthly',
      maxAgeDays: 45,
      geoUnit: 'Metro Area',
      coverage: 'Colorado metros',
      features: 6,
      description: 'Zillow Observed Rent Index for Colorado metros. Monthly series measuring market-rate rents.',
      tags: ['zillow', 'zori', 'rent'],
      apiEndpoint: null
    },
    // ── LEHD / Employment ────────────────────────────────────────
    {
      id: 'lehd-wac',
      name: 'LEHD County Employment Cache',
      category: 'Employment',
      format: 'JSON',
      provider: 'Census LEHD',
      url: 'https://lehd.ces.census.gov/',
      localFile: 'data/hna/lehd/',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'County',
      coverage: 'Colorado — 64 counties',
      features: 64,
      description: '64 county employment-cache records containing LEHD WAC (Workplace Area Characteristics) snapshots for 2019–2023.',
      tags: ['lehd', 'employment', 'wac', 'jobs'],
      apiEndpoint: 'https://lehd.ces.census.gov/data/'
    },
    {
      id: 'bls-laus',
      name: 'BLS LAUS County Employment',
      category: 'Employment',
      format: 'JSON',
      provider: 'Bureau of Labor Statistics',
      url: 'https://www.bls.gov/lau/',
      localFile: 'data/co-county-economic-indicators.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Monthly',
      maxAgeDays: 60,
      geoUnit: 'County',
      coverage: 'Colorado — 64 counties',
      features: 64,
      description: 'BLS Local Area Unemployment Statistics — unemployment rate + 5-yr residential employment growth (replaces deprecated BLS QCEW public endpoint).',
      tags: ['bls', 'laus', 'employment', 'unemployment'],
      apiEndpoint: 'https://api.bls.gov/publicAPI/v2/timeseries/data/'
    },
    // ── GIS / Boundaries ─────────────────────────────────────────
    {
      id: 'tiger-counties-co',
      name: 'TIGER County Boundaries CO',
      category: 'GIS / Boundaries',
      format: 'GeoJSON',
      provider: 'Census TIGER',
      url: 'https://tigerweb.geo.census.gov/',
      localFile: 'data/boundaries/counties_co.geojson',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Decennial',
      maxAgeDays: 3650,
      geoUnit: 'County',
      coverage: 'Colorado — 64 counties',
      features: 64,
      description: 'Census TIGER county boundary polygons for Colorado. EPSG:4326.',
      tags: ['tiger', 'county', 'boundaries', 'gis'],
      apiEndpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1',
      alternatives: [
        { title: 'Colorado Geospatial Portal', description: 'County boundaries from DOLA/CO GIS', url: 'https://geodata.colorado.gov/' },
        { title: 'Census Bureau TIGER Download', description: 'Direct shapefile download from Census', url: 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html' }
      ]
    },
    {
      id: 'counties-co-geojson',
      name: 'Colorado County Boundaries (Local)',
      category: 'GIS / Boundaries',
      format: 'GeoJSON',
      provider: 'Census TIGER / Internal',
      url: null,
      localFile: 'data/boundaries/counties_co.geojson',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Decennial',
      maxAgeDays: 3650,
      geoUnit: 'County',
      coverage: 'Colorado — 64 counties',
      features: 64,
      description: 'Local cached GeoJSON of Colorado county boundaries used for choropleth overlays.',
      tags: ['county', 'boundaries', 'gis', 'local'],
      apiEndpoint: null
    },
    {
      id: 'tiger-places-co',
      name: 'TIGER Places (Municipalities) CO',
      category: 'GIS / Boundaries',
      format: 'GeoJSON (runtime)',
      provider: 'Census TIGER',
      url: 'https://tigerweb.geo.census.gov/',
      localFile: null,
      lastUpdated: '2024-01-01',
      updateFrequency: 'Decennial',
      maxAgeDays: 3650,
      geoUnit: 'Incorporated Place',
      coverage: 'Colorado statewide (runtime query)',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'Fetched at runtime; no committed response is available for a stable record count.',
      description: 'Census TIGER incorporated places for Colorado, fetched at runtime for the Prop 123 overlay. No committed response is available for a stable record count.',
      tags: ['tiger', 'places', 'municipalities', 'gis'],
      apiEndpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4',
      alternatives: [
        { title: 'Colorado Municipal League', description: 'Directory of Colorado municipalities', url: 'https://www.cml.org/' }
      ]
    },
    // ── GIS / Amenities ──────────────────────────────────────────
    {
      id: 'amenities-retail-nodes',
      name: 'Retail Nodes CO',
      category: 'GIS / Amenities',
      format: 'GeoJSON',
      provider: 'Internal / OSM',
      url: null,
      localFile: 'data/amenities/retail_nodes_co.geojson',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Point',
      coverage: 'Colorado statewide',
      features: 10017,
      description: 'Retail node locations in Colorado for PMA amenity scoring. Derived from OpenStreetMap.',
      tags: ['amenities', 'retail', 'pma', 'gis'],
      apiEndpoint: null,
      alternatives: [
        { title: 'OpenStreetMap Overpass API', description: 'Live query retail POIs from OSM', url: 'https://overpass-turbo.eu/' }
      ]
    },
    {
      id: 'amenities-schools-co',
      name: 'Schools CO',
      category: 'GIS / Amenities',
      format: 'GeoJSON',
      provider: 'CDE / Internal',
      url: 'https://www.cde.state.co.us/',
      localFile: 'data/amenities/schools_co.geojson',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Point',
      coverage: 'Colorado statewide',
      features: 2944,
      description: 'Colorado public school locations from CDE for PMA amenity scoring.',
      tags: ['amenities', 'schools', 'cde', 'gis'],
      apiEndpoint: null,
      alternatives: [
        { title: 'CDE Education Directories', description: 'Colorado Department of Education school locator', url: 'https://www.cde.state.co.us/cdegen/educationdirectory' },
        { title: 'NCES School Finder', description: 'National Center for Education Statistics', url: 'https://nces.ed.gov/globallocator/' }
      ]
    },
    {
      id: 'amenities-grocery-co',
      name: 'Grocery Stores CO',
      category: 'GIS / Amenities',
      format: 'GeoJSON',
      provider: 'Internal / OSM',
      url: null,
      localFile: 'data/amenities/grocery_co.geojson',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Point',
      coverage: 'Colorado statewide',
      features: 2440,
      description: 'Grocery store locations in Colorado for PMA food-access scoring. Derived from OpenStreetMap.',
      tags: ['amenities', 'grocery', 'food-access', 'gis'],
      apiEndpoint: null,
      alternatives: [
        { title: 'USDA Food Access Research Atlas', description: 'USDA food desert and grocery access data', url: 'https://www.ers.usda.gov/data-products/food-access-research-atlas/' }
      ]
    },
    {
      id: 'amenities-healthcare-co',
      name: 'Healthcare Facilities CO',
      category: 'GIS / Amenities',
      format: 'GeoJSON',
      provider: 'Internal / HCAD',
      url: null,
      localFile: 'data/amenities/healthcare_co.geojson',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Point',
      coverage: 'Colorado statewide',
      features: 3075,
      description: 'Hospitals, clinics, and healthcare facility locations in Colorado for PMA health-access scoring.',
      tags: ['amenities', 'healthcare', 'hospitals', 'gis'],
      apiEndpoint: null,
      alternatives: [
        { title: 'HIFLD Healthcare Facilities', description: 'DHS Homeland Infrastructure Foundation-Level Data', url: 'https://hifld-geoplatform.opendata.arcgis.com/datasets/hospitals/' }
      ]
    },
    // ── NHPD ─────────────────────────────────────────────────────
    {
      id: 'nhpd-co',
      name: 'NHPD Preservation Tracking CO',
      category: 'LIHTC / Housing',
      format: 'GeoJSON',
      provider: 'National Housing Preservation Database',
      url: 'https://preservationdatabase.org/',
      localFile: 'data/market/nhpd_co.geojson',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Semi-annual',
      maxAgeDays: 180,
      geoUnit: 'Project',
      coverage: 'Colorado statewide',
      features: 20,
      description: 'NHPD federally-assisted housing inventory for Colorado: project-level subsidy status, expiration dates, affordability risk.',
      tags: ['nhpd', 'preservation', 'affordable-housing', 'gis'],
      apiEndpoint: null,
      alternatives: [
        { title: 'NHPD Public API', description: 'National Housing Preservation Database API', url: 'https://nhpd.preservationdatabase.org/' },
        { title: 'HUD Multifamily Housing', description: 'HUD Section 8 and assisted housing inventory', url: 'https://www.hud.gov/program_offices/housing/mfh/exp/mfhdiscl' }
      ]
    },
    // ── Projections ──────────────────────────────────────────────
    {
      id: 'hna-projections',
      name: 'HNA Housing Demand Projections',
      category: 'Projections',
      format: 'JSON',
      provider: 'Internal / DOLA',
      url: null,
      localFile: 'data/hna/projections/',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'County / Municipality',
      coverage: 'Colorado statewide',
      features: 64,
      description: 'Housing demand projections by scenario (baseline/high/low growth) for Colorado counties. baseYear=2024.',
      tags: ['projections', 'demand', 'hna'],
      apiEndpoint: null
    },
    {
      id: 'projection-scenarios',
      name: 'Projection Scenarios Config',
      category: 'Projections',
      format: 'JSON',
      provider: 'Internal',
      url: null,
      localFile: 'scripts/hna/projection_scenarios.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'As-needed',
      maxAgeDays: 730,
      geoUnit: 'N/A',
      coverage: 'Colorado statewide',
      features: 3,
      description: 'Scenario definitions (baseline, high growth, low growth) for demographic projections.',
      tags: ['scenarios', 'projections'],
      apiEndpoint: null
    },
    // ── Municipal ────────────────────────────────────────────────
    {
      id: 'municipal-config',
      name: 'Municipal Analysis Config',
      category: 'Municipal',
      format: 'JSON',
      provider: 'Internal / Census',
      url: null,
      localFile: null,
      lastUpdated: null,
      updateFrequency: 'Not available',
      maxAgeDays: 400,
      geoUnit: 'Municipality',
      coverage: 'Unavailable — no committed local snapshot',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'No committed local snapshot is present, so no record count is available.',
      description: 'Planned municipal analysis configuration. No committed local snapshot is present, so this inventory entry has no record count.',
      tags: ['municipal', 'fips', 'hna'],
      apiEndpoint: null
    },
    {
      id: 'municipal-growth-rates',
      name: 'Municipal Growth Rates',
      category: 'Municipal',
      format: 'JSON',
      provider: 'Internal / DOLA',
      url: null,
      localFile: null,
      lastUpdated: null,
      updateFrequency: 'Not available',
      maxAgeDays: 400,
      geoUnit: 'Municipality',
      coverage: 'Unavailable — no committed local snapshot',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'No committed local snapshot is present, so no record count is available.',
      description: 'Planned municipal growth-rate data. No committed local snapshot is present, so this inventory entry has no record count.',
      tags: ['municipal', 'growth', 'projections'],
      apiEndpoint: null
    },
    // ── Market Analysis ─────────────────────────────────────────
    {
      id: 'market-reference-projects',
      name: 'Market Reference Projects',
      category: 'Market Analysis',
      format: 'JSON',
      provider: 'Internal',
      url: null,
      localFile: 'data/market/reference-projects.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Quarterly',
      maxAgeDays: 120,
      geoUnit: 'Project',
      coverage: 'Colorado statewide',
      features: 50,
      description: '50 Colorado LIHTC benchmark projects for PMA comparable analysis.',
      tags: ['market-analysis', 'benchmarks', 'lihtc'],
      apiEndpoint: null
    },
    // ── HNA Data ─────────────────────────────────────────────────
    {
      id: 'hna-county-profiles',
      name: 'HNA County Profiles',
      category: 'HNA Data',
      format: 'JSON',
      provider: 'Census ACS / Internal',
      url: null,
      localFile: 'data/hna/summary/',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'County',
      coverage: 'Colorado — 64 counties',
      features: 64,
      description: 'County-level Housing Needs Assessment profiles including demographic, economic, and housing metrics.',
      tags: ['hna', 'county', 'demographics'],
      apiEndpoint: null
    },
    // ── FRED Sub-series ──────────────────────────────────────────
    {
      id: 'fred-cpi',
      name: 'FRED — CPI (CPIAUCSL)',
      category: 'Economic',
      format: 'JSON (embedded)',
      provider: 'Federal Reserve',
      url: 'https://fred.stlouisfed.org/series/CPIAUCSL',
      localFile: 'data/fred-data.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Monthly',
      maxAgeDays: 35,
      geoUnit: 'National',
      coverage: 'National',
      features: 150,
      description: 'Consumer Price Index for All Urban Consumers. Monthly series from 2014.',
      tags: ['fred', 'cpi', 'inflation'],
      apiEndpoint: 'https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL'
    },
    {
      id: 'fred-housing-cpi',
      name: 'FRED — Housing CPI (CUUR0000SAH1)',
      category: 'Economic',
      format: 'JSON (embedded)',
      provider: 'Federal Reserve',
      url: 'https://fred.stlouisfed.org/series/CUUR0000SAH1',
      localFile: 'data/fred-data.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Monthly',
      maxAgeDays: 35,
      geoUnit: 'National',
      coverage: 'National',
      features: 150,
      description: 'CPI for Shelter component — tracks housing cost inflation nationally.',
      tags: ['fred', 'cpi', 'housing', 'shelter'],
      apiEndpoint: 'https://api.stlouisfed.org/fred/series/observations?series_id=CUUR0000SAH1'
    },
    {
      id: 'fred-unrate',
      name: 'FRED — Unemployment Rate (UNRATE)',
      category: 'Economic',
      format: 'JSON (embedded)',
      provider: 'Federal Reserve',
      url: 'https://fred.stlouisfed.org/series/UNRATE',
      localFile: 'data/fred-data.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Monthly',
      maxAgeDays: 35,
      geoUnit: 'National',
      coverage: 'National',
      features: 151,
      description: 'National unemployment rate from BLS via FRED.',
      tags: ['fred', 'unemployment', 'labor'],
      apiEndpoint: 'https://api.stlouisfed.org/fred/series/observations?series_id=UNRATE'
    },
    {
      id: 'fred-mortgage30',
      name: 'FRED — 30-yr Mortgage Rate (MORTGAGE30US)',
      category: 'Economic',
      format: 'JSON (embedded)',
      provider: 'Federal Reserve / Freddie Mac',
      url: 'https://fred.stlouisfed.org/series/MORTGAGE30US',
      localFile: 'data/fred-data.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Weekly',
      maxAgeDays: 14,
      geoUnit: 'National',
      coverage: 'National',
      features: 662,
      description: '30-year fixed mortgage rate from Freddie Mac Primary Mortgage Market Survey via FRED.',
      tags: ['fred', 'mortgage', 'interest-rate'],
      apiEndpoint: 'https://api.stlouisfed.org/fred/series/observations?series_id=MORTGAGE30US'
    },
    {
      id: 'fred-co-housing-permits',
      name: 'FRED — CO Housing Permits (COBPPRIV)',
      category: 'Economic',
      format: 'JSON (embedded)',
      provider: 'Federal Reserve / Census',
      url: 'https://fred.stlouisfed.org/series/COBPPRIV',
      localFile: 'data/fred-data.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Monthly',
      maxAgeDays: 45,
      geoUnit: 'State',
      coverage: 'Colorado',
      features: 151,
      description: 'Colorado total private housing units authorized by building permits.',
      tags: ['fred', 'permits', 'housing-supply'],
      apiEndpoint: 'https://api.stlouisfed.org/fred/series/observations?series_id=COBPPRIV'
    },
    // ── CRA ─────────────────────────────────────────────────────
    {
      id: 'cra-expansion',
      name: 'CRA Expansion Analysis Data',
      category: 'CRA',
      format: 'JSON',
      provider: 'FFIEC / Internal',
      url: null,
      localFile: null,
      lastUpdated: null,
      updateFrequency: 'Not available',
      maxAgeDays: 400,
      geoUnit: 'Census Tract',
      coverage: 'Unavailable — no committed local snapshot',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'No committed local snapshot is present, so no record count is available.',
      description: 'Planned CRA assessment-area analysis. No committed local snapshot is present, so this inventory entry has no record count.',
      tags: ['cra', 'lmi', 'community-development'],
      apiEndpoint: null
    },
    // ── Kalshi / Market Intelligence ────────────────────────────
    {
      id: 'kalshi-housing',
      name: 'Prediction-Market Housing Seed',
      category: 'Market Intelligence',
      format: 'JSON',
      provider: 'Kalshi',
      url: 'https://kalshi.com/',
      localFile: 'data/kalshi/prediction-market.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Daily',
      maxAgeDays: 7,
      geoUnit: 'National / Metro',
      coverage: 'National',
      features: 4,
      description: 'Four illustrative seed prediction-market items for housing indicators. This committed file is not a live Kalshi market feed.',
      tags: ['kalshi', 'prediction-markets', 'housing'],
      apiEndpoint: 'https://api.kalshi.com/trade-api/v2/markets'
    },
    // ── Compliance ──────────────────────────────────────────────
    {
      id: 'compliance-dashboard-data',
      name: 'Compliance Dashboard Metrics',
      category: 'Compliance',
      format: 'JSON',
      provider: 'CHFA / Internal',
      url: null,
      localFile: null,
      lastUpdated: null,
      updateFrequency: 'Not available',
      maxAgeDays: 120,
      geoUnit: 'Project / Statewide',
      coverage: 'Unavailable — no committed local snapshot',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'No committed local snapshot is present, so no record count is available.',
      description: 'Planned LIHTC compliance metrics. No committed local snapshot is present, so this inventory entry has no record count.',
      tags: ['compliance', 'lihtc', 'chfa'],
      apiEndpoint: null
    },
    // ── Manifest ─────────────────────────────────────────────────
    {
      id: 'data-manifest',
      name: 'Data Manifest',
      category: 'System',
      format: 'JSON',
      provider: 'Internal (Generated)',
      url: null,
      localFile: 'data/manifest.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'On deploy',
      maxAgeDays: 30,
      geoUnit: 'N/A',
      coverage: 'All data files',
      features: 1607,
      description: 'Auto-generated manifest listing all data files with feature counts and timestamps.',
      tags: ['manifest', 'system', 'metadata'],
      apiEndpoint: null
    },
    // ── Housing Legislation ──────────────────────────────────────
    {
      id: 'housing-legislation-2026',
      name: 'Tax Credit Legislation Watchlist',
      category: 'Policy',
      format: 'JSON',
      provider: 'Colorado Legislature / Internal',
      url: 'https://leg.colorado.gov/',
      localFile: 'data/policy/tax-credit-legislation.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Session-based',
      maxAgeDays: 180,
      geoUnit: 'Statewide',
      coverage: 'Federal and Colorado tax-credit policy watchlist',
      features: 15,
      description: '15 tax-credit legislation watchlist entries with status, source, and verification metadata.',
      tags: ['legislation', 'policy', 'colorado'],
      apiEndpoint: null
    },
    // ── Regional ────────────────────────────────────────────────
    {
      id: 'regional-overview',
      name: 'Regional Overview Data',
      category: 'Regional',
      format: 'JSON',
      provider: 'ACS / BLS / Internal',
      url: null,
      localFile: null,
      lastUpdated: null,
      updateFrequency: 'Not available',
      maxAgeDays: 400,
      geoUnit: 'Region / Metro',
      coverage: 'Unavailable — no committed local snapshot',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'No committed local snapshot is present, so no record count is available.',
      description: 'Planned regional overview data. No committed local snapshot is present, so this inventory entry has no record count.',
      tags: ['regional', 'metro', 'overview'],
      apiEndpoint: null
    },
    // ── State Allocation ─────────────────────────────────────────
    {
      id: 'state-allocation-map',
      name: 'State LIHTC Allocation Map',
      category: 'LIHTC / Housing',
      format: 'JSON',
      provider: 'CHFA / HFA',
      url: null,
      localFile: null,
      lastUpdated: null,
      updateFrequency: 'Not available',
      maxAgeDays: 365,
      geoUnit: 'Project',
      coverage: 'Unavailable — no committed local snapshot',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'No committed local snapshot is present, so no record count is available.',
      description: 'Planned state LIHTC allocation map. No committed local snapshot is present, so this inventory entry has no record count.',
      tags: ['chfa', 'allocation', 'lihtc'],
      apiEndpoint: null
    },
    // ── Zillow County ────────────────────────────────────────────
    {
      id: 'zillow-county-values',
      name: 'Zillow ZHVI — County Level',
      category: 'Market',
      format: 'JSON',
      provider: 'Zillow',
      url: 'https://www.zillow.com/research/data/',
      localFile: null,
      lastUpdated: null,
      updateFrequency: 'Not available',
      maxAgeDays: 45,
      geoUnit: 'County',
      coverage: 'Unavailable — no committed local snapshot',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'No committed county-level Zillow snapshot is present, so no record count is available.',
      description: 'Planned county-level Zillow Home Value Index data. No committed county-level snapshot is present, so this inventory entry has no record count.',
      tags: ['zillow', 'zhvi', 'county', 'home-values'],
      apiEndpoint: null
    },

    // ── FEMA Flood Zones ─────────────────────────────────────────
    {
      id: 'fema-flood-co',
      name: 'FEMA National Flood Hazard Layer (NFHL) — Colorado',
      category: 'Risk / Environmental',
      format: 'GeoJSON',
      provider: 'FEMA',
      url: 'https://msc.fema.gov/portal/home',
      localFile: 'data/market/flood_zones_co.geojson',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Ongoing (FIRM amendments)',
      maxAgeDays: 180,
      geoUnit: 'Parcel / Census tract',
      coverage: 'Colorado statewide',
      features: 12537,
      description: 'FEMA flood zone designations (AE, AH, X) from the National Flood Hazard Layer. Used for site risk scoring and environmental constraint screening.',
      tags: ['fema', 'flood', 'risk', 'environmental', 'gis'],
      apiEndpoint: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer'
    },

    // ── EPA Cleanup / Brownfields ─────────────────────────────────
    {
      id: 'epa-cleanup-co',
      name: 'EPA Cleanup Sites — Colorado',
      category: 'Risk / Environmental',
      format: 'JSON',
      provider: 'EPA',
      url: 'https://www.epa.gov/cleanups/cleanups-my-community',
      localFile: 'data/environmental/epa-superfund-co.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Quarterly',
      maxAgeDays: 120,
      geoUnit: 'Site',
      coverage: 'Colorado statewide',
      features: 1139,
      description: 'Statewide EPA environmental screening file containing 24 SEMS records and 1,115 ACRES brownfield records with usable coordinates.',
      tags: ['epa', 'brownfield', 'cleanup', 'superfund', 'risk', 'environmental'],
      apiEndpoint: 'https://enviro.epa.gov/enviro/ef_metadata_json.ef_get_facility_info'
    },

    // ── EPA Smart Location Database ───────────────────────────────
    {
      id: 'epa-smart-location',
      name: 'EPA Smart Location Database',
      category: 'Transportation / Access',
      format: 'GeoJSON / CSV',
      provider: 'EPA',
      url: 'https://www.epa.gov/smartgrowth/smart-location-mapping',
      localFile: null,
      lastUpdated: null,
      updateFrequency: 'Not available',
      maxAgeDays: 730,
      geoUnit: 'Census block group',
      coverage: 'Unavailable — no committed local snapshot',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'No committed Colorado extract is present, so no record count is available.',
      description: 'Planned EPA Smart Location Database Colorado extract. No committed local snapshot is present, so this inventory entry has no record count.',
      tags: ['epa', 'smart-location', 'walkability', 'transit', 'accessibility', 'block-group'],
      apiEndpoint: null
    },

    // ── OpenStreetMap Amenities ───────────────────────────────────
    {
      id: 'osm-amenities',
      name: 'OpenStreetMap Amenities (Overpass API)',
      category: 'Market / GIS',
      format: 'GeoJSON (live query)',
      provider: 'OpenStreetMap / Overpass API',
      url: 'https://overpass-turbo.eu/',
      localFile: null,
      lastUpdated: null,
      updateFrequency: 'Real-time',
      maxAgeDays: 1,
      geoUnit: 'Point of Interest',
      coverage: 'Worldwide (queried per site)',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'Fetched on demand; no committed response is available for a stable record count.',
      description: 'Live Overpass API queries for nearby amenities (grocery, healthcare, transit stops, parks) within the PMA buffer. No committed response is available for a stable record count.',
      tags: ['osm', 'openstreetmap', 'amenities', 'poi', 'walkability'],
      apiEndpoint: 'https://overpass-api.de/api/interpreter'
    },

    // ── Opportunity Zones (HUD/Treasury) ─────────────────────────
    {
      id: 'hud-opportunity-zones',
      name: 'Opportunity Zones — Colorado',
      category: 'Policy / Tax Incentives',
      format: 'GeoJSON',
      provider: 'CDFI Fund / U.S. Treasury',
      url: 'https://www.cdfifund.gov/opportunity-zones',
      localFile: 'data/market/opportunity_zones_co.geojson',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Static 2018 designation archive; OZ 2.0 designation rounds reviewed quarterly',
      maxAgeDays: 365,
      geoUnit: 'Census tract',
      coverage: 'Colorado — 126 designated OZ tracts',
      features: 126,
      description: 'Federally designated 2018 Opportunity Zone census tracts in Colorado. Used for tax incentive overlay in PMA scoring and site feasibility analysis; OZ 2.0 designation rounds are tracked separately as policy context.',
      tags: ['opportunity-zones', 'oz', 'tax-incentives', 'census-tract', 'hud', 'treasury'],
      apiEndpoint: null
    },

    // ── USGS National Hydrography Dataset ────────────────────────
    {
      id: 'usgs-nhd-co',
      name: 'USGS National Hydrography Dataset (NHD) — Colorado',
      category: 'Risk / Environmental',
      format: 'GeoJSON',
      provider: 'USGS',
      url: 'https://www.usgs.gov/national-hydrography/national-hydrography-dataset',
      localFile: null,
      lastUpdated: null,
      updateFrequency: 'Not available',
      maxAgeDays: 365,
      geoUnit: 'Stream / Water body',
      coverage: 'Unavailable — no committed local snapshot',
      features: null,
      featuresCountable: false,
      featuresUnavailableReason: 'No committed USGS NHD snapshot is present, so no record count is available.',
      description: 'Planned USGS NHD Colorado extract. No committed local snapshot is present, so this inventory entry has no record count.',
      tags: ['usgs', 'nhd', 'hydrology', 'water', 'barriers', 'gis'],
      apiEndpoint: 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer'
    },

    // ── NTD Transit (National Transit Database) ───────────────────
    {
      id: 'ntd-transit-co',
      name: 'NTD Transit Routes &amp; Stops — Colorado',
      category: 'Transportation / Access',
      format: 'GeoJSON / GTFS',
      provider: 'FTA / National Transit Database',
      url: 'https://www.transit.dot.gov/ntd',
      localFile: 'data/amenities/transit_stops_co.geojson',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Annual (NTD) / Real-time (GTFS)',
      maxAgeDays: 180,
      geoUnit: 'Stop / Route',
      coverage: 'Colorado transit agencies (RTD, CDOT, local)',
      features: 7888,
      description: 'Transit stops and routes from NTD/GTFS feeds for Colorado agencies. Used for transit access scoring and PMA commuting-based boundary delineation.',
      tags: ['transit', 'ntd', 'gtfs', 'bus', 'rail', 'transportation'],
      apiEndpoint: 'https://transit.land/api/v2/rest'
    },

    // ── Regrid Parcels API ────────────────────────────────────────
    {
      id: 'regrid-parcels',
      name: 'Parcel &amp; Zoning County Aggregates — Colorado',
      category: 'Market / GIS',
      format: 'JSON',
      provider: 'Loveland / Regrid',
      url: 'https://regrid.com/',
      localFile: 'data/market/parcel_aggregates_co.json',
      lastUpdated: '2026-09-10',
      updateFrequency: 'Quarterly',
      maxAgeDays: 90,
      geoUnit: 'County aggregate',
      coverage: 'Eight Colorado county aggregate records',
      features: 8,
      description: 'Eight county-level parcel and zoning aggregate records. This file does not contain statewide parcel-level records.',
      tags: ['regrid', 'parcels', 'zoning', 'land-use', 'gis'],
      apiEndpoint: 'https://app.regrid.com/api/v2/parcels/point'
    }
  ];

  // ── Public API ───────────────────────────────────────────────────
  window.DataSourceInventory = {

    /** All source definitions with computed status/freshness */
    getSources: function () {
      return SOURCES.map(function (s) {
        return Object.assign({}, s, {
          status: computeStatus(s),
          freshnessScore: freshnessScore(s),
          daysSinceUpdate: daysSince(s.lastUpdated)
        });
      });
    },

    /** Sources grouped by category */
    getByCategory: function () {
      var map = {};
      this.getSources().forEach(function (s) {
        if (!map[s.category]) map[s.category] = [];
        map[s.category].push(s);
      });
      return map;
    },

    /** Summary statistics */
    getStats: function () {
      var sources = this.getSources();
      var counts = { current: 0, aging: 0, stale: 0, unknown: 0 };
      sources.forEach(function (s) { counts[s.status] = (counts[s.status] || 0) + 1; });
      var withScore = sources.filter(function (s) { return s.freshnessScore !== null; });
      var avgFreshness = withScore.length
        ? Math.round(withScore.reduce(function (a, s) { return a + s.freshnessScore; }, 0) / withScore.length)
        : null;
      return {
        total: sources.length,
        counts: counts,
        avgFreshness: avgFreshness,
        categories: Object.keys(this.getByCategory()).length
      };
    },

    /** Sources with API endpoints (checkable) */
    getApiSources: function () {
      return this.getSources().filter(function (s) { return !!s.apiEndpoint; });
    },

    /** Sources due for update within N days */
    getDueSoon: function (days) {
      days = days || 30;
      var now = Date.now();
      return this.getSources().filter(function (s) {
        if (!s.lastUpdated || !s.maxAgeDays) return false;
        var updated = new Date(s.lastUpdated).getTime();
        var nextDue = updated + s.maxAgeDays * MS_PER_DAY;
        return nextDue > now && nextDue <= now + days * MS_PER_DAY;
      }).sort(function (a, b) {
        return new Date(a.lastUpdated).getTime() - new Date(b.lastUpdated).getTime();
      });
    },

    /** Build CSV export string */
    toCSV: function () {
      var sources = this.getSources();
      var headers = ['id', 'name', 'category', 'format', 'provider', 'lastUpdated',
                     'updateFrequency', 'status', 'freshnessScore', 'geoUnit', 'coverage', 'features'];
      var rows = [headers.join(',')];
      sources.forEach(function (s) {
        rows.push(headers.map(function (h) {
          var v = s[h];
          if (v === null || v === undefined) return '';
          return '"' + String(v).replace(/"/g, '""') + '"';
        }).join(','));
      });
      return rows.join('\n');
    }
  };

})();
