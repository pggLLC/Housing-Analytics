// js/data-source-inventory.js
// Complete registry of 54+ data sources used by Housing Analytics.
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

  function computeStatus(source) {
    var days = daysSince(source.lastUpdated);
    if (days === null) return 'unknown';
    var threshold = source.maxAgeDays || 90;
    var aging = Math.floor(threshold * 0.7);
    if (days <= aging) return 'current';
    if (days <= threshold) return 'aging';
    return 'stale';
  }

  function freshnessScore(source) {
    var days = daysSince(source.lastUpdated);
    if (days === null) return null;
    var max = source.maxAgeDays || 90;
    return Math.max(0, Math.round(100 * (1 - days / max)));
  }

  // ── Source Registry (43 sources) ────────────────────────────────
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
      lastUpdated: '2026-04-06',
      updateFrequency: 'Weekly',
      maxAgeDays: 10,
      geoUnit: 'Project',
      coverage: 'Colorado statewide',
      features: 716,
      description: 'HUD-schema LIHTC project GeoJSON for Colorado. Rebuilt weekly from data/chfa-lihtc.json by scripts/normalize-lihtc-to-hud-schema.js — includes all 716 projects with both CHFA and HUD-compatible field names. Primary source for the PMA market-analysis tool via window.HudLihtc.load().',
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
      lastUpdated: '2026-04-06',
      updateFrequency: 'Weekly',
      maxAgeDays: 10,
      geoUnit: 'Project',
      coverage: 'Colorado statewide',
      features: 716,
      description: 'Canonical LIHTC project cache for Colorado (716 features). Fetched weekly from the CHFA ArcGIS FeatureServer by scripts/fetch-chfa-lihtc.js. Primary source for the HNA and LIHTC map pages. window.HudLihtc.load() tries this file first (Tier 1) before any fallback.',
      tags: ['chfa', 'lihtc', 'colorado'],
      apiEndpoint: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer/0'
    },
    {
      id: 'lihtc-trends-county',
      name: 'LIHTC Trends by County',
      category: 'LIHTC / Housing',
      format: 'JSON',
      provider: 'HUD / Internal',
      url: null,
      localFile: 'data/lihtc-trends-by-county.json',
      lastUpdated: '2025-10-01',
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
      lastUpdated: '2026-03-13',
      updateFrequency: 'Annual',
      maxAgeDays: 365,
      geoUnit: 'State',
      coverage: 'Colorado statewide',
      features: 37,
      description: 'Colorado LIHTC allocation history 1988–2024: annual project counts, low-income units, IRS per-capita floor, and state allocation authority. See docs/LIHTC_HISTORICAL_METHODOLOGY.md.',
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
      lastUpdated: '2025-09-01',
      updateFrequency: 'Annual',
      maxAgeDays: 365,
      geoUnit: 'Census Tract',
      coverage: 'Colorado statewide',
      features: 342,
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
      lastUpdated: '2025-09-01',
      updateFrequency: 'Annual',
      maxAgeDays: 365,
      geoUnit: 'HUD Metro/Non-Metro',
      coverage: 'Colorado statewide',
      features: 2902,
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
      lastUpdated: '2026-01-15',
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
      lastUpdated: '2025-12-15',
      updateFrequency: 'Daily',
      maxAgeDays: 35,
      geoUnit: 'State / National',
      coverage: 'Colorado + National',
      features: 30,
      description: '30+ FRED economic series: CPI, unemployment, wage indices, housing starts, mortgage rates (2014–present).',
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
      localFile: 'data/economic-indicators.json',
      lastUpdated: '2025-11-01',
      updateFrequency: 'Monthly',
      maxAgeDays: 45,
      geoUnit: 'State / County',
      coverage: 'Colorado statewide',
      features: 120,
      description: 'Consolidated Colorado economic indicators including employment, wages, and housing metrics.',
      tags: ['economic', 'employment', 'wages'],
      apiEndpoint: null
    },
    {
      id: 'construction-commodities',
      name: 'Construction Commodity Prices',
      category: 'Economic',
      format: 'JSON',
      provider: 'BLS PPI / FRED',
      url: 'https://www.bls.gov/ppi/',
      localFile: 'data/construction-commodities.json',
      lastUpdated: '2025-11-15',
      updateFrequency: 'Monthly',
      maxAgeDays: 45,
      geoUnit: 'National',
      coverage: 'National',
      features: 15,
      description: 'Producer Price Index series for construction materials: lumber, steel, concrete, copper, etc.',
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
      lastUpdated: '2025-10-01',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'State',
      coverage: 'Colorado statewide',
      features: 1,
      description: 'ACS 5-year estimates for Colorado: housing units, tenure, income, age demographics.',
      tags: ['acs', 'census', 'demographics'],
      apiEndpoint: 'https://api.census.gov/data/2023/acs/acs5',
      alternatives: [
        { title: 'Census Bureau Data Explorer', description: 'Interactive census data tables', url: 'https://data.census.gov/' },
        { title: 'IPUMS USA', description: 'Integrated Public Use Microdata Series from University of Minnesota', url: 'https://usa.ipums.org/usa/' }
      ]
    },
    {
      id: 'co-demographics',
      name: 'Colorado County Demographics',
      category: 'Demographics',
      format: 'JSON',
      provider: 'Census Bureau ACS',
      url: 'https://api.census.gov/',
      localFile: 'data/co-demographics.json',
      lastUpdated: '2025-10-01',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'County',
      coverage: 'Colorado — 64 counties',
      features: 64,
      description: 'ACS 5-year county-level demographic estimates for all 64 Colorado counties.',
      tags: ['acs', 'county', 'demographics'],
      apiEndpoint: 'https://api.census.gov/data/2023/acs/acs5',
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
      lastUpdated: '2025-10-01',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Census Tract',
      coverage: 'Colorado — ~1,300 tracts',
      features: 1300,
      description: 'Census tract-level ACS metrics: income, rent burden, housing units, tenure for Colorado.',
      tags: ['acs', 'tract', 'income', 'rent-burden'],
      apiEndpoint: 'https://api.census.gov/data/2023/acs/acs5',
      alternatives: [
        { title: 'Census Bureau API', description: 'Direct 5-year ACS estimates via Census API', url: 'https://api.census.gov/data/2023/acs/acs5' },
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
      localFile: 'data/dola_sya/',
      lastUpdated: '2024-06-01',
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
      lastUpdated: '2024-01-01',
      updateFrequency: 'Decennial',
      maxAgeDays: 3650,
      geoUnit: 'Census Tract',
      coverage: 'Colorado — ~1,300 tracts',
      features: 1300,
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
      lastUpdated: '2024-06-01',
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
      localFile: 'data/market/cde_schools_co.json',
      lastUpdated: '2025-01-01',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Point',
      coverage: 'Colorado statewide',
      features: 30,
      description: 'CDE school performance and location data for Colorado. Used for PMA school quality scoring.',
      tags: ['cde', 'schools', 'education', 'market-analysis'],
      apiEndpoint: null,
      alternatives: [
        { title: 'CDE School Report Cards', description: 'Colorado school performance data from CDE', url: 'https://www.cde.state.co.us/accountability/school-report-cards' }
      ]
    },
    {
      id: 'cdle-job-postings-co',
      name: 'CDLE Job Postings CO',
      category: 'Market / GIS',
      format: 'JSON',
      provider: 'Colorado Department of Labor & Employment',
      url: 'https://www.colmigateway.com/',
      localFile: 'data/market/cdle_job_postings_co.json',
      lastUpdated: '2025-06-01',
      updateFrequency: 'Quarterly',
      maxAgeDays: 120,
      geoUnit: 'County / Region',
      coverage: 'Colorado statewide',
      features: 62,
      description: 'CDLE labor market job postings and employment projections for Colorado. Used for PMA demand-driver analysis.',
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
      localFile: 'data/market/cdot_traffic_co.json',
      lastUpdated: '2024-06-01',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Road Segment',
      coverage: 'Colorado statewide',
      features: 40,
      description: 'CDOT annual average daily traffic (AADT) counts for Colorado road segments. Used for PMA transit and access scoring.',
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
      localFile: 'data/car-market-report-2026-02.json',
      lastUpdated: '2026-02-28',
      updateFrequency: 'Monthly',
      maxAgeDays: 45,
      geoUnit: 'Metro Area / Statewide',
      coverage: 'Colorado statewide + major metros',
      features: 12,
      description: 'CAR monthly market report: median sale price, active listings, days on market, price/sqft.',
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
      lastUpdated: '2025-10-01',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'FMR Area / County',
      coverage: 'Colorado statewide',
      features: 64,
      description: 'HUD Fair Market Rents by bedroom size for all 64 Colorado counties (FY2025). Combined with income limits.',
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
      lastUpdated: '2025-04-01',
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
      localFile: 'data/hud-income-limits.json',
      lastUpdated: '2025-04-01',
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
      localFile: 'data/zillow-zhvi-metro.json',
      lastUpdated: '2025-11-01',
      updateFrequency: 'Monthly',
      maxAgeDays: 45,
      geoUnit: 'Metro Area',
      coverage: 'Colorado metros',
      features: 8,
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
      localFile: 'data/zillow-zori.json',
      lastUpdated: '2025-11-01',
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
      name: 'LEHD WAC Employment Snapshots',
      category: 'Employment',
      format: 'JSON',
      provider: 'Census LEHD',
      url: 'https://lehd.ces.census.gov/',
      localFile: 'data/hna/lehd_wac_snapshots/',
      lastUpdated: '2024-06-01',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Census Tract',
      coverage: 'Colorado statewide',
      features: 5,
      description: 'LEHD WAC (Workplace Area Characteristics) snapshots 2019–2023: jobs by industry and wage band.',
      tags: ['lehd', 'employment', 'wac', 'jobs'],
      apiEndpoint: 'https://lehd.ces.census.gov/data/'
    },
    {
      id: 'bls-qcew',
      name: 'BLS QCEW County Employment',
      category: 'Employment',
      format: 'JSON',
      provider: 'Bureau of Labor Statistics',
      url: 'https://www.bls.gov/cew/',
      localFile: 'data/co-county-economic-indicators.json',
      lastUpdated: '2025-09-01',
      updateFrequency: 'Quarterly',
      maxAgeDays: 120,
      geoUnit: 'County',
      coverage: 'Colorado — 64 counties',
      features: 64,
      description: 'BLS Quarterly Census of Employment and Wages for Colorado counties.',
      tags: ['bls', 'qcew', 'employment', 'wages'],
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
      localFile: 'maps/co-counties.geojson',
      lastUpdated: '2024-01-01',
      updateFrequency: 'Decennial',
      maxAgeDays: 3650,
      geoUnit: 'County',
      coverage: 'Colorado — 64 counties',
      features: 64,
      description: 'Census TIGER county boundary polygons for Colorado. EPSG:4326.',
      tags: ['tiger', 'county', 'boundaries', 'gis'],
      apiEndpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1',
      alternatives: [
        { title: 'Colorado Open Data Portal', description: 'County boundaries from DOLA/CO GIS', url: 'https://data.colorado.gov/dataset/Colorado-County-Boundaries/4kn3-rjsc' },
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
      lastUpdated: '2024-01-01',
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
      coverage: 'Colorado statewide',
      features: 272,
      description: 'Census TIGER incorporated places for Colorado. Fetched at runtime for Prop 123 overlay.',
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
      lastUpdated: '2024-06-01',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Point',
      coverage: 'Colorado statewide',
      features: 13,
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
      lastUpdated: '2025-01-01',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Point',
      coverage: 'Colorado statewide',
      features: 16,
      description: 'Colorado public school locations from CDE for PMA amenity scoring.',
      tags: ['amenities', 'schools', 'cde', 'gis'],
      apiEndpoint: null,
      alternatives: [
        { title: 'CDE School Directory', description: 'Colorado Department of Education school locator', url: 'https://www.cde.state.co.us/schoolsearch/' },
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
      lastUpdated: '2024-06-01',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Point',
      coverage: 'Colorado statewide',
      features: 20,
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
      lastUpdated: '2024-06-01',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Point',
      coverage: 'Colorado statewide',
      features: 12,
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
      lastUpdated: '2025-06-01',
      updateFrequency: 'Semi-annual',
      maxAgeDays: 180,
      geoUnit: 'Project',
      coverage: 'Colorado statewide',
      features: 20,
      description: 'NHPD federally-assisted housing inventory for Colorado: project-level subsidy status, expiration dates, affordability risk.',
      tags: ['nhpd', 'preservation', 'affordable-housing', 'gis'],
      apiEndpoint: null,
      alternatives: [
        { title: 'NHPD Public API', description: 'National Housing Preservation Database API', url: 'https://preservationdatabase.org/data/' },
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
      localFile: 'data/projections/',
      lastUpdated: '2024-12-01',
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
      lastUpdated: '2024-12-01',
      updateFrequency: 'As-needed',
      maxAgeDays: 730,
      geoUnit: 'N/A',
      coverage: 'Colorado statewide',
      features: 3,
      description: 'Scenario definitions (baseline, high-growth, low-growth) for demographic projections.',
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
      localFile: 'data/hna/municipal/municipal-config.json',
      lastUpdated: '2025-01-01',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Municipality',
      coverage: 'Colorado — 32 municipalities',
      features: 32,
      description: '32 Colorado municipalities with 7-digit place FIPS, growth rates, and HNA parameters.',
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
      localFile: 'data/hna/municipal/growth-rates.json',
      lastUpdated: '2025-01-01',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Municipality',
      coverage: 'Colorado — 32 municipalities',
      features: 32,
      description: 'Population growth rate projections for Colorado municipalities based on DOLA data.',
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
      lastUpdated: '2025-06-01',
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
      localFile: 'data/hna/county/',
      lastUpdated: '2025-10-01',
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
      lastUpdated: '2025-11-01',
      updateFrequency: 'Monthly',
      maxAgeDays: 35,
      geoUnit: 'National',
      coverage: 'National',
      features: 130,
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
      lastUpdated: '2025-11-01',
      updateFrequency: 'Monthly',
      maxAgeDays: 35,
      geoUnit: 'National',
      coverage: 'National',
      features: 130,
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
      lastUpdated: '2025-11-01',
      updateFrequency: 'Monthly',
      maxAgeDays: 35,
      geoUnit: 'National',
      coverage: 'National',
      features: 130,
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
      lastUpdated: '2025-11-01',
      updateFrequency: 'Weekly',
      maxAgeDays: 14,
      geoUnit: 'National',
      coverage: 'National',
      features: 600,
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
      lastUpdated: '2025-11-01',
      updateFrequency: 'Monthly',
      maxAgeDays: 45,
      geoUnit: 'State',
      coverage: 'Colorado',
      features: 130,
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
      localFile: 'data/cra-expansion.json',
      lastUpdated: '2025-08-01',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Census Tract',
      coverage: 'Colorado statewide',
      features: 350,
      description: 'CRA assessment area analysis data for Colorado, including LMI tract designations and credit needs.',
      tags: ['cra', 'lmi', 'community-development'],
      apiEndpoint: null
    },
    // ── Kalshi / Market Intelligence ────────────────────────────
    {
      id: 'kalshi-housing',
      name: 'Kalshi Housing Market Contracts',
      category: 'Market Intelligence',
      format: 'JSON',
      provider: 'Kalshi',
      url: 'https://kalshi.com/',
      localFile: 'data/kalshi-housing.json',
      lastUpdated: '2025-12-01',
      updateFrequency: 'Daily',
      maxAgeDays: 7,
      geoUnit: 'National / Metro',
      coverage: 'National',
      features: 20,
      description: 'Kalshi prediction market contracts for housing indicators: home sales, rent changes, permit volumes.',
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
      localFile: 'data/compliance-metrics.json',
      lastUpdated: '2025-09-01',
      updateFrequency: 'Quarterly',
      maxAgeDays: 120,
      geoUnit: 'Project / Statewide',
      coverage: 'Colorado statewide',
      features: 1200,
      description: 'LIHTC compliance monitoring data: annual certifications, audit findings, unit vacancy tracking.',
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
      lastUpdated: '2025-12-01',
      updateFrequency: 'On deploy',
      maxAgeDays: 30,
      geoUnit: 'N/A',
      coverage: 'All data files',
      features: 100,
      description: 'Auto-generated manifest listing all data files with feature counts and timestamps.',
      tags: ['manifest', 'system', 'metadata'],
      apiEndpoint: null
    },
    // ── Housing Legislation ──────────────────────────────────────
    {
      id: 'housing-legislation-2026',
      name: 'Colorado Housing Legislation 2026',
      category: 'Policy',
      format: 'JSON',
      provider: 'Colorado Legislature / Internal',
      url: 'https://leg.colorado.gov/',
      localFile: 'data/policy/housing-legislation-2026.json',
      lastUpdated: '2026-02-01',
      updateFrequency: 'Session-based',
      maxAgeDays: 180,
      geoUnit: 'Statewide',
      coverage: 'Colorado',
      features: 25,
      description: '2026 Colorado legislative session housing bills: HB/SB summaries, status, effective dates.',
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
      localFile: 'data/regional-overview.json',
      lastUpdated: '2025-10-01',
      updateFrequency: 'Annual',
      maxAgeDays: 400,
      geoUnit: 'Region / Metro',
      coverage: 'Colorado regions + metros',
      features: 8,
      description: 'Aggregated regional metrics for Front Range, Mountain, Eastern Plains, and Western Slope regions.',
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
      localFile: 'data/state-allocation-map.json',
      lastUpdated: '2025-12-01',
      updateFrequency: 'Annual',
      maxAgeDays: 365,
      geoUnit: 'Project',
      coverage: 'Colorado statewide',
      features: 150,
      description: 'Colorado Housing Finance Authority annual LIHTC award allocations by project and county.',
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
      localFile: 'data/zillow-county-values.json',
      lastUpdated: '2025-11-01',
      updateFrequency: 'Monthly',
      maxAgeDays: 45,
      geoUnit: 'County',
      coverage: 'Colorado — major counties',
      features: 25,
      description: 'Zillow Home Value Index at county level for Colorado. Monthly series for top-25 counties by population.',
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
      localFile: 'data/market/fema_flood_co.geojson',
      lastUpdated: '2025-10-01',
      updateFrequency: 'Ongoing (FIRM amendments)',
      maxAgeDays: 180,
      geoUnit: 'Parcel / Census tract',
      coverage: 'Colorado statewide',
      features: null,
      description: 'FEMA flood zone designations (AE, AH, X) from the National Flood Hazard Layer. Used for site risk scoring and environmental constraint screening.',
      tags: ['fema', 'flood', 'risk', 'environmental', 'gis'],
      apiEndpoint: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer'
    },

    // ── EPA Cleanup / Brownfields ─────────────────────────────────
    {
      id: 'epa-cleanup-co',
      name: 'EPA Cleanup Sites — Colorado',
      category: 'Risk / Environmental',
      format: 'GeoJSON',
      provider: 'EPA',
      url: 'https://www.epa.gov/cleanups/cleanups-my-community',
      localFile: 'data/market/epa_cleanup_co.geojson',
      lastUpdated: '2025-09-01',
      updateFrequency: 'Quarterly',
      maxAgeDays: 120,
      geoUnit: 'Site',
      coverage: 'Colorado statewide',
      features: null,
      description: 'EPA Superfund, brownfield, and cleanup site locations. Used for environmental constraint screening during site feasibility analysis.',
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
      localFile: 'data/market/epa_smart_location_co.json',
      lastUpdated: '2024-01-01',
      updateFrequency: 'Every 5 years (decennial)',
      maxAgeDays: 730,
      geoUnit: 'Census block group',
      coverage: 'Nationwide (Colorado extract)',
      features: null,
      description: 'EPA Smart Location Database block-group metrics: transit proximity, walkability, D-scores, auto accessibility. Used for PMA transit and opportunity scoring.',
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
      description: 'Live Overpass API queries for nearby amenities (grocery, healthcare, transit stops, parks) within the PMA buffer. Used for neighborhood access scoring.',
      tags: ['osm', 'openstreetmap', 'amenities', 'poi', 'walkability'],
      apiEndpoint: 'https://overpass-api.de/api/interpreter'
    },

    // ── Opportunity Zones (HUD/Treasury) ─────────────────────────
    {
      id: 'hud-opportunity-zones',
      name: 'Opportunity Zones — Colorado',
      category: 'Policy / Tax Incentives',
      format: 'GeoJSON',
      provider: 'HUD / U.S. Treasury',
      url: 'https://opportunityzones.hud.gov/',
      localFile: 'data/market/opportunity_zones_co.geojson',
      lastUpdated: '2024-01-01',
      updateFrequency: 'Static (2018 designations, updated periodically)',
      maxAgeDays: 365,
      geoUnit: 'Census tract',
      coverage: 'Colorado — 126 designated OZ tracts',
      features: 126,
      description: 'Federally designated Opportunity Zone census tracts in Colorado. Used for tax incentive overlay in PMA scoring and site feasibility analysis.',
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
      localFile: 'data/market/nhd_barriers_co.geojson',
      lastUpdated: '2025-01-01',
      updateFrequency: 'Annual',
      maxAgeDays: 365,
      geoUnit: 'Stream / Water body',
      coverage: 'Colorado statewide',
      features: null,
      description: 'USGS NHD water body and stream network for Colorado. Used as natural barriers in PMA boundary delineation (rivers, lakes, major waterways).',
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
      localFile: 'data/market/transit_stops_co.geojson',
      lastUpdated: '2025-04-01',
      updateFrequency: 'Annual (NTD) / Real-time (GTFS)',
      maxAgeDays: 180,
      geoUnit: 'Stop / Route',
      coverage: 'Colorado transit agencies (RTD, CDOT, local)',
      features: null,
      description: 'Transit stops and routes from NTD/GTFS feeds for Colorado agencies. Used for transit access scoring and PMA commuting-based boundary delineation.',
      tags: ['transit', 'ntd', 'gtfs', 'bus', 'rail', 'transportation'],
      apiEndpoint: 'https://transit.land/api/v2/rest'
    },

    // ── Regrid Parcels API ────────────────────────────────────────
    {
      id: 'regrid-parcels',
      name: 'Regrid Parcel &amp; Zoning Data — Colorado',
      category: 'Market / GIS',
      format: 'GeoJSON (API)',
      provider: 'Loveland / Regrid',
      url: 'https://regrid.com/',
      localFile: 'data/market/parcel_aggregates_co.json',
      lastUpdated: '2025-10-01',
      updateFrequency: 'Quarterly',
      maxAgeDays: 90,
      geoUnit: 'Parcel',
      coverage: 'Colorado statewide (aggregated by tract)',
      features: null,
      description: 'Regrid v2 Parcels API for Colorado. Provides parcel geometry, ownership, zoning classification, and land use codes. Used for multifamily suitability and vacant land analysis.',
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
