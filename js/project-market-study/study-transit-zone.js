/**
 * js/project-market-study/study-transit-zone.js — HB26-1065 transit-zone
 * screen for the for-sale market study (#1937 Phase 4).
 *
 * The study is keyed by jurisdiction, not by a site, so it reports the area
 * figure from data/hna/transit-zone-by-geography.json (the same file the HNA
 * "Potential location" panel reads) and the designation note from
 * TransitZone.designation(). It never shows a credit amount: the Transit Zone
 * credit is a rental-housing credit, so for an ownership project it is only a
 * reason to consider a rental component (finish-line PC-2).
 *
 * Missing data, an example (no jurisdiction) study, stale stop data or an
 * uncovered geography render "Unavailable" with the reason — never 0%.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StudyTransitZone = api;
}(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * Returns { state, html }. Pure: no DOM, no fetch. The figures, rounding,
   * reasons and designation note come from TransitZone.areaSummary (`tz`),
   * the same summary the needs assessment and the recommendation read.
   */
  function summarize(geoid, data, mapStatus, now, tz) {
    function unavailable(reason) {
      return { state: 'unavailable', html: '<p class="ms-unavailable">Unavailable. ' + esc(reason) + '</p>' };
    }
    if (!geoid) return unavailable('This is an example study with no jurisdiction selected, so there is no area to screen.');
    if (!tz || typeof tz.areaSummary !== 'function') return unavailable('The transit zone screen did not load.');
    var s = tz.areaSummary(data, geoid, mapStatus, now);
    if (s.status !== 'ok') {
      return unavailable(s.unavailableCode === 'not_covered' ? 'No transit zone figures for this jurisdiction.' : s.unavailableReason);
    }
    var name = esc(s.name || 'this jurisdiction');
    var html = '<p data-tz="share"><strong>' + esc(s.shareLabel) + '</strong> of ' + name +
      ' is within ' + esc(s.radiusMiles) + ' miles of a confirmed transit stop (CDOT or a transit agency).</p>';
    html += '<p>The Colorado Transit Zone credit (HB26-1065) is a credit for affordable <em>rental</em> housing inside an ' +
      'OEDIT-designated zone. It does not apply to a for-sale project on its own; it is a reason to consider a rental ' +
      'component if the site is inside a zone. The needs assessment’s “Potential location” section and the ' +
      'market analysis site screen give the detail.</p>';
    html += '<p class="ms-caveat" data-tz-designation="' + esc(s.designation) + '">' + esc(s.designationNote) + '</p>';
    return { state: 'ok', html: html };
  }

  // A fetch that never answers is a failed load, not a reason to keep the
  // section on "Checking…" (#1973): after api.timeoutMs it resolves null, the
  // same as a failed or 404 fetch, and summarize() says the data is missing.
  function get(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer;
    var gaveUp = new Promise(function (resolve) {
      timer = setTimeout(function () { if (ctrl) ctrl.abort(); resolve(null); }, api.timeoutMs);
    });
    var got = fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    return Promise.race([got, gaveUp]).then(function (v) { clearTimeout(timer); return v; });
  }

  function render(mount, geoid, now) {
    if (!mount) return Promise.resolve(null);
    return Promise.all([get('data/hna/transit-zone-by-geography.json'), get('data/policy/thiz-map-status.json')])
      .then(function (parts) {
        var tz = typeof window !== 'undefined' ? window.TransitZone : null;
        var out = summarize(geoid, parts[0], parts[1], now, tz);
        mount.innerHTML = out.html;
        mount.setAttribute('data-tz-state', out.state);
        return out;
      });
  }

  var api = { summarize: summarize, render: render, timeoutMs: 20000 };
  return api;
}));
