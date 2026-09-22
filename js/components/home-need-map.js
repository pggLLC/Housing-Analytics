/**
 * js/components/home-need-map.js
 *
 * Homepage county map, shaded by the same overall_need_score composite and
 * severity bands used everywhere else on the site (the "Need Severity"
 * decision-strip tile, hna-comparative-analysis.html's ranking table) — not
 * a metric invented for this map. Static and non-interactive by design
 * (no scroll/drag/zoom) so it reads as a data view on an editorial page,
 * not an embedded tool: the homepage's own stylesheet says "no hero cards
 * or hover animations," and a draggable, scroll-hijacking map would be
 * exactly that.
 *
 * Click a county to go straight to its Needs Assessment — same destination
 * as the jurisdiction search and "Start a Housing Needs Assessment" CTA
 * above it.
 */
(function () {
  'use strict';

  var BOUNDARIES_PATH = 'data/co-county-boundaries.json';
  var RANKING_PATH = 'data/hna/ranking-index.json';

  // Literal hex, not CSS var() — matches the codebase's existing convention
  // for Leaflet layer styles (see OVERLAY_STYLES in js/market-analysis.js).
  // Leaflet's SVG renderer sets these as presentation attributes, not
  // inline style properties, and var() resolution there is less reliable
  // across browsers than in a stylesheet. Same bands, same colors, as the
  // decision-strip tiles and the composite-score cards elsewhere in HNA.
  //
  // index.html's .home-need-legend swatches must use these exact four hex
  // values too (also literal, not var(--good)/var(--accent)/etc — those
  // tokens are the site's general UI colors and are NOT these severity
  // colors, e.g. --accent is teal). Change a color here, change it there —
  // test/home-need-map-legend-colors.test.js checks the two stay in sync.
  var BANDS = [
    { min: 70, color: '#dc2626', label: 'Highest' },
    { min: 50, color: '#d97706', label: 'Elevated' },
    { min: 30, color: '#1d4ed8', label: 'Moderate' },
    { min: -Infinity, color: '#16a34a', label: 'Lower' },
  ];

  function bandFor(score) {
    for (var i = 0; i < BANDS.length; i++) {
      if (score >= BANDS[i].min) return BANDS[i];
    }
    return BANDS[BANDS.length - 1];
  }

  function fetcher(path) {
    if (typeof window.safeFetchJSON === 'function') return window.safeFetchJSON(path);
    return fetch(path).then(function (r) { return r.ok ? r.json() : null; });
  }

  function showFallback(mount) {
    // The map is additive context, not load-bearing — if either data file
    // fails, drop the mount quietly rather than show a broken box on the
    // homepage.
    if (mount) mount.closest('.home-opening__map').style.display = 'none';
  }

  function init() {
    var mount = document.getElementById('homeNeedMap');
    if (!mount || !window.L) return;

    Promise.all([fetcher(BOUNDARIES_PATH), fetcher(RANKING_PATH)])
      .then(function (results) {
        var boundaries = results[0];
        var ranking = results[1];
        if (!boundaries || !Array.isArray(boundaries.features) || !ranking) {
          showFallback(mount);
          return;
        }

        var scoreByGeoid = {};
        var rows = Array.isArray(ranking.rankings) ? ranking.rankings : [];
        rows.forEach(function (row) {
          if (row && row.type === 'county' && row.geoid && row.metrics) {
            var score = Number(row.metrics.overall_need_score);
            if (Number.isFinite(score)) scoreByGeoid[row.geoid] = score;
          }
        });

        var map = window.L.map(mount, {
          zoomControl: false,
          attributionControl: false,
          dragging: false,
          touchZoom: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          boxZoom: false,
          keyboard: false,
          tap: false,
          // Approximate Colorado center/zoom. Without an explicit initial
          // view, the map has no valid projection at the moment the
          // GeoJSON layer is added — L.Path computes each county's SVG
          // path immediately on add, against whatever transform exists at
          // that instant, and an invalid one collapses every path to the
          // degenerate "M0 0" (rendered but invisible). fitBounds() below
          // still refines to the data's exact extent; this just guarantees
          // there is never a view-less instant for the layer to project
          // against in the first place.
          center: [39.0, -105.5],
          zoom: 7,
        });

        var layer = window.L.geoJSON(boundaries, {
          style: function (feature) {
            var geoid = feature.properties && feature.properties.GEOID;
            var score = geoid != null ? scoreByGeoid[geoid] : null;
            var band = score != null ? bandFor(score) : null;
            return {
              color: '#fff',
              weight: 1,
              fillColor: band ? band.color : '#ccc',
              fillOpacity: band ? 0.75 : 0.25,
            };
          },
          onEachFeature: function (feature, featureLayer) {
            var props = feature.properties || {};
            var geoid = props.GEOID;
            var name = props.NAMELSAD || props.NAME || 'County';
            var score = geoid != null ? scoreByGeoid[geoid] : null;
            var band = score != null ? bandFor(score) : null;
            var tooltip = name + (score != null
              ? ': ' + score + '/100 need — ' + band.label
              : ': not scored');
            featureLayer.bindTooltip(tooltip, { sticky: true });
            if (geoid) {
              featureLayer.on('click', function () {
                window.location.href = 'hna-what-housing-exists.html?geoType=county&geoid=' + encodeURIComponent(geoid);
              });
              featureLayer.on('add', function () {
                var el = typeof featureLayer.getElement === 'function' ? featureLayer.getElement() : null;
                if (el) el.style.cursor = 'pointer';
              });
            }
          },
        }).addTo(map);

        var bounds = layer.getBounds();
        map.fitBounds(bounds, { padding: [6, 6] });

        // The layout collapses to one column at the 900px breakpoint, which
        // resizes #homeNeedMap itself (not just the window) — a live browser
        // resize past that point left Leaflet's cached container size stale
        // and threw "Invalid LatLng object: (NaN, NaN)" on the next internal
        // recalculation. invalidateSize() re-reads the container and keeps
        // the map centered; debounced so a drag-resize doesn't thrash it.
        var resizeTimer = null;
        window.addEventListener('resize', function () {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(function () {
            map.invalidateSize();
            map.fitBounds(bounds, { padding: [6, 6] });
          }, 150);
        });
      })
      .catch(function () {
        showFallback(mount);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
