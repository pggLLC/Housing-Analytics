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
  // PERFORMANCE_UNKNOWN = 50 used to stand in wherever a performance measure
  // was missing. Every school this module now sees is missing one — NCES CCD
  // School Locations carries no performance measure — so that constant would
  // have turned an absence into a confident "50/100 average" on every run.
  // Absence is null here, and the reason travels with it (#1541, #1480).
  var PERFORMANCE_UNAVAILABLE_REASON =
    'NCES CCD School Locations carries no performance measure; no performance source is wired in.';

  /* ── Internal state ───────────────────────────────────────────────── */
  var lastSchools          = [];
  var lastAlignedDistricts = [];
  var lastAccessWeighting = null;
  // null, not 0 — before scoring runs there is no score, and 0 would read
  // as "worst possible schools" rather than "not computed".
  var lastAccessScore      = null;

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
  /** Absence-preserving numeric coercion: null stays null, never 0. */
  function numOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }
  function hasPerf(x) { return numOrNull(x && x.performanceScore) !== null; }

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
        performanceScore: numOrNull(d.performanceScore !== null && d.performanceScore !== undefined
          ? d.performanceScore : d.ncesScore)
      });
    });

    // Retain districts within the PMA boundary approximation (≤ 10 miles)
    var aligned = annotated.filter(function (d) {
      return d.distanceMiles <= SCHOOL_SEARCH_MILES;
    }).sort(function (a, b) { return a.distanceMiles - b.distanceMiles; });

    lastAlignedDistricts = aligned;
    lastSchools = aligned;

    var scored = aligned.filter(hasPerf);
    var avgPerf = scored.length
      ? Math.round(scored.reduce(function (s, d) { return s + d.performanceScore; }, 0) / scored.length)
      : null;

    var rationale = aligned.length
      ? 'PMA boundary contains ' + aligned.length + ' school(s) within ' +
        SCHOOL_SEARCH_MILES + ' miles. ' +
        'Nearest: ' + (aligned[0].name || aligned[0].districtName || 'Unknown') + '. ' +
        (avgPerf === null
          ? 'School performance is not scored — ' + PERFORMANCE_UNAVAILABLE_REASON
          : 'Average performance score: ' + avgPerf + '/100.')
      : 'No schools within ' + SCHOOL_SEARCH_MILES + ' miles of the PMA boundary.';

    return {
      alignedDistricts:     aligned,
      alignmentRationale:   rationale,
      districtCount:        aligned.length,
      schoolCount:          aligned.length,
      averagePerformanceScore: avgPerf,
      performanceUnavailableReason: avgPerf === null ? PERFORMANCE_UNAVAILABLE_REASON : null
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
    // No schools is not an average school environment. Returning 50 here put a
    // fabricated mid-range score into a weighted dimension; null excludes it.
    if (!schools || !schools.length) { lastAccessScore = null; return null; }

    var nearby = schools.filter(function (s) {
      var d = haversine(siteLat, siteLon, toNum(s.lat || s.centroidLat || siteLat), toNum(s.lon || s.centroidLon || siteLon));
      return d <= SCHOOL_SEARCH_MILES;
    });

    if (!nearby.length) { lastAccessScore = null; return null; }

    // Proximity score: 100 for < 0.5 mi, declining to 0 at 10 mi
    var proxSum = 0, perfSum = 0;
    var scored = nearby.filter(hasPerf);
    nearby.forEach(function (s) {
      var dist = haversine(siteLat, siteLon,
        toNum(s.lat || s.centroidLat || siteLat),
        toNum(s.lon || s.centroidLon || siteLon));
      proxSum += Math.max(0, 1 - dist / SCHOOL_SEARCH_MILES);
    });
    scored.forEach(function (s) { perfSum += numOrNull(s.performanceScore) / 100; });

    var proxScore = (proxSum / nearby.length) * 100;
    // Drop the performance term rather than defaulting it, and give proximity
    // the full weight — AGENTS.md: "Prefer excluding the component and
    // disclosing why." The reason rides on getSchoolJustification().
    var combined  = scored.length
      ? Math.round(0.6 * proxScore + 0.4 * ((perfSum / scored.length) * 100))
      : Math.round(proxScore);
    lastAccessWeighting = scored.length ? 'proximity 60% + performance 40%' : 'proximity only (100%)';

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
          performanceScore: numOrNull(s.performanceScore),
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
    var scored = lastAlignedDistricts.filter(hasPerf);
    var avgPerf = scored.length
      ? Math.round(scored.reduce(function (s, d) { return s + numOrNull(d.performanceScore); }, 0) / scored.length)
      : null;

    return {
      // Kept for callers that still read the old key; these are schools, not
      // attendance-boundary districts — the previous source returned points and
      // called them districts.
      schoolDistrictsAligned: lastAlignedDistricts.length,
      schoolsAligned:         lastAlignedDistricts.length,
      averagePerformanceScore: avgPerf,
      performanceUnavailableReason: avgPerf === null ? PERFORMANCE_UNAVAILABLE_REASON : null,
      accessibilityScore:     lastAccessScore,
      accessibilityWeighting: lastAccessWeighting,
      alignmentRationale:     lastAlignedDistricts.length
        ? 'PMA boundary encompasses ' + lastAlignedDistricts.length + ' school(s)' +
          (avgPerf === null ? '; performance is not scored.' : ' with avg performance score ' + avgPerf + '.')
        : 'No school data was available for this analysis.'
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
