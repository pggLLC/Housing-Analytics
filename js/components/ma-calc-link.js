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
 *   deal-calculator.html[?geoid=<the page's place>][&site-lat=<lat>&site-lon=<lon>]
 * site-lat/site-lon are the form Compare Sites already uses (js/market-analysis/site-comparison.js). They are sent
 * only for a site the person chose (a map click, an address, a Market check site), never for a town centre (the
 * ?auto=1 links place one), so the calculator's county and its QCT/DDA and transit-zone notes are for a real site.
 * The calculator works out those two notes itself from the point (js/components/calc-site-context.js).
 * The Subject Project (homes, sizes, income targets) is shared through the browser's storage, so it carries over
 * without being in the address.
 *
 * Back: before leaving, the page's own address is rewritten (history.replaceState, nothing is added to history)
 * to name the site and the market area's tracts, in the form the page already reads when it opens, so Back
 * returns to the same site and market area:
 *   deal-market-analysis.html  ?site=<lat>,<lon>&tr=<tracts without 08, dot-separated>  (js/components/ma-site-link.js)
 *   market-analysis.html       ?lat=<lat>&lon=<lon>                                     (js/market-analysis.js)
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

  function placeGeoid() {
    var sp;
    try { sp = new URLSearchParams(location.search); } catch (_) { return null; }
    var g = sp.get('geoid') || '';
    return /^08\d{3}(\d{2})?$/.test(g) ? g : null;
  }

  function href() {
    var p = new URLSearchParams(), g = placeGeoid(), s = chosenSite();
    if (g) p.set('geoid', g);
    if (s) { p.set('site-lat', Number(s.lat).toFixed(6)); p.set('site-lon', Number(s.lon).toFixed(6)); }
    var q = p.toString();
    return CALC + (q ? '?' + q : '');
  }

  function tracts() {
    var T = window.PMATractPicker;
    var g = T && typeof T.getSelectedGeoids === 'function' ? T.getSelectedGeoids() : [];
    return (Array.isArray(g) ? g : []).map(String).filter(function (x) { return /^08\d{9}$/.test(x); })
      .map(function (x) { return x.slice(2); }).slice(0, 400);
  }

  function keepPlaceForBack() {
    var s = chosenSite();
    if (!s || !window.history || typeof history.replaceState !== 'function') return;
    var sp;
    try { sp = new URLSearchParams(location.search); } catch (_) { return; }
    var lat = Number(s.lat).toFixed(5), lon = Number(s.lon).toFixed(5);
    if (document.querySelector('script[src*="ma-site-link"]')) {
      sp.set('site', lat + ',' + lon);
      var tr = tracts();
      if (tr.length) sp.set('tr', tr.join('.')); else sp.delete('tr');
    } else {
      sp.set('lat', lat); sp.set('lon', lon);
    }
    // A centroid link's auto=1 would place the town centre again in place of the site.
    sp.delete('auto');
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
