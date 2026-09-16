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

  /** Labelled basemap. A LayerGroup unless CARTO is keyed, which bundles labels. */
  function labelled(tone, opts) {
    if (cartoKey()) return carto(tone === 'dark' ? 'dark_all' : 'light_all', opts);
    var prefix = tone === 'dark' ? 'World_Dark_Gray_' : 'World_Light_Gray_';
    return global.L.layerGroup([
      esri(prefix + 'Base', opts),
      esri(prefix + 'Reference', opts),
    ]);
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
