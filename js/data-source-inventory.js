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
      description: 'HUD-schema LIHTC project GeoJSON for Colorado. Rebuilt weekly from data/chfa-lihtc.json by scripts/normalize-lihtc-to-hud-schema.js — includes all 716 projects with both CHFA and HUD fields.',
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
      description: 'Canonical LIHTC project cache for Colorado (716 features). Fetched weekly from the CHFA ArcGIS FeatureServer by scripts/fetch-chfa-lihtc.js. Primary source for the HNA and LIHTC overlays.',
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
      description: 'Colorado LIHTC allocation history 1988–2024: annual project counts, low-income units, IRS per-capita floor, and state allocation authority.',
      tags: ['lihtc', 'historical', 'allocation', 'colorado', 'irs', 'chfa'],
      apiEndpoint: null
    },
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
      description: 'Local government Proposition 123 affordable housing commitment filings with DOLA.',
      tags: ['prop123', 'policy', 'dola'],
      apiEndpoint: null
    },
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
      apiEndpoint: 'https://api.stlouisfed.org/fred/series/observations?series_id=UNRATE&file_type=json',
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
      apiEndpoint: 'https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&file_type=json'
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
      apiEndpoint: 'https://api.stlouisfed.org/fred/series/observations?series_id=CUUR0000SAH1&file_type=json'
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
      apiEndpoint: 'https://api.stlouisfed.org/fred/series/observations?series_id=UNRATE&file_type=json'
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
      apiEndpoint: 'https://api.stlouisfed.org/fred/series/observations?series_id=MORTGAGE30US&file_type=json'
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
      apiEndpoint: 'https://api.stlouisfed.org/fred/series/observations?series_id=COBPPRIV&file_type=json'
    }
  ];

  window.DataSourceInventory = {
    getSources: function () {
      return SOURCES.map(function (s) {
        return Object.assign({}, s, {
          status: computeStatus(s),
          freshnessScore: freshnessScore(s),
          daysSinceUpdate: daysSince(s.lastUpdated)
        });
      });
    },
    getByCategory: function () {
      var map = {};
      this.getSources().forEach(function (s) {
        if (!map[s.category]) map[s.category] = [];
        map[s.category].push(s);
      });
      return map;
    },
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
    getApiSources: function () {
      return this.getSources().filter(function (s) { return !!s.apiEndpoint; });
    },
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
    toCSV: function () {
      var sources = this.getSources();
      var headers = ['id', 'name', 'category', 'format', 'provider', 'lastUpdated', 'updateFrequency', 'status', 'freshnessScore', 'geoUnit', 'coverage', 'features'];
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
