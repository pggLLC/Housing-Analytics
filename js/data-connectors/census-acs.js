/**
 * js/data-connectors/census-acs.js
 * Census ACS data connector — loads prebuilt ACS tract metrics.
 * For GitHub Pages, uses prebuilt data/market/acs_tract_metrics_co.json.
 * Exposes window.CensusAcs.
 */
(function () {
  'use strict';

  /**
   * Index of ACS metrics keyed by census tract GEOID string.
   * @type {Object.<string, Object>}
   */
  var geoidIndex = {};

  /**
   * Raw array of all loaded ACS metrics objects.
   * @type {Array.<Object>}
   */
  var allMetrics = [];

  /**
   * Whether metrics have been successfully loaded.
   * @type {boolean}
   */
  var loaded = false;

  /**
   * Safely coerces a value to a finite number; returns 0 on failure.
   * @param {*} v
   * @returns {number}
   */
  function toNum(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  /**
   * Accepts a preloaded ACS metrics array and builds an internal GEOID index
   * for fast tract lookups.
   * Each element is expected to have at minimum a `geoid` string property.
   * @param {Array.<Object>} data - Array of ACS tract metric objects.
   */
  function loadMetrics(data) {
    if (!Array.isArray(data)) {
      console.warn('[CensusAcs] loadMetrics: expected an array, got ' + typeof data);
      return;
    }

    geoidIndex = {};
    allMetrics = [];

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (!row || !row.geoid) { continue; }
      geoidIndex[String(row.geoid)] = row;
      allMetrics.push(row);
    }

    loaded = allMetrics.length > 0;
    console.log('[CensusAcs] Loaded ' + allMetrics.length + ' ACS tract records');
  }

  /**
   * Returns the metrics object for a single census tract.
   * @param {string} geoid - Census tract GEOID (e.g. "08031000100").
   * @returns {Object|null}
   */
  function getMetrics(geoid) {
    if (!geoid) { return null; }
    return geoidIndex[String(geoid)] || null;
  }

  /**
   * Aggregates ACS metrics across a list of tract GEOIDs.
   * Numeric fields are summed; weighted averages are computed for rate fields.
   * @param {Array.<string>} geoidList
   * @returns {{
   *   pop: number,
   *   renter_hh: number,
   *   owner_hh: number,
   *   total_hh: number,
   *   vacant: number,
   *   median_gross_rent: number,
   *   median_hh_income: number,
   *   cost_burden_rate: number,
   *   vacancy_rate: number,
   *   poverty_rate: number,
   *   tract_count: number
   * }}
   */
  function aggregateForTracts(geoidList) {
    var result = {
      pop: 0,
      renter_hh: 0,
      owner_hh: 0,
      total_hh: 0,
      vacant: 0,
      median_gross_rent: 0,
      median_hh_income: 0,
      cost_burden_rate: 0,
      vacancy_rate: 0,
      poverty_rate: 0,
      tract_count: 0
    };

    if (!Array.isArray(geoidList) || geoidList.length === 0) {
      return result;
    }

    var rentSum = 0;
    var incomeSum = 0;
    var costBurdenSum = 0;
    var vacancySum = 0;
    var povertySum = 0;
    var rateCount = 0;

    for (var i = 0; i < geoidList.length; i++) {
      var m = getMetrics(geoidList[i]);
      if (!m) { continue; }

      result.pop        += toNum(m.pop);
      result.renter_hh  += toNum(m.renter_hh);
      result.owner_hh   += toNum(m.owner_hh);
      result.total_hh   += toNum(m.total_hh);
      result.vacant     += toNum(m.vacant);
      result.tract_count++;

      rentSum        += toNum(m.median_gross_rent);
      incomeSum      += toNum(m.median_hh_income);
      costBurdenSum  += toNum(m.cost_burden_rate);
      vacancySum     += toNum(m.vacancy_rate);
      povertySum     += toNum(m.poverty_rate);
      rateCount++;
    }

    if (rateCount > 0) {
      result.median_gross_rent = Math.round(rentSum / rateCount);
      result.median_hh_income  = Math.round(incomeSum / rateCount);
      result.cost_burden_rate  = parseFloat((costBurdenSum / rateCount).toFixed(4));
      result.vacancy_rate      = parseFloat((vacancySum / rateCount).toFixed(4));
      result.poverty_rate      = parseFloat((povertySum / rateCount).toFixed(4));
    }

    return result;
  }

  /**
   * Computes cost-burden statistics across all loaded tracts.
   * @returns {{ mean: number, max: number, highBurdenCount: number, totalTracts: number }}
   */
  function getCostBurdenStats() {
    if (!loaded || allMetrics.length === 0) {
      return { mean: 0, max: 0, highBurdenCount: 0, totalTracts: 0 };
    }

    var sum = 0;
    var max = 0;
    var highBurdenCount = 0;

    for (var i = 0; i < allMetrics.length; i++) {
      var rate = toNum(allMetrics[i].cost_burden_rate);
      sum += rate;
      if (rate > max) { max = rate; }
      // High burden: >= 30% of income spent on housing costs
      if (rate >= 0.30) { highBurdenCount++; }
    }

    return {
      mean: parseFloat((sum / allMetrics.length).toFixed(4)),
      max: parseFloat(max.toFixed(4)),
      highBurdenCount: highBurdenCount,
      totalTracts: allMetrics.length
    };
  }

  /**
   * Returns whether ACS metrics have been loaded.
   * @returns {boolean}
   */
  function isLoaded() {
    return loaded;
  }

  window.CensusAcs = {
    loadMetrics: loadMetrics,
    getMetrics: getMetrics,
    aggregateForTracts: aggregateForTracts,
    getCostBurdenStats: getCostBurdenStats,
    isLoaded: isLoaded
  };

}());
