/**
 * js/transit-zone-map.js — the map in the needs assessment's "Potential
 * location: transit zone (HB26-1065)" panel.
 *
 *   TransitZoneMap.render(mountEl, {
 *     geoid:     '0827425',                       // county (5) or place/CDP (7)
 *     name:      'Fruita',
 *     mapStatus: <data/policy/thiz-map-status.json>
 *   })  →  Promise<'ok' | 'unavailable' | 'superseded'>
 *
 * Draws three things, each in the legend:
 *   - every confirmed public fixed-route stop (data/hna/transit-zone-map.json),
 *   - the screening radius around those stops merged into one shape, built by
 *     scripts/market/build_transit_zone_map.py from the same stops and radius
 *     as the panel's share figures,
 *   - the selected geography's boundary.
 * A label on the map itself says the shading is a screen awaiting OEDIT's
 * zone map, so a screenshot of the map cannot be read as a designation.
 *
 * Absence is never a blank map: a missing data file, boundary or Leaflet
 * renders "Map unavailable" with the reason.
 */
(function (root) {
  'use strict';

  var MAP_FILE = 'data/hna/transit-zone-map.json';
  var COUNTY_FILE = 'data/co-county-boundaries.json';
  var PLACE_FILE = 'data/co-place-boundaries.geojson';
  var STATEWIDE = '08';
  // Statewide, 12,000+ stops would be one solid smear and a slow page; they
  // appear once the map is zoomed to about a county.
  var STATEWIDE_STOP_ZOOM = 9;

  var cache = {};
  function getJSON(url) {
    if (!cache[url]) {
      cache[url] = fetch(url).then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return cache[url];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  // Same rule as the main HNA map (hna-controller.js autoKey): the site's
  // dark-mode / light-mode classes, else the OS setting.
  function isDark() {
    var cl = document.documentElement.classList;
    if (cl.contains('dark-mode')) return true;
    if (cl.contains('light-mode')) return false;
    return !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function formatDate(iso) {
    // A bare date ('2026-10-22') is a calendar date; read as UTC midnight it
    // would print as the day before in Denver.
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) iso = iso + 'T12:00:00-06:00';
    var t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    return new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/Denver' });
  }

  function boundaryFor(geoid) {
    var id = String(geoid || '');
    // Statewide: every county line, so the state has a recognisable shape.
    if (id === STATEWIDE) return getJSON(COUNTY_FILE).then(function (gj) { return gj && gj.features ? gj : null; });
    var file = id.length === 5 ? COUNTY_FILE : PLACE_FILE;
    return getJSON(file).then(function (gj) {
      if (!gj || !gj.features) return null;
      for (var i = 0; i < gj.features.length; i++) {
        var p = gj.features[i].properties || {};
        if (String(p.GEOID || p.geoid || '') === id) return gj.features[i];
      }
      return null;
    });
  }

  // The statute's own words, from thiz-map-status.json statute_text, so the
  // map's caption and the status file cannot drift apart.
  function statuteLine(mapStatus) {
    var st = mapStatus && mapStatus.statute_text;
    if (!st || !st.zone || !st.facility) return '';
    return '<p class="tzm__rule" style="margin:.5rem 0 0;">' +
      'HB26-1065 defines a zone as “' + esc(st.zone.quote) + '” (' + esc(st.zone.cite) + '), and a transportation facility as “' +
      esc(st.facility.quote) + '” (' + esc(st.facility.cite) + '). It has no service-frequency test. ' +
      'This map shades ' + esc(String(mapStatus.zone_radius_miles)) + ' miles around every bus or rail stop that CDOT or a transit agency publishes. OEDIT will count only stations, ' +
      'so most zones should be smaller than the shading, but a planned station named in a transit plan could add a zone where no stop is published yet. ' +
      'Read the shading as a screen, not the zone.</p>';
  }

  function sourceLine(data, mapStatus) {
    var st = (mapStatus && mapStatus.statute_text) || {};
    var stopsDate = formatDate(data.meta && data.meta.stops_generated);
    return '<p class="tzm__source" style="color:var(--muted);font-size:.85rem;margin:.4rem 0 0;">' +
      'Source: stops from CDOT Statewide Transit Points and transit agency schedule feeds' +
      (stopsDate ? ' (stop file dated ' + esc(stopsDate) + ')' : '') +
      '; shading is ' + esc(String(data.meta.radius_miles)) + ' miles straight-line around each confirmed stop, merged; boundary from Census TIGERweb. ' +
      'Rule: ' + (st.source_url
        ? '<a href="' + esc(st.source_url) + '" target="_blank" rel="noopener">Session Laws of Colorado 2026, ch. 157</a>'
        : 'HB26-1065') +
      (st.checked ? ' (read ' + esc(formatDate(st.checked) || st.checked) + ')' : '') + '.</p>';
  }

  function legend(radius, statewide) {
    var accent = cssVar('--accent', '#096e65');
    var ink = isDark() ? '#e5e7eb' : '#1f2937';
    return '<ul class="tzm__legend" style="list-style:none;display:flex;flex-wrap:wrap;gap:.35rem 1rem;padding:0;margin:.2rem 0 .45rem;font-size:.9rem;">' +
      '<li><span aria-hidden="true" style="display:inline-block;width:14px;height:14px;vertical-align:-2px;margin-right:.35rem;border:2px solid ' + accent + ';background:' + accent + '40;border-radius:3px;"></span>Within ' + esc(String(radius)) + ' miles of a stop (screen)</li>' +
      '<li><span aria-hidden="true" style="display:inline-block;width:8px;height:8px;margin:0 .45rem 1px .2rem;border-radius:50%;background:' + ink + ';"></span>Confirmed transit stop' + (statewide ? ' (zoom in to see them)' : '') + '</li>' +
      '<li><span aria-hidden="true" style="display:inline-block;width:18px;height:0;vertical-align:4px;margin-right:.35rem;border-top:2px ' + (statewide ? 'solid' : 'dashed') + ' ' + ink + ';"></span>' + (statewide ? 'County line' : 'Boundary') + '</li>' +
      '</ul>';
  }

  // Follows thiz-map-status.json, as TransitZone.designation() does, so the
  // badge never says "awaiting" beside a note that the map is out.
  function badgeText(mapStatus) {
    return mapStatus && mapStatus.status === 'published'
      ? 'Screen only — check OEDIT’s published zone map'
      : 'Screen only — awaiting OEDIT confirmation';
  }

  function inBounds(b, lat, lon) {
    return lat >= b.getSouth() && lat <= b.getNorth() && lon >= b.getWest() && lon <= b.getEast();
  }

  var seq = 0;
  var current = null;   // the live map, removed before the next one is drawn
  var stopWatching = null;

  // Redraw when the site theme or the OS setting flips, as the main HNA map
  // does: basemap, swatches and line colours are all theme-dependent.
  function watchTheme(onFlip) {
    var was = isDark();
    function check() { if (isDark() !== was) { was = isDark(); onFlip(); } }
    var mo = null, mq = null;
    if (typeof root.MutationObserver === 'function') {
      mo = new root.MutationObserver(check);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
    if (root.matchMedia) {
      mq = root.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', check);
    }
    return function () {
      if (mo) mo.disconnect();
      if (mq && mq.removeEventListener) mq.removeEventListener('change', check);
    };
  }

  function render(mount, opts) {
    opts = opts || {};
    var mySeq = ++seq;
    if (current) { try { current.remove(); } catch (e) { /* already gone */ } current = null; }
    if (stopWatching) { stopWatching(); stopWatching = null; }
    if (!mount) return Promise.resolve('unavailable');
    var mapStatus = opts.mapStatus || null;

    function unavailable(reason) {
      if (mySeq !== seq) return 'superseded';
      mount.innerHTML = '<p class="tzm__unavailable" style="color:var(--muted);"><strong>Map unavailable.</strong> ' + esc(reason) + '</p>';
      mount.setAttribute('data-tzm-state', 'unavailable');
      return 'unavailable';
    }

    var L = root.L;
    if (!L || typeof L.map !== 'function') return Promise.resolve(unavailable('The mapping library did not load.'));
    mount.setAttribute('data-tzm-state', 'loading');
    mount.innerHTML = '<p style="color:var(--muted);">Loading the transit zone map…</p>';

    return Promise.all([getJSON(MAP_FILE), boundaryFor(opts.geoid)]).then(function (parts) {
      if (mySeq !== seq) return 'superseded';
      var data = parts[0], boundary = parts[1];
      if (!data || !data.zone || !Array.isArray(data.stops) || !data.meta) {
        return unavailable('The transit zone map file could not be read.');
      }
      if (!boundary) return unavailable('No boundary was found for this geography.');
      var statusRadius = mapStatus && mapStatus.zone_radius_miles;
      if (statusRadius != null && statusRadius !== data.meta.radius_miles) {
        return unavailable('The map was built for a ' + data.meta.radius_miles + '-mile radius but the screen now uses ' +
          statusRadius + ' miles; it will be redrawn at the next weekly data refresh.');
      }

      var name = opts.name || 'this area';
      var statewide = String(opts.geoid) === STATEWIDE;
      mount.innerHTML =
        '<figure class="tzm" style="margin:.2rem 0 .8rem;">' +
          '<figcaption style="font-weight:600;margin-bottom:.2rem;">Transit stops and the ' + esc(String(data.meta.radius_miles)) + '-mile screen ' + (statewide ? 'across ' : 'around ') + esc(name) + '</figcaption>' +
          legend(data.meta.radius_miles, statewide) +
          '<div class="tzm__map" role="img" aria-label="' + esc('Map of ' + name + ' with confirmed transit stops and the area within ' +
            data.meta.radius_miles + ' miles of them shaded. Awaiting OEDIT confirmation.') + '" ' +
            'style="height:min(62vh,380px);min-height:280px;width:100%;border-radius:8px;border:1px solid var(--border,#d0d7de);"></div>' +
          statuteLine(mapStatus) +
          sourceLine(data, mapStatus) +
        '</figure>';
      var el = mount.querySelector('.tzm__map');

      var dark = isDark();
      var accent = cssVar('--accent', '#096e65');
      var ink = dark ? '#e5e7eb' : '#1f2937';
      // The scroll wheel stays with the page, so scrolling past the map never
      // zooms it; dragging pans, since stops only appear once zoomed in.
      var map = L.map(el, { scrollWheelZoom: false, tap: false, zoomSnap: 0.25 });
      current = map;
      var base = root.COHOBasemaps ? (dark ? root.COHOBasemaps.dark() : root.COHOBasemaps.light()) : null;
      if (base) base.addTo(map);

      L.geoJSON({ type: 'Feature', geometry: data.zone, properties: {} }, {
        interactive: false,
        style: { color: accent, weight: 1.5, opacity: 0.9, fillColor: accent, fillOpacity: 0.25 }
      }).addTo(map);
      var outline = L.geoJSON(boundary, {
        interactive: false,
        style: statewide ? { color: ink, weight: 0.75, opacity: 0.5, fill: false }
                         : { color: ink, weight: 2, opacity: 0.9, dashArray: '6 5', fill: false }
      }).addTo(map);

      var bounds = outline.getBounds();
      var shown = statewide ? null : bounds.pad(0.35);
      // SVG, not canvas: the site's stylesheets size every <canvas> for
      // Chart.js (site-theme.css `canvas { width: 100% !important }`), which
      // collapses Leaflet's canvas layer to nothing.
      var renderer = L.svg({ padding: 0.3 });
      function drawStops(layer, area) {
        layer.clearLayers();
        var inView = data.stops.filter(function (s) { return inBounds(area, s[1], s[0]); });
        // A city with thousands of stops would be a solid mat of 5px dots;
        // smaller dots keep the street grid and the shading readable.
        var dense = inView.length > 400;
        inView.forEach(function (s) {
          L.circleMarker([s[1], s[0]], {
            renderer: renderer, interactive: false, radius: dense ? 1.5 : 2.5,
            color: dark ? '#111827' : '#ffffff', weight: dense ? 0 : 0.75, fillColor: ink, fillOpacity: dense ? 0.8 : 0.95
          }).addTo(layer);
        });
        return inView.length;
      }
      var stopLayer = L.layerGroup().addTo(map);
      var drawn = 0;
      if (statewide) {
        map.on('moveend', function () {
          drawn = map.getZoom() >= STATEWIDE_STOP_ZOOM ? drawStops(stopLayer, map.getBounds().pad(0.2)) : (stopLayer.clearLayers(), 0);
          mount.setAttribute('data-tzm-stops-drawn', String(drawn));
        });
      } else {
        drawn = drawStops(stopLayer, shown);
      }

      // On the map, not only below it: a screenshot keeps this.
      var Badge = L.Control.extend({
        options: { position: 'topright' },
        onAdd: function () {
          var d = L.DomUtil.create('div', 'tzm__badge');
          d.setAttribute('style', 'background:var(--card,#ffffff);color:var(--text,#1f2937);box-shadow:0 1px 3px rgba(0,0,0,.25);border-left:3px solid var(--warn,#d97706);' +
            'padding:.25rem .5rem;font-size:.8rem;font-weight:600;border-radius:4px;max-width:12rem;line-height:1.25;');
          d.textContent = badgeText(mapStatus);
          return d;
        }
      });
      map.addControl(new Badge());

      map.fitBounds(bounds, { padding: [12, 12] });
      // Re-measure when the container changes size (a phone rotating, a
      // section opening), or Leaflet keeps its first size and leaves part of
      // the map without tiles.
      if (typeof root.ResizeObserver === 'function') {
        // Only while this is the live map: a replaced map has no panes left.
        try { new root.ResizeObserver(function () { if (current === map) map.invalidateSize(); }).observe(el); } catch (e) { /* first size stands */ }
      }
      setTimeout(function () { if (current === map) map.invalidateSize(); }, 0);

      mount.setAttribute('data-tzm-state', 'ok');
      stopWatching = watchTheme(function () { render(mount, opts); });
      mount.setAttribute('data-tzm-stops-drawn', String(drawn));
      return 'ok';
    }).catch(function (err) {
      // A throw while drawing (bad geometry, a Leaflet error) must not leave
      // an empty map box behind.
      if (current) { try { current.remove(); } catch (e) { /* already gone */ } current = null; }
      return unavailable('The map could not be drawn' + (err && err.message ? ': ' + err.message : '') + '.');
    });
  }

  var api = { render: render, badgeText: badgeText, MAP_FILE: MAP_FILE };
  root.TransitZoneMap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
