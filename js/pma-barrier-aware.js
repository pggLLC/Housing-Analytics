/**
 * js/pma-barrier-aware.js
 * Default-off C2 barrier-aware PMA downweight helper.
 *
 * C2 contract: this module never changes shipped PMA behavior unless the
 * explicit flag is enabled. When enabled it downweights tract buffer shares
 * for crossed barriers; it never removes tracts and never zeroes weights.
 */
(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(root);
  } else {
    root.PMABarrierAware = factory(root);
  }
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var PMA_BARRIER_AWARE_ENABLED = false;
  var BARRIER_URL = 'market/natural_barriers_co.geojson';
  var FIXTURE_URL = 'test/fixtures/pma/barrier-downweight.fixture.json';
  var WARNING_UNAVAILABLE = 'Barrier data unavailable \u2014 circular-buffer weights in use';
  var DEFAULT_STATE = {
    enabled: false,
    available: false,
    beta: false,
    warning: null,
    mode_label: 'Barrier-aware downweight off',
    inventory_vintage: null,
    multiplier_source: null,
    multiplier: null,
    adjusted_tracts: 0
  };
  var _inputs = null;
  var _state = Object.assign({}, DEFAULT_STATE);

  function isEnabled() {
    return PMA_BARRIER_AWARE_ENABLED === true;
  }

  function _fetchJSON(path, rawPath) {
    var win = root || {};
    var DS = win.DataService;
    var url = rawPath ? path : (DS && typeof DS.baseData === 'function' ? DS.baseData(path) : 'data/' + path);
    if (DS && typeof DS.getJSON === 'function') return DS.getJSON(url);
    if (typeof win.fetch === 'function') {
      return win.fetch(url).then(function (res) {
        if (!res || !res.ok) throw new Error('fetch failed: ' + url);
        return res.json();
      });
    }
    return Promise.reject(new Error('fetch unavailable'));
  }

  function loadInputs(opts) {
    opts = opts || {};
    if (!isEnabled() && !opts.force) {
      _inputs = null;
      return Promise.resolve(null);
    }
    if (_inputs && !opts.force) return Promise.resolve(_inputs);
    return Promise.all([
      opts.barrierData ? Promise.resolve(opts.barrierData) : _fetchJSON(BARRIER_URL),
      opts.fixture ? Promise.resolve(opts.fixture) : _fetchJSON(FIXTURE_URL, true)
    ]).then(function (loaded) {
      _inputs = { barrierData: loaded[0], fixture: loaded[1] };
      return _inputs;
    }).catch(function (err) {
      _inputs = {
        barrierData: null,
        fixture: opts.fixture || null,
        warning: WARNING_UNAVAILABLE,
        error: err && err.message ? err.message : String(err)
      };
      return _inputs;
    });
  }

  function _num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function _pointFrom(v) {
    if (!v) return null;
    if (Array.isArray(v) && v.length >= 2) {
      var lon = _num(v[0]);
      var lat = _num(v[1]);
      return lon == null || lat == null ? null : { lon: lon, lat: lat };
    }
    var pLon = _num(v.lon != null ? v.lon : v.lng);
    var pLat = _num(v.lat);
    return pLon == null || pLat == null ? null : { lon: pLon, lat: pLat };
  }

  function pointIndexFromDisplayGeometry(displayGeometry) {
    var idx = {};
    ((displayGeometry && displayGeometry.features) || []).forEach(function (feature) {
      var p = feature.properties || {};
      var geoid = p.GEOID || p.geoid || p.GEOID20 || p.tract_geoid;
      var point = _pointFrom(p.point_on_surface);
      if (geoid && point) idx[String(geoid)] = point;
    });
    return idx;
  }

  function _project(point, origin) {
    var lat0 = _num(origin && origin.lat);
    var lon0 = _num(origin && origin.lon);
    var milesPerDegLon = 69.0 * Math.cos((lat0 || 0) * Math.PI / 180);
    return {
      x: (point.lon - lon0) * milesPerDegLon,
      y: (point.lat - lat0) * 69.0
    };
  }

  function _orientation(a, b, c) {
    return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  }

  function _onSegment(a, b, c) {
    var eps = 1e-9;
    return b.x <= Math.max(a.x, c.x) + eps && b.x + eps >= Math.min(a.x, c.x) &&
      b.y <= Math.max(a.y, c.y) + eps && b.y + eps >= Math.min(a.y, c.y);
  }

  function segmentsIntersect(a, b, c, d) {
    var eps = 1e-9;
    var o1 = _orientation(a, b, c);
    var o2 = _orientation(a, b, d);
    var o3 = _orientation(c, d, a);
    var o4 = _orientation(c, d, b);
    if (Math.abs(o1) < eps && _onSegment(a, c, b)) return true;
    if (Math.abs(o2) < eps && _onSegment(a, d, b)) return true;
    if (Math.abs(o3) < eps && _onSegment(c, a, d)) return true;
    if (Math.abs(o4) < eps && _onSegment(c, b, d)) return true;
    return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
  }

  function pointInRing(point, ring) {
    if (!point || !ring || ring.length < 4) return false;
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1];
      var xj = ring[j][0], yj = ring[j][1];
      var intersect = ((yi > point.lat) !== (yj > point.lat)) &&
        (point.lon < (xj - xi) * (point.lat - yi) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function pointInPolygon(point, polygon) {
    if (!polygon || !polygon.length || !pointInRing(point, polygon[0])) return false;
    for (var i = 1; i < polygon.length; i++) {
      if (pointInRing(point, polygon[i])) return false;
    }
    return true;
  }

  function _lineStrings(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'LineString') return [geometry.coordinates || []];
    if (geometry.type === 'MultiLineString') return geometry.coordinates || [];
    return [];
  }

  function _polygons(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates || []];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates || [];
    return [];
  }

  function _routeLabel(props) {
    props = props || {};
    var sign = props.route_sign || '';
    var route = props.route || props.name || '';
    var asString = String(route || '');
    var match = asString.match(/(\d+)/);
    if (match) {
      var n = String(parseInt(match[1], 10));
      if (sign === 'I' || /^I[-\s]?\d+/i.test(asString)) return 'I-' + n;
      if (sign === 'U' || /^US[-\s]?\d+/i.test(asString)) return 'US-' + n;
    }
    return props.name || props.route || props.sub_type || props.barrier_type || 'barrier';
  }

  function _crossingKey(props, fallback) {
    var label = _routeLabel(props);
    if ((props && props.barrier_type) === 'highway') return 'highway:' + label;
    return String(props && (props.name || props.route || props.source_id) || fallback || label);
  }

  function _segmentCrossesLineString(site, tractPoint, line, origin) {
    if (!line || line.length < 2) return false;
    var a = _project(site, origin);
    var b = _project(tractPoint, origin);
    for (var i = 1; i < line.length; i++) {
      var c0 = _pointFrom(line[i - 1]);
      var c1 = _pointFrom(line[i]);
      if (!c0 || !c1) continue;
      if (segmentsIntersect(a, b, _project(c0, origin), _project(c1, origin))) return true;
    }
    return false;
  }

  function _segmentPassesPolygon(site, tractPoint, polygon, origin) {
    if (!polygon || !polygon.length) return false;
    if (pointInPolygon(site, polygon) || pointInPolygon(tractPoint, polygon)) return true;
    for (var r = 0; r < polygon.length; r++) {
      if (_segmentCrossesLineString(site, tractPoint, polygon[r], origin)) return true;
    }
    return false;
  }

  function crossingInventory(site, tractPoint, barrierData) {
    var sitePoint = _pointFrom(site);
    var targetPoint = _pointFrom(tractPoint);
    if (!sitePoint || !targetPoint) return [];
    var origin = sitePoint;
    var seen = {};
    var crossings = [];
    ((barrierData && barrierData.features) || []).forEach(function (feature, index) {
      var props = feature.properties || {};
      var geometry = feature.geometry || {};
      var type = props.barrier_type;
      var crossed = false;
      if (type === 'highway') {
        _lineStrings(geometry).forEach(function (line) {
          if (!crossed && _segmentCrossesLineString(sitePoint, targetPoint, line, origin)) crossed = true;
        });
      } else if (type === 'water') {
        _lineStrings(geometry).forEach(function (line) {
          if (!crossed && _segmentCrossesLineString(sitePoint, targetPoint, line, origin)) crossed = true;
        });
        _polygons(geometry).forEach(function (polygon) {
          if (!crossed && _segmentPassesPolygon(sitePoint, targetPoint, polygon, origin)) crossed = true;
        });
      }
      if (!crossed) return;
      var key = _crossingKey(props, index);
      if (seen[key]) return;
      seen[key] = true;
      crossings.push({
        key: key,
        label: _routeLabel(props),
        barrier_type: type || null,
        sub_type: props.sub_type || null
      });
    });
    return crossings;
  }

  function _fixtureMultiplier(fixture) {
    var multiplier = Number(fixture && fixture.multiplier);
    if (!isFinite(multiplier) || multiplier <= 0 || multiplier >= 1) return null;
    return multiplier;
  }

  function applyToTracts(tracts, opts) {
    opts = opts || {};
    if (!isEnabled() && !opts.forceEnabled) {
      _state = Object.assign({}, DEFAULT_STATE);
      return { tracts: tracts, state: Object.assign({}, _state) };
    }
    var fixture = opts.fixture || (_inputs && _inputs.fixture) || {};
    var multiplier = _fixtureMultiplier(fixture);
    var barrierData = opts.barrierData || (_inputs && _inputs.barrierData);
    var pointIndex = opts.pointIndex || pointIndexFromDisplayGeometry(opts.displayGeometry);
    var source = fixture.source || fixture.source_doc || 'test/fixtures/pma/barrier-downweight.fixture.json';
    if (!barrierData || !Array.isArray(barrierData.features) || !barrierData.features.length || multiplier == null) {
      _state = {
        enabled: true,
        available: false,
        beta: true,
        warning: WARNING_UNAVAILABLE,
        mode_label: 'Barrier-aware downweight beta unavailable',
        inventory_vintage: null,
        multiplier_source: source,
        multiplier: multiplier,
        adjusted_tracts: 0
      };
      return { tracts: tracts, state: Object.assign({}, _state), warning: WARNING_UNAVAILABLE };
    }
    var adjustedCount = 0;
    var out = (tracts || []).map(function (tract) {
      var geoid = String(tract && (tract.geoid || tract.GEOID || tract.GEOID20 || tract.tract_geoid) || '');
      var target = pointIndex[geoid] || _pointFrom(tract && { lat: tract.lat, lon: tract.lon });
      var baseShare = typeof tract._bufferShare === 'number' ? tract._bufferShare : 1;
      var crossings = crossingInventory(opts.site, target, barrierData);
      if (!crossings.length || baseShare <= 0) return tract;
      var copy = Object.assign({}, tract);
      var nextShare = baseShare * multiplier;
      copy._bufferShareBase = baseShare;
      copy._bufferShare = Math.max(Number.EPSILON, nextShare);
      copy._barrierAware = true;
      copy._barrierMultiplier = multiplier;
      copy._barrierCrossings = crossings;
      copy._barrierBadge = 'separated by ' + crossings.map(function (c) { return c.label; }).join(' + ') +
        ' \u00b7 weight reduced [placeholder]';
      adjustedCount++;
      return copy;
    });
    _state = {
      enabled: true,
      available: true,
      beta: true,
      warning: null,
      mode_label: 'Barrier-aware downweight beta on',
      inventory_vintage: (barrierData.meta && (barrierData.meta.generated_at || barrierData.meta.last_verified || barrierData.meta.vintage)) || null,
      multiplier_source: source,
      multiplier: multiplier,
      adjusted_tracts: adjustedCount
    };
    return { tracts: out, state: Object.assign({}, _state) };
  }

  function getState() {
    return Object.assign({}, _state);
  }

  return {
    PMA_BARRIER_AWARE_ENABLED: PMA_BARRIER_AWARE_ENABLED,
    WARNING_UNAVAILABLE: WARNING_UNAVAILABLE,
    isEnabled: isEnabled,
    loadInputs: loadInputs,
    applyToTracts: applyToTracts,
    crossingInventory: crossingInventory,
    pointIndexFromDisplayGeometry: pointIndexFromDisplayGeometry,
    segmentsIntersect: segmentsIntersect,
    pointInPolygon: pointInPolygon,
    getState: getState,
    _routeLabel: _routeLabel
  };
}));
