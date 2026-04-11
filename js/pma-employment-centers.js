/**
 * js/pma-employment-centers.js
 * Employment cluster identification from LODES workplace data.
 *
 * Responsibilities:
 *  - clusterByJobDensity(workplaces, minClusterJobs) — spatial clustering
 *  - identifyMajorCorridors(clusters) — linear employment corridors
 *  - mapCommutingFlowsToCenters(centers, flows) — match flows to employers
 *  - scoreEmploymentAccessibility(siteLat, siteLon, centers) — weighted score
 *  - getEmploymentLayer() — GeoJSON layer for map display
 *
 * Exposed as window.PMAEmploymentCenters.
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────── */
  var MIN_CLUSTER_JOBS_URBAN = 500;  // urban/suburban threshold
  var MIN_CLUSTER_JOBS_RURAL = 75;   // rural threshold (towns <5,000 total jobs)
  var RURAL_TOTAL_JOBS_THRESHOLD = 5000; // if total jobs in buffer < this, use rural threshold
  var CLUSTER_RADIUS_MILES = 2;    // merge workplaces within this radius
  var MAX_CENTERS         = 10;    // top N centers to retain
  var EARTH_RADIUS_MI     = 3958.8;
  var ACCESS_WEIGHTS      = {
    lessThan5:  1.0,
    fiveTo10:   0.75,
    tenTo20:    0.5,
    moreThan20: 0.2
  };

  /* ── Internal state ───────────────────────────────────────────────── */
  var lastClusters    = [];
  var lastCorridors   = [];
  var lastAccessScore = 0;
  var lastContext     = { isRural: false, totalJobs: 0, minJobsUsed: MIN_CLUSTER_JOBS_URBAN };

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
   * Cluster workplace features by spatial proximity and job density.
   * Uses a greedy single-linkage approach appropriate for browser execution.
   *
   * @param {Array}  workplaces      - Array of {lat, lon, jobCount, industry}
   * @param {number} [minJobs]       - Minimum jobs to form a cluster center
   * @returns {Array} clusters sorted by job count descending
   */
  function clusterByJobDensity(workplaces, minJobs) {
    if (!workplaces || !workplaces.length) { return []; }

    // Auto-detect rural context: if total jobs in the dataset are below
    // the rural threshold, lower the minimum cluster size so small-town
    // employment centers are not silently dropped.
    var totalJobs = workplaces.reduce(function (s, w) { return s + toNum(w.jobCount); }, 0);
    var isRuralContext = totalJobs < RURAL_TOTAL_JOBS_THRESHOLD;
    var effectiveMin = minJobs || (isRuralContext ? MIN_CLUSTER_JOBS_RURAL : MIN_CLUSTER_JOBS_URBAN);
    minJobs = effectiveMin;

    var assigned = new Array(workplaces.length).fill(false);
    var clusters = [];

    // Sort descending by job count — seed clusters from highest-density points
    var sorted = workplaces.slice().sort(function (a, b) {
      return toNum(b.jobCount) - toNum(a.jobCount);
    });

    sorted.forEach(function (seed, si) {
      if (assigned[si]) return;
      var cluster = {
        id:          'ec-' + (clusters.length + 1),
        lat:         toNum(seed.lat),
        lon:         toNum(seed.lon),
        jobCount:    0,
        industries:  {},
        memberCount: 0
      };

      sorted.forEach(function (wp, wi) {
        if (assigned[wi]) return;
        var dist = haversine(cluster.lat, cluster.lon, toNum(wp.lat), toNum(wp.lon));
        if (dist <= CLUSTER_RADIUS_MILES) {
          assigned[wi] = true;
          var jobs = toNum(wp.jobCount);
          cluster.jobCount    += jobs;
          cluster.memberCount += 1;
          if (wp.industry) {
            cluster.industries[wp.industry] =
              (cluster.industries[wp.industry] || 0) + jobs;
          }
        }
      });

      if (cluster.jobCount >= minJobs) {
        // Dominant industry
        var dom = Object.keys(cluster.industries).sort(function (a, b) {
          return cluster.industries[b] - cluster.industries[a];
        })[0] || 'Mixed';
        cluster.dominantIndustry = dom;
        cluster.isAttractor = cluster.jobCount >= minJobs * 3;
        clusters.push(cluster);
      }
    });

    lastClusters = clusters.sort(function (a, b) { return b.jobCount - a.jobCount; })
                           .slice(0, MAX_CENTERS);
    lastContext = { isRural: isRuralContext, totalJobs: totalJobs, minJobsUsed: minJobs };
    if (isRuralContext) {
      console.info('[PMAEmploymentCenters] Rural context detected (' + totalJobs +
        ' total jobs < ' + RURAL_TOTAL_JOBS_THRESHOLD + '). Using ' + minJobs +
        '-job minimum threshold instead of ' + MIN_CLUSTER_JOBS_URBAN + '.');
    }
    return lastClusters;
  }

  /**
   * Identify linear employment corridors from cluster locations.
   * Corridors are pairs of high-density clusters within 5 miles of each other.
   *
   * @param {Array} clusters - Output of clusterByJobDensity
   * @returns {Array} corridors with start/end center and combined job count
   */
  function identifyMajorCorridors(clusters) {
    clusters = clusters || lastClusters;
    if (!clusters || clusters.length < 2) { return []; }

    var corridors = [];
    for (var i = 0; i < clusters.length; i++) {
      for (var j = i + 1; j < clusters.length; j++) {
        var dist = haversine(clusters[i].lat, clusters[i].lon,
                             clusters[j].lat, clusters[j].lon);
        if (dist <= 5) {
          corridors.push({
            from:      clusters[i].id,
            to:        clusters[j].id,
            fromName:  clusters[i].dominantIndustry + ' Cluster',
            toName:    clusters[j].dominantIndustry + ' Cluster',
            distMiles: Math.round(dist * 10) / 10,
            totalJobs: clusters[i].jobCount + clusters[j].jobCount
          });
        }
      }
    }

    lastCorridors = corridors.sort(function (a, b) { return b.totalJobs - a.totalJobs; });
    return lastCorridors;
  }

  /**
   * Match commuting flows (origin zones) to nearest employment centers.
   * @param {Array} centers - Employment cluster array
   * @param {Array} flows   - Origin zone array from PMACommuting
   * @returns {Array} flows with added nearestCenter field
   */
  function mapCommutingFlowsToCenters(centers, flows) {
    centers = centers || lastClusters;
    if (!centers || !centers.length || !flows || !flows.length) { return flows || []; }

    return flows.map(function (zone) {
      var best = null, bestDist = Infinity;
      centers.forEach(function (c) {
        var d = haversine(zone.lat, zone.lon, c.lat, c.lon);
        if (d < bestDist) { bestDist = d; best = c; }
      });
      return Object.assign({}, zone, {
        nearestCenter:     best ? best.id : null,
        distToCenter:      best ? Math.round(bestDist * 10) / 10 : null
      });
    });
  }

  /**
   * Calculate a 0–100 employment accessibility score for a proposed site.
   * Weights nearby employment centers by job count and distance.
   *
   * @param {number} siteLat
   * @param {number} siteLon
   * @param {Array}  centers
   * @returns {number} 0–100 score
   */
  function scoreEmploymentAccessibility(siteLat, siteLon, centers) {
    centers = centers || lastClusters;
    if (!centers || !centers.length) { return 50; } // neutral fallback

    var totalJobs = centers.reduce(function (s, c) { return s + c.jobCount; }, 0);
    if (totalJobs === 0) { return 50; }

    var weightedSum = 0;
    centers.forEach(function (c) {
      var dist = haversine(siteLat, siteLon, c.lat, c.lon);
      var weight;
      if (dist < 5)       weight = ACCESS_WEIGHTS.lessThan5;
      else if (dist < 10) weight = ACCESS_WEIGHTS.fiveTo10;
      else if (dist < 20) weight = ACCESS_WEIGHTS.tenTo20;
      else                weight = ACCESS_WEIGHTS.moreThan20;
      weightedSum += (c.jobCount / totalJobs) * weight;
    });

    lastAccessScore = Math.round(Math.min(1, weightedSum) * 100);
    return lastAccessScore;
  }

  /**
   * Build a GeoJSON FeatureCollection for the employment center map layer.
   * @param {Array} [centers]
   * @returns {object} GeoJSON FeatureCollection
   */
  function getEmploymentLayer(centers) {
    centers = centers || lastClusters;
    var features = (centers || []).map(function (c) {
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: {
          id:               c.id,
          jobCount:         c.jobCount,
          dominantIndustry: c.dominantIndustry || 'Mixed',
          isAttractor:      !!c.isAttractor,
          memberCount:      c.memberCount || 0
        }
      };
    });
    return { type: 'FeatureCollection', features: features };
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  if (typeof window !== 'undefined') {
    window.PMAEmploymentCenters = {
      clusterByJobDensity:          clusterByJobDensity,
      identifyMajorCorridors:       identifyMajorCorridors,
      mapCommutingFlowsToCenters:   mapCommutingFlowsToCenters,
      scoreEmploymentAccessibility: scoreEmploymentAccessibility,
      getEmploymentLayer:           getEmploymentLayer,
      getContext:                   function () { return lastContext; }
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      clusterByJobDensity:          clusterByJobDensity,
      identifyMajorCorridors:       identifyMajorCorridors,
      mapCommutingFlowsToCenters:   mapCommutingFlowsToCenters,
      scoreEmploymentAccessibility: scoreEmploymentAccessibility,
      getEmploymentLayer:           getEmploymentLayer
    };
  }

}());
