// js/data-source-inventory.js
// Complete registry of 43+ data sources used by Housing Analytics.
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
      lastUpdated: '2025-12-01',
      updateFrequency: 'Annual',
      maxAgeDays: 365,
      geoUnit: 'Project',
      coverage: 'Colorado statewide',
      features: 2800,
      description: 'HUD LIHTC project-level GeoJSON for Colorado. Includes project location, unit counts, credit year, QCT/DDA status.',
      tags: ['lihtc', 'affordable-housing', 'colorado'],
      apiEndpoint: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Low_Income_Housing_Tax_Credit/FeatureServer/0'
    },
    {
      id: 'chfa-lihtc',
      name: 'CHFA LIHTC Portfolio',
      category: 'LIHTC / Housing',
      format: 'JSON',
      provider: 'CHFA / Internal',
      url: 'https://www.chfainfo.com/',
      localFile: 'data/chfa-lihtc.json',
      lastUpdated: '2025-11-01',
      updateFrequency: 'Quarterly',
      maxAgeDays: 120,
      geoUnit: 'Project',
      coverage: 'Colorado statewide',
      features: 1200,
      description: 'CHFA-financed LIHTC projects with allocation amounts, developer info, and compliance dates.',
      tags: ['chfa', 'lihtc', 'colorado'],
      apiEndpoint: null
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
      apiEndpoint: 'https://api.stlouisfed.org/fred/series/observations'
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
      apiEndpoint: 'https://api.census.gov/data/2023/acs/acs5'
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
      apiEndpoint: 'https://api.census.gov/data/2023/acs/acs5'
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
      apiEndpoint: 'https://api.census.gov/data/2023/acs/acs5'
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
      apiEndpoint: 'https://www.huduser.gov/hudapi/public/fmr'
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
      localFile: 'data/bls-qcew-co.json',
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
      apiEndpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1'
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
      apiEndpoint: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/2'
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
