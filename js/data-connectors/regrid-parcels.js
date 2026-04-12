/**
 * js/data-connectors/regrid-parcels.js
 * Regrid parcel data connector for the PMA Parcel & Zoning layer.
 *
 * When a Regrid API key is present (window.APP_CONFIG.REGRID_API_KEY), this
 * module fetches live parcel data from the Regrid v2 Parcels API, enabling
 * per-parcel multifamily suitability visualization.
 *
 * When the key is absent, it falls back to the pre-built local file:
 *   data/market/parcel_aggregates_co.json
 *
 * HOW TO ENABLE LIVE REGRID DATA:
 *   1. Obtain an API key at https://regrid.com/api
 *   2. Add REGRID_API_KEY to your GitHub repository secrets
 *   3. The deploy/generate workflows will inject it into js/config.js at
 *      build time (see scripts/inject-config.py).
 *   4. Alternatively, set window.APP_CONFIG.REGRID_API_KEY directly in
 *      js/config.js for local development (do NOT commit the key).
 *
 * Regrid v2 API reference:
 *   https://developers.regrid.com/reference/parcels-endpoint
 *   GET https://app.regrid.com/api/v2/parcels/point
 *     ?lat=<lat>&lon=<lon>&radius=<miles>&token=<key>
 *
 * Public API (window.RegridParcels):
 *   isAvailable()                             → boolean
 *   fetchParcels(bbox, options)               → Promise<Feature[]>
 *   fetchParcelsNearPoint(lat, lon, miles)    → Promise<Feature[]>
 *   classifyParcel(feature)                   → {mfCompatible, vacantOrUnderutilized, isPrivate}
 *
 * All returned parcels are GeoJSON Features with a `properties` object
 * containing standardized fields (see FIELD_MAP below).
 */
