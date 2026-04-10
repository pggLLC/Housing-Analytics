/**
 * js/data-connectors/regrid-zoning.js
 *
 * Regrid Parcel & Zoning API connector for authoritative parcel-level
 * zoning data. Provides multifamily/townhome suitability scoring based
 * on actual zoning codes, lot size, setbacks, and FAR.
 *
 * Requires a Regrid API key (https://app.regrid.com/api/plans).
 * Set window.REGRID_API_KEY or pass key to init().
 *
 * Falls back to OSM land-use proxy (landuse_zoning_proxy_co.geojson)
 * when no API key is configured.
 *
 * Usage:
 *   <script src="js/data-connectors/regrid-zoning.js"></script>
 *   <script>
 *     RegridZoning.init({ apiKey: 'your-key' });
 *     RegridZoning.fetchParcels(lat, lon, radiusMiles).then(function(parcels) {
 *       // parcels = GeoJSON FeatureCollection with suitability scores
 *     });
 *   </script>
 *
 * Zoning subtype mapping (from Regrid Standardized Zoning Schema):
 *   Residential → Single Family | Two Family | Multi Family | Mobile Home Park
 *   Commercial  → General Commercial | Office | Retail
 *   Mixed Use   → Mixed Use
 *   Industrial  → Light Industrial | Heavy Industrial
 *
 * @see https://support.regrid.com/parcel-data/zoning-schema
 */
