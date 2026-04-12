/**
 * js/data-service-portable.js
 * Centralised data-loading service.  Exposes window.DataService with:
 *
 *   DataService.getJSON(path)                  — fetch any JSON by full/resolved path
 *   DataService.getGeoJSON(path)               — alias for getJSON, for GeoJSON assets
 *   DataService.baseData(filename)             — resolve "data/<filename>"
 *   DataService.baseMaps(filename)             — resolve "maps/<filename>"
 *   DataService.fredObservations(seriesId, p)  — FRED API call with key injection
 *   DataService.census(url)                    — Census API call (key already in URL or injected)
 *
 * All local asset loads go through safeFetchJSON (defined in fetch-helper.js).
 * API keys are read from window.APP_CONFIG; a console warning is emitted if missing.
 */
(function () {
  'use strict';

  // Defer reading APP_CONFIG until first use so load order doesn't matter.
  function cfg(key) {
    var c = window.APP_CONFIG || {};
    var v = c[key];
    if (!v) console.warn('[DataService] APP_CONFIG.' + key + ' is not set. Some API calls may fail.');
    return v || '';
  }

  // Local asset helpers
  function baseData(filename) {
    // Normalize to prevent "data//foo" when filename starts with a slash
    var f = (filename || '').replace(/^\/+/, '');
    return 'data/' + f;
  }

  function baseMaps(filename) {
    return 'maps/' + (filename || '');
  }

  // Generic JSON loader — uses safeFetchJSON when available, plain fetch otherwise.
  function getJSON(path, options) {
    if (typeof window.safeFetchJSON === 'function') {
      return window.safeFetchJSON(path, options);
    }
    // Minimal fallback in case fetch-helper.js is not yet loaded
    return fetch(path, options).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
      return r.json();
    });
  }

  function getGeoJSON(path, options) {
    return getJSON(path, options);
  }

  /**
   * Fetch observations from the FRED API.
   * LIVE: Makes a real network request to api.stlouisfed.org.
   * Requires APP_CONFIG.FRED_API_KEY; logs and re-throws on failure so callers
   * (e.g. Promise.allSettled wrappers) can handle individual source failures.
   * @param {string} seriesId   - FRED series ID (e.g. "CPIAUCSL")
   * @param {object} [params]   - Additional query params (units, limit, sort_order, etc.)
   * @returns {Promise<object>} - Parsed FRED response
   */
  function fredObservations(seriesId, params) {
    var key = cfg('FRED_API_KEY');
    var base = 'https://api.stlouisfed.org/fred/series/observations';
    var p = Object.assign({
      series_id: seriesId,
      file_type: 'json',
      sort_order: 'desc',
      limit: '1'
    }, params || {});
    if (key) p.api_key = key;
    var qs = Object.keys(p).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]);
    }).join('&');
    var url = base + '?' + qs;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('FRED ' + seriesId + ' HTTP ' + r.status);
      return r.json();
    }).catch(function (err) {
      console.error('[DataService] FRED series "' + seriesId + '" fetch failed:', (err && err.message) || String(err));
      throw err;
    });
  }

  /**
   * Make a Census Bureau API call.
   * LIVE: Makes a real network request to api.census.gov.
   * If the URL already contains "&key=" the key is not appended again.
   * Logs and re-throws on failure so callers can handle source failures gracefully.
   * @param {string} url - Full Census API URL (key may or may not be present)
   * @returns {Promise<any>}
   */
  function census(url) {
    var fullUrl = url;
    if (fullUrl.indexOf('key=') === -1) {
      var key = cfg('CENSUS_API_KEY');
      if (key) {
        fullUrl += (fullUrl.indexOf('?') === -1 ? '?' : '&') + 'key=' + encodeURIComponent(key);
      }
    }
    return fetch(fullUrl).then(function (r) {
      if (!r.ok) throw new Error('Census API HTTP ' + r.status + ' for ' + url);
      return r.json();
    }).catch(function (err) {
      console.error('[DataService] Census API fetch failed:', (err && err.message) || String(err));
      throw err;
    });
  }

  /**
   * Fetch a non-JSON text asset (e.g. CSV, TXT) by relative path.
   * Uses resolveAssetUrl for base-path resolution, plain fetch for text.
   * @param {string} relativePath
   * @returns {Promise<string>}
   */
  function getText(relativePath) {
    var url = (typeof window.resolveAssetUrl === 'function')
      ? window.resolveAssetUrl(relativePath)
      : relativePath;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.text();
    });
  }

  /* ── PMA external data sources ─────────────────────────────────── */

  /**
   * Cached local LODES data (loaded once from data/market/lodes_co.json).
   * @type {Object|null}
   */
  var _localLodesData = null;
  var _localLodesLoading = null;

  /**
   * Load the local LODES tract data (from fetch_lodes.py output).
   * @returns {Promise<Object|null>}
   */
  function _loadLocalLodesData() {
    if (_localLodesData) return Promise.resolve(_localLodesData);
    if (_localLodesLoading) return _localLodesLoading;
    _localLodesLoading = getJSON(baseData('market/lodes_co.json'))
      .then(function (data) {
        if (data && data.tracts && data.tracts.length > 0) {
          // Build a geoid index for fast lookup
          var idx = {};
          var tracts = data.tracts;
          for (var i = 0; i < tracts.length; i++) {
            idx[tracts[i].geoid] = tracts[i];
          }
          data._idx = idx;
          _localLodesData = data;
          return data;
        }
        return null;
      })
      .catch(function () { return null; });
    return _localLodesLoading;
  }

  /**
   * Fetch LEHD LODES commuting and employment data.
   * Loads from local data/market/lodes_co.json (populated by fetch_lodes.py).
   * Falls back to LODES_PROXY_URL if configured, or empty result.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {number} radiusMiles
   * @param {string} [vintage]   - LODES vintage year
   * @returns {Promise<{workplaces: Array, commutingFlows: Array}>}
   */
  function fetchLODES(lat, lon, radiusMiles, vintage) {
    vintage = vintage || '2022';
    radiusMiles = radiusMiles || 5;

    // Try local file first
    return _loadLocalLodesData().then(function (localData) {
      if (localData && localData._idx) {
        // Find tracts within radius using centroids
        return _tractsInBbox({
          minLat: lat - (radiusMiles / 69),
          maxLat: lat + (radiusMiles / 69),
          minLon: lon - (radiusMiles / (69 * Math.cos(lat * Math.PI / 180))),
          maxLon: lon + (radiusMiles / (69 * Math.cos(lat * Math.PI / 180)))
        }).then(function (tractIds) {
          var workplaces = [];
          for (var i = 0; i < tractIds.length; i++) {
            var t = localData._idx[tractIds[i]];
            if (!t) continue;
            workplaces.push({
              id: t.geoid,
              lat: 0,   // centroids not in LODES; pma-commuting handles this
              lon: 0,
              jobCount: t.work_workers || t.totalJobs || 0,
              tractId: t.geoid,
              inCommuters: t.inCommuters || 0,
              outCommuters: t.outCommuters || 0,
              jobsHousingRatio: t.jobsHousingRatio || t.job_housing_ratio || 0,
              goodsJobs: t.goodsJobs || 0,
              tradeJobs: t.tradeJobs || 0,
              serviceJobs: t.serviceJobs || 0
            });
          }
          return { workplaces: workplaces, commutingFlows: [], _dataSource: 'local-lodes-co' };
        });
      }

      // Fall back to proxy if configured
      var proxyUrl = (window.APP_CONFIG || {}).LODES_PROXY_URL;
      if (!proxyUrl) {
        console.warn(
          '[fetchLODES] Local LODES file unavailable and APP_CONFIG.LODES_PROXY_URL is not set. ' +
          'Workforce/commuting dimension will use empty data. ' +
          'Set window.APP_CONFIG.LODES_PROXY_URL to a LODES proxy endpoint to enable live data.'
        );
        return { workplaces: [], commutingFlows: [] };
      }
      var fetcher = (typeof window.fetchWithTimeout === 'function')
        ? window.fetchWithTimeout
        : function (url) { return fetch(url); };
      var url = proxyUrl +
                '?lat=' + encodeURIComponent(lat) +
                '&lon=' + encodeURIComponent(lon) +
                '&r='   + encodeURIComponent(radiusMiles) +
                '&vintage=' + encodeURIComponent(vintage);
      return fetcher(url)
        .then(function (r) {
          if (!r.ok) throw new Error('LODES proxy HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          return { workplaces: data.workplaces || [], commutingFlows: data.flows || [] };
        })
        .catch(function () {
          return { workplaces: [], commutingFlows: [] };
        });
    });
  }

  /**
   * Fetch USGS National Hydrography Dataset (NHD) water features.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{waterBodies: Array, streams: Array}>}
   */
  function fetchUSGSHydrology(bbox) {
    if (!bbox) return Promise.resolve({ waterBodies: [], streams: [] });
    var fetcher = (typeof window.fetchWithTimeout === 'function')
      ? window.fetchWithTimeout
      : function (url) { return fetch(url); };
    var url = 'https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/2/query' +
              '?geometry=' + bbox.minLon + ',' + bbox.minLat + ',' + bbox.maxLon + ',' + bbox.maxLat +
              '&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=*&f=geojson';
    return fetcher(url)
      .then(function (r) {
        if (!r.ok) throw new Error('USGS NHD HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var features = (data && data.features) ? data.features : [];
        return {
          waterBodies: features.filter(function (f) { return f.geometry && f.geometry.type !== 'LineString'; }),
          streams:     features.filter(function (f) { return f.geometry && f.geometry.type === 'LineString'; })
        };
      })
      .catch(function () { return { waterBodies: [], streams: [] }; });
  }

  /**
   * Fetch NLCD land cover classification summary for a bounding box.
   * Uses the MRLC WMS/WCS service.
   * STUB: NLCD data is raster and requires server-side processing; returns empty
   * arrays until a raster-processing proxy is configured.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{landCover: Array, classifications: Array}>}
   */
  function fetchNLCDLandCover(bbox) {
    if (!bbox) return Promise.resolve({ landCover: [], classifications: [] });
    // NLCD data is raster; return empty stub (processing requires server-side)
    return Promise.resolve({ landCover: [], classifications: [] });
  }

  /**
   * Fetch state DOT highway data from the USGS National Transportation Dataset.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{highways: Array, majorRoutes: Array}>}
   */
  function fetchStateHighways(bbox) {
    if (!bbox) return Promise.resolve({ highways: [], majorRoutes: [] });
    var fetcher = (typeof window.fetchWithTimeout === 'function')
      ? window.fetchWithTimeout
      : function (url) { return fetch(url); };
    var url = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/2/query' +
              '?geometry=' + bbox.minLon + ',' + bbox.minLat + ',' + bbox.maxLon + ',' + bbox.maxLat +
              '&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=FULLNAME,RTTYP&f=geojson' +
              '&where=RTTYP+IN+(\'I\',\'U\',\'S\')';
    return fetcher(url)
      .then(function (r) {
        if (!r.ok) throw new Error('Tiger highways HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var features = (data && data.features) ? data.features : [];
        return {
          highways:    features,
          majorRoutes: features.filter(function (f) { return f.properties && f.properties.RTTYP === 'I'; })
        };
      })
      .catch(function () { return { highways: [], majorRoutes: [] }; });
  }

  /**
   * Fetch ED school attendance boundaries and NCES school data.
   * Uses the USGS ArcGIS service for attendance boundaries.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{schoolDistricts: Array, schools: Array}>}
   */
  function fetchSchoolBoundaries(bbox) {
    if (!bbox) return Promise.resolve({ schoolDistricts: [], schools: [] });
    var fetcher = (typeof window.fetchWithTimeout === 'function')
      ? window.fetchWithTimeout
      : function (url) { return fetch(url); };
    var url = 'https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/' +
              'Public_School_Location_201819/FeatureServer/0/query' +
              '?geometry=' + bbox.minLon + ',' + bbox.minLat + ',' + bbox.maxLon + ',' + bbox.maxLat +
              '&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=*&f=geojson';
    return fetcher(url)
      .then(function (r) {
        if (!r.ok) throw new Error('Schools HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var features = (data && data.features) ? data.features : [];
        return { schoolDistricts: features, schools: features };
      })
      .catch(function () { return { schoolDistricts: [], schools: [] }; });
  }

  /**
   * Fetch transit route data.
   * Loads from local transit_routes_co.geojson (GTFS-derived, 508 routes)
   * when available; falls back to empty array otherwise.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{transitRoutes: Array, serviceMetrics: object, _dataSource: string}>}
   */
  function fetchNTDData(bbox) {
    if (!bbox) return Promise.resolve({ transitRoutes: [], serviceMetrics: {}, _dataSource: 'none' });
    // Load local GTFS-derived transit routes GeoJSON
    return getJSON('data/market/transit_routes_co.geojson')
      .then(function (geojson) {
        var features = (geojson && geojson.features) ? geojson.features : [];
        if (!features.length) {
          return { transitRoutes: [], serviceMetrics: {}, _dataSource: 'stub' };
        }
        // Filter features within the bounding box
        var inBbox = features.filter(function (f) {
          if (!f.geometry || !f.geometry.coordinates) return false;
          var coords = f.geometry.coordinates;
          // Check if any coordinate falls within bbox
          return coords.some(function (c) {
            var lon = c[0], lat = c[1];
            return lat >= bbox.minLat && lat <= bbox.maxLat &&
                   lon >= bbox.minLon && lon <= bbox.maxLon;
          });
        });
        // Convert GeoJSON features to transit route objects for scoring
        var routes = inBbox.map(function (f) {
          var props = f.properties || {};
          var coords = f.geometry.coordinates || [];
          // Sample stops from the route linestring (every ~20th coordinate)
          var stops = [];
          var step = Math.max(1, Math.floor(coords.length / 10));
          for (var i = 0; i < coords.length; i += step) {
            stops.push({ lat: coords[i][1], lon: coords[i][0] });
          }
          // route_type: 0=tram, 1=subway, 2=rail, 3=bus
          var mode = { 0: 'Tram', 1: 'Subway', 2: 'Rail', 3: 'Bus' }[props.route_type] || 'Bus';
          // Estimate headway from route type (real headways need GTFS frequencies.txt)
          var headway = props.route_type <= 1 ? 10 : props.route_type === 2 ? 15 : 30;
          return {
            routeId:        props.shape_id || 'unknown',
            routeName:      (props.agency || 'Transit') + ' ' + mode,
            mode:           mode,
            headwayMinutes: headway,
            stops:          stops
          };
        });
        return {
          transitRoutes: routes,
          serviceMetrics: {
            totalRoutes: routes.length,
            busRoutes:   routes.filter(function (r) { return r.mode === 'Bus'; }).length,
            railRoutes:  routes.filter(function (r) { return r.mode !== 'Bus'; }).length
          },
          _dataSource: 'local-gtfs'
        };
      })
      .catch(function () {
        return { transitRoutes: [], serviceMetrics: {}, _dataSource: 'stub' };
      });
  }

  /* ── EPA SLD local cache ──────────────────────────────────────────── */
  var _epaSldCache = null;       // cached parsed JSON from epa_sld_co.json
  var _epaSldLoading = null;     // in-flight promise (avoid duplicate fetches)
  var _tractCentroidsCache = null;

  /**
   * Load the local EPA SLD block-group data file (fetched by fetch_epa_sld.py).
   * Returns the parsed JSON or null if the file is unavailable.
   */
  function _loadEpaSldLocal() {
    if (_epaSldCache) return Promise.resolve(_epaSldCache);
    if (_epaSldLoading) return _epaSldLoading;
    _epaSldLoading = getJSON('data/market/epa_sld_co.json')
      .then(function (data) {
        if (data && data.blockGroups) {
          _epaSldCache = data;
          console.log('[DataService] EPA SLD local: ' + Object.keys(data.blockGroups).length + ' block groups loaded');
        }
        return _epaSldCache;
      })
      .catch(function () {
        console.warn('[DataService] EPA SLD local file not found — will fall back to live API');
        _epaSldLoading = null;
        return null;
      });
    return _epaSldLoading;
  }

  /**
   * Load tract centroids for bbox-to-tract matching.
   */
  function _loadTractCentroids() {
    if (_tractCentroidsCache) return Promise.resolve(_tractCentroidsCache);
    return getJSON('data/market/tract_centroids_co.json')
      .then(function (data) {
        _tractCentroidsCache = (data && data.tracts) ? data.tracts : [];
        return _tractCentroidsCache;
      })
      .catch(function () { return []; });
  }

  /**
   * Given a bounding box, find tract GEOIDs whose centroids fall inside.
   */
  function _tractsInBbox(tracts, bbox) {
    return tracts.filter(function (t) {
      return t.lat >= bbox.minLat && t.lat <= bbox.maxLat &&
             t.lon >= bbox.minLon && t.lon <= bbox.maxLon;
    }).map(function (t) { return t.geoid; });
  }

  /**
   * Average EPA SLD metrics across block groups matching the given tract GEOIDs.
   * Block group GEOID (12 digits) shares first 11 digits with tract GEOID (11 digits).
   */
  function _averageEpaSldForTracts(sldData, tractGeoids) {
    var bgs = sldData.blockGroups;
    var sums = { walkability: 0, transitAccess: 0, jobAccess: 0, landUseMix: 0, empDensity: 0 };
    var counts = { walkability: 0, transitAccess: 0, jobAccess: 0, landUseMix: 0, empDensity: 0 };

    // Build a set of tract prefixes for fast lookup
    var tractSet = {};
    tractGeoids.forEach(function (g) { tractSet[g] = true; });

    var bgIds = Object.keys(bgs);
    for (var i = 0; i < bgIds.length; i++) {
      var bgId = bgIds[i];
      var tractPrefix = bgId.substring(0, 11);
      if (!tractSet[tractPrefix]) continue;
      var bg = bgs[bgId];
      if (bg.walkability != null)   { sums.walkability   += bg.walkability;   counts.walkability++;   }
      if (bg.transitAccess != null) { sums.transitAccess += bg.transitAccess; counts.transitAccess++; }
      if (bg.jobAccess != null)     { sums.jobAccess     += bg.jobAccess;     counts.jobAccess++;     }
      if (bg.landUseMix != null)    { sums.landUseMix    += bg.landUseMix;    counts.landUseMix++;    }
      if (bg.empDensity != null)    { sums.empDensity    += bg.empDensity;    counts.empDensity++;    }
    }

    var n = counts.walkability;
    if (n === 0) return null;

    return {
      transitAccessibility: counts.transitAccess > 0 ? Math.round(sums.transitAccess / counts.transitAccess) : null,
      walkScore:            counts.walkability > 0    ? Math.round(sums.walkability / counts.walkability)       : null,
      D3b:                  counts.walkability > 0    ? Math.round((sums.walkability / counts.walkability) * 100) / 100 : null,
      D4a:                  counts.transitAccess > 0  ? Math.round((sums.transitAccess / counts.transitAccess) * 100) / 100 : null,
      jobAccess:            counts.jobAccess > 0      ? Math.round(sums.jobAccess / counts.jobAccess)           : null,
      landUseMix:           counts.landUseMix > 0     ? Math.round((sums.landUseMix / counts.landUseMix) * 1000) / 1000 : null,
      empDensity:           counts.empDensity > 0     ? Math.round((sums.empDensity / counts.empDensity) * 100) / 100 : null,
      blockGroupCount:      n,
      _dataSource: 'epa-sld-local'
    };
  }

  /**
   * Fetch EPA Smart Location Database transit accessibility metrics.
   *
   * Strategy:
   *   1. Try local file (data/market/epa_sld_co.json) — match block groups
   *      to tracts whose centroids fall within the bounding box.
   *   2. Fall back to live EPA ArcGIS API if local file unavailable.
   *   3. Return null values if both fail.
   *
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @param {string} [tractFips] - Optional 11-digit tract GEOID for direct lookup
   * @returns {Promise<{transitAccessibility: number, walkScore: number, _dataSource: string}>}
   */
  function fetchEPASmartLocation(bbox, tractFips) {
    if (!bbox && !tractFips) return Promise.resolve({ transitAccessibility: null, walkScore: null, _dataSource: 'none' });

    // Try local file first
    return _loadEpaSldLocal().then(function (sldData) {
      if (!sldData) return null; // local file unavailable, will fall back

      // If tractFips provided directly, use it
      if (tractFips) {
        var result = _averageEpaSldForTracts(sldData, [tractFips]);
        if (result) return result;
      }

      // Otherwise find tracts in bbox via centroids
      if (bbox) {
        return _loadTractCentroids().then(function (tracts) {
          var tractGeoids = _tractsInBbox(tracts, bbox);
          if (!tractGeoids.length) {
            console.warn('[DataService] No tract centroids in bbox — falling back to live API');
            return null;
          }
          var result = _averageEpaSldForTracts(sldData, tractGeoids);
          if (result) return result;
          return null;
        });
      }
      return null;
    }).then(function (localResult) {
      if (localResult) return localResult;

      // Fall back to live EPA ArcGIS API
      if (!bbox) return { transitAccessibility: null, walkScore: null, _dataSource: 'epa-unavailable' };
      var fetcher = (typeof window.fetchWithTimeout === 'function')
        ? window.fetchWithTimeout
        : function (url) { return fetch(url); };
      var url = 'https://geodata.epa.gov/arcgis/rest/services/OA/SmartLocationDatabase/MapServer/14/query' +
                '?geometry=' + bbox.minLon + ',' + bbox.minLat + ',' + bbox.maxLon + ',' + bbox.maxLat +
                '&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=D4A,D3B&f=json' +
                '&returnGeometry=false';
      return fetcher(url)
        .then(function (r) {
          if (!r.ok) throw new Error('EPA SmartLocation HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          var features = (data && data.features) ? data.features : [];
          if (!features.length) return { transitAccessibility: null, walkScore: null, _dataSource: 'epa-empty' };
          var d4aSum = 0, d3bSum = 0;
          features.forEach(function (f) {
            var a = (f.attributes || {});
            d4aSum += parseFloat(a.D4A || a.D4a || 0);
            d3bSum += parseFloat(a.D3B || a.D3b || 0);
          });
          return {
            transitAccessibility: Math.min(100, Math.round((d4aSum / features.length) * 5)),
            walkScore:            Math.min(100, Math.round((d3bSum / features.length) * 5)),
            _dataSource: 'epa-live'
          };
        })
        .catch(function () {
          return { transitAccessibility: null, walkScore: null, _dataSource: 'epa-unavailable' };
        });
    });
  }

  /**
   * Fetch HUD NHPD subsidized housing data via the HUD eGIS API.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{properties: Array, subsidyMetadata: Array}>}
   */
  function fetchHudNhpd(bbox) {
    if (!bbox) return Promise.resolve({ properties: [], subsidyMetadata: [] });
    var nhpd = (typeof window !== 'undefined') ? window.Nhpd : null;
    if (nhpd && typeof nhpd.getPropertiesNear === 'function') {
      var lat = (bbox.minLat + bbox.maxLat) / 2;
      var lon = (bbox.minLon + bbox.maxLon) / 2;
      var props = nhpd.getPropertiesNear(lat, lon, 10);
      return Promise.resolve({ properties: props, subsidyMetadata: props });
    }
    return Promise.resolve({ properties: [], subsidyMetadata: [] });
  }

  // ── Opportunity Insights & AFFH local data cache ──────────────────
  var _oiCache = null;   // Opportunity Insights tract data (loaded once)
  var _oiLoading = null; // Promise guard to prevent duplicate fetches

  /**
   * Load Opportunity Insights tract data from local JSON (cached).
   * @returns {Promise<{meta: object, tracts: object}>}
   */
  function _loadOpportunityInsights() {
    if (_oiCache) return Promise.resolve(_oiCache);
    if (_oiLoading) return _oiLoading;
    _oiLoading = getJSON('data/market/opportunity_insights_co.json')
      .then(function (data) {
        _oiCache = data && data.tracts ? data : { meta: {}, tracts: {} };
        return _oiCache;
      })
      .catch(function () {
        _oiCache = { meta: {}, tracts: {} };
        return _oiCache;
      });
    return _oiLoading;
  }

  /**
   * Find tracts within a bounding box using cached centroid data.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<Array<string>>} Array of 11-digit FIPS codes
   */
  function _tractsInBbox(bbox) {
    // Use PMADataCache centroids if available, otherwise load from file
    var centroidsP;
    if (window.PMADataCache && window.PMADataCache.get('tractCentroids')) {
      centroidsP = Promise.resolve(window.PMADataCache.get('tractCentroids'));
    } else {
      centroidsP = getJSON('data/market/tract_centroids_co.json').catch(function () { return { tracts: [] }; });
    }
    return centroidsP.then(function (centData) {
      var tracts = (centData && centData.tracts) || [];
      var result = [];
      for (var i = 0; i < tracts.length; i++) {
        var t = tracts[i];
        if (t.lat >= bbox.minLat && t.lat <= bbox.maxLat &&
            t.lon >= bbox.minLon && t.lon <= bbox.maxLon) {
          result.push(t.geoid);
        }
      }
      return result;
    });
  }

  /**
   * Fetch Opportunity Atlas economic mobility data for tracts in a bounding box.
   * Loads from local data/market/opportunity_insights_co.json (Opportunity Insights,
   * Harvard/Brown — Chetty/Hendren tract-level outcomes).
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{mobilityIndex: number|null, percentiles: Array, _stub: boolean, _dataSource: string}>}
   */
  function fetchHudOpportunityAtlas(bbox) {
    if (!bbox) return Promise.resolve({ mobilityIndex: null, percentiles: [], _stub: true });
    return Promise.all([_loadOpportunityInsights(), _tractsInBbox(bbox)])
      .then(function (results) {
        var oi = results[0];
        var tractFips = results[1];

        if (!tractFips.length || !Object.keys(oi.tracts).length) {
          return { mobilityIndex: null, percentiles: [], _stub: true, _dataSource: 'opportunity-insights-local' };
        }

        // Aggregate mobility metrics across tracts in the bbox
        var mobilitySum = 0, mobilityN = 0;
        var percentiles = [];
        for (var i = 0; i < tractFips.length; i++) {
          var td = oi.tracts[tractFips[i]];
          if (!td) continue;
          if (typeof td.mobilityIndex === 'number') {
            mobilitySum += td.mobilityIndex;
            mobilityN++;
          }
          percentiles.push({
            tract: tractFips[i],
            mobilityIndex: td.mobilityIndex || null,
            upwardMobility25: td.upwardMobility25 || null,
            incarcerationRate25: td.incarcerationRate25 || null
          });
        }

        var avgMobility = mobilityN > 0 ? Math.round((mobilitySum / mobilityN) * 10) / 10 : null;

        return {
          mobilityIndex: avgMobility,
          percentiles: percentiles,
          _stub: false,
          _dataSource: 'opportunity-insights-local',
          _tractCount: mobilityN,
          _source: (oi.meta && oi.meta.source) || 'Opportunity Insights'
        };
      })
      .catch(function () {
        return { mobilityIndex: null, percentiles: [], _stub: true, _dataSource: 'opportunity-insights-error' };
      });
  }

  /**
   * Fetch fair housing opportunity index data, using Opportunity Insights
   * mobility metrics as a proxy.  High upward mobility + low incarceration
   * rates correlate with fair housing opportunity.
   *
   * Derived opportunityIndex:
   *   70% mobility component (higher mobility = more opportunity)
   *   30% safety component (lower incarceration = more opportunity)
   *
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{opportunityIndex: number|null, segregationMetrics: object, _stub: boolean}>}
   */
  function fetchHudAFFH(bbox) {
    if (!bbox) return Promise.resolve({ opportunityIndex: null, segregationMetrics: {}, _stub: true });
    return Promise.all([_loadOpportunityInsights(), _tractsInBbox(bbox)])
      .then(function (results) {
        var oi = results[0];
        var tractFips = results[1];

        if (!tractFips.length || !Object.keys(oi.tracts).length) {
          return { opportunityIndex: null, segregationMetrics: {}, _stub: true, _dataSource: 'opportunity-insights-proxy' };
        }

        // Compute fair housing opportunity proxy from mobility data
        var mobilitySum = 0, mobilityN = 0;
        var incarcerationSum = 0, incarcerationN = 0;
        var highMobilityTracts = 0, lowMobilityTracts = 0;

        for (var i = 0; i < tractFips.length; i++) {
          var td = oi.tracts[tractFips[i]];
          if (!td) continue;

          if (typeof td.upwardMobility25 === 'number') {
            // upwardMobility25 is an expected income percentile rank (0-1 scale)
            mobilitySum += td.upwardMobility25;
            mobilityN++;
            if (td.upwardMobility25 > 0.45) highMobilityTracts++;
            if (td.upwardMobility25 < 0.30) lowMobilityTracts++;
          }
          if (typeof td.incarcerationRate25 === 'number') {
            incarcerationSum += td.incarcerationRate25;
            incarcerationN++;
          }
        }

        if (mobilityN === 0) {
          return { opportunityIndex: null, segregationMetrics: {}, _stub: true, _dataSource: 'opportunity-insights-proxy' };
        }

        // Mobility component: avg upward mobility scaled to 0-100
        var avgMobility = mobilitySum / mobilityN;
        var mobilityScore = Math.min(avgMobility * 100 / 0.55, 100); // ~0.55 is high end

        // Safety component: lower incarceration = higher score
        var safetyScore = 70; // default if no incarceration data
        if (incarcerationN > 0) {
          var avgIncarceration = incarcerationSum / incarcerationN;
          // Typical range: 0.01 (good) to 0.08 (bad)
          safetyScore = Math.max(0, Math.min(100, (1 - avgIncarceration / 0.10) * 100));
        }

        // Composite: 70% mobility + 30% safety
        var opportunityIndex = Math.round(0.7 * mobilityScore + 0.3 * safetyScore);
        opportunityIndex = Math.max(0, Math.min(100, opportunityIndex));

        // Segregation proxy: disparity between high and low mobility tracts
        var totalWithData = highMobilityTracts + lowMobilityTracts;
        var disparityRatio = totalWithData > 0
          ? Math.abs(highMobilityTracts - lowMobilityTracts) / totalWithData
          : 0;

        return {
          opportunityIndex: opportunityIndex,
          segregationMetrics: {
            mobilityDisparity: Math.round(disparityRatio * 100) / 100,
            highMobilityTracts: highMobilityTracts,
            lowMobilityTracts: lowMobilityTracts,
            avgUpwardMobility: Math.round(avgMobility * 1000) / 1000,
            avgIncarceration: incarcerationN > 0
              ? Math.round((incarcerationSum / incarcerationN) * 10000) / 10000
              : null
          },
          _stub: false,
          _dataSource: 'opportunity-insights-proxy',
          _note: 'Derived from Opportunity Insights mobility/incarceration data as AFFH proxy',
          _tractCount: mobilityN
        };
      })
      .catch(function () {
        return { opportunityIndex: null, segregationMetrics: {}, _stub: true, _dataSource: 'opportunity-insights-error' };
      });
  }

  /**
   * Fetch Opportunity Zones dataset for a bounding box.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{zones: Array, designationYear: Array}>}
   */
  function fetchOpportunityZones(bbox) {
    if (!bbox) return Promise.resolve({ zones: [], designationYear: [] });
    var fetcher = (typeof window.fetchWithTimeout === 'function')
      ? window.fetchWithTimeout
      : function (url) { return fetch(url); };
    // HUD OZ data via ArcGIS FeatureServer
    var url = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/' +
              'Opportunity_Zones/FeatureServer/0/query' +
              '?geometry=' + bbox.minLon + ',' + bbox.minLat + ',' + bbox.maxLon + ',' + bbox.maxLat +
              '&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=GEOID,STATE&f=geojson';
    return fetcher(url)
      .then(function (r) {
        if (!r.ok) throw new Error('OZ HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var features = (data && data.features) ? data.features : [];
        return { zones: features, designationYear: features.map(function () { return 2018; }) };
      })
      .catch(function () { return { zones: [], designationYear: [] }; });
  }

  // ── Climate hazard data cache ──────────────────────────────────────
  var _climateCache = null;
  var _climateLoading = null;

  /**
   * Load climate hazards from local JSON (pre-fetched by fetch_climate_and_environment.py).
   * @returns {Promise<Object>}
   */
  function _loadClimateData() {
    if (_climateCache) return Promise.resolve(_climateCache);
    if (_climateLoading) return _climateLoading;
    _climateLoading = getJSON(baseData('market/climate_hazards_co.json'))
      .then(function (data) {
        _climateCache = data || { hazard_summary: {}, eji_tracts: [] };
        return _climateCache;
      })
      .catch(function () {
        _climateCache = { hazard_summary: {}, eji_tracts: [] };
        return _climateCache;
      });
    return _climateLoading;
  }

  /**
   * Derive a resilience score (0-100) from Colorado climate hazard data.
   * Higher = more resilient (fewer hazards). Scores the 6 hazard categories
   * and, if available, EJI tract-level environmental burden data.
   *
   * Local-first: loads data/market/climate_hazards_co.json (built by
   * scripts/market/fetch_climate_and_environment.py). Falls back to NOAA CDO
   * live API if local data is empty and a token is configured.
   *
   * @param {{lat:number,lon:number}} location
   * @param {string} [climateVariable]
   * @returns {Promise<{normals: object, extremes: object, resilienceScore: number, hazards: object, _stub: boolean, _dataSource: string}>}
   */
  function fetchNOAAClimateData(location, climateVariable) {
    return _loadClimateData().then(function (data) {
      var hazards = data.hazard_summary || {};
      var ejiTracts = data.eji_tracts || [];

      // Score hazard levels: low=90, moderate=70, high=50, very_high=30
      var levelScores = { low: 90, moderate: 70, high: 50, very_high: 30 };
      var keys = Object.keys(hazards);
      var scoreSum = 0;
      var scoreN = 0;
      for (var i = 0; i < keys.length; i++) {
        var h = hazards[keys[i]];
        if (h && h.level) {
          scoreSum += (levelScores[h.level] || 60);
          scoreN++;
        }
      }
      var baseScore = scoreN > 0 ? Math.round(scoreSum / scoreN) : 50;

      // If EJI tract data is available and location provided, find nearest tract
      var ejiScore = null;
      if (ejiTracts.length > 0 && location && location.lat && location.lon) {
        // County-level match by first looking at tract data
        // (full point-in-polygon not feasible client-side without geometries)
        ejiScore = null; // Enhance later with tract centroid proximity
      }

      // If we have real hazard data (keys > 0), this is not a stub
      var isStub = keys.length === 0;

      if (isStub) {
        // Try NOAA CDO live API as fallback
        var token = (window.APP_CONFIG || {}).NOAA_CDO_TOKEN;
        if (token) {
          var fetcher = (typeof window.fetchWithTimeout === 'function')
            ? window.fetchWithTimeout
            : function (url, opts) { return fetch(url, opts); };
          var url = 'https://www.ncdc.noaa.gov/cdo-web/api/v2/data' +
                    '?datasetid=NORMAL_ANN&datatypeid=ANN-PRCP-NORMAL' +
                    '&units=standard&limit=25';
          return fetcher(url, { headers: { token: token } })
            .then(function (r) { if (!r.ok) throw new Error('NOAA HTTP ' + r.status); return r.json(); })
            .then(function (d) { return { normals: d, extremes: {}, resilienceScore: 50, hazards: {}, _stub: false, _dataSource: 'noaa-cdo-live' }; })
            .catch(function () { return { normals: {}, extremes: {}, resilienceScore: 50, hazards: {}, _stub: true, _dataSource: 'noaa-cdo-error' }; });
        }
        return { normals: {}, extremes: {}, resilienceScore: 50, hazards: {}, _stub: true, _dataSource: 'climate-no-data' };
      }

      return {
        normals: data.noaa_summary || {},
        extremes: {},
        resilienceScore: baseScore,
        hazards: hazards,
        ejiTractCount: ejiTracts.length,
        _stub: false,
        _dataSource: 'climate-hazards-local'
      };
    });
  }

  // ── Utility capacity data cache ────────────────────────────────────
  var _utilityCache = null;
  var _utilityLoading = null;

  /**
   * Load utility service area data from local GeoJSON
   * (pre-fetched by scripts/market/fetch_utility_capacity.py).
   * @returns {Promise<Object>}
   */
  function _loadUtilityData() {
    if (_utilityCache) return Promise.resolve(_utilityCache);
    if (_utilityLoading) return _utilityLoading;
    _utilityLoading = getJSON(baseData('market/utility_capacity_co.geojson'))
      .then(function (data) {
        _utilityCache = data && data.features ? data : { meta: {}, features: [] };
        return _utilityCache;
      })
      .catch(function () {
        _utilityCache = { meta: {}, features: [] };
        return _utilityCache;
      });
    return _utilityLoading;
  }

  /**
   * Fetch utility infrastructure capacity data for a bounding box.
   * Local-first: loads data/market/utility_capacity_co.geojson (CDSS/DWR/DOLA
   * water district and municipal service area boundaries). When features exist,
   * returns a coverage-based capacity estimate. When no features are found,
   * returns null values with _stub:true.
   *
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @param {string} [jurisdiction]
   * @returns {Promise<{sewerHeadroom: number|null, waterCapacity: number|null, _stub: boolean, _dataSource: string}>}
   */
  function fetchUtilityCapacity(bbox, jurisdiction) {
    return _loadUtilityData().then(function (data) {
      var features = data.features || [];
      var meta = data.meta || {};

      // No local data available — honest null with _stub flag
      if (!features.length) {
        return {
          sewerHeadroom: null,
          waterCapacity: null,
          serviceAreas: [],
          _stub: true,
          _dataSource: 'utility-no-data'
        };
      }

      // If bbox provided, filter features that overlap the bounding box
      var matched = [];
      if (bbox) {
        for (var i = 0; i < features.length; i++) {
          var f = features[i];
          var geom = f.geometry;
          var props = f.properties || {};

          // Point features (centroids with radius_deg from area estimate)
          if (geom && geom.type === 'Point' && geom.coordinates) {
            var lon = geom.coordinates[0];
            var lat = geom.coordinates[1];
            var r = props.radius_deg || 0.01; // ~1km default
            // Check if expanded point bbox overlaps query bbox
            if ((lon + r) >= bbox.minLon && (lon - r) <= bbox.maxLon &&
                (lat + r) >= bbox.minLat && (lat - r) <= bbox.maxLat) {
              matched.push(f);
            }
          }
          // Polygon features (legacy or future full-geometry data)
          else if (geom && geom.coordinates) {
            var coords = geom.type === 'MultiPolygon'
              ? geom.coordinates[0][0]
              : (geom.type === 'Polygon' ? geom.coordinates[0] : null);
            if (!coords || !coords.length) continue;
            var fMinLon = Infinity, fMaxLon = -Infinity;
            var fMinLat = Infinity, fMaxLat = -Infinity;
            for (var j = 0; j < coords.length; j++) {
              var c = coords[j];
              if (c[0] < fMinLon) fMinLon = c[0];
              if (c[0] > fMaxLon) fMaxLon = c[0];
              if (c[1] < fMinLat) fMinLat = c[1];
              if (c[1] > fMaxLat) fMaxLat = c[1];
            }
            if (fMaxLon >= bbox.minLon && fMinLon <= bbox.maxLon &&
                fMaxLat >= bbox.minLat && fMinLat <= bbox.maxLat) {
              matched.push(f);
            }
          }
          // Features without geometry (e.g. DWR water districts) — skip bbox filter
        }
      } else {
        matched = features;
      }

      if (!matched.length) {
        return {
          sewerHeadroom: null,
          waterCapacity: null,
          serviceAreas: [],
          _stub: false,
          _dataSource: 'utility-local-no-overlap',
          _note: 'Site outside known service areas — verify with local utility provider'
        };
      }

      // Coverage-based estimate: sites inside service areas have moderate capacity
      var waterDistricts = 0;
      var municipalAreas = 0;
      for (var k = 0; k < matched.length; k++) {
        var props = matched[k].properties || {};
        if (props.utility_type === 'water_district') waterDistricts++;
        else municipalAreas++;
      }

      // Heuristic: inside water district + municipal boundary = good capacity
      var waterCap = waterDistricts > 0 ? 0.7 : (municipalAreas > 0 ? 0.5 : null);
      var sewerCap = municipalAreas > 0 ? 0.6 : null;

      return {
        sewerHeadroom: sewerCap,
        waterCapacity: waterCap,
        serviceAreas: matched.map(function (f) {
          var p = f.properties || {};
          return {
            name: p.NAME || p.name || p.DISTRICT || 'Unknown',
            type: p.utility_type || 'unknown',
            constraintLevel: p.constraint_level || 'variable'
          };
        }),
        _stub: false,
        _dataSource: 'utility-local-co',
        _matchedFeatures: matched.length,
        _source: (meta.source || 'Colorado CDSS/DWR/DOLA')
      };
    });
  }

  // ── USDA Food Access Atlas local data cache ────────────────────────
  var _foodAccessCache = null;
  var _foodAccessLoading = null;

  /**
   * Load USDA Food Access Atlas data from local JSON (cached).
   * @returns {Promise<{meta: object, tracts: object}>}
   */
  function _loadFoodAccess() {
    if (_foodAccessCache) return Promise.resolve(_foodAccessCache);
    if (_foodAccessLoading) return _foodAccessLoading;
    _foodAccessLoading = getJSON('data/market/food_access_co.json')
      .then(function (data) {
        _foodAccessCache = data && data.tracts ? data : { meta: {}, tracts: {} };
        return _foodAccessCache;
      })
      .catch(function () {
        _foodAccessCache = { meta: {}, tracts: {} };
        return _foodAccessCache;
      });
    return _foodAccessLoading;
  }

  /**
   * Fetch USDA Food Access Atlas data for a bounding box.
   * Loads local data/market/food_access_co.json (USDA ERS 2019), finds tracts
   * in the bbox, and computes a proximity index (0-100) where higher = better access.
   *
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{foodDeserts: Array, proximityIndex: number|null, _stub: boolean, _dataSource: string}>}
   */
  function fetchFoodAccessAtlas(bbox) {
    if (!bbox) return Promise.resolve({ foodDeserts: [], proximityIndex: null, _stub: true });
    return Promise.all([_loadFoodAccess(), _tractsInBbox(bbox)])
      .then(function (results) {
        var fa = results[0];
        var tractFips = results[1];
        var faTracts = fa.tracts || {};

        if (!tractFips.length || !Object.keys(faTracts).length) {
          return { foodDeserts: [], proximityIndex: null, _stub: true, _dataSource: 'usda-local' };
        }

        var foodDeserts = [];
        var accessScoreSum = 0;
        var matched = 0;

        for (var i = 0; i < tractFips.length; i++) {
          var td = faTracts[tractFips[i]];
          if (!td) continue;
          matched++;

          if (td.foodDesert) {
            foodDeserts.push({
              geoid: tractFips[i],
              lowAccess1mi: td.lowAccess1mi,
              lowAccessHalfMi: td.lowAccessHalfMi,
              povertyRate: td.povertyRate
            });
          }

          // Compute per-tract access score (0-100, higher = better food access)
          // Start at 100 and subtract penalties for poor access indicators
          var tractScore = 100;
          if (td.foodDesert) tractScore -= 40;           // severe penalty for food desert
          if (td.lowAccess1mi) tractScore -= 15;         // penalty for low access at 1mi
          if (td.lowAccessHalfMi) tractScore -= 10;      // penalty for low access at 0.5mi
          // Penalty proportional to % population with low access
          tractScore -= (td.pctLowAccess1mi || 0) * 20;  // up to 20pt penalty
          // High poverty reduces the score (compounds food access issues)
          tractScore -= (td.povertyRate || 0) * 15;       // up to 15pt penalty
          tractScore = Math.max(0, Math.min(100, tractScore));
          accessScoreSum += tractScore;
        }

        if (matched === 0) {
          return { foodDeserts: [], proximityIndex: null, _stub: true, _dataSource: 'usda-local' };
        }

        var proximityIndex = Math.round(accessScoreSum / matched);

        return {
          foodDeserts: foodDeserts,
          proximityIndex: proximityIndex,
          _stub: false,
          _dataSource: 'usda-local',
          _tractCount: matched,
          _foodDesertCount: foodDeserts.length,
          _source: (fa.meta && fa.meta.source) || 'USDA Food Access Research Atlas'
        };
      })
      .catch(function () {
        return { foodDeserts: [], proximityIndex: null, _stub: true, _dataSource: 'usda-local-error' };
      });
  }

  /**
   * Cached local flood zone data (loaded once from data/market/flood_zones_co.json).
   * @type {Object|null}
   */
  var _localFloodData = null;
  var _localFloodLoading = null;

  /**
   * Load the local flood zone tract summary (from fetch_fema_nfhl.py output).
   * @returns {Promise<Object|null>}
   */
  function _loadLocalFloodData() {
    if (_localFloodData) return Promise.resolve(_localFloodData);
    if (_localFloodLoading) return _localFloodLoading;
    _localFloodLoading = getJSON(baseData('market/flood_zones_co.json'))
      .then(function (data) {
        if (data && data.tracts && Object.keys(data.tracts).length > 0) {
          _localFloodData = data;
          return data;
        }
        return null;
      })
      .catch(function () { return null; });
    return _localFloodLoading;
  }

  /**
   * Fetch FEMA National Flood Hazard Layer data.
   * Prefers local tract-level summary (data/market/flood_zones_co.json) when
   * available; falls back to live FEMA NFHL ArcGIS query.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{floodZones: Array, hazardPercent: number}>}
   */
  function fetchFEMAFloodData(bbox) {
    if (!bbox) return Promise.resolve({ floodZones: [], hazardPercent: 0.05 });

    // Try local file first
    return _loadLocalFloodData().then(function (localData) {
      if (localData && localData.tracts) {
        // Find tracts in the bounding box using centroids
        return _tractsInBbox(bbox).then(function (tractIds) {
          var floodZones = [];
          var sfhaCount = 0;
          for (var i = 0; i < tractIds.length; i++) {
            var td = localData.tracts[tractIds[i]];
            if (!td) continue;
            if (td.hasSFHA) sfhaCount++;
            floodZones.push({
              type: 'Feature',
              properties: {
                tractId: tractIds[i],
                FLD_ZONE: (td.zones && td.zones[0]) || 'X',
                hasSFHA: td.hasSFHA || false,
                floodRiskScore: td.floodRiskScore || 95,
                zones: td.zones || []
              },
              geometry: null
            });
          }
          var hazardPct = tractIds.length > 0
            ? Math.min(1, sfhaCount / tractIds.length)
            : 0.05;
          return {
            floodZones: floodZones,
            hazardPercent: hazardPct,
            _dataSource: 'local-flood-zones-co'
          };
        });
      }

      // Fall back to live FEMA NFHL query
      var fetcher = (typeof window.fetchWithTimeout === 'function')
        ? window.fetchWithTimeout
        : function (url) { return fetch(url); };
      var url = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query' +
                '?geometry=' + bbox.minLon + ',' + bbox.minLat + ',' + bbox.maxLon + ',' + bbox.maxLat +
                '&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=FLD_ZONE&f=geojson' +
                '&where=FLD_ZONE+IN+(\'AE\',\'AO\',\'A\',\'AH\')';
      return fetcher(url)
        .then(function (r) { if (!r.ok) throw new Error('FEMA NFHL HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          var features = (data && data.features) ? data.features : [];
          return { floodZones: features, hazardPercent: Math.min(1, features.length * 0.02), _dataSource: 'fema-live' };
        })
        .catch(function () { return { floodZones: [], hazardPercent: 0.05, _dataSource: 'fema-unavailable' }; });
    });
  }

  window.DataService = {
    getJSON:                getJSON,
    getGeoJSON:             getGeoJSON,
    baseData:               baseData,
    baseMaps:               baseMaps,
    getText:                getText,
    fredObservations:       fredObservations,
    census:                 census,
    // PMA enhanced data sources
    fetchLODES:             fetchLODES,
    fetchUSGSHydrology:     fetchUSGSHydrology,
    fetchNLCDLandCover:     fetchNLCDLandCover,
    fetchStateHighways:     fetchStateHighways,
    fetchSchoolBoundaries:  fetchSchoolBoundaries,
    fetchNTDData:           fetchNTDData,
    fetchEPASmartLocation:  fetchEPASmartLocation,
    fetchHudNhpd:           fetchHudNhpd,
    fetchHudOpportunityAtlas: fetchHudOpportunityAtlas,
    fetchHudAFFH:           fetchHudAFFH,
    fetchOpportunityZones:  fetchOpportunityZones,
    fetchNOAAClimateData:   fetchNOAAClimateData,
    fetchUtilityCapacity:   fetchUtilityCapacity,
    fetchFoodAccessAtlas:   fetchFoodAccessAtlas,
    fetchFEMAFloodData:     fetchFEMAFloodData
  };
})();
