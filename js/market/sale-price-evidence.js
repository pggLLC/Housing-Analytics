/**
 * What sale-price evidence exists for this place, and what it actually is.
 *
 * data/market/redfin_place_market_tracker_co.json is rebuilt on a schedule,
 * freshness-checked, 1.5 MB, 121 Colorado places — and until this module
 * nothing on the site read it. The only place a reader could see a Redfin
 * median was a number copied by hand into a project fixture, which names the
 * file as its source and will drift from it silently at the next refresh.
 *
 * #1620 §6 criterion 3 asks for both halves of this: a place with coverage
 * shows its median with a date, and a place without shows "no sale-price
 * source for this place" WITH the reasons. Neither half existed.
 *
 * ── The figure is not what its name suggests ──
 *
 * Every one of the 121 rows is `redfin_zip_to_place_modeled`. There are no
 * direct place observations in the file, and the source's own limitations note
 * says so: "Place rows are modeled aggregates from ZIP-level Redfin data, not
 * direct Redfin place statistics."
 *
 * Fruita's figure is allocated across seven ZIP codes, three of which
 * (81503, 81505, 81507) are Grand Junction. One place in the file draws on
 * forty-one ZIPs; twelve draw on one. Printing "$489,439 — median sale price,
 * Fruita" would be the most ordinary kind of lie this repo tells: a true
 * number under a label that means something else. So the ZIP count travels
 * with the value and the caveat is not optional.
 *
 * Five of the 121 rows are also a year or more behind the rest. They sit in
 * the same file, in the same shape, with nothing to distinguish them, so they
 * are separated here rather than by whoever reads the number.
 *
 * Pure: every dataset arrives already parsed.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SalePriceEvidence = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var MODELLED = 'modelled';
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
      detail: 'Covers ' + covered + ' Colorado places, modelled from ZIP-level data. '
        + 'This one is not among them.',
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
        reasons: reasons(context)
      };
    }

    var zips = num(latest.source_zip_count);
    var fileAsOf = monthIndex((tracker.meta || {}).as_of);
    var rowPeriod = monthIndex(record.latest_period);
    var behind = (fileAsOf !== null && rowPeriod !== null) ? fileAsOf - rowPeriod : null;
    var stale = behind !== null && behind > STALE_MONTHS;

    return {
      state: stale ? STALE : MODELLED,
      value: value,
      period: record.latest_period || null,
      monthsBehind: behind,
      sourceZipCount: zips,
      sourceLevel: record.source_level || null,
      // Never "Fruita's median sale price". The label says what the figure is.
      label: zips === null
        ? 'Modelled from Redfin ZIP-level sales'
        : 'Modelled from ' + zips + ' ZIP ' + plural(zips, 'code', 'codes') + ' overlapping this place',
      caveat: (stale
        ? 'The most recent period for this place is ' + record.latest_period + ', '
          + behind + ' months behind the rest of the file. Treat it as history, not as the market today. '
        : '')
        + 'Redfin publishes rolling three-month windows and this repo allocates them from ZIP to place, '
        + 'so the figure describes a ZIP footprint that overlaps the place rather than the place itself.',
      reasons: []
    };
  }

  return {
    MODELLED: MODELLED,
    STALE: STALE,
    UNAVAILABLE: UNAVAILABLE,
    STALE_MONTHS: STALE_MONTHS,
    forPlace: forPlace,
    reasons: reasons
  };
}));
