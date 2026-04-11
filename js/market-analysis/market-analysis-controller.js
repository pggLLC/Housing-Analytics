/**
 * js/market-analysis/market-analysis-controller.js
 * Orchestration layer for the market analysis report page.
 * Exposes window.MAController.
 *
 * Dependencies (all resolved lazily at call-time; absent deps degrade gracefully):
 *   window.MAState          — global state manager
 *   window.MAUtils          — shared utility functions
 *   window.SiteSelectionScore — scoring model
 *   window.MARenderers      — section renderers
 *   window.PMAEngine        — underlying PMA engine / state
 *   window.DataService      — JSON data loader
 */
(function () {
  'use strict';

  /* ── Internal helpers ───────────────────────────────────────────── */

  /** @returns {object|null} */
  function _state()   { return window.MAState || null; }
  /** @returns {object|null} */
  function _utils()   { return window.MAUtils || null; }
  /** @returns {object|null} */
  function _scorer()  { return window.SiteSelectionScore || null; }
  /** @returns {object|null} */
  function _rend()    { return window.MARenderers || null; }
  /** @returns {object|null} */
  function _pma()     { return window.PMAEngine || null; }
  /** @returns {object|null} */
  function _ds()      { return window.DataService || null; }

  /**
   * Log a warning without throwing.
   * @param {string} msg
   */
  function _warn(msg) {
    if (typeof console !== 'undefined') {
      console.warn('[MAController] ' + msg);
    }
  }

  /**
   * Log an informational message.
   * @param {string} msg
   */
  function _log(msg) {
    if (typeof console !== 'undefined') {
      console.log('[MAController] ' + msg);
    }
  }

  /**
   * Log an error without throwing.
   * @param {string} msg
   * @param {*}      [err]
   */
  function _err(msg, err) {
    if (typeof console !== 'undefined') {
      console.error('[MAController] ' + msg, err || '');
    }
  }

  /**
   * Wrap a function call in a try-catch; return defaultVal on failure.
   * @param {function} fn
   * @param {*} defaultVal
   * @returns {*}
   */
  function _safe(fn, defaultVal) {
    try { return fn(); } catch (e) { _err('safe call failed', e); return defaultVal; }
  }

  /* ── Section id map ─────────────────────────────────────────────── */
  // These IDs target the inner content <div> elements, not the <section>
  // wrappers, so that loading/error states replace only the content area
  // and leave the <h2> section headings intact.
  var SECTION_IDS = [
    'maExecSummaryContent',
    'maMarketDemandContent',
    'maAffordableSupplyContent',
    'maSubsidyOppContent',
    'maSiteFeasibilityContent',
    'maNeighborhoodAccessContent',
    'maPolicyOverlaysContent',
    'maOpportunitiesContent'
  ];

  /* ── Data retrieval helpers ─────────────────────────────────────── */

  /**
   * Pull ACS aggregated metrics from PMAEngine's internal state, or from
   * DataService as a fallback.  Returns null if unavailable.
   * @returns {object|null}
   */
  function _getAcs() {
    // Prefer the live PMAEngine state (already aggregated for the buffer).
    var pma = _pma();
    if (pma && pma._state) {
      var q = _safe(function () { return pma._state.getLastQuality && pma._state.getLastQuality(); }, null);
      if (q && q.acs) return q.acs;
    }

    // Secondary: read from MAState if a prior run populated it.
    var st = _state();
    if (st) {
      var s = _safe(function () { return st.getState(); }, null);
      if (s && s.acs) return s.acs;
    }

    // Tertiary: read from PMADataCache (populated by market-analysis.js loadData)
    if (window.PMADataCache && window.PMADataCache.acs) {
      _log('_getAcs(): using PMADataCache fallback');
      return window.PMADataCache.acs;
    }

    // Quaternary: aggregate nearest tracts from cached ACS metrics
    // Apply barrier exclusion if PMABarriers has identified excluded tracts
    if (_acsMetricsCache && _acsMetricsCache.length > 0 && _currentSite) {
      var excludedByBarriers = _barrierExcludedGeoids || [];
      return _aggregateNearestAcs(_currentSite.lat, _currentSite.lon, _currentSite.bufferMiles || 5, excludedByBarriers);
    }

    return null;
  }

  /** @type {Array|null} Cached ACS tract metrics for direct aggregation */
  var _acsMetricsCache = null;
  /** @type {{lat:number,lon:number,bufferMiles:number}|null} Current site for ACS lookup */
  var _currentSite = null;
  /** @type {Array} Tract GEOIDs excluded by barrier analysis (populated by runAnalysis) */
  var _barrierExcludedGeoids = [];

  /**
   * Aggregate ACS metrics for tracts within buffer distance of a site.
   * Used as last-resort fallback when PMAEngine hasn't run.
   */
  /**
   * @param {number} lat
   * @param {number} lon
   * @param {number} bufferMiles
   * @param {Array}  [excludedGeoids] - GEOIDs excluded by barrier analysis
   */
  function _aggregateNearestAcs(lat, lon, bufferMiles, excludedGeoids) {
    if (!_acsMetricsCache || !_tractCentroidCache) return null;

    // Build exclusion lookup for O(1) checks
    var _excluded = {};
    if (excludedGeoids && excludedGeoids.length) {
      excludedGeoids.forEach(function (g) { _excluded[g] = true; });
    }

    // Find tracts within buffer (excluding barrier-blocked tracts)
    var tractGeoids = {};
    for (var i = 0; i < _tractCentroidCache.length; i++) {
      var tc = _tractCentroidCache[i];
      if (_excluded[tc.geoid]) continue; // barrier exclusion
      if (_haversine(lat, lon, tc.lat, tc.lon) <= bufferMiles) {
        tractGeoids[tc.geoid] = true;
      }
    }

    // Aggregate matching ACS tracts
    var pop = 0, renterHh = 0, ownerHh = 0, totalHh = 0, vacant = 0;
    var rentSum = 0, rentN = 0, incSum = 0, incN = 0;
    // Weighted burden: sum(cost_burden_rate * renter_hh) / sum(renter_hh)
    var burdenWeightedSum = 0, burdenWeightN = 0;
    // Severe burden: sum(severe_cost_burden_rate * renter_hh) / sum(renter_hh)
    var severeWeightedSum = 0, severeWeightN = 0;
    // Population-weighted poverty & unemployment
    var povWeightedSum = 0, povWeightN = 0;
    var unempWeightedSum = 0, unempWeightN = 0;
    var tractCount = 0;

    for (var j = 0; j < _acsMetricsCache.length; j++) {
      var t = _acsMetricsCache[j];
      if (!tractGeoids[t.geoid]) continue;
      tractCount++;
      pop      += t.pop || 0;
      renterHh += t.renter_hh || 0;
      totalHh  += t.total_hh || 0;
      vacant   += t.vacant || 0;
      if (t.median_gross_rent > 0) { rentSum += t.median_gross_rent; rentN++; }
      if (t.median_hh_income > 0)  { incSum  += t.median_hh_income;  incN++;  }
      // Weighted cost-burden aggregation
      var tRenterHh = t.renter_hh || 0;
      var tBurdenRate = t.cost_burden_rate;
      if (tBurdenRate > 0 && tRenterHh > 0) {
        burdenWeightedSum += tBurdenRate * tRenterHh;
        burdenWeightN += tRenterHh;
      }
      // Weighted severe cost-burden
      var tSevereRate = t.severe_cost_burden_rate;
      if (tSevereRate > 0 && tRenterHh > 0) {
        severeWeightedSum += tSevereRate * tRenterHh;
        severeWeightN += tRenterHh;
      }
      // Population-weighted poverty rate
      var tPop = t.pop || 0;
      if (t.poverty_rate > 0 && tPop > 0) {
        povWeightedSum += t.poverty_rate * tPop;
        povWeightN += tPop;
      }
      // Labor-force-weighted unemployment rate (use pop as proxy weight)
      if (t.unemployment_rate > 0 && tPop > 0) {
        unempWeightedSum += t.unemployment_rate * tPop;
        unempWeightN += tPop;
      }
    }

    if (tractCount === 0) return null;

    ownerHh = Math.max(0, totalHh - renterHh);
    var costBurdenRate = burdenWeightN > 0 ? burdenWeightedSum / burdenWeightN : null;

    return {
      pop:              pop,
      renter_hh:        renterHh,
      owner_hh:         ownerHh,
      total_hh:         totalHh,
      vacant:           vacant,
      med_gross_rent:   rentN > 0 ? Math.round(rentSum / rentN) : null,
      median_gross_rent: rentN > 0 ? Math.round(rentSum / rentN) : null,
      med_hh_income:    incN > 0 ? Math.round(incSum / incN) : null,
      median_hh_income: incN > 0 ? Math.round(incSum / incN) : null,
      cost_burden_rate: costBurdenRate,
      renter_share:     totalHh > 0 ? renterHh / totalHh : null,
      vacancy_rate:     (totalHh + vacant) > 0 ? vacant / (totalHh + vacant) : null,
      tract_count:      tractCount,
      severe_burden_rate: severeWeightN > 0 ? severeWeightedSum / severeWeightN : null,
      poverty_rate:     povWeightN > 0 ? povWeightedSum / povWeightN : null,
      unemployment_rate: unempWeightN > 0 ? unempWeightedSum / unempWeightN : null
    };
  }

  /**
   * Pull LIHTC features from PMAEngine's internal state, or from
   * DataService as a fallback.  Returns [] if unavailable.
   * @returns {Array}
   */
  function _getLihtc() {
    var st = _state();
    if (st) {
      var s = _safe(function () { return st.getState(); }, null);
      if (s && Array.isArray(s.lihtc) && s.lihtc.length) return s.lihtc;
    }
    return [];
  }

  /**
   * Pull QCT / DDA designation flags from local overlay data using HudEgis.
   * Checks whether the given lat/lon falls within a QCT or DDA polygon using
   * a ray-casting point-in-polygon algorithm (see hud-egis.js for details).
   *
   * QCT = Qualified Census Tract (high poverty / low-income area; IRC §42(d)(5)(B)(ii))
   * DDA = Difficult Development Area (high construction costs; IRC §42(d)(5)(B)(iii))
   * Either designation qualifies the project for up to 130% eligible basis boost.
   *
   * Returns safe defaults when HudEgis is unavailable or data has not yet loaded.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {{ qctFlag: boolean, ddaFlag: boolean, basisBoostEligible: boolean }}
   */
  function _getDesignationFlags(lat, lon) {
    var hudEgis = window.HudEgis;
    if (hudEgis && typeof hudEgis.checkDesignation === 'function') {
      try {
        var result = hudEgis.checkDesignation(lat, lon);
        _log('_getDesignationFlags(): QCT=' + result.in_qct + ', DDA=' + result.in_dda +
          ', basisBoostEligible=' + result.basis_boost_eligible);
        return {
          qctFlag:          result.in_qct,
          ddaFlag:          result.in_dda,
          basisBoostEligible: result.basis_boost_eligible
        };
      } catch (e) {
        _err('_getDesignationFlags() — HudEgis.checkDesignation() failed', e);
      }
    }
    // Fallback: HudEgis not available or checkDesignation() not found
    _log('_getDesignationFlags(): HudEgis unavailable — using safe defaults (all false)');
    return { qctFlag: false, ddaFlag: false, basisBoostEligible: false };
  }

  /**
   * Compute the Market Rent / FMR ratio using HudFmr when available.
   *
   * Derives the primary county FIPS from PMAEngine's buffered tract geoids
   * (the first 5 digits of a GEOID are the state+county FIPS).  Falls back
   * gracefully when HudFmr or the PMAEngine state is not loaded.
   *
   * @param {number}      lat  Site latitude.
   * @param {number}      lon  Site longitude.
   * @param {Object|null} acs  Aggregated ACS metrics for the buffer.
   * @returns {number|null}    Market gross rent ÷ 2BR FMR, or null.
   */
  function _computeFmrRatio(lat, lon, acs) {
    var hudFmr = window.HudFmr;
    if (!hudFmr || !hudFmr.isLoaded()) return null;

    var marketRent = acs && acs.median_gross_rent ? acs.median_gross_rent : null;
    if (!marketRent) return null;

    // Derive primary county FIPS from PMAEngine buffered tract geoids
    var countyFips = null;
    try {
      var pma = _pma();
      if (pma && typeof pma.tractsInBuffer === 'function') {
        var bufTracts = pma.tractsInBuffer(lat, lon, 5);
        if (bufTracts && bufTracts.length) {
          var fipsCount = {};
          for (var i = 0; i < bufTracts.length; i++) {
            var geoid = String(bufTracts[i].geoid || '');
            if (geoid.length >= 5) {
              var f = geoid.slice(0, 5);
              fipsCount[f] = (fipsCount[f] || 0) + 1;
            }
          }
          var maxCount = 0;
          Object.keys(fipsCount).forEach(function (f) {
            if (fipsCount[f] > maxCount) { maxCount = fipsCount[f]; countyFips = f; }
          });
        }
      }
    } catch (e) {
      // Fallback: no county FIPS derived — will return null below
    }

    if (!countyFips) return null;
    return hudFmr.computeFmrRatio(countyFips, marketRent);
  }

  /* ── Loading / error state helpers ─────────────────────────────── */

  /**
   * Show a spinner in every report section.
   */
  function _showAllLoading() {
    var r = _rend();
    if (!r) return;
    SECTION_IDS.forEach(function (id) {
      _safe(function () { r.showSectionLoading(id); });
    });
  }

  /**
   * Show an error message in every report section.
   * @param {string} msg
   */
  function _showAllError(msg) {
    var r = _rend();
    if (!r) return;
    SECTION_IDS.forEach(function (id) {
      _safe(function () { r.showSectionError(id, msg); });
    });
  }

  /* ── Environmental / flood / policy enrichment helpers ────────────── */

  var EARTH_R_MI = 3958.8;
  function _toRad(d) { return d * Math.PI / 180; }
  function _haversine(lat1, lon1, lat2, lon2) {
    var dLat = _toRad(lat2 - lat1);
    var dLon = _toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return EARTH_R_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** @type {Array|null} Cached EJI features for proximity lookup */
  var _ejiCache = null;

  /**
   * Load EJI features from the environmental_constraints layer on the map.
   * Falls back to fetching the GeoJSON file directly.
   */
  function _getEjiFeatures() {
    if (_ejiCache) return _ejiCache;

    // Try the map layer cache first (populated by market-analysis.js)
    var mapLayers = window._mapLayers || window._maMapLayers;
    if (mapLayers && mapLayers.envJustice) {
      var feats = [];
      mapLayers.envJustice.eachLayer(function (layer) {
        var ll = layer.getLatLng ? layer.getLatLng() : null;
        var props = (layer.feature && layer.feature.properties) ? layer.feature.properties : {};
        if (ll) feats.push({ lat: ll.lat, lon: ll.lng, props: props });
      });
      if (feats.length > 0) {
        _ejiCache = feats;
        return _ejiCache;
      }
    }

    // Try DataService direct fetch (synchronous from cache)
    var ds = _ds();
    if (ds && ds._ejiCache) {
      _ejiCache = ds._ejiCache;
      return _ejiCache;
    }

    return null;
  }

  /**
   * Get EJI environmental burden percentile for a site location.
   * Finds the nearest census tract with EJI data.
   * @param {number} lat
   * @param {number} lon
   * @returns {{ envBurden: number|null, socialVuln: number|null, healthVuln: number|null,
   *             ejiPercentile: number|null, riskCategory: string, tractGeoid: string }}
   */
  function _getEjiMetrics(lat, lon) {
    var defaults = { envBurden: null, socialVuln: null, healthVuln: null,
                     ejiPercentile: null, riskCategory: 'unknown', tractGeoid: '' };
    var feats = _getEjiFeatures();
    if (!feats || feats.length === 0) return defaults;

    var nearest = null;
    var minDist = Infinity;

    for (var i = 0; i < feats.length; i++) {
      var f = feats[i];
      var d = _haversine(lat, lon, f.lat, f.lon);
      if (d < minDist) {
        minDist = d;
        nearest = f;
      }
    }

    if (!nearest || minDist > 5) return defaults;  // >5 miles away = no data

    var p = nearest.props;
    return {
      envBurden:      p.env_burden != null ? p.env_burden : null,
      socialVuln:     p.social_vuln != null ? p.social_vuln : null,
      healthVuln:     p.health_vuln != null ? p.health_vuln : null,
      ejiPercentile:  p.eji_percentile != null ? p.eji_percentile : null,
      riskCategory:   p.risk_category || 'unknown',
      tractGeoid:     p.geoid || ''
    };
  }

  /**
   * Convert CDC EJI environmental burden percentile (0-1) to a soil/environmental
   * score (0-100) for the feasibility assessment.
   * Higher EJI burden = LOWER site suitability score.
   * @param {number|null} envBurden - EJI environmental burden percentile (0-1)
   * @returns {number} Score 0-100 (100 = cleanest/best, 0 = worst burden)
   */
  function _envBurdenToScore(envBurden) {
    if (envBurden == null || envBurden < 0) return 50;  // neutral default
    return Math.round((1 - envBurden) * 100);
  }

  /**
   * Estimate flood risk (0-3) from loaded flood zone GeoJSON data.
   * Uses point-in-bbox approximation for speed.
   * @param {number} lat
   * @param {number} lon
   * @returns {number} 0=none, 1=low, 2=moderate, 3=high
   */
  function _getFloodRisk(lat, lon) {
    var mapLayers = window._mapLayers || window._maMapLayers;
    if (!mapLayers || !mapLayers.flood) return 0;

    var highRisk = false;
    var anyRisk = false;

    try {
      mapLayers.flood.eachLayer(function (layer) {
        if (highRisk) return;  // short-circuit
        var props = (layer.feature && layer.feature.properties) ? layer.feature.properties : {};
        // Check if point is within the layer bounds (fast bbox check)
        var bounds = layer.getBounds ? layer.getBounds() : null;
        if (!bounds) return;
        if (bounds.contains([lat, lon])) {
          anyRisk = true;
          if (props.sfha || props.risk_category === 'high' ||
              props.FLD_ZONE === 'A' || props.FLD_ZONE === 'AE' ||
              props.FLD_ZONE === 'AO' || props.FLD_ZONE === 'V' ||
              props.FLD_ZONE === 'VE') {
            highRisk = true;
          }
        }
      });
    } catch (e) {
      _warn('_getFloodRisk() failed: ' + (e && e.message));
    }

    if (highRisk) return 3;
    if (anyRisk) return 1;
    return 0;
  }

  /** @type {Array|null} Cached tract centroids for county FIPS derivation */
  var _tractCentroidCache = null;

  /** @type {object|null} Cached scorecard data */
  var _scorecardCache = null;
  var _scorecardLoading = false;

  /**
   * Get housing policy scorecard data for the jurisdiction containing the site.
   * Matches by county FIPS (5-digit) from the PMA buffer tracts.
   * @param {number} lat
   * @param {number} lon
   * @returns {{ overlayCount: number, overlays: Array.<string>, zoningCapacity: number,
   *             publicOwnership: boolean, totalScore: number, jurisdictionName: string }}
   */
  function _getScorecardMetrics(lat, lon) {
    var defaults = { overlayCount: 0, overlays: [], zoningCapacity: 0,
                     publicOwnership: false, totalScore: 0, jurisdictionName: '' };

    if (!_scorecardCache) return defaults;

    // Derive county FIPS from PMA buffer
    var countyFips = null;
    try {
      var pma = _pma();
      if (pma && typeof pma.tractsInBuffer === 'function') {
        var bufTracts = pma.tractsInBuffer(lat, lon, 5);
        if (bufTracts && bufTracts.length) {
          var fipsCount = {};
          for (var i = 0; i < bufTracts.length; i++) {
            var geoid = String(bufTracts[i].geoid || '');
            if (geoid.length >= 5) {
              var f = geoid.slice(0, 5);
              fipsCount[f] = (fipsCount[f] || 0) + 1;
            }
          }
          var maxCount = 0;
          Object.keys(fipsCount).forEach(function (f) {
            if (fipsCount[f] > maxCount) { maxCount = fipsCount[f]; countyFips = f; }
          });
        }
      }
    } catch (e) { /* ignore */ }

    // Fallback: derive county FIPS from 5 nearest tract centroids (majority vote)
    if (!countyFips && _tractCentroidCache && _tractCentroidCache.length > 0) {
      var nearTracts = [];
      for (var j = 0; j < _tractCentroidCache.length; j++) {
        var tc = _tractCentroidCache[j];
        var dist = _haversine(lat, lon, tc.lat, tc.lon);
        if (nearTracts.length < 5 || dist < nearTracts[nearTracts.length - 1].dist) {
          nearTracts.push({ geoid: tc.geoid, dist: dist });
          nearTracts.sort(function (a, b) { return a.dist - b.dist; });
          if (nearTracts.length > 5) nearTracts.pop();
        }
      }
      if (nearTracts.length > 0) {
        var fVotes = {};
        for (var k = 0; k < nearTracts.length; k++) {
          var cf = String(nearTracts[k].geoid).slice(0, 5);
          fVotes[cf] = (fVotes[cf] || 0) + 1;
        }
        var bestCount = 0;
        Object.keys(fVotes).forEach(function (cf) {
          if (fVotes[cf] > bestCount) { bestCount = fVotes[cf]; countyFips = cf; }
        });
      }
    }

    if (!countyFips) return defaults;

    var scores = _scorecardCache.scores || {};
    var entry = scores[countyFips];
    if (!entry) return defaults;

    var dims = entry.dimensions || {};
    var overlays = [];
    if (dims.has_hna) overlays.push('Housing Needs Assessment');
    if (dims.prop123_committed) overlays.push('Proposition 123 Committed');
    if (dims.has_housing_authority) overlays.push('Housing Authority');
    if (dims.has_housing_nonprofits) overlays.push('Housing Nonprofits');
    if (dims.has_comp_plan) overlays.push('Housing in Comprehensive Plan');
    if (dims.has_iz_ordinance) overlays.push('Inclusionary Zoning Ordinance');
    if (dims.has_local_funding) overlays.push('Local Housing Funding');

    return {
      overlayCount:     overlays.length,
      overlays:         overlays,
      zoningCapacity:   dims.has_iz_ordinance ? 1 : 0,
      publicOwnership:  dims.has_housing_authority || false,
      totalScore:       entry.totalScore || 0,
      jurisdictionName: entry.name || ''
    };
  }

  /**
   * Attempt to load scorecard data asynchronously at init time.
   */
  function _loadScorecard() {
    if (_scorecardCache || _scorecardLoading) return;
    _scorecardLoading = true;
    var fetch = (typeof window.safeFetchJSON === 'function') ? window.safeFetchJSON : null;
    if (!fetch) {
      _scorecardLoading = false;
      return;
    }
    fetch('data/policy/housing-policy-scorecard.json')
      .then(function (data) {
        if (data && data.scores) {
          _scorecardCache = data;
          _log('Scorecard loaded: ' + Object.keys(data.scores).length + ' jurisdictions');
        }
      })
      .catch(function (e) {
        _warn('Scorecard load failed: ' + (e && e.message));
      })
      .finally(function () { _scorecardLoading = false; });
  }

  /**
   * Attempt to load and cache EJI features asynchronously at init time.
   */
  function _loadEji() {
    var fetch = (typeof window.safeFetchJSON === 'function') ? window.safeFetchJSON : null;
    if (!fetch) return;
    fetch('data/market/environmental_constraints_co.geojson')
      .then(function (data) {
        if (data && data.features) {
          _ejiCache = [];
          for (var i = 0; i < data.features.length; i++) {
            var feat = data.features[i];
            var geom = feat.geometry;
            var props = feat.properties || {};
            if (geom && geom.type === 'Point' && geom.coordinates) {
              _ejiCache.push({
                lat: geom.coordinates[1],
                lon: geom.coordinates[0],
                props: props
              });
            }
          }
          _log('EJI data loaded: ' + _ejiCache.length + ' tracts');
        }
      })
      .catch(function (e) {
        _warn('EJI data load failed: ' + (e && e.message));
      });
  }

  /* ── Core analysis pipeline ─────────────────────────────────────── */

  /**
   * Orchestrate a full site analysis:
   *  1. Set loading state.
   *  2. Pull ACS + LIHTC data.
   *  3. Compute scores.
   *  4. Update MAState.
   *  5. Invoke all section renderers.
   *  6. Clear loading state.
   *
   * @param {number} lat         - Site latitude.
   * @param {number} lon         - Site longitude.
   * @param {number} bufferMiles - Analysis buffer radius in miles.
   */
  function runAnalysis(lat, lon, bufferMiles) {
    var st  = _state();
    var scr = _scorer();
    var ren = _rend();

    // Store current site for ACS fallback aggregation
    _currentSite = { lat: lat, lon: lon, bufferMiles: bufferMiles || 5 };

    _log('runAnalysis(): lat=' + lat + ', lon=' + lon + ', buffer=' + bufferMiles + 'mi' +
      ' — MAState=' + (st ? 'ok' : 'missing') +
      ', SiteSelectionScore=' + (scr ? 'ok' : 'missing') +
      ', MARenderers=' + (ren ? 'ok' : 'missing'));

    // ── 1. Set loading state ────────────────────────────────────────
    if (st) {
      _safe(function () {
        st.setState({
          loading:   true,
          error:     null,
          site:      { lat: lat, lon: lon, bufferMiles: bufferMiles || 5 }
        });
      });
    }

    _showAllLoading();

    // Defer the synchronous scoring work by one tick so that the loading
    // spinners painted above have time to reach the screen before the
    // main thread is occupied.  requestAnimationFrame is not available in
    // all environments targeted by this ES5 module, so setTimeout(fn, 0)
    // is used as the equivalent portable deferral mechanism.
    setTimeout(function () {
      try {
        // ── 1b. Barrier-based tract exclusion ────────────────────────
        // Identify tracts behind major barriers BEFORE ACS aggregation
        // so they don't contribute to demand/vacancy calculations.
        _barrierExcludedGeoids = [];
        var pmaBarriers = window.PMABarriers;
        if (pmaBarriers && typeof pmaBarriers.identifyExcludedTracts === 'function' && _tractCentroidCache) {
          _safe(function () {
            // Use cached barrier features from map layers if available
            var barrierLayer = window._mapLayers && window._mapLayers.barriers;
            var barrierFeatures = [];
            if (barrierLayer && typeof barrierLayer.toGeoJSON === 'function') {
              var gj = barrierLayer.toGeoJSON();
              barrierFeatures = gj.features || [];
            }
            if (barrierFeatures.length) {
              _barrierExcludedGeoids = pmaBarriers.identifyExcludedTracts(lat, lon, _tractCentroidCache, barrierFeatures);
              if (_barrierExcludedGeoids.length) {
                _log('Barrier exclusion: ' + _barrierExcludedGeoids.length + ' tracts excluded');
              }
            }
          });
        }

        // ── 2. Gather data ───────────────────────────────────────────
        var acs   = _getAcs();
        var lihtc = _getLihtc();
        var flags = _getDesignationFlags(lat, lon);

        // Notify the deal calculator of the designation result so the UI can
        // pre-check the QCT/DDA checkbox when the site qualifies for a basis boost.
        // setDesignationContext is a no-op when the deal calculator is not mounted.
        _safe(function () {
          if (window.__DealCalc && typeof window.__DealCalc.setDesignationContext === 'function') {
            window.__DealCalc.setDesignationContext(flags.basisBoostEligible);
          }
        });

        _log('runAnalysis(): acs=' + (acs ? 'ok (tract_count=' + (acs.tract_count || '?') + ')' : 'null') +
          ', lihtc=' + lihtc.length + ' features');

        // Enrich amenity distances using OsmAmenities when loaded.
        var amenityInputs = null;
        var osmA = window.OsmAmenities;
        if (osmA && osmA.isLoaded()) {
          var accessResult = _safe(function () { return osmA.getAccessScore(lat, lon); }, null);
          if (accessResult) {
            // scoreAccess() and renderNeighborhoodAccess() both expect plain
            // distance-in-miles numbers, not the {name, distanceMiles, score}
            // objects returned by getAccessScore().
            amenityInputs = {
              grocery:    accessResult.grocery    != null ? accessResult.grocery.distanceMiles    : null,
              transit:    accessResult.transit    != null ? accessResult.transit.distanceMiles    : null,
              parks:      accessResult.parks      != null ? accessResult.parks.distanceMiles      : null,
              healthcare: accessResult.healthcare != null ? accessResult.healthcare.distanceMiles : null,
              schools:    accessResult.schools    != null ? accessResult.schools.distanceMiles    : null,
              hospitals:  accessResult.hospitals  != null ? accessResult.hospitals.distanceMiles  : null,
              childcare:  accessResult.childcare  != null ? accessResult.childcare.distanceMiles  : null
            };
          }
        }

        // Enrich with EPA walkability / bikeability when loaded.
        var walkabilityCtx = null;
        var epaWalk = window.EpaWalkability;
        if (epaWalk && epaWalk.isLoaded()) {
          walkabilityCtx = _safe(function () { return epaWalk.getScores(lat, lon); }, null);
          if (walkabilityCtx) {
            _log('walkability: walk=' + walkabilityCtx.walkScore +
              ' (' + walkabilityCtx.walkLabel + '), bike=' + walkabilityCtx.bikeScore +
              ' (' + walkabilityCtx.bikeLabel + ')');
          }
        }

        // ── Enrich with EJI environmental data ──────────────────────
        var ejiMetrics = _safe(function () { return _getEjiMetrics(lat, lon); },
          { envBurden: null, socialVuln: null, healthVuln: null,
            ejiPercentile: null, riskCategory: 'unknown', tractGeoid: '' });

        if (ejiMetrics.envBurden != null) {
          _log('EJI: envBurden=' + ejiMetrics.envBurden.toFixed(3) +
            ' risk=' + ejiMetrics.riskCategory +
            ' tract=' + ejiMetrics.tractGeoid);
        }

        // ── Enrich with flood zone proximity ──────────────────────────
        var floodRisk = _safe(function () { return _getFloodRisk(lat, lon); }, 0);
        if (floodRisk > 0) {
          _log('Flood risk: level=' + floodRisk);
        }

        // ── Enrich with housing policy scorecard ──────────────────────
        var policyMetrics = _safe(function () { return _getScorecardMetrics(lat, lon); },
          { overlayCount: 0, overlays: [], zoningCapacity: 0,
            publicOwnership: false, totalScore: 0, jurisdictionName: '' });

        if (policyMetrics.overlayCount > 0) {
          _log('Policy: ' + policyMetrics.jurisdictionName +
            ' — ' + policyMetrics.overlayCount + ' supportive overlays, score=' + policyMetrics.totalScore);
        }

        // Build scoring inputs from available data.
        var inputs = {
          acs:              acs,
          qctFlag:          flags.qctFlag,
          ddaFlag:          flags.ddaFlag,
          fmrRatio:         _computeFmrRatio(lat, lon, acs),
          nearbySubsidized: lihtc ? lihtc.length : 0,
          floodRisk:        floodRisk,
          soilScore:        _envBurdenToScore(ejiMetrics.envBurden),
          cleanupFlag:      ejiMetrics.riskCategory === 'high',
          amenities:        amenityInputs,
          walkabilityCtx:   walkabilityCtx,
          ejiMetrics:       ejiMetrics,
          zoningCapacity:   policyMetrics.zoningCapacity,
          publicOwnership:  policyMetrics.publicOwnership,
          overlayCount:     policyMetrics.overlayCount,
          overlays:         policyMetrics.overlays,
          policyJurisdiction: policyMetrics.jurisdictionName,
          policyTotalScore: policyMetrics.totalScore,
          rentTrend:        0,
          jobTrend:         0,
          concentration:    0.5,
          serviceStrength:  0.25,
          basisBoostEligible: flags.basisBoostEligible
        };

        // ── 3. Compute scores ────────────────────────────────────────
        var scores = null;
        if (scr && typeof scr.computeScore === 'function') {
          scores = _safe(function () { return scr.computeScore(inputs); }, null);
        } else {
          _warn('SiteSelectionScore not loaded; scores will be null.');
        }

        // ── 4. Update state ──────────────────────────────────────────
        if (st) {
          _safe(function () {
            st.setState({
              acs:       acs,
              lihtc:     lihtc,
              scores:    scores,
              loading:   false,
              dataReady: true,
              sections: {
                demand:        acs,
                supply:        { lihtcFeatures: lihtc },
                subsidy: {
                  qctFlag:            flags.qctFlag,
                  ddaFlag:            flags.ddaFlag,
                  basisBoostEligible: flags.basisBoostEligible,
                  fmrRatio:           inputs.fmrRatio,
                  nearbySubsidized:   inputs.nearbySubsidized,
                  subsidy_score:      scores ? scores.subsidy_score : null
                },
                feasibility: {
                  floodRisk:         inputs.floodRisk,
                  soilScore:         inputs.soilScore,
                  cleanupFlag:       inputs.cleanupFlag,
                  ejiMetrics:        inputs.ejiMetrics,
                  feasibility_score: scores ? scores.feasibility_score : null
                },
                access: {
                  amenities:      inputs.amenities,
                  walkability:    walkabilityCtx,
                  access_score:   scores ? scores.access_score : null
                },
                policy: {
                  zoningCapacity:    inputs.zoningCapacity,
                  publicOwnership:   inputs.publicOwnership,
                  overlayCount:      inputs.overlayCount,
                  overlays:          inputs.overlays,
                  jurisdictionName:  inputs.policyJurisdiction,
                  policyTotalScore:  inputs.policyTotalScore,
                  policy_score:      scores ? scores.policy_score : null
                },
                opportunities: _buildOpportunities(scores)
              }
            });
          });
        }

        // ── 5. Render sections ───────────────────────────────────────
        if (ren) {
          _log('runAnalysis(): rendering 8 report sections');
          _safe(function () {
            _log('rendering maExecSummary');
            ren.renderExecutiveSummary(scores, acs);
          });
          _safe(function () {
            _log('rendering maMarketDemand');
            ren.renderMarketDemand(acs);
          });
          _safe(function () {
            _log('rendering maAffordableSupply');
            ren.renderAffordableSupply(lihtc);
          });
          _safe(function () {
            _log('rendering maSubsidyOpp');
            ren.renderSubsidyOpportunities({
              qctFlag:            flags.qctFlag,
              ddaFlag:            flags.ddaFlag,
              basisBoostEligible: flags.basisBoostEligible,
              fmrRatio:           inputs.fmrRatio,
              nearbySubsidized:   inputs.nearbySubsidized,
              subsidy_score:      scores ? scores.subsidy_score : null
            });
          });
          _safe(function () {
            _log('rendering maSiteFeasibility');
            ren.renderSiteFeasibility({
              floodRisk:         inputs.floodRisk,
              soilScore:         inputs.soilScore,
              cleanupFlag:       inputs.cleanupFlag,
              ejiMetrics:        inputs.ejiMetrics,
              feasibility_score: scores ? scores.feasibility_score : null
            });
          });
          _safe(function () {
            _log('rendering maNeighborhoodAccess');
            ren.renderNeighborhoodAccess({
              amenities:    inputs.amenities,
              walkability:  walkabilityCtx,
              access_score: scores ? scores.access_score : null
            });
          });
          _safe(function () {
            _log('rendering maPolicyOverlays');
            ren.renderPolicyOverlays({
              zoningCapacity:    inputs.zoningCapacity,
              publicOwnership:   inputs.publicOwnership,
              overlayCount:      inputs.overlayCount,
              overlays:          inputs.overlays,
              jurisdictionName:  inputs.policyJurisdiction,
              policyTotalScore:  inputs.policyTotalScore,
              policy_score:      scores ? scores.policy_score : null
            });
          });
          _safe(function () {
            _log('rendering maOpportunities');
            ren.renderOpportunities(_buildOpportunities(scores));
          });
          // Infrastructure feasibility (supplementary — climate, flood, utility, food access)
          _safe(function () {
            var pmaInfra = window.PMAInfrastructure;
            if (pmaInfra && typeof pmaInfra.getInfrastructureScore === 'function' && ren.renderInfrastructure) {
              _log('rendering maInfrastructure (supplementary)');
              ren.renderInfrastructure({
                score: pmaInfra.getInfrastructureScore(),
                justification: pmaInfra.getInfrastructureJustification()
              });
            }
          });
          _log('runAnalysis(): all sections rendered (final_score=' + (scores ? scores.final_score : 'n/a') + ')');

          // Notify map layers of site selection (for dynamic filtering)
          document.dispatchEvent(new CustomEvent('pma-site-selected', {
            detail: { lat: lat, lon: lon, bufferMiles: bufferMiles || 5 }
          }));

          // Fetch live Regrid parcels for parcelZoning overlay when API key available
          if (window.RegridParcels && window.RegridParcels.isAvailable()) {
            _log('Fetching live Regrid parcels…');
            window.RegridParcels.fetchParcelsNearPoint(lat, lon, bufferMiles || 5)
              .then(function (parcels) {
                if (parcels && parcels.length > 0) {
                  _log('Regrid: ' + parcels.length + ' parcels returned');
                  // Classify each parcel for MF suitability
                  parcels.forEach(function (f) {
                    var cls = window.RegridParcels.classifyParcel(f);
                    f.properties = f.properties || {};
                    f.properties.mf_suitability = cls.score * 33; // 0-99 scale
                    f.properties.zone_proxy = cls.mfCompatible ? 'multifamily_residential'
                      : cls.vacantOrUnderutilized ? 'vacant_developable'
                      : 'commercial';
                    f.properties.data_source = 'regrid';
                  });
                  // Emit event for map layer to pick up
                  var evt = new CustomEvent('regrid-parcels-loaded', {
                    detail: { type: 'FeatureCollection', features: parcels }
                  });
                  document.dispatchEvent(evt);
                }
              })
              .catch(function (e) { _warn('Regrid fetch failed: ' + (e && e.message)); });
          }
        } else {
          _warn('MARenderers not loaded; skipping section rendering.');
        }

      } catch (e) {
        _err('runAnalysis failed', e);
        var errMsg = (e && e.message) ? e.message : 'An unexpected error occurred.';
        if (st) {
          _safe(function () { st.setState({ loading: false, error: errMsg }); });
        }
        _showAllError(errMsg);
      }
    }, 0);
  }

  /* ── Opportunities builder ──────────────────────────────────────── */

  /**
   * Derive a list of strategic opportunity items from a score result.
   * @param {object|null} scores
   * @returns {{ items: Array }}
   */
  function _buildOpportunities(scores) {
    if (!scores) return { items: [] };

    var items = [];

    if (scores.demand_score >= 70) {
      items.push({
        title:       'Strong Renter Demand',
        description: 'High cost-burden and renter concentration signal unmet demand for affordable units.',
        priority:    'High'
      });
    }

    if (scores.subsidy_score >= 70) {
      items.push({
        title:       'Subsidy Eligibility Advantage',
        description: 'QCT or DDA designation may support a basis-boost application, reducing equity gap.',
        priority:    'High'
      });
    }

    if (scores.feasibility_score >= 70) {
      items.push({
        title:       'Favorable Site Conditions',
        description: 'Low flood risk and strong soil scores reduce pre-development risk and cost.',
        priority:    'Moderate'
      });
    }

    if (scores.access_score >= 70) {
      items.push({
        title:       'Strong Amenity Access',
        description: 'Proximity to transit, groceries, and healthcare supports resident quality of life.',
        priority:    'Moderate'
      });
    }

    if (scores.policy_score >= 70) {
      items.push({
        title:       'Supportive Policy Environment',
        description: 'By-right zoning capacity and public ownership reduce entitlement risk.',
        priority:    'High'
      });
    }

    if (scores.market_score >= 70) {
      items.push({
        title:       'Positive Market Fundamentals',
        description: 'Rising rents and job growth support long-term viability of affordable development.',
        priority:    'Moderate'
      });
    }

    // If no component scored well, add a generic note.
    if (items.length === 0) {
      items.push({
        title:       'Targeted Intervention Required',
        description: 'No single component scores as a clear strength; a comprehensive needs assessment is recommended.',
        priority:    'Lower'
      });
    }

    return { items: items };
  }

  /* ── Reset ──────────────────────────────────────────────────────── */

  /**
   * Reset application state and clear all rendered sections.
   */
  function resetAll() {
    var st  = _state();
    var ren = _rend();

    if (st) {
      _safe(function () { st.reset(); });
    }

    if (ren) {
      SECTION_IDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) { el.innerHTML = ''; }
      });
    }
  }

  /* ── Initialisation ─────────────────────────────────────────────── */

  /**
   * Set up event listeners and perform startup configuration.
   * Must be called once on DOMContentLoaded.
   */
  function init() {
    // Guard against double-initialisation.
    if (window.__MAControllerInit) {
      _warn('init() called more than once; ignoring.');
      return;
    }
    window.__MAControllerInit = true;

    // Validate required modules.
    if (!_state())  _warn('MAState not found — state management disabled.');
    if (!_scorer()) _warn('SiteSelectionScore not found — scoring disabled.');
    if (!_rend())   _warn('MARenderers not found — rendering disabled.');

    // Bind the "Run Analysis" button if present.
    var runBtn = document.getElementById('maRunAnalysisBtn');
    if (runBtn) {
      runBtn.addEventListener('click', function () {
        var latInput = document.getElementById('maSiteLat');
        var lonInput = document.getElementById('maSiteLon');
        var bufInput = document.getElementById('maBufferMiles');

        var lat = latInput  ? parseFloat(latInput.value)  : NaN;
        var lon = lonInput  ? parseFloat(lonInput.value)  : NaN;
        var buf = bufInput  ? parseFloat(bufInput.value)  : 5;

        if (isNaN(lat) || isNaN(lon)) {
          _warn('Invalid lat/lon values in input fields.');
          return;
        }

        runAnalysis(lat, lon, buf);
      });
    }

    // Bind the "Reset" button if present.
    var resetBtn = document.getElementById('maResetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        resetAll();
      });
    }

    // Bind the "Export Report" button if present.
    var exportBtn = document.getElementById('pmaExportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        var ren = _rend();
        if (ren && typeof ren.exportReport === 'function') {
          ren.exportReport();
        } else {
          _warn('MARenderers.exportReport not available.');
        }
      });
    }

    // If PMAEngine has already run and stored site coordinates, kick off
    // an analysis automatically.
    var pma = _pma();
    if (pma && pma._state) {
      var q = _safe(function () { return pma._state.getLastQuality && pma._state.getLastQuality(); }, null);
      if (q && q.site && typeof q.site.lat === 'number') {
        runAnalysis(q.site.lat, q.site.lon, q.site.bufferMiles || 5);
      }
    }
  }

  /**
   * Load tract centroids for county FIPS derivation fallback.
   */
  function _loadTractCentroids() {
    var fetch = (typeof window.safeFetchJSON === 'function') ? window.safeFetchJSON : null;
    if (!fetch) return;
    fetch('data/market/tract_centroids_co.json')
      .then(function (data) {
        if (data && data.tracts) {
          _tractCentroidCache = data.tracts;
          _log('Tract centroids loaded: ' + _tractCentroidCache.length + ' tracts');
        }
      })
      .catch(function (e) {
        _warn('Tract centroids load failed: ' + (e && e.message));
      });
  }

  /**
   * Load ACS tract metrics for direct aggregation fallback.
   */
  function _loadAcsMetrics() {
    var fetch = (typeof window.safeFetchJSON === 'function') ? window.safeFetchJSON : null;
    if (!fetch) return;
    fetch('data/market/acs_tract_metrics_co.json')
      .then(function (data) {
        if (data && data.tracts && data.tracts.length) {
          _acsMetricsCache = data.tracts;
          _log('ACS metrics loaded: ' + _acsMetricsCache.length + ' tracts');
        }
      })
      .catch(function (e) {
        _warn('ACS metrics load failed: ' + (e && e.message));
      });
  }

  /* ── Pre-load enrichment data ──────────────────────────────────── */
  _loadScorecard();
  _loadEji();
  _loadTractCentroids();
  _loadAcsMetrics();

  /* ── DOMContentLoaded hook ───────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Document is already interactive or complete.
    init();
  }

  /* ── Expose ─────────────────────────────────────────────────────── */
  window.MAController = {
    init:        init,
    runAnalysis: runAnalysis,
    resetAll:    resetAll
  };

}());