(function () {
  'use strict';

  var _apiKey = null;
  var _baseUrl = 'https://app.regrid.com/api/v2';
  var _tileUrl = 'https://tiles.regrid.com/api/v1';
  var _osmFallbackCache = null;
  var _initialized = false;

  /* ── Suitability scoring weights ──────────────────────────────────── */

  /**
   * Score a parcel for multifamily / townhome development suitability.
   * Returns 0-100 composite score.
   */
  function _scoreSuitability(props) {
    var score = 0;
    var zoneType = (props.zoning_type || '').toLowerCase();
    var zoneSub  = (props.zoning_subtype || '').toLowerCase();
    var landuse  = (props.lbcs_activity || props.usecode || '').toLowerCase();

    // 1. Zoning compatibility (0-40 points)
    if (zoneSub.indexOf('multi family') >= 0 || zoneSub.indexOf('multifamily') >= 0) {
      score += 40;
    } else if (zoneType === 'mixed use' || zoneSub.indexOf('mixed') >= 0) {
      score += 35;
    } else if (zoneSub.indexOf('two family') >= 0) {
      score += 25;
    } else if (zoneType === 'residential') {
      score += 10;  // single family — would need rezone
    } else if (zoneType === 'commercial') {
      score += 15;  // potential mixed-use conversion
    } else {
      score += 0;   // industrial, agricultural, etc.
    }

    // 2. Lot size (0-20 points)
    var acres = parseFloat(props.ll_gisacre || props.gisacre || 0);
    if (acres >= 2.0)      score += 20;  // large enough for apartment complex
    else if (acres >= 1.0) score += 18;  // good for mid-rise or townhome cluster
    else if (acres >= 0.5) score += 14;  // townhome viable
    else if (acres >= 0.25) score += 8;  // small infill
    else                    score += 3;   // micro lot

    // 3. FAR / density allowance (0-15 points)
    var far = parseFloat(props.zoning_max_far || 0);
    if (far >= 3.0)        score += 15;
    else if (far >= 1.5)   score += 12;
    else if (far >= 0.5)   score += 8;
    else if (far > 0)      score += 4;
    // If FAR not available, give partial credit
    else                    score += 5;

    // 4. Vacancy / improvement status (0-15 points)
    var improved = (props.improvval || props.ll_bldg_count || 0);
    if (parseInt(improved, 10) === 0) {
      score += 15;  // vacant / unimproved — easier to develop
    } else {
      score += 3;   // existing structures — demolition/renovation needed
    }

    // 5. Current use indicator (0-10 points)
    if (landuse.indexOf('vacant') >= 0 || landuse.indexOf('undeveloped') >= 0) {
      score += 10;
    } else if (landuse.indexOf('parking') >= 0) {
      score += 8;  // surface parking lots are prime redevelopment
    } else if (landuse.indexOf('commercial') >= 0) {
      score += 5;
    }

    return Math.min(100, Math.max(0, score));
  }

  /* ── API methods ──────────────────────────────────────────────────── */

  /**
   * Initialize the Regrid connector.
   * @param {Object} opts - { apiKey: string }
   */
  function init(opts) {
    opts = opts || {};
    _apiKey = opts.apiKey || window.REGRID_API_KEY || null;
    _initialized = true;

    if (_apiKey) {
      console.log('[regrid-zoning] Initialized with API key');
    } else {
      console.log('[regrid-zoning] No API key — will use OSM fallback');
    }
  }

  /**
   * Fetch parcels within radius of a point.
   * Returns a Promise resolving to GeoJSON FeatureCollection with
   * mf_suitability scores on each feature.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {number} radiusMiles - Search radius in miles
   * @returns {Promise<Object>} GeoJSON FeatureCollection
   */
  function fetchParcels(lat, lon, radiusMiles) {
    if (!_initialized) init({});

    if (!_apiKey) {
      return _osmFallback(lat, lon, radiusMiles);
    }

    return _regridFetch(lat, lon, radiusMiles);
  }

  /**
   * Fetch from Regrid API v2 (requires API key).
   */
  function _regridFetch(lat, lon, radiusMiles) {
    var radiusM = radiusMiles * 1609.34;
    var url = _baseUrl + '/parcels/point.json' +
      '?lat=' + lat +
      '&lon=' + lon +
      '&radius=' + Math.round(radiusM) +
      '&limit=500' +
      '&fields=fields[all]' +
      '&token=' + encodeURIComponent(_apiKey);

    return fetch(url, {
      headers: { 'Accept': 'application/json' }
    })
    .then(function (resp) {
      if (!resp.ok) {
        console.warn('[regrid-zoning] API error ' + resp.status + ', falling back to OSM');
        return _osmFallback(lat, lon, radiusMiles);
      }
      return resp.json();
    })
    .then(function (data) {
      // Regrid returns { parcels: { type: "FeatureCollection", features: [...] } }
      var fc = (data && data.parcels) ? data.parcels : data;
      if (!fc || !fc.features) {
        return _osmFallback(lat, lon, radiusMiles);
      }

      // Enrich each feature with suitability score
      fc.features.forEach(function (f) {
        var p = f.properties || {};
        p.mf_suitability = _scoreSuitability(p);
        p.data_source = 'regrid';
      });

      return fc;
    })
    .catch(function (err) {
      console.warn('[regrid-zoning] Fetch failed:', err);
      return _osmFallback(lat, lon, radiusMiles);
    });
  }

  /**
   * OSM land-use proxy fallback (no API key needed).
   * Loads pre-built GeoJSON and filters to radius.
   */
  function _osmFallback(lat, lon, radiusMiles) {
    if (_osmFallbackCache) {
      return Promise.resolve(_filterByRadius(_osmFallbackCache, lat, lon, radiusMiles));
    }

    var DS = window.DataService;
    var url = (DS && typeof DS.baseData === 'function')
      ? DS.baseData('market/landuse_zoning_proxy_co.geojson')
      : 'data/market/landuse_zoning_proxy_co.geojson';

    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('OSM fallback not found');
        return r.json();
      })
      .then(function (gj) {
        _osmFallbackCache = gj;
        return _filterByRadius(gj, lat, lon, radiusMiles);
      })
      .catch(function (err) {
        console.warn('[regrid-zoning] OSM fallback failed:', err);
        return { type: 'FeatureCollection', features: [] };
      });
  }

  /**
   * Filter GeoJSON features to those within radiusMiles of (lat, lon).
   */
  function _filterByRadius(gj, lat, lon, radiusMiles) {
    if (!gj || !gj.features) return { type: 'FeatureCollection', features: [] };

    var filtered = gj.features.filter(function (f) {
      if (!f.geometry || !f.geometry.coordinates) return false;
      var c = f.geometry.coordinates;
      var d = _haversine(lat, lon, c[1], c[0]);
      return d <= radiusMiles;
    });

    // Tag data source
    filtered.forEach(function (f) {
      if (f.properties) f.properties.data_source = 'osm_proxy';
    });

    return { type: 'FeatureCollection', features: filtered };
  }

  /**
   * Haversine distance in miles.
   */
  function _haversine(lat1, lon1, lat2, lon2) {
    var R = 3958.8;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Check if Regrid API key is configured.
   * @returns {boolean}
   */
  function hasApiKey() {
    return !!_apiKey;
  }

  /**
   * Get suitability score for a single parcel's properties.
   * Can be used externally for custom scoring.
   * @param {Object} props - Parcel properties
   * @returns {number} 0-100 suitability score
   */
  function scoreSuitability(props) {
    return _scoreSuitability(props);
  }

  /* ── Public API ───────────────────────────────────────────────────── */

  window.RegridZoning = {
    init:             init,
    fetchParcels:     fetchParcels,
    hasApiKey:        hasApiKey,
    scoreSuitability: scoreSuitability
  };
})();
