/** Published Redfin city observations, or explicitly modeled ZIP allocations.
 * Geography, period, absence and county benchmark review flags travel with
 * the price to the screen and downloadable report. Pure; no source lookups. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SalePriceEvidence = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var MODELLED = 'modelled';
  var OBSERVED = 'observed';
  var STALE = 'stale';
  var UNAVAILABLE = 'unavailable';

  // A row more than two reporting windows behind the file's own as_of is not
  // "the current market" by any reading. The source publishes rolling
  // three-month windows, so six months is two whole windows of silence.
  var STALE_MONTHS = 6;

  function monthIndex(value) {
    var m = /^(\d{4})-(\d{2})/.exec(String(value || ''));
    return m ? (Number(m[1]) * 12 + Number(m[2])) : null;
  }

  function num(value) {
    return typeof value === 'number' && isFinite(value) ? value : null;
  }

  function plural(count, one, many) {
    return count === 1 ? one : many;
  }

  /**
   * Why there is no sale price here, from the sources' own files.
   *
   * Read rather than written down, because these states change: Bridge is a
   * pending access decision (#1611) and the assessor endpoints are a coverage
   * number (#1602). A hardcoded sentence would keep telling a reader the
   * access was denied on the day it was granted.
   */
  function reasons(context) {
    var out = [];
    var tracker = context.tracker || {};
    var covered = Object.keys((tracker.places) || {}).length;
    out.push({
      source: 'Redfin ZIP market tracker',
      detail: 'Carries ' + covered + ' Colorado place records from city publications or ZIP models. '
        + 'No qualifying sale-price observation is available for this place.',
      issue: null
    });

    var bridge = context.bridge;
    if (bridge && bridge.available === true) {
      out.push({ source: 'Bridge MLS', detail: 'Available, but carries no row for this place.', issue: null });
    } else {
      out.push({
        source: 'Bridge MLS',
        detail: 'Requires a licensed API subscription. Access has been requested and is not granted.',
        issue: 1611
      });
    }

    var assessor = (context.assessor || {}).meta || {};
    var pct = num(assessor.coverage_pct);
    out.push({
      source: 'County assessor parcel records',
      detail: pct === null
        ? 'Coverage is not recorded.'
        : (pct > 0
          ? 'Covers ' + pct + '% of attempted counties, and not this one.'
          : 'Every one of the ' + (assessor.counties_attempted || 'attempted')
            + ' county endpoints fails; the file has never carried parcel data.'),
      issue: pct ? null : 1602
    });
    return out;
  }

  /**
   * @param {string} geoid
   * @param {Object} context  { tracker, bridge, assessor }
   */
  function forPlace(geoid, context) {
    context = context || {};
    var tracker = context.tracker || {};
    var record = ((tracker.places) || {})[String(geoid)] || null;
    var latest = record && record.latest;
    var value = latest ? num(latest.median_sale_price) : null;
    if (!(value > 0)) value = null;

    if (value === null) {
      return {
        state: UNAVAILABLE,
        value: null,
        period: null,
        sourceZipCount: null,
        sourceLevel: null,
        label: 'No sale-price source for this place',
        caveat: 'Sale prices are not published for every Colorado place. This is an '
          + 'absence of evidence, not evidence that nothing sells here.',
        unavailableReason: record && record.unavailable_reason || 'redfin_place_price_unavailable',
        reasons: reasons(context)
      };
    }

    var zips = num(latest.source_zip_count);
    var fileAsOf = monthIndex((tracker.meta || {}).as_of);
    var rowPeriod = monthIndex(record.latest_period);
    var behind = (fileAsOf !== null && rowPeriod !== null) ? fileAsOf - rowPeriod : null;
    var stale = behind !== null && behind > STALE_MONTHS;

    var observed = record.source_level === 'redfin_city_observed';
    return {
      state: stale ? STALE : (observed ? OBSERVED : MODELLED),
      value: value,
      period: record.latest_period || null,
      monthsBehind: behind,
      sourceZipCount: zips,
      sourceSalesCount: observed ? num(latest.homes_sold_allocated) : null,
      sourceLevel: record.source_level || null,
      sourceUrl: record.source_url || tracker.meta && (observed ? tracker.meta.city_source_url : tracker.meta.source_url) || null,
      periodDurationDays: latest.source_period_duration_days || 90,
      reviewFlag: record.review_flag || null,
      // Never "Fruita's median sale price". The label says what the figure is.
      label: observed ? 'Observed Redfin city median for ' + record.name : zips === null
        ? 'Modelled from Redfin ZIP-level sales'
        : 'Modelled from ' + zips + ' ZIP ' + plural(zips, 'code', 'codes') + ' overlapping this place',
      caveat: (stale
        ? 'The most recent period for this place is ' + record.latest_period + ', '
          + behind + ' months behind the rest of the file. Treat it as history, not as the market today. '
        : '')
        + (observed ? 'Redfin published this city median from ' + latest.homes_sold_allocated + ' sales in the stated window. ' +
          (latest.homes_sold_allocated < 5 ? 'This is a small sales sample. ' : '') + 'The reporting window is recorded with the figure.' :
          'This modeled mean of ZIP medians uses HUD residential ratios and Census block housing shares. It describes an overlapping ZIP footprint, not a measured place median.'),
      reasons: []
    };
  }

  return {
    MODELLED: MODELLED,
    OBSERVED: OBSERVED,
    STALE: STALE,
    UNAVAILABLE: UNAVAILABLE,
    STALE_MONTHS: STALE_MONTHS,
    forPlace: forPlace,
    reasons: reasons
  };
}));
