/**
 * js/components/ma-site-link.js
 * deal-market-analysis.html only (written in by scripts/build-market-analysis-hub.mjs).
 *
 * Opens the page on a site that Market check (deal-hub.html#/market, hub/market.js) already placed:
 *   deal-market-analysis.html?geoid=<place or county>&site=<lat>,<lon>&sl=<the address as typed or found>
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
    return { lat: lat, lon: lon, label: String(sp.get('sl') || '').slice(0, 200) };
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
