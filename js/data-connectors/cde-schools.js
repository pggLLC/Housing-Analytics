/**
 * js/data-connectors/cde-schools.js
 * Colorado Department of Education school district quality accessor.
 *
 * Data source: data/market/cde_schools_co.json
 * Real data: https://www.cde.state.co.us/accountability
 *
 * Exposed as window.CdeSchools.
 */
(function () {
  'use strict';

  var _data     = null;  // raw loaded data
  var _byCounty = null;  // county_fips → [district, ...]

  /* ── Build county index ───────────────────────────────────────── */
  function _buildIndex(districts) {
    var idx = {};
    (districts || []).forEach(function (d) {
      var fips = d.county_fips;
      if (!idx[fips]) idx[fips] = [];
      idx[fips].push(d);
    });
    return idx;
  }

  /* ── Load data ──────────────────────────────────────────────── */
  function loadMetrics() {
    var DS = window.DataService;
    if (!DS) return Promise.reject(new Error('DataService not available'));
    return DS.getJSON(DS.baseData('market/cde_schools_co.json'))
      .then(function (raw) {
        _data     = raw;
        _byCounty = _buildIndex((raw && raw.districts) ? raw.districts : []);
        return _data;
      })
      .catch(function (e) {
        console.warn('[cde-schools] Failed to load cde_schools_co.json:', e && e.message);
        _data     = { districts: [] };
        _byCounty = {};
        return _data;
      });
  }

  /* ── Get districts for county ────────────────────────────────── */
  function getCountyDistricts(countyFips) {
    return (_byCounty && _byCounty[countyFips]) || [];
  }

  /**
   * Nearest district to a lat/lon (straight-line to centroid).
   * Returns null if no district data loaded.
   */
  function getNearestDistrict(lat, lon) {
    if (!_data || !_data.districts || !_data.districts.length) return null;
    var best = null, bestDist = Infinity;
    _data.districts.forEach(function (d) {
      var dlat = (d.centroid_lat || 0) - lat;
      var dlon = (d.centroid_lon || 0) - lon;
      var dist = dlat * dlat + dlon * dlon;
      if (dist < bestDist) { bestDist = dist; best = d; }
    });
    return best;
  }

  /* ── Aggregate school quality for a set of county FIPS codes ─── */
  function aggregateForCounties(countyFipsList) {
    if (!_byCounty) return null;
    var total = { quality_sum: 0, grad_sum: 0, n: 0 };
    (countyFipsList || []).forEach(function (fips) {
      var districts = _byCounty[fips] || [];
      districts.forEach(function (d) {
        total.quality_sum += d.composite_quality_score || 0;
        total.grad_sum    += d.graduation_rate         || 0;
        total.n++;
      });
    });
    if (!total.n) return null;
    return {
      avg_quality_score: Math.round(total.quality_sum / total.n),
      avg_grad_rate:     Math.round(total.grad_sum / total.n * 1000) / 1000,
      district_count:    total.n
    };
  }

  /**
   * Score school quality 0–100 for PMA workforce dimension.
   * composite_quality_score is already 0–100 from the data file.
   * Return the average quality score directly (or 55 neutral if no data).
   */
  function scoreSchoolQuality(agg) {
    if (!agg || !agg.avg_quality_score) return 55;
    return Math.min(100, Math.max(0, agg.avg_quality_score));
  }

  /* ── Public API ──────────────────────────────────────────────── */
  window.CdeSchools = {
    loadMetrics:          loadMetrics,
    getCountyDistricts:   getCountyDistricts,
    getNearestDistrict:   getNearestDistrict,
    aggregateForCounties: aggregateForCounties,
    scoreSchoolQuality:   scoreSchoolQuality,
    /** @returns {object|null} raw loaded data */
    getData: function () { return _data; }
  };

}());
