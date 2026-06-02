/**
 * js/components/census-link-geo.js — F114
 * ========================================
 * Rewrite static <a href="https://data.census.gov/table/..."> links and
 * data-source-url attributes so they include the correct ?g= geography
 * parameter for the currently-selected jurisdiction. Without this fix,
 * every hard-coded Census link on the site (mostly on the HNA page) points
 * at the table page with no geo filter, which silently defaults to the
 * entire United States — useless to anyone screening a Colorado place.
 *
 * Geography encoding (Census "g=" param):
 *   STATE_COUNTY_PLACE_TRACT
 *   0400000US08          → CO statewide
 *   0500000US08097       → Pitkin County  (state 08 + county 097)
 *   1600000US0867280     → Salida city    (state 08 + place 67280)
 *
 * Selection precedence:
 *   1. window.JurisdictionUrlContext.resolveSync() (URL ?fips= / ?geoid=)
 *   2. WorkflowState session jurisdiction (if SiteState is loaded)
 *   3. State (Colorado) — fallback
 *
 * Idempotent — re-runs safely on each invocation. Listens for the
 * jurisdiction-url-context:resolved event so it picks up the right geo
 * once the brief / OF / HNA dispatch their async resolution.
 */
(function (global) {
  'use strict';
  if (global.__censusLinkGeoLoaded) return;
  global.__censusLinkGeoLoaded = true;

  var STATE_FIPS_CO = '08';

  // Build the Census "g=" code for whatever geo we know about.
  // Returns null if nothing better than the state can be inferred.
  function geoCodeFor(ctx) {
    if (!ctx) return '0400000US' + STATE_FIPS_CO;
    var fips = String(ctx.fips || ctx.geoid || '').trim();
    var geoType = (ctx.geoType || '').toLowerCase();

    // Place / CDP — 7-digit place geoid (e.g. "0867280")
    if (/^\d{7}$/.test(fips) || geoType === 'place' || geoType === 'cdp') {
      var stateFp = fips.slice(0, 2) || STATE_FIPS_CO;
      var placeFp = fips.slice(2).padStart(5, '0');
      return '1600000US' + stateFp + placeFp;
    }
    // County — 5-digit FIPS (e.g. "08097")
    if (/^\d{5}$/.test(fips) || geoType === 'county') {
      return '0500000US' + fips;
    }
    // State — 2-digit FIPS
    if (/^\d{2}$/.test(fips) || geoType === 'state') {
      return '0400000US' + (fips || STATE_FIPS_CO);
    }
    return '0400000US' + STATE_FIPS_CO;
  }

  function appendGeoToUrl(urlStr, geoCode) {
    if (!urlStr || !geoCode) return urlStr;
    // Only rewrite data.census.gov/table/* and /profile* links
    if (!/data\.census\.gov\/(table|profile)/i.test(urlStr)) return urlStr;
    try {
      var u = new URL(urlStr, location.origin);
      // Don't clobber an existing g= parameter — assume the page wrote it on purpose
      if (u.searchParams.has('g')) return urlStr;
      u.searchParams.set('g', geoCode);
      return u.toString();
    } catch (e) {
      // Fallback for malformed URLs
      var sep = urlStr.indexOf('?') >= 0 ? '&' : '?';
      return urlStr + sep + 'g=' + encodeURIComponent(geoCode);
    }
  }

  function rewriteAll() {
    var ctx = null;
    try {
      ctx = global.JurisdictionUrlContext && global.JurisdictionUrlContext.resolveSync
        ? global.JurisdictionUrlContext.resolveSync()
        : null;
    } catch (e) { /* ignore */ }
    var geoCode = geoCodeFor(ctx);

    // <a href="https://data.census.gov/...">
    var anchors = document.querySelectorAll('a[href*="data.census.gov/"]');
    anchors.forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var rewritten = appendGeoToUrl(href, geoCode);
      if (rewritten !== href) a.setAttribute('href', rewritten);
    });

    // [data-source-url] (used by source-badge + data-status-footer components)
    var dataNodes = document.querySelectorAll('[data-source-url*="data.census.gov/"]');
    dataNodes.forEach(function (el) {
      var url = el.getAttribute('data-source-url') || '';
      var rewritten = appendGeoToUrl(url, geoCode);
      if (rewritten !== url) el.setAttribute('data-source-url', rewritten);
    });
  }

  // Initial pass on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', rewriteAll);
  } else {
    rewriteAll();
  }

  // Re-pass when the jurisdiction context resolves (async — e.g. brief loads
  // a jurisdiction by geoid after page paint).
  document.addEventListener('jurisdiction-url-context:resolved', rewriteAll);

  // Expose for manual triggering after dynamic DOM mutations
  global.CensusLinkGeo = { rewriteAll: rewriteAll, geoCodeFor: geoCodeFor };
})(typeof window !== 'undefined' ? window : this);
