/**
 * Place-vs-county comparison.
 *
 * A county figure is almost never the figure a housing professional needs.
 * Funding applications, inclusionary ordinances and site scoring happen at the
 * municipal scale, and "Boulder County: 31.2% severe renter burden" hides the
 * fact that the same county contains Louisville at 18.7% and Boulder city at
 * 41.0%. That spread is the product; until now the page never showed it.
 *
 * Everything needed already exists. Each jurisdiction-metrics digest carries
 * `geography.containingCounty`, and every metric carries its own value,
 * `geography_level`, `confidence`, `source_id`, `as_of` and — where it is a
 * rate — a `denominator_key` and `denominator`. So the comparison is a lookup
 * of two ~29KB documents, not a computation.
 *
 * Three rules keep the comparison honest:
 *
 * 1. RATES ONLY. A place always has fewer units than the county containing it,
 *    so comparing levels ("8,888 vs 13,990 units needed") invites a reading
 *    that is arithmetically guaranteed and tells the reader nothing. A metric
 *    is comparable iff it declares a `denominator_key`. That is data-driven:
 *    29 metrics qualify, all of them pct_/rate/share, and every pct_ metric
 *    has one. `measure_type` is NOT usable for this — it labels
 *    pct_cost_burdened as "level".
 *
 * 2. NEVER COMPARE A VALUE WITH ITSELF. If a place's metric is carrying the
 *    county's own number, the delta is zero by construction and would read as
 *    "this town matches its county". All 482 places currently hold genuine
 *    place-level values for all 29 rate metrics, but the guard costs nothing
 *    and the invariant is not guaranteed.
 *
 * 3. DROP UNRELIABLE DENOMINATORS. A rate computed over a denominator below
 *    the digest's floor is already flagged; comparing it would give a precise-
 *    looking delta built on a handful of households.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HNACountyComparison = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /**
   * The metrics worth putting in front of a practitioner, in reading order.
   * Deliberately a curated subset — all 29 comparable rates would be a data
   * dump, and the point is a decision, not an inventory. Labels follow the
   * existing wording in hna-ranking-index.js where they overlap.
   *
   * `higherIsWorse` drives the plain-language reading only; the delta itself
   * is always stated as a signed difference so a reader can disagree.
   */
  var DISPLAY_METRICS = [
    { key: 'pct_cost_burdened',          label: 'Renters cost-burdened',      higherIsWorse: true },
    { key: 'pct_renter_severe_burdened', label: 'Severe renter burden',       higherIsWorse: true },
    { key: 'pct_owner_burdened_30plus',  label: 'Owners cost-burdened',       higherIsWorse: true },
    { key: 'housing_gap_rate_lte30',     label: 'Gap rate at ≤30% AMI',  higherIsWorse: true },
    { key: 'overcrowding_rate',          label: 'Overcrowding',               higherIsWorse: true },
    { key: 'vacancy_rate',               label: 'Vacancy',                    higherIsWorse: false },
    { key: 'pct_renters',                label: 'Renter share',               higherIsWorse: null },
    { key: 'pct_multifamily',            label: 'Multifamily share',          higherIsWorse: null }
  ];

  function num(value) {
    // Number.isFinite is necessary but NOT sufficient. Number(null) is 0,
    // Number('') is 0 and Number(false) is 0, and 0 is finite — so coercing
    // first lets every one of those through as a real 0.0%. Reject the
    // absent values before coercing. (This function shipped the bug it now
    // guards against, which is the whole reason the check is explicit.)
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    var n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function metricsOf(digest) {
    return (digest && digest.metrics) || null;
  }

  function geographyOf(digest) {
    return (digest && digest.geography) || null;
  }

  /** The containing county for a place digest, or null. */
  function containingCountyOf(digest) {
    var g = geographyOf(digest);
    return (g && (g.containingCounty || g.containing_county)) || null;
  }

  /**
   * comparable — may this metric be compared between the two geographies?
   * Returns a reason string when it may not, so callers can explain a gap
   * rather than silently dropping a row.
   */
  function comparable(placeMetric, countyMetric) {
    if (!placeMetric || !countyMetric) return 'not published for both geographies';
    if (!placeMetric.denominator_key) return 'not a rate — levels scale with population and do not compare';
    if (num(placeMetric.value) === null || num(countyMetric.value) === null) return 'no value';
    if (placeMetric.geography_level === 'county') {
      return 'the local figure is the county’s own, so there is nothing to compare';
    }
    if (placeMetric.denominator_floor_applied || countyMetric.denominator_floor_applied) {
      return 'denominator below the reliability floor';
    }
    return null;
  }

  /**
   * compare — build the place-vs-county rows.
   *
   * @param {object} placeDigest   jurisdiction-metrics digest for the place
   * @param {object} countyDigest  digest for its containing county
   * @param {{metrics?: Array}} [opts]
   * @returns {{available: boolean, reason: (string|null), place: object, county: object,
   *            rows: Array, skipped: Array}}
   */
  function compare(placeDigest, countyDigest, opts) {
    opts = opts || {};
    var list = opts.metrics || DISPLAY_METRICS;
    var placeGeo = geographyOf(placeDigest);
    var countyGeo = geographyOf(countyDigest);
    var pm = metricsOf(placeDigest);
    var cm = metricsOf(countyDigest);

    if (!placeGeo || !pm) {
      return { available: false, reason: 'no metrics for the selected geography', place: null, county: null, rows: [], skipped: [] };
    }
    if (!countyGeo || !cm) {
      return { available: false, reason: 'no metrics for the containing county', place: placeGeo, county: null, rows: [], skipped: [] };
    }
    if (placeGeo.geoid && countyGeo.geoid && placeGeo.geoid === countyGeo.geoid) {
      return { available: false, reason: 'a county cannot be compared with itself', place: placeGeo, county: countyGeo, rows: [], skipped: [] };
    }

    var rows = [];
    var skipped = [];
    list.forEach(function (spec) {
      var p = pm[spec.key];
      var c = cm[spec.key];
      var why = comparable(p, c);
      if (why) { skipped.push({ key: spec.key, label: spec.label, reason: why }); return; }
      var pv = num(p.value);
      var cv = num(c.value);
      var delta = Math.round((pv - cv) * 10) / 10;
      rows.push({
        key: spec.key,
        label: spec.label,
        place: { value: pv, level: p.geography_level || null, confidence: p.confidence || null, denominator: num(p.denominator) },
        county: { value: cv, level: c.geography_level || null, confidence: c.confidence || null, denominator: num(c.denominator) },
        delta: delta,
        higher: delta > 0 ? 'place' : (delta < 0 ? 'county' : 'equal'),
        higherIsWorse: spec.higherIsWorse,
        asOf: p.as_of || c.as_of || null
      });
    });

    // When nothing is comparable, say WHY rather than "no metric is
    // comparable". 55 of 482 Colorado places are excluded solely because their
    // denominators sit below the reliability floor — small towns where a
    // percentage over a handful of households would look precise and mean
    // nothing. That is a fact about the town worth telling the reader, not an
    // apology worth hiding behind.
    var reason = null;
    if (!rows.length) {
      var causes = {};
      skipped.forEach(function (sk) { causes[sk.reason] = (causes[sk.reason] || 0) + 1; });
      // "Below the floor" and "no value" are the same story in a very small
      // place: too few households to measure. Amherst (CDP) hits the floor on
      // six measures and has no value at all on two. Requiring a single cause
      // would have sent that reader the generic message.
      var floorCount = 0;
      var smallCount = 0;
      var total = 0;
      Object.keys(causes).forEach(function (why) {
        total += causes[why];
        if (/reliability floor/.test(why)) { floorCount += causes[why]; smallCount += causes[why]; }
        else if (/^no value$/.test(why)) { smallCount += causes[why]; }
      });
      reason = (floorCount > 0 && smallCount === total)
        ? 'this jurisdiction is too small for a reliable rate comparison — its ' +
          'household counts fall below the threshold where a percentage is meaningful'
        : 'no measure can be compared like-for-like between these two geographies';
    }

    return {
      available: rows.length > 0,
      reason: reason,
      place: placeGeo,
      county: countyGeo,
      rows: rows,
      skipped: skipped
    };
  }

  /**
   * describeDelta — a plain-language reading of one row.
   * Returns null where "better"/"worse" would be a value judgement the data
   * does not support (renter share, multifamily share).
   */
  function describeDelta(row) {
    if (!row || row.higher === 'equal') return 'the same as the county';
    if (row.higherIsWorse === null || row.higherIsWorse === undefined) return null;
    var worse = (row.higher === 'place') === !!row.higherIsWorse;
    return worse ? 'worse than the county' : 'better than the county';
  }

  function formatDelta(delta) {
    if (delta === null || !Number.isFinite(delta)) return '—';
    if (delta === 0) return '±0.0 pts';
    return (delta > 0 ? '+' : '−') + Math.abs(delta).toFixed(1) + ' pts';
  }

  return {
    DISPLAY_METRICS: DISPLAY_METRICS.slice(),
    compare: compare,
    comparable: comparable,
    containingCountyOf: containingCountyOf,
    describeDelta: describeDelta,
    formatDelta: formatDelta
  };
}));
