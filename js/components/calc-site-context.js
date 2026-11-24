/**
 * js/components/calc-site-context.js
 * deal-calculator.html only.
 *
 * The two site notes the Market Analysis page used to pass into the calculator it carried on the page
 * (duplicate cleanup, 24 Nov 2026: the PMA pages now link here instead of drawing a second calculator):
 *   1. HUD QCT/DDA: "HUD data place this site in a QCT or DDA ..." (js/deal-calculator.js setDesignationContext)
 *   2. The HB26-1065 transit-zone (THIZ) state credit line, and the eligibility of a Transit Zone added credit
 *      (js/deal-calculator.js setTransitZoneContext)
 *
 * They need a chosen site, so they run only when the address carries one: ?site-lat=&site-lon= (the form the
 * Market Analysis link and Compare Sites already use; js/deal-calculator.js linkedSitePoint reads the same
 * parameters). The answers come from the same code and files the Market Analysis page uses, so the two pages
 * cannot disagree: HudEgis.checkDesignation (data/qct-colorado.json, data/dda-colorado.json) and
 * TransitZone.create(...).status (data/policy/thiz-map-status.json, OEDIT's zones once published, the statewide
 * stop file through DataService). Nothing here works out a figure.
 *
 * As on the Market Analysis page: an unknown designation leaves the calculator as the user set it, and nothing
 * applies a basis boost or a credit by itself (#2160, #1937).
 */
(function () {
  'use strict';
  var CO = { latMin: 36.9, latMax: 41.1, lonMin: -109.1, lonMax: -101.9 };   // as js/market-analysis.js checks

  function point() {
    var lp = typeof window.DealCalcLinkParams === 'function' ? window.DealCalcLinkParams() : null;
    if (!lp) { try { lp = new URLSearchParams(location.search); } catch (_) { return null; } }
    var lat = parseFloat(lp.get('site-lat')), lon = parseFloat(lp.get('site-lon'));
    if (!isFinite(lat) || !isFinite(lon)) return null;
    if (lat < CO.latMin || lat > CO.latMax || lon < CO.lonMin || lon > CO.lonMax) return null;
    return { lat: lat, lon: lon };
  }

  // The calculator draws its notes once it is mounted; both setters are no-ops before that.
  function whenMounted(fn) {
    var tries = 0;
    (function wait() {
      var dc = window.__DealCalc;
      if (dc && document.getElementById('dc-qct-dda-note') && document.getElementById('dc-tz-note')) { fn(dc); return; }
      if (++tries < 120) setTimeout(wait, 250);
    }());
  }

  function getJSON(url) {
    var DS = window.DataService;
    if (DS && typeof DS.getJSON === 'function') return DS.getJSON(url);
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  function designation(p, dc) {
    var H = window.HudEgis;
    if (!H || typeof H.checkDesignation !== 'function') return;
    var DS = window.DataService;
    var base = function (f) { return DS && typeof DS.baseData === 'function' ? DS.baseData(f) : 'data/' + f; };
    // Load both layers here rather than wait on HudEgis's own start-up load, which runs only when DataService is
    // on the page first; loading twice is harmless (the second replaces the first with the same file).
    Promise.all([getJSON(base('qct-colorado.json')).catch(function () { return null; }),
                 getJSON(base('dda-colorado.json')).catch(function () { return null; })])
      .then(function (files) {
        if (files[0]) H.loadLocalQct(files[0]);
        if (files[1]) H.loadLocalDda(files[1]);
        var r = H.checkDesignation(p.lat, p.lon);
        // Only a known answer is passed on (as js/market-analysis/market-analysis-controller.js does).
        if (r && typeof r.basis_boost_eligible === 'boolean') dc.setDesignationContext(r.basis_boost_eligible);
      })
      .catch(function () {});
  }

  function transit(p, dc) {
    var TZ = window.TransitZone, DS = window.DataService;
    if (!TZ || typeof TZ.create !== 'function') return;
    var statusP = DS && typeof DS.fetchTransitZoneStatus === 'function'
      ? DS.fetchTransitZoneStatus().then(function (r) { return r.mapStatus; })
      : getJSON('data/policy/thiz-map-status.json').catch(function () { return null; });
    var stopsP = DS && typeof DS.fetchTransitStops === 'function'
      ? DS.fetchTransitStops().then(function (r) { return r.geojson || null; }).catch(function () { return null; })
      : getJSON('data/amenities/transit_stops_statewide_co.geojson').catch(function () { return null; });
    statusP.then(function (status) {
      // OEDIT's zone polygons, once the status file says they are published and names a file under data/
      // (the same rule as js/market-analysis.js _tzLoadZones).
      var file = status && status.status === 'published' ? status.zones_file : null;
      var ok = typeof file === 'string' && /^data\/[\w\/.-]+\.(geo)?json$/.test(file) && file.indexOf('..') === -1;
      var zonesP = ok ? getJSON(file).catch(function () { return null; }) : Promise.resolve(null);
      return Promise.all([zonesP, stopsP]).then(function (x) {
        var r = TZ.create({ stops: x[1], mapStatus: status || null, zones: x[0] }).status(p.lat, p.lon, 'site');
        dc.setTransitZoneContext(r || null);
      });
    }).catch(function () {});
  }

  function start() {
    var p = point();
    if (!p) return;
    whenMounted(function (dc) { designation(p, dc); transit(p, dc); });
  }

  window.CalcSiteContext = { point: point };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
