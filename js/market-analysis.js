/**
 * js/market-analysis.js
 * Public Market Analysis (PMA) scoring engine.
 *
 * Responsibilities:
 *  - Leaflet map initialization & site marker placement
 *  - PMA circular buffer calculation via Haversine distance
 *  - ACS tract metric aggregation within buffer
 *  - HUD LIHTC project filtering & counting
 *  - 5-dimension weighted PMA scoring:
 *      Demand (30%), Capture Risk (25%), Rent Pressure (15%),
 *      Land/Supply (15%), Workforce (15%)
 *  - CHFA-style capture-rate simulator
 *  - JSON + CSV export utilities
 *
 * Data loaded via DataService.getJSON() — no hardcoded fetch() calls.
 */
(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────── */
  var BUFFER_OPTIONS   = [3, 5, 10, 15]; // miles
  var AMI_60_PCT       = 0.60;           // default AMI threshold for affordable rent calc
  var AREA_MEDIAN_INCOME_CO = 95000;     // statewide fallback AMI ($/yr) — prefer county-specific via HudFmr
  var MAX_AFFORDABLE_RENT_PCT = 0.30;    // 30% of gross income rule

  /**
   * Get county-specific 4-person AMI from HudFmr connector. Returns null
   * if the county FIPS can't be resolved or HudFmr hasn't loaded — callers
   * must handle the null case explicitly rather than relying on a statewide
   * substitute (see scoreRentPressure / workforce scorer for the pattern).
   * @param {string|null} countyFips - 5-digit county FIPS code
   * @returns {number|null} 4-person AMI in dollars, or null if unresolved
   */
  function _getCountyAmi(countyFips) {
    if (countyFips && window.HudFmr) {
      try {
        var summary = window.HudFmr.getSummaryByFips(countyFips);
        if (summary && summary.ami_4person && summary.ami_4person > 0) {
          return summary.ami_4person;
        }
      } catch (e) { /* fall through */ }
    }
    return null;
  }
  var STATEWIDE_TRACT_COUNT = 1500;      // expected Colorado census tract count (~2020 Census)
  var COVERAGE_PRODUCTION_THRESHOLD = 0.80; // 80% = production-ready threshold

  // PMA dimension weights (must sum to 1.0)
  var WEIGHTS = {
    demand:       0.30,
    captureRisk:  0.25,
    rentPressure: 0.15,
    landSupply:   0.15,
    workforce:    0.15
  };

  // Risk thresholds (per PMA_SCORING.md)
  var RISK = {
    captureHigh:       0.25,  // >= 25% = high capture risk
    costBurdenHigh:    0.45,  // >= 45% cost-burden rate = high demand pressure
    rentPressureElev:  1.10   // ratio >= 1.10 = elevated
  };

  /* ── State ─────────────────────────────────────────────────────── */
  var map          = null;
  var siteMarker   = null;
  var bufferCircle = null;
  var todCircle    = null;   // ½-mile TOD isochrone (CHFA 3-pt scoring)
  var todMarkers   = null;   // L.layerGroup for highlighted transit stops in ½-mile
  var isochroneRingsLayer = null;  // L.featureGroup of walking + biking rings
  var siteLatLng   = null;
  var bufferMiles  = 5;

  // Walking + biking ring radii (miles). The ½-mile walking ring is the
  // canonical CHFA TOD-scoring ring drawn separately as `todCircle` — skipped
  // here to avoid visual overlap. Mode is used for tooltip labels + coloring.
  var ISOCHRONE_RINGS = [
    { miles: 0.25, mode: 'walk', color: '#16a34a' }, // 5-min walk
    { miles: 0.75, mode: 'walk', color: '#22c55e' }, // 15-min walk
    { miles: 1.0,  mode: 'walk', color: '#86efac' }, // 20-min walk
    { miles: 2.0,  mode: 'bike', color: '#2563eb' }, // 10-min bike
    { miles: 3.0,  mode: 'bike', color: '#3b82f6' }, // 15-min bike
    { miles: 5.0,  mode: 'bike', color: '#93c5fd' }  // 25-min bike
  ];
  var lastResult   = null;
  var dataLoaded   = false;  // true once loadData() has settled

  var tractCentroids      = null;
  var acsMetrics          = null;
  var lihtcFeatures       = null;
  var lihtcLoadError      = false;  // true when LIHTC data failed to load
  var prop123Jurisdictions = null;
  var dolaData            = null;   // DOLA county demographics (more current than ACS)
  var referenceProjects   = null;   // benchmark reference set
  var lastQuality         = null;   // last data quality assessment
  var lastBenchmark       = null;   // last benchmark result
  var lastPipeline        = null;   // last pipeline result
  var lastScenarios       = null;   // last scenario results
  var lastConfidence      = null;   // last heuristic confidence result

  // Workforce dimension data (loaded via data connectors)
  var workforceDataLoaded = false;

  // Overlay layer references
  var countyLayer  = null;
  var qctLayer     = null;
  var ddaLayer     = null;
  var lihtcLayer   = null;
  var layerControl = null;

  /* ── Haversine distance (miles) ─────────────────────────────────── */
  function haversine(lat1, lon1, lat2, lon2) {
    var R  = 3958.8; // Earth radius in miles
    var dL = (lat2 - lat1) * Math.PI / 180;
    var dO = (lon2 - lon1) * Math.PI / 180;
    var a  = Math.sin(dL / 2) * Math.sin(dL / 2) +
             Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
             Math.sin(dO / 2) * Math.sin(dO / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ── Check if a circular buffer intersects a tract ─────────────── */
  /**
   * Returns true when the circular buffer (centre lat/lon, radius in miles)
   * overlaps the tract.  When the tract carries a bounding-box derived from
   * the original polygon geometry we use a circle-bbox intersection test,
   * which correctly captures tracts that straddle the buffer boundary even
   * when their centroid lies just outside the radius.  Without a bbox we
   * fall back to the legacy centroid-distance check.
   *
   * bbox format: [minLon, minLat, maxLon, maxLat]
   */
  function tractInBuffer(t, lat, lon, miles) {
    if (t.bbox && t.bbox.length === 4) {
      // Circle-bbox intersection: clamp site coordinates to the bbox extents,
      // then measure the Haversine distance to that nearest boundary point.
      var nearestLat = Math.max(t.bbox[1], Math.min(lat, t.bbox[3]));
      var nearestLon = Math.max(t.bbox[0], Math.min(lon, t.bbox[2]));
      return haversine(lat, lon, nearestLat, nearestLon) <= miles;
    }
    // Fallback: centroid distance (legacy behaviour)
    return haversine(lat, lon, t.lat, t.lon) <= miles;
  }

  /* ── Get tracts within buffer ───────────────────────────────────── */
  function tractsInBuffer(lat, lon, miles) {
    var tracts = tractCentroids && (tractCentroids.tracts || tractCentroids);
    if (!tracts || !tracts.length) return [];
    var bboxCount     = 0;
    var centroidCount = 0;
    var included = tracts.filter(function (t) {
      var inBuf = tractInBuffer(t, lat, lon, miles);
      if (inBuf) { (t.bbox && t.bbox.length === 4) ? bboxCount++ : centroidCount++; }
      return inBuf;
    });
    return included;
  }

  /* ── Statewide tract coverage utility ──────────────────────────── */
  /**
   * Compute statewide tract coverage vs. expected Colorado tract count.
   * @returns {{ loaded: number, expected: number, pct: number, isProductionReady: boolean, label: string }}
   */
  function computeCoverage() {
    var tracts = tractCentroids && (tractCentroids.tracts || tractCentroids);
    var loaded = (tracts && tracts.length) ? tracts.length : 0;
    var pct    = Math.round((loaded / STATEWIDE_TRACT_COUNT) * 100);
    return {
      loaded:            loaded,
      expected:          STATEWIDE_TRACT_COUNT,
      pct:               pct,
      isProductionReady: (loaded / STATEWIDE_TRACT_COUNT) >= COVERAGE_PRODUCTION_THRESHOLD,
      label:             'Coverage: ' + loaded + ' / ' + STATEWIDE_TRACT_COUNT + ' tracts (' + pct + '%)'
    };
  }

  /* ── Build ACS index by geoid ───────────────────────────────────── */
  function buildAcsIndex(metrics) {
    var idx = {};
    (metrics || []).forEach(function (m) { idx[m.geoid] = m; });
    return idx;
  }

  /* ── Aggregate ACS metrics for buffer tracts ────────────────────── */
  function aggregateAcs(tracts, acsIdx) {
    var totals = {
      pop: 0, renter_hh: 0, owner_hh: 0, total_hh: 0,
      vacant: 0, rent_sum: 0, income_sum: 0,
      cost_burden_sum: 0, vacancy_rate_sum: 0, n: 0
    };
    tracts.forEach(function (t) {
      var m = acsIdx[t.geoid];
      if (!m) return;
      totals.pop          += m.pop          || 0;
      totals.renter_hh    += m.renter_hh    || 0;
      totals.owner_hh     += m.owner_hh     || 0;
      totals.total_hh     += m.total_hh     || 0;
      totals.vacant       += m.vacant       || 0;
      totals.rent_sum     += m.median_gross_rent  || 0;
      totals.income_sum   += m.median_hh_income   || 0;
      totals.cost_burden_sum  += m.cost_burden_rate || 0;
      totals.vacancy_rate_sum += m.vacancy_rate    || 0;
      totals.n++;
    });
    if (!totals.n) return null;
    return {
      pop:              totals.pop,
      renter_hh:        totals.renter_hh,
      total_hh:         totals.total_hh,
      vacant:           totals.vacant,
      median_gross_rent:   totals.n ? totals.rent_sum    / totals.n : 0,
      median_hh_income:    totals.n ? totals.income_sum  / totals.n : 0,
      cost_burden_rate:    totals.n ? totals.cost_burden_sum  / totals.n : 0,
      vacancy_rate:        totals.n ? totals.vacancy_rate_sum / totals.n : 0,
      tract_count:      totals.n
    };
  }

  /* ── LIHTC projects within buffer ───────────────────────────────── */
  function lihtcInBuffer(lat, lon, miles) {
    if (!lihtcFeatures) return [];
    return lihtcFeatures.filter(function (f) {
      var c = f.geometry && f.geometry.coordinates;
      if (!c) return false;
      return haversine(lat, lon, c[1], c[0]) <= miles;
    });
  }

  /* ── Prop 123 jurisdiction check ────────────────────────────────── */
  function isInProp123Jurisdiction(feature) {
    if (!prop123Jurisdictions || !prop123Jurisdictions.length) return false;
    var p = feature.properties || {};
    // hud_lihtc_co.geojson uses CITY; chfa-lihtc.json uses PROJ_CTY
    var city = (p.CITY || p.PROJ_CTY || p.city || '').toString().toLowerCase().trim();
    if (!city) return false;
    return prop123Jurisdictions.some(function (j) {
      return (j.name || '').toLowerCase().includes(city);
    });
  }

  /* ── PMA Scoring Engine ─────────────────────────────────────────── */
  function scoreDemand(acs) {
    // Affordability pressure (cost burden), renter share
    var cb   = acs.cost_burden_rate || 0;
    var renterShare = acs.total_hh ? acs.renter_hh / acs.total_hh : 0;
    // High cost burden → high demand → good site; normalise to 0-100
    var cbScore     = Math.min(100, (cb / 0.55) * 100);
    var renterScore = Math.min(100, (renterShare / 0.60) * 100);
    return Math.round((cbScore * 0.6 + renterScore * 0.4));
  }

  function scoreCaptureRisk(acs, existingUnits, proposedUnits) {
    var qualRenters = acs.renter_hh || 1;
    var capture = (existingUnits + proposedUnits) / qualRenters;
    // Lower capture → better (more head-room); invert
    var score = Math.max(0, Math.min(100, (1 - capture / 0.50) * 100));
    return { score: Math.round(score), capture: capture };
  }

  /**
   * Score rent pressure: how far market rents exceed 60% AMI affordable threshold.
   *
   * IMPORTANT: If countyAmi is not provided (e.g. county FIPS couldn't be
   * resolved from buffer tracts, or HudFmr data hasn't loaded), this returns
   * `unavailable: true` with score=null rather than silently substituting a
   * statewide AMI. CO AMI varies from ~$52k (rural counties) to ~$124k
   * (Denver MSA) — the statewide $95k default was systematically wrong by
   * ±30% for most CO counties and could invert the rent-pressure signal
   * (flagging affordable markets as pressured, or vice versa) in the
   * direction that matters most for LIHTC decisions. Surfacing unavailable
   * is more honest than fabricating a number.
   *
   * @param {Object} acs - Aggregated ACS tract metrics
   * @param {number} [countyAmi] - County-specific 4-person AMI
   * @returns {{ score: number|null, ratio: number, amiUsed: number|null, amiSource: string, unavailable: boolean }}
   */
  function scoreRentPressure(acs, countyAmi) {
    if (!countyAmi || countyAmi <= 0) {
      return { score: null, ratio: null, amiUsed: null, amiSource: 'unavailable', unavailable: true };
    }
    var ami60Rent = (countyAmi * AMI_60_PCT * MAX_AFFORDABLE_RENT_PCT) / 12;
    var ratio     = acs.median_gross_rent ? acs.median_gross_rent / ami60Rent : 0;
    // If market rent > affordable threshold, it signals unmet demand — higher score
    var score = Math.min(100, Math.max(0, (ratio - 0.70) / (1.50 - 0.70) * 100));
    return { score: Math.round(score), ratio: ratio, amiUsed: countyAmi, amiSource: 'county', unavailable: false };
  }

  /**
   * Market tightness score based on vacancy rate.
   * NOTE: This measures how fully-occupied the existing housing stock is.
   * It does NOT measure land availability for new construction.
   * Low vacancy = tight market = strong demand signal.
   * @param {Object} acs
   * @returns {number} 0-100 score
   */
  function scoreMarketTightness(acs) {
    var vac = acs.vacancy_rate || 0;
    // Very low vacancy → tight market → strong demand signal
    var score = Math.max(0, Math.min(100, (1 - vac / 0.12) * 100));
    return Math.round(score);
  }

  /**
   * Internal workforce scorer that also returns data-coverage metadata.
   * @private
   */
  function _scoreWorkforceWithCoverage(acs, lat, lon, bufTracts, countyAmi) {
    // Weighted composite workforce score (0–100) using 5 alternative data sources:
    //   25% LODES job accessibility
    //   25% ACS educational attainment + employment (proxied via ACS income/burden)
    //   20% CDLE vacancy rates (inverse: low vacancy = less workforce risk)
    //   15% CDE school quality proximity
    //   15% CDOT traffic connectivity

    var LODES  = window.LodesCommute;
    var CDLE   = window.CdleJobs;
    var CDE    = window.CdeSchools;
    var CDOT   = window.CdotTraffic;

    var realSources  = 0;
    var totalSources = 5;
    var reasons      = [];

    // ── 1. LODES job accessibility (25%) ────────────────────────────
    var lodesScore = 50; // FALLBACK: window.LodesCommute unavailable. Using neutral value 50 until data/market/lodes_co.json is loaded via lodes-commute.js.
    if (LODES) {
      var tractGeoids = (bufTracts || []).map(function (t) { return t.geoid; });
      var lodesAgg = LODES.aggregateForBuffer(tractGeoids);
      lodesScore = LODES.scoreJobAccessibility(lodesAgg);
      if (lodesAgg !== null && lodesAgg !== undefined) { realSources++; } else { reasons.push('LODES: no tract overlap found'); }
    } else {
      reasons.push('LODES: window.LodesCommute not loaded (data/market/lodes_co.json)');
    }

    // ── 2. ACS-based educational attainment + employment (25%) ──────
    // Proxy via median HH income relative to the COUNTY's AMI (not the
    // statewide AMI). A rural county with $55k median HH income and $52k
    // AMI has a strong workforce profile (106% of local AMI); dividing
    // that $55k by the statewide $95k AMI mis-computes the ratio as 58%
    // and mis-reports the tract as "low income." Require county AMI; if
    // unavailable, this sub-score is skipped (set to null) rather than
    // using a 50 neutral that silently inflates composite.
    var acsWfScore = null;
    var incomeRatio = null;
    if (acs && acs.median_hh_income && countyAmi && countyAmi > 0) {
      incomeRatio = Math.min(2.0, acs.median_hh_income / countyAmi);
      realSources++;
      // Scale 0–2 → 0–100, centred at 1.0
      acsWfScore = Math.min(100, Math.max(0, Math.round(incomeRatio * 60)));
    } else if (!countyAmi) {
      reasons.push('ACS workforce proxy: county AMI unresolved, sub-score excluded');
    } else if (!acs || !acs.median_hh_income) {
      reasons.push('ACS workforce proxy: median_hh_income absent, sub-score excluded');
    }

    // ── 3. CDLE vacancy rates (20%) — low vacancy = tight labour = risk ──
    var cdleScore = 50; // FALLBACK: window.CdleJobs unavailable. Using neutral value 50 until data/market/cdle_job_postings_co.json is loaded.
    if (CDLE && bufTracts && bufTracts.length) {
      var countyFips = {};
      bufTracts.forEach(function (t) { countyFips[t.geoid.slice(0, 5)] = true; });
      var cdleAgg = CDLE.aggregateForCounties(Object.keys(countyFips));
      cdleScore = CDLE.scoreVacancyRate(cdleAgg);
      realSources++;
    } else {
      reasons.push('CDLE: window.CdleJobs not loaded (data/market/cdle_job_postings_co.json)');
    }

    // ── 4. CDE school quality proximity (15%) ───────────────────────
    var cdeScore = 55; // FALLBACK: window.CdeSchools unavailable. Using neutral value 55 until data/market/cde_schools_co.json is loaded.
    if (CDE && lat != null && lon != null) {
      var nearest = CDE.getNearestDistrict(lat, lon);
      cdeScore = CDE.scoreSchoolQuality(nearest ? { avg_quality_score: nearest.composite_quality_score } : null);
      realSources++;
    } else {
      reasons.push('CDE: window.CdeSchools not loaded (data/market/cde_schools_co.json)');
    }

    // ── 5. CDOT traffic connectivity (15%) ──────────────────────────
    var cdotScore = 40; // FALLBACK: window.CdotTraffic unavailable. Using neutral value 40 until data/market/cdot_traffic_co.json is loaded.
    if (CDOT && lat != null && lon != null) {
      var trafficAgg = CDOT.aggregateForBuffer(lat, lon, bufferMiles);
      cdotScore = CDOT.scoreTrafficConnectivity(trafficAgg);
      realSources++;
    } else {
      reasons.push('CDOT: window.CdotTraffic not loaded (data/market/cdot_traffic_co.json)');
    }

    // Redistribute the ACS workforce sub-weight (0.25) across the remaining
    // 4 sources when it's null (county AMI unresolved or median HH income
    // missing). Prior code used a 50-neutral which silently inflated every
    // tract's workforce score whenever ACS AMI data was missing.
    var composite;
    if (acsWfScore == null) {
      var remaining = 0.25 + 0.20 + 0.15 + 0.15; // 0.75
      composite = Math.round(
        (lodesScore * 0.25 +
         cdleScore  * 0.20 +
         cdeScore   * 0.15 +
         cdotScore  * 0.15) / remaining
      );
    } else {
      composite = Math.round(
        lodesScore  * 0.25 +
        acsWfScore  * 0.25 +
        cdleScore   * 0.20 +
        cdeScore    * 0.15 +
        cdotScore   * 0.15
      );
    }

    var score = Math.min(100, Math.max(0, composite));
    var coverageLevel = realSources === totalSources ? 'full'
      : realSources > 0 ? 'partial'
      : 'fallback';

    return { score: score, coverageLevel: coverageLevel, reasons: reasons };
  }

  function scoreWorkforce(acs, lat, lon, bufTracts, countyAmi) {
    return _scoreWorkforceWithCoverage(acs, lat, lon, bufTracts, countyAmi).score;
  }

  /**
   * Compute LIHTC recency context from nearby features. A market with its
   * last allocation in 2018 reads very differently from one last funded
   * in 2024 — CHFA geographic-distribution scoring and competitive
   * saturation both depend on this temporal signal, which prior PMA
   * scoring ignored entirely.
   *
   * @param {Array} nearbyFeatures - LIHTC GeoJSON features from lihtcInBuffer
   * @returns {{mostRecentYear:number|null, yearsSince:number|null, recentAllocations5yr:number, activityLevel:string, note:string|null}}
   */
  function _computeLihtcRecency(nearbyFeatures) {
    var currentYear = new Date().getFullYear();
    var years = (nearbyFeatures || []).map(function (f) {
      var p = (f && f.properties) || {};
      // Prefer YR_ALLOC (when CHFA awarded credits) over YR_PIS (placed-in-service).
      // YR_ALLOC reflects CHFA decision timing; YR_PIS lags 18-30 months.
      return parseInt(p.YR_ALLOC || p.YR_PIS || p.yearAllocated || p.yearPlaced || 0, 10);
    }).filter(function (y) { return y > 1985 && y <= currentYear; });

    if (!years.length) {
      return {
        mostRecentYear: null,
        yearsSince: null,
        recentAllocations5yr: 0,
        activityLevel: 'no-data',
        note: null
      };
    }

    var mostRecent = Math.max.apply(null, years);
    var yearsSince = currentYear - mostRecent;
    var recent5yr = years.filter(function (y) { return currentYear - y <= 5; }).length;

    // Activity labels:
    //  - 'very-active': 3+ allocations in last 5 years (saturation risk; CHFA
    //    geographic-distribution rules may penalize additional deals)
    //  - 'active': 1-2 allocations in last 5 years (normal activity)
    //  - 'quiet': last allocation 6-10 years ago (gap; opportunity)
    //  - 'dormant': 11+ years since last allocation (deep gap; CHFA may
    //    prioritize for geographic equity)
    var activityLevel, note;
    if (recent5yr >= 3) {
      activityLevel = 'very-active';
      note = recent5yr + ' LIHTC allocations within the PMA in the last 5 years. ' +
        'CHFA geographic-distribution scoring may limit further awards; check QAP §6.c.';
    } else if (recent5yr >= 1) {
      activityLevel = 'active';
      note = 'Most recent LIHTC allocation: ' + mostRecent + ' (' + yearsSince + ' yr' +
        (yearsSince === 1 ? '' : 's') + ' ago). Market has active LIHTC pipeline.';
    } else if (yearsSince <= 10) {
      activityLevel = 'quiet';
      note = 'No LIHTC allocations in the last 5 years (most recent: ' + mostRecent + '). ' +
        'Possible unmet-demand signal; verify against HNA gap data.';
    } else {
      activityLevel = 'dormant';
      note = 'No LIHTC allocations in the last 10+ years (most recent: ' + mostRecent + '). ' +
        'Significant gap — CHFA may favor geographic-equity scoring for this area.';
    }

    return {
      mostRecentYear: mostRecent,
      yearsSince: yearsSince,
      recentAllocations5yr: recent5yr,
      activityLevel: activityLevel,
      note: note
    };
  }

  function computePma(acs, existingLihtcUnits, proposedUnits, lat, lon, bufTracts, countyAmi, nearbyLihtcFeatures) {
    proposedUnits = proposedUnits || 0;

    var demandScore        = scoreDemand(acs);
    var captureObj         = scoreCaptureRisk(acs, existingLihtcUnits, proposedUnits);
    var rentPressureObj    = scoreRentPressure(acs, countyAmi);
    var lihtcRecency       = _computeLihtcRecency(nearbyLihtcFeatures);
    // Market tightness score (vacancy-based demand signal — NOT land availability)
    var _bridgeLandCtx = (window.BridgeMarketSummary && window.BridgeMarketSummary.isAvailable())
      ? window.BridgeMarketSummary.getLandCostContext(lat, lon)
      : null;
    var SSS = window.SiteSelectionScore || {};
    // scoreLandSupplyWithBridge now returns { score, unavailable } per the
    // null-propagation refactor — unwrap defensively. If the Bridge path
    // reports unavailable (ACS missing), fall back to the local
    // scoreMarketTightness which accepts a defaulted vacancy_rate.
    var _landResult = (SSS.scoreLandSupplyWithBridge && _bridgeLandCtx)
      ? SSS.scoreLandSupplyWithBridge(acs, _bridgeLandCtx)
      : null;
    var marketTightnessScore;
    if (_landResult && !_landResult.unavailable && typeof _landResult.score === 'number') {
      marketTightnessScore = _landResult.score;
    } else {
      marketTightnessScore = scoreMarketTightness(acs);
    }

    // Enhance market score with Bridge transaction velocity
    var _bridgeVelCtx = (window.BridgeMarketSummary && window.BridgeMarketSummary.isAvailable())
      ? window.BridgeMarketSummary.getMarketVelocity(lat, lon)
      : null;
    var wfResult           = _scoreWorkforceWithCoverage(acs, lat, lon, bufTracts, countyAmi);
    var workforceScore     = wfResult.score;

    // Bridge market velocity (used in result metadata)
    var _bridgeVelocityLabel = _bridgeVelCtx ? _bridgeVelCtx.label : 'unknown';

    // When rent-pressure is unavailable (county AMI not resolved), redistribute
    // its weight proportionally across the remaining dimensions rather than
    // scoring it as 0 — a 0 would deflate overall by ~15 pts for every site
    // where county FIPS resolution failed.
    var overall;
    if (rentPressureObj.unavailable) {
      var remainingWeightSum = WEIGHTS.demand + WEIGHTS.captureRisk + WEIGHTS.landSupply + WEIGHTS.workforce;
      overall = Math.round(
        (demandScore          * WEIGHTS.demand +
         captureObj.score     * WEIGHTS.captureRisk +
         marketTightnessScore * WEIGHTS.landSupply +
         workforceScore       * WEIGHTS.workforce) / remainingWeightSum
      );
    } else {
      overall = Math.round(
        demandScore          * WEIGHTS.demand +
        captureObj.score     * WEIGHTS.captureRisk +
        rentPressureObj.score * WEIGHTS.rentPressure +
        marketTightnessScore * WEIGHTS.landSupply +
        workforceScore       * WEIGHTS.workforce
      );
    }

    var flags = [];
    if ((acs.cost_burden_rate || 0) >= RISK.costBurdenHigh) {
      flags.push({ level: 'bad', text: 'High cost-burden pressure (≥45%)' });
    }
    if (captureObj.capture >= RISK.captureHigh) {
      flags.push({ level: 'warn', text: 'High capture risk (≥25% of qualified renters)' });
    }
    if (!rentPressureObj.unavailable && rentPressureObj.ratio >= RISK.rentPressureElev) {
      flags.push({ level: 'warn', text: 'Elevated rent pressure (market ÷ affordable ≥ 1.10)' });
    }
    if (rentPressureObj.unavailable) {
      flags.push({ level: 'warn', text: 'Rent-pressure score unavailable — county AMI could not be resolved (buffer crosses ambiguous county lines, or HUD FMR data not loaded)' });
    }

    // LIHTC recency flags — surface competitive saturation vs. gap signals
    // that CHFA's geographic-distribution scoring explicitly considers
    // but which prior PMA scoring ignored entirely.
    if (lihtcRecency.activityLevel === 'very-active') {
      flags.push({ level: 'warn', text: lihtcRecency.note });
    } else if (lihtcRecency.activityLevel === 'dormant') {
      flags.push({ level: 'ok', text: lihtcRecency.note });
    }

    if (!flags.length) {
      flags.push({ level: 'ok', text: 'No critical risk flags detected' });
    }

    // ── Build data coverage diagnostic ────────────────────────────────
    var fallbackReasons = {};
    if (wfResult.reasons.length) fallbackReasons.workforce = wfResult.reasons.join('; ');

    var demandCoverage;
    if (!acs) {
      demandCoverage = 'fallback';
      fallbackReasons.demand = 'No ACS data available (data/market/acs_tract_metrics_co.json)';
    } else if (acs.cost_burden_rate != null && acs.renter_hh != null && acs.total_hh != null) {
      demandCoverage = 'full';
    } else {
      demandCoverage = 'partial';
      fallbackReasons.demand = 'ACS present but missing cost_burden_rate or renter_hh/total_hh fields';
    }

    var captureRiskCoverage;
    if (!acs || acs.renter_hh == null) {
      captureRiskCoverage = 'fallback';
      fallbackReasons.capture_risk = 'ACS renter_hh missing; capture denominator defaulted to 1';
    } else {
      captureRiskCoverage = 'full';
    }

    var rentPressureCoverage;
    if (rentPressureObj.unavailable) {
      rentPressureCoverage = 'unavailable';
      fallbackReasons.rent_pressure = 'County 4-person AMI could not be resolved from HUD FMR data; rent-pressure dimension excluded from overall (weight redistributed)';
    } else if (!acs || acs.median_gross_rent == null) {
      rentPressureCoverage = 'fallback';
      fallbackReasons.rent_pressure = 'ACS median_gross_rent missing; rent ratio defaulted to 0';
    } else {
      rentPressureCoverage = 'full';
    }

    var marketTightnessCoverage;
    if (!acs || acs.vacancy_rate == null) {
      marketTightnessCoverage = 'fallback';
      fallbackReasons.market_tightness = 'ACS vacancy_rate missing; defaulted to 0';
    } else {
      marketTightnessCoverage = 'full';
    }

    var pmaDataCoverage = {
      demand:            demandCoverage,
      capture_risk:      captureRiskCoverage,
      rent_pressure:     rentPressureCoverage,
      market_tightness:  marketTightnessCoverage,
      // Backward compat alias
      land_supply:       marketTightnessCoverage,
      workforce:         wfResult.coverageLevel
    };

    return {
      overall:       Math.min(100, Math.max(0, overall)),
      dimensions: {
        demand:           demandScore,
        captureRisk:      captureObj.score,
        rentPressure:     rentPressureObj.score,
        marketTightness:  marketTightnessScore,
        // Backward compat alias — downstream may reference landSupply
        landSupply:       marketTightnessScore,
        workforce:        workforceScore
      },
      // User-facing labels for each dimension (used by renderers)
      dimensionLabels: {
        demand:          'Demand',
        captureRisk:     'Competitive Density',
        rentPressure:    'Rent Pressure',
        marketTightness: 'Market Tightness',
        workforce:       'Workforce'
      },
      // Proxy disclosures — what each metric actually measures
      dimensionNotes: {
        captureRisk:     'Ratio of total affordable units to renter households in buffer — not a traditional capture rate based on income-qualified annual demand',
        marketTightness: 'Vacancy rate signal — measures how fully occupied existing stock is, NOT land availability for new construction',
        rentPressure:    rentPressureObj.unavailable
          ? 'Rent-pressure score unavailable — county 4-person AMI could not be resolved. Dimension excluded from overall.'
          : 'Market rent vs. 60% AMI affordable rent threshold (county AMI: $' + rentPressureObj.amiUsed.toLocaleString() + ')'
      },
      dimensionDataAvailable: {
        demand:          demandCoverage !== 'fallback',
        captureRisk:     captureRiskCoverage !== 'fallback',
        // `rentPressureCoverage` is now 'unavailable' (county AMI missing),
        // 'fallback' (ACS missing), or 'full'. Only 'full' counts as available.
        rentPressure:    rentPressureCoverage === 'full',
        marketTightness: marketTightnessCoverage !== 'fallback',
        landSupply:      marketTightnessCoverage !== 'fallback',
        workforce:       wfResult.coverageLevel !== 'fallback'
      },
      capture:         captureObj.capture,
      rentRatio:       rentPressureObj.ratio,
      amiUsed:         rentPressureObj.amiUsed,
      amiSource:       rentPressureObj.amiSource,
      flags:           flags,
      pma_data_coverage: pmaDataCoverage,
      fallback_reasons:  fallbackReasons,
      bridgeLandContext:  _bridgeLandCtx,
      bridgeVelocity:    _bridgeVelCtx,
      lihtcRecency:      lihtcRecency
    };
  }

  /* ── Capture-rate simulator ─────────────────────────────────────── */
  function simulateCapture(qualRenters, proposedUnits, amiMix) {
    // amiMix: { ami30: n, ami40: n, ami50: n, ami60: n, ami80: n }
    var totalProposed = Object.values(amiMix).reduce(function (s, v) { return s + (v || 0); }, 0);
    if (totalProposed > 0) proposedUnits = totalProposed;
    var capture = qualRenters > 0 ? proposedUnits / qualRenters : 0;
    var captureRate = Math.round(capture * 1000) / 10; // pct, 1 decimal
    var risk = capture >= RISK.captureHigh ? 'High' : (capture >= 0.15 ? 'Moderate' : 'Low');
    return { proposedUnits: proposedUnits, captureRate: captureRate, risk: risk };
  }

  /* ── Tier label ─────────────────────────────────────────────────── */
  function scoreTier(s) {
    if (s >= 80) return { label: 'Strong',   color: 'var(--good)' };
    if (s >= 60) return { label: 'Moderate', color: 'var(--accent)' };
    if (s >= 40) return { label: 'Marginal', color: 'var(--warn)' };
    return           { label: 'Weak',     color: 'var(--bad)' };
  }

  /* ── UI helpers ─────────────────────────────────────────────────── */
  function el(id) { return document.getElementById(id); }

  function _cap(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function setHtml(id, html) {
    var e = el(id);
    if (e) e.innerHTML = html;
  }

  function setText(id, txt) {
    var e = el(id);
    if (e) e.textContent = txt;
  }

  function showEmpty(id, msg) {
    setHtml(id, '<div class="pma-empty">' + (msg || 'Click the map to set a site location.') + '</div>');
  }

  /* ── Render results ─────────────────────────────────────────────── */
  function renderScore(result) {
    var tier = scoreTier(result.overall);
    var scoreEl = el('pmaScoreCircle');
    if (scoreEl) {
      scoreEl.textContent = result.overall;
      scoreEl.style.borderColor = tier.color;
      // Use a CSS-variable-aware dim background defined per tier
      var tierDimVar = { Strong: '--good-dim', Moderate: '--accent-dim', Marginal: '--warn-dim', Weak: '--bad-dim' };
      var dimVar = tierDimVar[tier.label] || '--accent-dim';
      scoreEl.style.background = 'var(' + dimVar + ')';
    }
    setText('pmaScoreTier', tier.label + ' Site');
    setText('pmaTractCount', result.tractCount || '—');

    // Fallback disclosure: warn when dimensions lack real data
    var _dimAvailCheck = result.dimensionDataAvailable || {};
    var _dimKeysCheck  = ['demand', 'captureRisk', 'rentPressure', 'marketTightness', 'workforce'];
    var fallbackCount  = _dimKeysCheck.filter(function (k) { return _dimAvailCheck[k] === false; }).length;
    var fallbackNoteEl = el('pmaFallbackNote');
    if (!fallbackNoteEl) {
      // Create the warning container once, right after the score tier element
      var tierEl = el('pmaScoreTier');
      if (tierEl && tierEl.parentNode) {
        fallbackNoteEl = document.createElement('div');
        fallbackNoteEl.id = 'pmaFallbackNote';
        fallbackNoteEl.style.cssText = 'margin-top:.4rem;font-size:.78rem;line-height:1.4;padding:.35rem .5rem;border-radius:4px;display:none';
        tierEl.parentNode.insertBefore(fallbackNoteEl, tierEl.nextSibling);
      }
    }
    if (fallbackNoteEl) {
      if (fallbackCount >= 3) {
        fallbackNoteEl.style.display = 'block';
        fallbackNoteEl.style.background = 'rgba(192,57,43,.12)';
        fallbackNoteEl.style.border = '1px solid var(--bad, #c0392b)';
        fallbackNoteEl.style.color = 'var(--bad, #c0392b)';
        fallbackNoteEl.innerHTML = '\u26A0 This score is preliminary — ' + fallbackCount +
          ' of 5 dimensions lack data for this location.';
      } else if (fallbackCount >= 1) {
        fallbackNoteEl.style.display = 'block';
        fallbackNoteEl.style.background = 'rgba(230,162,60,.12)';
        fallbackNoteEl.style.border = '1px solid var(--warn, #e6a23c)';
        fallbackNoteEl.style.color = 'var(--warn-text, #8a6914)';
        fallbackNoteEl.innerHTML = 'Note: ' + fallbackCount +
          ' dimension' + (fallbackCount > 1 ? 's' : '') +
          ' using estimated defaults. See breakdown below.';
      } else {
        fallbackNoteEl.style.display = 'none';
        fallbackNoteEl.innerHTML = '';
      }
    }

    var dims = result.dimensions;
    var dimAvail = result.dimensionDataAvailable || {};
    var dimNames  = ['demand', 'captureRisk', 'rentPressure', 'marketTightness', 'workforce'];
    var dimLabels = ['Demand', 'Competitive Density', 'Rent Pressure', 'Market Tightness', 'Workforce'];
    var dimDescs  = [
      'Income-qualified renter demand within the buffer. Higher = more households at LIHTC-eligible incomes relative to existing supply.',
      'Ratio of total affordable units to renter households — not a traditional capture rate. Lower density = higher score.',
      'Upward pressure on market rents vs. AMI-restricted limits. High rent pressure = strong affordability gap and demand for restricted units.',
      'How fully occupied existing housing stock is (vacancy signal). Low vacancy = tight market = strong demand. This does NOT measure land availability for new construction.',
      'Workforce housing alignment: commuting patterns, major employer proximity, and job-to-housing ratio within the buffer.'
    ];
    // Per-dimension verify hints — surfaced below each bar when real data is present.
    // Links point to the authoritative source users should cross-check.
    var dimVerify = {
      captureRisk:     '⚠ Verify: ratio only — <a href="https://www.chfainfo.com/developers/rental-housing-and-funding" target="_blank" rel="noopener">CHFA market analysis</a> requires income-qualified demand study',
      rentPressure:    '⚠ Verify: <a href="https://www.huduser.gov/portal/datasets/fmr.html" target="_blank" rel="noopener">HUD FMR</a> (lags ~18 mo) · spot-check vs. current market rents',
      marketTightness: '⚠ Verify: ACS 5-yr vacancy (lags ~18 mo) · does not reflect buildable-land constraints'
    };
    var listEl = el('pmaDimList');
    if (listEl) {
      listEl.innerHTML = dimNames.map(function (k, i) {
        var s = dims[k] || 0;
        var hasData = dimAvail[k] !== false;
        var barColor = !hasData ? 'var(--muted, #666)' :
          s >= 70 ? 'var(--good)' : s >= 45 ? 'var(--accent)' : s >= 25 ? 'var(--warn)' : 'var(--bad)';
        var barOpacity = hasData ? '1' : '0.4';
        var stubLabel = hasData ? '' :
          ' <span style="font-size:.7em;color:var(--warn,#c0392b);font-weight:600;margin-left:.25rem" ' +
          'title="Score based on fallback defaults — real data not available">(estimated)</span>';
        var verifyHint = (hasData && dimVerify[k])
          ? '<span class="kpi-source kpi-verify" style="display:block;margin-top:.25rem;font-size:.68rem">' + dimVerify[k] + '</span>'
          : '';
        return '<li class="pma-dim-item" title="' + dimDescs[i].replace(/"/g, '&quot;') + '">' +
          '<span class="pma-dim-name">' + dimLabels[i] + stubLabel +
            '<span class="pma-dim-info" aria-hidden="true" title="' + dimDescs[i].replace(/"/g, '&quot;') + '">ⓘ</span>' +
          '</span>' +
          '<div class="pma-dim-bar-wrap" style="flex:1">' +
            '<div class="pma-dim-bar" style="width:' + s + '%;background:' + barColor + ';opacity:' + barOpacity + '"></div>' +
            verifyHint +
          '</div>' +
          '<span class="pma-dim-score" style="' + (hasData ? '' : 'color:var(--muted,#666);font-style:italic') + '">' +
            (hasData ? s : '<abbr title="No data available for this dimension" style="text-decoration:none;cursor:help">\u2014</abbr>' +
              ' <span style="font-size:.65em;color:var(--muted,#888)">(no data)</span>') +
          '</span>' +
        '</li>';
      }).join('') +
      '<li style="margin-top:.5rem;padding:.5rem .3rem;border-top:1px solid var(--border)">' +
        '<details style="font-size:.75rem;color:var(--muted)">' +
          '<summary style="cursor:pointer;font-weight:600;color:var(--text)">What do these scores mean?</summary>' +
          '<dl style="margin:.4rem 0 0;display:flex;flex-direction:column;gap:.35rem">' +
            dimNames.map(function (k, i) {
              return '<div><dt style="font-weight:600;color:var(--text)">' + dimLabels[i] + '</dt>' +
                     '<dd style="margin:0;color:var(--muted)">' + dimDescs[i] + '</dd></div>';
            }).join('') +
            '<div><dt style="font-weight:600;color:var(--text)">Score range</dt>' +
              '<dd style="margin:0;color:var(--muted)">0–100. ' +
                '<span style="color:var(--good)">■ 70–100 Strong</span> · ' +
                '<span style="color:var(--accent)">■ 45–69 Moderate</span> · ' +
                '<span style="color:var(--warn)">■ 25–44 Marginal</span> · ' +
                '<span style="color:var(--bad)">■ 0–24 Weak</span>' +
              '</dd></div>' +
            '<div><dt style="font-weight:600;color:var(--warn,#c0392b)">* Estimated scores</dt>' +
              '<dd style="margin:0;color:var(--muted)">Scores marked with * or (estimated) are based on ' +
                'fallback defaults because real data was not available. Check the Data Coverage panel below ' +
                'for details on which data sources are live vs. unavailable.</dd></div>' +
          '</dl>' +
        '</details>' +
      '</li>';
    }

    // Bridge market context card
    if (result.bridgeLandContext || result.bridgeVelocity) {
      var bridgeCardEl = el('pmaBridgeContext');
      if (bridgeCardEl) {
        var lc = result.bridgeLandContext || {};
        var mv = result.bridgeVelocity || {};
        var tierColor = lc.tier === 'low' ? 'var(--good)' : lc.tier === 'high' ? 'var(--bad)' : 'var(--accent)';
        bridgeCardEl.innerHTML =
          '<div style="font-size:.78rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.4rem">Market Context · Bridge Data</div>' +
          '<div style="display:flex;gap:.75rem;flex-wrap:wrap">' +
            (lc.tier ? '<span style="background:' + tierColor + ';color:#fff;padding:2px 8px;border-radius:10px;font-size:.75rem;font-weight:600">Land: ' + lc.tier.charAt(0).toUpperCase() + lc.tier.slice(1) + ' cost</span>' : '') +
            (lc.regionName ? '<span style="font-size:.78rem;color:var(--muted)">' + lc.regionName + '</span>' : '') +
            (mv.label && mv.label !== 'unknown' ? '<span style="font-size:.78rem;color:var(--muted)">Market: ' + mv.label + '</span>' : '') +
            (lc.isRural ? '<span style="background:var(--accent);color:#fff;padding:2px 7px;border-radius:10px;font-size:.75rem;font-weight:600">Rural market</span>' : '') +
          '</div>' +
          (lc.note ? '<div style="font-size:.75rem;color:var(--muted);margin-top:.3rem">' + lc.note + '</div>' : '');
        bridgeCardEl.style.display = '';
      }
    }

    var flagsEl = el('pmaFlags');
    if (flagsEl) {
      flagsEl.innerHTML = result.flags.map(function (f) {
        return '<div class="pma-flag pma-flag-' + f.level + '">' +
          (f.level === 'ok' ? '✓ ' : f.level === 'warn' ? '⚠ ' : '✕ ') +
          f.text + '</div>';
      }).join('');
    }

    setText('pmaLihtcCount', result.lihtcCount);
    setText('pmaLihtcUnits', result.lihtcUnits);
    setText('pmaCaptureRate', (result.capture * 100).toFixed(1) + '%');
    setText('pmaRenterHh', (result.acs.renter_hh || 0).toLocaleString());
    setText('pmaLihtcProp123', result.prop123Count != null ? result.prop123Count : '—');

    // Surface LIHTC recency — CHFA scoring considers last-funded-year;
    // "last funded 2018 (7 yrs ago)" is a meaningfully different signal
    // than "last funded 2024 (1 yr ago)" for both competitive saturation
    // and geographic-distribution scoring.
    var rec = result.lihtcRecency;
    if (rec && rec.mostRecentYear != null) {
      setText('pmaLihtcLastFunded',
        rec.mostRecentYear + ' (' + rec.yearsSince + ' yr' +
        (rec.yearsSince === 1 ? '' : 's') + ' ago' +
        (rec.recentAllocations5yr > 0 ? ', ' + rec.recentAllocations5yr + ' in last 5 yrs' : '') +
        ')'
      );
    } else {
      setText('pmaLihtcLastFunded', 'No prior LIHTC in buffer');
    }

    renderDataCoverage(result);
    updateRadarChart(result.dimensions, result.dimensionDataAvailable);
    updateSimulator(result);
    renderBenchmark(result);
    renderPipeline(result);
    renderScenarios(result);
  }

  /* ── Data Coverage panel ────────────────────────────────────────── */
  function renderDataCoverage(result) {
    var coverageEl = el('pmaDataCoverage');
    if (!coverageEl) return;

    var cov     = result.pma_data_coverage;
    var reasons = result.fallback_reasons || {};
    if (!cov) {
      coverageEl.innerHTML = '<div class="pma-empty">Coverage data not available.</div>';
      return;
    }

    var COLOR = { full: 'var(--good)', partial: 'var(--warn)', fallback: 'var(--bad)' };
    var ICON  = { full: '✓', partial: '~', fallback: '✕' };

    var dims = [
      { key: 'demand',       label: 'Demand' },
      { key: 'capture_risk', label: 'Competitive Density' },
      { key: 'rent_pressure',label: 'Rent Pressure' },
      { key: 'land_supply',  label: 'Market Tightness' },
      { key: 'workforce',    label: 'Workforce' }
    ];

    var rows = dims.map(function (d) {
      var level  = cov[d.key] || 'fallback';
      var reason = reasons[d.key] ? ' — ' + reasons[d.key] : '';
      return '<tr>' +
        '<td style="padding:.15rem .4rem;color:var(--faint)">' + d.label + '</td>' +
        '<td style="padding:.15rem .4rem;font-weight:600;color:' + (COLOR[level] || '') + '">' + ICON[level] + ' ' + level + '</td>' +
        '<td style="padding:.15rem .4rem;font-size:.78em;color:var(--faint)">' + reason + '</td>' +
      '</tr>';
    }).join('');

    // Enhanced pipeline data sources (from PMA Analysis Runner)
    var pipelineSources = [
      { label: 'Transit Routes', source: result._transitDataSource || null },
      { label: 'EPA Walkability', source: result._epaDataSource || null },
      { label: 'HUD AFFH', source: null },
      { label: 'HUD Opp. Atlas', source: null },
      { label: 'Utility Capacity', source: null },
      { label: 'USDA Food Access', source: null }
    ];

    // Derive source info from the analysis runner results if available
    var ar = result._analysisResults || {};
    if (ar.transit) {
      pipelineSources[0].source = ar.transit._ntdDataSource || (ar.transit.nearbyRouteCount > 0 ? 'local-gtfs' : 'stub');
      pipelineSources[1].source = ar.transit._epaDataSource || (ar.transit.epaDataAvailable ? 'epa-live' : 'unavailable');
    }
    if (ar.opportunities && ar.opportunities._dataSources) {
      pipelineSources[2].source = ar.opportunities._dataSources.affh || 'unavailable';
      pipelineSources[3].source = ar.opportunities._dataSources.atlas || 'unavailable';
    }
    if (ar.infrastructure && ar.infrastructure._dataAvailability) {
      var infraAvail = ar.infrastructure._dataAvailability;
      pipelineSources[4].source = infraAvail.stubSources.indexOf('utility') === -1 ? 'live' : 'unavailable';
      pipelineSources[5].source = infraAvail.stubSources.indexOf('foodAccess') === -1 ? 'live' : 'unavailable';
    }

    var pipelineRows = pipelineSources.map(function (ps) {
      var src = ps.source || 'unavailable';
      var isLive = src === 'live' || src === 'local-gtfs' || src === 'epa-live';
      var levelStr = isLive ? 'live' : (src === 'stub' ? 'stub' : 'unavailable');
      var icon = isLive ? '✓' : '—';
      var color = isLive ? 'var(--good)' : 'var(--muted, #888)';
      var note = isLive ? src : 'Data not available';
      return '<tr>' +
        '<td style="padding:.15rem .4rem;color:var(--faint)">' + ps.label + '</td>' +
        '<td style="padding:.15rem .4rem;font-weight:600;color:' + color + '">' + icon + ' ' + levelStr + '</td>' +
        '<td style="padding:.15rem .4rem;font-size:.78em;color:var(--faint)">' + note + '</td>' +
      '</tr>';
    }).join('');

    var fallbackNote = '';
    var fallbackCount = dims.filter(function (d) { return (cov[d.key] || 'fallback') === 'fallback'; }).length;
    var pipelineUnavail = pipelineSources.filter(function (ps) {
      var src = ps.source || 'unavailable';
      return src === 'unavailable' || src === 'stub' || !src;
    }).length;
    if (fallbackCount > 0 || pipelineUnavail > 0) {
      fallbackNote = '<p style="margin:.5rem 0 0;font-size:.75em;color:var(--warn,#c0392b);font-style:italic;">' +
        'Scores marked (est.) or with unavailable data sources use default assumptions. ' +
        'See fallback reasons above for details.</p>';
    }

    coverageEl.innerHTML =
      '<table style="width:100%;border-collapse:collapse;font-size:.82em">' +
        '<thead><tr>' +
          '<th style="text-align:left;padding:.15rem .4rem;color:var(--faint);font-weight:400">Dimension</th>' +
          '<th style="text-align:left;padding:.15rem .4rem;color:var(--faint);font-weight:400">Coverage</th>' +
          '<th style="text-align:left;padding:.15rem .4rem;color:var(--faint);font-weight:400">Notes</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '<h5 style="margin:.75rem 0 .25rem;font-size:.82em;color:var(--faint)">Enhanced Pipeline Sources</h5>' +
      '<table style="width:100%;border-collapse:collapse;font-size:.82em">' +
        '<tbody>' + pipelineRows + '</tbody>' +
      '</table>' +
      fallbackNote;
  }

  /* ── Radar chart ─────────────────────────────────────────────────── */
  var radarChart = null;

  function updateRadarChart(dims, dimAvail) {
    var canvas = el('pmaRadarChart');
    if (!canvas || !window.Chart) return;

    dimAvail = dimAvail || {};
    var dimKeys = ['demand', 'captureRisk', 'rentPressure', 'marketTightness', 'workforce'];
    var data = [
      dims.demand,
      dims.captureRisk,
      dims.rentPressure,
      dims.marketTightness || dims.landSupply,
      dims.workforce
    ];

    // Per-point colors: muted for estimated, accent for real data
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--accent').trim() || '#0a7e74';
    var muted  = cs.getPropertyValue('--muted').trim()  || '#476080';
    var border = cs.getPropertyValue('--border').trim() || 'rgba(13,31,53,.11)';
    var warnColor = cs.getPropertyValue('--warn').trim() || '#c0392b';

    var pointColors = dimKeys.map(function (k) {
      return dimAvail[k] !== false ? accent : (muted || '#999');
    });
    var pointStyles = dimKeys.map(function (k) {
      return dimAvail[k] !== false ? 'circle' : 'triangle';
    });
    var pointRadii = dimKeys.map(function (k) {
      return dimAvail[k] !== false ? 3 : 5;
    });

    // Labels: append "(est.)" for estimated dimensions
    var labels = ['Demand', 'Competitive Density', 'Rent Pressure', 'Market Tightness', 'Workforce'].map(function (lbl, i) {
      return dimAvail[dimKeys[i]] !== false ? lbl : lbl + ' (est.)';
    });

    if (radarChart) {
      radarChart.data.labels = labels;
      radarChart.data.datasets[0].data = data;
      radarChart.data.datasets[0].pointBackgroundColor = pointColors;
      radarChart.data.datasets[0].pointStyle = pointStyles;
      radarChart.data.datasets[0].pointRadius = pointRadii;
      radarChart.update();
      return;
    }
    radarChart = new window.Chart(canvas, {
      type: 'radar',
      data: {
        labels: labels,
        datasets: [{
          label: 'PMA Score',
          data: data,
          borderColor: accent,
          backgroundColor: 'rgba(14,165,160,.15)',
          pointBackgroundColor: pointColors,
          pointStyle: pointStyles,
          pointRadius: pointRadii,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        scales: {
          r: {
            min: 0, max: 100,
            ticks: { stepSize: 25, color: muted, font: { size: 10 } },
            grid: { color: border },
            pointLabels: { color: muted, font: { size: 11 } }
          }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }

  /* ── Capture-rate simulator UI ───────────────────────────────────── */
  function updateSimulator(result) {
    var simEl = el('pmaSimResult');
    if (!simEl) return;

    var proposed = parseInt(el('pmaProposedUnits') && el('pmaProposedUnits').value, 10) || 100;
    var amiMix = {
      ami30: parseInt(el('pmaAmi30') && el('pmaAmi30').value, 10) || 0,
      ami40: parseInt(el('pmaAmi40') && el('pmaAmi40').value, 10) || 0,
      ami50: parseInt(el('pmaAmi50') && el('pmaAmi50').value, 10) || 0,
      ami60: parseInt(el('pmaAmi60') && el('pmaAmi60').value, 10) || proposed,
      ami80: parseInt(el('pmaAmi80') && el('pmaAmi80').value, 10) || 0
    };

    var sim = simulateCapture(result.acs.renter_hh || 1, proposed, amiMix);
    simEl.innerHTML =
      '<div class="pma-stat-grid">' +
        '<div class="pma-stat"><div class="pma-stat-value">' + sim.proposedUnits + '</div><div class="pma-stat-label">Proposed units</div></div>' +
        '<div class="pma-stat"><div class="pma-stat-value">' + sim.captureRate + '%</div><div class="pma-stat-label">Capture rate</div></div>' +
        '<div class="pma-stat"><div class="pma-stat-value" style="color:' +
          (sim.risk === 'High' ? 'var(--bad)' : sim.risk === 'Moderate' ? 'var(--warn)' : 'var(--good)') + '">' +
          sim.risk + '</div><div class="pma-stat-label">Risk level</div></div>' +
        '<div class="pma-stat"><div class="pma-stat-value">' + (result.acs.renter_hh || 0).toLocaleString() + '</div><div class="pma-stat-label">Renter HH (buffer)</div></div>' +
      '</div>';
  }

  /* ── Peer Benchmarking render ────────────────────────────────────── */
  function renderBenchmark(result) {
    var el2 = el('pmaBenchmarkResult');
    if (!el2) return;
    var ENH = window.PMAEnhancements;
    if (!ENH) { el2.innerHTML = '<div class="pma-empty">Enhancement module not loaded.</div>'; return; }

    var refProjects = referenceProjects && referenceProjects.projects ? referenceProjects.projects : [];
    var bench = ENH.benchmarkVsReference(result.overall, result, refProjects);
    lastBenchmark = bench;

    if (!bench.available) {
      el2.innerHTML = '<div class="pma-empty">' + (bench.reason || 'Reference data unavailable.') + '</div>';
      return;
    }

    var tier = bench.tier;
    var rows = bench.comparable.slice(0, 3).map(function (p) {
      return '<tr>' +
        '<td style="padding:0.25rem 0.4rem">' + (p.name || '—') + '</td>' +
        '<td style="padding:0.25rem 0.4rem;text-align:center">' + (p.city || '—') + '</td>' +
        '<td style="padding:0.25rem 0.4rem;text-align:center;font-weight:600">' + p.pma_score + '</td>' +
        '<td style="padding:0.25rem 0.4rem;text-align:center;color:var(--faint)">' + (p.market_type || '—') + '</td>' +
        '</tr>';
    }).join('');

    el2.innerHTML =
      '<div class="pma-benchmark-header">' +
        '<div class="pma-benchmark-percentile" style="color:' + tier.color + '">' + bench.percentile + '<sup>th</sup></div>' +
        '<div class="pma-benchmark-label">' +
          '<div style="font-weight:700;font-size:var(--small)">' + tier.label + ' of ' + bench.referenceCount + ' Colorado projects</div>' +
          '<div style="font-size:var(--tiny);color:var(--faint)">Median score: ' + bench.median + ' | Mean: ' + bench.mean + ' | Range: ' + bench.min + '–' + bench.max + '</div>' +
        '</div>' +
      '</div>' +
      (rows ? '<table class="pma-bench-table" style="width:100%;border-collapse:collapse;font-size:var(--tiny);margin-top:0.6rem">' +
        '<thead><tr>' +
          '<th style="text-align:left;padding:0.2rem 0.4rem;color:var(--faint);font-weight:600">Project</th>' +
          '<th style="text-align:center;padding:0.2rem 0.4rem;color:var(--faint);font-weight:600">City</th>' +
          '<th style="text-align:center;padding:0.2rem 0.4rem;color:var(--faint);font-weight:600">Score</th>' +
          '<th style="text-align:center;padding:0.2rem 0.4rem;color:var(--faint);font-weight:600">Type</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' : '');
  }

  /* ── Competitive Pipeline render ─────────────────────────────────── */
  function renderPipeline(result) {
    var el2 = el('pmaPipelineResult');
    if (!el2) return;
    var ENH = window.PMAEnhancements;
    if (!ENH) { el2.innerHTML = '<div class="pma-empty">Enhancement module not loaded.</div>'; return; }

    var pipeline = ENH.analyzeCompetitivePipeline(lihtcFeatures || [], result.lat, result.lon, result.bufferMiles);
    lastPipeline = pipeline;

    if (!pipeline.available) {
      el2.innerHTML = '<div class="pma-empty">No LIHTC features available.</div>';
      return;
    }

    var stages = ENH.PIPELINE_STAGES;
    var satClass = pipeline.saturation ? ' pma-flag-warn' : ' pma-flag-ok';
    var rows = pipeline.projects.slice(0, 5).map(function (p) {
      return '<tr>' +
        '<td style="padding:0.2rem 0.4rem">' + p.name + '</td>' +
        '<td style="padding:0.2rem 0.4rem;text-align:center">' + p.dist + ' mi</td>' +
        '<td style="padding:0.2rem 0.4rem;text-align:center">' + p.units + '</td>' +
        '<td style="padding:0.2rem 0.4rem;text-align:center;color:var(--faint)">' + (p.year || '—') + '</td>' +
        '<td style="padding:0.2rem 0.4rem;text-align:center;font-size:var(--tiny)">' + p.stage + '</td>' +
        '</tr>';
    }).join('');

    el2.innerHTML =
      '<div class="pma-stat-grid" style="margin-bottom:0.6rem">' +
        '<div class="pma-stat"><div class="pma-stat-value">' + pipeline.total + '</div><div class="pma-stat-label">Total in buffer</div></div>' +
        '<div class="pma-stat"><div class="pma-stat-value">' + pipeline.active + '</div><div class="pma-stat-label">Active / recent</div></div>' +
        '<div class="pma-stat"><div class="pma-stat-value">' + (pipeline.totalActiveUnits || 0).toLocaleString() + '</div><div class="pma-stat-label">Active units</div></div>' +
        '<div class="pma-stat"><div class="pma-stat-value">' + (pipeline.estimatedAbsorptionMonths || 0) + ' mo</div><div class="pma-stat-label">Est. absorption</div></div>' +
      '</div>' +
      (pipeline.saturation ? '<div class="pma-flag pma-flag-warn" style="margin-bottom:0.5rem">⚠ Submarket saturation warning: ' + pipeline.active + ' active projects (threshold: ' + ENH.SATURATION_THRESHOLD + ')</div>' : '') +
      (rows ? '<table class="pma-bench-table" style="width:100%;border-collapse:collapse;font-size:var(--tiny)">' +
        '<thead><tr>' +
          '<th style="text-align:left;padding:0.2rem 0.4rem;color:var(--faint)">Project</th>' +
          '<th style="text-align:center;padding:0.2rem 0.4rem;color:var(--faint)">Dist</th>' +
          '<th style="text-align:center;padding:0.2rem 0.4rem;color:var(--faint)">Units</th>' +
          '<th style="text-align:center;padding:0.2rem 0.4rem;color:var(--faint)">Year</th>' +
          '<th style="text-align:center;padding:0.2rem 0.4rem;color:var(--faint)">Stage</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' : '');
  }

  /* ── Scenario Analysis render ─────────────────────────────────────── */
  function renderScenarios(result) {
    var el2 = el('pmaScenarioResult');
    if (!el2) return;
    var ENH = window.PMAEnhancements;
    if (!ENH) { el2.innerHTML = '<div class="pma-empty">Enhancement module not loaded.</div>'; return; }

    var proposed = parseInt(el('pmaProposedUnits') && el('pmaProposedUnits').value, 10) || 100;
    var scenarios = ENH.generateScenarios(
      result.acs,
      result.lihtcUnits || 0,
      ENH.defaultScenarios(proposed)
    );
    lastScenarios = scenarios;

    if (!scenarios || !scenarios.length) {
      el2.innerHTML = '<div class="pma-empty">Could not generate scenarios.</div>';
      return;
    }

    var rows = scenarios.map(function (s) {
      var tier = scoreTier(s.overall);
      return '<tr>' +
        '<td style="padding:0.25rem 0.5rem">' + s.label + '</td>' +
        '<td style="padding:0.25rem 0.5rem;text-align:center;font-weight:700;color:' + tier.color + '">' + s.overall + '</td>' +
        '<td style="padding:0.25rem 0.5rem;text-align:center">' + s.captureRate + '%</td>' +
        '<td style="padding:0.25rem 0.5rem;text-align:center;color:' + (s.risk === 'High' ? 'var(--bad)' : s.risk === 'Moderate' ? 'var(--warn)' : 'var(--good)') + '">' + s.risk + '</td>' +
        '</tr>';
    }).join('');

    el2.innerHTML =
      '<table class="pma-bench-table" style="width:100%;border-collapse:collapse;font-size:var(--tiny)">' +
        '<thead><tr>' +
          '<th style="text-align:left;padding:0.2rem 0.5rem;color:var(--faint)">Scenario</th>' +
          '<th style="text-align:center;padding:0.2rem 0.5rem;color:var(--faint)">PMA Score</th>' +
          '<th style="text-align:center;padding:0.2rem 0.5rem;color:var(--faint)">Capture Rate</th>' +
          '<th style="text-align:center;padding:0.2rem 0.5rem;color:var(--faint)">Risk</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ── Run analysis ───────────────────────────────────────────────── */
  function runAnalysis(lat, lon) {
    // Show chart loading overlay (uses PMAUIController helpers when available)
    var _uic = window.PMAUIController;
    if (_uic && _uic.showChartLoading) _uic.showChartLoading('pmaRadarChart');

    // ── Recover from global cache if module-level variables are stale ──
    // This fixes the "No ACS data" error on the second (and subsequent) map
    // clicks where the reference could become stale between analysis runs.
    var _cache = window.PMADataCache;
    if (_cache) {
      if ((!tractCentroids || !(tractCentroids.tracts || tractCentroids).length) &&
          _cache.has('tractCentroids')) {
        tractCentroids = _cache.get('tractCentroids');
      }
      if ((!acsMetrics || !(acsMetrics.tracts || []).length) &&
          _cache.has('acsMetrics')) {
        acsMetrics = _cache.get('acsMetrics');
      }
    }

    // Guard: data files missing or empty — give a specific actionable message
    var centroidList = tractCentroids && (tractCentroids.tracts || tractCentroids);
    if (!centroidList || centroidList.length === 0) {
      showEmpty('pmaScoreWrap',
        'ACS data isn\'t available: tract centroid file is missing or empty. ' +
        'Run the "Generate Market Analysis Data" GitHub Actions workflow.');
      return;
    }
    if (!acsMetrics || !(acsMetrics.tracts || []).length) {
      showEmpty('pmaScoreWrap',
        'ACS data isn\'t available: ACS tract metrics file is missing or empty. ' +
        'Run the "Generate Market Analysis Data" GitHub Actions workflow (requires CENSUS_API_KEY secret).');
      return;
    }

    var acsIdx = buildAcsIndex(acsMetrics && acsMetrics.tracts);
    var bufTracts = tractsInBuffer(lat, lon, bufferMiles);
    var acs = aggregateAcs(bufTracts, acsIdx);

    // If no ACS matches (or no centroids found) try expanding to larger radii.
    var effectiveBuffer = bufferMiles;
    if (!acs) {
      var fallbackSizes = BUFFER_OPTIONS.filter(function (s) { return s > bufferMiles; });
      for (var fi = 0; fi < fallbackSizes.length; fi++) {
        var fallbackMiles = fallbackSizes[fi];
        var fallbackTracts = tractsInBuffer(lat, lon, fallbackMiles);
        var fallbackAcs = aggregateAcs(fallbackTracts, acsIdx);
        if (fallbackAcs) {
          acs = fallbackAcs;
          bufTracts = fallbackTracts;
          effectiveBuffer = fallbackMiles;
          console.warn('[market-analysis] ACS data not found at ' + bufferMiles + 'mi; expanded to ' + fallbackMiles + 'mi');
          break;
        }
      }
    }

    if (!acs) {
      console.warn('[market-analysis] ACS data not found at any buffer radius (checked: ' +
        [bufferMiles].concat(BUFFER_OPTIONS.filter(function (s) { return s > bufferMiles; })).join(', ') + ' mi)');
      showEmpty('pmaScoreWrap',
        'No ACS tract data found within ' +
        (BUFFER_OPTIONS[BUFFER_OPTIONS.length - 1] || bufferMiles) + ' miles. ' +
        'Try a different location, or run the "Generate Market Analysis Data" workflow to refresh coverage.');
      return;
    }

    var nearbyLihtc  = lihtcInBuffer(lat, lon, effectiveBuffer);
    if (lihtcLoadError) {
      showEmpty('pmaScoreWrap',
        'LIHTC data is unavailable — PMA score cannot be computed. ' +
        'Run the "Generate Market Analysis Data" GitHub Actions workflow.');
      return;
    }
    var lihtcCount   = nearbyLihtc.length;
    var lihtcUnits   = nearbyLihtc.reduce(function (s, f) { return s + ((f.properties && (f.properties.N_UNITS || f.properties.TOTAL_UNITS)) || 0); }, 0);
    var prop123Count = nearbyLihtc.filter(function (f) { return isInProp123Jurisdiction(f); }).length;
    // Derive dominant county FIPS from buffer tracts for county-specific AMI
    var _pmaCountyFips = null;
    if (bufTracts.length) {
      var _cfVotes = {};
      bufTracts.forEach(function (t) {
        var gid = t.geoid || t.GEOID || '';
        var cf = gid.substring(0, 5);
        if (cf.length === 5) { _cfVotes[cf] = (_cfVotes[cf] || 0) + 1; }
      });
      var _bestCf = null, _bestCfN = 0;
      Object.keys(_cfVotes).forEach(function (k) {
        if (_cfVotes[k] > _bestCfN) { _bestCfN = _cfVotes[k]; _bestCf = k; }
      });
      _pmaCountyFips = _bestCf;
    }
    var _pmaCountyAmi = _getCountyAmi(_pmaCountyFips);
    var pma          = computePma(acs, lihtcUnits, 0, lat, lon, bufTracts, _pmaCountyAmi, nearbyLihtc);

    // Heuristic confidence score
    var CONF = window.PMAConfidence;
    var confidence = null;
    if (CONF) {
      var acsVintage = (acsMetrics && acsMetrics.meta && acsMetrics.meta.vintage) ||
                       (acsMetrics && acsMetrics.meta && acsMetrics.meta.year)    || 2022;
      confidence = CONF.compute({
        acsTracts:    (acsMetrics && acsMetrics.tracts) || [],
        lihtcCount:   (lihtcFeatures || []).length,
        centroidCount: ((tractCentroids && tractCentroids.tracts) || tractCentroids || []).length,
        bufferTracts:  bufTracts.length,
        acsVintage:    acsVintage
      });
      lastConfidence = confidence;
      CONF.renderConfidenceBadge('pmaHeuristicConfidence', confidence);
    }

    // Enrich with DOLA county-level demographics if available.
    // DOLA provides more current population/housing estimates than ACS
    // (annual vs. 5-year rolling average).
    var dolaEnrichment = null;
    if (dolaData && dolaData.counties) {
      var pmaCountyFips = {};
      bufTracts.forEach(function (t) { pmaCountyFips[t.geoid.slice(0, 5)] = true; });
      var dolaCounties = {};
      var dolaTotalPop = 0, dolaTotalHU = 0, dolaTotalVacant = 0;
      Object.keys(pmaCountyFips).forEach(function (fips) {
        var cd = dolaData.counties[fips];
        if (cd && !cd._noData) {
          dolaCounties[fips] = cd;
          dolaTotalPop    += cd.population    || 0;
          dolaTotalHU     += cd.housingUnits  || 0;
          dolaTotalVacant += cd.vacantUnits   || 0;
        }
      });
      if (Object.keys(dolaCounties).length) {
        dolaEnrichment = {
          year: dolaData.meta.year,
          counties: dolaCounties,
          aggregated: {
            population:   dolaTotalPop,
            housingUnits: dolaTotalHU,
            vacantUnits:  dolaTotalVacant,
            vacancyRate:  dolaTotalHU > 0 ? Math.round((dolaTotalVacant / dolaTotalHU) * 10000) / 10000 : null
          },
          _source: 'DOLA State Demography Office'
        };
      }
    }

    lastResult = Object.assign({}, pma, {
      lat: lat, lon: lon, bufferMiles: effectiveBuffer,
      tractCount: bufTracts.length, acs: acs,
      lihtcCount: lihtcCount, lihtcUnits: lihtcUnits,
      prop123Count: prop123Count,
      confidence: confidence,
      dolaContext: dolaEnrichment,
      _tractIds: bufTracts.map(function (t) { return t.geoid; })
    });

    renderScore(lastResult);
    // Hide chart loading overlay after rendering
    var _uic2 = window.PMAUIController;
    if (_uic2 && _uic2.hideChartLoading) _uic2.hideChartLoading('pmaRadarChart');
    setText('pmaRunBtn', 'Re-run Analysis');

    // Make the Explain Score button visible and functional in buffer mode.
    // pma-ui-controller.js _initExplainScore will pick up lastResult via PMAEngine.
    var explainBtn = document.getElementById('pmaExplainScoreBtn');
    if (explainBtn) { explainBtn.hidden = false; }

    // Render PMA boundary polygon (buffer mode) and SMA ring if toggled.
    (function () {
      var delineation = window.PMADelineation;
      if (!delineation) return;
      delineation.renderPmaLayer(map, lat, lon, effectiveBuffer);
      var smaCheck = document.getElementById('pmaSmaToggle');
      if (smaCheck && smaCheck.checked) {
        delineation.renderSmaLayer(map, lat, lon, true);
      }
      // Update parcel/zoning layer if already visible
      var parcelCheck = document.getElementById('pmaParcelZoningToggle');
      if (parcelCheck && parcelCheck.checked && window.PMAParcelZoning) {
        window.PMAParcelZoning.renderParcelZoningLayer(map, lat, lon, effectiveBuffer);
      }
    }());

    // ── Trigger concept recommendation for buffer mode ───────────────
    (function () {
      var predictor = window.LIHTCDealPredictor;
      var bridge    = window.HNAMarketBridge;
      var card      = document.getElementById('lihtcConceptCard');
      if (!predictor || !card) return;

      var proposedUnits = parseInt((document.getElementById('pmaProposedUnits') || {}).value || '60', 10) || 60;
      var dealInputs = {
        pmaScore:           pma.pma_score || null,
        proposedUnits:      proposedUnits,
        competitiveSetSize: lihtcCount || 0,
        marketVacancy:      acs.vacancy_rate || null,
        // LIHTC recency — allows predictor to flag saturation (many recent
        // allocations = CHFA geo-distribution pressure) vs. gap (dormant
        // market = opportunity) separately from raw count.
        mostRecentLihtcYear: pma.lihtcRecency && pma.lihtcRecency.mostRecentYear,
        recentAllocations5yr: pma.lihtcRecency && pma.lihtcRecency.recentAllocations5yr,
        lihtcActivityLevel:  pma.lihtcRecency && pma.lihtcRecency.activityLevel
      };

      var needProfile = null;
      if (bridge) {
        var hnaState = window.HNAState;
        var hnaData  = hnaState ? (hnaState.chasData || hnaState.affordabilityGap || null) : null;
        if (hnaData) {
          needProfile = bridge.buildNeedProfile(hnaData, { score: dealInputs.pmaScore, method: 'buffer' });
          dealInputs  = bridge.toDealInputs(needProfile, dealInputs);
        }
      }

      var rec = predictor.predictConcept(dealInputs);

      // Compute housing needs fit when HNA data is available
      var hnsFit = null;
      var hnaFitAnalyzer = window.HousingNeedsFitAnalyzer;
      if (hnaFitAnalyzer && needProfile) {
        hnsFit = hnaFitAnalyzer.analyzeHousingNeedsFit(needProfile, rec, { proposedUnits: proposedUnits });
      }

      // ── Phase 2.1: Constraint screening ─────────────────────────
      var constraints = {};

      // Environmental screening
      var envScreening = window.EnvironmentalScreening;
      if (envScreening && typeof envScreening.assess === 'function') {
        constraints.environmental = envScreening.assess(lat, lon, 1.0);
      }

      // Public land overlay
      var landOverlay = window.PublicLandOverlay;
      if (landOverlay && typeof landOverlay.assess === 'function') {
        var geoid = (pma && pma.geoid) || (dealInputs && dealInputs.geoid) || null;
        var countyFips = geoid ? String(geoid).substring(0, 5) : null;
        constraints.publicLand = landOverlay.assess(lat, lon, countyFips);
      }

      // Soft funding tracker
      var fundTracker = window.SoftFundingTracker;
      if (fundTracker && typeof fundTracker.check === 'function') {
        var fundFips = (dealInputs && dealInputs.geoid) || null;
        var fundYear = new Date().getFullYear();
        constraints.softFunding = fundTracker.check(fundFips, fundYear);
      }

      // CHFA award predictor
      var chfaPredictor = window.CHFAAwardPredictor;
      if (chfaPredictor && typeof chfaPredictor.predict === 'function') {
        var siteContext = {
          pmaScore:            pma && pma.pma_score,
          isQct:               dealInputs.isQct || false,
          isDda:               dealInputs.isDda || false,
          totalUndersupply:    dealInputs.totalUndersupply || 0,
          ami30UnitsNeeded:    dealInputs.ami30UnitsNeeded || 0,
          localSoftFunding:    dealInputs.softFundingAvailable || 0,
          hasHnaData:          !!needProfile,
          publicLandOpportunity: constraints.publicLand ? constraints.publicLand.opportunity : 'none'
        };
        constraints.chfaCompetitiveness = chfaPredictor.predict(rec, siteContext);
      }

      // Use the full renderer when available (preferred path)
      var renderer = window.LIHTCConceptCardRenderer;
      if (renderer && typeof renderer.render === 'function') {
        renderer.render(card, rec, hnsFit, constraints);
        return;
      }

      // Fallback: simple summary (shown only when the renderer script has not loaded)
      var badge = rec.confidenceBadge || '';
      card.hidden = false;
      card.innerHTML = '<p style="margin:0;"><strong>' + badge + ' ' +
        rec.recommendedExecution + ' ' + _cap(rec.conceptType) + ' Housing</strong> — ' +
        rec.confidence + ' confidence</p>' +
        '<p style="margin:.4rem 0 0;font-size:.85rem;">' +
        (rec.keyRationale[0] ? rec.keyRationale[0] : '') + '</p>';
      var liveRegion = document.getElementById('lihtcConceptLiveRegion');
      if (liveRegion) {
        liveRegion.textContent = 'Concept recommendation: ' + rec.recommendedExecution + ' ' + rec.conceptType + ' housing, ' + rec.confidence + ' confidence.';
      }
    }());

    // ── Delegate to MAController to populate the 8 report sections ──
    // Normalise the aggregated ACS field names to match what MARenderers
    // and SiteSelectionScore expect, then push the data into MAState before
    // calling MAController.runAnalysis() so that _getAcs() / _getLihtc()
    // can retrieve it through the secondary (MAState) path.
    var MAC = window.MAController;
    if (MAC && typeof MAC.runAnalysis === 'function') {
      var MA = window.MAState;
      if (MA) {
        var _totalHh = acs.total_hh || 0;
        MA.setState({
          acs: {
            pop:                acs.pop,
            renter_hh:          acs.renter_hh,
            owner_hh:           Math.max(0, _totalHh - (acs.renter_hh || 0)),
            total_hh:           _totalHh,
            vacant:             acs.vacant,
            med_gross_rent:     acs.median_gross_rent,
            med_hh_income:      acs.median_hh_income,
            cost_burden_rate:   acs.cost_burden_rate,
            renter_share:       (_totalHh > 0 && acs.renter_hh != null) ? acs.renter_hh / _totalHh : null,
            vacancy_rate:       acs.vacancy_rate,
            tract_count:        acs.tract_count,
            // Fields not in the current ACS extract; renderers handle null gracefully.
            severe_burden_rate: null,
            poverty_rate:       null,
            unemployment_rate:  null
          },
          lihtc: nearbyLihtc || []
        });
      }
      MAC.runAnalysis(lat, lon, bufferMiles);
    } else {
      console.warn('[market-analysis] MAController not available — report sections will not render.');
    }
  }

  /* ── Map setup ───────────────────────────────────────────────────── */
  function initMap() {
    var L = window.L;
    if (!L) { console.error('[market-analysis] Leaflet not available'); return; }

    map = L.map('pmaMap', { zoomControl: true, maxBoundsViscosity: 1.0 }).setView([39.5501, -105.7821], 7);
    if (window.addMapHomeButton) { addMapHomeButton(map, { center: [39.5501, -105.7821], zoom: 7 }); }
    // Expose map so the page's inline jurisdiction logic can flyTo county centroids (#13)
    window._cohoMap = map;

    // Restrict pan/zoom tightly to Colorado state boundary + minimal padding.
    // Colorado extent: N 41.0°, S 37.0°, W -109.05°, E -102.05°.
    var coloradoBounds = L.latLngBounds(
      L.latLng(37.0, -109.05),
      L.latLng(41.0, -102.05)
    );
    map.setMaxBounds(coloradoBounds.pad(0.05));
    map.setMinZoom(7);

    // Add a loading overlay that disappears once data is ready.
    var mapEl = document.getElementById('pmaMap');
    if (mapEl) {
      var loadDiv = document.createElement('div');
      loadDiv.id = 'pmaMapLoadingOverlay';
      loadDiv.style.cssText = [
        'position:absolute;inset:0;z-index:1000;display:flex;',
        'align-items:center;justify-content:center;',
        'background:rgba(var(--card-rgb,255,255,255),.82);',
        'font-size:.9rem;font-weight:600;color:var(--muted);',
        'pointer-events:none;border-radius:inherit;',
      ].join('');
      loadDiv.textContent = 'Loading map data…';
      mapEl.style.position = 'relative';
      mapEl.appendChild(loadDiv);
    }

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors © CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);

    map.on('click', function (e) {
      if (!dataLoaded) {
        showEmpty('pmaScoreWrap', 'Data is still loading — please wait a moment then try again.');
        return;
      }
      placeSiteMarker(e.latlng.lat, e.latlng.lng);
      runAnalysis(e.latlng.lat, e.latlng.lng);
    });

    // Address-based site selection via free US Census Geocoder.
    // No API key required; rate-limit is generous (docs say "reasonable
    // interactive use"). Restricts results to Colorado (STATE=08) because
    // our downstream PMA analysis only has CO data loaded.
    _wireAddressSearch();
  }

  /**
   * Wire up the "Find a Colorado address" input/button to the free US
   * Census Geocoder. Picks the first match, validates it's in Colorado
   * (STATE=08), then fires the existing placeSiteMarker + runAnalysis
   * flow — same code path as a map click.
   */
  function _wireAddressSearch() {
    var input = document.getElementById('pmaAddressInput');
    var btn   = document.getElementById('pmaAddressSearchBtn');
    var status = document.getElementById('pmaAddressStatus');
    if (!input || !btn || !status) return;   // page variant without search UI

    function _setStatus(msg, level) {
      status.textContent = msg || '';
      status.style.color = level === 'error' ? 'var(--bad, #c0392b)'
                        : level === 'ok' ? 'var(--good, #047857)'
                        : 'var(--muted, #666)';
    }

    function _submit() {
      var q = (input.value || '').trim();
      if (!q) {
        _setStatus('Enter a Colorado street address or landmark.', 'error');
        input.focus();
        return;
      }
      if (!dataLoaded) {
        _setStatus('Data is still loading — wait a moment then try again.', 'error');
        return;
      }
      btn.disabled = true;
      _setStatus('Geocoding “' + q + '” via US Census Geocoder…', 'info');

      // US Census Geocoder — free, no key. Public_AR_Current = latest
      // address ranges. format=json returns coords in WGS84.
      // Docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.pdf
      var url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
                '?address=' + encodeURIComponent(q) +
                '&benchmark=Public_AR_Current' +
                '&format=json';

      fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error('Census Geocoder HTTP ' + r.status);
          return r.json();
        })
        .then(function (d) {
          var matches = (d && d.result && d.result.addressMatches) || [];
          if (!matches.length) {
            throw new Error('No match found. Try including the city + CO (e.g. "Main St, Pueblo CO").');
          }
          // First match is highest-confidence per Census API convention.
          var m = matches[0];
          var coords = m.coordinates || {};
          var lon = parseFloat(coords.x);   // Census returns x=lon, y=lat
          var lat = parseFloat(coords.y);
          if (!isFinite(lat) || !isFinite(lon)) {
            throw new Error('Geocoder returned invalid coordinates.');
          }
          // Validate it's in Colorado via STATE from addressComponents. We
          // could also bounds-check lat/lon against CO (37-41°N, -109--102°W),
          // but the STATE field from the geocoder is more reliable.
          var addr = (m.addressComponents && m.addressComponents.state) || '';
          if (addr && String(addr).toUpperCase() !== 'CO') {
            throw new Error('Address resolved to ' + addr + ' — this site is Colorado-only. Add "CO" to your query.');
          }
          // Hand off to the same flow as a map click.
          map.setView([lat, lon], 13);
          placeSiteMarker(lat, lon);
          runAnalysis(lat, lon);
          _setStatus('Placed at ' + (m.matchedAddress || q) +
                     ' (' + lat.toFixed(4) + ', ' + lon.toFixed(4) + ')', 'ok');
        })
        .catch(function (err) {
          _setStatus(err.message || 'Geocoding failed. Try clicking the map instead.', 'error');
        })
        .then(function () {
          btn.disabled = false;
        });
    }

    btn.addEventListener('click', _submit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); _submit(); }
    });
  }

  /* ── Overlay layer styles ────────────────────────────────────────── */
  var OVERLAY_STYLES = {
    county: { color: '#334155', weight: 1.5, fillOpacity: 0, dashArray: null },
    qct:    { color: '#7c3aed', weight: 1,   fillColor: '#7c3aed', fillOpacity: 0.10 },
    dda:    { color: '#b45309', weight: 1,   fillColor: '#b45309', fillOpacity: 0.12 }
  };

  /* ── Build overlay layers and Leaflet layer control ─────────────── */
  function initOverlayLayers(countyGj, qctGj, ddaGj) {
    var L = window.L;
    if (!L || !map) return;

    var overlayMaps = {};

    // County boundaries — added to map by default (visible on load)
    if (countyGj && Array.isArray(countyGj.features) && countyGj.features.length > 0) {
      countyLayer = L.geoJSON(countyGj, {
        style: OVERLAY_STYLES.county,
        onEachFeature: function (f, layer) {
          var name = (f.properties && (f.properties.NAME || f.properties.NAMELSAD)) || 'County';
          layer.bindTooltip(name, { sticky: true, className: 'pma-tooltip' });
        }
      });
      countyLayer.addTo(map);
      overlayMaps['County Boundaries'] = countyLayer;
    }

    // QCTs
    if (qctGj && Array.isArray(qctGj.features) && qctGj.features.length > 0) {
      qctLayer = L.geoJSON(qctGj, {
        style: OVERLAY_STYLES.qct,
        onEachFeature: function (f, layer) {
          var id = (f.properties && (f.properties.GEOID || f.properties.geoid)) || '';
          layer.bindTooltip('QCT ' + id, { sticky: true, className: 'pma-tooltip' });
        }
      });
      overlayMaps['Qualified Census Tracts'] = qctLayer;
    }

    // DDAs
    if (ddaGj && Array.isArray(ddaGj.features) && ddaGj.features.length > 0) {
      ddaLayer = L.geoJSON(ddaGj, {
        style: OVERLAY_STYLES.dda,
        onEachFeature: function (f, layer) {
          var p = f.properties || {};
          var label = p.DDA_NAME || p.NAME || p.ZCTA5 || p.ZIP || 'DDA';
          layer.bindTooltip('DDA: ' + label, { sticky: true, className: 'pma-tooltip' });
        }
      });
      overlayMaps['Difficult Dev Areas'] = ddaLayer;
    }

    // LIHTC project markers (circle markers)
    if (lihtcFeatures && lihtcFeatures.length > 0) {
      var lihtcGj = { type: 'FeatureCollection', features: lihtcFeatures };
      lihtcLayer = L.geoJSON(lihtcGj, {
        pointToLayer: function (f, latlng) {
          var inProp123 = isInProp123Jurisdiction(f);
          return window.L.circleMarker(latlng, {
            radius: 5,
            color: inProp123 ? '#7c3aed' : '#0a7e74',
            fillColor: inProp123 ? '#7c3aed' : '#0a7e74',
            fillOpacity: 0.7, weight: 1.5
          });
        },
        onEachFeature: function (f, layer) {
          var p = f.properties || {};
          var name = p.PROJECT || p.PROJECT_NAME || p.project_name || 'LIHTC Project';
          var units = p.N_UNITS || p.TOTAL_UNITS || p.total_units || '?';
          var year  = p.YR_ALLOC || p.YEAR_ALLOC  || p.year_alloc  || '';
          var prop123Badge = isInProp123Jurisdiction(f) ? '<br><span style="color:#7c3aed;font-weight:600">✓ Prop 123 Jurisdiction</span>' : '';
          layer.bindTooltip(
            name + '<br>' + units + ' units' + (year ? ' (' + year + ')' : '') + prop123Badge,
            { sticky: true, className: 'pma-tooltip' }
          );
        }
      });
      lihtcLayer.addTo(map);
      overlayMaps['LIHTC Projects'] = lihtcLayer;
    }

    // Add Leaflet layer control (top-right, after zoom control)
    if (Object.keys(overlayMaps).length > 0) {
      if (layerControl) map.removeControl(layerControl);
      layerControl = L.control.layers(null, overlayMaps, {
        collapsed: true,
        position: 'topright'
      }).addTo(map);
    }

    // Add compact map legend
    addMapLegend(overlayMaps);
  }

  /* ── Map legend ─────────────────────────────────────────────────── */
  function addMapLegend(overlayMaps) {
    var L = window.L;
    if (!L || !map || !Object.keys(overlayMaps).length) return;

    var legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      var div = L.DomUtil.create('div', 'pma-legend');
      var items = [];
      if (overlayMaps['County Boundaries']) {
        items.push('<span class="pma-legend-swatch" style="border:2px solid #334155;background:transparent"></span> Counties');
      }
      if (overlayMaps['Qualified Census Tracts']) {
        items.push('<span class="pma-legend-swatch" style="background:#7c3aed;opacity:.6"></span> QCT');
      }
      if (overlayMaps['Difficult Dev Areas']) {
        items.push('<span class="pma-legend-swatch" style="background:#b45309;opacity:.6"></span> DDA');
      }
      if (overlayMaps['LIHTC Projects']) {
        items.push('<span class="pma-legend-swatch pma-legend-circle" style="background:#0a7e74"></span> LIHTC');
      }
      div.innerHTML = items.map(function (i) { return '<div>' + i + '</div>'; }).join('');
      return div;
    };
    legend.addTo(map);
  }

  /* ── PMA layer toggle wiring ───────────────────────────────────── */
  var LAYER_CONFIG = {
    lihtc:             { src: null, style: null },                                                           // handled by initOverlayLayers
    sma:               { src: 'co-county-boundaries.json',                    style: { color: '#6366f1', weight: 1, fillOpacity: 0.05 } },
    transit:           { src: 'market/transit_routes_co.geojson',              style: { color: '#0ea5e9', weight: 2, opacity: 0.7 } },
    transitStops:      { src: 'amenities/transit_stops_co.geojson',
                         pointStyle: { radius: 4, fillColor: '#0ea5e9', color: '#fff', weight: 1, fillOpacity: 0.8 } },
    schools:           { src: 'market/schools_co.geojson',                    pointStyle: { radius: 5, fillColor: '#f59e0b', color: '#fff', weight: 1, fillOpacity: 0.8 } },
    opportunities:     { src: 'market/opportunity_zones_co.geojson',          style: { color: '#10b981', weight: 1.5, fillOpacity: 0.15 },
                         arcgis: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Opportunity_Zones_2/FeatureServer/0',
                         arcgisWhere: "STATEFP='08'" },
    flood:             { src: 'market/flood_zones_co.geojson',                style: { color: '#3b82f6', weight: 1, fillOpacity: 0.2 },
                         tileService: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer',
                         tileLayers: '28',
                         tileLabel: 'FEMA Flood Zones' },
    barriers:          { src: 'market/natural_barriers_co.geojson',           style: { color: '#ef4444', weight: 1.5, fillOpacity: 0.15 } },
    envJustice:        { src: 'market/environmental_constraints_co.geojson',
                         pointStyle: { radius: 5, fillColor: '#f59e0b', color: '#ef4444', weight: 1.5, fillOpacity: 0.7 } },
    commuting:         { src: 'market/commuting_co.geojson',
                         pointStyle: { radius: 5, fillColor: '#6366f1', color: '#312e81', weight: 1, fillOpacity: 0.6 } },
    walkability:       { src: 'market/walkability_co.geojson',
                         pointStyle: { radius: 5, fillColor: '#10b981', color: '#065f46', weight: 1, fillOpacity: 0.6 } },
    employmentCenters: { src: 'market/employment_centers_co.geojson',
                         pointStyle: { radius: 4, fillColor: '#8b5cf6', color: '#fff', weight: 1, fillOpacity: 0.7 } },
    grocery:           { src: 'amenities/grocery_co.geojson',
                         pointStyle: { radius: 4, fillColor: '#22c55e', color: '#fff', weight: 1, fillOpacity: 0.8 } },
    healthcare:        { src: 'amenities/healthcare_co.geojson',
                         pointStyle: { radius: 4, fillColor: '#ef4444', color: '#fff', weight: 1, fillOpacity: 0.8 } },
    parks:             { src: 'amenities/parks_co.geojson',
                         pointStyle: { radius: 4, fillColor: '#16a34a', color: '#fff', weight: 1, fillOpacity: 0.7 } },
    hospitals:         { src: 'market/hospitals_co.geojson',
                         pointStyle: { radius: 6, fillColor: '#dc2626', color: '#fff', weight: 2, fillOpacity: 0.9 } },
    childcare:         { src: 'market/childcare_co.geojson',
                         pointStyle: { radius: 4, fillColor: '#f97316', color: '#fff', weight: 1, fillOpacity: 0.8 } },
    infrastructure:    { src: 'market/utility_capacity_co.geojson',
                         pointStyle: { radius: 5, fillColor: '#0891b2', color: '#164e63', weight: 1, fillOpacity: 0.6 } },
    housingPolicy:     { src: 'market/housing_policy_jurisdictions_co.geojson' },
    parcelZoning:      { src: 'market/landuse_zoning_proxy_co.geojson',
                         pointStyle: { radius: 5, fillColor: '#8b5cf6', color: '#fff', weight: 1, fillOpacity: 0.7 } },
    commutingFlows:    { src: 'market/lodes_od_arcs_co.geojson' },
    listings:          { src: null }    // handled externally (Bridge API)
  };

  /* ── Layer status toast ──────────────────────────────────────────── */
  var _toastEl = null;
  function _showLayerToast(msg, isError) {
    if (!_toastEl) {
      _toastEl = document.createElement('div');
      _toastEl.style.cssText = 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);' +
        'padding:.65rem 1.2rem;border-radius:8px;font-size:.82rem;z-index:10000;' +
        'box-shadow:0 2px 12px rgba(0,0,0,.25);transition:opacity .3s;pointer-events:none;max-width:90vw;text-align:center;';
      document.body.appendChild(_toastEl);
    }
    _toastEl.style.background = isError ? '#dc2626' : 'var(--accent, #096e65)';
    _toastEl.style.color = '#fff';
    _toastEl.textContent = msg;
    _toastEl.style.opacity = '1';
    clearTimeout(_toastEl._timer);
    _toastEl._timer = setTimeout(function () { _toastEl.style.opacity = '0'; }, isError ? 6000 : 3000);
  }

  var _mapLayers = {};  // cache: data-layer key -> L.geoJSON layer

  function initLayerToggles() {
    var L = window.L;
    var DS = window.DataService;
    if (!L || !map) { console.warn('[market-analysis] initLayerToggles: Leaflet or map not ready'); return; }

    var checkboxes = document.querySelectorAll('.pma-layer-toggle');
    for (var i = 0; i < checkboxes.length; i++) {
      (function (cb) {
        var key = cb.getAttribute('data-layer');
        if (!key) return;

        var cfg = LAYER_CONFIG[key];

        // Skip keys not in config (e.g. future additions)
        if (!cfg) return;

        // Disable checkboxes for layers with no data source and no special handling
        if (!cfg.src && !cfg.tileService && !cfg.arcgis && key !== 'lihtc' && key !== 'listings') {
          cb.disabled = true;
          var noData = document.createElement('small');
          noData.textContent = ' (no data)';
          noData.style.color = 'var(--muted, #94a3b8)';
          cb.parentNode.appendChild(noData);
          return;
        }

        // LIHTC toggle — wire to existing lihtcLayer from initOverlayLayers
        if (key === 'lihtc') {
          cb.addEventListener('change', function () {
            if (!lihtcLayer) return;
            if (cb.checked) {
              if (!map.hasLayer(lihtcLayer)) lihtcLayer.addTo(map);
            } else {
              map.removeLayer(lihtcLayer);
            }
          });
          return;
        }

        // Listings — skip, handled by external Bridge API integration
        if (key === 'listings') return;

        // ── Tile service layers (ArcGIS MapServer image tiles) ──
        if (cfg.tileService) {
          cb.addEventListener('change', function () {
            if (cb.checked) {
              if (_mapLayers[key]) {
                if (!map.hasLayer(_mapLayers[key])) _mapLayers[key].addTo(map);
                return;
              }
              // Leaflet custom tile layer using ArcGIS export endpoint
              var layer = L.tileLayer(
                cfg.tileService + '/export?bbox={bbox}&bboxSR=4326&imageSR=4326' +
                '&size=256,256&format=png32&transparent=true&layers=show:' +
                (cfg.tileLayers || '0') + '&f=image',
                { attribution: cfg.tileLabel || 'ArcGIS', opacity: 0.65, maxZoom: 18,
                  // Custom bbox substitution for ArcGIS export
                  // Leaflet doesn't natively support {bbox}, so we override getTileUrl
                }
              );
              // Override getTileUrl to provide bbox from tile coords
              layer.getTileUrl = function (coords) {
                var tileSize = this.getTileSize();
                var nw = this._map.unproject([coords.x * tileSize.x, coords.y * tileSize.y], coords.z);
                var se = this._map.unproject([(coords.x + 1) * tileSize.x, (coords.y + 1) * tileSize.y], coords.z);
                var bbox = [se.lng, se.lat, nw.lng, nw.lat].join(',');
                return cfg.tileService + '/export?bbox=' + bbox +
                  '&bboxSR=4326&imageSR=4326&size=' + tileSize.x + ',' + tileSize.y +
                  '&format=png32&transparent=true&layers=show:' + (cfg.tileLayers || '0') + '&f=image';
              };
              // Detect errors (service down)
              layer.on('tileerror', function (e) {
                if (!layer._errorShown) {
                  layer._errorShown = true;
                  _showLayerToast('⚠ ' + (cfg.tileLabel || key) + ' service unavailable — try again later', true);
                  // Disable checkbox and show status
                  cb.checked = false;
                  if (_mapLayers[key] && map.hasLayer(_mapLayers[key])) map.removeLayer(_mapLayers[key]);
                }
              });
              layer.on('load', function () {
                if (!layer._loadShown) {
                  layer._loadShown = true;
                  _showLayerToast('✓ ' + (cfg.tileLabel || key) + ' loaded', false);
                }
              });
              _mapLayers[key] = layer;
              layer.addTo(map);
            } else {
              if (_mapLayers[key] && map.hasLayer(_mapLayers[key])) map.removeLayer(_mapLayers[key]);
            }
          });
          return;
        }

        // Standard GeoJSON layers (with optional ArcGIS FeatureServer primary + local fallback)
        cb.addEventListener('change', function () {
          if (cb.checked) {
            // Already cached — just re-add to map
            if (_mapLayers[key]) {
              if (!map.hasLayer(_mapLayers[key])) _mapLayers[key].addTo(map);
              return;
            }

            // Helper to create GeoJSON layer from data
            function _createLayer(gj) {
              if (!gj || !gj.features || gj.features.length === 0) {
                console.warn('[market-analysis] Layer "' + key + '": empty or invalid GeoJSON');
                return;
              }
              var opts = {};
              if (cfg.pointStyle) {
                opts.pointToLayer = function (feature, latlng) {
                  var ps = Object.assign({}, cfg.pointStyle);
                  var fp = feature.properties || {};

                  // Dynamic styling for walkability (green gradient by score)
                  if (key === 'walkability' && fp.walk_score != null) {
                    var ws = fp.walk_score;
                    ps.fillColor = ws >= 70 ? '#10b981' : ws >= 40 ? '#f59e0b' : '#ef4444';
                    ps.radius = 4 + Math.round(ws / 25);
                  }

                  // Dynamic styling for commuting (size by volume, color by net flow)
                  if (key === 'commuting' && fp.netFlow != null) {
                    var total = (fp.inCommuters || 0) + (fp.outCommuters || 0);
                    ps.radius = Math.max(3, Math.min(10, 3 + Math.log10(Math.max(total, 1)) * 1.5));
                    ps.fillColor = fp.netFlow > 0 ? '#6366f1' : fp.netFlow < 0 ? '#f97316' : '#94a3b8';
                  }

                  // Dynamic styling for parcel zoning proxy (color by zone type)
                  if (key === 'parcelZoning' && fp.zone_proxy) {
                    var zp = fp.zone_proxy;
                    ps.fillColor = zp === 'multifamily_residential' ? '#10b981'
                      : zp === 'townhome_residential' ? '#3b82f6'
                      : zp === 'mixed_use' ? '#8b5cf6'
                      : zp === 'vacant_developable' ? '#f59e0b'
                      : zp === 'commercial' ? '#6b7280'
                      : zp === 'industrial' ? '#dc2626' : '#94a3b8';
                    ps.radius = (fp.mf_suitability || 50) >= 70 ? 6 : 4;
                  }

                  // Dynamic styling for EJI (red gradient by risk)
                  if (key === 'envJustice' && fp.eji_percentile != null) {
                    var eji = fp.eji_percentile;
                    ps.fillColor = eji >= 0.75 ? '#ef4444' : eji >= 0.5 ? '#f59e0b' : '#22c55e';
                  }

                  return L.circleMarker(latlng, ps);
                };
              }
              if (cfg.style) {
                opts.style = cfg.style;
              }
              // Arc style for commuting OD flows
              if (key === 'commutingFlows') {
                opts.style = function (feature) {
                  var p = feature.properties || {};
                  var jobs = p.jobs || 0;
                  var dist = p.distance_miles || 0;
                  // Width by job count (log scale), color by distance
                  var weight = Math.max(1.5, Math.min(6, 1 + Math.log10(Math.max(jobs, 1)) * 1.5));
                  var color = dist > 30 ? '#ef4444' : dist > 15 ? '#f59e0b' : '#6366f1';
                  var opacity = Math.max(0.25, Math.min(0.7, jobs / 500));
                  return { color: color, weight: weight, opacity: opacity, dashArray: null };
                };
              }
              // Choropleth style for housing policy jurisdictions
              if (key === 'housingPolicy') {
                opts.style = function (feature) {
                  var p = feature.properties || {};
                  var score = p.totalScore || 0;
                  var max = p.maxPossible || 7;
                  var ratio = max > 0 ? score / max : 0;
                  var fillColor = p.has_iz_ordinance ? '#10b981'
                    : ratio >= 0.7 ? '#3b82f6'
                    : ratio >= 0.4 ? '#f59e0b'
                    : '#94a3b8';
                  return {
                    fillColor: fillColor,
                    color: p.has_iz_ordinance ? '#059669' : '#6b7280',
                    weight: p.geo_type === 'county' ? 1.5 : 1,
                    fillOpacity: 0.15,
                    opacity: 0.6
                  };
                };
              }
              opts.onEachFeature = function (feature, layer) {
                var p = feature.properties || {};
                var tip = '';

                // Custom tooltips for enriched layers
                if (key === 'walkability' && p.walk_score != null) {
                  tip = '<b>Walk: ' + p.walk_score + '</b> · Transit: ' + (p.transit_score || '—') +
                        ' · Bike: ' + (p.bike_score || '—') +
                        '<br><span style="font-size:0.8em;opacity:0.8;">Tract ' + (p.geoid || '') + '</span>';
                  layer.bindTooltip(tip, { sticky: true, className: 'pma-tooltip' });
                  return;
                }
                if (key === 'commuting' && p.netFlow != null) {
                  var arrow = p.netFlow > 0 ? '↑' : p.netFlow < 0 ? '↓' : '→';
                  tip = '<b>Net: ' + arrow + ' ' + Math.abs(p.netFlow).toLocaleString() + '</b>' +
                        '<br>In: ' + (p.inCommuters || 0).toLocaleString() +
                        ' · Out: ' + (p.outCommuters || 0).toLocaleString() +
                        '<br>Jobs: ' + (p.totalJobs || 0).toLocaleString() +
                        ' · J/H: ' + (p.jobHousingRatio || 0) +
                        '<br><span style="font-size:0.8em;opacity:0.8;">Tract ' + (p.geoid || '') + '</span>';
                  layer.bindTooltip(tip, { sticky: true, className: 'pma-tooltip' });
                  return;
                }
                if (key === 'envJustice' && p.eji_percentile != null) {
                  tip = '<b>EJI: ' + (p.eji_percentile * 100).toFixed(1) + '%</b> (' + (p.risk_category || '') + ')' +
                        '<br>Env: ' + ((p.env_burden || 0) * 100).toFixed(1) + '%' +
                        ' · Social: ' + ((p.social_vuln || 0) * 100).toFixed(1) + '%' +
                        '<br><span style="font-size:0.8em;opacity:0.8;">Tract ' + (p.geoid || '') + '</span>';
                  layer.bindTooltip(tip, { sticky: true, className: 'pma-tooltip' });
                  return;
                }

                if (key === 'commutingFlows' && p.home_tract) {
                  var wageBreak = '';
                  if (p.low_wage || p.mid_wage || p.high_wage) {
                    wageBreak = '<br>Low: ' + (p.low_wage || 0).toLocaleString() +
                      ' · Mid: ' + (p.mid_wage || 0).toLocaleString() +
                      ' · High: ' + (p.high_wage || 0).toLocaleString();
                  }
                  tip = '<b>' + (p.jobs || 0).toLocaleString() + ' commuters</b>' +
                    '<br>Home: ' + p.home_tract + ' → Work: ' + p.work_tract +
                    '<br>Distance: ' + (p.distance_miles || 0) + ' mi' +
                    wageBreak;
                  layer.bindTooltip(tip, { sticky: true, className: 'pma-tooltip' });
                  return;
                }
                if (key === 'parcelZoning' && p.zone_proxy) {
                  var zLabel = (p.zone_proxy || '').replace(/_/g, ' ');
                  zLabel = zLabel.charAt(0).toUpperCase() + zLabel.slice(1);
                  var suit = p.mf_suitability || 0;
                  var suitColor = suit >= 70 ? '#10b981' : suit >= 40 ? '#f59e0b' : '#ef4444';
                  tip = '<b>' + zLabel + '</b>' +
                    (p.name ? '<br>' + p.name : '') +
                    '<br>MF Suitability: <span style="color:' + suitColor + ';font-weight:600">' + suit + '/100</span>' +
                    (p.building ? '<br>Building: ' + p.building : '') +
                    (p.levels ? ' · Levels: ' + p.levels : '') +
                    '<br><span style="font-size:0.75em;opacity:0.7">Source: ' + (p.data_source || 'OSM') + '</span>';
                  layer.bindTooltip(tip, { sticky: true, className: 'pma-tooltip' });
                  return;
                }
                if (key === 'housingPolicy') {
                  var pills = [];
                  if (p.has_iz_ordinance)      pills.push('IZ');
                  if (p.has_local_funding)     pills.push('Funding');
                  if (p.has_housing_authority) pills.push('HA');
                  if (p.has_comp_plan)         pills.push('Comp Plan');
                  if (p.prop123_committed)     pills.push('Prop 123');
                  if (p.has_hna)               pills.push('HNA');
                  if (p.has_housing_nonprofits) pills.push('Nonprofits');
                  var pillsHtml = pills.length > 0
                    ? pills.map(function (l) { return '<span style="display:inline-block;padding:1px 5px;border-radius:3px;background:#e0f2fe;color:#0369a1;font-size:.72rem;margin:1px">' + l + '</span>'; }).join(' ')
                    : '<span style="color:#94a3b8;font-size:.8em">No policy data</span>';
                  var izDetail = '';
                  if (p.iz_type) {
                    izDetail = '<br><span style="font-size:.8em">IZ: ' + p.iz_type.replace(/_/g, ' ') +
                      (p.iz_set_aside_pct ? ' (' + p.iz_set_aside_pct + '% set-aside)' : '') +
                      (p.iz_ami_target ? ' @ ' + p.iz_ami_target : '') + '</span>';
                  }
                  tip = '<b>' + (p.name || '') + '</b> — ' + (p.totalScore || 0) + '/' + (p.maxPossible || 7) +
                        '<br>' + pillsHtml + izDetail;
                  layer.bindTooltip(tip, { sticky: true, className: 'pma-tooltip' });
                  return;
                }
                if (key === 'infrastructure' && p.utility_type) {
                  var iName = p.NAME || p.name || '';
                  tip = '<b>' + iName + '</b>' +
                        '<br>Type: ' + (p.utility_type || '').replace(/_/g, ' ') +
                        '<br>Constraint: ' + (p.constraint_level || '—') +
                        (p.notes ? '<br><span style="font-size:0.8em;opacity:0.8;">' + p.notes.substring(0, 80) + '</span>' : '');
                  layer.bindTooltip(tip, { sticky: true, className: 'pma-tooltip' });
                  return;
                }

                var name = p.NAME || p.name || p.NAMELSAD || p.Name || p.school_name || p.geoid || '';
                if (name) layer.bindTooltip(name, { sticky: true, className: 'pma-tooltip' });
              };
              _mapLayers[key] = L.geoJSON(gj, opts);
              _mapLayers[key].addTo(map);
              _showLayerToast('✓ ' + key + ' (' + gj.features.length + ' features)', false);
            }

            // Helper to load from local GeoJSON file
            function _loadLocal() {
              if (!cfg.src) return;
              var url = (DS && typeof DS.baseData === 'function') ? DS.baseData(cfg.src) : ('data/' + cfg.src);
              var fetchPromise = (DS && typeof DS.getJSON === 'function')
                ? DS.getJSON(url)
                : fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
              fetchPromise.then(_createLayer).catch(function (err) {
                console.warn('[market-analysis] Local fallback failed for "' + key + '":', err);
                _showLayerToast('⚠ ' + key + ' — data unavailable', true);
              });
            }

            // If ArcGIS FeatureServer is configured, try it first with local fallback
            if (cfg.arcgis) {
              var qs = 'where=' + encodeURIComponent(cfg.arcgisWhere || '1=1') +
                '&outFields=*&returnGeometry=true&f=geojson&outSR=4326&resultRecordCount=5000';
              fetch(cfg.arcgis + '/query?' + qs, { signal: AbortSignal.timeout(15000) })
                .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                .then(function (gj) {
                  if (gj.error) throw new Error(gj.error.message || 'ArcGIS error');
                  if (gj.features && gj.features.length > 0) {
                    _createLayer(gj);
                  } else {
                    throw new Error('empty response');
                  }
                })
                .catch(function (err) {
                  console.warn('[market-analysis] ArcGIS service failed for "' + key + '":', err.message, '— falling back to local');
                  _showLayerToast('⚠ ' + key + ' live service down — loading cached data', true);
                  _loadLocal();
                });
            } else {
              // No ArcGIS — just load local
              _loadLocal();
            }
          } else {
            // Unchecked — remove from map
            if (_mapLayers[key] && map.hasLayer(_mapLayers[key])) {
              map.removeLayer(_mapLayers[key]);
            }
          }
        });
      })(checkboxes[i]);
    }
  }

  /* ── Load overlay GeoJSON files ──────────────────────────────────── */
  function loadOverlays() {
    var DS = window.DataService;
    if (!DS) return Promise.resolve();
    return Promise.all([
      DS.getJSON(DS.baseData('co-county-boundaries.json')).catch(function () { return null; }),
      DS.getJSON(DS.baseData('qct-colorado.json')).catch(function () { return null; }),
      DS.getJSON(DS.baseData('dda-colorado.json')).catch(function () { return null; }),
      DS.getJSON(DS.baseData('environmental/epa-superfund-co.json')).catch(function () { return null; }),
      DS.getJSON(DS.baseData('policy/soft-funding-status.json')).catch(function () { return null; }),
      DS.getJSON(DS.baseData('policy/chfa-awards-historical.json')).catch(function () { return null; }),
      DS.getJSON(DS.baseData('policy/county-ownership.json')).catch(function () { return null; })
    ]).then(function (results) {
      initOverlayLayers(results[0], results[1], results[2]);

      // Load constraint module data (Phase 2.1)
      var envScreening = window.EnvironmentalScreening;
      if (envScreening && typeof envScreening.load === 'function') {
        // Load FEMA flood zones via fetchWithTimeout (GeoJSON extension)
        var femaUrl = DS.baseData('environmental/fema-flood-co.geojson');
        var femaFetch = (typeof window.fetchWithTimeout === 'function')
          ? window.fetchWithTimeout(femaUrl, {}, 10000, 1)
              .then(function (r) { return r.ok ? r.json() : null; })
          : fetch(femaUrl)
              .then(function (r) { return r.ok ? r.json() : null; });
        femaFetch
          .catch(function () { return null; })
          .then(function (floodGeoJSON) {
            envScreening.load(floodGeoJSON, results[3]);
          });
      }

      var fundTracker = window.SoftFundingTracker;
      if (fundTracker && typeof fundTracker.load === 'function' && results[4]) {
        fundTracker.load(results[4]);
      }

      var chfaPredictor = window.CHFAAwardPredictor;
      if (chfaPredictor && typeof chfaPredictor.load === 'function' && results[5]) {
        chfaPredictor.load(results[5]);
      }

      var landOverlay = window.PublicLandOverlay;
      if (landOverlay && typeof landOverlay.load === 'function' && results[6]) {
        landOverlay.load(results[6]);
      }
    }).catch(function (e) {
      console.warn('[market-analysis] Overlay load failed:', e);
    });
  }

  function placeSiteMarker(lat, lon) {
    siteLatLng = { lat: lat, lon: lon };
    // Keep PMAEngine shim up-to-date so other modules can read last site coords.
    if (window.PMAEngine) {
      window.PMAEngine._lastLat = lat;
      window.PMAEngine._lastLon = lon;
    }
    var L = window.L;
    if (!L) return;

    if (siteMarker) map.removeLayer(siteMarker);
    if (bufferCircle) map.removeLayer(bufferCircle);
    if (todCircle) map.removeLayer(todCircle);
    if (todMarkers) map.removeLayer(todMarkers);

    siteMarker = L.circleMarker([lat, lon], {
      radius: 8, color: 'var(--accent)', fillColor: 'var(--accent)',
      fillOpacity: 0.9, weight: 2
    }).addTo(map);

    var radiusMeters = bufferMiles * 1609.34;
    bufferCircle = L.circle([lat, lon], {
      radius: radiusMeters,
      color: 'var(--accent)', fillColor: 'var(--accent)',
      fillOpacity: 0.05, weight: 1.5, dashArray: '6 4'
    }).addTo(map);

    // ½-mile TOD isochrone — CHFA awards 3 points for transit-oriented development
    var HALF_MILE_M = 804.67;
    todCircle = L.circle([lat, lon], {
      radius: HALF_MILE_M,
      color: '#0ea5e9', fillColor: '#0ea5e9',
      fillOpacity: 0.06, weight: 2, dashArray: '4 4'
    }).addTo(map);
    todCircle.bindTooltip('½-mile TOD zone (CHFA 3 pts)', { sticky: true, className: 'pma-tooltip' });

    // Highlight transit stops within ½ mile
    _highlightTodTransit(lat, lon, HALF_MILE_M);

    // Walking + biking concentric rings (toggleable; off by default)
    _refreshIsochroneRings(lat, lon);

    setText('pmaSiteCoords', lat.toFixed(5) + ', ' + lon.toFixed(5));
  }

  /**
   * Build the walking + biking concentric-ring overlay around (lat, lon).
   *
   * Rings are computed as straight-line buffers (matching how CHFA QAP
   * scoring works for transit/amenity proximity points) — not network
   * isochrones. A future enhancement could fetch real network-aware
   * isochrones from OSRM or Valhalla and cache per-site, but for screening
   * the straight-line approximation is what reviewers actually use.
   *
   * Honors the #pmaIsochroneToggle checkbox: rings are only added to the
   * map when checked, but the layer is built either way so toggling on/off
   * is instant.
   */
  function _refreshIsochroneRings(lat, lon) {
    var L = window.L;
    if (!L || !map) return;

    // Tear down any existing ring layer
    if (isochroneRingsLayer) {
      if (map.hasLayer(isochroneRingsLayer)) map.removeLayer(isochroneRingsLayer);
      isochroneRingsLayer = null;
    }

    var rings = [];
    for (var i = 0; i < ISOCHRONE_RINGS.length; i++) {
      var r = ISOCHRONE_RINGS[i];
      var radiusMeters = r.miles * 1609.34;
      var ring = L.circle([lat, lon], {
        radius: radiusMeters,
        color: r.color,
        fillColor: r.color,
        fillOpacity: 0.0,                 // fill off — rings only, not solid disks
        weight: 1.5,
        dashArray: r.mode === 'walk' ? '4 4' : '6 8',
        interactive: true
      });
      var label = (r.miles < 1
        ? (r.miles * 5280).toFixed(0) + ' ft'
        : r.miles + ' mi') +
        ' · ' + (r.mode === 'walk' ? 'walking' : 'biking');
      ring.bindTooltip(label, { sticky: true, className: 'pma-tooltip' });
      rings.push(ring);
    }
    isochroneRingsLayer = L.featureGroup(rings);

    var cb = document.getElementById('pmaIsochroneToggle');
    if (cb && cb.checked) {
      isochroneRingsLayer.addTo(map);
    }
  }

  /**
   * Find transit stops within ½ mile and render as highlighted markers.
   * Also counts them for the TOD score panel.
   */
  function _highlightTodTransit(lat, lon, radiusM) {
    var L = window.L;
    if (!L) return;
    if (todMarkers) map.removeLayer(todMarkers);
    todMarkers = L.layerGroup().addTo(map);

    var halfMile = radiusM / 1609.34; // convert to miles for haversine
    var count = 0;

    // Check cached transit stops layer first
    var transitStopsLayer = _mapLayers['transitStops'];
    if (transitStopsLayer) {
      transitStopsLayer.eachLayer(function (layer) {
        var ll = layer.getLatLng ? layer.getLatLng() : null;
        if (!ll) return;
        if (haversine(lat, lon, ll.lat, ll.lng) <= halfMile) {
          count++;
          L.circleMarker([ll.lat, ll.lng], {
            radius: 7, fillColor: '#facc15', color: '#0ea5e9',
            weight: 2, fillOpacity: 0.9
          }).bindTooltip((layer.feature && layer.feature.properties && layer.feature.properties.name) || 'Transit stop',
            { sticky: true, className: 'pma-tooltip' }
          ).addTo(todMarkers);
        }
      });
    }

    // Also check the neighborhood_access / OSM amenities data
    if (!count) {
      var amenities = window.OsmAmenities;
      if (amenities && typeof amenities.getNearestByType === 'function') {
        var nearby = amenities.getNearestByType('transit_stop', lat, lon, halfMile);
        if (nearby && nearby.length) {
          nearby.forEach(function (a) {
            count++;
            L.circleMarker([a.lat, a.lon], {
              radius: 7, fillColor: '#facc15', color: '#0ea5e9',
              weight: 2, fillOpacity: 0.9
            }).bindTooltip(a.name || 'Transit stop', { sticky: true, className: 'pma-tooltip' })
             .addTo(todMarkers);
          });
        }
      }
    }

    // Update TOD panel
    var todPanel = document.getElementById('pmaTodPanel');
    var todContent = document.getElementById('pmaTodContent');
    if (todPanel && todContent) {
      todPanel.style.display = '';
      var eligible = count > 0;
      todContent.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
          '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;' +
          'background:' + (eligible ? 'var(--good,#16a34a)' : 'var(--bad,#dc2626)') + ';color:#fff;font-size:.85rem;font-weight:700">' +
          (eligible ? '✓' : '✗') + '</span>' +
          '<span style="font-weight:600;font-size:.95rem">' +
          (eligible ? 'TOD Eligible — 3 CHFA points' : 'No transit within ½ mile') +
          '</span>' +
        '</div>' +
        '<div style="font-size:.82rem;color:var(--muted)">' +
          count + ' transit stop' + (count !== 1 ? 's' : '') + ' within ½-mile walking distance' +
          (eligible ? '. Site qualifies for Transit-Oriented Development scoring under CHFA QAP §5.B.' : '.') +
        '</div>';
    }

    return count;
  }

  /* ── Buffer selector ─────────────────────────────────────────────── */
  function bindBufferSelect() {
    var sel = el('pmaBufferSelect');
    if (!sel) return;
    sel.addEventListener('change', function () {
      bufferMiles = parseInt(sel.value, 10) || 5;
      if (siteLatLng) {
        placeSiteMarker(siteLatLng.lat, siteLatLng.lon);
        runAnalysis(siteLatLng.lat, siteLatLng.lon);
      }
    });
  }

  /* ── Re-run button ───────────────────────────────────────────────── */
  function bindRunBtn() {
    var btn = el('pmaRunBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (siteLatLng) runAnalysis(siteLatLng.lat, siteLatLng.lon);
    });
  }

  /* ── AMI mix inputs ─────────────────────────────────────────────── */
  function bindAmiInputs() {
    ['pmaProposedUnits','pmaAmi30','pmaAmi40','pmaAmi50','pmaAmi60','pmaAmi80'].forEach(function (id) {
      var inp = el(id);
      if (!inp) return;
      inp.addEventListener('input', function () {
        if (lastResult) updateSimulator(lastResult);
      });
    });
  }

  /* ── Export ─────────────────────────────────────────────────────── */
  function exportJson() {
    if (!lastResult) return;
    var blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pma-result.json';
    a.click();
  }

  function exportCsv() {
    if (!lastResult) return;
    var r = lastResult;
    var d = r.dimensions;
    var rows = [
      ['field', 'value'],
      ['overall_score', r.overall],
      ['tier', scoreTier(r.overall).label],
      ['lat', r.lat],
      ['lon', r.lon],
      ['buffer_miles', r.bufferMiles],
      ['tract_count', r.tractCount],
      ['renter_hh', r.acs.renter_hh],
      ['cost_burden_rate', r.acs.cost_burden_rate],
      ['median_gross_rent', r.acs.median_gross_rent],
      ['median_hh_income', r.acs.median_hh_income],
      ['vacancy_rate', r.acs.vacancy_rate],
      ['lihtc_count', r.lihtcCount],
      ['lihtc_units', r.lihtcUnits],
      ['capture_rate', r.capture],
      ['dim_demand', d.demand],
      ['dim_capture_risk', d.captureRisk],
      ['dim_rent_pressure', d.rentPressure],
      ['dim_land_supply', d.landSupply],
      ['dim_workforce', d.workforce],
      ['confidence_score', r.confidence ? r.confidence.score : ''],
      ['confidence_level', r.confidence ? r.confidence.level : ''],
      ['confidence_completeness', r.confidence ? r.confidence.factors.completeness : ''],
      ['confidence_freshness', r.confidence ? r.confidence.factors.freshness : ''],
      ['confidence_lihtc_coverage', r.confidence ? r.confidence.factors.lihtcCoverage : ''],
      ['confidence_sample_size', r.confidence ? r.confidence.factors.sampleSize : ''],
      ['confidence_buffer_depth', r.confidence ? r.confidence.factors.bufferDepth : '']
    ];
    var csv = rows.map(function (row) { return row.join(','); }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pma-result.csv';
    a.click();
  }

  function exportWithFullMetadata() {
    if (!lastResult) return;
    var ENH = window.PMAEnhancements;
    if (!ENH) { exportJson(); return; }
    var payload = ENH.exportWithMetadata(
      lastResult,
      lastQuality,
      lastScenarios,
      lastBenchmark,
      lastPipeline
    );
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pma-result-full-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
  }

  function bindExport() {
    var jsonBtn = el('pmaExportJson');
    var csvBtn  = el('pmaExportCsv');
    var metaBtn = el('pmaExportMeta');
    if (jsonBtn) jsonBtn.addEventListener('click', exportJson);
    if (csvBtn)  csvBtn.addEventListener('click', exportCsv);
    if (metaBtn) metaBtn.addEventListener('click', exportWithFullMetadata);
  }

  /* ── Data loading ───────────────────────────────────────────────── */
  function loadData() {
    var DS = window.DataService;
    if (!DS) { console.error('[market-analysis] DataService not available'); return Promise.reject(new Error('DataService missing')); }
    // Load Prop 123 jurisdictions in parallel (non-fatal if unavailable)
    DS.getJSON(DS.baseData('policy/prop123_jurisdictions.json')).then(function (data) {
      var list = (data && data.jurisdictions) ? data.jurisdictions : (Array.isArray(data) ? data : []);
      prop123Jurisdictions = list;
    }).catch(function () { /* optional data — ignore errors */ });

    // Load reference projects for benchmarking (non-fatal)
    DS.getJSON(DS.baseData('market/reference-projects.json')).then(function (data) {
      referenceProjects = data || null;
    }).catch(function () { /* optional — ignore errors */ });

    // Load each file individually so we can report specific failures
    var WORKFLOW_HINT = 'Run the "Generate Market Analysis Data" GitHub Actions workflow.';
    var KEY_HINT = '(requires CENSUS_API_KEY secret)';

    function fetchFile(path) {
      return DS.getJSON(DS.baseData(path)).catch(function (e) {
        return { _loadError: true, _missing: true, _msg: e && e.message };
      });
    }

    return Promise.all([
      fetchFile('market/tract_centroids_co.json'),
      fetchFile('market/acs_tract_metrics_co.json'),
      (window.HudLihtc ? window.HudLihtc.load() : fetchFile('market/hud_lihtc_co.geojson')).catch(function (e) {
        return { _loadError: true, _missing: true, _msg: e && e.message };
      })
    ]).then(function (results) {      var statusParts = [];

      var tractData = results[0];
      if (tractData && tractData._loadError) {
        statusParts.push('Tract centroid data missing — ' + WORKFLOW_HINT);
        tractCentroids = { tracts: [] };
      } else {
        tractCentroids = tractData || { tracts: [] };
        if (!(tractCentroids.tracts || []).length) {
          statusParts.push('Tract centroid data is empty — ' + WORKFLOW_HINT);
        }
      }

      var acsData = results[1];
      if (acsData && acsData._loadError) {
        statusParts.push('ACS tract metrics missing — ' + WORKFLOW_HINT + ' ' + KEY_HINT);
        acsMetrics = { tracts: [] };
      } else {
        acsMetrics = acsData || { tracts: [] };
        if (!(acsMetrics.tracts || []).length) {
          statusParts.push('ACS tract metrics empty — ' + WORKFLOW_HINT + ' ' + KEY_HINT);
        } else if (window.PMADataCache) {
          // Persist the successfully loaded ACS data globally so subsequent
          // runAnalysis() calls can recover it if the module variable is stale.
          window.PMADataCache.set('acsMetrics', acsMetrics);
          window.PMADataCache.set('tractCentroids', tractData || tractCentroids);
        }
      }

      var lihtcData = results[2];
      if (lihtcData && lihtcData._loadError) {
        console.warn('[market-analysis] LIHTC data missing:', lihtcData._msg);
        lihtcFeatures = [];
        lihtcLoadError = true;
      } else {
        lihtcFeatures = (lihtcData && lihtcData.features) || [];
        lihtcLoadError = false;
      }

      dataLoaded = true;
      // Hide the map loading overlay now that data is ready.
      var mapOverlay = document.getElementById('pmaMapLoadingOverlay');
      if (mapOverlay) mapOverlay.style.display = 'none';
      // Load workforce data connectors in parallel (non-fatal if any fail)
      var workforcePromises = [
        window.LodesCommute  ? window.LodesCommute.loadMetrics().catch(function () {}) : Promise.resolve(),
        window.CdleJobs      ? window.CdleJobs.loadMetrics().catch(function () {})     : Promise.resolve(),
        window.CdeSchools    ? window.CdeSchools.loadMetrics().catch(function () {})   : Promise.resolve(),
        window.CdotTraffic   ? window.CdotTraffic.loadMetrics().catch(function () {})  : Promise.resolve()
      ];
      Promise.all(workforcePromises).then(function () {
        workforceDataLoaded = true;
      });

      // Load NHPD preservation data (for competitive set subsidy expiry analysis)
      if (window.Nhpd && typeof window.Nhpd.loadFromGeoJSON === 'function') {
        DS.getJSON(DS.baseData('market/nhpd_co.geojson'))
          .then(function (gj) {
            if (gj && gj.features) {
              window.Nhpd.loadFromGeoJSON(gj);
              console.log('[market-analysis] NHPD loaded: ' + gj.features.length + ' properties');
            }
          })
          .catch(function () { console.warn('[market-analysis] NHPD data unavailable (non-critical)'); });
      }

      // Load DOLA county demographics (non-fatal — supplements ACS with more
      // current population/housing estimates from the CO State Demography Office).
      DS.getJSON(DS.baseData('market/dola_demographics_co.json'))
        .then(function (data) {
          if (data && data.counties && !data.meta.error) {
            dolaData = data;
            if (window.PMADataCache) {
              window.PMADataCache.set('dolaData', data);
            }
            console.log('[market-analysis] DOLA data loaded: ' +
              Object.keys(data.counties).length + ' counties (' + (data.meta.year || '?') + ')');
          }
        })
        .catch(function () {
          console.warn('[market-analysis] DOLA demographics unavailable (optional enrichment)');
        });

      // Load OSM amenity seed data into OsmAmenities connector (non-fatal).
      if (window.OsmAmenities && DS) {
        DS.getJSON(DS.baseData('derived/market-analysis/neighborhood_access.json'))
          .then(function (data) {
            var records = data && Array.isArray(data.amenities) ? data.amenities : [];
            if (records.length > 0) {
              window.OsmAmenities.loadAmenities(records);
            }
          })
          .catch(function (e) {
            console.warn('[market-analysis] neighborhood_access.json unavailable:', e && e.message);
          });
      }

      // Data quality assessment
      var DQ = window.PMADataQuality;
      if (DQ) {
        lastQuality = DQ.calculateDataQuality(acsMetrics, lihtcFeatures, tractCentroids);
        renderDataQualityBanner(lastQuality, tractData && tractData.meta, lihtcData && lihtcData.meta);
      }

      var hint = el('pmaDataStatus');
      if (statusParts.length > 0) {
        if (hint) hint.textContent = 'Data warning: ' + statusParts.join(' ');
      } else {
        if (hint) hint.textContent = 'Data loaded — click map to begin analysis.';
      }

      var tsEl = el('pmaDataTimestamp');
      if (tsEl) {
        var generated = (tractData && tractData.meta && tractData.meta.generated) || null;
        if (generated) {
          tsEl.textContent = 'Data as of ' + generated;
        } else {
          tsEl.textContent = 'Data as of ' + new Date().toLocaleDateString();
        }
      }
    });
  }

  /* ── Data quality banner render ──────────────────────────────────── */
  function renderDataQualityBanner(quality, tractMeta, lihtcMeta) {
    var DQ = window.PMADataQuality;
    var banner = el('pmaDataQualityBanner');
    if (!banner || !DQ || !quality) return;

    // Coverage pills
    var acsEl    = el('pmaQualityAcs');
    var lihtcEl  = el('pmaQualityLihtc');
    var tracksEl = el('pmaQualityTracks');
    if (acsEl)    acsEl.textContent    = 'ACS ' + quality.counts.acs + '/' + quality.thresholds.acs.target;
    if (lihtcEl)  lihtcEl.textContent  = 'LIHTC ' + quality.counts.lihtc + '/' + quality.thresholds.lihtc.target;
    if (tracksEl) tracksEl.textContent = 'Tracts ' + quality.counts.centroids + '/' + quality.thresholds.centroids.target;

    // Color-code coverage pills
    function coverageColor(actual, minimum, target) {
      if (actual >= target)   return 'var(--good)';
      if (actual >= minimum)  return 'var(--warn)';
      return 'var(--bad)';
    }
    if (acsEl)    acsEl.style.color    = coverageColor(quality.counts.acs,       DQ.THRESHOLDS.acs.minimum,       DQ.THRESHOLDS.acs.target);
    if (lihtcEl)  lihtcEl.style.color  = coverageColor(quality.counts.lihtc,     DQ.THRESHOLDS.lihtc.minimum,     DQ.THRESHOLDS.lihtc.target);
    if (tracksEl) tracksEl.style.color = coverageColor(quality.counts.centroids, DQ.THRESHOLDS.centroids.minimum, DQ.THRESHOLDS.centroids.target);

    // Statewide coverage label
    var cov = computeCoverage();
    var covEl = el('pmaStatewideCoverage');
    if (covEl) {
      covEl.textContent = cov.label;
      covEl.style.color = cov.isProductionReady ? 'var(--good)' : 'var(--warn)';
    }

    // Production-readiness warning banner
    var prodWarnEl = el('pmaCoverageWarning');
    if (prodWarnEl) {
      if (!cov.isProductionReady) {
        prodWarnEl.textContent = '⚠ Data coverage is below production scale (' + cov.pct +
          '% of ~' + cov.expected + ' statewide tracts) — results may not represent the full PMA.';
        prodWarnEl.style.display = '';
      } else {
        prodWarnEl.style.display = 'none';
      }
    }

    // Confidence badge
    var confEl = el('pmaConfidenceScore');
    if (confEl) {
      var conf = quality.confidence;
      confEl.textContent = Math.round(conf * 100) + '% — ' + quality.label.text;
      confEl.style.color = quality.label.color;
    }

    // Freshness
    var freshEl = el('pmaFreshnessIndicator');
    if (freshEl) {
      var generated = (tractMeta && tractMeta.generated) || null;
      var freshness = DQ.checkDataFreshness(generated);
      freshEl.textContent = freshness.text;
      freshEl.style.color = freshness.color;
    }

    // Warnings
    var validation = DQ.validateMarketData(acsMetrics, lihtcFeatures, tractCentroids);
    var warnEl = el('pmaQualityWarnings');
    if (warnEl) {
      var msgs = validation.errors.concat(validation.warnings);
      if (msgs.length > 0) {
        warnEl.innerHTML = msgs.map(function (m) {
          return '<div class="pma-quality-warn-item">⚠ ' + m + '</div>';
        }).join('');
        warnEl.style.display = '';
      } else {
        warnEl.style.display = 'none';
      }
    }

    banner.style.display = '';
  }

  /* ── Init ───────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    initMap();
    initLayerToggles();
    bindBufferSelect();
    bindRunBtn();
    bindAmiInputs();
    bindExport();

    // Walking + biking isochrone rings toggle. The layer is rebuilt every
    // time the site moves; here we just show/hide the cached layer.
    var isoCb = document.getElementById('pmaIsochroneToggle');
    if (isoCb) {
      isoCb.addEventListener('change', function () {
        if (!isochroneRingsLayer) return;
        if (isoCb.checked) {
          if (!map.hasLayer(isochroneRingsLayer)) isochroneRingsLayer.addTo(map);
        } else {
          if (map.hasLayer(isochroneRingsLayer)) map.removeLayer(isochroneRingsLayer);
        }
      });
    }

    // Validate required modules are available.
    ['DataService', 'MAState', 'MARenderers', 'SiteSelectionScore', 'MAController'].forEach(function (name) {
      if (!window[name]) {
        console.warn('[market-analysis] module not found: ' + name);
      }
    });

    // Filter commuting flow arcs to site buffer when PMA analysis runs
    var _allFlowArcs = null; // cache full dataset
    document.addEventListener('pma-site-selected', function (e) {
      var site = e.detail;
      if (!site || !site.lat || !site.lon) return;

      // If commutingFlows layer isn't loaded yet, nothing to filter
      if (!_mapLayers['commutingFlows'] && !_allFlowArcs) return;

      // Cache full arc dataset on first filter
      if (!_allFlowArcs && _mapLayers['commutingFlows']) {
        _allFlowArcs = _mapLayers['commutingFlows'].toGeoJSON();
      }
      if (!_allFlowArcs || !_allFlowArcs.features) return;

      var bufMi = site.bufferMiles || 5;
      // Expand filter radius to catch arcs that start/end near the site
      var filterRadius = Math.max(bufMi * 2, 15);

      // Haversine for filtering
      function _hav(lat1, lon1, lat2, lon2) {
        var R = 3958.8;
        var dL = (lat2 - lat1) * Math.PI / 180;
        var dO = (lon2 - lon1) * Math.PI / 180;
        var a = Math.sin(dL / 2) * Math.sin(dL / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dO / 2) * Math.sin(dO / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }

      var filtered = _allFlowArcs.features.filter(function (f) {
        if (!f.geometry || !f.geometry.coordinates || f.geometry.coordinates.length < 2) return false;
        var home = f.geometry.coordinates[0]; // [lon, lat]
        var work = f.geometry.coordinates[1];
        var dHome = _hav(site.lat, site.lon, home[1], home[0]);
        var dWork = _hav(site.lat, site.lon, work[1], work[0]);
        // Keep arcs where either endpoint is within filter radius
        return dHome <= filterRadius || dWork <= filterRadius;
      });

      // Remove old layer and replace with filtered
      if (_mapLayers['commutingFlows'] && map.hasLayer(_mapLayers['commutingFlows'])) {
        map.removeLayer(_mapLayers['commutingFlows']);
      }

      var cfg = LAYER_CONFIG['commutingFlows'];
      var opts = {};
      opts.style = function (feature) {
        var p = feature.properties || {};
        var jobs = p.jobs || 0;
        var dist = p.distance_miles || 0;
        var weight = Math.max(1.5, Math.min(6, 1 + Math.log10(Math.max(jobs, 1)) * 1.5));
        var color = dist > 30 ? '#ef4444' : dist > 15 ? '#f59e0b' : '#6366f1';
        var opacity = Math.max(0.25, Math.min(0.7, jobs / 500));
        return { color: color, weight: weight, opacity: opacity };
      };
      opts.onEachFeature = function (feature, layer) {
        var p = feature.properties || {};
        var wageBreak = '';
        if (p.low_wage || p.mid_wage || p.high_wage) {
          wageBreak = '<br>Low: ' + (p.low_wage || 0).toLocaleString() +
            ' · Mid: ' + (p.mid_wage || 0).toLocaleString() +
            ' · High: ' + (p.high_wage || 0).toLocaleString();
        }
        var tip = '<b>' + (p.jobs || 0).toLocaleString() + ' commuters</b>' +
          '<br>Home: ' + p.home_tract + ' → Work: ' + p.work_tract +
          '<br>Distance: ' + (p.distance_miles || 0) + ' mi' + wageBreak;
        layer.bindTooltip(tip, { sticky: true, className: 'pma-tooltip' });
      };

      _mapLayers['commutingFlows'] = L.geoJSON(
        { type: 'FeatureCollection', features: filtered },
        opts
      );

      // Only add to map if checkbox is checked
      var cb = document.querySelector('[data-layer="commutingFlows"]');
      if (cb && cb.checked) {
        _mapLayers['commutingFlows'].addTo(map);
      }
      _showLayerToast('✓ Commuting arcs: ' + filtered.length + ' near site (of ' + _allFlowArcs.features.length + ')', false);
    });

    // Listen for live Regrid parcel data from controller
    document.addEventListener('regrid-parcels-loaded', function (e) {
      var gj = e.detail;
      if (!gj || !gj.features || !gj.features.length) return;
      // Replace or merge into parcelZoning layer
      if (_mapLayers['parcelZoning'] && map) {
        map.removeLayer(_mapLayers['parcelZoning']);
      }
      var cfg = LAYER_CONFIG['parcelZoning'];
      var opts = {};
      if (cfg && cfg.pointStyle) {
        opts.pointToLayer = function (feature, latlng) {
          var ps = Object.assign({}, cfg.pointStyle);
          var fp = feature.properties || {};
          var zp = fp.zone_proxy || '';
          ps.fillColor = zp === 'multifamily_residential' ? '#10b981'
            : zp === 'vacant_developable' ? '#f59e0b'
            : zp === 'commercial' ? '#6b7280' : '#8b5cf6';
          ps.radius = (fp.mf_suitability || 50) >= 70 ? 6 : 4;
          return L.circleMarker(latlng, ps);
        };
      }
      opts.onEachFeature = function (feature, layer) {
        var p = feature.properties || {};
        var tip = '<b>' + (p.address || p.zone_proxy || 'Parcel').replace(/_/g, ' ') + '</b>' +
          (p.zoning ? '<br>Zoning: ' + p.zoning : '') +
          (p.landUseCode ? '<br>Use: ' + p.landUseCode : '') +
          (p.acres ? '<br>Acres: ' + parseFloat(p.acres).toFixed(2) : '') +
          '<br>MF Score: ' + (p.mf_suitability || 0) +
          '<br><span style="font-size:.75em;opacity:.7">Source: Regrid API</span>';
        layer.bindTooltip(tip, { sticky: true, className: 'pma-tooltip' });
      };
      _mapLayers['parcelZoning'] = L.geoJSON(gj, opts);
      // Only add to map if the checkbox is checked
      var cb = document.querySelector('[data-layer="parcelZoning"]');
      if (cb && cb.checked) {
        _mapLayers['parcelZoning'].addTo(map);
      }
      _showLayerToast('✓ Regrid parcels (' + gj.features.length + ')', false);
    });

    loadData().then(function () {
      // Load overlay layers after main data is ready (lihtcFeatures now set)
      loadOverlays();
    }).catch(function (err) {
      console.error('[market-analysis] loadData() failed:', err);
      dataLoaded = true;
      var mapOverlay = document.getElementById('pmaMapLoadingOverlay');
      if (mapOverlay) { mapOverlay.textContent = 'Data service unavailable — click to place a site.'; }
      var hint = el('pmaDataStatus');
      if (hint) hint.textContent = 'Warning: data service unavailable.';
      loadOverlays();
    });
  });

  /* ── PMA polygon generator (buffer | commuting | hybrid) ────────── */
  /**
   * Generate a PMA polygon using one of three methods:
   *   "buffer"    – legacy circular buffer (existing behaviour)
   *   "commuting" – LEHD/LODES commuting-flow polygon via PMACommuting
   *   "hybrid"    – commuting polygon further constrained by schools + transit
   *
   * @param {number} lat
   * @param {number} lon
   * @param {string} [method]      - "buffer" | "commuting" | "hybrid" (default: "buffer")
   * @param {number} [bufferMiles] - radius for buffer method (default: 5)
   * @returns {Promise<{polygon: object|null, method: string, captureRate: number}>}
   */
  function generatePmaPolygon(lat, lon, method, bufferMiles) {
    method      = method      || 'buffer';
    bufferMiles = bufferMiles || 5;

    if (method === 'buffer') {
      var commMod = window.PMACommuting;
      var poly = commMod
        ? commMod._buildCirclePolygon(lat, lon, bufferMiles, 32)
        : null;
      return Promise.resolve({ polygon: poly, method: 'buffer', captureRate: 0 });
    }

    var pmaComm = window.PMACommuting;
    if (!pmaComm) {
      // Fall back to buffer if module not loaded
      return generatePmaPolygon(lat, lon, 'buffer', bufferMiles);
    }

    return pmaComm.fetchLODESWorkplaces(lat, lon).then(function (lodesData) {
      var flowResult  = pmaComm.analyzeCommutingFlows(lodesData.workplaces || []);
      var boundResult = pmaComm.generateCommutingBoundary(lat, lon, flowResult);

      if (method === 'hybrid') {
        // Hybrid: commuting boundary + note on schools/transit alignment
        // (full spatial merge requires server-side; return commuting polygon with hybrid flag)
        return {
          polygon:     boundResult.boundary,
          method:      'hybrid',
          captureRate: boundResult.captureRate,
          zoneCentroids: boundResult.zoneCentroids
        };
      }

      return {
        polygon:     boundResult.boundary,
        method:      'commuting',
        captureRate: boundResult.captureRate,
        zoneCentroids: boundResult.zoneCentroids
      };
    }).catch(function () {
      return generatePmaPolygon(lat, lon, 'buffer', bufferMiles);
    });
  }

  // Expose for testing
  window.PMAEngine = {
    _map:                    function () { return map; },
    haversine:               haversine,
    tractInBuffer:           tractInBuffer,
    computePma:              computePma,
    computeCoverage:         computeCoverage,
    generatePmaPolygon:      generatePmaPolygon,
    simulateCapture:         simulateCapture,
    scoreTier:               scoreTier,
    aggregateAcs:            aggregateAcs,
    isInProp123Jurisdiction: isInProp123Jurisdiction,
    scoreWorkforce:          scoreWorkforce,
    WEIGHTS:                 WEIGHTS,
    RISK:                    RISK,
    STATEWIDE_TRACT_COUNT:   STATEWIDE_TRACT_COUNT,
    COVERAGE_PRODUCTION_THRESHOLD: COVERAGE_PRODUCTION_THRESHOLD,
    OVERLAY_STYLES:          OVERLAY_STYLES,
    _state: {
      getLihtcLoadError:    function () { return lihtcLoadError; },
      getLastResult:        function () { return lastResult; },
      getLastQuality:       function () { return lastQuality; },
      getLastBenchmark:     function () { return lastBenchmark; },
      getLastPipeline:      function () { return lastPipeline; },
      getLastScenarios:     function () { return lastScenarios; },
      getLastConfidence:    function () { return lastConfidence; },
      getReferenceProjects: function () { return referenceProjects; },
      getDolaData:          function () { return dolaData; }
    }
  };

}());
