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
   * Fetch LEHD/LODES workplace and commuting flow data.
   * LODES files are bulk static downloads; a server-side proxy is required
   * for spatial queries.  This method returns the graceful-degradation stub
   * (synthetic workplace distribution) until a proxy is configured via
   * APP_CONFIG.LODES_PROXY_URL.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {number} radiusMiles
   * @param {string} [vintage]   - LODES vintage year
   * @returns {Promise<{workplaces: Array, commutingFlows: Array}>}
   */
  function fetchLODES(lat, lon, radiusMiles, vintage) {
    vintage = vintage || '2021';
    var proxyUrl = (window.APP_CONFIG || {}).LODES_PROXY_URL;
    if (!proxyUrl) {
      // No proxy configured — degrade gracefully; PMACommuting will use synthetic workplaces
      return Promise.resolve({ workplaces: [], commutingFlows: [] });
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
   * Fetch National Transit Database (NTD) transit route and service data.
   * STUB: NTD data is an annual bulk download; no live spatial query API exists.
   * Returns empty stub until a server-side proxy ingesting the bulk data is available.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{transitRoutes: Array, serviceMetrics: object}>}
   */
  function fetchNTDData(bbox) {
    if (!bbox) return Promise.resolve({ transitRoutes: [], serviceMetrics: {} });
    // NTD data is annual bulk download; return empty stub for live queries
    return Promise.resolve({ transitRoutes: [], serviceMetrics: {} });
  }

  /**
   * Fetch EPA Smart Location Database transit accessibility metrics.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{transitAccessibility: number, walkScore: number}>}
   */
  function fetchEPASmartLocation(bbox) {
    if (!bbox) return Promise.resolve({ transitAccessibility: 50, walkScore: 50 });
    var fetcher = (typeof window.fetchWithTimeout === 'function')
      ? window.fetchWithTimeout
      : function (url) { return fetch(url); };
    var url = 'https://geodata.epa.gov/arcgis/rest/services/OA/SmartLocationDatabase/MapServer/0/query' +
              '?geometry=' + bbox.minLon + ',' + bbox.minLat + ',' + bbox.maxLon + ',' + bbox.maxLat +
              '&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=D4a,D3b&f=json' +
              '&returnGeometry=false';
    return fetcher(url)
      .then(function (r) {
        if (!r.ok) throw new Error('EPA SmartLocation HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var features = (data && data.features) ? data.features : [];
        if (!features.length) return { transitAccessibility: 50, walkScore: 50 };
        var d4aSum = 0, d3bSum = 0;
        features.forEach(function (f) {
          var a = (f.attributes || {});
          d4aSum += parseFloat(a.D4a || 0);
          d3bSum += parseFloat(a.D3b || 0);
        });
        return {
          transitAccessibility: Math.min(100, Math.round((d4aSum / features.length) * 5)),
          walkScore:            Math.min(100, Math.round((d3bSum / features.length) * 5))
        };
      })
      .catch(function () { return { transitAccessibility: 50, walkScore: 50 }; });
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

  /**
   * Fetch HUD Opportunity Atlas economic mobility data.
   * STUB: No public real-time API; returns neutral defaults until HUD bulk data
   * is ingested and a server-side proxy is configured.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{mobilityIndex: number, percentiles: Array}>}
   */
  function fetchHudOpportunityAtlas(bbox) {
    if (!bbox) return Promise.resolve({ mobilityIndex: 50, percentiles: [] });
    return Promise.resolve({ mobilityIndex: 50, percentiles: [] });
  }

  /**
   * Fetch HUD AFFH fair housing opportunity index data.
   * STUB: No public real-time API; returns neutral defaults until HUD bulk data
   * is ingested and a server-side proxy is configured.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{opportunityIndex: number, segregationMetrics: object}>}
   */
  function fetchHudAFFH(bbox) {
    if (!bbox) return Promise.resolve({ opportunityIndex: 50, segregationMetrics: {} });
    return Promise.resolve({ opportunityIndex: 50, segregationMetrics: {} });
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

  /**
   * Fetch NOAA climate data (normals and extremes) for a location.
   * @param {{lat:number,lon:number}} location
   * @param {string} [climateVariable]
   * @returns {Promise<{normals: object, extremes: object, resilienceScore: number}>}
   */
  function fetchNOAAClimateData(location, climateVariable) {
    // NOAA CDO API requires a token — return neutral stub when not configured
    var token = (window.APP_CONFIG || {}).NOAA_CDO_TOKEN;
    if (!token) return Promise.resolve({ normals: {}, extremes: {}, resilienceScore: 50 });
    var fetcher = (typeof window.fetchWithTimeout === 'function')
      ? window.fetchWithTimeout
      : function (url, opts) { return fetch(url, opts); };
    var url = 'https://www.ncdc.noaa.gov/cdo-web/api/v2/data' +
              '?datasetid=NORMAL_ANN&datatypeid=ANN-PRCP-NORMAL' +
              '&units=standard&limit=25';
    return fetcher(url, { headers: { token: token } })
      .then(function (r) { if (!r.ok) throw new Error('NOAA HTTP ' + r.status); return r.json(); })
      .then(function (d) { return { normals: d, extremes: {}, resilienceScore: 50 }; })
      .catch(function () { return { normals: {}, extremes: {}, resilienceScore: 50 }; });
  }

  /**
   * Fetch local utility infrastructure capacity data.
   * STUB: No public national API exists; returns a configurable 50 % headroom
   * default until jurisdiction-specific GIS data is available.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @param {string} [jurisdiction]
   * @returns {Promise<{sewerHeadroom: number, waterCapacity: number}>}
   */
  function fetchUtilityCapacity(bbox, jurisdiction) {
    // Utility data requires local GIS; return neutral 50 % headroom stub
    return Promise.resolve({ sewerHeadroom: 0.5, waterCapacity: 0.5 });
  }

  /**
   * Fetch USDA Food Access Atlas data for a bounding box.
   * STUB: USDA Food Access Atlas is a static dataset; returns empty stub until
   * bulk data is ingested and a server-side spatial query is available.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{foodDeserts: Array, proximityIndex: number}>}
   */
  function fetchFoodAccessAtlas(bbox) {
    if (!bbox) return Promise.resolve({ foodDeserts: [], proximityIndex: 50 });
    return Promise.resolve({ foodDeserts: [], proximityIndex: 50 });
  }

  /**
   * Fetch FEMA National Flood Hazard Layer data.
   * @param {{minLat,minLon,maxLat,maxLon}} bbox
   * @returns {Promise<{floodZones: Array, hazardPercent: number}>}
   */
  function fetchFEMAFloodData(bbox) {
    if (!bbox) return Promise.resolve({ floodZones: [], hazardPercent: 0.05 });
    var fetcher = (typeof window.fetchWithTimeout === 'function')
      ? window.fetchWithTimeout
      : function (url) { return fetch(url); };
    var url = 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query' +
              '?geometry=' + bbox.minLon + ',' + bbox.minLat + ',' + bbox.maxLon + ',' + bbox.maxLat +
              '&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=FLD_ZONE&f=geojson' +
              '&where=FLD_ZONE+IN+(\'AE\',\'AO\',\'A\',\'AH\')';
    return fetcher(url)
      .then(function (r) { if (!r.ok) throw new Error('FEMA NFHL HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        var features = (data && data.features) ? data.features : [];
        return { floodZones: features, hazardPercent: Math.min(1, features.length * 0.02) };
      })
      .catch(function () { return { floodZones: [], hazardPercent: 0.05 }; });
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
