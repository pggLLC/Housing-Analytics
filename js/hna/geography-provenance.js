/**
 * Shared geography-provenance chips.
 *
 * Answers one question a housing professional must be able to settle at a
 * glance before citing a figure in a funding application: *what geography is
 * this number, and how was it derived?*
 *
 * This is deliberately separate from ProvenanceLabel (js/provenance-label.js),
 * which answers a different question — how well evidenced a claim is
 * (observed / modeled / user-entered). A figure can be impeccably sourced and
 * still be the county's rather than the town's; both labels can apply to the
 * same number.
 *
 * Levels, from strongest to weakest claim:
 *   place         — measured at the selected place (e.g. an ACS place table)
 *   apportioned   — derived for the place from N underlying tracts
 *   county-proxy  — the containing county's figure, shown for a sub-county
 *                   selection because no local figure exists
 *   county        — a county figure, and the user selected that county
 *   state         — a statewide figure
 *   unavailable   — no figure at any level
 *
 * `apportioned` carries the tract count because that is the real confidence
 * signal and it is already recorded per place in data/hna/place-chas.json:
 * 270 of 482 Colorado places resolve to a single tract, where apportionment
 * means one tract's profile scaled by population share. That is a materially
 * weaker claim than a twelve-tract city and the reader deserves to see the
 * difference. The neighbouring `low_confidence` and `coverage_share` fields
 * are not used here: both are constant across all 482 places in the committed
 * data, so neither distinguishes anything.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeographyProvenance = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var LEVELS = ['place', 'apportioned', 'county-proxy', 'county', 'state', 'unavailable'];

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toCount(value) {
    var n = Number(value);
    // Number.isFinite, not isFinite: isFinite(null) is true because
    // Number(null) === 0, which would render "from 0 tracts".
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  /**
   * describe — resolve a geography level into a chip descriptor.
   *
   * @param {object} input
   * @param {string} input.level        one of LEVELS
   * @param {number} [input.tractCount] underlying tracts, for 'apportioned'
   * @param {string} [input.countyName] containing county, for 'county-proxy'
   * @param {string} [input.metric]     metric name, used in the tooltip
   * @returns {{level:string, label:string, tone:string, title:string, tractCount:(number|null)}}
   */
  function describe(input) {
    input = input || {};
    var level = String(input.level || '').toLowerCase();
    if (LEVELS.indexOf(level) === -1) level = 'unavailable';

    var tracts = toCount(input.tractCount);
    var county = input.countyName ? String(input.countyName) : '';
    var metric = input.metric ? String(input.metric) : 'This figure';

    if (level === 'place') {
      return {
        level: level, label: 'Place data', tone: 'local', tractCount: null,
        title: metric + ' is measured directly for the selected place.'
      };
    }
    if (level === 'apportioned') {
      // A single-tract place is the weakest form of this claim, so say so
      // rather than hiding it behind the same wording as a 12-tract city.
      var single = tracts === 1;
      return {
        level: level, label: tracts ? ('From ' + tracts + ' tract' + (tracts === 1 ? '' : 's')) : 'Apportioned',
        tone: 'derived', tractCount: tracts,
        title: metric + ' is apportioned to this place from ' +
          (tracts ? (tracts + ' underlying census tract' + (tracts === 1 ? '' : 's')) : 'the underlying census tracts') +
          ' by population share.' +
          (single ? ' Only one tract underlies this place, so the estimate carries that tract’s profile — treat it as indicative.' : '')
      };
    }
    if (level === 'county-proxy') {
      return {
        level: level, label: 'County proxy', tone: 'proxy', tractCount: null,
        title: metric + ' is not published for this place, so ' +
          (county ? county : 'the containing county') + '’s figure is shown as a proxy.'
      };
    }
    if (level === 'county') {
      return {
        level: level, label: 'County data', tone: 'neutral', tractCount: null,
        title: metric + ' is the selected county’s own published figure.'
      };
    }
    if (level === 'state') {
      return {
        level: level, label: 'Statewide', tone: 'neutral', tractCount: null,
        title: metric + ' is a statewide Colorado figure.'
      };
    }
    return {
      level: 'unavailable', label: 'No local data', tone: 'none', tractCount: null,
      title: metric + ' is not available at any geography for this selection.'
    };
  }

  /**
   * chipHtml — render a descriptor (or a describe() input) as a chip.
   * Styling lives in css/pages/housing-needs-assessment.css so the colours
   * come from the theme's semantic tokens and hold in both light and dark.
   */
  function chipHtml(input) {
    var d = input && input.tone ? input : describe(input);
    return '<span class="geo-chip" data-geo-level="' + esc(d.level) + '" data-tone="' + esc(d.tone) +
      '" title="' + esc(d.title) + '">' + esc(d.label) + '</span>';
  }

  /**
   * fromPlaceChasRecord — map a data/hna/place-chas.json entry onto a level.
   * Returns null when there is no record, so callers can fall back rather
   * than assert a geography they cannot support.
   */
  function fromPlaceChasRecord(record, opts) {
    if (!record) return null;
    opts = opts || {};
    return describe({
      level: 'apportioned',
      tractCount: record.tract_count != null ? record.tract_count : record.tractCount,
      metric: opts.metric,
      countyName: opts.countyName
    });
  }

  return {
    LEVELS: LEVELS.slice(),
    describe: describe,
    chipHtml: chipHtml,
    fromPlaceChasRecord: fromPlaceChasRecord
  };
}));
