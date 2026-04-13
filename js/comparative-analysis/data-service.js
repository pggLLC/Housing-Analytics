/**
 * data-service.js — COHO Analytics Comparative Analysis
 *
 * Fetches and aggregates HNA ranking index data for benchmark comparisons.
 * Provides county-level and statewide averages for benchmark visualizations.
 *
 * Dependencies:
 *   - js/fetch-helper.js (window.fetchWithTimeout)
 *   - js/path-resolver.js (window.__REPO_ROOT)
 *
 * Exposes: window.BenchmarkDataService
 */
(function () {
  'use strict';

  const ROOT = (typeof window !== 'undefined' && window.__REPO_ROOT) ? window.__REPO_ROOT : '';
  const RANKING_INDEX_URL = ROOT + 'data/hna/ranking-index.json';
  const GEO_CONFIG_URL    = ROOT + 'data/hna/geo-config.json';

  let _rankingIndex = null;
  let _geoConfig    = null;
  let _initPromise  = null;

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  async function _ensureLoaded() {
    if (_rankingIndex) return;
    if (_initPromise) return _initPromise;

    _initPromise = Promise.all([
      _fetchJson(RANKING_INDEX_URL),
      _fetchJson(GEO_CONFIG_URL),
    ]).then(([ranking, geo]) => {
      _rankingIndex = ranking;
      _geoConfig    = geo;
    }).catch(err => {
      console.error('BenchmarkDataService: failed to load index data:', err);
      _rankingIndex = { entries: [] };
      _geoConfig    = {};
    });

    return _initPromise;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  const BenchmarkDataService = {
    /**
     * Return the statewide average metrics across all entries.
     * @returns {Promise<Object>}
     */
    async getStateAverage() {
      await _ensureLoaded();
      const entries = _getEntries();
      return _computeAverages(entries);
    },

    /**
     * Return all entries for a given county FIPS (5-digit).
     * @param {string} countyFips
     * @returns {Promise<Object[]>}
     */
    async getCountyEntries(countyFips) {
      await _ensureLoaded();
      return _getEntries().filter(e => {
        // Entries include the county itself and municipalities within it
        if (e.type === 'county') return e.geoid === countyFips;
        return e.containingCounty === countyFips || (e.geoid && e.geoid.startsWith(countyFips));
      });
    },

    /**
     * Return the county average metrics for all municipalities within a county.
     * @param {string} countyFips
     * @returns {Promise<Object>}
     */
    async getCountyAverage(countyFips) {
      await _ensureLoaded();
      const entries = _getEntries().filter(e =>
        e.type !== 'county' && (
          e.containingCounty === countyFips ||
          (e.geoid && e.geoid.startsWith(countyFips))
        )
      );
      return _computeAverages(entries);
    },

    /**
     * Return a single entry by GEOID.
     * @param {string} geoid
     * @returns {Promise<Object|null>}
     */
    async getEntry(geoid) {
      await _ensureLoaded();
      return _getEntries().find(e => e.geoid === geoid) || null;
    },

    /**
     * Return multiple entries by GEOID array.
     * @param {string[]} geoids
     * @returns {Promise<Object[]>}
     */
    async getEntries(geoids) {
      await _ensureLoaded();
      const set = new Set(geoids);
      return _getEntries().filter(e => set.has(e.geoid));
    },

    /**
     * Return all counties (type === 'county').
     * @returns {Promise<Object[]>}
     */
    async getAllCounties() {
      await _ensureLoaded();
      return _getEntries().filter(e => e.type === 'county');
    },

    /**
     * Build comparison rows for a set of GEOIDs plus benchmark aggregates.
     * @param {string[]} geoids
     * @param {string}   [countyFips] - If provided, includes county average
     * @returns {Promise<Object[]>}   - Array of {label, geoid, metrics, isAggregate}
     */
    async buildComparison(geoids, countyFips) {
      await _ensureLoaded();
      const rows = [];

      // Individual entries
      for (const geoid of geoids) {
        const entry = _getEntries().find(e => e.geoid === geoid);
        if (entry) {
          rows.push({ label: entry.name || geoid, geoid: entry.geoid, metrics: _extractMetrics(entry), isAggregate: false });
        }
      }

      // County average
      if (countyFips) {
        const countyAvg = await this.getCountyAverage(countyFips);
        const countyEntry = _getEntries().find(e => e.type === 'county' && e.geoid === countyFips);
        const countyName  = countyEntry ? countyEntry.name : countyFips;
        rows.push({ label: `${countyName} (county avg)`, geoid: countyFips, metrics: countyAvg, isAggregate: true });
      }

      // Statewide average
      const stateAvg = await this.getStateAverage();
      rows.push({ label: 'Colorado (state avg)', geoid: '08', metrics: stateAvg, isAggregate: true });

      return rows;
    },

    /** Force a refresh of the cached data. */
    async refresh() {
      _rankingIndex = null;
      _geoConfig    = null;
      _initPromise  = null;
      await _ensureLoaded();
    },
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function _getEntries() {
    if (!_rankingIndex) return [];
    // ranking-index.json stores the list under the "rankings" key
    if (Array.isArray(_rankingIndex)) return _rankingIndex;
    if (Array.isArray(_rankingIndex.rankings)) return _rankingIndex.rankings;
    if (Array.isArray(_rankingIndex.entries)) return _rankingIndex.entries;
    return [];
  }

  function _extractMetrics(entry) {
    // ranking-index.json stores all metrics under entry.metrics
    const m = (entry && entry.metrics) ? entry.metrics : entry;
    return {
      population:       m.population                ?? null,
      populationGrowth: m.populationGrowth           ?? m.pop_growth_pct          ?? null,
      medianIncome:     m.median_hh_income           ?? m.medianIncome             ?? m.mhi ?? null,
      medianRent:       m.gross_rent_median          ?? m.medianRent               ?? m.median_rent ?? null,
      rentBurden:       m.pct_cost_burdened          ?? m.rentBurden               ?? m.rent_burden_pct ?? null,
      vacancyRate:      m.vacancy_rate               ?? m.vacancyRate              ?? null,
      unitsNeeded:      m.housing_gap_units          ?? m.unitsNeeded              ?? m.units_needed ?? null,
      housingGap:       m.ami_gap_30pct              ?? m.housingGap               ?? m.housing_gap ?? null,
      needScore:        m.overall_need_score         ?? m.needScore                ?? m.need_score ?? null,
    };
  }

  function _computeAverages(entries) {
    if (!entries.length) return {};
    const keys = ['population', 'populationGrowth', 'medianIncome', 'medianRent',
                  'rentBurden', 'vacancyRate', 'unitsNeeded', 'housingGap', 'needScore'];
    const result = {};
    keys.forEach(key => {
      const vals = entries.map(e => _extractMetrics(e)[key]).filter(v => v != null);
      result[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    return result;
  }

  async function _fetchJson(url) {
    const fetchFn = (typeof window !== 'undefined' && window.fetchWithTimeout)
      ? window.fetchWithTimeout
      : fetch;
    const resp = await fetchFn(url, { timeout: 10000 });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
    return resp.json();
  }

  window.BenchmarkDataService = BenchmarkDataService;
})();
