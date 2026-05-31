/**
 * js/lihtc-opportunity-finder.js
 *
 * JURISDICTION-LEVEL LIHTC opportunity analyzer.
 *
 * Per user feedback (2026-05-25): the original tract-level rollup
 * answered "which polygon" when the actual workflow needs "which
 * jurisdiction to target." This rebuild rolls every signal up to the
 * place (city / town / CDP) level so a developer can scan a sortable
 * table of CO jurisdictions and target candidates for 4% bond rounds
 * or 9% competitive rounds.
 *
 * Per jurisdiction we compute:
 *   - # of QCTs intersecting the place (via place-tract-membership)
 *   - DDA designation (containing county is one of CO's 10 nonmetro DDAs)
 *   - All LIHTC projects in the jurisdiction (matched by PROJ_CTY)
 *   - Last YR_PIS + years-since
 *   - HNA Scorecard composite for the containing county
 *   - Population (from co_ami_gap_by_place's implied HH counts)
 *   - Opportunity score, weighted differently for 4% vs 9% targets
 *
 * Score weights by target:
 *   9% Competitive:  40% recency · 30% need · 20% basis-boost · 10% pop
 *   4% Bond:         25% recency · 25% need · 15% basis-boost · 35% pop
 *   Any (balanced):  35% recency · 30% need · 20% basis-boost · 15% pop
 *
 * Rationale: 9% awards reward geographic-gap + housing-need scoring;
 * QCT/DDA basis boost is competitive. 4% bond deals are scale-driven —
 * need a population base for 100-200 unit absorption. Both benefit from
 * basis boost but it's less of the differentiator in 4%.
 *
 * Sources: HUD QCT + DDA designations, CHFA/HUD LIHTC project data,
 * data/hna/place-tract-membership.json (TIGER 2024 spatial join),
 * data/co_ami_gap_by_place.json (per-place HHs from ACS), CHAS county
 * cost-burden composite, geo-config place labels.
 */

