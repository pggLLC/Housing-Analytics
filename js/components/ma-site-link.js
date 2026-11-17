/**
 * js/components/ma-site-link.js
 * deal-market-analysis.html only (written in by scripts/build-market-analysis-hub.mjs).
 *
 * Opens the page on a site that Market check (deal-hub.html#/market, hub/market.js) already placed:
 *   deal-market-analysis.html?geoid=<place or county>&site=<lat>,<lon>&sl=<the address as typed or found>
 *     [&tr=<tract numbers without the leading 08, dot-separated>&tl=<the market area's name on Market check>]
 *
 * Nothing here places a site or runs anything itself. Once the page's data has loaded, it types the point
 * into the page's own "Find a Colorado address" box as "lat, lon" and presses Find, which is what a person
 * pasting coordinates there does (js/market-analysis.js, _wireAddressSearch): the page checks the point is in
 * Colorado, places the marker and starts the analysis the way it does for a map click, in the method the page
 * has selected (the tract picker by default). So the site is a chosen site, never a town centre: QCT and DDA are
 * checked for it, unlike the ?auto=1 links, which place a jurisdiction centroid.
 *
 * It waits until after the page has moved the map to the place in ?geoid= (market-analysis.html moves it at
 * 0.8 s and 2.5 s), so the map ends on the site, then scrolls to the map, as the page's "Start here" link does.
 * Market check never sends ?auto=1 with a site.
 *
 * Then it runs the market area analysis (paul, 17 Nov 2026: the site "should [transfer] and run the pma"). With tr=,
 * the tract picker takes Market check's own tracts in place of its 4-mile auto-pick, the rationale box says where
 * they came from, and Run Analysis is pressed, as a person would after drawing the area. The page's own steps still
 * apply: its once-a-month "screening tool, not a market study" notice asks to be accepted first. Without tr= (an
 * older link), the site is placed and Run Analysis is pressed on the auto-pick, where the page's own warning about
 * an unedited 4-mile ring asks first.
 */
