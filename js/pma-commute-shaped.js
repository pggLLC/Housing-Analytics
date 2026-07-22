/**
 * Commute-shaped PMA beta mode.
 *
 * Default PMA behavior remains the circular buffer. This module is lazy-loaded
 * only after the user opts into the beta mode, and the mode is blocked rather
 * than silently degraded when its committed LODES inputs are unavailable.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PMACommuteShaped = factory();
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var MODE_LABEL = 'Commute-shaped PMA (beta)';
  var BUFFER_LABEL = 'Circular buffer PMA';
  var DISCLOSURE = 'Commute-shaped PMA (beta) uses LODES 2023 OD flows and a one-site Fruita calibration; it changes the PMA tract set only when explicitly enabled.';
  var CALIBRATION_SOURCE = 'Fruita Mews II (KVG 2026 / Prior 2022)';
  var DEFAULT_PARAMS = {
    minimum_jobs_to_seed_work_tracts: 50,
    minimum_orientation_share: 0.028
  };
  var DATA_URLS = {
    od: 'data/market/lodes_tract_od_co.json',
    travel: 'data/market/travel_time_matrix_co.json'
  };
  var _inputs = null;
  var _loadPromise = null;
  var _state = {
    enabled: false,
    available: false,
    blocked: false,
    mode_label: BUFFER_LABEL,
    scoring_effect: 'off'
  };

  function todayIso() {
    try { return new Date().toISOString().slice(0, 10); } catch (_) { return ''; }
  }

  function isExpired(iso) {
    return !!(iso && /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) && String(iso) < todayIso());
  }

  function fetchJson(url) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res || !res.ok) throw new Error(url + ' unavailable');
      return res.json();
    });
  }

  function validateInputs(odDoc, travelDoc) {
    if (!odDoc || !Array.isArray(odDoc.pairs) || !odDoc.pairs.length) {
      return 'LODES tract OD matrix unavailable — circular-buffer PMA in use';
    }
    if (!travelDoc || !travelDoc.tracts || !Object.keys(travelDoc.tracts).length) {
      return 'Travel-time matrix unavailable — circular-buffer PMA in use';
    }
    if (isExpired(odDoc.meta && odDoc.meta.review_by)) {
      return 'LODES tract OD matrix review date has passed — circular-buffer PMA in use';
    }
    if (isExpired(travelDoc.meta && travelDoc.meta.review_by)) {
      return 'Travel-time matrix review date has passed — circular-buffer PMA in use';
    }
    return null;
  }

  function loadInputs() {
    if (_inputs) return Promise.resolve(_inputs);
    if (_loadPromise) return _loadPromise;
    _loadPromise = Promise.all([fetchJson(DATA_URLS.od), fetchJson(DATA_URLS.travel)])
      .then(function (docs) {
        var warning = validateInputs(docs[0], docs[1]);
        if (warning) {
          _state = blockedState(warning);
          return _state;
        }
        _inputs = { od: docs[0], travel: docs[1] };
        _state = {
          enabled: false,
          available: true,
          blocked: false,
          mode_label: BUFFER_LABEL,
          scoring_effect: 'off',
          inventory_vintage: docs[0].meta && docs[0].meta.vintage,
          travel_matrix_vintage: docs[1].meta && docs[1].meta.as_of
        };
        return _inputs;
      })
      .catch(function (err) {
        _state = blockedState((err && err.message) || 'Commute-shaped PMA data unavailable');
        return _state;
      });
    return _loadPromise;
  }

  function blockedState(message) {
    return {
      enabled: false,
      available: false,
      blocked: true,
      warning: message || 'Commute-shaped PMA data unavailable — circular-buffer PMA in use',
      mode_label: BUFFER_LABEL,
      requested_mode_label: MODE_LABEL,
      scoring_effect: 'none'
    };
  }

  function normalizeGeoid(value) {
    var s = String(value || '');
    return /^08\d{9}$/.test(s) ? s : null;
  }

  function tractId(t) {
    return normalizeGeoid(t && (t.geoid || t.GEOID || t.id));
  }

  function cloneTract(t) {
    var out = {};
    Object.keys(t || {}).forEach(function (k) { out[k] = t[k]; });
    return out;
  }

  function haversineMiles(lat1, lon1, lat2, lon2) {
    var R = 3958.8;
    var toRad = function (d) { return d * Math.PI / 180; };
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function chooseSiteTract(seedTracts, site) {
    var best = null;
    (seedTracts || []).forEach(function (t) {
      var gid = tractId(t);
      if (!gid) return;
      var share = typeof t._bufferShare === 'number' ? t._bufferShare : 1;
      var distance = (site && Number.isFinite(+site.lat) && Number.isFinite(+site.lon) &&
        Number.isFinite(+t.lat) && Number.isFinite(+t.lon))
        ? haversineMiles(+site.lat, +site.lon, +t.lat, +t.lon)
        : null;
      var rank = {
        geoid: gid,
        share: share,
        distance: distance == null ? Infinity : distance
      };
      if (!best || rank.distance < best.distance || (rank.distance === best.distance && rank.share > best.share)) {
        best = rank;
      }
    });
    return best && best.geoid;
  }

  function nearestHub(travelDoc, geoid) {
    var row = travelDoc && travelDoc.tracts && travelDoc.tracts[geoid];
    return row && row.nearest_hub && row.nearest_hub.hub_id;
  }

  function nearestHubMinutes(travelDoc, geoid) {
    var row = travelDoc && travelDoc.tracts && travelDoc.tracts[geoid];
    return row && row.nearest_hub && Number.isFinite(+row.nearest_hub.drive_minutes)
      ? +row.nearest_hub.drive_minutes
      : null;
  }

  function buildFlowIndexes(odDoc, workSet) {
    var outflow = {};
    var flowToSeedWork = {};
    (odDoc && odDoc.pairs || []).forEach(function (row) {
      if (!Array.isArray(row) || row.length < 3) return;
      var home = normalizeGeoid(row[0]);
      var work = normalizeGeoid(row[1]);
      var jobs = Math.round(+row[2] || 0);
      if (!home || !work || jobs <= 0) return;
      outflow[home] = (outflow[home] || 0) + jobs;
      if (workSet[work]) flowToSeedWork[home] = (flowToSeedWork[home] || 0) + jobs;
    });
    return { outflow: outflow, flowToSeedWork: flowToSeedWork };
  }

  function buildModeData(seedTracts, odDoc, travelDoc, params, options) {
    params = params || DEFAULT_PARAMS;
    options = options || {};
    var warning = validateInputs(odDoc, travelDoc);
    if (warning) {
      return { tracts: (seedTracts || []).slice(), state: blockedState(warning) };
    }
    var seedIds = {};
    var seed = [];
    (seedTracts || []).forEach(function (t) {
      var gid = tractId(t);
      if (!gid || seedIds[gid]) return;
      seedIds[gid] = true;
      seed.push(cloneTract(t));
    });
    if (!seed.length) {
      return { tracts: [], state: blockedState('No seed PMA tracts available — circular-buffer PMA in use') };
    }
    var siteTract = normalizeGeoid(options.siteTract) || chooseSiteTract(seed, options.site);
    var siteHub = nearestHub(travelDoc, siteTract);
    if (!siteHub) {
      return { tracts: seed, state: blockedState('Travel-time hub unavailable for the site tract — circular-buffer PMA in use') };
    }

    var flowIdx = buildFlowIndexes(odDoc, seedIds);
    var minJobs = +params.minimum_jobs_to_seed_work_tracts;
    var minShare = +params.minimum_orientation_share;
    var extensions = [];
    Object.keys(flowIdx.flowToSeedWork).forEach(function (home) {
      if (seedIds[home]) return;
      var jobs = flowIdx.flowToSeedWork[home] || 0;
      var out = flowIdx.outflow[home] || 0;
      var share = out > 0 ? jobs / out : 0;
      var homeHub = nearestHub(travelDoc, home);
      if (jobs < minJobs) return;
      if (share < minShare) return;
      if (homeHub !== siteHub) return;
      var travelRow = travelDoc.tracts[home] || {};
      var ext = {
        geoid: home,
        _bufferShare: share,
        _commuteShapedExtension: true,
        _commuteFlowJobs: jobs,
        _commuteOrientationShare: share,
        _commuteOutflowJobs: out,
        _commuteHubId: homeHub,
        _commuteDriveMinutes: nearestHubMinutes(travelDoc, home),
        _commuteShapeBadge: 'Commute-shaped PMA beta · ' + jobs.toLocaleString('en-US') + ' jobs to seed PMA · ' + (share * 100).toFixed(1) + '% orientation'
      };
      if (travelRow.county_name) ext.county_name = travelRow.county_name;
      extensions.push(ext);
    });
    extensions.sort(function (a, b) {
      return (b._commuteFlowJobs - a._commuteFlowJobs) || (b._commuteOrientationShare - a._commuteOrientationShare);
    });

    var tracts = seed.concat(extensions);
    var extensionIds = extensions.map(function (t) { return t.geoid; });
    var calibration = options.calibration || null;
    var validation = null;
    if (calibration && Array.isArray(calibration.professional_tracts)) {
      validation = validateCalibration(seed.map(tractId), tracts.map(tractId), calibration, odDoc);
    }

    return {
      tracts: tracts,
      state: {
        enabled: true,
        available: true,
        blocked: false,
        mode_label: MODE_LABEL,
        buffer_mode_label: BUFFER_LABEL,
        disclosure: DISCLOSURE,
        scoring_effect: 'changes PMA tract set when explicitly enabled',
        seed_tract_count: seed.length,
        extension_tract_count: extensions.length,
        tract_count: tracts.length,
        seed_tracts: seed.map(tractId),
        extension_tracts: extensionIds,
        params: {
          minimum_jobs_to_seed_work_tracts: minJobs,
          minimum_orientation_share: minShare
        },
        calibration_source: CALIBRATION_SOURCE,
        calibration_status: 'one-site beta',
        outside_pma_demand_range: calibration && calibration.outside_pma_demand_range || {
          min: 0.4,
          max: 0.56,
          source: 'Fruita calibration benchmark'
        },
        inventory_vintage: odDoc.meta && odDoc.meta.vintage,
        od_review_by: odDoc.meta && odDoc.meta.review_by,
        travel_matrix_vintage: travelDoc.meta && travelDoc.meta.as_of,
        travel_review_by: travelDoc.meta && travelDoc.meta.review_by,
        validation: validation
      }
    };
  }

  function computeImpliedOutsidePmaShare(odDoc, modeIds) {
    var mode = {};
    (modeIds || []).forEach(function (g) {
      var geoid = normalizeGeoid(g);
      if (geoid) mode[geoid] = true;
    });
    var totalInflow = 0;
    var outsideInflow = 0;
    (odDoc && odDoc.pairs || []).forEach(function (row) {
      if (!Array.isArray(row) || row.length < 3) return;
      var home = normalizeGeoid(row[0]);
      var work = normalizeGeoid(row[1]);
      var jobs = Math.round(+row[2] || 0);
      if (!home || !work || jobs <= 0 || !mode[work]) return;
      totalInflow += jobs;
      if (!mode[home]) outsideInflow += jobs;
    });
    return {
      implied_outside_pma_share: totalInflow > 0 ? outsideInflow / totalInflow : null,
      implied_outside_pma_numerator_jobs: outsideInflow,
      implied_outside_pma_denominator_jobs: totalInflow,
      implied_outside_pma_definition: 'OD worker-flow into final commute-shaped PMA work tracts from home tracts outside the final PMA divided by total OD inflow into those work tracts'
    };
  }

  function validateCalibration(seedIds, modeIds, calibration, odDoc) {
    var pro = {};
    (calibration.professional_tracts || []).forEach(function (g) { pro[g] = true; });
    var mode = {};
    (modeIds || []).forEach(function (g) { mode[g] = true; });
    var captures = Object.keys(pro).filter(function (g) { return mode[g]; });
    var union = {};
    Object.keys(pro).forEach(function (g) { union[g] = true; });
    Object.keys(mode).forEach(function (g) { union[g] = true; });
    var mustNot = (calibration.must_not_include_east_grand_junction_tracts || []).filter(function (g) { return mode[g]; });
    var outside = computeImpliedOutsidePmaShare(odDoc, modeIds);
    return {
      professional_capture_count: captures.length,
      professional_total: Object.keys(pro).length,
      jaccard: Object.keys(union).length ? captures.length / Object.keys(union).length : 0,
      must_not_include_hits: mustNot,
      benchmark_outside_pma_demand_range: calibration.outside_pma_demand_range || null,
      implied_outside_pma_share: outside.implied_outside_pma_share,
      implied_outside_pma_numerator_jobs: outside.implied_outside_pma_numerator_jobs,
      implied_outside_pma_denominator_jobs: outside.implied_outside_pma_denominator_jobs,
      implied_outside_pma_definition: outside.implied_outside_pma_definition,
      seed_overlap_count: (seedIds || []).filter(function (g) { return pro[g]; }).length
    };
  }

  function applyToTracts(seedTracts, options) {
    options = options || {};
    if (!_inputs) {
      return { tracts: (seedTracts || []).slice(), state: blockedState('Commute-shaped PMA data not loaded — circular-buffer PMA in use') };
    }
    var result = buildModeData(seedTracts, _inputs.od, _inputs.travel, options.params || DEFAULT_PARAMS, options);
    _state = result.state;
    return result;
  }

  function getState() {
    return _state || {
      enabled: false,
      available: false,
      blocked: false,
      mode_label: BUFFER_LABEL,
      scoring_effect: 'off'
    };
  }

  function setToggleWarning(message) {
    if (typeof document === 'undefined') return;
    var warn = document.getElementById('pmaCommuteShapedWarning');
    if (warn) {
      warn.hidden = !message;
      warn.textContent = message || '';
    }
  }

  return {
    MODE_LABEL: MODE_LABEL,
    BUFFER_LABEL: BUFFER_LABEL,
    DISCLOSURE: DISCLOSURE,
    DATA_URLS: DATA_URLS,
    DEFAULT_PARAMS: DEFAULT_PARAMS,
    loadInputs: loadInputs,
    buildModeData: buildModeData,
    applyToTracts: applyToTracts,
    getState: getState,
    setToggleWarning: setToggleWarning,
    _validateInputs: validateInputs
  };
}));
