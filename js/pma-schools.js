/**
 * js/pma-schools.js
 * School district boundary integration for PMA delineation.
 *
 * Responsibilities:
 *  - fetchSchoolBoundaries(boundingBox) — ED attendance boundaries + NCES metrics
 *  - alignPMAWithSchools(pmaPolygon, schoolDistricts) — boundary alignment
 *  - scoreSchoolAccessibility(siteLat, siteLon, schools) — 0–100 score
 *  - getSchoolLayer() — GeoJSON layer with performance overlay
 *  - getSchoolJustification() — audit-ready school data summary
 *
 * School catchment area alignment is a key resident draw factor for
 * family-size affordable housing projects.
 *
 * Exposed as window.PMASchools.
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────── */
  var EARTH_RADIUS_MI     = 3958.8;
  var SCHOOL_SEARCH_MILES = 10;     // search radius for schools near site
  var PERFORMANCE_UNKNOWN = 50;     // default score when NCES data unavailable

  /* ── Internal state ───────────────────────────────────────────────── */
  var lastSchools          = [];
  var lastAlignedDistricts = [];
  var lastAccessScore      = 0;

  /* ── Utility helpers ─────────────────────────────────────────────── */
  function toRad(deg) { return deg * Math.PI / 180; }

  function haversine(lat1, lon1, lat2, lon2) {
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function toNum(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  /* ── Core API ────────────────────────────────────────────────────── */

  /**
   * Fetch school attendance boundaries and NCES performance metrics.
   * @param {{minLat,minLon,maxLat,maxLon}} boundingBox
   * @returns {Promise<{schoolDistricts: Array, schools: Array}>}
   */
  function fetchSchoolBoundaries(boundingBox) {
    var ds = (typeof window !== 'undefined') ? window.DataService : null;
    if (ds && typeof ds.fetchSchoolBoundaries === 'function') {
      return ds.fetchSchoolBoundaries(boundingBox);
    }
    return Promise.resolve({ schoolDistricts: [], schools: [] });
  }

  /**
   * Align PMA boundary with school catchment areas.
   * Returns a list of school districts that overlap the PMA polygon,
   * annotated with performance metrics.
   *
   * @param {object} pmaPolygon      - GeoJSON Polygon geometry
   * @param {Array}  schoolDistricts - Array from fetchSchoolBoundaries
   * @returns {{alignedDistricts: Array, alignmentRationale: string, districtCount: number}}
   */
  function alignPMAWithSchools(pmaPolygon, schoolDistricts) {
    schoolDistricts = schoolDistricts || [];

    if (!pmaPolygon || !schoolDistricts.length) {
      lastAlignedDistricts = [];
      return {
        alignedDistricts:    [],
        alignmentRationale:  'No school boundary data available.',
        districtCount:       0
      };
    }

    // Extract PMA centroid from polygon coordinates for proximity check
    var coords = (pmaPolygon.coordinates && pmaPolygon.coordinates[0]) || [];
    var centLat = 0, centLon = 0;
    coords.forEach(function (c) { centLat += c[1]; centLon += c[0]; });
    if (coords.length) {
      centLat /= coords.length;
      centLon /= coords.length;
    }

    // Score each district by proximity to PMA centroid
    var annotated = schoolDistricts.map(function (d) {
      var dLat = toNum(d.lat || d.centroidLat || centLat);
      var dLon = toNum(d.lon || d.centroidLon || centLon);
      var dist = haversine(centLat, centLon, dLat, dLon);
      return Object.assign({}, d, {
        distanceMiles:  Math.round(dist * 10) / 10,
        performanceScore: toNum(d.performanceScore || d.ncesScore || PERFORMANCE_UNKNOWN)
      });
    });

    // Retain districts within the PMA boundary approximation (≤ 10 miles)
    var aligned = annotated.filter(function (d) {
      return d.distanceMiles <= SCHOOL_SEARCH_MILES;
    }).sort(function (a, b) { return a.distanceMiles - b.distanceMiles; });

    lastAlignedDistricts = aligned;
    lastSchools = aligned;

    var avgPerf = aligned.length
      ? Math.round(aligned.reduce(function (s, d) { return s + d.performanceScore; }, 0) / aligned.length)
      : PERFORMANCE_UNKNOWN;

    var rationale = aligned.length
      ? 'PMA boundary aligned with ' + aligned.length + ' school district(s). ' +
        'Average performance score: ' + avgPerf + '/100. ' +
        'Nearest: ' + (aligned[0].name || aligned[0].districtName || 'Unknown') + '.'
      : 'No school districts within PMA boundary.';

    return {
      alignedDistricts:     aligned,
      alignmentRationale:   rationale,
      districtCount:        aligned.length,
      averagePerformanceScore: avgPerf
    };
  }

  /**
   * Calculate a 0–100 school accessibility score for a proposed site.
   * Weighs proximity (60 %) and performance (40 %).
   *
   * @param {number} siteLat
   * @param {number} siteLon
   * @param {Array}  schools  - Array of school objects with lat, lon, performanceScore
   * @returns {number} 0–100
   */
  function scoreSchoolAccessibility(siteLat, siteLon, schools) {
    schools = schools || lastAlignedDistricts;
    if (!schools || !schools.length) { return PERFORMANCE_UNKNOWN; }

    var nearby = schools.filter(function (s) {
      var d = haversine(siteLat, siteLon, toNum(s.lat || s.centroidLat || siteLat), toNum(s.lon || s.centroidLon || siteLon));
      return d <= SCHOOL_SEARCH_MILES;
    });

    if (!nearby.length) { return PERFORMANCE_UNKNOWN; }

    // Proximity score: 100 for < 0.5 mi, declining to 0 at 10 mi
    var proxSum = 0, perfSum = 0;
    nearby.forEach(function (s) {
      var dist = haversine(siteLat, siteLon,
        toNum(s.lat || s.centroidLat || siteLat),
        toNum(s.lon || s.centroidLon || siteLon));
      proxSum += Math.max(0, 1 - dist / SCHOOL_SEARCH_MILES);
      perfSum += toNum(s.performanceScore || PERFORMANCE_UNKNOWN) / 100;
    });

    var proxScore = (proxSum / nearby.length) * 100;
    var perfScore = (perfSum / nearby.length) * 100;
    var combined  = Math.round(0.6 * proxScore + 0.4 * perfScore);

    lastAccessScore = Math.min(100, Math.max(0, combined));
    return lastAccessScore;
  }

  /**
   * Build a GeoJSON FeatureCollection for the school layer map display.
   * @param {Array} [schools]
   * @returns {object} GeoJSON FeatureCollection
   */
  function getSchoolLayer(schools) {
    schools = schools || lastSchools;
    var features = (schools || []).map(function (s) {
      var lat = toNum(s.lat || s.centroidLat || 0);
      var lon = toNum(s.lon || s.centroidLon || 0);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          name:             s.name || s.districtName || 'School District',
          performanceScore: toNum(s.performanceScore || PERFORMANCE_UNKNOWN),
          distanceMiles:    toNum(s.distanceMiles || 0),
          type:             s.schoolType || 'K-12',
          ncesId:           s.ncesId || null
        }
      };
    });
    return { type: 'FeatureCollection', features: features };
  }

  /**
   * Export school integration data for ScoreRun audit trail.
   * @returns {object}
   */
  function getSchoolJustification() {
    var avgPerf = lastAlignedDistricts.length
      ? Math.round(
          lastAlignedDistricts.reduce(function (s, d) { return s + toNum(d.performanceScore || PERFORMANCE_UNKNOWN); }, 0) /
          lastAlignedDistricts.length
        )
      : PERFORMANCE_UNKNOWN;

    return {
      schoolDistrictsAligned: lastAlignedDistricts.length,
      averagePerformanceScore: avgPerf,
      accessibilityScore:     lastAccessScore,
      alignmentRationale:     lastAlignedDistricts.length
        ? 'PMA boundary encompasses ' + lastAlignedDistricts.length + ' school district(s) with avg performance score ' + avgPerf + '.'
        : 'No school boundary data was available for this analysis.'
    };
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  if (typeof window !== 'undefined') {
    window.PMASchools = {
      fetchSchoolBoundaries:    fetchSchoolBoundaries,
      alignPMAWithSchools:      alignPMAWithSchools,
      scoreSchoolAccessibility: scoreSchoolAccessibility,
      getSchoolLayer:           getSchoolLayer,
      getSchoolJustification:   getSchoolJustification
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      fetchSchoolBoundaries:    fetchSchoolBoundaries,
      alignPMAWithSchools:      alignPMAWithSchools,
      scoreSchoolAccessibility: scoreSchoolAccessibility,
      getSchoolLayer:           getSchoolLayer,
      getSchoolJustification:   getSchoolJustification
    };
  }

}());
