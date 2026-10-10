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
  // Default cache mode is 'no-store' so a freshly-built JSON shows up on reload
  // without a hard refresh; the server already sends Cache-Control: no-store,
  // but no-store on the fetch options bypasses any leftover in-memory cache.
  // Callers can override by passing their own options.cache.
  function getJSON(path, options) {
    var opts = Object.assign({ cache: 'no-store' }, options || {});
    if (typeof window.safeFetchJSON === 'function') {
      return window.safeFetchJSON(path, opts);
    }
    // Minimal fallback in case fetch-helper.js is not yet loaded
    return fetch(path, opts).then(function (r) {
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
   * Fetch NCES school locations inside a bounding box.
   *
   * Loads the committed `data/market/schools_co.geojson` — 1,941 real schools
   * from the NCES Common Core of Data, School Locations 2021-22. This replaces
   * an ArcGIS FeatureServer query that returned `{"error":{"code":400}}`; the
   * hosting org still answers with 527 services, none of them school-related,
   * so the layer was removed rather than renamed (#1541). The failure was
   * silent — a `.catch` returning empty arrays — so every PMA run scored the
   * schools dimension on nothing while still citing the source.
   *
   * `schoolDistricts` is deliberately empty: this file carries school *points*,
   * not attendance-boundary polygons. The old code returned the same array for
   * both, which is why "districts aligned" was really "schools nearby".
   *
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{schoolDistricts: Array, schools: Array, _dataSource: string}>}
   */
  function fetchSchoolBoundaries(bbox) {
    if (!bbox) {
      return Promise.resolve({ schoolDistricts: [], schools: [], _dataSource: 'none' });
    }
    return getJSON('data/market/schools_co.geojson')
      .then(function (geojson) {
        var features = (geojson && geojson.features) ? geojson.features : [];
        if (!features.length) {
          return { schoolDistricts: [], schools: [], _dataSource: 'none' };
        }
        var schools = [];
        features.forEach(function (f) {
          var g = f.geometry;
          if (!g || g.type !== 'Point' || !g.coordinates) return;
          var lon = g.coordinates[0], lat = g.coordinates[1];
          if (lat < bbox.minLat || lat > bbox.maxLat ||
              lon < bbox.minLon || lon > bbox.maxLon) return;
          var p = f.properties || {};
          schools.push({
            ncesId:     p.nces_id || null,
            name:       p.school_name || 'School',
            schoolType: p.school_type || null,
            gradeLow:   p.grade_low || null,
            gradeHigh:  p.grade_high || null,
            enrollment: (p.enrollment === 0 || p.enrollment) ? p.enrollment : null,
            county:     p.county_name || null,
            city:       p.city || null,
            charter:    p.charter || null,
            title1:     p.title1 || null,
            lat:        lat,
            lon:        lon,
            // No performance measure ships with CCD school locations. It stays
            // null rather than defaulting — see AGENTS.md, "An unmeasurable
            // quantity is null, never 0", and the neutral-default note there.
            performanceScore: null
          });
        });
        return {
          schoolDistricts: [],
          schools: schools,
          _dataSource: 'NCES CCD School Locations 2021-22 (data/market/schools_co.geojson)'
        };
      })
      .catch(function () {
        return { schoolDistricts: [], schools: [], _dataSource: 'none' };
      });
  }

  /**
   * The statewide transit stop file, for the PMA transit score.
   *
   * Scoring reads confirmed stops, never route geometry (owner decision
   * 2026-09-27): the old fetchNTDData() sampled ~10 vertices per route from
   * the route-line file as pseudo-stops, so the score moved with the file's
   * vertex count rather than with where transit is.
   *
   * The file is ~4 MB and does not change within a page visit, so it is
   * fetched once per page and the parsed copy is shared by every PMA run
   * (and by the market-analysis TOD check). A failed load is not cached:
   * the next run tries again.
   *
   * Resolves (never rejects) to
   *   { geojson: FeatureCollection|null, unavailableReason: string|null,
   *     _dataSource: 'local-stops'|'unavailable', path }
   */
  var TRANSIT_STOPS_PATH = 'data/amenities/transit_stops_statewide_co.geojson';
  var _transitStopsPromise = null;
  function fetchTransitStops() {
    if (_transitStopsPromise) return _transitStopsPromise;
    var p = getJSON(TRANSIT_STOPS_PATH)
      .then(function (geojson) {
        if (!geojson || !Array.isArray(geojson.features) || !geojson.features.length) {
          throw new Error('the file holds no stops');
        }
        return { geojson: geojson, unavailableReason: null, _dataSource: 'local-stops', path: TRANSIT_STOPS_PATH };
      })
      .catch(function (err) {
        if (_transitStopsPromise === p) _transitStopsPromise = null;   // let the next run retry
        return {
          geojson: null,
          unavailableReason: 'The statewide transit stop file could not be loaded' +
            (err && err.message ? ' (' + err.message + ')' : '') + ', so transit access was not scored.',
          _dataSource: 'unavailable',
          path: TRANSIT_STOPS_PATH
        };
      });
    _transitStopsPromise = p;
    return p;
  }

  /**
   * The zone-map status file: the two HB26-1065 distances the PMA transit
   * score uses (zone_radius_miles and qap_tod_distance.miles), read through
   * js/transit-zone.js. Fetched once per page; a failed load is not cached.
   *
   * Resolves (never rejects) to { mapStatus: object|null, unavailableReason }.
   */
  var TRANSIT_ZONE_STATUS_PATH = 'data/policy/thiz-map-status.json';
  var _transitZoneStatusPromise = null;
  function fetchTransitZoneStatus() {
    if (_transitZoneStatusPromise) return _transitZoneStatusPromise;
    var p = getJSON(TRANSIT_ZONE_STATUS_PATH)
      .then(function (status) {
        if (!status || typeof status !== 'object') throw new Error('the file is empty');
        return { mapStatus: status, unavailableReason: null };
      })
      .catch(function (err) {
        if (_transitZoneStatusPromise === p) _transitZoneStatusPromise = null;
        return {
          mapStatus: null,
          unavailableReason: 'The zone-map status file could not be loaded' +
            (err && err.message ? ' (' + err.message + ')' : '') +
            ', so the transit distances are unknown and transit access was not scored.'
        };
      });
    _transitZoneStatusPromise = p;
    return p;
  }

  /* ── EPA SLD local cache ──────────────────────────────────────────── */
  var _epaSldCache = null;       // cached parsed JSON from epa_sld_co.json
  var _epaSldLoading = null;     // in-flight promise (avoid duplicate fetches)
  var _epaBgIndex = null;        // 2010 block-group boundaries, indexed for bbox tests
  var _epaBgIndexLoading = null;

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
   * Load the 2010 block-group boundaries the EPA SLD is published on
   * (data/market/epa_sld_bg_geometry_co.geojson, same GEOID set as
   * epa_sld_co.json) and index each one by its envelope.
   *
   * The repo's tract file is TIGER 2020. EPA SLD v3 is on 2010 block groups, so
   * selecting by 2020 tract prefix could never reach the 667 block groups whose
   * 2010 tract no longer exists, and found nothing for the 384 2020 tracts with
   * no 2010 namesake.
   *
   * Resolves null when the file is unavailable, so the caller falls back.
   */
  function _loadEpaSldGeometry() {
    if (_epaBgIndex) return Promise.resolve(_epaBgIndex);
    if (_epaBgIndexLoading) return _epaBgIndexLoading;
    _epaBgIndexLoading = getJSON('data/market/epa_sld_bg_geometry_co.geojson')
      .then(function (fc) {
        var feats = (fc && Array.isArray(fc.features)) ? fc.features : [];
        var index = [];
        for (var i = 0; i < feats.length; i++) {
          var f = feats[i];
          var geoid = f && f.properties ? String(f.properties.geoid || '') : '';
          var g = f && f.geometry;
          if (!geoid || !g) continue;
          var polys = g.type === 'Polygon' ? [g.coordinates]
            : g.type === 'MultiPolygon' ? g.coordinates : null;
          if (!polys) continue;
          var env = [Infinity, Infinity, -Infinity, -Infinity];
          for (var p = 0; p < polys.length; p++) {
            var outer = polys[p][0] || [];
            for (var k = 0; k < outer.length; k++) {
              if (outer[k][0] < env[0]) env[0] = outer[k][0];
              if (outer[k][1] < env[1]) env[1] = outer[k][1];
              if (outer[k][0] > env[2]) env[2] = outer[k][0];
              if (outer[k][1] > env[3]) env[3] = outer[k][1];
            }
          }
          index.push({ geoid: geoid, env: env, polys: polys });
        }
        _epaBgIndex = index.length ? index : null;
        _epaBgIndexLoading = null;
        return _epaBgIndex;
      })
      .catch(function () {
        console.warn('[DataService] EPA SLD block-group boundaries not found — will fall back to live API');
        _epaBgIndexLoading = null;
        return null;
      });
    return _epaBgIndexLoading;
  }

  /** Even-odd ray cast over every ring of one polygon, so holes are excluded. */
  function _pointInRings(x, y, rings) {
    var inside = false;
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
      }
    }
    return inside;
  }

  /** Liang-Barsky: does segment (ax,ay)-(bx,by) touch the bbox? */
  function _segmentHitsBbox(ax, ay, bx, by, bbox) {
    var t0 = 0, t1 = 1, dx = bx - ax, dy = by - ay;
    var p = [-dx, dx, -dy, dy];
    var q = [ax - bbox.minLon, bbox.maxLon - ax, ay - bbox.minLat, bbox.maxLat - ay];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; continue; }
      var t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else          { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }

  /**
   * GEOIDs of every 2010 block group whose boundary intersects the bbox — the
   * polygon, not its envelope, which would take in a rural block group that
   * only wraps around a corner. A polygon meets a rectangle exactly when one of
   * its edges touches the rectangle or the rectangle lies wholly inside it.
   */
  function _epaBlockGroupsInBbox(index, bbox) {
    var out = [];
    for (var i = 0; i < index.length; i++) {
      var bg = index[i], e = bg.env;
      if (e[2] < bbox.minLon || e[0] > bbox.maxLon || e[3] < bbox.minLat || e[1] > bbox.maxLat) continue;
      var hit = false;
      for (var p = 0; p < bg.polys.length && !hit; p++) {
        var rings = bg.polys[p];
        for (var r = 0; r < rings.length && !hit; r++) {
          var ring = rings[r];
          for (var a = 0, b = ring.length - 1; a < ring.length; b = a++) {
            if (_segmentHitsBbox(ring[b][0], ring[b][1], ring[a][0], ring[a][1], bbox)) { hit = true; break; }
          }
        }
        if (!hit && _pointInRings(bbox.minLon, bbox.minLat, rings)) hit = true;
      }
      if (hit) out.push(bg.geoid);
    }
    return out;
  }

  // EPA SLD D4A is the distance in metres from a block group's population-
  // weighted centroid to the nearest transit stop (EPA's own field alias), not a
  // 0-100 index and not service frequency — lower is better, and EPA leaves it
  // blank beyond ~3/4 mile. Scored as an index it rewards being far from
  // transit, so it is carried under its real name and never as
  // transitAccessibility; PMATransit then redistributes the EPA transit weight
  // to its GTFS frequency/coverage components. Converting distance to a score
  // is a methodology decision that has not been made.
  var EPA_D4A_NOT_A_SCORE_REASON = 'EPA SLD D4A is distance to the nearest transit stop (metres), not a transit ' +
    'accessibility index, so no EPA transit score was calculated; walkability (D3B) is used.';

  /**
   * Average EPA SLD metrics across the given 12-digit block-group GEOIDs.
   */
  function _averageEpaSldForBlockGroups(sldData, bgIds) {
    var bgs = sldData.blockGroups;
    var sums = { walkability: 0, transitAccess: 0, jobAccess: 0, landUseMix: 0, empDensity: 0 };
    var counts = { walkability: 0, transitAccess: 0, jobAccess: 0, landUseMix: 0, empDensity: 0 };

    for (var i = 0; i < bgIds.length; i++) {
      var bg = bgs[bgIds[i]];
      if (!bg) continue;
      if (bg.walkability != null)   { sums.walkability   += bg.walkability;   counts.walkability++;   }
      if (bg.transitAccess != null) { sums.transitAccess += bg.transitAccess; counts.transitAccess++; }
      if (bg.jobAccess != null)     { sums.jobAccess     += bg.jobAccess;     counts.jobAccess++;     }
      if (bg.landUseMix != null)    { sums.landUseMix    += bg.landUseMix;    counts.landUseMix++;    }
      if (bg.empDensity != null)    { sums.empDensity    += bg.empDensity;    counts.empDensity++;    }
    }

    var n = counts.walkability;
    if (n === 0) return null;

    return {
      transitAccessibility: null,
      walkScore:            counts.walkability > 0    ? Math.round(sums.walkability / counts.walkability)       : null,
      D3b:                  counts.walkability > 0    ? Math.round((sums.walkability / counts.walkability) * 100) / 100 : null,
      // Mean over block groups that HAVE a stop within EPA's cutoff; the rest are
      // blank in the source, so this is not an area-wide average distance.
      nearestTransitStopMeters: counts.transitAccess > 0 ? Math.round(sums.transitAccess / counts.transitAccess) : null,
      transitStopBlockGroupCount: counts.transitAccess,
      jobAccess:            counts.jobAccess > 0      ? Math.round(sums.jobAccess / counts.jobAccess)           : null,
      landUseMix:           counts.landUseMix > 0     ? Math.round((sums.landUseMix / counts.landUseMix) * 1000) / 1000 : null,
      empDensity:           counts.empDensity > 0     ? Math.round((sums.empDensity / counts.empDensity) * 100) / 100 : null,
      blockGroupCount:      n,
      unavailableReason:    EPA_D4A_NOT_A_SCORE_REASON,
      _dataSource: 'epa-sld-local'
    };
  }

  /**
   * Fetch EPA Smart Location Database transit accessibility metrics.
   *
   * Strategy:
   *   1. Try local files — average the block groups in data/market/epa_sld_co.json
   *      whose 2010 boundaries (epa_sld_bg_geometry_co.geojson) intersect the bbox.
   *   2. Fall back to live EPA ArcGIS API if a local file is unavailable or no
   *      block group intersects the bbox.
   *   3. Return null values if both fail.
   *
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{transitAccessibility: null, walkScore: number|null, _dataSource: string}>}
   */
  function fetchEPASmartLocation(bbox) {
    if (!bbox) return Promise.resolve({ transitAccessibility: null, walkScore: null, _dataSource: 'none' });

    // Try local files first
    return Promise.all([_loadEpaSldLocal(), _loadEpaSldGeometry()]).then(function (loaded) {
      var sldData = loaded[0], bgIndex = loaded[1];
      if (!sldData || !bgIndex) return null; // local files unavailable, will fall back

      var bgIds = _epaBlockGroupsInBbox(bgIndex, bbox);
      if (!bgIds.length) {
        console.warn('[DataService] No EPA SLD block groups intersect bbox — falling back to live API');
        return null;
      }
      return _averageEpaSldForBlockGroups(sldData, bgIds);
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
          // D4A is a distance, not a score (see EPA_D4A_NOT_A_SCORE_REASON), so it
          // is not averaged into transitAccessibility here either. D3B uses the same
          // scale as the local file; EPA's -99999 sentinel is absence, not a value.
          var d3bSum = 0, d3bN = 0;
          features.forEach(function (f) {
            var a = (f.attributes || {});
            var v = a.D3B != null ? a.D3B : a.D3b;
            if (v == null || v === '') return;
            v = parseFloat(v);
            if (!isFinite(v) || v < 0) return;
            d3bSum += v; d3bN++;
          });
          if (!d3bN) return { transitAccessibility: null, walkScore: null, _dataSource: 'epa-empty' };
          return {
            transitAccessibility: null,
            walkScore:            Math.round(d3bSum / d3bN),
            unavailableReason:    EPA_D4A_NOT_A_SCORE_REASON,
            _dataSource: 'epa-live'
          };
        })
        .catch(function () {
          return { transitAccessibility: null, walkScore: null, _dataSource: 'epa-unavailable' };
        });
    });
  }

  /**
   * Read nearby records from the local NHPD snapshot, with coverage metadata.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{properties: Array, subsidyMetadata: Array}>}
   */
  function fetchHudNhpd(bbox) {
    var nhpd = (typeof window !== 'undefined') ? window.Nhpd : null;
    var coverage = nhpd && typeof nhpd.getCoverage === 'function' ? nhpd.getCoverage() : {
      status: 'unavailable', complete: false, recordCount: null,
      unavailableReason: 'NHPD coverage is unavailable; preservation totals and risk are unknown.'
    };
    if (bbox && nhpd && typeof nhpd.getPropertiesNear === 'function') {
      var lat = (bbox.minLat + bbox.maxLat) / 2;
      var lon = (bbox.minLon + bbox.maxLon) / 2;
      var props = nhpd.getPropertiesNear(lat, lon, 10);
      return Promise.resolve({ properties: props, subsidyMetadata: props, coverage: coverage });
    }
    return Promise.resolve({ properties: [], subsidyMetadata: [], coverage: coverage });
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
   * @returns {Promise<{normals: object, extremes: object, resilienceScore: number|null, hazards: object, _stub: boolean, _dataSource: string, unavailableReason?: string|null}>}
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
      var unsupportedLevels = [];
      for (var i = 0; i < keys.length; i++) {
        var h = hazards[keys[i]];
        if (!h || !Object.prototype.hasOwnProperty.call(levelScores, h.level)) {
          unsupportedLevels.push(h && h.level ? h.level : 'missing');
          continue;
        }
        scoreSum += levelScores[h.level];
        scoreN++;
      }
      var levelUnavailableReason = unsupportedLevels.length
        ? 'Climate resilience score unavailable because the hazard data contains missing or unrecognized levels: ' + unsupportedLevels.join(', ') + '.'
        : null;
      var baseScore = scoreN > 0 && !levelUnavailableReason ? Math.round(scoreSum / scoreN) : null;

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
            .then(function (d) {
              return {
                normals: d, extremes: {}, resilienceScore: null, hazards: {},
                _stub: false,
                _dataSource: 'noaa-cdo-live',
                unavailableReason: 'NOAA normals were loaded, but no supported method derives a climate resilience score from them.'
              };
            })
            .catch(function () {
              return {
                normals: {}, extremes: {}, resilienceScore: null, hazards: {},
                _stub: true,
                _dataSource: 'noaa-cdo-error',
                unavailableReason: 'NOAA climate data could not be loaded; no climate resilience score was calculated.'
              };
            });
        }
        return {
          normals: {}, extremes: {}, resilienceScore: null, hazards: {},
          _stub: true,
          _dataSource: 'climate-no-data',
          unavailableReason: 'NOAA climate data is unavailable; no climate resilience score was calculated.'
        };
      }

      return {
        normals: data.noaa_summary || {},
        extremes: {},
        resilienceScore: baseScore,
        hazards: hazards,
        ejiTractCount: ejiTracts.length,
        _stub: false,
        _dataSource: 'climate-hazards-local',
        unavailableReason: levelUnavailableReason
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
    // hazardPercent must be null, never a plausible-looking default. A finite
    // number here is rendered as a real FEMA figure downstream (see the #712
    // note below -- the identical bug was fixed for floodRiskScore and left
    // standing here).
    if (!bbox) return Promise.resolve({
      floodZones: [], hazardPercent: null, _stub: true,
      _dataSource: 'no-bounding-box',
      unavailableReason: 'No bounding box was supplied, so no flood lookup was performed.'
    });

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
            // `floodRiskScore || 95` previously fabricated a near-perfect
            // "safe" score (95/100) when the tract lacked the field.
            // Flagged as a hallucination in the 2026-04-23 origin audit
            // (issue #712). Return null so downstream composite scorers
            // propagate "unavailable" rather than silently bumping the
            // site's feasibility score.
            var hasRisk = typeof td.floodRiskScore === 'number';
            floodZones.push({
              type: 'Feature',
              properties: {
                tractId: tractIds[i],
                FLD_ZONE: (td.zones && td.zones[0]) || 'X',
                hasSFHA: td.hasSFHA || false,
                floodRiskScore: hasRisk ? td.floodRiskScore : null,
                floodRiskAvailable: hasRisk,
                zones: td.zones || []
              },
              geometry: null
            });
          }
          // Zero tracts in the bbox means the local dataset did not answer.
          // Returning 0.05 with _dataSource 'local-flood-zones-co' asserted
          // that it had.
          var noTracts = tractIds.length === 0;
          return {
            floodZones: floodZones,
            hazardPercent: noTracts ? null : Math.min(1, sfhaCount / tractIds.length),
            _stub: noTracts || undefined,
            _dataSource: noTracts ? 'local-flood-zones-co-no-coverage' : 'local-flood-zones-co',
            unavailableReason: noTracts
              ? 'No Colorado flood-zone tracts intersect this area, so no flood hazard percentage was calculated.'
              : null
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
        .catch(function () {
          return {
            floodZones: [], hazardPercent: null, _stub: true,
            _dataSource: 'fema-unavailable',
            unavailableReason: 'FEMA flood data is unavailable for this area; no flood hazard percentage was calculated.'
          };
        });
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
    fetchTransitStops:      fetchTransitStops,
    fetchTransitZoneStatus: fetchTransitZoneStatus,
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
