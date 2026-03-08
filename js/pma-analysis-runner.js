/**
 * js/pma-analysis-runner.js
 * Multi-step PMA analysis pipeline orchestrator with progress reporting.
 *
 * Runs all eight data-source modules in the optimal order (parallel where safe),
 * emitting progress events after each step so the UI can update a progress bar.
 *
 * Usage:
 *   PMAAnalysisRunner.run(lat, lon, options)
 *     .on('progress', function(step) { ... })  // step: {index, total, label, pct}
 *     .on('complete', function(scoreRun) { ... })
 *     .on('error',    function(err) { ... });
 *
 * Options:
 *   method         "buffer" | "commuting" | "hybrid"  (default: "buffer")
 *   bufferMiles    number                              (default: 5)
 *   proposedUnits  number                             (default: 100)
 *   vintage        string LODES vintage               (default: "2021")
 *
 * Exposed as window.PMAAnalysisRunner.
 */
(function () {
  'use strict';

  /* ── Pipeline step definitions ────────────────────────────────────── */
  var STEPS = [
    { id: 'commuting',    label: 'Fetching commuting flow data…',        weight: 2 },
    { id: 'barriers',     label: 'Loading terrain barriers…',            weight: 1 },
    { id: 'employment',   label: 'Identifying employment centers…',      weight: 1 },
    { id: 'schools',      label: 'Aligning school boundaries…',          weight: 1 },
    { id: 'transit',      label: 'Scoring transit accessibility…',       weight: 1 },
    { id: 'competitive',  label: 'Building competitive set…',            weight: 1 },
    { id: 'opportunities',label: 'Calculating opportunity overlays…',    weight: 1 },
    { id: 'infrastructure',label: 'Assessing infrastructure feasibility…', weight: 1 },
    { id: 'narrative',    label: 'Generating justification narrative…',  weight: 1 }
  ];

  var TOTAL_WEIGHT = STEPS.reduce(function (s, st) { return s + st.weight; }, 0);

  /* ── Module accessors (lazy, graceful if absent) ─────────────────── */
  function _mod(name) {
    return (typeof window !== 'undefined' && window[name]) ? window[name] : null;
  }

  function toNum(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  /* ── Bounding box from lat/lon + radiusMiles ────────────────────── */
  function _bbox(lat, lon, radiusMiles) {
    var dlat = radiusMiles / 69.0;
    var dlon = radiusMiles / (69.0 * Math.cos(lat * Math.PI / 180));
    return {
      minLat: lat - dlat,
      maxLat: lat + dlat,
      minLon: lon - dlon,
      maxLon: lon + dlon
    };
  }

  /* ── Event emitter (minimal) ─────────────────────────────────────── */
  function EventEmitter() {
    this._handlers = {};
  }
  EventEmitter.prototype.on = function (event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
    return this;        // chainable
  };
  EventEmitter.prototype._emit = function (event, data) {
    var handlers = this._handlers[event] || [];
    handlers.forEach(function (fn) {
      try { fn(data); } catch (e) { console.error('[PMAAnalysisRunner] handler error:', e); }
    });
  };

  /* ── Main run function ───────────────────────────────────────────── */

  /**
   * Execute the full PMA analysis pipeline.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {object} [options]
   * @returns {EventEmitter}  — attach .on('progress'|'complete'|'error') handlers
   */
  function run(lat, lon, options) {
    options = options || {};
    var method        = options.method        || 'buffer';
    var bufferMiles   = toNum(options.bufferMiles   || 5);
    var proposedUnits = toNum(options.proposedUnits || 100);
    var vintage       = options.vintage       || '2021';

    var ee      = new EventEmitter();
    var bbox    = _bbox(lat, lon, Math.max(bufferMiles, 10));
    var stepIdx = 0;
    var cumulativeWeight = 0;

    function _progress(stepId, extraLabel) {
      var def = STEPS.find(function (s) { return s.id === stepId; }) || { weight: 1, label: stepId };
      cumulativeWeight += def.weight;
      stepIdx++;
      ee._emit('progress', {
        index:   stepIdx,
        total:   STEPS.length,
        label:   extraLabel || def.label,
        pct:     Math.round((cumulativeWeight / TOTAL_WEIGHT) * 100),
        stepId:  stepId
      });
    }

    // Run async pipeline
    _pipeline(lat, lon, bbox, method, bufferMiles, vintage, proposedUnits, _progress)
      .then(function (scoreRun) {
        ee._emit('complete', scoreRun);
      })
      .catch(function (err) {
        ee._emit('error', err);
      });

    return ee;
  }

  /* ── Pipeline implementation ─────────────────────────────────────── */
  function _pipeline(lat, lon, bbox, method, bufferMiles, vintage, proposedUnits, progress) {

    var results = {};

    /* STEP 1 — Commuting (or buffer geometry) */
    var commutingPromise;
    var pmaComm = _mod('PMACommuting');

    if (method !== 'buffer' && pmaComm) {
      commutingPromise = pmaComm
        .fetchLODESWorkplaces(lat, lon, 30, vintage)
        .then(function (lodesData) {
          var flowResult  = pmaComm.analyzeCommutingFlows(lodesData.workplaces || []);
          var boundResult = pmaComm.generateCommutingBoundary(lat, lon, flowResult);
          results.commuting = pmaComm.getJustificationData();
          results.boundary  = boundResult.boundary;
          progress('commuting');
          return results;
        });
    } else {
      // Buffer: quick synthetic commuting justification
      if (pmaComm) {
        var syntheticWp = pmaComm._buildCirclePolygon
          ? null   // don't generate synthetic workplaces for buffer mode
          : null;
        results.boundary = pmaComm._buildCirclePolygon
          ? pmaComm._buildCirclePolygon(lat, lon, bufferMiles, 32)
          : null;
      }
      results.commuting = { lodesWorkplaces: 0, captureRate: 0, residentOriginZones: [] };
      progress('commuting', 'Using buffer geometry (legacy mode)…');
      commutingPromise = Promise.resolve(results);
    }

    return commutingPromise.then(function () {

      /* STEPS 2-5 — run in parallel (barriers, employment, schools, transit) */
      var pmaBarriers    = _mod('PMABarriers');
      var pmaEmployment  = _mod('PMAEmploymentCenters');
      var pmaSchools     = _mod('PMASchools');
      var pmaTransit     = _mod('PMATransit');
      var ds             = _mod('DataService');

      var barriersP = (pmaBarriers && ds)
        ? Promise.all([
            pmaBarriers.fetchUSGSHydrology(bbox),
            pmaBarriers.fetchNLCDLandCover(bbox),
            pmaBarriers.fetchStateHighways(bbox)
          ]).then(function (res) {
            results.barrierResult = pmaBarriers.subtractBarriers(results.boundary || {}, {
              waterBodies: res[0].waterBodies || [],
              highways:    res[2].highways    || [],
              landCover:   res[1].landCover   || []
            });
            results.barriers = pmaBarriers.getBarrierSummary();
            progress('barriers', 'Loading terrain barriers…');
          }).catch(function () {
            results.barriers = {};
            progress('barriers', 'Barriers skipped (data unavailable)');
          })
        : Promise.resolve().then(function () {
            results.barriers = {};
            progress('barriers', 'Barriers module unavailable');
          });

      var employmentP = (pmaEmployment && results.commuting && results.commuting.residentOriginZones)
        ? Promise.resolve().then(function () {
            var workplaces = (results.commuting.residentOriginZones || []).map(function (z) {
              return { lat: z.lat, lon: z.lon, jobCount: z.estimatedWorkers || 100 };
            });
            var clusters  = pmaEmployment.clusterByJobDensity(workplaces);
            var corridors = pmaEmployment.identifyMajorCorridors(clusters);
            results.employmentCenters = clusters;
            results.employmentCorridors = corridors;
            results.employmentScore = pmaEmployment.scoreEmploymentAccessibility(lat, lon, clusters);
            progress('employment', 'Identifying employment centers…');
          })
        : Promise.resolve().then(function () {
            results.employmentCenters = [];
            progress('employment', 'Employment centers module unavailable');
          });

      var schoolsP = (pmaSchools && ds)
        ? ds.fetchSchoolBoundaries(bbox)
            .then(function (schoolData) {
              var alignment = pmaSchools.alignPMAWithSchools(results.boundary || null, schoolData.schoolDistricts || []);
              results.schools = pmaSchools.getSchoolJustification();
              progress('schools', 'Aligning school boundaries…');
              return alignment;
            })
            .catch(function () {
              results.schools = {};
              progress('schools', 'Schools skipped');
            })
        : Promise.resolve().then(function () {
            results.schools = {};
            progress('schools', 'Schools module unavailable');
          });

      var transitP = (pmaTransit && ds)
        ? Promise.all([
            ds.fetchNTDData(bbox),
            ds.fetchEPASmartLocation(bbox)
          ]).then(function (res) {
            var transitScore = pmaTransit.calculateTransitScore(lat, lon, res[0].transitRoutes || [], res[1]);
            results.transit = pmaTransit.getTransitJustification();
            progress('transit', 'Scoring transit accessibility…');
            return transitScore;
          })
          .catch(function () {
            results.transit = {};
            progress('transit', 'Transit data unavailable');
          })
        : Promise.resolve().then(function () {
            results.transit = {};
            progress('transit', 'Transit module unavailable');
          });

      return Promise.all([barriersP, employmentP, schoolsP, transitP]);

    }).then(function () {

      /* STEPS 6-8 — competitive set, opportunities, infrastructure (parallel) */
      var pmaCompetitive = _mod('PMACompetitiveSet');
      var pmaOpps        = _mod('PMAOpportunities');
      var pmaInfra       = _mod('PMAInfrastructure');
      var ds             = _mod('DataService');
      var nhpd           = _mod('Nhpd');

      var competitiveP = (pmaCompetitive)
        ? Promise.resolve().then(function () {
            var nhpdFeatures = (nhpd && typeof nhpd.getPropertiesNear === 'function')
              ? nhpd.getPropertiesNear(lat, lon, bufferMiles).map(function (p) { return { properties: p }; })
              : [];
            var lihtcFeatures = (window.PMAEngine && window.PMAEngine._lihtcFeatures) || [];
            var set = pmaCompetitive.buildCompetitiveSet(lihtcFeatures, nhpdFeatures, lat, lon, bufferMiles);
            var expiry = pmaCompetitive.flagSubsidyExpiryRisk(nhpdFeatures);
            var absorption = pmaCompetitive.calculateAbsorptionRisk(set, proposedUnits);
            results.competitiveSet = pmaCompetitive.getCompetitiveJustification();
            results.absorptionRisk = absorption;
            progress('competitive', 'Building competitive set…');
          })
        : Promise.resolve().then(function () {
            results.competitiveSet = {};
            progress('competitive', 'Competitive set module unavailable');
          });

      var opportunitiesP = (pmaOpps && ds)
        ? Promise.all([
            ds.fetchOpportunityZones(bbox),
            ds.fetchHudAFFH(bbox),
            ds.fetchHudOpportunityAtlas(bbox)
          ]).then(function (res) {
            var ozShare = pmaOpps.calculateOpportunityShare(results.boundary || null, res[0].zones || []);
            var oppScore = pmaOpps.scoreOpportunityIndex(lat, lon, res[1], res[2]);
            pmaOpps.determineIncentiveEligibility(ozShare, res[1].opportunityIndex, res[2].mobilityIndex);
            results.opportunities = pmaOpps.getOpportunityJustification();
            progress('opportunities', 'Calculating opportunity overlays…');
          })
          .catch(function () {
            results.opportunities = {};
            progress('opportunities', 'Opportunity data unavailable');
          })
        : Promise.resolve().then(function () {
            results.opportunities = {};
            progress('opportunities', 'Opportunities module unavailable');
          });

      var infraP = (pmaInfra && ds)
        ? Promise.all([
            ds.fetchFEMAFloodData(bbox),
            ds.fetchNOAAClimateData({ lat: lat, lon: lon }, 'all'),
            ds.fetchUtilityCapacity(bbox, ''),
            ds.fetchFoodAccessAtlas(bbox)
          ]).then(function (res) {
            pmaInfra.buildInfrastructureScorecard(res[0], res[1], res[2], res[3]);
            results.infrastructure = pmaInfra.getInfrastructureJustification();
            progress('infrastructure', 'Assessing infrastructure feasibility…');
          })
          .catch(function () {
            results.infrastructure = {};
            progress('infrastructure', 'Infrastructure data unavailable');
          })
        : Promise.resolve().then(function () {
            results.infrastructure = {};
            progress('infrastructure', 'Infrastructure module unavailable');
          });

      return Promise.all([competitiveP, opportunitiesP, infraP]);

    }).then(function () {

      /* STEP 9 — Narrative synthesis */
      var pmaJust = _mod('PMAJustification');
      var scoreRun = pmaJust
        ? pmaJust.synthesizePMA({
            commuting:       results.commuting,
            barriers:        results.barriers,
            employmentCenters: results.employmentCenters || [],
            schools:         results.schools,
            transit:         results.transit,
            competitiveSet:  results.competitiveSet,
            opportunities:   results.opportunities,
            infrastructure:  results.infrastructure
          })
        : {
            run_id:     'no-justification-module',
            created_at: new Date().toISOString(),
            components: results
          };

      if (pmaJust) {
        scoreRun.justification = {
          narrative: pmaJust.generateNarrative(scoreRun),
          layers:    pmaJust.getLayerOrder(),
          dataQuality: scoreRun.dataQuality || 'STANDARD'
        };
      }

      scoreRun._analysisResults = results;
      progress('narrative', 'Generating justification narrative…');

      return scoreRun;
    });
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  if (typeof window !== 'undefined') {
    window.PMAAnalysisRunner = {
      run:   run,
      STEPS: STEPS
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { run: run, STEPS: STEPS };
  }

}());
