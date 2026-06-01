/**
 * js/components/jurisdiction-boundaries.js
 * =========================================
 * Zoom-aware county + place boundary overlay for any Leaflet map in COHO.
 *
 * USAGE
 *   <script src="js/components/jurisdiction-boundaries.js"></script>
 *   <script>
 *     // After your map is initialized:
 *     window.JurisdictionBoundaries.attach(map, {
 *       showCounties: true,   // default true — always visible
 *       showPlaces:   true,   // default true — visible from zoom >= placesMinZoom
 *       placesMinZoom: 9,     // default 9 — county-fits-screen scale
 *       countyStyle: {...},   // optional Leaflet Path style override
 *       placeStyle:  {...},   // optional
 *       cdpStyle:    {...},   // optional — CDPs styled differently
 *       interactive: false    // default false — overlay is decorative
 *     });
 *   </script>
 *
 * DATA SOURCES
 *   data/co-county-boundaries.json    — 64 CO counties (always loaded)
 *   data/co-place-boundaries.geojson  — 273 incorporated + 211 CDP places
 *     (built by scripts/build_co_place_boundaries.py from Census TIGERweb)
 *
 * The component is idempotent: calling attach() multiple times on the
 * same map is safe — repeat calls just refresh style/options.
 */
(function (global) {
  'use strict';

  if (global.JurisdictionBoundaries) return; // already loaded

  // ---------------------------------------------------------------------
  // Default styles — tuned to be visible but unobtrusive over basemap
  // ---------------------------------------------------------------------
  var DEFAULT_COUNTY_STYLE = {
    color: '#475569',          // slate-600
    weight: 1.6,
    opacity: 0.85,
    fillOpacity: 0,
    interactive: false,
  };
  var DEFAULT_PLACE_STYLE = {
    color: '#0ea5e9',          // sky-500 — distinct from county slate
    weight: 1.4,
    opacity: 0.9,
    fillColor: '#0ea5e9',
    fillOpacity: 0.04,
    interactive: false,
  };
  var DEFAULT_CDP_STYLE = {
    color: '#9333ea',          // purple-600 — distinct from places
    weight: 1.1,
    opacity: 0.75,
    fillColor: '#9333ea',
    fillOpacity: 0.03,
    dashArray: '3 3',          // visually separate from incorporated
    interactive: false,
  };

  // ---------------------------------------------------------------------
  // Shared cache so multiple maps on the same page (rare but possible)
  // don't refetch.
  // ---------------------------------------------------------------------
  var _countyData = null;
  var _placeData = null;
  var _countyPromise = null;
  var _placePromise = null;

  function _resolvePath(p) {
    if (typeof global.resolveAssetUrl === 'function') return global.resolveAssetUrl(p);
    return p;
  }

  function _loadCounties() {
    if (_countyData) return Promise.resolve(_countyData);
    if (_countyPromise) return _countyPromise;
    _countyPromise = fetch(_resolvePath('data/co-county-boundaries.json'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { _countyData = d; return d; })
      .catch(function (e) { console.warn('[JurisdictionBoundaries] county fetch failed', e); return null; });
    return _countyPromise;
  }

  function _loadPlaces() {
    if (_placeData) return Promise.resolve(_placeData);
    if (_placePromise) return _placePromise;
    _placePromise = fetch(_resolvePath('data/co-place-boundaries.geojson'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { _placeData = d; return d; })
      .catch(function (e) { console.warn('[JurisdictionBoundaries] place fetch failed', e); return null; });
    return _placePromise;
  }

  // ---------------------------------------------------------------------
  // Per-map state, so multiple maps each get their own layer references.
  // ---------------------------------------------------------------------
  var _registry = new WeakMap();

  function attach(map, opts) {
    if (!map || !global.L) {
      console.warn('[JurisdictionBoundaries] no map or Leaflet');
      return;
    }
    opts = opts || {};
    var entry = _registry.get(map) || {};

    var showCounties  = opts.showCounties  !== false;
    var showPlaces    = opts.showPlaces    !== false;
    var showCdps      = opts.showCdps      !== false;
    var placesMinZoom = (opts.placesMinZoom != null) ? opts.placesMinZoom : 9;
    var cdpsMinZoom   = (opts.cdpsMinZoom   != null) ? opts.cdpsMinZoom   : 10;
    var countyStyle = Object.assign({}, DEFAULT_COUNTY_STYLE, opts.countyStyle || {});
    var placeStyle  = Object.assign({}, DEFAULT_PLACE_STYLE,  opts.placeStyle  || {});
    var cdpStyle    = Object.assign({}, DEFAULT_CDP_STYLE,    opts.cdpStyle    || {});

    // ---- Counties — always visible (when enabled)
    if (showCounties && !entry.countyLayer) {
      _loadCounties().then(function (gj) {
        if (!gj) return;
        entry.countyLayer = global.L.geoJSON(gj, { style: countyStyle, interactive: false });
        entry.countyLayer.addTo(map);
        // Make sure overlays render above tiles but below user markers
        if (entry.countyLayer.bringToBack) entry.countyLayer.bringToBack();
      });
    }

    // ---- Places (incorporated) + CDPs — zoom-gated
    function _updatePlaceVisibility() {
      var z = map.getZoom();
      if (entry.placeLayer)  {
        var wantPlace = showPlaces && z >= placesMinZoom;
        var hasPlace  = map.hasLayer(entry.placeLayer);
        if (wantPlace && !hasPlace) entry.placeLayer.addTo(map);
        else if (!wantPlace && hasPlace) map.removeLayer(entry.placeLayer);
      }
      if (entry.cdpLayer)  {
        var wantCdp = showCdps && z >= cdpsMinZoom;
        var hasCdp  = map.hasLayer(entry.cdpLayer);
        if (wantCdp && !hasCdp) entry.cdpLayer.addTo(map);
        else if (!wantCdp && hasCdp) map.removeLayer(entry.cdpLayer);
      }
    }

    if ((showPlaces || showCdps) && !entry.placeLayer) {
      _loadPlaces().then(function (gj) {
        if (!gj || !gj.features) return;
        // Split into two layer groups so we can independently toggle CDPs
        var placeFeats = [], cdpFeats = [];
        gj.features.forEach(function (f) {
          var t = f && f.properties && f.properties.type;
          if (t === 'cdp') cdpFeats.push(f);
          else placeFeats.push(f);
        });
        if (showPlaces && placeFeats.length) {
          entry.placeLayer = global.L.geoJSON(
            { type: 'FeatureCollection', features: placeFeats },
            { style: placeStyle, interactive: false }
          );
        }
        if (showCdps && cdpFeats.length) {
          entry.cdpLayer = global.L.geoJSON(
            { type: 'FeatureCollection', features: cdpFeats },
            { style: cdpStyle, interactive: false }
          );
        }
        _updatePlaceVisibility();
      });

      map.on('zoomend', _updatePlaceVisibility);
      entry._zoomHandler = _updatePlaceVisibility;
    }

    _registry.set(map, entry);
    return {
      detach: function () { detach(map); },
      getLayers: function () { return entry; },
    };
  }

  function detach(map) {
    var entry = _registry.get(map);
    if (!entry) return;
    ['countyLayer', 'placeLayer', 'cdpLayer'].forEach(function (k) {
      if (entry[k]) {
        try { map.removeLayer(entry[k]); } catch (_) {}
      }
    });
    if (entry._zoomHandler) {
      try { map.off('zoomend', entry._zoomHandler); } catch (_) {}
    }
    _registry.delete(map);
  }

  global.JurisdictionBoundaries = {
    attach: attach,
    detach: detach,
    DEFAULTS: {
      county: DEFAULT_COUNTY_STYLE,
      place: DEFAULT_PLACE_STYLE,
      cdp:   DEFAULT_CDP_STYLE,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
