/**
 * js/environmental-screening.js
 * Environmental Constraints Overlay — Phase 2.1
 *
 * Assesses environmental risk for a site (lat/lon) using preloaded public
 * data: FEMA flood zones, EPA Superfund/brownfield sites, and county-level
 * soil/seismic heuristics.
 *
 * Non-goals:
 *   - Does NOT replace a Phase I Environmental Site Assessment (professional required)
 *   - Does NOT perform real-time API calls — all data is preloaded from local files
 *   - Does NOT assess zoning or land-use compatibility
 *
 * Usage:
 *   EnvironmentalScreening.load(floodGeoJSON, epaData).then(function () {
 *     var result = EnvironmentalScreening.assess(39.74, -104.99, 1.0);
 *   });
 *
 * Exposed as window.EnvironmentalScreening (browser) and module.exports (Node).
 *
 * @typedef {Object} EnvRiskResult
 * @property {Object}  floodZone        — { zone, riskLevel, sfha, year100Flood, narrative }
 * @property {Object}  soil             — { stability, liquefactionRisk, narrative }
 * @property {Object}  hazmat           — { superfundSites, brownfieldSites, nearestSuperfundMi, narrative }
 * @property {Object}  culturalHeritage — { nhpd, tribalLand }
 * @property {string}  riskBadge        — '🟢 Low' | '🟡 Moderate' | '🔴 High'
 * @property {string}  overallRisk      — 'low' | 'moderate' | 'high'
 * @property {string}  narrative        — human-readable summary
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EnvironmentalScreening = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── Internal state ─────────────────────────────────────────────── */
  var _floodFeatures  = [];
  var _superfundSites = [];
  var _brownfieldSites = [];
  var _loaded         = false;

  /* ── Constants ───────────────────────────────────────────────────── */
  var HIGH_RISK_ZONES  = ['AE', 'AO', 'AH', 'VE', 'V', 'A', 'AR', 'A99'];
  var MOD_RISK_ZONES   = ['X500', 'X (shaded)'];
  var MILES_TO_DEG_LAT = 1 / 69.0;          // ~1 degree lat ≈ 69 miles
  var DEFAULT_BUFFER   = 0.5;               // miles

  /* ── Geometry helpers ────────────────────────────────────────────── */

  /** Convert miles to degrees longitude at a given latitude. */
  function _milesToDegLon(miles, lat) {
    return miles / (69.0 * Math.cos(lat * Math.PI / 180));
  }

  /** Point-in-bounding-box test. */
  function _inBBox(lat, lon, bbox) {
    return lat >= bbox[1] && lat <= bbox[3] && lon >= bbox[0] && lon <= bbox[2];
  }

  /** Compute bounding box from ring. */
  function _ringBBox(ring) {
    var minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (var i = 0; i < ring.length; i++) {
      if (ring[i][0] < minLon) minLon = ring[i][0];
      if (ring[i][0] > maxLon) maxLon = ring[i][0];
      if (ring[i][1] < minLat) minLat = ring[i][1];
      if (ring[i][1] > maxLat) maxLat = ring[i][1];
    }
    return [minLon, minLat, maxLon, maxLat];
  }

  /** Point-in-polygon (ray casting). */
  function _pointInRing(lat, lon, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1];
      var xj = ring[j][0], yj = ring[j][1];
      var intersect = ((yi > lat) !== (yj > lat)) &&
                      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /** Check if point (lat, lon) is inside a GeoJSON polygon/multipolygon. */
  function _pointInFeature(lat, lon, geometry) {
    var type  = geometry.type;
    var coords = geometry.coordinates;
    if (type === 'Polygon') {
      return _pointInRing(lat, lon, coords[0]);
    }
    if (type === 'MultiPolygon') {
      for (var i = 0; i < coords.length; i++) {
        if (_pointInRing(lat, lon, coords[i][0])) return true;
      }
    }
    return false;
  }

  /** Haversine distance in miles. */
  function _distanceMiles(lat1, lon1, lat2, lon2) {
    var R  = 3958.8;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a  = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
             Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
             Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ── Flood zone assessment ──────────────────────────────────────── */
  function _assessFlood(lat, lon) {
    var matched = null;
    for (var i = 0; i < _floodFeatures.length; i++) {
      var f = _floodFeatures[i];
      try {
        if (_pointInFeature(lat, lon, f.geometry)) {
          matched = f.properties;
          break;
        }
      } catch (e) { /* skip malformed features */ }
    }

    if (!matched) {
      return {
        zone:        'X',
        riskLevel:   'low',
        sfha:        false,
        year100Flood: false,
        narrative:   'Outside mapped flood hazard area (Zone X).'
      };
    }

    var zone    = matched.FLD_ZONE || 'X';
    var sfha    = matched.SFHA_TF === 'T';
    var isHigh  = HIGH_RISK_ZONES.indexOf(zone) !== -1;
    var isMod   = MOD_RISK_ZONES.indexOf(zone) !== -1 || zone === 'X500';
    var risk    = isHigh ? 'high' : (isMod ? 'moderate' : 'low');

    var narrative;
    if (isHigh) {
      narrative = 'Site is in a Special Flood Hazard Area (Zone ' + zone + '). ' +
        'Flood insurance required; mitigation may be needed.';
    } else if (isMod) {
      narrative = 'Site is in a moderate flood risk area (Zone ' + zone + '). ' +
        'Flood insurance recommended.';
    } else {
      narrative = 'Site is outside the Special Flood Hazard Area (Zone ' + zone + ').';
    }

    return {
      zone:         zone,
      riskLevel:    risk,
      sfha:         sfha,
      year100Flood: isHigh,
      narrative:    narrative
    };
  }

  /* ── Hazmat / Superfund assessment ─────────────────────────────── */
  function _assessHazmat(lat, lon, bufferMiles) {
    var buf = typeof bufferMiles === 'number' ? bufferMiles : DEFAULT_BUFFER;
    var superfundCount   = 0;
    var brownfieldCount  = 0;
    var nearestSuperfundMi = Infinity;

    _superfundSites.forEach(function (s) {
      var d = _distanceMiles(lat, lon, s.lat, s.lon);
      if (d <= buf) {
        superfundCount++;
        if (d < nearestSuperfundMi) nearestSuperfundMi = d;
      }
    });

    _brownfieldSites.forEach(function (s) {
      var d = _distanceMiles(lat, lon, s.lat, s.lon);
      if (d <= buf) brownfieldCount++;
    });

    var risk;
    if (superfundCount > 0) {
      risk = 'high';
    } else if (brownfieldCount > 0) {
      risk = 'moderate';
    } else {
      risk = 'low';
    }

    var narrative;
    if (superfundCount > 0) {
      narrative = superfundCount + ' EPA Superfund site' + (superfundCount > 1 ? 's' : '') +
        ' within ' + buf + ' mile' + (buf !== 1 ? 's' : '') +
        (nearestSuperfundMi < Infinity ? ' (nearest: ' + nearestSuperfundMi.toFixed(2) + ' mi)' : '') +
        '. Phase I ESA required.';
    } else if (brownfieldCount > 0) {
      narrative = brownfieldCount + ' brownfield site' + (brownfieldCount > 1 ? 's' : '') +
        ' within ' + buf + ' mile' + (buf !== 1 ? 's' : '') + '. Environmental review recommended.';
    } else {
      narrative = 'No known Superfund or brownfield sites within ' + buf + ' mile' + (buf !== 1 ? 's' : '') + '.';
    }

    return {
      superfundSites:     superfundCount,
      brownfieldSites:    brownfieldCount,
      nearestSuperfundMi: nearestSuperfundMi < Infinity ? parseFloat(nearestSuperfundMi.toFixed(2)) : null,
      riskLevel:          risk,
      narrative:          narrative
    };
  }

  /* ── Soil / seismic heuristic ───────────────────────────────────── */
  function _assessSoil(lat, lon) {
    // County-level liquefaction heuristics based on USGS hazard maps for Colorado.
    // Front Range alluvial plains: moderate risk. Mountain/foothill bedrock: low.
    // San Luis Valley: low–moderate (expansive clay).
    var liquefactionRisk;
    var stability;
    var narrative;

    // Rough Front Range alluvial corridor (Denver–Pueblo band)
    if (lon >= -105.2 && lon <= -104.6 && lat >= 37.8 && lat <= 40.4) {
      liquefactionRisk = 0.18;
      stability = 'moderate';
      narrative = 'Front Range alluvial soils — moderate liquefaction risk; ' +
        'geotechnical report recommended.';
    } else if (lon <= -105.5 && lat >= 38.5 && lat <= 40.5) {
      // Mountain/foothill zone
      liquefactionRisk = 0.05;
      stability = 'good';
      narrative = 'Rocky Mountain foothill/bedrock — generally stable; ' +
        'site-specific geotech still advised on slopes.';
    } else if (lat < 37.8) {
      // Southern plains
      liquefactionRisk = 0.10;
      stability = 'good';
      narrative = 'Southern plains soils — generally stable, low seismic risk.';
    } else {
      // Eastern plains
      liquefactionRisk = 0.08;
      stability = 'good';
      narrative = 'Eastern plains — stable soils, low seismic hazard.';
    }

    return {
      stability:        stability,
      liquefactionRisk: liquefactionRisk,
      riskLevel:        liquefactionRisk > 0.15 ? 'moderate' : 'low',
      narrative:        narrative
    };
  }

  /* ── Overall risk aggregation ───────────────────────────────────── */
  function _aggregateRisk(flood, hazmat, soil) {
    var levels = { low: 0, moderate: 1, high: 2 };
    var max = Math.max(
      levels[flood.riskLevel]  || 0,
      levels[hazmat.riskLevel] || 0,
      levels[soil.riskLevel]   || 0
    );
    if (max >= 2) return 'high';
    if (max >= 1) return 'moderate';
    return 'low';
  }

  var _BADGES = { high: '🔴 High', moderate: '🟡 Moderate', low: '🟢 Low' };

  /* ── Public API ─────────────────────────────────────────────────── */

  /**
   * Load environmental datasets into memory.
   * In a browser environment, fetch the local JSON files.
   * In Node.js (tests), pass the data directly.
   *
   * @param {Object|null} floodGeoJSON  - GeoJSON FeatureCollection or null
   * @param {Object|null} epaData       - EPA JSON object or null
   * @returns {Promise<void>}
   */
  function load(floodGeoJSON, epaData) {
    if (floodGeoJSON && floodGeoJSON.features) {
      _floodFeatures = floodGeoJSON.features.filter(function (f) {
        return f && f.geometry && f.properties;
      });
    }
    if (epaData) {
      _superfundSites  = epaData.superfundSites  || [];
      _brownfieldSites = epaData.brownfieldSites || [];
    }
    _loaded = true;
    return Promise.resolve();
  }

  /**
   * Assess environmental risk for a site.
   *
   * @param {number} lat         - Site latitude (WGS84)
   * @param {number} lon         - Site longitude (WGS84)
   * @param {number} [bufferMiles=0.5] - Search radius for hazmat sites
   * @returns {EnvRiskResult}
   */
  function assess(lat, lon, bufferMiles) {
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return {
        floodZone:       { zone: 'Unknown', riskLevel: 'low', sfha: false, year100Flood: false, narrative: 'Invalid coordinates.' },
        soil:            { stability: 'unknown', liquefactionRisk: null, riskLevel: 'low', narrative: 'Invalid coordinates.' },
        hazmat:          { superfundSites: 0, brownfieldSites: 0, nearestSuperfundMi: null, riskLevel: 'low', narrative: 'Invalid coordinates.' },
        culturalHeritage: { nhpd: false, tribalLand: false },
        riskBadge:       '⚪ Unknown',
        overallRisk:     'low',
        narrative:       'Could not assess — invalid coordinates provided.'
      };
    }

    var flood  = _assessFlood(lat, lon);
    var soil   = _assessSoil(lat, lon);
    var hazmat = _assessHazmat(lat, lon, bufferMiles);
    var overall = _aggregateRisk(flood, hazmat, soil);

    var narrativeParts = [];
    if (flood.riskLevel  !== 'low') narrativeParts.push(flood.narrative);
    if (hazmat.riskLevel !== 'low') narrativeParts.push(hazmat.narrative);
    if (soil.riskLevel   !== 'low') narrativeParts.push(soil.narrative);
    if (narrativeParts.length === 0) {
      narrativeParts.push('No significant environmental constraints identified in initial screening.');
    }

    return {
      floodZone:       flood,
      soil:            soil,
      hazmat:          hazmat,
      culturalHeritage: { nhpd: false, tribalLand: false },
      riskBadge:       _BADGES[overall] || '⚪ Unknown',
      overallRisk:     overall,
      narrative:       narrativeParts.join(' ')
    };
  }

  /**
   * Returns true if data has been loaded via load().
   * @returns {boolean}
   */
  function isLoaded() {
    return _loaded;
  }

  return {
    load:     load,
    assess:   assess,
    isLoaded: isLoaded,
    /* Exposed for testing */
    _distanceMiles:    _distanceMiles,
    _pointInRing:      _pointInRing,
    _aggregateRisk:    _aggregateRisk
  };
}));
