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

  global.COHOBasemaps = {
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