(function () {
  'use strict';

  var CO = { latMin: 36.9, latMax: 41.1, lonMin: -109.1, lonMax: -101.9 };   // as js/market-analysis.js checks
  var AFTER_MS = 3000;

  function site() {
    var sp;
    try { sp = new URLSearchParams(location.search); } catch (_) { return null; }
    var m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(sp.get('site') || '');
    if (!m) return null;
    var lat = parseFloat(m[1]), lon = parseFloat(m[2]);
    if (!isFinite(lat) || !isFinite(lon) || lat < CO.latMin || lat > CO.latMax || lon < CO.lonMin || lon > CO.lonMax) return null;
    var tr = String(sp.get('tr') || '').split('.').filter(function (g) { return /^\d{9}$/.test(g); }).map(function (g) { return '08' + g; });
    return { lat: lat, lon: lon, label: String(sp.get('sl') || '').slice(0, 200), tracts: tr.slice(0, 400), areaLabel: String(sp.get('tl') || '').slice(0, 120) };
  }

  function press(s) {
    var input = document.getElementById('pmaAddressInput');
    var btn = document.getElementById('pmaAddressSearchBtn');
    var status = document.getElementById('pmaAddressStatus');
    if (!input || !btn) return;
    input.value = s.lat.toFixed(5) + ', ' + s.lon.toFixed(5);
    btn.click();
    if (s.label && status && /^Pin dropped/.test(status.textContent || '')) {
      status.textContent = 'Site from Market check: ' + s.label + '. ' + status.textContent;
    }
    run(s);
    // The map is far down the page (about 4,000 px on a phone). Take the reader to it, where the "Start here" link
    // above goes, unless they have already scrolled. The tract picker then draws its panels, which moves the map;
    // for ten seconds, follow it while the reader has not scrolled since. 'instant', as the page's sheet makes 'auto'
    // smooth, and a smooth scroll still moving would read as the reader scrolling.
    var map = document.getElementById('pmaMap');
    if (!map || typeof map.scrollIntoView !== 'function' || (window.scrollY || 0) >= 50) return;
    var top = function () { return Math.round(map.getBoundingClientRect().top + (window.scrollY || 0)); };
    map.scrollIntoView({ block: 'center', behavior: 'instant' });
    var at = window.scrollY, was = top(), ticks = 0;
    var timer = setInterval(function () {
      if (++ticks > 40 || Math.abs((window.scrollY || 0) - at) > 2) { clearInterval(timer); return; }
      if (top() !== was) { map.scrollIntoView({ block: 'center', behavior: 'instant' }); at = window.scrollY; was = top(); }
    }, 250);
  }

  // What the reason in the rationale box carries, whatever its wording: where the area came from, its name on Market
  // check and how many whole tracts it has. The test checks the written reason against this, not against a sentence.
  var FROM = 'Market check';
  var PREFIX = 'Market area from ' + FROM;
  var EARLIER = 'Earlier note, for the tracts before this market area came in: ';
  function reason(areaLabel, n) {
    return PREFIX + (areaLabel ? ': ' + areaLabel : '') + ', ' + n +
      (n === 1 ? ' whole census tract' : ' whole census tracts') + '. ' + FROM + ' lists each tract and the reason it is in or out.' +
      ' COHO screening rules, not a CHFA market area until a CHFA-approved analyst draws one.';
  }

  // The rationale that goes with an imported area. The tracts are replaced, so a reason left by an earlier import is
  // replaced too (it names another area). An analyst's own note is kept, below the new reason and marked as written for
  // the tracts before, so nothing they wrote is lost and nothing describes the wrong boundary as current.
  function rationaleFor(why, old) {
    old = String(old || '').trim();
    if (!old) return why;
    if (old.indexOf(PREFIX) === 0) {
      var k = old.indexOf('\n\n' + EARLIER);
      return k >= 0 ? why + old.slice(k) : why;
    }
    return why + '\n\n' + EARLIER + old;
  }

  // The picker has finished loading round this site. It says where it last loaded, so a rural site where nothing could
  // be picked (no tract centroid within 12 miles) still counts, and a load round an earlier point does not. A picker
  // from before readyAt: wait for its first tract, as before.
  function loaded(picker, s) {
    if (typeof picker.readyAt === 'function') {
      var at = picker.readyAt();
      return !!at && Math.abs(at.lat - s.lat) < 1e-3 && Math.abs(at.lon - s.lon) < 1e-3;
    }
    return typeof picker.getCount === 'function' && picker.getCount() > 0;
  }

  // Once the tract picker has loaded round the placed site, put Market check's tracts in, say where they came from,
  // and press Run Analysis. Gives up quietly after 30 seconds (the reader can still press it).
  function run(s) {
    var tries = 0;
    // The area is a set of tracts, so the analysis runs in tract mode. A returning visitor's saved run can restore the
    // Hybrid or Commuting tab, where the picker never loads; press the page's own Tract tab, which starts the picker at
    // the placed site (or makes placing it do so). A link without tracts leaves the restored method as it is.
    if (s.tracts.length) {
      var ui = window.PMAUIController, tab = document.querySelector('[data-pma-method="tract"]');
      if (ui && typeof ui.getMethod === 'function' && ui.getMethod() !== 'tract' && tab) tab.click();
    }
    (function wait() {
      var picker = window.PMATractPicker, btn = document.getElementById('pmaRunBtn');
      if (!picker || !btn || !loaded(picker, s)) {
        if (++tries < 60) setTimeout(wait, 500);
        return;
      }
      var n = s.tracts.length && typeof picker.setSelection === 'function' ? picker.setSelection(s.tracts) : 0;
      if (n > 0) {
        var ta = document.getElementById('pmaTractRationale');
        var old = (typeof picker.getRationale === 'function' ? picker.getRationale() : '') || (ta ? ta.value : '');
        var text = rationaleFor(reason(s.areaLabel, n), old);
        if (ta) {
          ta.value = text;
          try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) { /* old browser: set it directly below */ }
        }
        if (typeof picker.setRationale === 'function') picker.setRationale(text);
      }
      // Nothing to run on: no market area came with the link and nothing near the site could be picked. Run Analysis
      // is left for the reader, who can pick tracts on the map.
      if (typeof picker.getCount === 'function' && picker.getCount() < 1) return;
      btn.click();
    })();
  }

  window.MASiteLink = { FROM: FROM, reason: reason, rationaleFor: rationaleFor };

  function start() {
    var s = site();
    if (!s) return;
    var waited = new Promise(function (resolve) { setTimeout(resolve, AFTER_MS); });
    var tries = 0;
    (function ready() {
      var engine = window.PMAEngine;
      if (engine && typeof engine.whenDataReady === 'function') {
        Promise.all([engine.whenDataReady(), waited]).then(function () { press(s); });
      } else if (++tries < 120) {
        setTimeout(ready, 500);
      }
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
