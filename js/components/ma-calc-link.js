/**
 * js/components/ma-calc-link.js
 * market-analysis.html and deal-market-analysis.html.
 *
 * Duplicate cleanup (24 Nov 2026): the Market Analysis pages used to draw a second copy of the Deal Calculator
 * (js/deal-calculator.js into #dealCalcMount). They now link to the one calculator, deal-calculator.html, which has
 * every input the copy had plus the for-sale mode, all five coverage stress cases, lease-up loss, the exports and the
 * path to Financials.
 *
 * Every <a data-ma-calc-link> on the page gets its address from the page's current state when it is shown, hovered,
 * focused or followed:
 *   deal-calculator.html[?geoid=<the page's place, from its ?fips= or ?geoid=>][&site-lat=<lat>&site-lon=<lon>]
 * site-lat/site-lon are the form Compare Sites already uses (js/market-analysis/site-comparison.js). They are sent
 * only for a site the person chose (a map click, an address, a Market check site), never for a town centre (the
 * ?auto=1 links place one), so the calculator's county and its QCT/DDA and transit-zone notes are for a real site.
 * The calculator works out those two notes itself from the point (js/components/calc-site-context.js).
 * The Subject Project (homes, sizes, income targets) is shared through the browser's storage, so it carries over
 * without being in the address.
 *
 * Back: before leaving, the page's own address is tidied (history.replaceState, nothing is added to history) so
 * Back returns to the same site and market area:
 *   - the site is named in the form the page reads when it opens:
 *       deal-market-analysis.html  ?site=<lat>,<lon>  (js/components/ma-site-link.js)
 *       market-analysis.html       ?lat=<lat>&lon=<lon> (js/market-analysis.js)
 *   - never its tracts: the tract picker keeps its own selection and note for the site and starts from them. A Market
 *     check link's tracts (?tr=) or a centroid's ?auto=1 are taken off, so they cannot replay over the reader's edits.
 *   - a site kept out of the address on purpose (Use my location) is left out.
 * Other parameters and the #section are kept. Nothing here computes a figure.
 */
(function () {
  'use strict';

  var CALC = 'deal-calculator.html';

  function chosenSite() {
    var C = window.MAController;
    var s = C && typeof C.getCurrentSite === 'function' ? C.getCurrentSite() : null;
    if (!s || typeof s.lat !== 'number' || typeof s.lon !== 'number' || !Number.isFinite(s.lat) || !Number.isFinite(s.lon) ||
        s.siteSource === 'jurisdiction_centroid') return null;
    return s;
  }

  // The place this page was opened for: ?fips= or ?geoid=, fips first, as js/components/jurisdiction-url-context.js
  // reads them (older links and the HNA's use ?fips=; Codex review of #2982). The calculator reads it as ?geoid=.
  function placeGeoid() {
    var sp;
    try { sp = new URLSearchParams(location.search); } catch (_) { return null; }
    var g = sp.get('fips') || sp.get('geoid') || '';
    return /^08\d{3}(\d{2})?$/.test(g) ? g : null;
  }

  function href() {
    var p = new URLSearchParams(), g = placeGeoid(), s = chosenSite();
    if (g) p.set('geoid', g);
    if (s) { p.set('site-lat', Number(s.lat).toFixed(6)); p.set('site-lon', Number(s.lon).toFixed(6)); }
    var q = p.toString();
    return CALC + (q ? '?' + q : '');
  }

  // What a Market check link (or a centroid link) adds that would replay over the reader's own market area on Back.
  var REPLAY = ['sl', 'tr', 'tl', 'auto'];

  function keepPlaceForBack() {
    var s = chosenSite();
    // A site kept out of the address on purpose (Use my location; js/pma-ui-controller.js) stays out.
    if (!s || window.CohoSiteTransient || !window.history || typeof history.replaceState !== 'function') return;
    var sp;
    try { sp = new URLSearchParams(location.search); } catch (_) { return; }
    var lat = Number(s.lat).toFixed(5), lon = Number(s.lon).toFixed(5);
    // The site only, never its tracts: the tract picker keeps its own selection and note for a site
    // (js/pma-tract-picker.js) and starts from them when the same site is placed again. Tracts in the address would be
    // imported as "from Market check" over the reader's edits and note (Codex review of #2982).
    REPLAY.forEach(function (k) { sp.delete(k); });
    if (document.querySelector('script[src*="ma-site-link"]')) sp.set('site', lat + ',' + lon);
    else { sp.set('lat', lat); sp.set('lon', lon); }
    try { history.replaceState(history.state, '', location.pathname + '?' + sp.toString() + location.hash); } catch (_) {}
  }

  function refresh() {
    var h = href(), s = chosenSite();
    document.querySelectorAll('a[data-ma-calc-link]').forEach(function (a) {
      a.setAttribute('href', h);
    });
    document.querySelectorAll('[data-ma-calc-site]').forEach(function (el) {
      el.textContent = s ? 'this site (' + Number(s.lat).toFixed(4) + ', ' + Number(s.lon).toFixed(4) + ')' : 'this place';
    });
  }

  function wire() {
    refresh();
    document.querySelectorAll('a[data-ma-calc-link]').forEach(function (a) {
      ['mouseenter', 'focus', 'touchstart'].forEach(function (ev) { a.addEventListener(ev, refresh, { passive: true }); });
      a.addEventListener('click', function () { refresh(); keepPlaceForBack(); });
    });
    ['pma-site-selected', 'pma:site-placed', 'ma:analysis-complete'].forEach(function (ev) {
      document.addEventListener(ev, function () { setTimeout(refresh, 0); });
    });
  }

  window.MACalcLink = { href: href };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
