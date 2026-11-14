/**
 * js/config/basemaps.js — one place that knows where map tiles come from.
 *
 * CARTO's anonymous basemap tiles are no longer usable. As of 2026-09 they
 * still return HTTP 200 with a valid PNG — with "API KEY REQUIRED ·
 * carto.com/basemaps/apikey" painted diagonally across the image. Status codes
 * and headers look healthy; only the pixels say otherwise, which is why this
 * reached production before anyone noticed.
 *
 * Seven tile URLs across six files pointed at CARTO. They now point here.
 *
 * Esri's Canvas basemaps replace them and need no key. Two differences that
 * matter:
 *
 *   LABELS ARE A SEPARATE LAYER. CARTO's `*_all` styles include place names;
 *   Esri splits them into a Base and a transparent Reference overlay, so the
 *   labelled variants are layer groups, not tile layers. `dark_nolabels` maps
 *   onto the bare Base.
 *
 *   NATIVE DETAIL STOPS AT z16. Past that Esri serves a grey "Map data not yet
 *   available" tile. maxNativeZoom keeps Leaflet upsampling z16 instead —
 *   softer when you zoom right in, but continuous, and markers stay put. A
 *   blank grey pane would read as a broken map.
 *
 * To move back to CARTO, set window.COHO_CARTO_API_KEY before this file loads
 * and the CARTO styles are used with the key appended. Nothing else changes.
 */
