/**
 * geo-search.js — Nominatim geocoding helper for the Colorado Deep Dive map.
 * Wires the #geoSearchForm / #geoSearchInput search box to the Leaflet map
 * instance exposed on window.ColoradoDeepDiveMap.
 *
 * No API key required. Uses OSM Nominatim (rate-limited; ~5-10 req/s max).
 */
(function () {
  'use strict';

  function geocodeAndZoom(query, map) {
    if (!query || !map) return;
    var url = 'https://nominatim.openstreetmap.org/search?' +
      'q=' + encodeURIComponent(query + ', Colorado, USA') +
      '&format=json&limit=1&countrycodes=us';

    return fetch(url, {
      headers: {
        'Accept-Language': 'en',
        'User-Agent': 'HousingAnalyticsCO/1.0 (https://pggllc.github.io/Housing-Analytics/)',
      },
    })
      .then(function (r) { return r.json(); })
      .then(function (results) {
        if (!results || !results.length) {
          console.warn('[geo-search] No results for:', query);
          return;
        }
        var bb = results[0].boundingbox;
        if (bb) {
          map.fitBounds([
            [parseFloat(bb[0]), parseFloat(bb[2])],
            [parseFloat(bb[1]), parseFloat(bb[3])],
          ]);
        } else {
          map.setView([parseFloat(results[0].lat), parseFloat(results[0].lon)], 12);
        }
      })
      .catch(function (e) {
        console.warn('[geo-search] Geocoding failed:', e.message);
      });
  }

  function wireSearchForm() {
    var form  = document.getElementById('geoSearchForm');
    var input = document.getElementById('geoSearchInput');
    if (!form || !input) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = input.value.trim();
      if (!q) return;
      var map = window.ColoradoDeepDiveMap;
      if (!map) { console.warn('[geo-search] Map not ready yet.'); return; }
      geocodeAndZoom(q, map);
    });
  }

  // Expose helper for ad-hoc use
  window.geoSearch = { geocodeAndZoom: geocodeAndZoom };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireSearchForm);
  } else {
    wireSearchForm();
  }
}());
