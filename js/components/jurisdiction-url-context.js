/**
 * Shared jurisdiction resolver for cross-page workflow links.
 *
 * Reads ?fips= / ?geoid= URL params first, then falls back to WorkflowState
 * and SiteState. Seven-digit place/CDP GEOIDs are mapped to their containing
 * county via data/hna/geo-config.json so county-only tools can auto-select.
 */
(function (global) {
  'use strict';

  var _geoPromise = null;
  var _geoConfig = null;
  var _lastContext = null;

  function _asset(path) {
    return (typeof global.resolveAssetUrl === 'function') ? global.resolveAssetUrl(path) : path;
  }

  function _loadGeoConfig() {
    if (_geoConfig) return Promise.resolve(_geoConfig);
    if (_geoPromise) return _geoPromise;
    _geoPromise = fetch(_asset('data/hna/geo-config.json'))
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        _geoConfig = json || {};
        return _geoConfig;
      });
    return _geoPromise;
  }

  function _findByGeoid(items, geoid) {
    if (!Array.isArray(items)) return null;
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].geoid) === String(geoid)) return items[i];
    }
    return null;
  }

  function _countyName(config, countyFips) {
    var county = _findByGeoid(config && config.counties, countyFips);
    return county && county.label ? county.label : null;
  }

  function _baseFromUrl() {
    try {
      var sp = new URLSearchParams(global.location.search || '');
      var raw = sp.get('fips') || sp.get('geoid');
      if (!raw || !/^\d{5,7}$/.test(raw)) return null;
      var geoType = sp.get('geoType') || (raw.length === 5 ? 'county' : 'place');
      return {
        fips: raw,
        geoid: raw,
        geoType: geoType,
        source: 'url',
        auto: sp.get('auto') === '1'
      };
    } catch (_) {
      return null;
    }
  }

  function _baseFromWorkflow() {
    try {
      var project = global.WorkflowState && global.WorkflowState.getActiveProject && global.WorkflowState.getActiveProject();
      var jx = project && (project.jurisdiction || (project.steps && project.steps.jurisdiction));
      if (!jx) return null;
      if (jx.placeGeoid && /^\d{7}$/.test(jx.placeGeoid)) {
        return {
          fips: jx.placeGeoid,
          geoid: jx.placeGeoid,
          geoType: 'place',
          countyFips: jx.fips || jx.countyFips || null,
          displayName: jx.displayName || jx.cityName || null,
          countyName: jx.name || jx.countyName || null,
          source: 'workflow'
        };
      }
      if (jx.fips || jx.countyFips) {
        return {
          fips: jx.fips || jx.countyFips,
          geoid: jx.fips || jx.countyFips,
          geoType: 'county',
          countyFips: jx.fips || jx.countyFips,
          displayName: jx.displayName || jx.name || jx.countyName || null,
          countyName: jx.name || jx.countyName || null,
          source: 'workflow'
        };
      }
    } catch (_) {}
    return null;
  }

  function _baseFromSiteState() {
    try {
      var county = global.SiteState && global.SiteState.getCounty && global.SiteState.getCounty();
      if (county && county.fips) {
        return {
          fips: county.fips,
          geoid: county.fips,
          geoType: 'county',
          countyFips: county.fips,
          displayName: county.name || null,
          countyName: county.name || null,
          source: 'sitestate'
        };
      }
    } catch (_) {}
    return null;
  }

  function _baseContext() {
    return _baseFromUrl() || _baseFromWorkflow() || _baseFromSiteState();
  }

  function _enrich(base, config) {
    if (!base) return null;
    var ctx = {};
    for (var k in base) ctx[k] = base[k];

    if (/^\d{5}$/.test(ctx.geoid || ctx.fips)) {
      ctx.geoType = 'county';
      ctx.countyFips = ctx.geoid || ctx.fips;
      ctx.fips = ctx.countyFips;
      ctx.countyName = ctx.countyName || _countyName(config, ctx.countyFips);
      ctx.displayName = ctx.displayName || ctx.countyName;
      return ctx;
    }

    if (/^\d{7}$/.test(ctx.geoid || ctx.fips)) {
      var geoid = ctx.geoid || ctx.fips;
      var place = _findByGeoid(config && config.places, geoid) || _findByGeoid(config && config.cdps, geoid);
      ctx.geoType = (place && place.type) || ctx.geoType || 'place';
      ctx.placeGeoid = geoid;
      ctx.fips = geoid;
      if (place) {
        ctx.displayName = ctx.displayName || place.label || null;
        ctx.countyFips = ctx.countyFips || place.containingCounty || null;
      }
      ctx.countyName = ctx.countyName || _countyName(config, ctx.countyFips);
      return ctx;
    }
    return ctx;
  }

  function _emit(ctx) {
    _lastContext = ctx || null;
    try {
      document.dispatchEvent(new CustomEvent('jurisdiction-url-context:resolved', { detail: _lastContext }));
    } catch (_) {}
    return _lastContext;
  }

  function resolveSync() {
    var base = _baseContext();
    if (!base && _lastContext) return _lastContext;
    if (!base) return null;
    return _enrich(base, _geoConfig || {});
  }

  function resolve() {
    var base = _baseContext();
    if (!base) return Promise.resolve(_emit(null));
    if ((base.geoid || base.fips || '').length === 7 && !_geoConfig) {
      return _loadGeoConfig().then(function (config) {
        return _emit(_enrich(base, config));
      }).catch(function () {
        return _emit(_enrich(base, {}));
      });
    }
    if (!_geoConfig) {
      return _loadGeoConfig().then(function (config) {
        return _emit(_enrich(base, config));
      }).catch(function () {
        return _emit(_enrich(base, {}));
      });
    }
    return Promise.resolve(_emit(_enrich(base, _geoConfig)));
  }

  function isUrlContextPresent() {
    return !!_baseFromUrl();
  }

  global.JurisdictionUrlContext = {
    resolve: resolve,
    resolveSync: resolveSync,
    isUrlContextPresent: isUrlContextPresent
  };
})(typeof window !== 'undefined' ? window : this);