(function () {
  'use strict';

  /* ── State ────────────────────────────────────────────────────────── */

  var state = {
    qctTractIds: new Set(),         // Set of tract GEOIDs that are QCTs
    ddaCountyFips: new Set(),       // Set of 5-digit county FIPS designated as DDA
    ddaFeatures: [],                // raw DDA polygons (for map rendering)
    placeMembership: {},            // place geoid → { name, tracts:[{tract_geoid, share_of_place_area}] }
    placeFromAmi: {},               // place geoid → AMI/HHs row (for population)
    projects: [],                   // CHFA/HUD LIHTC project points (filtered to valid YR_PIS)
    chasByFips: {},                 // 5-digit county FIPS → CHAS county record
    countyName: {},                 // 5-digit county FIPS → display name
    placeMeta: {},                  // place geoid → { label, containingCounty, type }
    tractCentroids: {},             // tract geoid (11-digit) → { lat, lon } — WARNING: data/market/tract_centroids_co.json has scrambled GEOID→coord pairings; do NOT use for marker anchors. See Appendix A.2 of repo audit.
    countyCentroid: {},             // 5-digit county FIPS → { lat, lng } — RELIABLE; derived from co-county-boundaries polygons
    countyRegion: {},               // 5-digit county FIPS → region label (Front Range, Western Slope, etc.)
    countyBoundaries: null,         // GeoJSON FeatureCollection for CO counties (overlay layer)
    preservationByCity: {},         // city name (uppercase) → preservation-candidate property count
    lihtcByCity: {},                // city name (uppercase) → { count, ninePctCount, fourPctCount, statePaired, units }
    marketByCounty: {},             // 5-digit county FIPS → { fmr2br, lihtc60ami2br, captureAdvantage } — F10
    placeCentroid: {},              // 7-digit place GEOID → { lat, lng } from 2024 Census Gazetteer — F16
    pabByGeoid: {},                 // geoid (place or county FIPS) → PAB direct allocation record — F25
    pabMeta: null,                  // PAB allocations metadata (year, rate, caveat) — F25
    placeOdFlows: {},               // geoid → { within, inflow, outflow, jobs, residentWorkers, ... } — F58
    placeOdFlowsMeta: null,         // block-OD source metadata (vintage, scope) — F58
    // Q5: Zillow ZORI market-rent index. Index from data/market/zori_rents_co.json.
    // Used to enrich the Capture-column tooltip with ZORI alongside HUD FMR.
    zoriByCounty: {},               // 5-digit FIPS → { name, rent, yoy_change_pct, vintage_month }
    zoriByCity: {},                 // normalized place key → { name, rent, yoy_change_pct, ... }
    zoriMeta: null,                 // ZORI source meta (vintage_month etc.)
    zoriStatewideMedian: null,
    policyScores: {},               // geoid (5- or 7-digit) → { totalScore, dimensions } from policy scorecard
    localResources: {},             // "county:FIPS" / "place:FIPS" / "cdp:FIPS" → { prop123, housingAuthority, housingLead, housingPlans, advocacy }
    prop123ByName: {},              // upper-cased jurisdiction name → prop123 record (filing date, fast-track)
    opportunities: [],
    map: null,
    layers: { jurisdiction: null, dda: null, qct: null, highlight: null },
    selectedId: null,
    sortKey: 'score',
    sortDir: 'desc',
    filters: {
      target: '9pct',     // '9pct' | '4pct' | 'any'
      // Basis-boost designation requirement. Mutually-exclusive radio:
      //   'both'   — must have BOTH QCT AND DDA (default; strongest case)
      //   'either' — has QCT OR DDA (any basis-boost eligible jurisdiction)
      //   'qct'    — has QCT only (and explicitly NOT in a DDA county)
      //   'dda'    — has DDA only (and explicitly NOT in a QCT)
      //   'none'   — no requirement (all 482 jurisdictions including non-eligible)
      // F13: default basis widened from 'both' to 'either' so that with the
      // capture filter ON (default), users still see a meaningful shortlist
      // (~5-15 jurisdictions) instead of just 1. Old combo (both + capture)
      // collapsed to a single-row table. Users who want only-strongest-case
      // can still pick 'QCT + DDA (both)' from the radio.
      basis: 'either',
      county: '',
      region: '',         // '' | 'Front Range' | 'Mountains' | 'Western Slope' | 'Southwest' | 'San Luis Valley' | 'Eastern Plains'
      minYearsSince: 0,
      minScore: 0,
      minPop: 0,
      minPreservation: 0,    // # preservation candidates required in jurisdiction
      onlyUrgentPres: false, // require >=1 USDA RD property expiring ≤5y
      includeCdps: false, // CDPs aren't incorporated; LIHTC typically goes in incorporated places
      // F13: capture filter now ON by default (F10 had it OFF). Was the
      // single biggest UX failure — new users saw Crowley County towns
      // at #1, which all have NEGATIVE capture advantage (LIHTC 60% AMI
      // rent ABOVE local FMR). Users trusted the ranking and wasted time
      // chasing unviable markets. ON by default now; users who want to
      // see those edge cases can toggle the checkbox off.
      requireCapture: true
    }
  };

  var CURRENT_YEAR = new Date().getFullYear();
  var MAX_RECENCY_YEARS = 25;

  /* ── Score weights by target ──────────────────────────────────────── */
  // 5-dimension weighting per methodology §4. Each target's row sums to 1.0.
  // Civic readiness now rolled into the composite (was surfaced-only before).
  // Old 4-dim weights (recency/need/basis/pop) preserved in comments for
  // git-blame readability; deleted from runtime.
  // Resort/recreational counties — known CO mountain-resort markets where
  // workforce-housing pressure is acute (high tourism employment, high cost
  // of living, limited developable land). Used by the Workforce/Resort
  // deal-type and by the resort-adjacency flag in the detail panel.
  // Source: CO Department of Local Affairs (DOLA) Resort Community
  // Workforce Housing Study + Colorado Tourism Office classifications.
  var RESORT_COUNTIES = {
    '08097': 'Pitkin (Aspen)',
    '08113': 'San Miguel (Telluride)',
    '08117': 'Summit (Breckenridge/Keystone)',
    '08037': 'Eagle (Vail/Beaver Creek)',
    '08107': 'Routt (Steamboat)',
    '08045': 'Garfield (Glenwood Springs)',
    '08067': 'La Plata (Durango/Purgatory)',
    '08049': 'Grand (Winter Park/Granby)',
    '08109': 'Saguache (Crestone/Joyful Journey)',
    '08093': 'Park (Fairplay/Bailey)',
    '08029': 'Delta (Powderhorn)',
    '08019': 'Clear Creek (Loveland Ski Area/Georgetown)',
    '08031': 'Denver (urban tourism)',  // edge case; not really resort
    '08051': 'Gunnison (Crested Butte)',
    '08077': 'Mesa (Grand Mesa)',
    '08083': 'Montezuma (Mesa Verde NP gateway)',
    '08007': 'Archuleta (Pagosa Springs)',
    '08055': 'Custer (Westcliffe)',
    '08065': 'Lake (Leadville)',
    '08015': 'Chaffee (Salida/Buena Vista)'
  };

  // CO counties with >25% federal land (BLM + USFS + NPS combined). These
  // jurisdictions have natural land-supply constraints + outdoor amenity
  // value, both of which matter for LIHTC deal feasibility (limited
  // developable acreage + workforce-housing premium adjacent to parks).
  // Source: BLM Public Land Statistics 2023 + USFS land status reports.
  var PUBLIC_LANDS_HEAVY_COUNTIES = new Set([
    '08097', // Pitkin
    '08113', // San Miguel
    '08117', // Summit
    '08037', // Eagle
    '08107', // Routt
    '08045', // Garfield
    '08067', // La Plata
    '08049', // Grand
    '08051', // Gunnison
    '08015', // Chaffee
    '08065', // Lake (~99% federal)
    '08079', // Mineral (~95% federal)
    '08109', // Saguache
    '08111', // San Juan (~93% federal)
    '08091', // Ouray
    '08083', // Montezuma
    '08007', // Archuleta
    '08055', // Custer
    '08027', // Custer area
    '08077', // Mesa
    '08093', // Park
    '08019', // Clear Creek
    '08047', // Gilpin
    '08033', // Dolores
    '08105'  // Rio Grande
  ]);

  // 5-dim composite weights per target deal type. F9 (2026-05-26) rebalanced:
  //   - 9pct  : civic 0.10 -> 0.18 (recency 0.30 -> 0.22). Prop 123 + housing
  //             authority infrastructure matter more than raw saturation gap.
  //   - 4pct  : civic 0.15 -> 0.18 (recency 0.15 -> 0.12). Bond deals depend
  //             on local soft-debt match + IZ ordinance more than the model
  //             previously credited.
  //   - workforce_resort : civic 0.15 -> 0.20 (pop 0.30 -> 0.25). Resort
  //             counties succeed when local government has a workforce-
  //             housing strategy in place.
  // Preservation + prop123_local + any unchanged — civic already weighted
  // appropriately for those targets.
  var SCORE_WEIGHTS = {
    '9pct':              { need: 0.30, recency: 0.22, basis: 0.15, pop: 0.15, civic: 0.18 },
    '4pct':              { need: 0.25, recency: 0.12, basis: 0.15, pop: 0.30, civic: 0.18 },
    'preservation':      { need: 0.20, recency: 0.15, basis: 0.35, pop: 0.10, civic: 0.20 },
    'workforce_resort':  { need: 0.25, recency: 0.15, basis: 0.15, pop: 0.25, civic: 0.20 },
    'prop123_local':     { need: 0.25, recency: 0.10, basis: 0.20, pop: 0.15, civic: 0.30 },
    'any':               { need: 0.25, recency: 0.20, basis: 0.15, pop: 0.20, civic: 0.20 }
  };

  // CDP penalty applied to the composite for targets where incorporation
  // status materially affects deal viability (need a local government to
  // file Prop 123, issue permits, write letters of support, etc.). CDPs
  // are unincorporated; Mesa County serves Clifton, Adams County serves
  // Welby, etc. — fine in theory, friction in practice.
  // Preservation + prop123_local skipped: preservation deals can absorb
  // CDP-located properties (they already exist), and prop123_local already
  // weights civic heavily so the penalty would double-count.
  var CDP_PENALTY = -8;
  var CDP_PENALTY_TARGETS = { '9pct': true, '4pct': true, 'workforce_resort': true, 'any': true };

  /* ── Helpers ──────────────────────────────────────────────────────── */

  function $(id) { return document.getElementById(id); }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtInt(n) {
    if (!Number.isFinite(+n)) return '—';
    return Math.round(+n).toLocaleString('en-US');
  }
  function setStatus(text) {
    var el = $('lofStatusBanner');
    if (el) el.textContent = text;
  }

  // Strip "(city)" / "(town)" / "(CDP)" suffix to match PROJ_CTY values.
  function placeNameToCity(label) {
    if (!label) return '';
    return label.replace(/\s*\([^)]+\)\s*$/, '').trim();
  }

  // Haversine great-circle distance in miles between two lat/lng points.
  // Used to find the N closest LIHTC properties to a jurisdiction's
  // centroid (useful for PMA competitive-set scoping — CHFA's PMA
  // typically covers a 5-mi radius for urban / 30-mi for rural).
  function haversineMiles(lat1, lng1, lat2, lng2) {
    if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
    var R = 3959; // earth radius miles
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Build a deep-link to the Housing Needs Assessment for a specific
  // place (7-digit GEOID) or county (5-digit). The HNA page's
  // _resolveAutoTarget reads ?fips= + ?geoType= to pre-select the
  // jurisdiction so the user lands directly on the full HNA workup.
  function hnaUrlForPlace(placeGeoid) {
    return 'housing-needs-assessment.html?fips=' + encodeURIComponent(placeGeoid) +
      '&geoType=place&auto=1';
  }
  function hnaUrlForCounty(countyFips) {
    return 'housing-needs-assessment.html?fips=' + encodeURIComponent(countyFips) +
      '&geoType=county&auto=1';
  }

  /* ── Score components ─────────────────────────────────────────────── */

  function recencyScore(lastYear) {
    if (lastYear == null) return 100;
    var years = Math.max(0, CURRENT_YEAR - lastYear);
    return Math.min(100, Math.round((years / MAX_RECENCY_YEARS) * 100));
  }

  function buildNeedDistribution() {
    var dist = [];
    Object.keys(state.chasByFips).forEach(function (fips) {
      var s = state.chasByFips[fips].summary || {};
      var renterHH = +s.total_renter_hh || 0;
      var ownerHH  = +s.total_owner_hh  || 0;
      var total = renterHH + ownerHH;
      if (!total || s.pct_renter_cb30 == null || s.pct_owner_cb30 == null) return;
      var blended = (s.pct_renter_cb30 * renterHH + s.pct_owner_cb30 * ownerHH) / total;
      var severe = +s.pct_renter_cb50 || 0;
      dist.push(blended * 0.7 + severe * 0.3);
    });
    dist.sort(function (a, b) { return a - b; });
    return dist;
  }
  function needCompositeFor(countyFips) {
    var rec = state.chasByFips[countyFips];
    if (!rec || !rec.summary) return null;
    var s = rec.summary;
    var renterHH = +s.total_renter_hh || 0;
    var ownerHH  = +s.total_owner_hh  || 0;
    var total = renterHH + ownerHH;
    if (!total) return null;
    var blended = (s.pct_renter_cb30 * renterHH + s.pct_owner_cb30 * ownerHH) / total;
    var severe = +s.pct_renter_cb50 || 0;
    return blended * 0.7 + severe * 0.3;
  }
  function needScoreFor(countyFips, needDist) {
    var composite = needCompositeFor(countyFips);
    if (composite == null) return 30;
    var below = 0;
    for (var i = 0; i < needDist.length; i++) {
      if (needDist[i] < composite) below++;
      else if (needDist[i] === composite) below += 0.5;
    }
    return Math.round((below / needDist.length) * 100);
  }

  function basisBoostScore(isQct, isDda) {
    if (isQct && isDda) return 100;
    if (isQct || isDda) return 60;
    return 0;
  }

  function populationScore(pop) {
    if (pop == null || !Number.isFinite(+pop)) return 0;
    var n = +pop;
    if (n < 500) return 0;
    if (n < 2000) return 30;
    if (n < 5000) return 60;
    if (n < 15000) return 85;
    return 100;
  }

  // jurisdictionType: 'city' | 'town' | 'cdp' (defaults to incorporated treatment).
  // CDPs (Census-Designated Places, unincorporated) get a CDP_PENALTY on
  // targets where incorporation materially affects deal viability — see
  // CDP_PENALTY_TARGETS above.
  function compositeScore(rec, need, basis, pop, civic, target, jurisdictionType) {
    var w = SCORE_WEIGHTS[target] || SCORE_WEIGHTS.any;
    // civic may be null when no scorecard record exists — treat as 0
    var civicVal = Number.isFinite(civic) ? civic : 0;
    var raw = rec * w.recency + need * w.need + basis * w.basis +
              pop * w.pop + civicVal * w.civic;
    if (jurisdictionType === 'cdp' && CDP_PENALTY_TARGETS[target]) {
      raw += CDP_PENALTY;
    }
    return Math.max(0, Math.round(raw));
  }

  /* ── Data loading ─────────────────────────────────────────────────── */

  function loadAll() {
    setStatus('Loading jurisdiction data (HUD QCT, DDA, LIHTC, CHAS, place memberships, civic capacity)…');
    // F84: route all JSON loads through DataService.getJSON so the
    // no-store cache policy applies consistently. Falls back to plain
    // fetch when DataService is unavailable (legacy guard).
    function loadJson(url) {
      if (window.DataService && window.DataService.getJSON) return window.DataService.getJSON(url);
      return fetch(url).then(function (r) { return r.json(); });
    }
    // Some of these are non-critical (civic-capacity layers) — wrap each in
    // a catch so a missing/malformed file doesn't break the whole page.
    function loadSoft(url) {
      return loadJson(url).catch(function () { return null; });
    }
    function loadFirstJson(urls) {
      var i = 0;
      function next() {
        if (i >= urls.length) {
          throw new Error('Unable to load any of: ' + urls.join(', '));
        }
        var url = urls[i++];
        return loadJson(url).catch(next);
      }
      return next();
    }
    return Promise.all([
      loadJson('data/qct-colorado.json'),
      loadJson('data/dda-colorado.json'),
      loadFirstJson(['data/chfa-lihtc.json', 'data/market/hud_lihtc_co.geojson']),
      loadJson('data/hna/chas_affordability_gap.json'),
      loadJson('data/hna/place-tract-membership.json'),
      loadJson('data/co_ami_gap_by_place.json'),
      loadJson('data/hna/geo-config.json'),
      loadSoft('data/policy/housing-policy-scorecard.json'),
      loadSoft('data/hna/local-resources.json'),
      loadSoft('data/policy/prop123_jurisdictions.json'),
      loadSoft('data/market/tract_centroids_co.json'),
      loadSoft('data/hna/ranking-index.json'),
      loadSoft('data/co-county-boundaries.json'),
      loadSoft('data/affordable-housing/properties.json'),
      loadSoft('data/hud-fmr-income-limits.json'),
      // F16: per-place centroids from 2024 Census Gazetteer (482 CO places).
      // Replaces the previous "use first LIHTC project's lat/lng OR county
      // centroid" fallback chain, which caused all places in the same
      // county to stack at the county center.
      loadSoft('data/co-place-centroids.json'),
      // F25: Colorado PAB (private-activity-bond) local direct allocations.
      // Per-jurisdiction "bond cap" for the ~67 designated local issuers;
      // everyone else draws from CHFA's statewide balance. Context only — not
      // a scoring input.
      loadSoft('data/policy/pab-allocations.json'),
      // F58: block-level LODES OD aggregated to places (within / inflow /
      // outflow). The detail panel reads this when a place is selected.
      // Soft load — older HNA datasets don't ship it and the panel just
      // hides if the lookup misses.
      loadSoft('data/hna/place-od-flows.json'),
      // Q5: Zillow ZORI market-rent index (monthly, all-bedroom). Used to
      // enrich the Capture column tooltip with the actual market rent
      // proxy (FMR is a 40th-percentile floor, 2-3 yr lagged; ZORI is
      // monthly and tracks 35-65th-percentile). Soft load — tooltips
      // gracefully omit ZORI line when missing.
      loadSoft('data/market/zori_rents_co.json')
    ]).then(function (parts) {
      // Build QCT tract-ID set
      (parts[0].features || []).forEach(function (f) {
        var g = f.properties && f.properties.GEOID;
        if (g) state.qctTractIds.add(g);
      });

      // Build DDA county-FIPS set + keep raw features for map
      state.ddaFeatures = parts[1].features || [];
      state.ddaFeatures.forEach(function (f) {
        var g = f.properties && f.properties.GEOID;
        if (g && g.length === 5) state.ddaCountyFips.add(g);
      });

      // CHFA/HUD LIHTC projects, filtered to valid YR_PIS
      state.projects = (parts[2].features || []).filter(function (f) {
        var y = parseInt(f.properties && f.properties.YR_PIS, 10);
        return Number.isFinite(y) && y >= 1980 && y <= 2030;
      });

      state.chasByFips = parts[3].counties || {};
      state.placeMembership = (parts[4].places) || {};
      state.placeFromAmi = (parts[5].places) || {};

      // Place + county labels from geo-config
      var gc = parts[6] || {};
      (gc.counties || []).forEach(function (c) {
        state.countyName[c.geoid] = c.label;
      });
      // Build comprehensive place-meta from featured + places + cdps
      var allPlaces = []
        .concat(gc.featured || [])
        .concat(gc.places || [])
        .concat(gc.cdps || []);
      allPlaces.forEach(function (p) {
        if (!p.geoid) return;
        // Determine type from label (city / town / CDP suffix)
        var labelLower = (p.label || '').toLowerCase();
        var type = 'place';
        if (labelLower.indexOf('cdp') !== -1) type = 'cdp';
        else if (labelLower.indexOf('city') !== -1) type = 'city';
        else if (labelLower.indexOf('town') !== -1) type = 'town';
        else if (p.type) type = p.type;
        state.placeMeta[p.geoid] = {
          label: p.label,
          containingCounty: p.containingCounty,
          type: type
        };
      });

      // Soft civic-capacity layers — each defaults to empty on miss
      var scorecard = parts[7];
      if (scorecard && scorecard.scores) {
        state.policyScores = scorecard.scores;
      }
      var localRes = parts[8];
      if (localRes && typeof localRes === 'object') {
        state.localResources = localRes;
      }
      // Tract centroids — used to anchor jurisdiction markers when the
      // jurisdiction has no LIHTC project lat/lng to fall back on (e.g.
      // never-funded jurisdictions in the default view). Without these,
      // every never-funded place falls back to CO state center and the
      // markers stack invisibly. Each tract has { geoid, lat, lon }.
      var tractCentroids = parts[10];
      if (tractCentroids && Array.isArray(tractCentroids.tracts)) {
        tractCentroids.tracts.forEach(function (t) {
          if (t.geoid && Number.isFinite(+t.lat) && Number.isFinite(+t.lon)) {
            state.tractCentroids[t.geoid] = { lat: +t.lat, lon: +t.lon };
          }
        });
      }

      // Ranking-index — joins each county to a CO region label
      // (Front Range / Mountains / Western Slope / Southwest /
      // San Luis Valley / Eastern Plains). Powers the region filter.
      var rankIdx = parts[11];
      if (rankIdx && Array.isArray(rankIdx.rankings)) {
        rankIdx.rankings.forEach(function (r) {
          if (r.type === 'county' && r.geoid && r.region) {
            state.countyRegion[r.geoid] = r.region;
          }
        });
      }

      // County boundaries — overlay layer on the map (matches what
      // colorado-deep-dive.html and market-analysis.html ship). Stored
      // raw for Leaflet to render when toggled.
      state.countyBoundaries = parts[12];

      // Unified affordable-housing properties — combines:
      //   - CHFA LIHTC (926 properties, 2025-current)
      //   - CHFA Preservation Properties (1,688 — at-risk subsidized, no subsidy_type)
      //   - HUD MULTIFAMILY_PROPERTIES_ASSISTED (343 CO — has subsidy_type detail)
      //   - USDA Rural Housing Assets (116 CO — has restrictive_clause_expiration)
      // Index by city for fast per-jurisdiction lookup.
      var ahProps = parts[13];
      if (ahProps && Array.isArray(ahProps.properties)) {
        ahProps.properties.forEach(function (p) {
          var city = (p.city || '').toUpperCase().trim();
          if (!city) return;
          var isPres = p.program_type.indexOf('preservation-candidate') !== -1;
          if (isPres) {
            var precRec = state.preservationByCity[city] || {
              total: 0, sec8: 0, hud202_811: 0, fha: 0, usdaRd: 0, other: 0,
              urgent5y: 0,        // count of properties with years_to_expiration <= 5
              expiringSoon10y: 0  // <= 10y
            };
            precRec.total++;
            // Subsidy-type bucketing (only HUD MF + USDA RD have this detail)
            var st = p.subsidy_type;
            if (st === 'section-8-pbra')              precRec.sec8++;
            else if (st === 'hud-202-or-811')         precRec.hud202_811++;
            else if (st && st.indexOf('fha') === 0)   precRec.fha++;
            else if (st && st.indexOf('usda-rd') === 0) precRec.usdaRd++;
            else                                       precRec.other++;
            // Urgency (USDA RD only)
            if (Number.isFinite(p.years_to_expiration)) {
              if (p.years_to_expiration <= 5)  precRec.urgent5y++;
              if (p.years_to_expiration <= 10) precRec.expiringSoon10y++;
            }
            state.preservationByCity[city] = precRec;
          }
          var isLihtc = p.program_type.some(function (t) { return t.indexOf('lihtc-') === 0; });
          if (isLihtc) {
            var rec = state.lihtcByCity[city] || { count: 0, ninePct: 0, fourPct: 0, statePaired: 0, units: 0 };
            rec.count++;
            if (p.program_type.indexOf('lihtc-9pct')         !== -1) rec.ninePct++;
            if (p.program_type.indexOf('lihtc-4pct')         !== -1) rec.fourPct++;
            if (p.program_type.indexOf('lihtc-state-paired') !== -1) rec.statePaired++;
            rec.units += (+p.total_units || 0);
            state.lihtcByCity[city] = rec;
          }
        });
      }

      // F10: Build per-county market-capture lookup from HUD FY2025 FMR + IL data.
      // LIHTC §42 max rent at 60% AMI for 2BR = (60%-AMI 3-person income × 30%) / 12.
      // 60% AMI 3-person = il50_3person × 1.2 (HUD scales 50→60 linearly).
      // FMR 2BR is the HUD "market rent" proxy used by LIHTC underwriting.
      // Capture advantage = FMR 2BR − LIHTC 60% AMI 2BR max rent. Positive
      // means LIHTC undercuts market → easy lease-up; negative means LIHTC
      // can't compete at 60% AMI (needs deeper AMI mix to pencil).
      var hudIl = parts[14];
      if (hudIl && Array.isArray(hudIl.counties)) {
        hudIl.counties.forEach(function (c) {
          var fips = (c.fips || '').padStart(5, '0');
          var fmr2br = c.fmr && Number(c.fmr.two_br);
          var il50_3p = c.income_limits && Number(c.income_limits.il50_3person);
          if (!fips || !Number.isFinite(fmr2br) || !Number.isFinite(il50_3p)) return;
          var income60AMI_3p = il50_3p * 1.2;
          var lihtc60ami2br = Math.round((income60AMI_3p * 0.30) / 12);
          state.marketByCounty[fips] = {
            fmr2br: fmr2br,
            lihtc60ami2br: lihtc60ami2br,
            captureAdvantage: fmr2br - lihtc60ami2br,
            fmrAreaName: c.fmr_area_name || null
          };
        });
      }

      // F16: per-place centroids from 2024 Census Gazetteer (parts[15]).
      // Primary source for marker placement on the map — replaces the F11
      // "use first LIHTC project's lat/lng OR county centroid" fallback
      // chain that caused all places in the same county to stack at the
      // county center (e.g., Blue River, Breck, Frisco, Dillon all on top
      // of each other at Summit County centroid).
      var placeCent = parts[15];
      if (placeCent && placeCent.byGeoid) {
        Object.keys(placeCent.byGeoid).forEach(function (geoid) {
          var p = placeCent.byGeoid[geoid];
          if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
            state.placeCentroid[geoid] = { lat: p.lat, lng: p.lng };
          }
        });
      }

      // F25: PAB direct-allocation lookup (parts[16]). Keyed by place GEOID
      // and county FIPS; consolidated city-counties (Denver, Broomfield) are
      // present under both keys.
      var pab = parts[16];
      if (pab && pab.allocations) {
        state.pabByGeoid = pab.allocations;
        state.pabMeta = pab.metadata || null;
      }

      // F58: block-level LODES OD flows (parts[17]) keyed by place GEOID.
      // Each entry exposes { within, inflow, outflow, jobs, residentWorkers,
      // flows_source: 'block-od' }. The detail panel uses this for a
      // "Labor market & commute" sub-card; if no entry is present (small
      // unincorporated areas, or older HNA datasets) the card hides.
      var odFlows = parts[17];
      if (odFlows && odFlows.places) {
        state.placeOdFlows = odFlows.places;
        state.placeOdFlowsMeta = odFlows.meta || null;
      }

      // Q5: ZORI market-rent (parts[18]). Indexed by county FIPS (08001..)
      // and city name. Fed into Capture tooltips + Deal Calc cap toggle.
      var zori = parts[18];
      if (zori && (zori.counties || zori.cities)) {
        state.zoriByCounty = zori.counties || {};
        state.zoriByCity   = zori.cities || {};
        state.zoriMeta     = zori.meta || null;
        state.zoriStatewideMedian = zori.statewide_median || null;
      }

      // F58: kick off place-LEHD load in parallel (industry/wage rollups).
      // Resolves whenever; the detail-panel render reads PlaceLehd.lookup
      // synchronously and falls back to OD-only output if PlaceLehd isn't
      // initialized yet.
      if (window.PlaceLehd && window.PlaceLehd.init) {
        window.PlaceLehd.init().catch(function () { /* non-fatal */ });
      }

      // Also derive a {fips → centroid} map from the county polygons.
      // The tract_centroids_co.json file is unreliable (Appendix A.2
      // of repo audit — tract GEOIDs paired with wrong tracts' coords),
      // so we use county centroids as the FALLBACK when a place isn't
      // in the Gazetteer file (rare — Gazetteer covers all 482 CO places).
      if (state.countyBoundaries && Array.isArray(state.countyBoundaries.features)) {
        state.countyBoundaries.features.forEach(function (f) {
          var fips = f.properties && (f.properties.GEOID || f.properties.STATEFP + f.properties.COUNTYFP || f.properties.fips);
          if (!fips || !f.geometry) return;
          // Compute polygon centroid via mean of all vertex coords (good enough
          // for jurisdiction marker placement at state-scale zoom)
          var sumLat = 0, sumLng = 0, n = 0;
          function walkRing(ring) {
            ring.forEach(function (c) {
              if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
                sumLng += c[0]; sumLat += c[1]; n++;
              }
            });
          }
          if (f.geometry.type === 'Polygon') {
            f.geometry.coordinates.forEach(walkRing);
          } else if (f.geometry.type === 'MultiPolygon') {
            f.geometry.coordinates.forEach(function (poly) { poly.forEach(walkRing); });
          }
          if (n > 0) {
            state.countyCentroid[fips] = { lat: sumLat / n, lng: sumLng / n };
          }
        });
      }

      var prop123 = parts[9];
      if (prop123 && Array.isArray(prop123.jurisdictions)) {
        prop123.jurisdictions.forEach(function (j) {
          // Strip "City and County of " / "Town of " prefixes to maximise name-match
          var key = (j.name || '').toUpperCase()
            .replace(/^CITY AND COUNTY OF\s+/, '')
            .replace(/^TOWN OF\s+/, '')
            .replace(/^CITY OF\s+/, '')
            .replace(/\s+COUNTY$/, '')
            .trim();
          if (key) state.prop123ByName[key] = j;
        });
      }

      setStatus('Rolling up ' + Object.keys(state.placeMembership).length +
        ' jurisdictions against ' + state.qctTractIds.size + ' QCTs · ' +
        state.ddaCountyFips.size + ' DDAs · ' + state.projects.length + ' LIHTC projects · ' +
        Object.keys(state.policyScores).length + ' policy-score records…');
    });
  }

  /* ── Civic-capacity helpers ───────────────────────────────────────── */

  // Pull the policy-scorecard record for a place (7-digit geoid).
  // Falls back to the containing county record if no place-level entry.
  function civicForPlace(placeGeoid, countyFips) {
    return state.policyScores[placeGeoid] ||
           (countyFips ? state.policyScores[countyFips] : null) ||
           null;
  }

  // Pull the local-resources record, trying place / cdp / county keys in turn.
  // Returns an object with a `_resolvedFrom` discriminator so the UI can
  // show 'via County' fallback notices when no place-level data exists.
  // Out of 547 CO places, only ~17 currently have place-level entries
  // (Denver, Boulder, Aurora, Fort Collins, Colorado Springs, Pueblo,
  // Greeley, Longmont, Loveland, Lakewood, Grand Junction, Durango,
  // Steamboat, Aspen, Vail — see scripts/augment-local-resources.js).
  // Every other place falls back to county-level data.
  function localResForPlace(placeGeoid, type, countyFips) {
    var lr = state.localResources;
    var k;
    if (type === 'cdp') {
      k = 'cdp:' + placeGeoid;
      if (lr[k]) return Object.assign({ _resolvedFrom: 'cdp' }, lr[k]);
    }
    k = 'place:' + placeGeoid;
    if (lr[k]) return Object.assign({ _resolvedFrom: 'place' }, lr[k]);
    if (countyFips) {
      k = 'county:' + countyFips;
      if (lr[k]) return Object.assign({ _resolvedFrom: 'county-fallback' }, lr[k]);
    }
    return null;
  }

  // Pull the detailed prop123 commitment record by jurisdiction name.
  function prop123ForName(placeName) {
    if (!placeName) return null;
    var key = placeName.toUpperCase().trim();
    return state.prop123ByName[key] || null;
  }

  /* ── Opportunity assembly ─────────────────────────────────────────── */

  function _computeOpportunities() {
    var needDist = buildNeedDistribution();
    var ops = [];

    // Index projects by upper-case PROJ_CTY for fast lookup
    var projectsByCity = {};
    state.projects.forEach(function (p) {
      var c = ((p.properties && p.properties.PROJ_CTY) || '').toUpperCase().trim();
      if (!c) return;
      (projectsByCity[c] = projectsByCity[c] || []).push(p);
    });

    Object.keys(state.placeMembership).forEach(function (placeGeoid) {
      var membership = state.placeMembership[placeGeoid];
      if (!membership) return;
      var meta = state.placeMeta[placeGeoid] || {};
      var label = membership.name || meta.label || placeGeoid;
      var containingCounty = meta.containingCounty;
      if (!containingCounty) {
        // Fall back to tract's county prefix
        var firstTract = (membership.tracts || [])[0];
        if (firstTract && firstTract.tract_geoid) {
          containingCounty = firstTract.tract_geoid.substring(0, 5);
        }
      }
      var type = meta.type || (label.toLowerCase().indexOf('cdp') !== -1 ? 'cdp' : 'place');

      // QCT membership — any tract intersecting the place that's also a QCT counts
      // We require a meaningful overlap (share_of_place_area > 0.05 OR share_of_tract_area > 0.20)
      // so a sliver-overlap doesn't claim the QCT.
      var qctTracts = (membership.tracts || []).filter(function (t) {
        if (!state.qctTractIds.has(t.tract_geoid)) return false;
        var sp = +t.share_of_place_area || 0;
        var st = +t.share_of_tract_area || 0;
        return sp > 0.05 || st > 0.20;
      });
      var hasQct = qctTracts.length > 0;

      // DDA membership — place's containing county is in the DDA set
      var hasDda = containingCounty && state.ddaCountyFips.has(containingCounty);

      // Note: we no longer pre-filter to basis-boost-eligible jurisdictions
      // at rollup time. The filter is applied at _applyFilters() so the user
      // can opt to see all 482 jurisdictions via the 'no requirement' option.

      // LIHTC projects in the jurisdiction (matched by PROJ_CTY)
      var cityNameForLookup = placeNameToCity(label).toUpperCase();
      var inside = (projectsByCity[cityNameForLookup] || []);
      var lastYear = inside.reduce(function (max, p) {
        var y = parseInt(p.properties.YR_PIS, 10);
        return (Number.isFinite(y) && y > max) ? y : max;
      }, -Infinity);
      if (lastYear === -Infinity) lastYear = null;
      var totalUnits = inside.reduce(function (sum, p) {
        return sum + (+p.properties.N_UNITS || 0);
      }, 0);

      // Population — from co_ami_gap_by_place's households at ≤100% AMI × 2.5
      // (approximate; the file doesn't directly publish total population)
      var amiRec = state.placeFromAmi[placeGeoid];
      var pop = null;
      if (amiRec && amiRec.households_le_ami_pct && amiRec.households_le_ami_pct['100']) {
        // households_le_ami_pct['100'] is HH count at ≤100% AMI which is
        // most of population by HH count. Avg CO HH size ≈ 2.5
        pop = Math.round((+amiRec.households_le_ami_pct['100'] || 0) * 2.5);
      }

      // HNA need composite
      var needComposite = needCompositeFor(containingCounty);
      var needPct = needScoreFor(containingCounty, needDist);

      // Component scores
      var recScore = recencyScore(lastYear);
      var bbScore = basisBoostScore(hasQct, hasDda);
      var popScore = populationScore(pop);

      // Compute civic 0–100 first (need it before composite scores)
      var civic_pre = civicForPlace(placeGeoid, containingCounty);
      var civicRawScore_pre = civic_pre && Number.isFinite(civic_pre.totalScore) ? civic_pre.totalScore : null;
      var civicMax_pre = civic_pre && Number.isFinite(civic_pre.maxPossible) && civic_pre.maxPossible > 0
        ? civic_pre.maxPossible : 7;
      var civicScoreForComposite = civicRawScore_pre != null ? Math.round((civicRawScore_pre / civicMax_pre) * 100) : 0;

      // Compute score for each target — we'll use the active one in the table.
      // `type` is 'city' | 'town' | 'cdp' — CDPs get a penalty on
      // incorporation-sensitive targets (9pct/4pct/workforce_resort/any).
      var score9            = compositeScore(recScore, needPct, bbScore, popScore, civicScoreForComposite, '9pct', type);
      var score4            = compositeScore(recScore, needPct, bbScore, popScore, civicScoreForComposite, '4pct', type);
      var scorePreservation = compositeScore(recScore, needPct, bbScore, popScore, civicScoreForComposite, 'preservation', type);
      var scoreWorkforce    = compositeScore(recScore, needPct, bbScore, popScore, civicScoreForComposite, 'workforce_resort', type);
      var scoreProp123      = compositeScore(recScore, needPct, bbScore, popScore, civicScoreForComposite, 'prop123_local', type);
      var scoreAny          = compositeScore(recScore, needPct, bbScore, popScore, civicScoreForComposite, 'any', type);

      // Civic capacity (already computed above as civic_pre — reuse)
      var civic = civic_pre;
      var localRes = localResForPlace(placeGeoid, type, containingCounty);
      var prop123 = prop123ForName(placeNameToCity(label));

      // Place centroid for the map marker. Anchor priority:
      //   1. First LIHTC project in the jurisdiction (most precise — actual
      //      property lat/lng from HUD/CHFA)
      //   2. Containing-county centroid (from co-county-boundaries polygons)
      //   3. null (caller skips marker rather than drop a misleading dot)
      //
      // We deliberately do NOT use data/market/tract_centroids_co.json
      // because its GEOID→lat/lng pairings are scrambled (verified: Aurora's
      // tract 08001008354 listed at lat 37.18 / lng -105.80, which is in
      // Alamosa County, not Adams; Granada's tract 08099000700 listed at
      // lat 40.24 / lng -108.18, which is in Rio Blanco, not Prowers).
      // See Appendix A.2 of docs/audits/REPO-AUDIT-2026-05-25.md.
      var centroidLat = null, centroidLng = null;
      // F16: prefer the 2024 Census Gazetteer place centroid (true
      // per-place INTPTLAT/INTPTLONG) over LIHTC-project coords or
      // county centroid. Was: first LIHTC project lat/lng → county
      // centroid. Problem: caused Blue River, Breck, Frisco, Dillon
      // etc. all to stack at Summit County centroid.
      if (state.placeCentroid[placeGeoid]) {
        var pc = state.placeCentroid[placeGeoid];
        centroidLat = pc.lat; centroidLng = pc.lng;
      }
      // Fallback 1: first LIHTC project lat/lng (for places not in
      // the Gazetteer — should be rare, Gazetteer covers all 482).
      if (centroidLat == null && inside.length) {
        var coords = inside[0].geometry && inside[0].geometry.coordinates;
        if (coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
          centroidLng = coords[0]; centroidLat = coords[1];
        }
      }
      // Fallback 2: containing-county centroid (last-ditch — at least
      // the marker lands in the right county).
      if (centroidLat == null && containingCounty && state.countyCentroid[containingCounty]) {
        var c = state.countyCentroid[containingCounty];
        centroidLat = c.lat; centroidLng = c.lng;
      }

      // Existing affordable-housing stock in jurisdiction (from the unified
      // affordable-housing/properties.json — broader than just LIHTC).
      // Sourced from 4 datasets: CHFA LIHTC + CHFA Preservation + HUD MF
      // Assisted + USDA RD. preservationByCity[city] is now an object with
      // sub-type counts + urgency buckets.
      var preservationRec = state.preservationByCity[cityNameForLookup] || {
        total: 0, sec8: 0, hud202_811: 0, fha: 0, usdaRd: 0, other: 0,
        urgent5y: 0, expiringSoon10y: 0
      };
      var lihtcStock = state.lihtcByCity[cityNameForLookup] || { count: 0, ninePct: 0, fourPct: 0, statePaired: 0, units: 0 };

      // Civic score values for op record (reuse pre-computed values)
      var civicRawScore = civicRawScore_pre;
      var civicMax = civicMax_pre;
      var civicPct = civicRawScore != null ? Math.round((civicRawScore / civicMax) * 100) : null;

      ops.push({
        id:           placeGeoid,
        placeGeoid:   placeGeoid,
        name:         placeNameToCity(label),
        labelFull:    label,
        type:         type,
        containingCounty: containingCounty,
        countyName:   state.countyName[containingCounty] || (containingCounty ? 'County ' + containingCounty : '—'),
        region:       state.countyRegion[containingCounty] || null,
        // Resort + public-lands adjacency flags (from RESORT_COUNTIES +
        // PUBLIC_LANDS_HEAVY_COUNTIES tables above). A jurisdiction is
        // 'in' a resort/public-lands county or 'adjacent' (containing-
        // county is on the list).
        resortLabel:    RESORT_COUNTIES[containingCounty] || null,
        publicLandsHeavy: PUBLIC_LANDS_HEAVY_COUNTIES.has(containingCounty),
        hasQct:       hasQct,
        hasDda:       hasDda,
        hasBoth:      hasQct && hasDda,
        qctTracts:    qctTracts,
        qctCount:     qctTracts.length,
        projects:     inside,
        projectCount: inside.length,
        totalUnits:   totalUnits,
        lastYear:     lastYear,
        yearsSince:   lastYear != null ? CURRENT_YEAR - lastYear : null,
        population:   pop,
        // Component scores
        recencyScore: recScore,
        needScore:    needPct,
        needCompositePct: needComposite != null ? Math.round(needComposite * 100) : null,
        basisBoostScore: bbScore,
        populationScore: popScore,
        // Target-specific composites (5-dim, methodology §4)
        score9:               score9,
        score4:               score4,
        scorePreservation:    scorePreservation,
        scoreWorkforce:       scoreWorkforce,
        scoreProp123:         scoreProp123,
        scoreAny:             scoreAny,
        // Place centroid for map (lat/lng, may be null if no tract centroids
        // and no LIHTC project anchor; renderer will skip such markers)
        centroidLat:  centroidLat,
        centroidLng:  centroidLng,
        // Nearest 3 LIHTC properties by great-circle distance from the
        // jurisdiction centroid. Useful for PMA competitive-set scoping:
        //   - Urban PMA = 5-mi radius (CHFA standard)
        //   - Rural PMA = up to 30 miles
        // Each entry: { project, city, year, units, credit, miles }
        nearestLihtc: (function () {
          if (centroidLat == null || centroidLng == null) return [];
          var scored = state.projects.map(function (p) {
            var coords = p.geometry && p.geometry.coordinates;
            if (!coords) return null;
            var dist = haversineMiles(centroidLat, centroidLng, coords[1], coords[0]);
            if (dist == null) return null;
            return {
              project: p.properties.PROJECT || '(unnamed)',
              city: p.properties.PROJ_CTY || '—',
              year: p.properties.YR_PIS,
              units: p.properties.N_UNITS || 0,
              credit: p.properties.TypeOfCredits || p.properties.CREDIT || '—',
              miles: dist
            };
          }).filter(Boolean);
          scored.sort(function (a, b) { return a.miles - b.miles; });
          return scored.slice(0, 3);
        }()),
        // Affordable-housing stock (from unified properties.json, 4 sources)
        preservationCount:    preservationRec.total,
        preservationSec8:     preservationRec.sec8,
        preservation202_811:  preservationRec.hud202_811,
        preservationFha:      preservationRec.fha,
        preservationUsdaRd:   preservationRec.usdaRd,
        preservationOther:    preservationRec.other,
        preservationUrgent5y: preservationRec.urgent5y,
        preservationSoon10y:  preservationRec.expiringSoon10y,
        lihtcStockCount:      lihtcStock.count,
        lihtcStockUnits:      lihtcStock.units,
        lihtc9pctCount:       lihtcStock.ninePct,
        lihtc4pctCount:       lihtcStock.fourPct,
        lihtcStatePaired:     lihtcStock.statePaired,
        // F10: market-capture advantage (LIHTC 60% AMI 2BR vs 2BR FMR) — county-level.
        // Positive = LIHTC undercuts market (easy lease-up). Negative = can't
        // compete at 60% AMI; needs deeper AMI mix or extra soft debt.
        market: state.marketByCounty[containingCounty] || null,
        captureAdvantage: state.marketByCounty[containingCounty]
          ? state.marketByCounty[containingCounty].captureAdvantage
          : null,
        // Civic capacity layer (all nullable — sparse coverage)
        civic:        civic,
        localRes:     localRes,
        prop123Detail: prop123,
        civicScore:   civicPct,
        civicRawScore: civicRawScore,
        civicMax:     civicMax
      });
    });

    state.opportunities = ops;
  }

  /* ── Filtering ────────────────────────────────────────────────────── */

  function _activeScore(op) {
    var t = state.filters.target;
    if (t === '9pct')             return op.score9;
    if (t === '4pct')             return op.score4;
    if (t === 'preservation')     return op.scorePreservation;
    if (t === 'workforce_resort') return op.scoreWorkforce;
    if (t === 'prop123_local')    return op.scoreProp123;
    return op.scoreAny;
  }

  function _applyFilters() {
    var f = state.filters;
    return state.opportunities.filter(function (op) {
      // Basis-boost designation filter — mutually-exclusive options:
      switch (f.basis) {
        case 'both':   if (!op.hasBoth) return false; break;
        case 'either': if (!op.hasQct && !op.hasDda) return false; break;
        case 'qct':    if (!op.hasQct || op.hasDda) return false; break; // QCT but NOT DDA
        case 'dda':    if (!op.hasDda || op.hasQct) return false; break; // DDA but NOT QCT
        case 'none':   /* no basis requirement — allow all */ break;
        default:       if (!op.hasBoth) return false; break;
      }
      if (!f.includeCdps && op.type === 'cdp') return false;
      if (f.county && op.containingCounty !== f.county) return false;
      if (f.region && op.region !== f.region) return false;
      if (f.minYearsSince > 0 && (op.yearsSince == null || op.yearsSince < f.minYearsSince)) return false;
      if (f.minScore > 0 && _activeScore(op) < f.minScore) return false;
      if (f.minPop > 0 && (op.population || 0) < f.minPop) return false;
      if (f.minPreservation > 0 && (op.preservationCount || 0) < f.minPreservation) return false;
      if (f.onlyUrgentPres && (op.preservationUrgent5y || 0) === 0) return false;
      // F10: market capture screen — require LIHTC 60% AMI 2BR < FMR 2BR.
      // Drops jurisdictions where the deal can't pencil at 60% without
      // a deeper AMI mix (typical of low-rent rural CO counties).
      if (f.requireCapture && (op.captureAdvantage == null || op.captureAdvantage <= 0)) return false;
      return true;
    });
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  function _scoreBand(score) {
    if (score >= 70) return 'high';
    if (score >= 50) return 'med';
    return 'low';
  }

  // F13: top-opportunity spotlight — explains in plain English WHY the #1
  // jurisdiction is best given the current filter set. Updates with every
  // filter change.
  function _renderTopSpotlight(filtered) {
    var el = $('lofTopSpotlight');
    if (!el) return;
    var top = filtered[0];
    if (!top) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    var reasons = _opActionReasons(top);
    // Take the 2 best reasons to keep the card compact
    var summary = reasons.slice(0, 2).join(' · ');
    var activeScore = _activeScore(top);
    var TARGET_LABELS = {
      '9pct':             '9% Competitive',
      '4pct':             '4% Bond',
      'preservation':     'Preservation',
      'workforce_resort': 'Workforce / Resort',
      'prop123_local':    'Prop 123 / Local',
      'any':              'Balanced'
    };
    var targetLabel = TARGET_LABELS[state.filters.target] || 'Balanced';
    el.innerHTML =
      '<div class="lof-spotlight-score">' + activeScore +
        '<span class="lof-spotlight-score-suffix">/100</span></div>' +
      '<div>' +
        '<span class="lof-spotlight-label">↑ Top ' + escHtml(targetLabel) + ' opportunity</span>' +
        '<div class="lof-spotlight-name">' + escHtml(top.name) +
          '<span class="lof-spotlight-meta">· ' + escHtml(top.countyName) +
          ' · ' + filtered.length + ' jurisdictions match your filters</span>' +
        '</div>' +
        '<div class="lof-spotlight-reasons">' + summary + '</div>' +
      '</div>' +
      '<a href="#" class="lof-spotlight-cta" data-op-id="' + escHtml(top.id) + '">See details ↓</a>';
    // Wire click to open detail panel for #1
    var cta = el.querySelector('.lof-spotlight-cta');
    if (cta) {
      cta.addEventListener('click', function (e) {
        e.preventDefault();
        _showDetail(top.id);
        var d = $('lofDetail');
        if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  // O2 — Render the results-status strip ABOVE the table.
  // Shows "X of Y jurisdictions" plus a comma-separated list of active filters
  // so users can see exactly what's narrowing the view. Updated on every
  // recompute pass.
  function _renderResultsStatus(filtered) {
    var n = filtered.length;
    var total = (state.opportunities || []).length || 0;
    var countEl = $('lofResultsCount');
    var totalEl = $('lofResultsTotal');
    var filtersEl = $('lofResultsFilters');
    if (countEl) countEl.textContent = n.toLocaleString();
    if (totalEl) totalEl.textContent = total.toLocaleString();
    if (!filtersEl) return;
    var f = state.filters || {};
    var labels = [];
    var TARGET_LABELS = { '9pct': '9% target', '4pct': '4% target', 'preservation': 'Preservation', 'workforce_resort': 'Workforce/Resort', 'prop123_local': 'Prop 123 / Local', 'any': 'Balanced' };
    var BASIS_LABELS = { 'either': 'QCT or DDA', 'both': 'QCT + DDA both', 'qct': 'QCT only', 'dda': 'DDA only', 'none': 'no basis-boost filter' };
    if (f.target && TARGET_LABELS[f.target]) labels.push(TARGET_LABELS[f.target]);
    if (f.region) labels.push(f.region);
    if (f.county) labels.push('1 county');
    if (f.basis) labels.push(BASIS_LABELS[f.basis] || f.basis);
    if (f.requireCapture) labels.push('rent-advantage required');
    if (!f.includeCdps) labels.push('incorporated only');
    if (f.minScore > 0) labels.push('score ≥ ' + f.minScore);
    if (f.minYearsSince > 0) labels.push('≥ ' + f.minYearsSince + ' yrs since LIHTC');
    if (f.minPop > 0) labels.push('pop ≥ ' + f.minPop.toLocaleString());
    if (f.minPreservation > 0) labels.push('≥ ' + f.minPreservation + ' preservation');
    if (f.onlyUrgentPres) labels.push('≤ 5 yrs to expiration');
    var hidden = total - n;
    var hiddenStr = (hidden > 0)
      ? ' · <span style="color:var(--warn,#d97706);">' + hidden.toLocaleString() + ' filtered out</span>'
      : '';
    // P1 — surface the auto-relaxation of requireCapture when a rural region
    // is selected, so users understand why the filter shows un-checked.
    var autoStr = '';
    if (state._autoRelaxedCapture && state.filters.region === state._autoRelaxedCapture && !f.requireCapture) {
      autoStr = '<br><span style="font-size:.78rem;color:var(--accent);">' +
        '↻ Rent-advantage filter auto-relaxed for ' + escHtml(state._autoRelaxedCapture) +
        ' — rural CO FMRs sit at or below LIHTC 60% AMI rents, so the filter would screen out every jurisdiction. ' +
        'Re-enable it in the filter panel to require positive capture.</span>';
    }
    filtersEl.innerHTML = (labels.length ? '· filters: ' + labels.join(' · ') : '') + hiddenStr + autoStr;
  }

  function _renderSummary(filtered) {
    var n = filtered.length;
    var neverFunded = filtered.filter(function (op) { return op.lastYear == null; }).length;
    var withQctAndDda = filtered.filter(function (op) { return op.hasBoth; }).length;
    var avgScore = n ? Math.round(filtered.reduce(function (s, op) { return s + _activeScore(op); }, 0) / n) : 0;
    var top = filtered[0];
    // O2 — keep the new status strip in sync with the table
    _renderResultsStatus(filtered);
    var TARGET_LABELS = {
      '9pct':             '9% Competitive',
      '4pct':             '4% Bond',
      'preservation':     'Preservation',
      'workforce_resort': 'Workforce / Resort',
      'prop123_local':    'Prop 123 / Local',
      'any':              'Balanced (any)'
    };
    // F17: render each weight as a tooltipped chip so users hovering see
    // what the dimension means + why it gets this weight for the chosen
    // target. Source weights live in SCORE_WEIGHTS at top of file (F9).
    var DIM_TOOLTIPS = {
      need: 'Housing need percentile — cost burden + AMI gap. Higher = more under-served renters at risk of displacement.',
      recency: 'Years since the last LIHTC award here. Higher = longer dry spell = stronger saturation argument for a new deal.',
      basis: 'Federal IRS §42 basis-boost eligibility (QCT and/or DDA). Higher = +30% basis means ~$3-5M extra equity on a 60-unit project.',
      pop: 'Renter scale. Higher = enough renter households (5k+) to lease up a 60–200 unit project in 12–18 months.',
      civic: 'Local government readiness — Prop 123 filing, comp plan, IZ ordinance, housing authority, soft funding. Higher = smoother deal.'
    };
    var DIM_LABELS = {
      need: 'Need', recency: 'Recency', basis: 'Basis', pop: 'Pop', civic: 'Civic'
    };
    function _weightChips(target) {
      var w = SCORE_WEIGHTS[target] || SCORE_WEIGHTS.any;
      return ['need', 'recency', 'basis', 'pop', 'civic'].map(function (k) {
        var pct = Math.round(w[k] * 100);
        return '<span class="lof-weight-chip" title="' + escHtml(DIM_TOOLTIPS[k]) + '" ' +
          'data-dim="' + k + '">' +
          '<span class="lof-weight-chip-label">' + DIM_LABELS[k] + '</span> ' +
          '<span class="lof-weight-chip-val">' + pct + '%</span></span>';
      }).join('');
    }
    function _weightWhyLine(target) {
      // One-line "why" tailored to the active deal type — answers the
      // user's "but why these weights?" question without making them
      // open the methodology section.
      var why = {
        '9pct': 'For 9% competitive deals, CHFA\'s QAP rewards under-served markets first, then deep need — so Recency + Need carry the most weight.',
        '4pct': 'For 4% bond deals, the math depends on absorption — Population dominates because you need 100–200 units leased fast for the bond to pencil.',
        'preservation': 'For preservation, the existing subsidized stock and basis-boost are the differentiators — you\'re buying expiring affordability, not building new market entry.',
        'workforce_resort': 'For resort markets, scale + civic-readiness drive — projects only work where there\'s a workforce-housing strategy AND enough renter base to fill the building.',
        'prop123_local': 'For Prop 123 / locally-funded deals, civic readiness dominates — your soft-debt source is the local commitment + housing authority infrastructure.',
        'any': 'Balanced weighting — useful when you\'re scouting broadly without a specific deal-type commitment.'
      };
      return why[target] || why.any;
    }
    var targetLabel = TARGET_LABELS[state.filters.target] || 'Balanced (any)';
    var html =
      '<div class="lof-summary-card lof-summary-card--weights"><div class="k">Target deal type · active weights</div>' +
        '<div class="v" style="font-size:.95rem;line-height:1.25">' + targetLabel + '</div>' +
        '<div class="lof-weight-chips">' + _weightChips(state.filters.target) + '</div>' +
        '<div class="lof-weight-why">' + _weightWhyLine(state.filters.target) + '</div>' +
      '</div>' +
      '<div class="lof-summary-card"><div class="k">Jurisdictions matching</div>' +
        '<div class="v">' + n + '</div>' +
        '<div class="s">' + withQctAndDda + ' with QCT + DDA</div></div>' +
      '<div class="lof-summary-card"><div class="k">Avg opportunity score</div>' +
        '<div class="v">' + avgScore + '<span style="font-size:.7rem;color:var(--muted)">/100</span></div></div>' +
      '<div class="lof-summary-card"><div class="k">Never-funded jurisdictions</div>' +
        '<div class="v">' + neverFunded + '</div>' +
        '<div class="s">no LIHTC project on record</div></div>';
    if (top) {
      html += '<div class="lof-summary-card"><div class="k">Top target</div>' +
        '<div class="v" style="font-size:.95rem;line-height:1.25">' + escHtml(top.name) + '</div>' +
        '<div class="s">' + escHtml(top.countyName) + ' · ' + _activeScore(top) + '/100</div></div>';
    }
    $('lofSummaryCards').innerHTML = html;
  }

  /* ── Civic-capacity cell renderer (table) ─────────────────────────── */

  // F10: Capture-advantage cell — surfaces market vs LIHTC 60% AMI 2BR rent.
  // Positive (LIHTC undercuts market) = green pill. Negative = warn-orange.
  // Tooltip explains the math + actual $ values.
  function _captureCell(op) {
    var m = op.market;
    if (!m || !Number.isFinite(m.captureAdvantage)) {
      return '<span class="lof-capture-pill lof-capture-na" title="No FMR/IL data for this county">—</span>';
    }
    var ca = m.captureAdvantage;
    var cls = ca >= 100 ? 'lof-capture-strong'
            : ca >= 0   ? 'lof-capture-mod'
            :             'lof-capture-neg';
    var sign = ca > 0 ? '+' : (ca === 0 ? '±' : '−');
    var amt  = Math.abs(ca);

    // Q5: enrich the tooltip with ZORI when the county is in Zillow's
    // dataset. ZORI tracks 35-65th pctile asking rents monthly — closer
    // to median market rent than HUD FMR (40th-pctile, ~2-yr lagged).
    // Useful corroboration of the FMR-based capture signal.
    var zoriRec = state.zoriByCounty && op.containingCounty ? state.zoriByCounty[op.containingCounty] : null;
    var zoriLine = '';
    if (zoriRec && Number.isFinite(zoriRec.rent)) {
      var yoyStr = Number.isFinite(zoriRec.yoy_change_pct)
        ? ' (' + (zoriRec.yoy_change_pct >= 0 ? '+' : '') + zoriRec.yoy_change_pct.toFixed(1) + '% YoY)'
        : '';
      // FMR is a 40th-pctile floor; ZORI is closer to median. Gap between
      // them is informative — large positive ZORI-vs-FMR means the county
      // is HOTTER than HUD's FMR suggests (FMR lags), and the LIHTC ceiling
      // is even further below achievable rent than the capture column shows.
      var zoriDelta = zoriRec.rent - m.fmr2br;
      var deltaStr = zoriDelta >= 0
        ? ' · ZORI runs $' + Math.round(zoriDelta).toLocaleString() + ' ABOVE FMR — FMR likely understates achievable rent'
        : ' · ZORI runs $' + Math.round(-zoriDelta).toLocaleString() + ' BELOW FMR — soft market, achievable rent under ceiling';
      zoriLine = ' · Zillow ZORI all-BR median: $' + zoriRec.rent.toLocaleString() + yoyStr + deltaStr;
    }

    var tip = 'FMR 2BR: $' + m.fmr2br.toLocaleString() + ' · LIHTC 60% AMI 2BR max: $' + m.lihtc60ami2br.toLocaleString() +
              (ca < 0 ? ' · LIHTC above market — needs deeper AMI mix to pencil'
                      : ca === 0 ? ' · LIHTC ≈ market — narrow margin'
                      : ' · LIHTC undercuts market — easy lease-up') +
              zoriLine;
    return '<span class="lof-capture-pill ' + cls + '" title="' + escHtml(tip) + '">' +
      sign + '$' + amt + '/mo</span>';
  }

  // Dedicated Prop 123 cell — surfaces the commitment-filed status that
  // was previously only visible inside the civic-cell icon group. Added
  // in F9 because Prop 123 is a real CHFA QAP scoring driver and users
  // wanted to scan it without hovering tooltips. CDPs can't file (no
  // local government) — shown as "N/A · CDP".
  function _prop123Cell(op) {
    if (op.type === 'cdp') {
      return '<span class="lof-prop123-pill lof-prop123-na" title="CDPs (unincorporated) cannot file Prop 123 — no local government to commit on behalf of">N/A · CDP</span>';
    }
    var dims = (op.civic && op.civic.dimensions) || {};
    var p123 = op.prop123Detail;
    if (p123) {
      var dateTxt = p123.filing_date ? ' · ' + escHtml(p123.filing_date) : '';
      var fastTrack = p123.fast_track
        ? ' <span style="font-size:.65rem;color:var(--accent);font-weight:700">FAST</span>'
        : '';
      return '<span class="lof-prop123-pill lof-prop123-yes" ' +
        'title="Filed with DOLA' + (p123.filing_date ? ' on ' + p123.filing_date : '') +
        (p123.fast_track ? ' · fast-track eligible' : '') + '">' +
        '✓ Filed' + dateTxt + fastTrack + '</span>';
    }
    if (dims.prop123_committed === true) {
      return '<span class="lof-prop123-pill lof-prop123-yes" title="Committed via county fallback (no direct filing record)">✓ Filed</span>';
    }
    if (dims.prop123_committed === false) {
      return '<span class="lof-prop123-pill lof-prop123-no" title="No Prop 123 commitment filed with DOLA">—</span>';
    }
    return '<span class="lof-prop123-pill lof-prop123-unk" title="Prop 123 status unknown for this jurisdiction">?</span>';
  }

  function _civicCell(op) {
    if (op.civicScore == null) {
      return '<span style="color:var(--muted);font-size:.78rem">—</span>';
    }
    var dims = (op.civic && op.civic.dimensions) || {};
    var prop123 = dims.prop123_committed ? '✓' : '·';
    var hna = dims.has_hna ? '✓' : '·';
    var plan = dims.has_comp_plan ? '✓' : '·';
    var band = op.civicScore >= 70 ? 'high' : op.civicScore >= 40 ? 'med' : 'low';
    var tipBits = [
      'Prop 123: ' + (dims.prop123_committed ? 'committed' : (dims.prop123_committed === false ? 'no' : '—')),
      'HNA: '      + (dims.has_hna           ? 'yes' : (dims.has_hna === false ? 'no' : '—')),
      'Comp plan: '+ (dims.has_comp_plan     ? 'yes' : (dims.has_comp_plan === false ? 'no' : '—')),
      'HA: '       + (dims.has_housing_authority ? 'yes' : 'no'),
      'IZ: '       + (dims.has_iz_ordinance      ? 'yes' : 'no'),
      'Local $: '  + (dims.has_local_funding     ? 'yes' : 'no')
    ];
    return '<span class="lof-civic-cell lof-civic-' + band + '" ' +
      'title="' + escHtml(tipBits.join(' · ')) + '">' +
      op.civicScore + '<span style="font-size:.7rem;color:var(--muted)">/100</span> ' +
      '<span style="font-family:ui-monospace,monospace;font-size:.7rem;letter-spacing:.05em">' +
      prop123 + hna + plan +
      '</span></span>';
  }

  /* ── News linkouts ────────────────────────────────────────────────── */

  // Build a Google News query that includes the jurisdiction name and
  // an affordable-housing context. CO Sun and CPR don't have public
  // tag-search APIs we can deep-link to reliably, so we use Google
  // site-search URLs for those.
  function newsUrls(placeName, countyName) {
    var n = encodeURIComponent('"' + placeName + '" Colorado affordable housing');
    var c = encodeURIComponent('"' + countyName + '" affordable housing');
    return {
      googleNews:  'https://news.google.com/search?q=' + n + '&hl=en-US&gl=US&ceid=US%3Aen',
      coloradoSun:'https://www.google.com/search?q=site%3Acoloradosun.com+' + n,
      cpr:        'https://www.google.com/search?q=site%3Acpr.org+' + n,
      bizwest:    'https://www.google.com/search?q=site%3Abizwest.com+' + n,
      countyNews: 'https://news.google.com/search?q=' + c + '&hl=en-US&gl=US&ceid=US%3Aen'
    };
  }

  // J — When the user's filter combo returns 0 results (the SLV-region
  // + requireCapture case is the canonical example), compute which
  // single filter elimination would unlock the MOST matches. Surface
  // that as an actionable suggestion so the user doesn't have to guess
  // which control is too restrictive.
  function _suggestFilterRelaxation() {
    var f = state.filters;
    // List of filter "predicates" with a label + a function that returns
    // a copy of f with that one constraint loosened. We re-run the filter
    // pipeline with each variant and pick the one yielding the most hits.
    var candidates = [];
    if (f.requireCapture) {
      candidates.push({
        label: 'Allow LIHTC 60% AMI ≥ FMR (rural rent-too-low markets)',
        action: 'requireCapture',
        target: false,
        loose: Object.assign({}, f, { requireCapture: false })
      });
    }
    if (f.basis === 'both') {
      candidates.push({
        label: 'Accept QCT or DDA (not strict QCT+DDA)',
        action: 'basis',
        target: 'either',
        loose: Object.assign({}, f, { basis: 'either' })
      });
    } else if (f.basis === 'qct' || f.basis === 'dda') {
      candidates.push({
        label: 'Accept either QCT or DDA designation',
        action: 'basis',
        target: 'either',
        loose: Object.assign({}, f, { basis: 'either' })
      });
    } else if (f.basis === 'either') {
      candidates.push({
        label: 'Drop basis-boost requirement (include non-QCT/DDA)',
        action: 'basis',
        target: 'none',
        loose: Object.assign({}, f, { basis: 'none' })
      });
    }
    if (f.region) {
      candidates.push({
        label: 'Show all Colorado regions (drop region filter)',
        action: 'region',
        target: '',
        loose: Object.assign({}, f, { region: '' })
      });
    }
    if (f.county) {
      candidates.push({
        label: 'Show all counties (drop county filter)',
        action: 'county',
        target: '',
        loose: Object.assign({}, f, { county: '' })
      });
    }
    if (f.minScore > 0) {
      candidates.push({
        label: 'Drop min opportunity score (currently ≥' + f.minScore + ')',
        action: 'minScore',
        target: 0,
        loose: Object.assign({}, f, { minScore: 0 })
      });
    }
    if (f.minYearsSince > 0) {
      candidates.push({
        label: 'Drop "min years since last LIHTC" (currently ≥' + f.minYearsSince + ' years)',
        action: 'minYearsSince',
        target: 0,
        loose: Object.assign({}, f, { minYearsSince: 0 })
      });
    }
    if (f.minPop > 0) {
      candidates.push({
        label: 'Drop min population (currently ≥' + f.minPop.toLocaleString() + ')',
        action: 'minPop',
        target: 0,
        loose: Object.assign({}, f, { minPop: 0 })
      });
    }
    if (f.minPreservation > 0) {
      candidates.push({
        label: 'Drop min preservation candidates (currently ≥' + f.minPreservation + ')',
        action: 'minPreservation',
        target: 0,
        loose: Object.assign({}, f, { minPreservation: 0 })
      });
    }
    if (f.onlyUrgentPres) {
      candidates.push({
        label: 'Show all jurisdictions (not just those with expiring ≤5y preservation)',
        action: 'onlyUrgentPres',
        target: false,
        loose: Object.assign({}, f, { onlyUrgentPres: false })
      });
    }
    if (!f.includeCdps) {
      candidates.push({
        label: 'Include CDPs (unincorporated jurisdictions)',
        action: 'includeCdps',
        target: true,
        loose: Object.assign({}, f, { includeCdps: true })
      });
    }
    if (!candidates.length) return null;
    // Run the filter pipeline once per candidate, swapping in the loose
    // filter set. We re-implement the predicates inline to avoid the
    // global state.filters mutation that _applyFilters reads.
    function _countWith(loose) {
      return state.opportunities.filter(function (op) {
        switch (loose.basis) {
          case 'both':   if (!op.hasBoth) return false; break;
          case 'either': if (!op.hasQct && !op.hasDda) return false; break;
          case 'qct':    if (!op.hasQct || op.hasDda) return false; break;
          case 'dda':    if (!op.hasDda || op.hasQct) return false; break;
          case 'none':   break;
          default:       if (!op.hasBoth) return false;
        }
        if (!loose.includeCdps && op.type === 'cdp') return false;
        if (loose.county && op.containingCounty !== loose.county) return false;
        if (loose.region && op.region !== loose.region) return false;
        if (loose.minYearsSince > 0 && (op.yearsSince == null || op.yearsSince < loose.minYearsSince)) return false;
        if (loose.minScore > 0 && _activeScore(op) < loose.minScore) return false;
        if (loose.minPop > 0 && (op.population || 0) < loose.minPop) return false;
        if (loose.minPreservation > 0 && (op.preservationCount || 0) < loose.minPreservation) return false;
        if (loose.onlyUrgentPres && (op.preservationUrgent5y || 0) === 0) return false;
        if (loose.requireCapture && (op.captureAdvantage == null || op.captureAdvantage <= 0)) return false;
        return true;
      }).length;
    }
    candidates.forEach(function (c) { c.unlocks = _countWith(c.loose); });
    // Filter to only candidates that actually unlock something — a 0-unlock
    // suggestion is confusing UX (looked like "Drop basis-boost → 0
    // jurisdictions" alongside "Drop region → 55"). Then sort by impact.
    var actionable = candidates.filter(function (c) { return c.unlocks > 0; });
    actionable.sort(function (a, b) { return b.unlocks - a.unlocks; });
    return actionable.length > 0 ? actionable.slice(0, 3) : null;
  }

  function _applySuggestedRelaxation(action, targetValue) {
    if (!(action in state.filters)) return;
    state.filters[action] = targetValue;
    // Sync the corresponding UI control so the user sees the change.
    if (action === 'requireCapture') {
      var chk = $('lofRequireCapture'); if (chk) chk.checked = !!targetValue;
    } else if (action === 'basis') {
      var radios = document.querySelectorAll('input[name="lofBasis"]');
      radios.forEach(function (r) { r.checked = (r.value === targetValue); });
    } else if (action === 'region') {
      var rs = $('lofRegion'); if (rs) rs.value = targetValue;
    } else if (action === 'county') {
      var cs = $('lofCounty'); if (cs) cs.value = targetValue;
    } else if (action === 'minScore') {
      var ms = $('lofMinScore'); if (ms) { ms.value = targetValue; var lbl = $('lofMinScoreVal'); if (lbl) lbl.textContent = targetValue; }
    } else if (action === 'minYearsSince') {
      var my = $('lofMinYearsSince'); if (my) { my.value = targetValue; var lbl2 = $('lofMinYearsSinceVal'); if (lbl2) lbl2.textContent = targetValue; }
    } else if (action === 'minPop') {
      var mp = $('lofMinPop'); if (mp) mp.value = targetValue;
    } else if (action === 'minPreservation') {
      var mpr = $('lofMinPreservation'); if (mpr) { mpr.value = targetValue; var lbl3 = $('lofMinPreservationVal'); if (lbl3) lbl3.textContent = targetValue; }
    } else if (action === 'onlyUrgentPres') {
      var up = $('lofPresUrgent'); if (up) up.checked = !!targetValue;
    } else if (action === 'includeCdps') {
      var ic = $('lofIncludeCdps'); if (ic) ic.checked = !!targetValue;
    }
    _refresh();
  }
  // Expose so the empty-state buttons can call it
  window._lofApplyRelaxation = _applySuggestedRelaxation;

  function _renderTable(filtered) {
    var tbody = $('lofTableBody');
    if (!filtered.length) {
      var suggestions = _suggestFilterRelaxation();
      var html = '<tr><td colspan="12" class="lof-loading" style="padding:24px 16px;">' +
        '<div style="font-size:.95rem;margin-bottom:8px;">No jurisdictions match the current filters.</div>';

      // M3 — region-specific explainer for the rural regions that
      // structurally fail the default filter combo. SLV + Eastern Plains
      // FMRs are at or below LIHTC 60% AMI rent ceilings, so requireCapture
      // (which screens for LIHTC 60% AMI < FMR) wipes them all out.
      // Surface the real reason instead of just suggesting loose filters.
      var f = state.filters || {};
      if (f.region === 'San Luis Valley' || f.region === 'Eastern Plains') {
        html += '<div style="font-size:.85rem;line-height:1.55;background:var(--bg2,#f7fafc);' +
          'border-left:3px solid var(--accent,#096e65);padding:10px 12px;margin-bottom:12px;' +
          'border-radius:0 6px 6px 0;color:var(--text,#1a202c);">' +
          '<strong>Why is ' + escHtml(f.region) + ' empty?</strong> Rural CO regions ' +
          'often have FMR rents already at or below the LIHTC 60% AMI ceiling, so the ' +
          '<code style="font-size:.85em;">require capture advantage</code> filter ' +
          '(LIHTC 60% rent &lt; FMR) screens them all out — there\'s no rent uplift ' +
          'from building LIHTC. Common rural play: <strong>4% bond + state HTC + ' +
          'USDA RD/preservation</strong>, where the underwrite doesn\'t depend on ' +
          'beating FMR. Drop the capture-advantage filter to see options.' +
          '</div>';
      }

      if (suggestions && suggestions.length) {
        html += '<div style="font-size:.85rem;opacity:.85;margin-bottom:10px;">Try loosening one of these — most-impactful first:</div>';
        html += '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;">';
        suggestions.forEach(function (s) {
          html += '<button type="button" ' +
            'onclick="window._lofApplyRelaxation(' + JSON.stringify(s.action) + ', ' + JSON.stringify(s.target) + ')" ' +
            'style="padding:7px 12px;border:1px solid var(--accent);border-radius:6px;background:transparent;color:var(--accent);font-size:.82rem;font-weight:600;cursor:pointer;text-align:left;">' +
            s.label + ' <span style="opacity:.75;font-weight:400;">→ ' + s.unlocks + ' jurisdiction' + (s.unlocks === 1 ? '' : 's') + '</span></button>';
        });
        html += '</div>';
      }
      html += '</td></tr>';
      tbody.innerHTML = html;
      return;
    }
    var rows = filtered.map(function (op) {
      var typeHtml = '';
      if (op.hasBoth) typeHtml = '<span class="lof-badge lof-badge--both">QCT + DDA</span>';
      else if (op.hasQct) typeHtml = '<span class="lof-badge lof-badge--qct">QCT</span>';
      else if (op.hasDda) typeHtml = '<span class="lof-badge lof-badge--dda">DDA</span>';
      var lastFundedText = op.lastYear != null
        ? op.lastYear + ' <span style="color:var(--muted)">(' + op.yearsSince + 'y)</span>'
        : '<em>Never</em>';
      var activeScore = _activeScore(op);
      var scoreCls = 'lof-score-' + _scoreBand(activeScore);
      var selectedCls = (state.selectedId === op.id) ? ' is-selected' : '';
      // F11 mobile context: on small viewports we hide secondary/tertiary
      // <td>s via CSS. The jurisdiction subtitle now folds in the type
      // (city/town/cdp) AND county name so users keep context when the
      // dedicated Type + County columns are hidden.
      var typeText = op.hasBoth ? 'QCT+DDA' : op.hasQct ? 'QCT' : op.hasDda ? 'DDA' : '';
      var jurisSubtitle =
        '<div class="lof-juris-sub">' +
          '<span class="lof-juris-type">' + escHtml(op.type) + '</span>' +
          (typeText ? ' · <span class="lof-juris-badge-mini">' + escHtml(typeText) + '</span>' : '') +
          ' · ' + escHtml(op.countyName) +
        '</div>';
      return '<tr data-op-id="' + escHtml(op.id) + '" class="' + selectedCls.trim() + '">' +
        '<td data-priority="primary"><span class="lof-score-cell ' + scoreCls + '">' + activeScore + '</span></td>' +
        '<td data-priority="primary"><strong>' + escHtml(op.name) + '</strong>' +
          ' <a href="' + escHtml(hnaUrlForPlace(op.placeGeoid)) + '" ' +
            'target="_blank" rel="noopener" class="lof-hna-link" ' +
            'title="Open Housing Needs Assessment for ' + escHtml(op.name) + '" ' +
            'aria-label="Open Housing Needs Assessment for ' + escHtml(op.name) + ' in new tab" ' +
            'onclick="event.stopPropagation()">→ HNA</a>' +
          jurisSubtitle + '</td>' +
        '<td data-priority="tertiary">' + typeHtml + (op.qctCount > 1 ? '<span style="font-size:.7rem;color:var(--muted);margin-left:4px">×' + op.qctCount + '</span>' : '') + '</td>' +
        '<td data-priority="secondary">' + escHtml(op.countyName) + '</td>' +
        '<td data-priority="tertiary">' + lastFundedText + '</td>' +
        '<td data-priority="tertiary">' + op.projectCount + (op.totalUnits ? ' <span style="color:var(--muted);font-size:.72rem">(' + fmtInt(op.totalUnits) + ' u)</span>' : '') + '</td>' +
        '<td data-priority="tertiary">' + (op.needScore != null ? op.needScore : '—') + '<span style="font-size:.7rem;color:var(--muted)">p</span></td>' +
        '<td data-priority="tertiary">' + (op.population != null ? fmtInt(op.population) : '—') + '</td>' +
        '<td data-priority="primary">' + _captureCell(op) + '</td>' +
        '<td data-priority="secondary">' + _civicCell(op) + '</td>' +
        '<td data-priority="secondary">' + _prop123Cell(op) + '</td>' +
        '<td data-priority="tertiary" style="font-size:.72rem;color:var(--muted)">9%·' + op.score9 + ' · 4%·' + op.score4 + '</td>' +
      '</tr>';
    }).join('');
    tbody.innerHTML = rows;
    Array.from(tbody.querySelectorAll('tr[data-op-id]')).forEach(function (tr) {
      tr.addEventListener('click', function () {
        _showDetail(tr.getAttribute('data-op-id'));
      });
    });
  }

  function _renderMap(filtered) {
    if (!state.map) return;
    // Only the jurisdiction markers depend on the active filter — DDA / QCT /
    // LIHTC overlays are global and managed by _initMapOverlays() so the user
    // always sees the full basis-boost geography regardless of filter state.
    ['jurisdiction', 'highlight'].forEach(function (k) {
      if (state.layers[k]) {
        state.map.removeLayer(state.layers[k]);
        state.layers[k] = null;
      }
    });

    // Markers for each jurisdiction using its centroid. Marker anchor
    // priority: (1) tract-weighted centroid computed at rollup time,
    // (2) first LIHTC project lat/lng, (3) skip — don't drop a misleading
    // marker at the state center.
    //
    // When two jurisdictions share the exact same tract centroid (e.g.
    // Sugar City + Olney Springs both fall in Crowley tract 969601),
    // jitter the second one slightly so both are visible.
    var jurisLayer = window.L.layerGroup();
    var usedCoords = {};   // "lat,lng" key → count of markers already placed
    filtered.forEach(function (op) {
      var lat = op.centroidLat;
      var lng = op.centroidLng;
      if (lat == null || lng == null) return;
      // Jitter co-located markers in a small spiral so all are clickable.
      var key = lat.toFixed(4) + ',' + lng.toFixed(4);
      var n = usedCoords[key] = (usedCoords[key] || 0) + 1;
      if (n > 1) {
        var angle = ((n - 1) / 6) * Math.PI * 2;
        var radiusDeg = 0.015; // ~1.6 km
        lat = lat + Math.sin(angle) * radiusDeg;
        lng = lng + Math.cos(angle) * radiusDeg;
      }
      var activeScore = _activeScore(op);
      var color = activeScore >= 70 ? '#16a34a' : activeScore >= 50 ? '#f59e0b' : '#94a3b8';
      var marker = window.L.circleMarker([lat, lng], {
        radius: 6 + Math.round(activeScore / 25),
        color: '#fff', weight: 1.5,
        fillColor: color, fillOpacity: 0.9
      });
      marker.bindTooltip(
        '<strong>' + escHtml(op.name) + '</strong><br>' +
        op.countyName + ' · score ' + activeScore + '/100<br>' +
        (op.lastYear != null ? 'Last LIHTC: ' + op.lastYear : 'Never funded'),
        { sticky: true }
      );
      marker.on('click', function () { _showDetail(op.id); });
      jurisLayer.addLayer(marker);
    });
    jurisLayer.addTo(state.map);
    state.layers.jurisdiction = jurisLayer;

    // Auto-fit map to markers + DDA polygons so the user actually sees
    // their filter result (otherwise default view 5 jurisdictions in
    // Crowley + Summit counties get lost on a state-wide map).
    var bounds = window.L.latLngBounds([]);
    filtered.forEach(function (op) {
      if (op.centroidLat != null && op.centroidLng != null) {
        bounds.extend([op.centroidLat, op.centroidLng]);
      }
    });
    if (bounds.isValid()) {
      state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 9 });
    }
  }

  /* ── Detail-panel sub-renderers ───────────────────────────────────── */

  function _renderCivicPanel(op) {
    var dims = (op.civic && op.civic.dimensions) || {};
    var lr = op.localRes || {};
    var p123Detail = op.prop123Detail;

    function checkRow(label, val, extra) {
      var icon = val === true  ? '<span class="lof-civic-check lof-civic-yes">✓</span>'
               : val === false ? '<span class="lof-civic-check lof-civic-no">✗</span>'
               :                  '<span class="lof-civic-check lof-civic-unk">?</span>';
      return '<div class="lof-civic-row">' +
        '<span class="lof-civic-label">' + label + '</span>' + icon +
        (extra ? '<span class="lof-civic-extra">' + extra + '</span>' : '') +
      '</div>';
    }

    // Prop 123 row — pull from local-resources (link) + prop123_jurisdictions (filing date).
    // Three coverage tiers:
    //   1. Direct prop123 jurisdiction record (filed under own name) — show filing date + fast-track.
    //   2. local-resources has a prop123 entry (often county-level) — show status.
    //   3. policy-scorecard says prop123_committed=true via county fallback — show "via [County]".
    var p123Extra = '';
    if (p123Detail) {
      var bits = [];
      if (p123Detail.filing_date) bits.push('filed ' + p123Detail.filing_date);
      if (p123Detail.fast_track)  bits.push('<span class="lof-pill lof-pill--accent">fast-track</span>');
      if (p123Detail.required_commitment) bits.push(escHtml(p123Detail.required_commitment));
      var p123Link = (lr.prop123 && lr.prop123.link) ||
                     p123Detail.source_url ||
                     'https://cdola.colorado.gov/commitment-filings';
      p123Extra = bits.join(' · ') +
        ' <a href="' + escHtml(p123Link) + '" target="_blank" rel="noopener">DOLA filing →</a>';
    } else if (lr.prop123) {
      p123Extra = escHtml(lr.prop123.status || 'See DOLA filings') +
        ' <a href="' + escHtml(lr.prop123.link || 'https://cdola.colorado.gov/commitment-filings') +
        '" target="_blank" rel="noopener">DOLA filing →</a>';
    } else if (dims.prop123_committed === true && op.countyName) {
      p123Extra = '<span class="lof-civic-sub">via ' + escHtml(op.countyName) +
        ' commitment</span> <a href="https://cdola.colorado.gov/commitment-filings" ' +
        'target="_blank" rel="noopener">DOLA filings →</a>';
    }

    // Housing lead row — local-resources.housingLead
    var leadExtra = '';
    if (lr.housingLead && lr.housingLead.name) {
      leadExtra = escHtml(lr.housingLead.name);
      if (lr.housingLead.url) {
        leadExtra += ' <a href="' + escHtml(lr.housingLead.url) + '" target="_blank" rel="noopener">contact →</a>';
      }
    }

    // Housing plans row — local-resources.housingPlans (comp plan / HNA / housing element)
    var planRows = '';
    if (Array.isArray(lr.housingPlans) && lr.housingPlans.length) {
      planRows = '<div class="lof-civic-row lof-civic-row--block">' +
        '<span class="lof-civic-label">Plans on file</span>' +
        '<ul class="lof-civic-list">' +
        lr.housingPlans.map(function (p) {
          var url = p.url ? ' <a href="' + escHtml(p.url) + '" target="_blank" rel="noopener">→</a>' : '';
          var yr = p.year ? ' (' + p.year + ')' : '';
          // Schema convention is `name`; older entries (or earlier authoring
          // mistakes) sometimes used `title`. Read both for backward-compat.
          var planName = p.name || p.title;
          return '<li><strong>' + escHtml(p.type || 'Plan') + '</strong>' + yr + url +
            (planName ? '<br><span class="lof-civic-sub">' + escHtml(planName) + '</span>' : '') +
          '</li>';
        }).join('') +
        '</ul></div>';
    }

    // Housing authorities row
    var haRows = '';
    if (Array.isArray(lr.housingAuthority) && lr.housingAuthority.length) {
      haRows = '<div class="lof-civic-row lof-civic-row--block">' +
        '<span class="lof-civic-label">Housing authorities</span>' +
        '<ul class="lof-civic-list">' +
        lr.housingAuthority.map(function (h) {
          var url = h.url ? ' <a href="' + escHtml(h.url) + '" target="_blank" rel="noopener">→</a>' : '';
          var contact = h.contact ? ' <span class="lof-civic-sub">(' + escHtml(h.contact) + ')</span>' : '';
          var units = h.totalUnits ? ' <span class="lof-civic-sub">· ' + fmtInt(h.totalUnits) + ' units</span>' : '';
          return '<li>' + escHtml(h.name) + url + contact + units + '</li>';
        }).join('') +
        '</ul></div>';
    }

    // Advocacy / nonprofits row
    var advRows = '';
    if (Array.isArray(lr.advocacy) && lr.advocacy.length) {
      advRows = '<div class="lof-civic-row lof-civic-row--block">' +
        '<span class="lof-civic-label">Advocacy &amp; nonprofits</span>' +
        '<ul class="lof-civic-list">' +
        lr.advocacy.map(function (a) {
          var url = a.url ? ' <a href="' + escHtml(a.url) + '" target="_blank" rel="noopener">→</a>' : '';
          return '<li>' + escHtml(a.name) + url + '</li>';
        }).join('') +
        '</ul></div>';
    }

    // Key contacts / people row — local-resources.contacts. Present in the data
    // for most counties (planning + housing directors) but was never rendered.
    var contactRows = '';
    if (Array.isArray(lr.contacts) && lr.contacts.length) {
      contactRows = '<div class="lof-civic-row lof-civic-row--block">' +
        '<span class="lof-civic-label">Key contacts</span>' +
        '<ul class="lof-civic-list">' +
        lr.contacts.map(function (c) {
          var url   = c.url ? ' <a href="' + escHtml(c.url) + '" target="_blank" rel="noopener">→</a>' : '';
          var title = c.title ? '<span class="lof-civic-sub"> · ' + escHtml(c.title) + '</span>' : '';
          return '<li>' + escHtml(c.name) + title + url + '</li>';
        }).join('') +
        '</ul></div>';
    }

    var scoreBadge = '';
    if (op.civicScore != null) {
      var band = op.civicScore >= 70 ? 'high' : op.civicScore >= 40 ? 'med' : 'low';
      scoreBadge = '<span class="lof-civic-score-badge lof-civic-' + band + '">' +
        'Policy score ' + op.civicScore + '/100 (' + op.civicRawScore + '/' + op.civicMax + ' signals)' +
      '</span>';
    } else {
      scoreBadge = '<span class="lof-civic-score-badge lof-civic-unk">No policy-scorecard record</span>';
    }

    // Local-resources resolution notice — many places only have county-level
    // data. Surface explicitly so the user knows when they're seeing the
    // county's housing authority etc. instead of place-specific.
    var resolvedNotice = '';
    if (lr && lr._resolvedFrom === 'county-fallback') {
      resolvedNotice = '<p class="lof-civic-fallback">⚠ Showing <strong>' + escHtml(op.countyName) +
        '</strong> resources — no place-level entry for ' + escHtml(op.name) + ' yet. ' +
        '<a href="https://github.com/pggLLC/Housing-Analytics/blob/main/scripts/augment-local-resources.js" target="_blank" rel="noopener">Help us add it</a></p>';
    }

    return '<h4 class="lof-section-h">Civic capacity ' + scoreBadge + '</h4>' +
      resolvedNotice +
      checkRow('Prop 123 committed',  dims.prop123_committed,    p123Extra) +
      checkRow('Local HNA published', dims.has_hna,              '') +
      checkRow('Comp plan / housing element', dims.has_comp_plan, '') +
      checkRow('Inclusionary zoning ordinance', dims.has_iz_ordinance, '') +
      checkRow('Local housing funding', dims.has_local_funding,   '') +
      (leadExtra ?
        '<div class="lof-civic-row"><span class="lof-civic-label">Housing lead</span>' +
        '<span class="lof-civic-check lof-civic-yes">✓</span>' +
        '<span class="lof-civic-extra">' + leadExtra + '</span></div>'
        : '') +
      planRows + haRows + advRows + contactRows;
  }

  // F58: Labor market & commute panel.
  // Pulls block-classified LODES OD flows + place-level LEHD aggregate (when
  // available) and renders a short three-stat row + 1-line interpretation:
  //   live & work in place  /  inflow (commute in)  /  outflow (commute out)
  // plus an "X% of resident workers leave the place for work" framing that
  // tells the user whether the local labor market is self-contained or
  // bedroom-community-oriented. Returns '' (empty string) when neither
  // PlaceLehd nor place-od-flows has data for this geoid — the caller hides
  // the host element in that case.
  function _renderLaborPanel(op) {
    if (!op || !op.placeGeoid) return '';
    var od = state.placeOdFlows && state.placeOdFlows[op.placeGeoid] || null;
    var lehd = (window.PlaceLehd && window.PlaceLehd.lookup)
      ? window.PlaceLehd.lookup(op.placeGeoid)
      : null;

    // Prefer the block-OD numbers (cleaner spatial classification); fall back
    // to whatever LEHD aggregate carries within/inflow/outflow.
    var within = null, inflow = null, outflow = null, jobsAt = null;
    var source = null;
    if (od) {
      within  = Number.isFinite(od.within)  ? od.within  : null;
      inflow  = Number.isFinite(od.inflow)  ? od.inflow  : null;
      outflow = Number.isFinite(od.outflow) ? od.outflow : null;
      jobsAt  = Number.isFinite(od.jobs)    ? od.jobs    : null;
      source  = 'block-od';
    } else if (lehd) {
      within  = Number.isFinite(lehd.within)  ? lehd.within  : null;
      inflow  = Number.isFinite(lehd.inflow)  ? lehd.inflow  : null;
      outflow = Number.isFinite(lehd.outflow) ? lehd.outflow : null;
      jobsAt  = Number.isFinite(lehd.C000)    ? lehd.C000    : null;
      source  = lehd.flows_source || 'tract-lodes';
    }

    if (within == null && inflow == null && outflow == null) return '';

    var residentWorkers = (within || 0) + (outflow || 0);
    var outflowPct = residentWorkers > 0 ? Math.round(100 * (outflow || 0) / residentWorkers) : null;

    var fmt = function (n) { return Number.isFinite(n) ? n.toLocaleString() : '—'; };

    var sourceNote = '';
    if (source === 'block-od') {
      sourceNote = 'Block-classified LEHD LODES OD (every home block → work block pair classified against this place\'s boundary; no intra-place double-counting).';
    } else if (source === 'tract-lodes') {
      sourceNote = 'Tract-aggregated LEHD LODES, weighted by this place\'s share of each tract — directional where a tract extends past the municipal boundary.';
    } else {
      sourceNote = 'LEHD LODES origin-destination flows.';
    }

    var lead = '';
    if (outflowPct != null) {
      if (outflowPct >= 70) {
        lead = '<strong>Bedroom community</strong> — ' + outflowPct + '% of resident workers commute out for jobs. Workforce-housing demand likely tracks the regional employment center more than local jobs.';
      } else if (outflowPct >= 40) {
        lead = '<strong>Mixed labor market</strong> — ' + outflowPct + '% of resident workers commute out. Both local jobs and the regional commuteshed drive housing demand.';
      } else {
        lead = '<strong>Self-contained labor market</strong> — only ' + outflowPct + '% of resident workers commute out. Local jobs anchor the housing demand picture.';
      }
    }

    var inflowRatio = (jobsAt && residentWorkers > 0)
      ? Math.round(100 * (inflow || 0) / Math.max(1, jobsAt))
      : null;
    if (inflowRatio != null && inflow != null && jobsAt != null && jobsAt > 0) {
      lead += ' Of the ' + fmt(jobsAt) + ' local jobs, ' + inflowRatio + '% are filled by people commuting in.';
    }

    return '<h4 class="lof-section-h" style="margin-top:14px;">Labor market &amp; commute</h4>' +
      '<div class="lof-labor-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:6px 0">' +
        '<div class="lof-labor-card" style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card2)">' +
          '<div style="font-size:.74rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">Live &amp; work here</div>' +
          '<div style="font-size:1.05rem;font-weight:700">' + fmt(within) + '</div>' +
        '</div>' +
        '<div class="lof-labor-card" style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card2)">' +
          '<div style="font-size:.74rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">Commute in</div>' +
          '<div style="font-size:1.05rem;font-weight:700">' + fmt(inflow) + '</div>' +
        '</div>' +
        '<div class="lof-labor-card" style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card2)">' +
          '<div style="font-size:.74rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">Commute out</div>' +
          '<div style="font-size:1.05rem;font-weight:700">' + fmt(outflow) + '</div>' +
        '</div>' +
        '<div class="lof-labor-card" style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card2)">' +
          '<div style="font-size:.74rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">Local jobs (C000)</div>' +
          '<div style="font-size:1.05rem;font-weight:700">' + fmt(jobsAt) + '</div>' +
        '</div>' +
      '</div>' +
      (lead ? '<p style="margin:6px 0 4px;font-size:.84rem;line-height:1.4">' + lead + '</p>' : '') +
      '<p style="margin:2px 0 0;font-size:.72rem;color:var(--muted);line-height:1.4">' + sourceNote + '</p>';
  }

  function _renderNewsPanel(op) {
    var urls = newsUrls(op.name, op.countyName.replace(/\s+County$/, ''));
    var cityName = encodeURIComponent(op.name + ' Colorado');
    return '<h4 class="lof-section-h">Housing news &amp; research</h4>' +
      '<div class="lof-news-grid">' +
        '<a class="lof-news-btn" href="' + urls.googleNews + '" target="_blank" rel="noopener">' +
          '🗞️ Google News<br><span>"' + escHtml(op.name) + '" affordable housing</span></a>' +
        '<a class="lof-news-btn" href="' + urls.coloradoSun + '" target="_blank" rel="noopener">' +
          '☀️ Colorado Sun<br><span>site search</span></a>' +
        '<a class="lof-news-btn" href="' + urls.cpr + '" target="_blank" rel="noopener">' +
          '📻 Colorado Public Radio<br><span>site search</span></a>' +
        '<a class="lof-news-btn" href="' + urls.bizwest + '" target="_blank" rel="noopener">' +
          '📰 BizWest<br><span>site search</span></a>' +
        '<a class="lof-news-btn" href="' + urls.countyNews + '" target="_blank" rel="noopener">' +
          '🏛️ County news<br><span>"' + escHtml(op.countyName) + '"</span></a>' +
        '<a class="lof-news-btn" href="https://www.google.com/search?q=' + cityName +
          '+housing+coordinator+OR+director+OR+manager" target="_blank" rel="noopener">' +
          '🔎 Find housing staff<br><span>web search</span></a>' +
      '</div>';
  }

  // F13: Generate top 3 "why this opportunity" reasons for the action panel.
  // Picks the highest-signal dimensions for THIS jurisdiction relative to
  // the current target deal type, written in plain English so a developer
  // can scan in 5 seconds.
  function _opActionReasons(op) {
    var reasons = [];
    // 1. Strong market capture — most actionable signal
    if (op.captureAdvantage != null && op.captureAdvantage >= 100) {
      reasons.push('<strong>Strong market capture:</strong> +$' + op.captureAdvantage +
        '/mo headroom vs LIHTC 60% AMI max rent — easy lease-up.');
    } else if (op.captureAdvantage != null && op.captureAdvantage > 0) {
      reasons.push('<strong>Positive capture margin:</strong> +$' + op.captureAdvantage +
        '/mo vs LIHTC 60% AMI max — viable at 60% AMI with care on unit mix.');
    }
    // 2. Recency / saturation headroom
    if (op.yearsSince != null && op.yearsSince >= 10) {
      reasons.push('<strong>Long LIHTC dry spell:</strong> ' + op.yearsSince + ' years since last placed-in-service (' + op.lastYear + ') — minimal saturation conflict.');
    } else if (op.lastYear == null && op.projectCount === 0) {
      reasons.push('<strong>Never funded:</strong> no LIHTC project on record — strong saturation argument.');
    }
    // 3. Basis-boost eligibility
    if (op.hasBoth) {
      reasons.push('<strong>QCT + DDA:</strong> strongest IRC §42(d)(5)(B) basis-boost case (30% extra basis).');
    } else if (op.hasQct) {
      reasons.push('<strong>QCT designation:</strong> 30% basis boost eligible (IRC §42(d)(5)(B)(i)).');
    } else if (op.hasDda) {
      reasons.push('<strong>DDA county:</strong> 30% basis boost eligible (IRC §42(d)(5)(B)(ii)).');
    }
    // 4. Civic-readiness signals
    if (op.prop123Detail || (op.civic && op.civic.dimensions && op.civic.dimensions.prop123_committed)) {
      reasons.push('<strong>Prop 123 filed:</strong> CHFA QAP awards points for jurisdictions with state-housing commitment on file.');
    }
    // 5. Need percentile
    if (op.needScore != null && op.needScore >= 70) {
      reasons.push('<strong>Acute need:</strong> ' + op.needScore + 'th percentile statewide on cost burden + AMI gap.');
    }
    // 6. Preservation urgency
    if (op.preservationUrgent5y && op.preservationUrgent5y > 0) {
      reasons.push('<strong>Preservation urgency:</strong> ' + op.preservationUrgent5y +
        ' subsidized properties expire within 5 years — Y15 acquisition or refinance window.');
    }
    // 7. Resort/public lands context
    if (op.resortLabel) {
      reasons.push('<strong>Resort county:</strong> active workforce-housing pressure (' + escHtml(op.resortLabel) + ').');
    }
    // 8. Population scale (for 4% bond targets)
    if (op.population != null && op.population >= 30000 && state.filters.target === '4pct') {
      reasons.push('<strong>Renter scale:</strong> ' + fmtInt(op.population) + ' approximate renter pool — supports 4% bond financing.');
    }

    // Fallback if nothing strong matched (shouldn't happen for top-ranked rows)
    if (reasons.length === 0) {
      reasons.push('Ranked in the top of your filtered set on the active scoring weights.');
    }
    return reasons.slice(0, 3);
  }

  // F13: Optional warning to surface in the action panel.
  function _opActionWarning(op) {
    if (op.captureAdvantage != null && op.captureAdvantage < 0) {
      return 'LIHTC 60% AMI max rent is $' + Math.abs(op.captureAdvantage) +
        '/mo ABOVE market FMR here — deal won\'t pencil at 60% AMI without a deeper-AMI mix (40-50%) or extra soft debt.';
    }
    if (op.type === 'cdp') {
      return 'This is a CDP (unincorporated) — no local government to file Prop 123 or issue building permits. Mesa/Adams/etc. County serves the area; expect longer permit + letter-of-support timelines.';
    }
    return null;
  }

  // F25: Render the PAB (private-activity-bond) direct-allocation fact for the
  // detail panel. Shows the place's own allocation when it has one; otherwise
  // falls back to the containing county (the likely conduit issuer). Always
  // appends the "capacity, not a ceiling" caveat because most CO 4% deals use
  // CHFA's statewide pool regardless of the local allocation.
  function _fmtUsd0(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function _pabFactHtml(op) {
    var pab = state.pabByGeoid || {};
    var meta = state.pabMeta || {};
    if (!state.pabMeta) {
      return '<span style="color:var(--muted)">PAB dataset not loaded — unavailable (data gap, not $0).</span>';
    }
    var year = meta.year || '';
    var sw = meta.statewide || {};

    // HEADLINE: the source that actually funds 4% deals statewide. A 4%
    // multifamily deal in CO draws from CHFA’s pool (or the DOLA statewide
    // balance) — NOT from the local direct allocation. Lead with that so the
    // number doesn’t get misread as a deal-level cap.
    var headline = '';
    if (sw.chfaPool) {
      headline = '<strong>How 4% deals here get cap:</strong> from <strong>CHFA’s statewide PAB pool</strong> (' +
        _fmtUsd0(sw.chfaPool) + ', ' + year + ') — the source for nearly all Colorado 4% LIHTC deals, ' +
        'regardless of jurisdiction.';
    }

    // SECONDARY: the local issuing-authority slice for this jurisdiction.
    var placeRec = op.placeGeoid ? pab[op.placeGeoid] : null;
    var countyRec = op.containingCounty ? pab[op.containingCounty] : null;
    var thresh = meta.approxPopulationThreshold ? meta.approxPopulationThreshold.toLocaleString() : '15,300';
    var local;

    if (placeRec && placeRec.directAllocation) {
      local = 'This jurisdiction is also a <strong>designated local issuer</strong> with its own ' +
        _fmtUsd0(placeRec.directAllocation) + ' direct allocation';
      if (countyRec && countyRec.directAllocation && op.containingCounty !== op.placeGeoid) {
        local += ' (' + escHtml(op.countyName || 'its county') + ' has ' + _fmtUsd0(countyRec.directAllocation) + ')';
      }
      local += ' — but that slice mostly funds single-family bonds / MCCs, not 4% multifamily.';
    } else if (countyRec && countyRec.directAllocation) {
      local = 'This place is below the local-issuer threshold (~' + thresh + ' pop / $1M min), so it has ' +
        'no direct allocation of its own; <strong>' + escHtml(op.countyName || 'its county') +
        '</strong> is a designated issuer (' + _fmtUsd0(countyRec.directAllocation) + ') if a local conduit is ever needed.';
    } else {
      local = 'Neither this place nor its county is a designated local issuer (both below the ~' + thresh +
        ' pop / $1M minimum) — which is the norm, not a gap. Local cap isn’t how 4% deals here get funded anyway.';
    }

    var caveat = '<br><span style="color:var(--muted);font-size:.74rem">' +
      'Local direct allocation is an issuing-authority signal, not a deal cap or ceiling. ' +
      'Federal 50% bond-test → 25% for placements after 2025-12-31 (stretches cap). Source: Colorado DOLA ' + year + '.</span>';

    return (headline ? headline + '<br><span style="font-size:.82rem">' + local + '</span>' : local) + caveat;
  }

  function _showDetail(opId) {
    var op = state.opportunities.find(function (x) { return x.id === opId; });
    if (!op) return;
    state.selectedId = opId;

    // F12: Write to SiteState so nav-menu navigations from here to PMA /
    // Deal Calculator / HNA carry the jurisdiction context even when the
    // user doesn't use the per-row cross-page CTA. Previously OF tracked
    // selection only in `state.selectedId` (local) so navigating via the
    // nav menu landed users on a blank statewide PMA. SiteState persists
    // to localStorage via `coho_state_county` key.
    try {
      if (window.SiteState && typeof window.SiteState.setCounty === 'function' && op.containingCounty) {
        window.SiteState.setCounty(op.containingCounty, op.countyName || null);
      }
    } catch (_) { /* SiteState optional — no crash if storage unavailable */ }

    var detail = $('lofDetail');
    $('lofDetailTitle').textContent = op.name + '  ·  ' + op.countyName;

    // Designation summary
    var designations = [];
    if (op.hasQct) designations.push(op.qctCount + ' QCT' + (op.qctCount > 1 ? 's' : ''));
    if (op.hasDda) designations.push('DDA (county-wide)');

    // HNA deep-link CTAs — open the full Housing Needs Assessment workup
    // for the place AND its containing county.
    var hnaCta = $('lofDetailHnaCta');
    if (hnaCta) {
      // F71: classify the current jurisdiction's labor character from
      // place-od-flows so we can offer TWO compare CTAs:
      //   1. Top score-ranked peers in the same region (old behavior)
      //   2. Top peers whose commute character matches (bedroom-vs-mixed
      //      -vs-self-contained) — apples-to-apples market comparison
      function labelCharacter(o) {
        var f = state.placeOdFlows && state.placeOdFlows[o.placeGeoid];
        if (!f) return null;
        var w = +f.within || 0, out = +f.outflow || 0;
        var residents = w + out;
        if (residents === 0) return null;
        var pct = 100 * out / residents;
        if (pct >= 70) return 'bedroom';
        if (pct >= 40) return 'mixed';
        return 'self-contained';
      }
      var selfChar = labelCharacter(op);

      // Existing region-rank pick (kept for backward compatibility — the
      // primary "compare with peers" CTA still uses this).
      var sameRegion = state.opportunities
        .filter(function (o) { return o.region === op.region && o.id !== op.id; })
        .sort(function (a, b) { return _activeScore(b) - _activeScore(a); })
        .slice(0, 3)
        .map(function (o) { return o.placeGeoid; });
      var compareIds = [op.placeGeoid].concat(sameRegion).join(',');
      var compareHref = 'compare.html?jurisdictions=' + encodeURIComponent(compareIds) +
        '&target=' + encodeURIComponent(state.filters.target);

      // F71: same-character peers, statewide, picked by score. Only show
      // when we successfully classified this jurisdiction's character.
      var charCompareHref = null;
      var charLabel = null;
      if (selfChar) {
        var sameChar = state.opportunities
          .filter(function (o) { return o.id !== op.id && labelCharacter(o) === selfChar; })
          .sort(function (a, b) { return _activeScore(b) - _activeScore(a); })
          .slice(0, 3)
          .map(function (o) { return o.placeGeoid; });
        if (sameChar.length > 0) {
          var charIds = [op.placeGeoid].concat(sameChar).join(',');
          charCompareHref = 'compare.html?jurisdictions=' + encodeURIComponent(charIds) +
            '&target=' + encodeURIComponent(state.filters.target);
          charLabel = selfChar === 'bedroom' ? '🛏️ Bedroom communities'
                    : selfChar === 'mixed'   ? '🔀 Mixed markets'
                                             : '🏢 Self-contained markets';
        }
      }

      hnaCta.innerHTML =
        '<a class="lof-hna-cta lof-hna-cta--primary" href="' + escHtml(hnaUrlForPlace(op.placeGeoid)) +
          '" target="_blank" rel="noopener">' +
          '📋 Housing Needs Assessment — ' + escHtml(op.name) +
        '</a>' +
        (op.containingCounty ?
          '<a class="lof-hna-cta lof-hna-cta--secondary" href="' + escHtml(hnaUrlForCounty(op.containingCounty)) +
            '" target="_blank" rel="noopener">' +
            'County HNA — ' + escHtml(op.countyName) +
          '</a>' : '') +
        '<a class="lof-hna-cta lof-hna-cta--secondary" href="' + escHtml(compareHref) +
          '" target="_blank" rel="noopener" title="Compare this jurisdiction against top peers in ' + escHtml(op.region || 'CO') + '">' +
          '⚖️ Compare with peers (same region)' +
        '</a>' +
        (charCompareHref ?
          '<a class="lof-hna-cta lof-hna-cta--secondary" href="' + escHtml(charCompareHref) +
            '" target="_blank" rel="noopener" title="Compare against the top-scored statewide peers with the SAME labor-market character (' + selfChar + '). Strips out region noise — useful when commute character drives demand more than geography does (e.g. resort-area bedroom towns).">' +
            '⚖️ Compare vs ' + charLabel +
          '</a>' : '');
    }

    // F13: prescriptive "Take action" panel — surfaces the top 3 reasons
    // this jurisdiction was ranked here + clear next-step CTAs.
    var actionEl = $('lofDetailAction');
    if (actionEl) {
      var reasons = _opActionReasons(op);
      var warn = _opActionWarning(op);
      var lead = (op.localRes && op.localRes.housingLead) || null;
      // F21: deep-link query mirrors what each downstream page accepts.
      // HNA + PMA + Deal Calculator all read `?fips=...&geoType=...` (F12 added).
      var qs = '?fips=' + encodeURIComponent(op.placeGeoid || op.containingCounty) +
               '&geoType=' + encodeURIComponent(op.placeGeoid ? 'place' : 'county') + '&auto=1';
      var hnaHref = 'housing-needs-assessment.html' + qs;
      var pmaHref = 'market-analysis.html' + qs;
      var dcHref  = 'deal-calculator.html' + qs;
      actionEl.innerHTML =
        '<h4>Why this opportunity</h4>' +
        '<ul>' + reasons.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>' +
        (warn ? '<p class="lof-action-warn">⚠ ' + warn + '</p>' : '') +
        '<h4 style="margin-top:10px">Take action</h4>' +
        '<div class="lof-action-ctas">' +
          // F21: HNA CTA added — methodology §7 Step 4 promised this button
          // ("📋 Open HNA") but only PMA + Deal Calc were rendered before.
          '<a href="' + escHtml(hnaHref) + '" target="_blank" rel="noopener" ' +
             'title="Open the Housing Needs Assessment — cost burden, AMI gap, action-plan checklist — for this jurisdiction">' +
            '📋 Open HNA' +
          '</a>' +
          '<a href="' + escHtml(pmaHref) + '" target="_blank" rel="noopener" ' +
             'title="Run a Primary Market Area analysis (5-15 mile buffer) for this jurisdiction">' +
            '🗺️ Open Market Analysis (PMA)' +
          '</a>' +
          '<a href="' + escHtml(dcHref) + '" target="_blank" rel="noopener" class="lof-action-secondary" ' +
             'title="Run the Deal Calculator (pro forma + underwriting) with this jurisdiction pre-selected">' +
            '🧮 Deal Calculator' +
          '</a>' +
          (lead && lead.name ?
            (lead.url ?
              '<a href="' + escHtml(lead.url) + '" target="_blank" rel="noopener" class="lof-action-secondary" ' +
                 'title="Contact the local housing lead at ' + escHtml(lead.name) + '">' +
                '👤 Contact ' + escHtml(lead.name) +
              '</a>'
            : '<span class="lof-action-secondary" style="padding:6px 12px;border:1px solid var(--border);border-radius:6px;font-size:.82rem;color:var(--muted)">👤 Local lead: ' + escHtml(lead.name) + '</span>')
          : '') +
        '</div>';
    }

    var facts = $('lofDetailFacts');
    // Geographic-context badges (resort + public lands adjacency)
    var geoContext = [];
    if (op.resortLabel) {
      geoContext.push('<span class="lof-pill lof-pill--accent" title="Resort/recreational county with active workforce-housing pressure">🏔 Resort county: ' + escHtml(op.resortLabel) + '</span>');
    }
    if (op.publicLandsHeavy) {
      geoContext.push('<span class="lof-pill" title="County is >25% federal land (BLM/USFS/NPS). Constrained developable supply + outdoor amenity premium.">🌲 Public-lands-heavy</span>');
    }

    // F25: PAB (private-activity-bond) local direct-allocation context.
    // Look up the place's own allocation; if it has none (most places), fall
    // back to the containing county's allocation as the likely issuer. This
    // is a CAPACITY signal for the 4% bond path, NOT a deal gate — see caveat.
    var pabHtml = _pabFactHtml(op);

    facts.innerHTML =
      '<dt>Designation</dt><dd>' + designations.join(' + ') +
        (geoContext.length ? '<br><span style="margin-top:4px;display:inline-block">' + geoContext.join(' ') + '</span>' : '') +
      '</dd>' +
      '<dt>9% Competitive score</dt><dd>' + op.score9 + '/100  ' +
        '<span style="color:var(--muted);font-size:.78rem">(rec ' + op.recencyScore +
        ' · need p' + op.needScore + ' · basis ' + op.basisBoostScore +
        ' · pop ' + op.populationScore + ')</span></dd>' +
      '<dt>4% Bond score</dt><dd>' + op.score4 + '/100  ' +
        '<span style="color:var(--muted);font-size:.78rem">(rec ' + op.recencyScore +
        ' · need p' + op.needScore + ' · basis ' + op.basisBoostScore +
        ' · pop ' + op.populationScore + ', re-weighted 25/25/15/35)</span></dd>' +
      '<dt>4% bond cap (PAB)</dt><dd>' + pabHtml + '</dd>' +
      '<dt>Last LIHTC project</dt><dd>' + (op.lastYear != null
        ? op.lastYear + ' (' + op.yearsSince + ' years ago)'
        : '<em>Never funded on record</em>') + '</dd>' +
      '<dt>Existing LIHTC stock</dt><dd>' + op.projectCount + ' project(s) · ' +
        fmtInt(op.totalUnits) + ' total units' +
        (op.lihtcStatePaired > 0 ? ' · <span class="lof-pill">' + op.lihtcStatePaired + ' Prop 123 / state-paired</span>' : '') +
      '</dd>' +
      // F10: market-capture facts.
      '<dt>Market capture (2BR)</dt><dd>' +
        (op.market
          ? '2BR FMR <strong>$' + op.market.fmr2br.toLocaleString() + '</strong> · ' +
            'LIHTC 60% AMI 2BR max <strong>$' + op.market.lihtc60ami2br.toLocaleString() + '</strong>' +
            ' · capture advantage ' +
            (op.market.captureAdvantage > 0
              ? '<span style="color:var(--good);font-weight:700">+$' + op.market.captureAdvantage + '/mo</span>' +
                ' <span class="lof-pill lof-pill--accent">LIHTC undercuts market — easy lease-up</span>'
              : op.market.captureAdvantage === 0
              ? '<span style="font-weight:700">$0/mo</span>' +
                ' <span class="lof-pill">narrow margin — review unit mix carefully</span>'
              : '<span style="color:var(--warn);font-weight:700">−$' + Math.abs(op.market.captureAdvantage) + '/mo</span>' +
                ' <span class="lof-pill lof-pill--urgent">LIHTC above market — needs deeper AMI mix (40-50%) or extra soft debt to pencil</span>'
            ) +
            (op.market.fmrAreaName ? '<br><span style="color:var(--muted);font-size:.76rem">FMR area: ' + escHtml(op.market.fmrAreaName) + ' · source: HUD FY2025 FMR + Income Limits</span>' : '')
          : '<span style="color:var(--muted)">No FMR/IL data on file for this county.</span>'
        ) +
      '</dd>' +
      '<dt>3 nearest LIHTC properties (for PMA scoping)</dt><dd>' +
        (op.nearestLihtc.length === 0
          ? '<span style="color:var(--muted)">No LIHTC properties anywhere in CO have lat/lng data — cannot compute nearest.</span>'
          : '<ul class="lof-nearest-list">' + op.nearestLihtc.map(function (n) {
              var inPma = n.miles <= 5 ? ' <span class="lof-pill lof-pill--accent">in 5mi PMA</span>' : n.miles <= 30 ? ' <span class="lof-pill">in 30mi rural PMA</span>' : '';
              return '<li><strong>' + n.miles.toFixed(1) + ' mi</strong> · ' +
                escHtml(n.project) + ' (' + escHtml(n.city) + ', ' + (n.year || '?') + ', ' + n.units + 'u, ' + escHtml(n.credit) + ')' +
                inPma + '</li>';
            }).join('') + '</ul>') +
      '</dd>' +
      '<dt>Preservation candidates</dt><dd>' +
        (op.preservationCount > 0
          ? '<strong>' + op.preservationCount + '</strong> subsidized rental properties' +
            (op.preservationUrgent5y > 0
              ? ' · <span class="lof-pill lof-pill--urgent">' + op.preservationUrgent5y + ' expire ≤5y</span>'
              : '') +
            (op.preservationSoon10y > op.preservationUrgent5y
              ? ' · <span class="lof-pill">' + (op.preservationSoon10y - op.preservationUrgent5y) + ' expire 5–10y</span>'
              : '') +
            '<br><span style="color:var(--muted);font-size:.78rem">Sources: CHFA Preservation (subsidy not detailed) · HUD MF Assisted (' +
              (op.preservation202_811 + op.preservationFha + op.preservationSec8 + op.preservationOther) +
              ' here — incl. ' + op.preservation202_811 + ' HUD §202/811, ' + op.preservationFha + ' FHA) · USDA RD (' +
              op.preservationUsdaRd + ' here)</span>'
          : '<span style="color:var(--muted)">None on file</span>') +
      '</dd>' +
      '<dt>HNA need composite</dt><dd>' + (op.needCompositePct != null ? op.needCompositePct + '% ' : '') +
        '<span style="color:var(--muted);font-size:.78rem">(CO percentile rank: p' + op.needScore + ')</span>' +
        ' &nbsp;<a href="' + escHtml(hnaUrlForPlace(op.placeGeoid)) + '" target="_blank" rel="noopener" ' +
          'style="font-size:.78rem;font-weight:600">View full HNA →</a>' +
      '</dd>' +
      '<dt>Population (approx)</dt><dd>' + (op.population != null ? fmtInt(op.population) : 'unknown') + '</dd>' +
      (op.qctCount > 0 ?
        '<dt>QCT tracts in jurisdiction</dt><dd style="font-family:ui-monospace,monospace;font-size:.78rem">' +
          op.qctTracts.map(function (t) { return t.tract_geoid; }).join(', ') +
        '</dd>' : '');

    // F58: Labor market & commute panel — block-classified LODES OD
    // (place-od-flows.json) plus place-LEHD aggregate when available.
    var laborEl = $('lofDetailLabor');
    if (laborEl) {
      var laborHtml = _renderLaborPanel(op);
      if (laborHtml) {
        laborEl.innerHTML = laborHtml;
        laborEl.hidden = false;
      } else {
        laborEl.hidden = true;
        laborEl.innerHTML = '';
      }
    }

    // Civic capacity panel — Prop 123, HNA, comp plan, housing lead, HA, advocacy
    var civicEl = $('lofDetailCivic');
    if (civicEl) civicEl.innerHTML = _renderCivicPanel(op);

    // News + research linkouts
    var newsEl = $('lofDetailNews');
    if (newsEl) newsEl.innerHTML = _renderNewsPanel(op);

    // Projects in jurisdiction, sorted by YR_PIS descending
    var projects = op.projects.slice().sort(function (a, b) {
      return (+b.properties.YR_PIS || 0) - (+a.properties.YR_PIS || 0);
    });
    var projHtml = '';
    if (!projects.length) {
      projHtml = '<div class="lof-detail-project" style="color:var(--muted);font-style:italic;">No LIHTC projects on record for this jurisdiction.</div>';
    } else {
      projHtml = projects.map(function (p) {
        var pr = p.properties;
        return '<div class="lof-detail-project">' +
          '<div class="lof-detail-project-name">' + escHtml(pr.PROJECT || '(unnamed)') + '</div>' +
          '<div class="lof-detail-project-meta">' +
            'YR_PIS ' + (pr.YR_PIS || '—') + ' · ' +
            (pr.N_UNITS || 0) + ' units (' + (pr.LI_UNITS || 0) + ' LI) · ' +
            (pr.CREDIT || '—') + ' credit · ' +
            'QCT ' + (pr.QCT === '1' || pr.QCT === 1 ? 'yes' : (pr.QCT || 'no')) +
          '</div>' +
        '</div>';
      }).join('');
    }
    $('lofDetailProjects').innerHTML = projHtml;
    detail.hidden = false;

    // F14: decorate every external <a> inside the detail panel with a
    // "⚠ report stale" inline button so users can flag broken links.
    // Also load + apply "verified YYYY-MM-DD" badges from data/url-health.json
    // when the URL is in the health cache and marked OK.
    if (window.ReportStaleLink) {
      window.ReportStaleLink.decorateAnchors(detail, { context: 'place:' + (op.placeGeoid || '') });
      window.ReportStaleLink.loadHealthCache().then(function () {
        // Inject verified badges into each anchor whose URL the cache has marked OK
        var anchors = detail.querySelectorAll('a[href^="http"]:not([data-no-stale])');
        anchors.forEach(function (a) {
          if (a.dataset.verifiedAttached) return;
          var badge = window.ReportStaleLink.verifiedBadge(a.href);
          if (badge) {
            a.dataset.verifiedAttached = '1';
            var span = document.createElement('span');
            span.innerHTML = ' ' + badge;
            a.parentNode.insertBefore(span, a.nextSibling);
          }
        });
      });
    }

    Array.from(document.querySelectorAll('#lofTableBody tr')).forEach(function (tr) {
      tr.classList.toggle('is-selected', tr.getAttribute('data-op-id') === opId);
    });
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── Sorting ──────────────────────────────────────────────────────── */

  function _sortOps(arr) {
    var k = state.sortKey;
    var dir = state.sortDir === 'asc' ? 1 : -1;
    function val(op) {
      switch (k) {
        case 'score':         return _activeScore(op);
        case 'name':          return (op.name || '').toLowerCase();
        case 'type':          return (op.hasBoth ? 2 : op.hasQct ? 1 : 0);
        case 'county':        return (op.countyName || '').toLowerCase();
        case 'lastYear':      return op.lastYear == null ? -Infinity : op.lastYear;
        case 'projectCount':  return op.projectCount;
        case 'needScore':     return op.needScore == null ? -1 : op.needScore;
        case 'population':    return op.population || 0;
        case 'captureAdvantage': return op.captureAdvantage == null ? -Infinity : op.captureAdvantage;
        case 'civicScore':    return op.civicScore == null ? -1 : op.civicScore;
        case 'prop123':       {
          // 2 = filed w/ direct record, 1 = committed via county, 0 = no, -1 = unknown, -2 = CDP (can't file)
          if (op.type === 'cdp') return -2;
          if (op.prop123Detail) return 2;
          var dims = (op.civic && op.civic.dimensions) || {};
          if (dims.prop123_committed === true)  return 1;
          if (dims.prop123_committed === false) return 0;
          return -1;
        }
        case 'altScores':     return op.score9;  // sortable proxy
        default:              return _activeScore(op);
      }
    }
    return arr.slice().sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return  1 * dir;
      return 0;
    });
  }

  /* ── Refresh ──────────────────────────────────────────────────────── */

  function _refresh() {
    // F13: spotlight at top of refresh chain — it shows the #1 pick
    // before the table even renders, so users orient before scanning.
    var filtered = _sortOps(_applyFilters());
    _renderTopSpotlight(filtered);
    _renderSummary(filtered);
    _renderTable(filtered);
    _renderMap(filtered);
    // F79: re-count the region & county dropdowns against the CURRENT filter
    // set (excluding their own filter). User-reported bug: dropdown said
    // "San Luis Valley (28)" but selecting it produced an empty table
    // because the default basis='either' + requireCapture=true filters
    // wiped out almost every SLV jurisdiction. Showing live counts surfaces
    // that immediately so users know to relax filters rather than assume
    // the filter is broken.
    _updateRegionDropdownCounts();
  }

  // F79: walk every opportunity through every filter EXCEPT the region
  // filter, then count by region. Write the live counts back into the
  // dropdown option labels so "(28)" becomes "(3)" when only 3 SLV
  // jurisdictions actually match the rest of the user's filter set.
  function _updateRegionDropdownCounts() {
    var regionSel = $('lofRegion');
    if (!regionSel) return;
    var f = state.filters;
    var byRegion = {};
    state.opportunities.forEach(function (op) {
      // Replay _applyFilters() EXCEPT the region check.
      switch (f.basis) {
        case 'both':   if (!op.hasBoth) return; break;
        case 'either': if (!op.hasQct && !op.hasDda) return; break;
        case 'qct':    if (!op.hasQct || op.hasDda) return; break;
        case 'dda':    if (!op.hasDda || op.hasQct) return; break;
        case 'none':   break;
        default:       if (!op.hasBoth) return; break;
      }
      if (!f.includeCdps && op.type === 'cdp') return;
      if (f.county && op.containingCounty !== f.county) return;
      if (f.minYearsSince > 0 && (op.yearsSince == null || op.yearsSince < f.minYearsSince)) return;
      if (f.minScore > 0 && _activeScore(op) < f.minScore) return;
      if (f.minPop > 0 && (op.population || 0) < f.minPop) return;
      if (f.minPreservation > 0 && (op.preservationCount || 0) < f.minPreservation) return;
      if (f.onlyUrgentPres && (op.preservationUrgent5y || 0) === 0) return;
      if (f.requireCapture && (op.captureAdvantage == null || op.captureAdvantage <= 0)) return;
      var r = op.region || '(none)';
      byRegion[r] = (byRegion[r] || 0) + 1;
    });
    for (var i = 0; i < regionSel.options.length; i++) {
      var opt = regionSel.options[i];
      if (!opt.value) continue;
      var n = byRegion[opt.value] || 0;
      opt.textContent = opt.value + '  (' + n + ')';
    }
  }

  /* ── Wire UI ──────────────────────────────────────────────────────── */

  function _populateFilterDropdowns() {
    var counties = {};
    var regions = {};
    state.opportunities.forEach(function (op) {
      if (op.containingCounty) counties[op.containingCounty] = op.countyName;
      if (op.region) regions[op.region] = (regions[op.region] || 0) + 1;
    });
    var countySel = $('lofCounty');
    Object.keys(counties).sort(function (a, b) {
      return counties[a].localeCompare(counties[b]);
    }).forEach(function (fips) {
      var opt = document.createElement('option');
      opt.value = fips;
      opt.textContent = counties[fips];
      countySel.appendChild(opt);
    });

    // Region dropdown — display in CO geographic order (W → E)
    var regionSel = $('lofRegion');
    if (regionSel) {
      var preferredOrder = [
        'Western Slope', 'Southwest', 'San Luis Valley',
        'Mountains', 'Front Range', 'Eastern Plains'
      ];
      preferredOrder.forEach(function (r) {
        if (!regions[r]) return;
        var opt = document.createElement('option');
        opt.value = r;
        opt.textContent = r + '  (' + regions[r] + ')';
        regionSel.appendChild(opt);
      });
    }
  }

  function _wireFilters() {
    // Target deal type — <select> dropdown. When user picks 'preservation'
    // we auto-relax the basis filter (to 'any' — preservation deals don't
    // need basis-boost) and auto-apply the minPreservation>=1 filter so
    // they immediately see the relevant jurisdiction subset.
    var targetSelect = $('lofTargetSelect');
    if (targetSelect) {
      targetSelect.addEventListener('change', function () {
        state.filters.target = targetSelect.value;
        // Smart filter application per deal type
        if (targetSelect.value === 'preservation') {
          state.filters.basis = 'none';
          state.filters.minPreservation = Math.max(1, state.filters.minPreservation);
          // Sync UI
          var basisNone = document.querySelector('input[name="lofBasis"][value="none"]');
          if (basisNone) basisNone.checked = true;
          var minPresEl = $('lofMinPreservation');
          var minPresValEl = $('lofMinPreservationVal');
          if (minPresEl) { minPresEl.value = Math.max(1, +minPresEl.value); }
          if (minPresValEl) minPresValEl.textContent = minPresEl ? minPresEl.value : '1';
        } else if (targetSelect.value === 'prop123_local') {
          // Prop 123 deals don't need basis-boost either
          state.filters.basis = 'none';
          var bn2 = document.querySelector('input[name="lofBasis"][value="none"]');
          if (bn2) bn2.checked = true;
        }
        _refresh();
      });
    } else {
      var targetRadios = document.querySelectorAll('input[name="lofTarget"]');
      targetRadios.forEach(function (r) {
        r.addEventListener('change', function () {
          if (r.checked) { state.filters.target = r.value; _refresh(); }
        });
      });
    }

    // Basis-boost: mutually-exclusive radio group (lofBasis).
    var basisRadios = document.querySelectorAll('input[name="lofBasis"]');
    basisRadios.forEach(function (r) {
      r.addEventListener('change', function () {
        if (r.checked) {
          state.filters.basis = r.value;
          _refresh();
        }
      });
    });

    var includeCdps = $('lofIncludeCdps');
    if (includeCdps) {
      includeCdps.addEventListener('change', function () {
        state.filters.includeCdps = includeCdps.checked;
        _refresh();
      });
    }

    var requireCapture = $('lofRequireCapture');
    if (requireCapture) {
      requireCapture.addEventListener('change', function () {
        state.filters.requireCapture = requireCapture.checked;
        _refresh();
      });
    }

    $('lofCounty').addEventListener('change', function (e) {
      state.filters.county = e.target.value; _refresh();
    });

    var regionEl = $('lofRegion');
    if (regionEl) {
      regionEl.addEventListener('change', function (e) {
        state.filters.region = e.target.value;
        // P1 — Auto-relax requireCapture when a rural region is selected.
        // Rural CO FMRs sit at or below LIHTC 60% AMI rent ceilings, so the
        // default capture-advantage filter wipes every rural jurisdiction
        // out. When user picks a rural region we presume they want to see
        // the 9-ish jurisdictions that DO pass basis-boost + incorporation,
        // not stare at an empty table. The toggle in the filter panel
        // reflects the change so they can re-enable it if they want.
        var RURAL_REGIONS = ['San Luis Valley', 'Eastern Plains', 'Mountains', 'Western Slope'];
        var capChk = $('lofRequireCapture');
        if (RURAL_REGIONS.indexOf(state.filters.region) >= 0) {
          if (state.filters.requireCapture) {
            state.filters.requireCapture = false;
            if (capChk) capChk.checked = false;
            state._autoRelaxedCapture = state.filters.region;
          }
        } else if (state._autoRelaxedCapture && !state.filters.region) {
          // User cleared the region back to "All regions" — restore the
          // default so non-rural filters work as advertised again.
          state.filters.requireCapture = true;
          if (capChk) capChk.checked = true;
          state._autoRelaxedCapture = null;
        }
        _refresh();
      });
    }

    var minYears = $('lofMinYearsSince'), minYearsVal = $('lofMinYearsSinceVal');
    minYears.addEventListener('input', function () {
      state.filters.minYearsSince = +minYears.value;
      minYearsVal.textContent = minYears.value;
      _refresh();
    });

    var minScore = $('lofMinScore'), minScoreVal = $('lofMinScoreVal');
    minScore.addEventListener('input', function () {
      state.filters.minScore = +minScore.value;
      minScoreVal.textContent = minScore.value;
      _refresh();
    });

    var minPop = $('lofMinPop');
    minPop.addEventListener('change', function () {
      state.filters.minPop = +minPop.value || 0; _refresh();
    });

    var minPres = $('lofMinPreservation'), minPresVal = $('lofMinPreservationVal');
    if (minPres) {
      minPres.addEventListener('input', function () {
        state.filters.minPreservation = +minPres.value;
        if (minPresVal) minPresVal.textContent = minPres.value;
        _refresh();
      });
    }
    var presUrgent = $('lofPresUrgent');
    if (presUrgent) {
      presUrgent.addEventListener('change', function () {
        state.filters.onlyUrgentPres = presUrgent.checked;
        _refresh();
      });
    }

    // F11: Mobile "More filters" toggle. Only visible on viewports ≤700px
     // via CSS; on desktop the button stays display:none and the toggle is
     // a no-op (.is-expanded class is harmless when no .lof-filter cells
     // are display:none in the first place).
    var mobileToggle = $('lofMobileToggle');
    if (mobileToggle) {
      var filterGrid = $('lofFilterGrid');
      mobileToggle.addEventListener('click', function () {
        var expanded = filterGrid.classList.toggle('is-expanded');
        mobileToggle.textContent = expanded ? 'Hide extra filters ▴' : 'Show more filters ▾';
        mobileToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      });
    }

    $('lofResetFilters').addEventListener('click', function () {
      state.filters = {
        target: '9pct',
        basis: 'either',        // F13: widened (was 'both' — too narrow with capture filter ON)
        county: '', region: '', minYearsSince: 0, minScore: 0, minPop: 0,
        minPreservation: 0, onlyUrgentPres: false,
        includeCdps: false,
        requireCapture: true    // F13: ON by default (was false)
      };
      if (minPres) { minPres.value = 0; if (minPresVal) minPresVal.textContent = '0'; }
      if (presUrgent) presUrgent.checked = false;
      var ts = $('lofTargetSelect');
      if (ts) { ts.value = '9pct'; }
      else {
        var r = document.querySelector('input[name="lofTarget"][value="9pct"]');
        if (r) r.checked = true;
      }
      // F20 (P0-5): reset DOM to match state.filters defaults exactly.
      //   - basis defaults to 'either' (F13 widening), not 'both'
      //   - requireCapture defaults to TRUE (F13 trust fix), not false
      // Previously these were desynced — reset would jump filters to a
      // state different from the documented page defaults, surprising users.
      var eitherRadio = document.querySelector('input[name="lofBasis"][value="either"]');
      if (eitherRadio) eitherRadio.checked = true;
      if (includeCdps) includeCdps.checked = false;
      if (requireCapture) requireCapture.checked = true;
      $('lofCounty').value = '';
      if (regionEl) regionEl.value = '';
      minYears.value = 0; minYearsVal.textContent = '0';
      minScore.value = 0; minScoreVal.textContent = '0';
      minPop.value = 0;
      _refresh();
    });

    Array.from(document.querySelectorAll('#lofTable thead th[data-sort]')).forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key; state.sortDir = 'desc';
        }
        Array.from(document.querySelectorAll('#lofTable thead th[data-sort]')).forEach(function (h) {
          h.removeAttribute('aria-sort');
        });
        th.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
        _refresh();
      });
    });
  }

  function _initMap() {
    if (!window.L || !$('lofMap')) return;
    // Constrain map panning to ~Colorado + 50 mile buffer. CO's geographic
    // box is roughly [37°N, -109°W] (SW corner: Four Corners) to [41°N, -102°W]
    // (NE corner: Sedgwick County). 50 miles ≈ 0.72° latitude.
    var coBounds = window.L.latLngBounds(
      [36.28, -109.72],   // southwest: ~50mi SW of Four Corners
      [41.72, -101.28]    // northeast: ~50mi NE of Sedgwick County
    );

    // preferCanvas: false — SVG renderer keeps markers inspectable in DevTools
    // and avoids the canvas-rendering tiny-corner bug we hit earlier.
    state.map = window.L.map('lofMap', {
      preferCanvas: false,
      maxBounds: coBounds,
      maxBoundsViscosity: 1.0,   // bounce back hard at the edges
      minZoom: 6,                 // can't zoom out past full CO view
      maxZoom: 14
    }).setView([39.0, -105.5], 7);
    // Expose for debugging / inspection (tests + DevTools)
    window.__lofMap = state.map;
    window.__lofState = state;

    // ── Base tile options ─────────────────────────────────────────────
    // Matches the set used by colorado-deep-dive.html + market-analysis.html
    // (CARTO Light, CARTO Dark, OSM Standard, Esri World Imagery).
    state._baseLayers = {
      'Light (CARTO)':    window.L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        { attribution: '© OpenStreetMap contributors © CARTO', subdomains: 'abcd', maxZoom: 19 }
      ),
      'Street (OSM)':     window.L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { attribution: '© OpenStreetMap contributors', maxZoom: 19 }
      ),
      'Dark (CARTO)':     window.L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        { attribution: '© OpenStreetMap contributors © CARTO', subdomains: 'abcd', maxZoom: 19 }
      ),
      'Satellite (Esri)': window.L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles © Esri', maxZoom: 19 }
      )
    };
    state._baseLayers['Light (CARTO)'].addTo(state.map);
    // Layer control gets attached in _initMapOverlays() once data is loaded.
  }

  // Polygon-rings helper: GeoJSON [lng,lat] → Leaflet [lat,lng] for both
  // Polygon and MultiPolygon. Returns null if geometry type is unsupported.
  function _geomToLeafletRings(geometry) {
    if (!geometry) return null;
    var coords = geometry.coordinates;
    if (geometry.type === 'Polygon') {
      return coords.map(function (ring) {
        return ring.map(function (c) { return [c[1], c[0]]; });
      });
    }
    if (geometry.type === 'MultiPolygon') {
      return coords.map(function (poly) {
        return poly.map(function (ring) {
          return ring.map(function (c) { return [c[1], c[0]]; });
        });
      });
    }
    return null;
  }

  // Categorize a LIHTC project by its TypeOfCredits/CREDIT field so we can
  // color-code markers on the map. CHFA's TypeOfCredits is preferred (it's
  // the live-feed source of truth) but we fall back to the HUD CREDIT enum
  // for older/imported records.
  function _lihtcCreditCategory(p) {
    var t = ((p && p.TypeOfCredits) || '').trim();
    if (t) {
      if (t.indexOf('9%') === 0 || t.indexOf('9% ') === 0) return '9pct';
      if (t.indexOf('4%') === 0 || t.indexOf('4% ') === 0) return '4pct';
      if (t === 'MIHTC') return 'mihtc';
      if (t.indexOf('State') !== -1) return 'state';
    }
    // HUD CREDIT: "B" = both/4%, "S" = state, "BS" = both+state
    var c = ((p && p.CREDIT) || '').trim().toUpperCase();
    if (c === 'B' || c === 'BS') return '4pct';
    if (c === 'S') return 'state';
    return 'other';
  }

  // Called AFTER loadAll() resolves — adds the county-boundary outline,
  // builds the QCT/DDA/LIHTC overlays from in-memory data (no extra fetch
  // for DDA + LIHTC, one fetch for QCT geometry), and wires the layer
  // control so the user can toggle layers + change basemap.
  //
  // All three thematic overlays (QCT, DDA, LIHTC properties) are ON by
  // default — users opening the map want to see the basis-boost geography
  // and existing project footprint at-a-glance.
  function _initMapOverlays() {
    if (!state.map || !window.L) return;

    var overlays = {};

    // ── County boundaries (faint always-on outline) ─────────────────────
    // Adds orientation context — matches what colorado-deep-dive.html and
    // market-analysis.html ship.
    if (state.countyBoundaries && Array.isArray(state.countyBoundaries.features)) {
      var countyOverlay = window.L.geoJSON(state.countyBoundaries, {
        style: {
          color: '#64748b', weight: 0.8, opacity: 0.55,
          fillOpacity: 0, interactive: false
        }
      }).addTo(state.map);
      state.layers.counties = countyOverlay;
      overlays['County boundaries'] = countyOverlay;
    }

    // ── DDA counties (blue fill, ON by default) ─────────────────────────
    // All 10 Colorado DDA counties get a translucent blue overlay so users
    // see basis-boost geography at-a-glance. Previously this was drawn only
    // for jurisdictions in the active filter — that meant non-DDA filter
    // results hid the DDA map entirely, which contradicted the page's
    // purpose. Globalized in F5.
    var ddaLayer = window.L.layerGroup();
    state.ddaFeatures.forEach(function (f) {
      var rings = _geomToLeafletRings(f.geometry);
      if (!rings) return;
      var name = (f.properties && (f.properties.NAME || f.properties.GEOID)) || 'DDA county';
      // F12: bumped visibility to match QCT clarity. Was weight:1.2/
      // fillOpacity:0.10/opacity:0.60 — too faint at state-level zoom.
      var poly = window.L.polygon(rings, {
        color: '#2563eb', weight: 1.6, fillColor: '#60a5fa',
        fillOpacity: 0.22, opacity: 0.85, interactive: true
      });
      poly.bindTooltip('DDA: ' + escHtml(name) + ' County · 30% basis boost (IRC §42(d)(5)(B))', { sticky: true });
      ddaLayer.addLayer(poly);
    });
    ddaLayer.addTo(state.map);
    state.layers.dda = ddaLayer;
    overlays['DDA counties (blue, basis-boost)'] = ddaLayer;

    // ── QCT tracts (orange fill, ON by default) ─────────────────────────
    // Re-fetch once for the geometry — state.qctTractIds only stores the
    // ID set, not the polygons. Populates async; the layer is added to
    // the map immediately so the control toggles work even before geometry
    // resolves.
    var qctLayer = window.L.layerGroup();
    qctLayer.addTo(state.map);  // ON by default
    state.layers.qct = qctLayer;
    overlays['QCT tracts (orange, basis-boost)'] = qctLayer;
    (window.DataService && window.DataService.getJSON
      ? window.DataService.getJSON('data/qct-colorado.json')
      : fetch('data/qct-colorado.json').then(function (r) { return r.json(); })
    ).then(function (qctFc) {
      (qctFc.features || []).forEach(function (f) {
        var rings = _geomToLeafletRings(f.geometry);
        if (!rings) return;
        var geoid = f.properties && f.properties.GEOID;
        // F12: bumped visibility — was weight:0.6/fillOpacity:0.12/opacity:0.55
        // and users reported QCTs looked like "strange dots" (faint outlines
        // at state-level zoom). Now solid orange shading clearly visible.
        var poly = window.L.polygon(rings, {
          color: '#ea580c', weight: 1.2, fillColor: '#fb923c',
          fillOpacity: 0.30, opacity: 0.85, interactive: true
        });
        if (geoid) poly.bindTooltip('QCT: tract ' + escHtml(geoid) + ' · 30% basis boost (IRC §42(d)(5)(B))', { sticky: true });
        qctLayer.addLayer(poly);
      });
    }).catch(function (err) {
      console.warn('[OF] QCT overlay fetch failed:', err);
    });

    // ── LIHTC properties (CHFA, ON by default) ──────────────────────────
    // Renders all 926 CHFA-tracked LIHTC properties (1987–2025) as small
    // color-coded circle markers:
    //   green   = 9% Competitive (incl. state-paired 9%)
    //   blue    = 4% Bond / Tax-Exempt (incl. state-paired 4%)
    //   purple  = State-only / TOC / MIHTC
    // Tooltip shows project name, year placed in service, units, credit type.
    var lihtcLayer = window.L.layerGroup();
    var colorByCat = {
      '9pct':  '#16a34a',   // green
      '4pct':  '#2563eb',   // blue
      'state': '#9333ea',   // purple
      'mihtc': '#9333ea',
      'other': '#64748b'    // slate-gray
    };
    state.projects.forEach(function (p) {
      if (!p.geometry || !Array.isArray(p.geometry.coordinates)) return;
      var lng = p.geometry.coordinates[0];
      var lat = p.geometry.coordinates[1];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      var props = p.properties || {};
      var cat = _lihtcCreditCategory(props);
      var color = colorByCat[cat] || colorByCat.other;
      var marker = window.L.circleMarker([lat, lng], {
        radius: 5,
        color: '#fff',
        weight: 1.2,
        fillColor: color,
        fillOpacity: 0.92
      });
      var name = props.PROJECT || props.ReportedName || 'LIHTC project';
      var year = props.YR_PIS || props.AwardYear || '?';
      var units = props.N_UNITS || props.TotalUnits || '?';
      var li    = props.LI_UNITS;
      var credit = props.TypeOfCredits || props.CREDIT || 'LIHTC';
      var city   = props.PROJ_CTY || props.CityDW || '';
      marker.bindTooltip(
        '<strong>' + escHtml(name) + '</strong><br>' +
        escHtml(city) + (city ? ' · ' : '') + escHtml(String(credit)) + '<br>' +
        'Placed in service: ' + escHtml(String(year)) +
        ' · ' + escHtml(String(units)) + ' units' +
        (li != null ? ' (' + escHtml(String(li)) + ' LI)' : ''),
        { sticky: true }
      );
      lihtcLayer.addLayer(marker);
    });
    lihtcLayer.addTo(state.map);
    state.layers.lihtcProjects = lihtcLayer;
    overlays['LIHTC properties (' + state.projects.length + ', CHFA 2025)'] = lihtcLayer;

    // ── Layer control ───────────────────────────────────────────────────
    // F18: expanded on desktop so the QCT / DDA / LIHTC / county toggles are
    // discoverable. F27: but expanded it's ~180×398px, which buries a 337×406
    // mobile map — so on narrow viewports start COLLAPSED (the standard
    // Leaflet layers icon that taps open). Desktop keeps the always-expanded
    // discoverability.
    var _isNarrow = window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
    var layerControl = window.L.control.layers(
      state._baseLayers,
      overlays,
      { position: 'topright', collapsed: _isNarrow }
    ).addTo(state.map);

    // Inject a small header above the layer-control inputs explaining
    // what they do. Leaflet doesn't expose a built-in header slot, so
    // we patch the DOM after .addTo().
    var lcContainer = layerControl.getContainer();
    if (lcContainer) {
      var hdr = document.createElement('div');
      hdr.className = 'lof-layer-control-header';
      hdr.innerHTML = '<strong>Map layers</strong>' +
        '<span class="lof-layer-control-sub">toggle to show / hide</span>';
      lcContainer.insertBefore(hdr, lcContainer.firstChild);
    }

    // Permanent legend bottom-right explaining marker + polygon colors.
    var legend = window.L.control({ position: 'bottomright' });
    legend.onAdd = function () {
      var div = window.L.DomUtil.create('div', 'lof-map-legend');
      // F27: the full legend is ~260×341px — fine on desktop, but it covers
      // ~65% of a 337px mobile map. Make the title a toggle and start
      // collapsed on narrow viewports so the map is usable; users tap to
      // reveal. Desktop starts expanded (unchanged behavior).
      if (window.matchMedia && window.matchMedia('(max-width: 600px)').matches) {
        div.className += ' is-collapsed';
      }
      // F17: legend grouped by what each marker FOR (basis-boost zones,
      // existing LIHTC stock, ranked opportunities). Each item now has a
      // brief explanation of WHY the color matters, not just what it is.
      div.innerHTML =
        '<div class="lof-legend-title" role="button" tabindex="0" aria-label="Toggle map legend">Map legend <span class="lof-legend-caret" aria-hidden="true">▾</span></div>' +

        '<div class="lof-legend-group-label">Federal basis-boost zones</div>' +
        '<div class="lof-legend-row">' +
          '<span class="lof-legend-sw" style="background:#fb923c;opacity:.75"></span>' +
          '<span><strong>QCT tract</strong> <span class="lof-legend-sub">— low-income census tract, +30% basis</span></span>' +
        '</div>' +
        '<div class="lof-legend-row">' +
          '<span class="lof-legend-sw" style="background:#60a5fa;opacity:.75"></span>' +
          '<span><strong>DDA county</strong> <span class="lof-legend-sub">— high-cost rural county, +30% basis</span></span>' +
        '</div>' +

        '<div class="lof-legend-group-label">Existing LIHTC properties</div>' +
        '<div class="lof-legend-row">' +
          '<span class="lof-legend-dot" style="background:#16a34a"></span>' +
          '<span><strong>9% Competitive</strong> <span class="lof-legend-sub">— competitive round, smaller deals</span></span>' +
        '</div>' +
        '<div class="lof-legend-row">' +
          '<span class="lof-legend-dot" style="background:#2563eb"></span>' +
          '<span><strong>4% Bond</strong> <span class="lof-legend-sub">— tax-exempt bond, larger projects</span></span>' +
        '</div>' +
        '<div class="lof-legend-row">' +
          '<span class="lof-legend-dot" style="background:#9333ea"></span>' +
          '<span><strong>State / MIHTC</strong> <span class="lof-legend-sub">— CO state-paired credits</span></span>' +
        '</div>' +

        '<div class="lof-legend-group-label">Ranked jurisdictions (by score)</div>' +
        '<div class="lof-legend-row">' +
          '<span class="lof-legend-jur" style="background:#16a34a"></span>' +
          '<span><strong>Strong (≥70)</strong> <span class="lof-legend-sub">— top pursuit candidates</span></span>' +
        '</div>' +
        '<div class="lof-legend-row">' +
          '<span class="lof-legend-jur" style="background:#f59e0b"></span>' +
          '<span><strong>Mid (50–69)</strong> <span class="lof-legend-sub">— viable, needs deeper diligence</span></span>' +
        '</div>' +
        '<div class="lof-legend-row">' +
          '<span class="lof-legend-jur" style="background:#94a3b8"></span>' +
          '<span><strong>Weak (&lt;50)</strong> <span class="lof-legend-sub">— low priority for this deal type</span></span>' +
        '</div>' +
        '<div class="lof-legend-row lof-legend-foot">Marker size also scales with score.</div>';
      // F27: title toggles collapse (esp. for mobile, where the full legend
      // would otherwise bury the map). Works on desktop too.
      var legTitle = div.querySelector('.lof-legend-title');
      if (legTitle) {
        var _toggle = function () { div.classList.toggle('is-collapsed'); };
        legTitle.addEventListener('click', _toggle);
        legTitle.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _toggle(); }
        });
      }
      // Stop map drag/zoom propagation so users can click inside legend
      window.L.DomEvent.disableClickPropagation(div);
      window.L.DomEvent.disableScrollPropagation(div);
      return div;
    };
    legend.addTo(state.map);
    state.layers.legend = legend;
  }

  /* ── Boot ─────────────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', function () {
    _initMap();
    loadAll()
      .then(function () {
        _computeOpportunities();
        _populateFilterDropdowns();
        _wireFilters();
        _initMapOverlays();
        setStatus('Ranked ' + state.opportunities.length +
          ' Colorado jurisdictions with QCT and/or DDA designations · click a row for project history.');
        _refresh();
      })
      .catch(function (err) {
        console.error('[LIHTC Opportunity Finder] load failed:', err);
        setStatus('Failed to load data: ' + (err && err.message || err));
      });
  });
}());
