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

  var SOURCES = [
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
        { title: 'Novogradac LIHTC Mapping Tool', description: 'Interactive LIHTC project map from Novogradac', url: 'https://www.novoco.com/' }
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
      apiEndpoint: null
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
        { title: 'Census Bureau Quick Facts', description: 'Easy access to county-level census data', url: 'https://www.census.gov/' }
      ]
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
      apiEndpoint: null,
      alternatives: [
        { title: 'FRED Website', description: 'Browse and download any economic series from the St. Louis Fed', url: 'https://fred.stlouisfed.org/' },
        { title: 'BLS Data Tools', description: 'Bureau of Labor Statistics direct data access', url: 'https://www.bls.gov/data/' },
        { title: 'FRED API Docs', description: 'Full API documentation for custom series queries', url: 'https://fred.stlouisfed.org/docs/api/fred/' }
      ]
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
      apiEndpoint: null
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
      apiEndpoint: null
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
      apiEndpoint: null
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
      apiEndpoint: null
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
      apiEndpoint: null
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
