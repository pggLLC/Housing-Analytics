/**
 * Renders the place-vs-county comparison.
 *
 * Pure presentation: all the judgement lives in county-comparison.js, which
 * decides what may honestly be compared. This fetches the two digests and
 * draws the result.
 *
 * Fetching two ~29KB documents rather than the 1.64MB ranking-index keeps the
 * payload proportional to what is shown, and the digests carry the provenance
 * (geography_level, confidence, denominator) that the index does not.
 */
(function () {
  'use strict';

  var SECTION_ID = 'countyComparisonSection';
  var BODY_ID = 'countyComparisonBody';
  var cache = Object.create(null);

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function digestPath(geoid) {
    return 'data/hna/jurisdiction-metrics-digest/' + encodeURIComponent(geoid) + '.json';
  }

  function loadDigest(geoid) {
    if (cache[geoid]) return cache[geoid];
    cache[geoid] = fetch(digestPath(geoid))
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    return cache[geoid];
  }

  function pct(v) {
    return (v === null || !Number.isFinite(v)) ? '—' : v.toFixed(1) + '%';
  }

  function hide(section, message) {
    if (!section) return;
    if (!message) { section.hidden = true; return; }
    var body = document.getElementById(BODY_ID);
    if (body) body.innerHTML = '<p class="cc-empty">' + esc(message) + '</p>';
    section.hidden = false;
  }

  function rowHtml(row, C) {
    var reading = C.describeDelta(row);
    var tone = row.higher === 'equal' ? 'same'
      : (reading === 'worse than the county' ? 'worse'
        : (reading === 'better than the county' ? 'better' : 'neutral'));
    return '' +
      '<tr data-tone="' + esc(tone) + '">' +
        '<th scope="row">' + esc(row.label) + '</th>' +
        '<td class="cc-num cc-place">' + esc(pct(row.place.value)) + '</td>' +
        '<td class="cc-num cc-county">' + esc(pct(row.county.value)) + '</td>' +
        '<td class="cc-num cc-delta">' + esc(C.formatDelta(row.delta)) +
          (reading ? '<span class="cc-reading">' + esc(reading.replace(' than the county', '')) + '</span>' : '') +
        '</td>' +
      '</tr>';
  }

  function render(result, C) {
    var section = document.getElementById(SECTION_ID);
    var body = document.getElementById(BODY_ID);
    if (!section || !body) return;

    if (!result.available) {
      hide(section, result.reason ? ('Comparison unavailable: ' + result.reason + '.') : null);
      return;
    }

    var placeName = (result.place && result.place.name) || 'This jurisdiction';
    var countyName = (result.county && result.county.name) || 'the county';
    var asOf = result.rows.length ? result.rows[0].asOf : null;

    var html = '' +
      '<div class="cc-scroll">' +
      '<table class="cc-table">' +
        '<caption class="cc-caption">Rates only. Counts are excluded because a town always has fewer ' +
          'households than the county containing it, so that comparison is guaranteed by arithmetic ' +
          'rather than informative.' + (asOf ? ' Source vintage: ' + esc(asOf) + '.' : '') + '</caption>' +
        '<thead><tr>' +
          '<th scope="col">Measure</th>' +
          '<th scope="col" class="cc-num">' + esc(placeName) + '</th>' +
          '<th scope="col" class="cc-num">' + esc(countyName) + '</th>' +
          '<th scope="col" class="cc-num">Difference</th>' +
        '</tr></thead>' +
        '<tbody>' + result.rows.map(function (r) { return rowHtml(r, C); }).join('') + '</tbody>' +
      '</table></div>';

    if (result.skipped.length) {
      html += '<p class="cc-skipped">Not compared: ' +
        result.skipped.map(function (s) { return esc(s.label) + ' (' + esc(s.reason) + ')'; }).join('; ') +
        '.</p>';
    }

    body.innerHTML = html;
    section.hidden = false;
  }

  /**
   * renderFor — draw the comparison for a selection, or hide it.
   * Only place/CDP selections have a containing county; a county compared with
   * itself is not a comparison, and statewide has nothing above it.
   */
  function renderFor(geoType, geoid) {
    var section = document.getElementById(SECTION_ID);
    var C = window.HNACountyComparison;
    if (!section || !C) return Promise.resolve();

    if (geoType !== 'place' && geoType !== 'cdp') {
      hide(section, null);
      return Promise.resolve();
    }

    return loadDigest(geoid).then(function (placeDigest) {
      var countyGeoid = C.containingCountyOf(placeDigest);
      if (!placeDigest || !countyGeoid) {
        hide(section, null);
        return;
      }
      return loadDigest(countyGeoid).then(function (countyDigest) {
        render(C.compare(placeDigest, countyDigest), C);
      });
    }).catch(function () { hide(section, null); });
  }

  /**
   * Self-initialise from the URL.
   *
   * The controller calls renderFor() on every selection, but that call sits
   * inside a pipeline which also fetches ACS profiles and projections — and a
   * throw anywhere in it (a rate-limited Census key, say) took this section
   * down with it, even though the comparison needs nothing but a geoid and two
   * static digests. A panel should not disappear because an unrelated request
   * failed.
   *
   * So: read the geography from the URL on load and render independently. The
   * controller's call still runs and simply repaints the same content when the
   * user changes jurisdiction.
   */
  function initFromUrl() {
    if (!document.getElementById(SECTION_ID)) return;
    var params = new URLSearchParams(window.location.search);
    var geoType = params.get('geoType');
    var geoid = params.get('geoid');
    if (!geoType || !geoid) return;
    renderFor(geoType, geoid).catch(function () {});
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initFromUrl);
    } else {
      initFromUrl();
    }
  }

  window.HNACountyComparisonView = { renderFor: renderFor, initFromUrl: initFromUrl, SECTION_ID: SECTION_ID };
}());
