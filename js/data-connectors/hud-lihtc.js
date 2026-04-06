/**
 * js/data-connectors/hud-lihtc.js
 * Centralized LIHTC data connector.
 *
 * Source priority (most complete first):
 *   1. data/chfa-lihtc.json          — 716 CO projects, weekly CI (CHFA schema)
 *   2. data/market/hud_lihtc_co.geojson — normalized derivative (HUD schema)
 *   3. Live CHFA ArcGIS FeatureServer  — 15 s timeout, public
 *   4. Live HUD ArcGIS FeatureServer   — 15 s timeout, public
 *   5. Embedded sentinel records       — ~60 hard-coded projects, last resort
 *
 * Field normalization: all sources are mapped to the CHFA canonical schema
 * (PROJECT, PROJ_CTY, N_UNITS, YR_ALLOC, CREDIT, LI_UNITS, YR_PIS, CNTY_FIPS,
 * CNTY_NAME, STATEFP, COUNTYFP, QCT, DDA) before returning.
 *
 * Exposes window.HudLihtc.
 */
(function () {
  'use strict';

  /** @const {number} Earth radius in miles for haversine calculations */
  var EARTH_RADIUS_MI = 3958.8;

  /** @const {string} CHFA ArcGIS FeatureServer base URL (Tier 3 live fallback).
   *  Both CHFA and HUD LIHTC services are hosted on the same ArcGIS Online org
   *  (VTyQ9soqVukalItT — HUD EGIS portal). CHFA publishes its data under the
   *  /LIHTC/ service name; HUD publishes the broader national database under
   *  /LIHTC_Properties/.  Tier 3 prefers the CHFA service because it is more
   *  current for Colorado; Tier 4 falls back to the HUD service.
   */
  var CHFA_ARCGIS_ENDPOINT = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer/0';

  /** @const {string} HUD ArcGIS FeatureServer base URL (Tier 4 live fallback).
   *  Resides in the same ArcGIS Online org as CHFA_ARCGIS_ENDPOINT but under
   *  the /LIHTC_Properties/ service, which is the broader HUD national database.
   */
  var HUD_ARCGIS_ENDPOINT = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC_Properties/FeatureServer/0';

  /** @const {number} Fetch timeout for live ArcGIS calls in milliseconds */
  var LIVE_TIMEOUT_MS = 15000;

  /**
   * WHERE clause used for ArcGIS FeatureServer queries.
   * Checks all three known representations of the Colorado state identifier
   * (postal abbreviation, FIPS code string, and full name) because different
   * service vintages use different encodings.
   * @const {string}
   */
  var ARCGIS_CO_WHERE = "Proj_St='CO' OR Proj_St='08' OR Proj_St='Colorado'";

  /**
   * Embedded sentinel — a representative geographic spread of Colorado LIHTC
   * projects used only when all four primary sources are unavailable.
   * Uses the canonical CHFA field schema (N_UNITS, PROJ_CTY, etc.).
   * @const {Object}
   */
  var EMBEDDED_SENTINEL = {type:'FeatureCollection',_source:'embedded',features:[
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9903,39.7392]},properties:{PROJECT:'Lincoln Park Apartments',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:120,LI_UNITS:120,YR_PIS:2018,YR_ALLOC:2016,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Denver',CNTY_FIPS:'08031',STATEFP:'08',COUNTYFP:'031'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8851,39.6784]},properties:{PROJECT:'Aurora Family Commons',PROJ_CTY:'Aurora',PROJ_ST:'CO',N_UNITS:150,LI_UNITS:150,YR_PIS:2021,YR_ALLOC:2019,CREDIT:'4%',QCT:0,DDA:1,CNTY_NAME:'Arapahoe',CNTY_FIPS:'08005',STATEFP:'08',COUNTYFP:'005'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.2705,40.0150]},properties:{PROJECT:'Boulder Commons',PROJ_CTY:'Boulder',PROJ_ST:'CO',N_UNITS:100,LI_UNITS:100,YR_PIS:2021,YR_ALLOC:2019,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Boulder',CNTY_FIPS:'08013',STATEFP:'08',COUNTYFP:'013'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8214,38.8339]},properties:{PROJECT:'Springs Family Village',PROJ_CTY:'Colorado Springs',PROJ_ST:'CO',N_UNITS:130,LI_UNITS:130,YR_PIS:2018,YR_ALLOC:2016,CREDIT:'9%',QCT:1,DDA:1,CNTY_NAME:'El Paso',CNTY_FIPS:'08041',STATEFP:'08',COUNTYFP:'041'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0844,40.5853]},properties:{PROJECT:'Fort Collins Commons',PROJ_CTY:'Fort Collins',PROJ_ST:'CO',N_UNITS:104,LI_UNITS:104,YR_PIS:2019,YR_ALLOC:2017,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Larimer',CNTY_FIPS:'08069',STATEFP:'08',COUNTYFP:'069'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.6914,40.4233]},properties:{PROJECT:'Greeley Flats',PROJ_CTY:'Greeley',PROJ_ST:'CO',N_UNITS:90,LI_UNITS:90,YR_PIS:2020,YR_ALLOC:2018,CREDIT:'9%',QCT:1,DDA:1,CNTY_NAME:'Weld',CNTY_FIPS:'08123',STATEFP:'08',COUNTYFP:'123'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.6091,38.2544]},properties:{PROJECT:'Pueblo Senior Manor',PROJ_CTY:'Pueblo',PROJ_ST:'CO',N_UNITS:80,LI_UNITS:80,YR_PIS:2017,YR_ALLOC:2015,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Pueblo',CNTY_FIPS:'08101',STATEFP:'08',COUNTYFP:'101'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-108.5506,39.0639]},properties:{PROJECT:'Grand Junction Crossroads',PROJ_CTY:'Grand Junction',PROJ_ST:'CO',N_UNITS:85,LI_UNITS:85,YR_PIS:2021,YR_ALLOC:2019,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Mesa',CNTY_FIPS:'08077',STATEFP:'08',COUNTYFP:'077'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.1311,39.7500]},properties:{PROJECT:'Lakewood Affordable Flats',PROJ_CTY:'Lakewood',PROJ_ST:'CO',N_UNITS:92,LI_UNITS:92,YR_PIS:2020,YR_ALLOC:2018,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Jefferson',CNTY_FIPS:'08059',STATEFP:'08',COUNTYFP:'059'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.8801,37.2753]},properties:{PROJECT:'Durango Commons',PROJ_CTY:'Durango',PROJ_ST:'CO',N_UNITS:62,LI_UNITS:62,YR_PIS:2021,YR_ALLOC:2019,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'La Plata',CNTY_FIPS:'08067',STATEFP:'08',COUNTYFP:'067'}}
  ]};

  /**
   * Stored array of normalized GeoJSON Feature objects.
   * @type {Array.<Object>}
   */
  var features = [];

  /**
   * Whether features have been loaded.
   * @type {boolean}
   */
  var loaded = false;

  /**
   * The source tier that successfully supplied the data.
   * @type {string|null}
   */
  var _source = null;

  /**
   * ISO-8601 UTC timestamp from the data file's fetchedAt field.
   * @type {string|null}
   */
  var _fetchedAt = null;

  /**
   * In-flight or resolved load promise — ensures load() is called only once.
   * @type {Promise|null}
   */
  var _loadPromise = null;

  /**
   * Converts degrees to radians.
   * @param {number} deg
   * @returns {number}
   */
  function toRad(deg) {
    return deg * Math.PI / 180;
  }

  /**
   * Computes the haversine great-circle distance in miles between two points.
   * @param {number} lat1
   * @param {number} lon1
   * @param {number} lat2
   * @param {number} lon2
   * @returns {number} Distance in miles.
   */
  function haversine(lat1, lon1, lat2, lon2) {
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Safely coerces a value to a finite number; returns 0 on failure.
   * @param {*} v
   * @returns {number}
   */
  function toNum(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  /* ── Internal helpers ─────────────────────────────────────────────── */

  /**
   * Wraps a promise with a timeout that rejects after ms milliseconds.
   * @param {Promise} promise
   * @param {number} ms
   * @returns {Promise}
   */
  function _withTimeout(promise, ms) {
    var timeout = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout after ' + ms + 'ms')); }, ms);
    });
    return Promise.race([promise, timeout]);
  }

  /**
   * Fetches a static JSON/GeoJSON file by path and resolves with the parsed
   * object plus `_source` and `_fetchedAt` metadata.
   * Rejects when the file is missing, empty, or has no features.
   * @param {string} path  Relative or absolute URL.
   * @param {string} sourceName  Human-readable source identifier.
   * @returns {Promise.<Object>}
   */
  function _tryStaticFile(path, sourceName) {
    return fetch(path).then(function (resp) {
      if (!resp.ok) { throw new Error('HTTP ' + resp.status); }
      return resp.json();
    }).then(function (data) {
      var feats = data && data.features;
      if (!Array.isArray(feats) || feats.length === 0) {
        throw new Error(sourceName + ': no features');
      }
      return {
        features:   feats,
        _source:    sourceName,
        _fetchedAt: data.fetchedAt || (data._metadata && data._metadata.fetchedAt) || null
      };
    });
  }

  /**
   * Queries a public ArcGIS FeatureServer for Colorado LIHTC projects.
   * Uses a single-page request (up to 2000 records) sufficient for
   * statewide CO data.  Rejects on timeout, HTTP error, or empty result.
   * @param {string} endpoint  FeatureServer layer URL (no trailing slash).
   * @param {string} sourceName
   * @returns {Promise.<Object>}
   */
  function _tryArcGIS(endpoint, sourceName) {
    var qs = [
      'where=' + encodeURIComponent(ARCGIS_CO_WHERE),
      'outFields=*',
      'f=geojson',
      'outSR=4326',
      'resultRecordCount=2000'
    ].join('&');
    var url = endpoint + '/query?' + qs;
    return _withTimeout(
      fetch(url).then(function (resp) {
        if (!resp.ok) { throw new Error('HTTP ' + resp.status); }
        return resp.json();
      }),
      LIVE_TIMEOUT_MS
    ).then(function (data) {
      var feats = data && data.features;
      if (!Array.isArray(feats) || feats.length === 0) {
        throw new Error(sourceName + ': no features');
      }
      return { features: feats, _source: sourceName, _fetchedAt: null };
    });
  }

  /**
   * Normalizes a GeoJSON Feature from any supported source schema to the
   * canonical CHFA schema.  The HUD schema uses different field names:
   *   PROJECT_NAME → PROJECT
   *   CITY         → PROJ_CTY
   *   TOTAL_UNITS  → N_UNITS
   *   YEAR_ALLOC   → YR_ALLOC
   *   CREDIT_PCT   → CREDIT
   * Normalization adds the CHFA-style fields alongside the originals so
   * existing callers that reference either name continue to work.
   * @param {Object} f  GeoJSON Feature
   * @returns {Object}  The same feature with normalized properties.
   */
  function _normalizeFeature(f) {
    if (!f || !f.properties) { return f; }
    var p = f.properties;
    // HUD → CHFA field mapping (only add if CHFA field is absent)
    if (!p.PROJECT   && p.PROJECT_NAME) { p.PROJECT   = p.PROJECT_NAME; }
    if (!p.PROJ_CTY  && p.CITY)         { p.PROJ_CTY  = p.CITY; }
    if (!p.N_UNITS   && p.TOTAL_UNITS)  { p.N_UNITS   = toNum(p.TOTAL_UNITS); }
    if (!p.YR_ALLOC  && p.YEAR_ALLOC)   { p.YR_ALLOC  = toNum(p.YEAR_ALLOC); }
    if (!p.CREDIT    && p.CREDIT_PCT)   { p.CREDIT    = p.CREDIT_PCT; }
    return f;
  }

  /* ── Public load function ─────────────────────────────────────────── */

  /**
   * Loads LIHTC features from the highest-priority source available.
   * Implements a 5-tier fallback:
   *   Tier 1 – data/chfa-lihtc.json          (716 projects, CHFA schema)
   *   Tier 2 – data/market/hud_lihtc_co.geojson (normalized derivative)
   *   Tier 3 – Live CHFA ArcGIS FeatureServer (15 s timeout)
   *   Tier 4 – Live HUD ArcGIS FeatureServer  (15 s timeout)
   *   Tier 5 – Embedded sentinel               (~10 hard-coded projects)
   *
   * The promise is memoised — repeated calls return the same result.
   * All loaded features are normalized to the CHFA canonical schema.
   *
   * @returns {Promise.<{features: Array, _source: string, _fetchedAt: string|null}>}
   */
  function load() {
    if (_loadPromise) { return _loadPromise; }

    _loadPromise = _tryStaticFile('data/chfa-lihtc.json', 'chfa-local')
      .catch(function () {
        console.warn('[HudLihtc] Tier 1 (data/chfa-lihtc.json) unavailable; trying Tier 2');
        return _tryStaticFile('data/market/hud_lihtc_co.geojson', 'hud-local');
      })
      .catch(function () {
        console.warn('[HudLihtc] Tier 2 (hud_lihtc_co.geojson) unavailable; trying live CHFA ArcGIS');
        return _tryArcGIS(CHFA_ARCGIS_ENDPOINT, 'chfa-arcgis');
      })
      .catch(function () {
        console.warn('[HudLihtc] Tier 3 (CHFA ArcGIS) unavailable; trying live HUD ArcGIS');
        return _tryArcGIS(HUD_ARCGIS_ENDPOINT, 'hud-arcgis');
      })
      .catch(function () {
        console.warn('[HudLihtc] All live sources failed; using embedded sentinel');
        return {
          features:   EMBEDDED_SENTINEL.features,
          _source:    'embedded',
          _fetchedAt: null
        };
      })
      .then(function (result) {
        var rawFeatures = Array.isArray(result) ? result : (result.features || []);
        features   = rawFeatures.map(_normalizeFeature);
        loaded     = features.length > 0;
        _source    = result._source    || 'unknown';
        _fetchedAt = result._fetchedAt || null;
        console.log('[HudLihtc] Loaded ' + features.length + ' features from ' + _source);
        return { features: features, _source: _source, _fetchedAt: _fetchedAt };
      });

    return _loadPromise;
  }

  /* ── loadFeatures (manual population) ────────────────────────────── */

  /**
   * Stores LIHTC GeoJSON features for subsequent queries.
   * Accepts a GeoJSON FeatureCollection or a plain array of Feature objects.
   * @param {Object|Array} geojson
   */
  function loadFeatures(geojson) {
    if (!geojson) {
      console.warn('[HudLihtc] loadFeatures: no data provided');
      return;
    }

    var raw;
    if (Array.isArray(geojson)) {
      raw = geojson;
    } else if (geojson.features && Array.isArray(geojson.features)) {
      raw = geojson.features;
    } else {
      console.warn('[HudLihtc] loadFeatures: unrecognized format; expected GeoJSON FeatureCollection or array');
      return;
    }

    features = raw.map(_normalizeFeature);
    loaded = features.length > 0;
    console.log('[HudLihtc] Loaded ' + features.length + ' LIHTC features');
  }

  /**
   * Returns all LIHTC features whose coordinates fall within the specified
   * radius of the given point.
   * Features must have geometry.coordinates in [longitude, latitude] order
   * (standard GeoJSON), or properties.LATITUDE / properties.LONGITUDE as
   * fallback.
   * @param {number} lat  Center latitude.
   * @param {number} lon  Center longitude.
   * @param {number} miles  Search radius in miles.
   * @returns {Array.<Object>} Matching GeoJSON Feature objects.
   */
  function getFeaturesInBuffer(lat, lon, miles) {
    if (!loaded || typeof lat !== 'number' || typeof lon !== 'number' || typeof miles !== 'number') {
      return [];
    }

    var results = [];
    for (var i = 0; i < features.length; i++) {
      var f = features[i];
      if (!f) { continue; }

      var fLat, fLon;
      if (f.geometry && f.geometry.coordinates && f.geometry.coordinates.length >= 2) {
        fLon = f.geometry.coordinates[0];
        fLat = f.geometry.coordinates[1];
      } else if (f.properties) {
        fLat = toNum(f.properties.LATITUDE  || f.properties.lat);
        fLon = toNum(f.properties.LONGITUDE || f.properties.lon);
      } else {
        continue;
      }

      if (typeof fLat !== 'number' || typeof fLon !== 'number') { continue; }
      if (haversine(lat, lon, fLat, fLon) <= miles) {
        results.push(f);
      }
    }
    return results;
  }

  /**
   * Computes summary statistics for an array of LIHTC feature objects.
   * @param {Array.<Object>} featureArr
   * @returns {{
   *   count: number,
   *   totalUnits: number,
   *   avgYearAlloc: number,
   *   unitsByAmi: { ami30: number, ami40: number, ami50: number, ami60: number, ami80: number }
   * }}
   */
  function getStats(featureArr) {
    var empty = {
      count: 0,
      totalUnits: 0,
      avgYearAlloc: 0,
      unitsByAmi: { ami30: 0, ami40: 0, ami50: 0, ami60: 0, ami80: 0 }
    };

    if (!Array.isArray(featureArr) || featureArr.length === 0) {
      return empty;
    }

    var totalUnits = 0;
    var yearSum = 0;
    var yearCount = 0;
    var ami30 = 0, ami40 = 0, ami50 = 0, ami60 = 0, ami80 = 0;

    for (var i = 0; i < featureArr.length; i++) {
      var f = featureArr[i];
      if (!f) { continue; }
      var p = f.properties || f;

      totalUnits += toNum(p.N_UNITS || p.TOTAL_UNITS || p.total_units || 0);

      var yr = toNum(p.YR_ALLOC || p.yr_alloc || p.YEAR_ALLOC || 0);
      if (yr > 0) {
        yearSum += yr;
        yearCount++;
      }

      // AMI-banded unit counts; fall back to LI_UNITS as proxy when unavailable
      var li = toNum(p.LI_UNITS || p.li_units || 0);
      ami30 += toNum(p.UNITS_30 || p.units_30 || 0);
      ami40 += toNum(p.UNITS_40 || p.units_40 || 0);
      ami50 += toNum(p.UNITS_50 || p.units_50 || li);
      ami60 += toNum(p.UNITS_60 || p.units_60 || 0);
      ami80 += toNum(p.UNITS_80 || p.units_80 || 0);
    }

    return {
      count: featureArr.length,
      totalUnits: totalUnits,
      avgYearAlloc: yearCount > 0 ? Math.round(yearSum / yearCount) : 0,
      unitsByAmi: {
        ami30: ami30,
        ami40: ami40,
        ami50: ami50,
        ami60: ami60,
        ami80: ami80
      }
    };
  }

  /**
   * Returns the density of affordable units per square mile for a set of
   * features within a known buffer area.
   * @param {Array.<Object>} featureArr
   * @param {number} bufferAreaSqMi  Area of the search buffer in square miles.
   * @returns {number} Units per square mile, or 0 if area is zero.
   */
  function getConcentration(featureArr, bufferAreaSqMi) {
    if (!bufferAreaSqMi || bufferAreaSqMi <= 0) { return 0; }
    var stats = getStats(featureArr);
    return parseFloat((stats.totalUnits / bufferAreaSqMi).toFixed(2));
  }

  /**
   * Returns whether LIHTC features have been loaded.
   * @returns {boolean}
   */
  function isLoaded() {
    return loaded;
  }

  /**
   * Returns a copy of all loaded (normalized) feature objects.
   * @returns {Array.<Object>}
   */
  function getFeatures() {
    return features.slice();
  }

  /**
   * Returns the source tier string for the loaded data
   * (e.g. 'chfa-local', 'hud-local', 'chfa-arcgis', 'hud-arcgis', 'embedded').
   * @returns {string|null}
   */
  function getSource() {
    return _source;
  }

  /**
   * Returns the ISO-8601 UTC fetchedAt timestamp from the data file, or null
   * when the data came from a live ArcGIS request or the embedded sentinel.
   * @returns {string|null}
   */
  function getFetchedAt() {
    return _fetchedAt;
  }

  window.HudLihtc = {
    load:                load,
    loadFeatures:        loadFeatures,
    getFeatures:         getFeatures,
    getFeaturesInBuffer: getFeaturesInBuffer,
    getStats:            getStats,
    getConcentration:    getConcentration,
    isLoaded:            isLoaded,
    getSource:           getSource,
    getFetchedAt:        getFetchedAt
  };

}());