(function () {
  'use strict';

  /* ── Configuration ────────────────────────────────────────────────── */
  var REGRID_API_BASE = 'https://app.regrid.com/api/v2';
  var LOCAL_FALLBACK  = 'market/parcel_aggregates_co.json';

  /**
   * Map Regrid property fields to our internal schema.
   * Regrid field names vary by state; these are the Colorado standard fields.
   */
  var FIELD_MAP = {
    address:       'address',
    owner:         'owner',
    parcelId:      'parcelnumb',
    acres:         'll_gisacre',
    landUseCode:   'usedesc',
    zoning:        'zoning',
    ownerType:     'owner_type',
    vacant:        'vacant',
    year_built:    'yearbuilt',
    county:        'county',
    state:         'state'
  };

  /* ── Internal helpers ─────────────────────────────────────────────── */

  function _apiKey() {
    return (window.APP_CONFIG && window.APP_CONFIG.REGRID_API_KEY) || '';
  }

  function _toRad(deg) { return deg * Math.PI / 180; }

  function _haversine(lat1, lon1, lat2, lon2) {
    var R  = 3958.8;
    var dL = _toRad(lat2 - lat1);
    var dO = _toRad(lon2 - lon1);
    var a  = Math.sin(dL / 2) * Math.sin(dL / 2) +
             Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) *
             Math.sin(dO / 2) * Math.sin(dO / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Normalize a Regrid GeoJSON feature into our standard schema.
   */
  function _normalizeFeature(feature) {
    var p   = feature.properties || {};
    var out = {};
    Object.keys(FIELD_MAP).forEach(function (key) {
      out[key] = p[FIELD_MAP[key]] !== undefined ? p[FIELD_MAP[key]] : null;
    });
    return {
      type:       'Feature',
      geometry:   feature.geometry,
      properties: out
    };
  }

  /* ── Local fallback ───────────────────────────────────────────────── */

  function _localFallback(lat, lon, miles) {
    var DS = window.DataService;
    var fetcher;
    if (DS && typeof DS.getJSON === 'function' && typeof DS.baseData === 'function') {
      fetcher = DS.getJSON(DS.baseData(LOCAL_FALLBACK));
    } else {
      var doFetch = (typeof window.fetchWithTimeout === 'function')
        ? function () { return window.fetchWithTimeout(LOCAL_FALLBACK); }
        : function () { return fetch(LOCAL_FALLBACK); };
      fetcher = doFetch().then(function (r) { return r.ok ? r.json() : null; });
    }

    return fetcher.then(function (data) {
      var counties = (data && Array.isArray(data.counties)) ? data.counties : [];
      // Convert county aggregates to pseudo-Features for a consistent return shape
      return counties
        .filter(function (c) {
          var cLat = parseFloat(c.lat || c.centroid_lat);
          var cLon = parseFloat(c.lon || c.centroid_lon);
          return isFinite(cLat) && isFinite(cLon) &&
                 _haversine(lat, lon, cLat, cLon) <= (miles || 15);
        })
        .map(function (c) {
          return {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [
                parseFloat(c.lon || c.centroid_lon),
                parseFloat(c.lat || c.centroid_lat)
              ]
            },
            properties: {
              address:     null,
              owner:       null,
              parcelId:    null,
              acres:       null,
              landUseCode: c.dominant_use || null,
              zoning:      null,
              ownerType:   c.ownership_type || null,
              vacant:      null,
              year_built:  null,
              county:      c.county_name || c.name || null,
              state:       'CO',
              // Aggregated fields (not per-parcel)
              _aggregate:           true,
              _parcelCount:         c.parcel_count || 0,
              _developableParcels:  c.developable_parcels || 0,
              _compatScore:         null   // filled later if zoning data is merged
            }
          };
        });
    }).catch(function (err) {
      console.warn('[RegridParcels] Local fallback failed:', err && err.message);
      window.dataFetchErrors = window.dataFetchErrors || [];
      window.dataFetchErrors.push({
        source: 'RegridParcels', endpoint: 'localFallback', url: LOCAL_FALLBACK,
        error: (err && err.message) || String(err), ts: new Date().toISOString()
      });
      return [];
    });
  }

  /* ── Regrid API fetch ─────────────────────────────────────────────── */

  function _fetchFromRegrid(lat, lon, miles) {
    var key = _apiKey();
    if (!key) return Promise.resolve([]);

    var url = REGRID_API_BASE + '/parcels/point' +
      '?lat=' + encodeURIComponent(lat) +
      '&lon=' + encodeURIComponent(lon) +
      '&radius=' + encodeURIComponent(miles || 5) +
      '&token=' + encodeURIComponent(key) +
      '&fields=' + encodeURIComponent(Object.values(FIELD_MAP).join(',')) +
      '&limit=500';

    var doFetch = (typeof window.fetchWithTimeout === 'function')
      ? function () { return window.fetchWithTimeout(url); }
      : function () { return fetch(url); };

    return doFetch()
      .then(function (r) {
        if (!r.ok) throw new Error('Regrid API returned HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var features = (data && data.parcels && data.parcels.features)
          ? data.parcels.features
          : (Array.isArray(data && data.features) ? data.features : []);
        return features.map(_normalizeFeature);
      })
      .catch(function (err) {
        console.warn('[RegridParcels] API fetch failed, falling back to local data:', err && err.message);
        window.dataFetchErrors = window.dataFetchErrors || [];
        window.dataFetchErrors.push({
          source: 'RegridParcels', endpoint: 'regridAPI', url: url,
          error: (err && err.message) || String(err), ts: new Date().toISOString()
        });
        return _localFallback(lat, lon, miles);
      });
  }

  /* ── Parcel classification ────────────────────────────────────────── */

  /**
   * Classify a normalized parcel feature for MF suitability.
   * @param {object} feature — normalized GeoJSON Feature
   * @returns {{ mfCompatible: boolean, vacantOrUnderutilized: boolean, isPrivate: boolean, score: number }}
   */
  function classifyParcel(feature) {
    var p = feature.properties || {};

    var landUse  = (p.landUseCode || '').toLowerCase();
    var ownerType= (p.ownerType   || '').toLowerCase();
    var zoning   = (p.zoning      || '').toLowerCase();
    var vacant   = p.vacant;

    // Ownership: private vs. government/institutional
    var isPrivate = ownerType !== 'government' && ownerType !== 'institutional' &&
                    ownerType !== 'public' && ownerType !== 'nonprofit';

    // Vacant or underutilized land
    var isVacant = vacant === true || vacant === '1' ||
                   landUse.indexOf('vacant') !== -1 ||
                   landUse.indexOf('undev') !== -1 ||
                   landUse.indexOf('agric') !== -1;

    // MF-compatible zoning keywords (Colorado municipal codes)
    var mfKeywords = [
      'rm', 'r-m', 'r2', 'r-2', 'r3', 'r-3', 'r4', 'r-4',
      'multi', 'apartment', 'mixed', 'mx', 'mu', 'urban',
      'pud', 'cmx', 'tmu', 'transit'
    ];
    var mfCompatible = mfKeywords.some(function (kw) {
      return zoning.indexOf(kw) !== -1 || landUse.indexOf(kw) !== -1;
    });

    // Composite score 0–3
    var score = (mfCompatible ? 1 : 0) + (isPrivate ? 1 : 0) + (isVacant ? 1 : 0);

    return {
      mfCompatible:         mfCompatible,
      vacantOrUnderutilized: isVacant,
      isPrivate:            isPrivate,
      score:                score
    };
  }

  /* ── Public API ───────────────────────────────────────────────────── */

  /**
   * Returns true when a live Regrid API key is configured.
   */
  function isAvailable() {
    return !!_apiKey();
  }

  /**
   * Fetch parcels near a point, using live Regrid API when key is set,
   * or the local fallback otherwise.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {number} [miles=5]
   * @returns {Promise<object[]>} GeoJSON Feature array
   */
  function fetchParcelsNearPoint(lat, lon, miles) {
    if (isAvailable()) {
      return _fetchFromRegrid(lat, lon, miles || 5);
    }
    return _localFallback(lat, lon, miles || 5);
  }

  /**
   * Fetch parcels within a bounding box. When live API is available,
   * converts to a center-point query; otherwise uses local fallback.
   *
   * @param {{ minLat, minLon, maxLat, maxLon }} bbox
   * @param {{ maxResults?: number }} [options]
   * @returns {Promise<object[]>}
   */
  function fetchParcels(bbox, options) {
    var centerLat = (bbox.minLat + bbox.maxLat) / 2;
    var centerLon = (bbox.minLon + bbox.maxLon) / 2;
    // Convert bbox half-diagonal to miles as search radius
    var radiusMiles = _haversine(bbox.minLat, bbox.minLon, bbox.maxLat, bbox.maxLon) / 2;
    return fetchParcelsNearPoint(centerLat, centerLon, Math.min(radiusMiles, 25));
  }

  /* ── Expose ───────────────────────────────────────────────────────── */
  window.RegridParcels = {
    isAvailable:          isAvailable,
    fetchParcels:         fetchParcels,
    fetchParcelsNearPoint: fetchParcelsNearPoint,
    classifyParcel:       classifyParcel
  };

}());