(function (global) {
  'use strict';

  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  var ESRI_ATTR = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; '
    + 'Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  var CARTO_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors '
    + '&copy; <a href="https://carto.com/">CARTO</a>';

  // Esri Canvas has no tiles above 16; Leaflet upsamples rather than blanking.
  var NATIVE_MAX = 16;
  var DISPLAY_MAX = 19;

  function cartoKey() {
    var k = global.COHO_CARTO_API_KEY;
    return (typeof k === 'string' && k.trim()) ? k.trim() : null;
  }

  function tiles(url, opts) {
    var o = opts || {};
    // Only set keys we actually have. Leaflet defaults `pane` to 'tilePane';
    // passing `pane: undefined` OVERRIDES that default with undefined, and the
    // layer then tries to appendChild into a pane that does not exist. The map
    // dies at init with "Cannot read properties of undefined". Same trap as
    // Number(null) — the absent value is not absent, it is a bad value.
    var options = { attribution: o.attribution, maxZoom: o.maxZoom || DISPLAY_MAX };
    if (o.maxNativeZoom != null) options.maxNativeZoom = o.maxNativeZoom;
    if (o.pane) options.pane = o.pane;
    if (o.opacity != null) options.opacity = o.opacity;
    return global.L.tileLayer(url, options);
  }

  function esri(service, opts) {
    return tiles(ESRI + service + '/MapServer/tile/{z}/{y}/{x}', {
      attribution: ESRI_ATTR,
      maxNativeZoom: NATIVE_MAX,
      maxZoom: (opts && opts.maxZoom) || DISPLAY_MAX,
      pane: opts && opts.pane,
    });
  }

  function carto(style, opts) {
    var key = cartoKey();
    var url = 'https://{s}.basemaps.cartocdn.com/' + style + '/{z}/{x}/{y}{r}.png'
      + (key ? '?api_key=' + encodeURIComponent(key) : '');
    return tiles(url, {
      attribution: CARTO_ATTR,
      maxZoom: (opts && opts.maxZoom) || DISPLAY_MAX,
      pane: opts && opts.pane,
    });
  }

  /**
   * Make a LayerGroup usable everywhere a basemap is expected.
   *
   * CARTO bundled labels into one tile layer. Esri splits them, so a labelled
   * basemap became an L.LayerGroup — and a LayerGroup is NOT a TileLayer. Two
   * things broke, both of them silently at first:
   *
   *   bringToBack()  — not a LayerGroup method. js/hna/hna-controller.js calls
   *                    it after every basemap swap, and threw
   *                    "activeBase.bringToBack is not a function".
   *   tile events    — a LayerGroup emits none, so the `once('tileerror')`
   *                    fallback to OSM in the same file could never fire. That
   *                    one threw nothing at all: the fallback just stopped
   *                    existing, which is worse.
   *
   * Rather than patch each call site, the group honours the contract a caller
   * already has with a basemap. Anything that worked with a CARTO tile layer
   * works with this.
   */
  function asBasemap(base, reference) {
    var group = global.L.layerGroup([base, reference]);

    // Order matters. bringToBack puts a layer BEHIND everything, so the last
    // one sent back ends up furthest back: labels first, then the base, leaves
    // the base underneath and the labels above it. Reversed, the labels would
    // be buried and the basemap would look unlabelled.
    group.bringToBack = function () {
      reference.bringToBack();
      base.bringToBack();
      return group;
    };
    group.bringToFront = function () {
      base.bringToFront();
      reference.bringToFront();
      return group;
    };
    group.setOpacity = function (v) {
      base.setOpacity(v);
      reference.setOpacity(v);
      return group;
    };

    // Re-emit the base layer's tile events so `on`/`once('tileerror')` still
    // reaches a caller. Only the base is watched: the label overlay failing is
    // not a reason to fall back to another provider.
    ['tileerror', 'tileload', 'load'].forEach(function (evt) {
      base.on(evt, function (e) { group.fire(evt, e); });
    });

    return group;
  }

  /** Labelled basemap. A LayerGroup unless CARTO is keyed, which bundles labels. */
  function labelled(tone, opts) {
    if (cartoKey()) return carto(tone === 'dark' ? 'dark_all' : 'light_all', opts);
    var prefix = tone === 'dark' ? 'World_Dark_Gray_' : 'World_Light_Gray_';
    return asBasemap(esri(prefix + 'Base', opts), esri(prefix + 'Reference', opts));
  }

  /** Bare basemap, no place names. */
  function unlabelled(tone, opts) {
    if (cartoKey()) return carto(tone === 'dark' ? 'dark_nolabels' : 'light_nolabels', opts);
    return esri(tone === 'dark' ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base', opts);
  }

  // ---- paul's map rule (11 Nov 2026): OpenStreetMap streets by default, Satellite on request ----
  // Every map opens on the OpenStreetMap street map, credited and linked, with a Satellite choice (Esri World
  // Imagery) and a scale bar. Esri World Street Map stands in tile by tile when an OSM tile fails. The OSM layer
  // sends referrerPolicy 'origin': the member site's Worker sends no Referer, and OSM refuses tiles without one.
  // The a/b/c hosts are the ones the member site's CSP allows (*.tile.openstreetmap.org).
  var OSM_ATTR = 'Map &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  var SAT_ATTR = 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics';
  var STREET_BACKUP = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/';
  var darkStyled = false;
  function darkStyle() {
    var doc = global.document;
    if (darkStyled || !doc || !doc.head) return;
    darkStyled = true;
    var st = doc.createElement('style');
    st.textContent = '.coho-street-dark img.leaflet-tile{filter:invert(1) hue-rotate(180deg) brightness(.95) contrast(.95) saturate(.6)}';
    doc.head.appendChild(st);
  }
  function isDark() {
    var d = global.document && global.document.documentElement;
    if (!d) return false;
    if (d.classList.contains('dark-mode') || d.getAttribute('data-theme') === 'dark') return true;
    if (d.classList.contains('light-mode') || d.getAttribute('data-theme') === 'light') return false;
    return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  /** OpenStreetMap streets. opts.dark (default: the page's theme) shows them dark. */
  function street(opts) {
    var o = opts || {};
    var dark = o.dark == null ? isDark() : !!o.dark;
    var options = { attribution: OSM_ATTR, maxZoom: o.maxZoom || DISPLAY_MAX, subdomains: 'abc', referrerPolicy: 'origin' };
    if (o.pane) options.pane = o.pane;
    if (dark) { darkStyle(); options.className = 'coho-street-dark'; }
    var layer = global.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', options);
    // One failed tile comes from Esri World Street Map instead; the rest stay OpenStreetMap.
    layer.on('tileerror', function (e) {
      var t = e.tile, c = e.coords;
      if (!t || !c || t.getAttribute('data-backup')) return;
      t.setAttribute('data-backup', '1');
      t.src = STREET_BACKUP + c.z + '/' + c.y + '/' + c.x;
    });
    return layer;
  }
  /** Esri World Imagery. */
  function satellite(opts) {
    var o = opts || {};
    var options = { attribution: SAT_ATTR, maxZoom: o.maxZoom || DISPLAY_MAX };
    if (o.pane) options.pane = o.pane;
    return global.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', options);
  }
  /**
   * Open a map on the street map and give it the Streets / Satellite switch and a scale bar in miles.
   * Returns { base, satellite, control }. opts.extra adds more base layers to the switch, by label.
   */
  function standard(map, opts) {
    var o = opts || {};
    var base = street(o), sat = satellite(o), layers = { 'Streets (OpenStreetMap)': base, 'Satellite (Esri)': sat };
    Object.keys(o.extra || {}).forEach(function (k) { layers[k] = o.extra[k]; });
    base.addTo(map);
    var control = global.L.control.layers(layers, null, { position: o.position || 'topright', collapsed: o.collapsed !== false }).addTo(map);
    if (o.scale !== false) global.L.control.scale({ imperial: true, metric: false, position: 'bottomleft' }).addTo(map);
    return { base: base, satellite: sat, control: control };
  }

  global.COHOBasemaps = {
    street: street,
    satellite: satellite,
    standard: standard,
    scale: function (map) { return global.L.control.scale({ imperial: true, metric: false, position: 'bottomleft' }).addTo(map); },
    STREET_ATTR: OSM_ATTR,
    SATELLITE_ATTR: SAT_ATTR,
    dark: function (opts) { return labelled('dark', opts); },
    light: function (opts) { return labelled('light', opts); },
    darkNoLabels: function (opts) { return unlabelled('dark', opts); },
    lightNoLabels: function (opts) { return unlabelled('light', opts); },
    attribution: function () { return cartoKey() ? CARTO_ATTR : ESRI_ATTR; },
    provider: function () { return cartoKey() ? 'carto' : 'esri'; },
    NATIVE_MAX: NATIVE_MAX,
    DISPLAY_MAX: DISPLAY_MAX,
  };
})(typeof window !== 'undefined' ? window : this);
