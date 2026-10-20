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
  // County measures the map can switch to (rent, burden, vacancy, income,
  // home value, permits, and three gaps between incomes and housing costs).
  // Figures, sources and the grey-out rules for counties too uncertain to
  // rank live in js/county-measures.js, shared with the data map. Each
  // measure is cut into four equal-count groups (quartiles) and drawn in the
  // same four teal shades as the need bands, darkest = highest value.
  var CM = window.CountyMeasures;
  var INDICATORS = CM ? CM.FIELDS : {};
  var formatValue = CM ? CM.format : function () { return 'no data'; };

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
  //
  // Design pass (2026-10-19): one teal from light (lower need) to dark
  // (highest). The old green/blue/orange/red did not read as an order and
  // red against green fails for color-blind visitors.
  var BANDS = [
    { min: 70, color: '#0b4f48', label: 'Highest' },
    { min: 50, color: '#2f8f83', label: 'Elevated' },
    { min: 30, color: '#86c2b8', label: 'Moderate' },
    { min: -Infinity, color: '#ddf0ed', label: 'Lower' },
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
          // Fractional zoom so fitBounds fills the box instead of snapping
          // down to the next whole zoom level (which left the state small).
          zoomSnap: 0.1,
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

        var COLORS_LOW_TO_HIGH = BANDS.map(function (b) { return b.color; }).reverse();
        var countyNames = {};
        var mode = 'need';
        var indicatorValues = null; // { field: { geoid: value } }
        var unreliable = {};        // { field: { geoid: true } }
        var breaks = null;          // three cut points for the current field

        function needStyle(geoid) {
          var score = geoid != null ? scoreByGeoid[geoid] : null;
          var band = score != null ? bandFor(score) : null;
          return {
            color: '#5f7d79',
            weight: 0.6,
            fillColor: band ? band.color : '#ccc',
            fillOpacity: band ? 0.9 : 0.25,
          };
        }

        function quartileIndex(v) {
          if (v == null || !breaks) return -1;
          // A value equal to a cut belongs to the lower band, as the
          // legend's ranges ("0–35", then "35–96") read.
          if (v <= breaks[0]) return 0;
          if (v <= breaks[1]) return 1;
          if (v <= breaks[2]) return 2;
          return 3;
        }

        var GREY_STYLE = { color: '#5f7d79', weight: 0.6, fillColor: '#d5dad9', fillOpacity: 0.7 };

        function isUnreliable(geoid) {
          return !!(unreliable[mode] && unreliable[mode][geoid]);
        }

        function indicatorStyle(geoid) {
          if (isUnreliable(geoid)) return GREY_STYLE;
          var v = indicatorValues && indicatorValues[mode] ? indicatorValues[mode][geoid] : null;
          var i = quartileIndex(v);
          return {
            color: '#5f7d79',
            weight: 0.6,
            fillColor: i >= 0 ? COLORS_LOW_TO_HIGH[i] : '#ccc',
            fillOpacity: i >= 0 ? 0.9 : 0.25,
          };
        }

        function tooltipFor(geoid) {
          var name = countyNames[geoid] || 'County';
          if (mode === 'need') {
            var score = scoreByGeoid[geoid];
            return name + (score != null
              ? ': ' + score + '/100 need — ' + bandFor(score).label
              : ': not scored');
          }
          var ind = INDICATORS[mode];
          var v = indicatorValues && indicatorValues[mode] ? indicatorValues[mode][geoid] : null;
          if (isUnreliable(geoid)) return name + ': ' + formatValue(v, ind.fmt, ind.suffix) + ' — too uncertain to rank';
          return name + ': ' + formatValue(v, ind.fmt, ind.suffix);
        }

        var layer = window.L.geoJSON(boundaries, {
          style: function (feature) {
            return needStyle(feature.properties && feature.properties.GEOID);
          },
          onEachFeature: function (feature, featureLayer) {
            var props = feature.properties || {};
            var geoid = props.GEOID;
            countyNames[geoid] = props.NAMELSAD || props.NAME || 'County';
            featureLayer.bindTooltip(function () { return tooltipFor(geoid); }, { sticky: true });
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

        // Measure values load on first use (js/county-measures.js caches them).
        function loadIndicators(field) {
          if (!CM) return Promise.reject(new Error('county measures unavailable'));
          return CM.loadField(field, fetcher).then(function (res) {
            indicatorValues = res.values;
            unreliable = res.unreliable;
            return res.values;
          });
        }

        function computeBreaks(field) {
          var skip = unreliable[field] || {};
          var vals = Object.keys(indicatorValues[field]).filter(function (g) { return !skip[g]; })
            .map(function (g) { return indicatorValues[field][g]; })
            .sort(function (x, y) { return x - y; });
          var q = function (f) { return vals[Math.min(vals.length - 1, Math.floor(f * vals.length))]; };
          return [q(0.25), q(0.5), q(0.75), vals[0], vals[vals.length - 1]];
        }

        var wrap = mount.closest('.home-opening__map');
        var picker = wrap ? wrap.querySelector('#homeNeedMeasure') : null;
        var legendItems = wrap ? wrap.querySelectorAll('.home-need-legend__item') : [];
        var NEED_LABELS = BANDS.map(function (b) { return b.label; }).reverse();

        function setLegend(labels) {
          Array.prototype.forEach.call(legendItems, function (item, i) {
            var node = item.lastChild;
            if (node && node.nodeType === 3) node.textContent = labels[i];
          });
        }

        function showText(key) {
          if (!wrap) return;
          var greyNote = wrap.querySelector('.home-need-legend-nodata');
          if (greyNote) greyNote.hidden = !(key !== 'need' && unreliable[key] && Object.keys(unreliable[key]).length);
          Array.prototype.forEach.call(wrap.querySelectorAll('[data-measure-text]'), function (el) {
            el.hidden = el.getAttribute('data-measure-text') !== key;
          });
        }

        // The map is role="img": its label names the measure shown, and a
        // polite live region says when a picked measure has drawn.
        var NEED_ARIA = mount.getAttribute('aria-label') || '';
        var status = wrap ? wrap.querySelector('.home-need-status') : null;
        function announce(key) {
          var label = NEED_ARIA;
          if (key !== 'need' && picker) {
            var opt = picker.querySelector('option[value="' + key + '"]');
            label = 'Map of Colorado counties shaded by ' + (opt ? opt.textContent.toLowerCase() : 'the selected measure');
          }
          mount.setAttribute('aria-label', label);
          if (status) status.textContent = label.replace(/^Map of/, 'Showing a map of') + '.';
        }

        // Projection and inventory measures load slowly; a later pick wins.
        var request = 0;
        function setMode(next) {
          var mine = ++request;
          if (next === 'need' || !INDICATORS[next]) {
            mode = 'need';
            layer.setStyle(function (f) { return needStyle(f.properties && f.properties.GEOID); });
            setLegend(NEED_LABELS);
            showText('need');
            announce('need');
            return;
          }
          loadIndicators(next).then(function () {
            if (mine !== request) return;
            mode = next;
            var b = computeBreaks(next);
            breaks = b.slice(0, 3);
            var ind = INDICATORS[next];
            var f = function (v) { return formatValue(v, ind.fmt); };
            // A range whose ends round alike (many counties at 0) reads as one value.
            var range = function (lo, hi) { return f(lo) === f(hi) ? f(lo) : f(lo) + '–' + f(hi); };
            setLegend([range(b[3], b[0]), range(b[0], b[1]), range(b[1], b[2]), range(b[2], b[4])]);
            layer.setStyle(function (feat) { return indicatorStyle(feat.properties && feat.properties.GEOID); });
            showText(next);
            announce(next);
          }).catch(function () {
            if (mine !== request) return;
            if (picker) picker.value = 'need';
            setMode('need');
            if (status) status.textContent = 'That measure could not load; showing the housing need score.';
          });
        }

        if (picker) {
          picker.addEventListener('change', function () { setMode(picker.value); });
        }

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
