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

  var MAX_AGE_DAYS = 16;   // the stop file's freshness SLA

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // A measured share never rounds to an absolute: 0.4% is "<1%", not "0%"
  // (which would read as no transit at all), and 99.6% is ">99%", not "100%".
  // Same rule as the needs assessment's panel (js/hna/hna-renderers.js).
  function pct(v) {
    if (v > 0 && v < 0.005) return '<1%';
    if (v < 1 && v >= 0.995) return '>99%';
    return Math.round(v * 100) + '%';
  }

  /** Returns { state, html }. Pure: no DOM, no fetch. */
  function summarize(geoid, data, mapStatus, now, designationFn) {
    now = now && typeof now.getTime === 'function' ? now : new Date();
    function unavailable(reason) {
      return { state: 'unavailable', html: '<p class="ms-unavailable">Unavailable. ' + esc(reason) + '</p>' };
    }
    if (!geoid) return unavailable('This is an example study with no jurisdiction selected, so there is no area to screen.');
    if (!data || !data.geographies) return unavailable('Transit zone data did not load.');
    var rec = data.geographies[geoid];
    if (!rec) return unavailable('No transit zone figures for this jurisdiction.');
    if (rec.unavailableReason) return unavailable(rec.unavailableReason);
    var gen = Date.parse((data.meta && data.meta.stops_generated) || '');
    if (!Number.isFinite(gen)) return unavailable('The transit stop data has no build date, so its age cannot be confirmed.');
    var age = Math.floor((now.getTime() - gen) / 86400000);
    if (age > MAX_AGE_DAYS) return unavailable('The transit stop data is ' + age + ' days old (limit ' + MAX_AGE_DAYS + '), so it may miss new or moved stops.');
    var radius = data.meta && data.meta.radius_miles;
    var share = rec.share_within_radius_confirmed;
    if (typeof share !== 'number' || !(radius > 0)) return unavailable('The transit zone figures for this jurisdiction are incomplete.');
    var des = designationFn ? designationFn(mapStatus, now)
      : { designation: 'provisional', note: 'Provisional — the zone-map status could not be read, so this is a screen only.' };
    var edgeOnly = share === 0 && rec.zero_is_exact === false;
    var name = esc(rec.name || 'this jurisdiction');
    var html = '<p data-tz="share"><strong>' + (edgeOnly ? '<1%' : pct(share)) + '</strong> of ' + name +
      ' is within ' + esc(radius) + ' miles of a confirmed transit stop (CDOT or a transit agency).</p>';
    html += '<p>The Colorado Transit Zone credit (HB26-1065) is a credit for affordable <em>rental</em> housing inside an ' +
      'OEDIT-designated zone. It does not apply to a for-sale project on its own; it is a reason to consider a rental ' +
      'component if the site is inside a zone. The needs assessment’s “Potential location” section and the ' +
      'market analysis site screen give the detail.</p>';
    html += '<p class="ms-caveat" data-tz-designation="' + esc(des.designation) + '">' + esc(des.note) + '</p>';
    return { state: 'ok', html: html };
  }

  function render(mount, geoid, now) {
    if (!mount) return Promise.resolve(null);
    var get = function (url) {
      return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    };
    return Promise.all([get('data/hna/transit-zone-by-geography.json'), get('data/policy/thiz-map-status.json')])
      .then(function (parts) {
        var tz = typeof window !== 'undefined' ? window.TransitZone : null;
        var out = summarize(geoid, parts[0], parts[1], now, tz && tz.designation);
        mount.innerHTML = out.html;
        mount.setAttribute('data-tz-state', out.state);
        return out;
      });
  }

  return { summarize: summarize, render: render, MAX_AGE_DAYS: MAX_AGE_DAYS };
}));
