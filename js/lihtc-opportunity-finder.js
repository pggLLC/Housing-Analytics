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
    customScenario: null,           // F236 — { target, weights, recencySource } when user has overridden the active preset; null = use preset defaults
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
    // F92: Curated housing-policy progress (~33 jurisdictions). Each value:
    //   { name, hna, land_banking, dedicated_income, tap_fee_reduction, confidence }
    housingProgress: {},            // 7-digit place GEOID → progress record
    housingProgressMeta: null,
    // F96: Apartment List monthly rent index. Keyed by normalized city
    // name (lowercase). Values: { rent_overall, rent_1br, rent_2br,
    // yoy_change_pct, national_rank, source_url, ... }
    apartmentListByCity: {},
    apartmentListMeta: null,
    // F97 — ACS B25064 median gross rent. THE always-available baseline
    // (every CO county + every CO place has a value). Lagged ~2 yrs but
    // unmissable.
    acsRentByCounty: {},            // 5-digit FIPS → { median_gross_rent, ... }
    acsRentByPlace: {},             // 7-digit GEOID → { median_gross_rent, ... }
    acsRentMeta: null,
    policyScores: {},               // geoid (5- or 7-digit) → { totalScore, dimensions } from policy scorecard
    localResources: {},             // "county:FIPS" / "place:FIPS" / "cdp:FIPS" → { prop123, housingAuthority, housingLead, housingPlans, advocacy }
    prop123ByName: {},              // upper-cased jurisdiction name → prop123 record (filing date, fast-track)
    // F116 — CHFA 2026 Round One bridge data (14 developments announced
    // 2026-05-21, not yet in the live ArcGIS feed). Indexed by normalized
    // city name (lowercase, no suffix). Each entry tagged with
    // { _source:'chfa-2026-r1-bridge', _bridge:true } so a single filter
    // line can drop them when the live feed catches up.
    chfa2026R1ByCity: {},           // normalized city name → [award records]
    chfa2026R1Meta: null,           // bridge-file metadata (round, announcement date, totals)
    opportunities: [],
    map: null,
    layers: { jurisdiction: null, dda: null, qct: null, oz: null, highlight: null },
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
      requireCapture: true,
      // F240 — Downtown redevelopment filter. ON narrows to jurisdictions
      // with an active URA match OR an Opportunity Zone tract in the county.
      // OFF by default — surfaces the URA + OZ context as opt-in.
      requireRedev: false,
      // F251 — Direct jurisdiction name search. Empty string = no filter;
      // 2+ chars = case-insensitive substring match against op.name.
      searchText: ''
    }
  };

  /* ── F255: Filter persistence ─────────────────────────────────────
     User-tuned filters were getting wiped on every page refresh, which
     caused the "Bayfield was at the top then moved" confusion — the
     refresh restored requireCapture=ON which silently filtered out
     every place in the 47 CO counties missing from our HUD FMR cache.
     Now state.filters is mirrored to localStorage on every change and
     restored on init. Survives refresh + back/forward.

     Storage key carries a v1 suffix so the schema can evolve without
     poisoning old browser state. Restore is best-effort: any parse
     error falls back to defaults silently.
  ─────────────────────────────────────────────────────────────────── */
  var FILTER_STORAGE_KEY = 'coho:of-filters:v1';
  // F236 — Scenario Builder localStorage key. One blob keyed by target
  // preset so the user gets their last-used custom mix per deal type.
  var SCENARIO_STORAGE_KEY = 'coho:of-scenarios:v1';

  function _loadScenarios() {
    try {
      if (typeof localStorage === 'undefined') return {};
      var raw = localStorage.getItem(SCENARIO_STORAGE_KEY);
      if (!raw) return {};
      var s = JSON.parse(raw);
      return s && typeof s === 'object' ? s : {};
    } catch (_) { return {}; }
  }
  function _saveScenarios(map) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(map));
    } catch (_) { /* silent */ }
  }

  function _persistFilters() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(state.filters));
    } catch (e) { /* quota / private mode — silent */ }
  }

  function _restoreFilters() {
    try {
      if (typeof localStorage === 'undefined') return;
      var raw = localStorage.getItem(FILTER_STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      // Merge into state.filters preserving any keys the saved snapshot
      // doesn't know about (forward-compat as new filter dimensions ship).
      Object.keys(saved).forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(state.filters, k)) {
          state.filters[k] = saved[k];
        }
      });
    } catch (e) { /* malformed — silent fallback to defaults */ }
  }

  function _clearPersistedFilters() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(FILTER_STORAGE_KEY);
    } catch (e) { /* silent */ }
  }

  var CURRENT_YEAR = new Date().getFullYear();
  /* F146 — Recency window dropped from 25 → 4 years per user direction:
     "anything over 4 years is not recent". A 25-year linear scale gave
     near-identical recency scores to a place last funded in 2010 and one
     last funded in 2018 (~70% vs ~30%) — both decades-old in practice.
     The new 4-year cap saturates at 100 (= "not recently funded → high
     opportunity") for anything older than the 4-year LIHTC cycle the user
     thinks of as "recent". Years 0–4 still scale linearly so a
     just-funded jurisdiction stays at 0 and one funded 2 years ago lands
     at 50. */
  var MAX_RECENCY_YEARS = 4;

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

  /**
   * F146 — Recency score: 0 = funded right now (no opportunity), 100 = not
   * funded in 4+ years OR never funded (maximum opportunity).
   *
   * Linear ramp years 0–4, then saturates at 100. The 4-year cap reflects
   * the typical LIHTC cycle: a project funded in 2023 is still "recent"
   * through ~2027; older than that, the jurisdiction has had a full cycle
   * to re-enter the pipeline so it's "not recent" regardless of exact age.
   *
   * `lastYear` should be the MAX of all known award/PIS years, including
   * recent CHFA award rounds (e.g. 2026 R1 from the bridge file) that
   * haven't propagated to the HUD LIHTC database yet. See
   * `mostRecentAwardYearFor` for the resolver.
   *
   * @param {number|null} lastYear  Calendar year of most-recent LIHTC activity
   * @returns {number}              0–100
   */
  function recencyScore(lastYear) {
    if (lastYear == null) return 100;
    var years = Math.max(0, CURRENT_YEAR - lastYear);
    return Math.min(100, Math.round((years / MAX_RECENCY_YEARS) * 100));
  }

  /**
   * F146 — Pull the award year out of a CHFA bridge metadata block.
   * Bridge files (currently `data/affordable-housing/chfa-awards/
   * 2026-round-one.json`) carry the round label in
   * `metadata.round` (e.g. "2026 Round One"); parse out the leading
   * 4-digit year. Falls back to parsing `metadata.announcement_date`
   * if the round string is missing. Returns null when neither is
   * present (caller should treat as "no signal").
   */
  function bridgeAwardYear(meta) {
    if (!meta) return null;
    if (typeof meta.round === 'string') {
      var m = meta.round.match(/(\d{4})/);
      if (m) return parseInt(m[1], 10);
    }
    if (typeof meta.announcement_date === 'string') {
      var m2 = meta.announcement_date.match(/^(\d{4})/);
      if (m2) return parseInt(m2[1], 10);
    }
    return null;
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
  /**
   * F223 — Need composite. Previously took only countyFips → every place in
   * a county got identical "need" scores (Garfield County's score applied
   * uniformly to New Castle, Silt, Glenwood Springs, Carbondale). Now
   * accepts a placeGeoid (optional); when present, looks up place-level
   * CHAS (renter+owner cb30/cb50 shares, population-apportioned from
   * tract-level data). Falls back to county when place data missing or
   * low_confidence.
   *
   * Returns { composite, source } where source ∈ 'place' | 'county' | null.
   */
  function needCompositeFor(countyFips, placeGeoid) {
    // Prefer place-level CHAS when available + not low_confidence
    if (placeGeoid) {
      var placeRec = state.placeChas && state.placeChas[placeGeoid];
      if (placeRec && placeRec.summary && !placeRec.low_confidence) {
        var ps = placeRec.summary;
        var pRenter = +ps.total_renter_hh || 0;
        var pOwner  = +ps.total_owner_hh  || 0;
        var pTot = pRenter + pOwner;
        if (pTot > 0) {
          // place-chas exposes shares (0-1), not %. Convert to % to match
          // the county schema (pct_renter_cb30 is a % in chas_affordability_gap).
          var pRcb30 = (+ps.renter_cb30_share || 0) * 100;
          var pOcb30 = (+ps.owner_cb30_share  || 0) * 100;
          var pRcb50 = (+ps.renter_cb50_share || 0) * 100;
          var pBlended = (pRcb30 * pRenter + pOcb30 * pOwner) / pTot;
          var pComp = pBlended * 0.7 + pRcb50 * 0.3;
          return { composite: pComp, source: 'place' };
        }
      }
    }
    // Fall back to county CHAS
    var rec = state.chasByFips[countyFips];
    if (!rec || !rec.summary) return { composite: null, source: null };
    var s = rec.summary;
    var renterHH = +s.total_renter_hh || 0;
    var ownerHH  = +s.total_owner_hh  || 0;
    var total = renterHH + ownerHH;
    if (!total) return { composite: null, source: null };
    var blended = (s.pct_renter_cb30 * renterHH + s.pct_owner_cb30 * ownerHH) / total;
    var severe = +s.pct_renter_cb50 || 0;
    return { composite: blended * 0.7 + severe * 0.3, source: 'county' };
  }
  function needScoreFor(countyFips, needDist, placeGeoid) {
    var res = needCompositeFor(countyFips, placeGeoid);
    var composite = res && res.composite;
    if (composite == null) return { score: 30, source: null };
    var below = 0;
    for (var i = 0; i < needDist.length; i++) {
      if (needDist[i] < composite) below++;
      else if (needDist[i] === composite) below += 0.5;
    }
    return { score: Math.round((below / needDist.length) * 100), source: res.source };
  }

  function basisBoostScore(isQct, isDda) {
    if (isQct && isDda) return 100;
    if (isQct || isDda) return 60;
    return 0;
  }

  // F241 — Smooth logarithmic curve. Replaces the step function whose
  // 5,000-resident cliff was paying out 25 points for being on one side
  // of the line vs the other (New Castle at 4,880 vs Carbondale at
  // 5,000+). The 5,000 cut was empirically grounded in CHFA award
  // history but NOT a CHFA QAP threshold — keeping it as a discrete
  // step over-penalized borderline towns.
  //
  // Curve: score = round(100 · log(pop/100) / log(150))
  //   pop=100  →   0   (dead zone)
  //   pop=500  →  32   (~old 30)
  //   pop=1000 →  46
  //   pop=2000 →  60   (matches old)
  //   pop=5000 →  78   (was 85; gentler)
  //   pop=10000→  92
  //   pop=15000→ 100   (matches old)
  //   pop>15k  → 100   (capped)
  //
  // Net effect: bigger towns still win, but the gap between borderline
  // pairs (e.g., New Castle 4,880 vs Rifle 10,570) shrinks from 25
  // points to ~15. Combined with F239/F240 regional recency, lets
  // small-town signals (Need, Civic, regional saturation) actually
  // surface against the pop-weight advantage.
  function populationScore(pop) {
    if (pop == null || !Number.isFinite(+pop)) return 0;
    var n = +pop;
    if (n < 100) return 0;
    var raw = Math.log(n / 100) / Math.log(150);
    return Math.max(0, Math.min(100, Math.round(raw * 100)));
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
      loadSoft('data/market/zori_rents_co.json'),
      // F92: Curated housing-policy progress (top ~33 CO jurisdictions).
      // Four per-jurisdiction signals: HNA / land bank / dedicated income
      // stream / tap-fee reductions. Soft-load — table just hides the
      // Progress column markers when missing.
      loadSoft('data/policy/jurisdiction-housing-progress.json'),
      // F96: Apartment List monthly rent index (21 CO cities). Provides
      // explicit 1BR/2BR median rents that complement ZORI's smoothed
      // all-BR index. Used to triangulate the Capture column tooltip.
      loadSoft('data/market/apartment_list_co.json'),
      // F97 — ACS B25064 median gross rent. THE always-available baseline:
      // every CO county + every CO place (468/482) gets a value. ZORI/AL/
      // DOLA triangulate where they have data; ACS guarantees there is
      // always a rent signal even for the tiniest rural CDP.
      loadSoft('data/market/acs_median_rent_co.json'),
      // F116 — CHFA 2026 Round One award bridge (14 developments,
      // announced 2026-05-21). The live HousingTaxCreditProperties_view
      // ArcGIS feed lags 2-3 months behind round announcements; without
      // this bridge file the OF would show every R1 jurisdiction as
      // "Never funded" / "≥35 years since last LIHTC". Tagged on read
      // with _source:'chfa-2026-r1-bridge' + _bridge:true so a single
      // line drops them when the feed catches up.
      loadSoft('data/affordable-housing/chfa-awards/2026-round-one.json'),
      // F223 — Place-level CHAS (renter_cb30/cb50 + owner_cb30/cb50 shares,
      // population-apportioned from tract-level). Lets the need-composite
      // stop using the containing county's CHAS for every place in it.
      // Soft load — graceful fallback to county when missing.
      loadSoft('data/hna/place-chas.json'),
      // F121 — CHFA repeat-submittal watchlist. Curated 9-jurisdiction list of
      // HIGH-signal next-round candidates derived from four proxy signals:
      // award drought + housing need + Prop 123 readiness + multi-phase
      // trajectory regex. CHFA does NOT publish unsuccessful applicants, so
      // every attempts_observed count is unknown — these are pattern-match
      // candidates for PMA attention, not confirmed pending applicants. Soft
      // load: a missing file just suppresses the W badge with no UI breakage.
      loadSoft('data/policy/chfa-watchlist.json'),
      // F176 — Soft funding deadlines + capacity. Powers the detail
      // panel callout that surfaces the immediate filing gates (LOI +
      // application deadlines) for the selected jurisdiction. Soft
      // load: a missing file just hides the callout.
      loadSoft('data/policy/soft-funding-status.json'),
      // F180 — Historical QAP scoring + thresholds. Powers the "your
      // scoring runway" panel in the detail view so developers see at
      // a glance what total they need to hit (82+ high, 74+ moderate,
      // 65+ low) and where winners pull away from losers in each
      // scoring category.
      loadSoft('data/policy/chfa-awards-historical.json')
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
        // F239 — Index per-place metrics by GEOID so the OF rollup can
        // fold in regional (county-level) recency without re-deriving it.
        state.rankByGeoid = {};
        rankIdx.rankings.forEach(function (r) {
          if (r.geoid && r.metrics) state.rankByGeoid[r.geoid] = r.metrics;
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

      // F92 — Housing-policy progress (parts[19]). Curated per-jurisdiction
      // signals: HNA status, land banking, dedicated income stream, tap fee
      // reduction. Keyed by 7-digit place GEOID. Used in the Progress
      // column on the table + the detail panel.
      var progress = parts[19];
      if (progress && progress.by_geoid) {
        state.housingProgress = progress.by_geoid;
        state.housingProgressMeta = progress.meta || null;
      }

      // F96 — Apartment List rent index (parts[20]). Indexed by normalized
      // city name (lowercase). Provides explicit 1BR/2BR median rents +
      // YoY change. Used to triangulate the ZORI signal in the OF Capture
      // tooltip and the Deal Calc achievable-rent cap.
      var al = parts[20];
      if (al && al.cities) {
        state.apartmentListByCity = al.cities;
        state.apartmentListMeta = al.meta || null;
      }

      // F97 — ACS B25064 median gross rent (parts[21]). Full-coverage
      // baseline: every CO county + every CO place gets a value here.
      // Indexed by 5-digit FIPS (counties) and 7-digit GEOID (places).
      // The always-present line in the Capture tooltip.
      var acs = parts[21];
      if (acs && (acs.counties || acs.places)) {
        state.acsRentByCounty = acs.counties || {};
        state.acsRentByPlace  = acs.places   || {};
        state.acsRentMeta     = acs.meta     || null;
      }

      // F116 — CHFA 2026 Round One bridge (parts[22]). Tag every record
      // with _source/_bridge so one line of code can filter the bridge
      // out when the live ArcGIS feed catches up:
      //     awards.filter(a => !a._bridge)
      // Indexed by normalized lowercase city name (no suffix).
      var r1 = parts[22];
      if (r1 && Array.isArray(r1.awards)) {
        state.chfa2026R1Meta = r1.metadata || null;
        r1.awards.forEach(function (a) {
          // Apply provenance tags in memory.
          a._source = 'chfa-2026-r1-bridge';
          a._bridge = true;
          var key = (a.city || '').trim().toLowerCase();
          if (!key) return;
          (state.chfa2026R1ByCity[key] = state.chfa2026R1ByCity[key] || []).push(a);
        });
      }

      // F223 — Place-level CHAS (parts[23]). When present, needCompositeFor
      // prefers the place's renter+owner cost-burden shares over the
      // containing county's. Stops the bug where New Castle/Glenwood/Silt
      // all got identical Garfield County need scores. Falls back to county
      // when a place lacks the file or the place is marked low_confidence.
      var placeChas = parts[23];
      state.placeChas = (placeChas && placeChas.places) || {};

      // F176 — Soft-funding programs (parts[25]). Same shape as the
      // Compare page consumes. Used by the detail panel callout to
      // surface LOI + application deadlines for any deal scoped in the
      // selected jurisdiction.
      var softFunding = parts[25];
      state.softFundingPrograms = (softFunding && softFunding.programs) || {};
      state.softFundingMeta = (softFunding && softFunding.meta) || null;

      // F180 — Historical CHFA awards summary + scoring rubric (parts[26]).
      // Statewide; same for every selected jurisdiction. Used by the
      // QAP-scoring-runway block in the detail panel.
      var awardsHist = parts[26];
      state.qapScoring = (awardsHist && awardsHist.scoringFactors) || null;
      state.qapSummary = (awardsHist && awardsHist.summary) || null;

      // F121 — CHFA watchlist (parts[24]). Index by place_geoid so the table
      // renderer can append a W badge when the row matches. We zero-pad the
      // geoid to 7 chars because the data file omits the leading zero on
      // some 7-digit codes (e.g. "877290" vs the canonical "0877290").
      var chfaWatchlist = parts[24];
      state.chfaWatchlistByGeoid = {};
      state.chfaWatchlistEntries = [];
      if (chfaWatchlist && Array.isArray(chfaWatchlist.entries)) {
        state.chfaWatchlistMeta = chfaWatchlist.meta || null;
        state.chfaWatchlistEntries = chfaWatchlist.entries.slice();
        chfaWatchlist.entries.forEach(function (e) {
          var g = (e.place_geoid || '').toString();
          if (!g) return;
          state.chfaWatchlistByGeoid[g] = e;
          // Defensive: also key by zero-padded 7-digit form so a future data
          // refresh that drops the leading zero still matches.
          if (g.length < 7) {
            state.chfaWatchlistByGeoid[('0000000' + g).slice(-7)] = e;
          }
        });

        // F121 — render the standalone watchlist callout. Most of these
        // jurisdictions don't appear in the main basis-boost table, so the
        // callout surfaces them independently as PMA-attention prompts.
        try {
          var calloutEl = document.getElementById('lofWatchlistCallout');
          var listEl = document.getElementById('lofWatchlistList');
          if (calloutEl && listEl && state.chfaWatchlistEntries.length) {
            var items = state.chfaWatchlistEntries.map(function (entry) {
              var label = entry.jurisdiction + (entry.county ? ' (' + entry.county + ')' : '');
              var lastYrTxt = entry.last_award_year ? 'last ' + entry.last_award_year : 'never funded';
              var sigTxt = (entry.signal || '').toUpperCase();
              var hnaLink = 'housing-needs-assessment.html?fips=' +
                encodeURIComponent(entry.place_geoid) + '&geoType=place&auto=1';
              var tip = (entry.evidence_summary || '') + ' · ' + (entry.watchlist_action || '');
              return '<li style="margin:0;">' +
                '<a href="' + hnaLink + '" target="_blank" rel="noopener" ' +
                'title="' + escHtml(tip) + '" ' +
                'style="display:inline-flex;align-items:baseline;gap:.3rem;padding:.22rem .55rem;border-radius:6px;background:var(--card);border:1px solid var(--border);color:var(--text);text-decoration:none;font-size:.82rem;">' +
                '<strong>' + escHtml(label) + '</strong>' +
                '<span style="color:var(--muted);font-size:.75rem;">' + sigTxt + '</span>' +
                '<span style="color:var(--muted);font-size:.75rem;">· ' + lastYrTxt + '</span>' +
                '</a></li>';
            }).join('');
            listEl.innerHTML = items;
            calloutEl.hidden = false;
          }
        } catch (e) { /* non-fatal — callout just stays hidden */ }
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
      var lastYearPis = inside.reduce(function (max, p) {
        var y = parseInt(p.properties.YR_PIS, 10);
        return (Number.isFinite(y) && y > max) ? y : max;
      }, -Infinity);
      if (lastYearPis === -Infinity) lastYearPis = null;
      var totalUnits = inside.reduce(function (sum, p) {
        return sum + (+p.properties.N_UNITS || 0);
      }, 0);

      // F116 — 2026 R1 bridge awards in this jurisdiction. Matched by
      // normalized city name (the press release doesn't carry GEOIDs).
      var r1Awards = state.chfa2026R1ByCity[placeNameToCity(label).toLowerCase()] || [];

      // F146 — Fold recent CHFA award rounds INTO the lastYear used for
      // recency scoring. Previously we explicitly excluded the bridge data
      // ("we deliberately do NOT recompute lastYear…"); the user direction
      // is the opposite — recent awards that aren't in the HUD LIHTC
      // database yet should still count as "recently funded" so the
      // opportunity score doesn't keep recommending jurisdictions that just
      // won a 2026 R1 award.
      //
      // We also keep the YR_PIS-only `lastYearPis` field exposed in the row
      // record so the historical-data panel (which talks about
      // placed-in-service stock specifically) stays honest. Only the
      // recency-scoring path uses the bridge-augmented year.
      var lastYear = lastYearPis;
      if (r1Awards.length) {
        var bridgeYear = bridgeAwardYear(state.chfa2026R1Meta);
        if (bridgeYear != null && (lastYear == null || bridgeYear > lastYear)) {
          lastYear = bridgeYear;
        }
      }

      // F234 — Per-credit-type lastYear so the OF can apply the right
      // recency penalty per preset. A Rifle that won 9% Competitive in
      // 2023 shouldn't get its 4%-bond recency penalized — it has no
      // 4% history. Loop the same `inside` projects, filtering by
      // TypeOfCredits, and take the max year per type. Falls back to
      // null when there's no history under that credit type.
      function _maxYearWhere(projects, predicate) {
        var max = null;
        projects.forEach(function (proj) {
          var pr = proj.properties || {};
          if (!predicate(pr)) return;
          var y = parseInt(pr.AwardYear || pr.YR_ALLOC || pr.YR_PIS, 10);
          if (Number.isFinite(y) && (max == null || y > max)) max = y;
        });
        return max;
      }
      function _typeContains(pr, frag) {
        var t = String(pr.TypeOfCredits || '').toLowerCase();
        return t.indexOf(frag) !== -1;
      }
      var lastYear_9pct         = _maxYearWhere(inside, function (p) { return _typeContains(p, '9%'); });
      var lastYear_4pct         = _maxYearWhere(inside, function (p) { return _typeContains(p, '4%'); });
      var lastYear_state_credit = _maxYearWhere(inside, function (p) { return _typeContains(p, 'state'); });
      // F239a — Competitive = anything CHFA spreads geographically. Any 9%
      // (incl. "9% and State") + 4%+State. Excludes pure "4% Tax Exempt".
      // Mirrors the augment_ranking_index_recency.mjs classification.
      var lastYear_competitive  = _maxYearWhere(inside, function (p) {
        return _typeContains(p, '9%')
            || (_typeContains(p, '4%') && _typeContains(p, 'state'))
            || _typeContains(p, 'competitive');
      });
      // 2026 R1 bridge awards are competitive 9% wins.
      if (r1Awards.length) {
        var br = bridgeAwardYear(state.chfa2026R1Meta);
        if (br != null) {
          if (lastYear_9pct == null || br > lastYear_9pct) lastYear_9pct = br;
          if (lastYear_competitive == null || br > lastYear_competitive) lastYear_competitive = br;
        }
      }

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
      // F223 — Pass placeGeoid so per-place CHAS is preferred when available.
      var needRes = needCompositeFor(containingCounty, placeGeoid);
      var needComposite = needRes.composite;
      var needScoreRes = needScoreFor(containingCounty, needDist, placeGeoid);
      var needPct = needScoreRes.score;
      var needSource = needScoreRes.source;  // 'place' / 'county' / null

      // Component scores
      // F234 — `recScore` stays = the generic "any LIHTC" recency for
      // back-compat with everything that reads `op.recencyScore`. The
      // target-specific scores below get fed into `recencyForTarget()`
      // which the composite uses based on `_targetWeights` selection.
      var recScore = recencyScore(lastYear);
      var recScore_9pct         = recencyScore(lastYear_9pct);
      var recScore_4pct         = recencyScore(lastYear_4pct);
      var recScore_state_credit = recencyScore(lastYear_state_credit);
      var recScore_competitive  = recencyScore(lastYear_competitive);
      // F239 — Regional (county-level) recency. Captures the CHFA PMA
      // saturation logic: a recent award in a neighbor depresses this
      // place's saturation argument too because they share a market.
      // Read from the ranking-index (precomputed) and combine with the
      // own-place score by taking the LOWER (worse) of the two. Falls
      // back to own-only when ranking-index is missing the entry.
      var regional = state.rankByGeoid && state.rankByGeoid[placeGeoid];
      var recScore_9pct_regional         = regional && regional.regional_recency_score_9pct        != null ? Math.min(recScore_9pct,         regional.regional_recency_score_9pct)        : recScore_9pct;
      var recScore_4pct_regional         = regional && regional.regional_recency_score_4pct        != null ? Math.min(recScore_4pct,         regional.regional_recency_score_4pct)        : recScore_4pct;
      var recScore_state_credit_regional = regional && regional.regional_recency_score_state_credit!= null ? Math.min(recScore_state_credit, regional.regional_recency_score_state_credit): recScore_state_credit;
      var recScore_competitive_regional  = regional && regional.regional_recency_score_competitive != null ? Math.min(recScore_competitive,  regional.regional_recency_score_competitive) : recScore_competitive;
      // Anchor for explainability — surfaces in the row tooltip + detail panel
      var regional_recency_anchor = regional && regional.regional_recency_anchor || null;
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
      //
      // F234 — Pass the credit-type-appropriate recency per target:
      //   - 9pct           → recScore_9pct (only 9% history matters)
      //   - 4pct           → max(recScore_4pct, recScore_state_credit) i.e. the
      //                      MORE RECENT of any 4% award or any state-credit
      //                      award, since either disqualifies the geographic-
      //                      spread argument for the next round
      //   - preservation   → keep generic recScore (preservation deals look at
      //                      all LIHTC for substantial-rehab eligibility)
      //   - workforce_resort → recScore_competitive (resort markets compete via
      //                      9% Competitive + 4% and State)
      //   - prop123_local  → keep generic recScore (Prop 123 is its own pot;
      //                      LIHTC recency is secondary)
      //   - any            → keep generic recScore
      //
      // F235 — Fold competitive recency into the 4% formula. Rural CO 4%
      // deals need state credit attached to pencil; state credit + 9%
      // Competitive draw from the SAME competitive CHFA pool, so a recent
      // 9% Competitive award is a legitimate recency flag against a
      // 4% + State application from the same jurisdiction (Rifle 2023
      // 9% Competitive → its 4% recency drops from 100 to 75).
      function _minScore() {
        // LOWEST defined recency score across N inputs. Lower = more
        // recent = worse for opportunity.
        var best = null;
        for (var i = 0; i < arguments.length; i++) {
          var v = arguments[i];
          if (v == null) continue;
          if (best == null || v < best) best = v;
        }
        return best == null ? 100 : best;
      }
      // F239 — Composite recency for 4% target uses the REGIONAL variants
      // (own-place min'd with county-max). This captures CHFA's PMA
      // geographic-spread logic: a 2023 9% Competitive in Rifle (Garfield
      // County) correctly penalizes Silt + New Castle's 4%+State chances
      // because they share the same competitive allocation pool + market.
      var recScore_4pct_combined = _minScore(recScore_4pct_regional, recScore_state_credit_regional, recScore_competitive_regional);
      var score9            = compositeScore(recScore_9pct_regional,         needPct, bbScore, popScore, civicScoreForComposite, '9pct', type);
      var score4            = compositeScore(recScore_4pct_combined,         needPct, bbScore, popScore, civicScoreForComposite, '4pct', type);
      var scorePreservation = compositeScore(recScore,                       needPct, bbScore, popScore, civicScoreForComposite, 'preservation', type);
      var scoreWorkforce    = compositeScore(recScore_competitive_regional,  needPct, bbScore, popScore, civicScoreForComposite, 'workforce_resort', type);
      var scoreProp123      = compositeScore(recScore,                       needPct, bbScore, popScore, civicScoreForComposite, 'prop123_local', type);
      var scoreAny          = compositeScore(recScore,                       needPct, bbScore, popScore, civicScoreForComposite, 'any', type);

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
        // F146 — `lastYear` is the bridge-augmented max (CHFA 2026 R1 award
        // year wins over the HUD YR_PIS when newer). `lastYearPis` keeps the
        // pre-bridge HUD-only value so the historical-stock UI can still
        // show YR_PIS specifically when it needs to.
        lastYear:     lastYear,
        lastYearPis:  lastYearPis,
        yearsSince:   lastYear != null ? CURRENT_YEAR - lastYear : null,
        // F234 — per-credit-type lastYear + recency scores for the
        // compositeScore() target-aware switch and explainability panels.
        lastYear_9pct:         lastYear_9pct,
        lastYear_4pct:         lastYear_4pct,
        lastYear_state_credit: lastYear_state_credit,
        lastYear_competitive:  lastYear_competitive,
        population:   pop,
        // Component scores
        recencyScore: recScore,
        recencyScore_9pct:         recScore_9pct,
        recencyScore_4pct:         recScore_4pct,
        recencyScore_state_credit: recScore_state_credit,
        recencyScore_competitive:  recScore_competitive,
        // F239 — Regional (county-rollup) recency scores. These are what
        // the OF actually USES when scoring 9pct / 4pct / workforce_resort
        // composites (because CHFA's PMA saturation crosses jurisdiction
        // lines within a county). Exposed here for explainability + so
        // the Scenario Builder's recency-source picker can route through
        // them if the user wants.
        recencyScore_9pct_regional:         recScore_9pct_regional,
        recencyScore_4pct_regional:         recScore_4pct_regional,
        recencyScore_state_credit_regional: recScore_state_credit_regional,
        recencyScore_competitive_regional:  recScore_competitive_regional,
        regionalRecencyAnchor:              regional_recency_anchor,
        needScore:    needPct,
        needCompositePct: needComposite != null ? Math.round(needComposite * 100) : null,
        // F223 — provenance for the need component: 'place' = place-level CHAS;
        // 'county' = containing-county CHAS fallback; null = unavailable.
        needSource:   needSource,
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
        // F116 — Bridge awards in this jurisdiction (2026 R1, not yet
        // ingested into the live feed). Empty array if none. Each entry
        // is tagged with _source/_bridge so consumers can drop them in
        // one line when the live feed catches up.
        r1Awards: r1Awards,
        // F121 — CHFA watchlist entry for this jurisdiction, if any. Set when
        // the place_geoid matches the watchlist data file. Drives the "W"
        // badge on the row + the watchlist callout in the detail panel.
        watchlist: state.chfaWatchlistByGeoid[placeGeoid] || null,
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
    // F236 — Scenario Builder override. When a custom scenario is active
    // for the current target preset, compute the score live with the
    // user's chosen weights + recency source instead of using the
    // pre-computed preset score.
    if (state.customScenario && state.customScenario.target === t) {
      return _scenarioScore(op, state.customScenario);
    }
    if (t === '9pct')             return op.score9;
    if (t === '4pct')             return op.score4;
    if (t === 'preservation')     return op.scorePreservation;
    if (t === 'workforce_resort') return op.scoreWorkforce;
    if (t === 'prop123_local')    return op.scoreProp123;
    return op.scoreAny;
  }

  /**
   * F236 — Compute a one-off composite using user-chosen weights +
   * recency source. Mirrors compositeScore() but uses scenario.weights
   * instead of SCORE_WEIGHTS[target] and routes recency through
   * scenario.recencySource.
   *
   * recencySource values:
   *   'smart'        — use the preset's built-in routing (matches the
   *                    F234/F235 per-target recency mapping)
   *   'generic'      — op.recencyScore (any LIHTC)
   *   '9pct'         — op.recencyScore_9pct
   *   '4pct'         — op.recencyScore_4pct
   *   'state_credit' — op.recencyScore_state_credit
   *   'competitive'  — op.recencyScore_competitive
   */
  function _scenarioScore(op, scenario) {
    var w = scenario.weights;
    var rec = _scenarioRecency(op, scenario.target, scenario.recencySource);
    var civicVal = Number.isFinite(op.civicScore) ? op.civicScore : 0;
    var raw = rec * (w.recency / 100) + op.needScore * (w.need / 100) +
              op.basisBoostScore * (w.basis / 100) + op.populationScore * (w.pop / 100) +
              civicVal * (w.civic / 100);
    // Same CDP penalty as compositeScore so the override stays comparable
    if (op.type === 'cdp' && CDP_PENALTY_TARGETS[scenario.target]) raw += CDP_PENALTY;
    return Math.max(0, Math.round(raw));
  }

  function _scenarioRecency(op, target, source) {
    if (source === '9pct')         return op.recencyScore_9pct == null ? 100 : op.recencyScore_9pct;
    if (source === '4pct')         return op.recencyScore_4pct == null ? 100 : op.recencyScore_4pct;
    if (source === 'state_credit') return op.recencyScore_state_credit == null ? 100 : op.recencyScore_state_credit;
    if (source === 'competitive')  return op.recencyScore_competitive == null ? 100 : op.recencyScore_competitive;
    if (source === 'generic')      return op.recencyScore == null ? 100 : op.recencyScore;
    // 'smart' = per-target routing (matches F234/F235 defaults)
    if (target === '9pct')             return op.recencyScore_9pct == null ? 100 : op.recencyScore_9pct;
    if (target === '4pct') {
      var vals = [op.recencyScore_4pct, op.recencyScore_state_credit, op.recencyScore_competitive]
        .filter(function (v) { return v != null; });
      return vals.length ? Math.min.apply(null, vals) : 100;
    }
    if (target === 'workforce_resort') return op.recencyScore_competitive == null ? 100 : op.recencyScore_competitive;
    return op.recencyScore == null ? 100 : op.recencyScore;
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
      //
      // F255 — Fail-OPEN when captureAdvantage is null. Our HUD FMR cache
      // currently covers only 17 of 64 CO counties — places in the other
      // 47 (La Plata, Delta, Montrose, Routt, San Miguel, etc.) silently
      // fell out of the table whenever this filter was on. That's the
      // bug behind "Bayfield/Ignacio were near the top, then moved on
      // refresh." Fix: filter only on KNOWN negative capture, not on
      // missing data. The capture column already shows "—" when null so
      // the missing-data state is visible.
      if (f.requireCapture && op.captureAdvantage != null && op.captureAdvantage <= 0) return false;
      // F240 — downtown redev: must have URA match or OZ overlap.
      // op.hasUra + op.ozCount are stamped at compute-time when the redev
      // reference data is loaded; if not yet loaded, this filter is a no-op
      // until the redev data arrives + opportunities are re-stamped.
      if (f.requireRedev && !op.hasUra && !(op.ozCount > 0)) return false;
      // F251 — direct jurisdiction name search. Case-insensitive substring.
      // Activates at 2+ characters so partial single-letter input doesn't
      // empty the table on every keystroke. Also matches countyName so
      // typing "Pueblo" surfaces Pueblo city AND every place in Pueblo County.
      if (f.searchText && f.searchText.length >= 2) {
        var q = f.searchText.toLowerCase();
        var hayName  = (op.name || '').toLowerCase();
        var hayCounty = (op.countyName || '').toLowerCase();
        if (hayName.indexOf(q) === -1 && hayCounty.indexOf(q) === -1) return false;
      }
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

    // F96 — Apartment List triangulation. AL publishes city-level 1BR/2BR
    // medians monthly. Lookup by normalized place name (lowercase). Falls
    // back silently when not in AL's CO coverage (~21 cities).
    var alLine = '';
    var alKey = (op.name || '').trim().toLowerCase();
    var alRec = state.apartmentListByCity ? state.apartmentListByCity[alKey] : null;
    if (alRec && (Number.isFinite(alRec.rent_2br) || Number.isFinite(alRec.rent_overall))) {
      var alYoy = Number.isFinite(alRec.yoy_change_pct)
        ? ' (' + (alRec.yoy_change_pct >= 0 ? '+' : '') + alRec.yoy_change_pct.toFixed(1) + '% YoY)'
        : '';
      var brBits = [];
      if (Number.isFinite(alRec.rent_2br))     brBits.push('2BR $' + alRec.rent_2br.toLocaleString());
      if (Number.isFinite(alRec.rent_1br))     brBits.push('1BR $' + alRec.rent_1br.toLocaleString());
      if (Number.isFinite(alRec.rent_overall)) brBits.push('all $' + alRec.rent_overall.toLocaleString());
      alLine = ' · Apartment List ' + brBits.join(' / ') + alYoy;
    }

    // F97 — ACS B25064 baseline line. ALWAYS present for any jurisdiction
    // because ACS covers every CO county + every CO place. Place-level
    // lookup first (more specific); falls back to county.
    var acsLine = '';
    var acsRec = (op.placeGeoid && state.acsRentByPlace && state.acsRentByPlace[op.placeGeoid])
              || (op.containingCounty && state.acsRentByCounty && state.acsRentByCounty[op.containingCounty])
              || null;
    if (acsRec && Number.isFinite(acsRec.median_gross_rent)) {
      var acsScope = (op.placeGeoid && state.acsRentByPlace && state.acsRentByPlace[op.placeGeoid])
        ? 'place'
        : 'county';
      acsLine = ' · ACS median gross rent (' + acsScope + ', 5-yr): $' +
        acsRec.median_gross_rent.toLocaleString();
    }

    var tip = 'FMR 2BR: $' + m.fmr2br.toLocaleString() + ' · LIHTC 60% AMI 2BR max: $' + m.lihtc60ami2br.toLocaleString() +
              (ca < 0 ? ' · LIHTC above market — needs deeper AMI mix to pencil'
                      : ca === 0 ? ' · LIHTC ≈ market — narrow margin'
                      : ' · LIHTC undercuts market — easy lease-up') +
              acsLine +
              zoriLine +
              alLine;
    return '<span class="lof-capture-pill ' + cls + '" title="' + escHtml(tip) + '">' +
      sign + '$' + amt + '/mo</span>';
  }

  // F92 — Housing-policy progress cell: 4 compact pills representing each
  // jurisdiction's stance on HNA / land bank / dedicated income / tap-fee
  // reduction. The dataset only covers ~33 jurisdictions today; everywhere
  // else shows a single "—" cell so users know data isn't missing —
  // there just isn't a curated record yet.
  //
  // Pill colors:
  //   active        → green dot (program operational)
  //   in_progress   → amber dot (adopted commitment but not delivered)
  //   planning      → light blue dot (under evaluation)
  //   stale         → gray dot with stripe (program exists but outdated)
  //   none          → empty circle (no program; explicit "no")
  //   unknown       → "?" (unverified — common for tap-fees because they
  //                   live in water-district authority, not city authority)
  function _progressCell(op) {
    var rec = op.placeGeoid && state.housingProgress
      ? state.housingProgress[op.placeGeoid]
      : null;
    if (!rec) {
      // No curated data — show a quiet em-dash so user understands this is
      // "no record yet" rather than "this jurisdiction has no progress."
      return '<span class="lof-progress-na" title="No curated progress record for this jurisdiction (top ~33 covered today). Contribute via report-stale-link.">—</span>';
    }
    function pill(short, label, rec) {
      var s = (rec && rec.status) || 'unknown';
      var cls = 'lof-progress-pill lof-progress-' + s;
      var symbol = (
        s === 'active'      ? '●' :
        s === 'in_progress' ? '◐' :
        s === 'planning'    ? '◒' :
        s === 'stale'       ? '◌' :
        s === 'unknown'     ? '?' :
                              '○'    // 'none'
      );
      var bits = [label + ': ' + s];
      if (rec && rec.year)    bits.push('Year ' + rec.year);
      if (rec && rec.source)  bits.push(rec.source);
      if (rec && rec.name && s !== 'unknown') bits.push(rec.name);
      if (rec && rec.details) bits.push(rec.details);
      if (rec && rec.note)    bits.push(rec.note);
      var tip = bits.join(' · ');
      var inner = '<span class="lof-progress-mark">' + symbol + '</span>' +
                  '<span class="lof-progress-short">' + short + '</span>';
      // If there's a URL, wrap in <a> so user can click through (stop
      // propagation so it doesn't fire row selection).
      if (rec && rec.url) {
        return '<a href="' + escHtml(rec.url) + '" target="_blank" rel="noopener" ' +
          'class="' + cls + '" title="' + escHtml(tip) + '" ' +
          'onclick="event.stopPropagation()">' + inner + '</a>';
      }
      return '<span class="' + cls + '" title="' + escHtml(tip) + '">' + inner + '</span>';
    }
    return '<span class="lof-progress-cluster">' +
      pill('HNA',  'Housing Needs Assessment', rec.hna)              +
      pill('Land', 'Land banking',             rec.land_banking)     +
      pill('Fund', 'Dedicated income',         rec.dedicated_income) +
      pill('Fee',  'Tap fee reduction',        rec.tap_fee_reduction)+
    '</span>';
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
    // F241/F244 — surface URA boost. If F241 stamped a boosted score,
    // display "civic + URA = boosted" so the cap-stack signal shows up
    // in the table instead of being dead-stored.
    var boosted = (op.civicScoreBoosted && op.hasUra) ? op.civicScoreBoosted : null;
    var displayScore = boosted != null ? boosted : op.civicScore;
    var band = displayScore >= 70 ? 'high' : displayScore >= 40 ? 'med' : 'low';
    var tipBits = [
      'Prop 123: ' + (dims.prop123_committed ? 'committed' : (dims.prop123_committed === false ? 'no' : '—')),
      'HNA: '      + (dims.has_hna           ? 'yes' : (dims.has_hna === false ? 'no' : '—')),
      'Comp plan: '+ (dims.has_comp_plan     ? 'yes' : (dims.has_comp_plan === false ? 'no' : '—')),
      'HA: '       + (dims.has_housing_authority ? 'yes' : 'no'),
      'IZ: '       + (dims.has_iz_ordinance      ? 'yes' : 'no'),
      'Local $: '  + (dims.has_local_funding     ? 'yes' : 'no')
    ];
    if (op.hasUra && op.uraMatch) {
      tipBits.push('URA: ' + op.uraMatch.name + ' (+10 cap-stack boost)');
    }
    var uraBadge = boosted != null
      ? ' <span style="font-size:.66rem;color:var(--good);font-weight:700" title="Urban Renewal Authority match adds 10pt cap-stack boost">URA+10</span>'
      : '';
    return '<span class="lof-civic-cell lof-civic-' + band + '" ' +
      'title="' + escHtml(tipBits.join(' · ')) + '">' +
      displayScore + '<span style="font-size:.7rem;color:var(--muted)">/100</span> ' +
      '<span style="font-family:ui-monospace,monospace;font-size:.7rem;letter-spacing:.05em">' +
      prop123 + hna + plan +
      '</span>' + uraBadge +
      '</span>';
  }

  /* ── News linkouts ────────────────────────────────────────────────── */

  // Build a Google News query that includes the jurisdiction name and
  // an affordable-housing context. CO Sun and CPR don't have public
  // tag-search APIs we can deep-link to reliably, so we use Google
  // site-search URLs for those.
  //
  // F165: route every entry through SearchLinks for housing-targeted
  // queries (OR-grouped vocab, time-bound m12, site:-scoped per outlet).
  // Falls back to the legacy quoted-name query when SearchLinks isn't
  // loaded so the page still works in isolation.
  function newsUrls(placeName, countyName) {
    // F127 — disambiguate from same-named places in other states.
    // "Garfield County" exists in 6 states; "Boulder", "Aurora",
    // "Lakewood", "Springfield" etc. exist in many. Always pin to CO.
    var SL = (typeof window !== 'undefined' && window.SearchLinks) ? window.SearchLinks : null;
    var nFallback = encodeURIComponent('"' + placeName + '" Colorado affordable housing');
    var cFallback = encodeURIComponent('"' + countyName + '" Colorado affordable housing');
    if (SL) {
      return {
        googleNews:  SL.build({ jurisdictionName: placeName,  context: 'google-news'   }).url,
        coloradoSun: SL.build({ jurisdictionName: placeName,  context: 'colorado-sun'  }).url,
        cpr:         SL.build({ jurisdictionName: placeName,  context: 'cpr'           }).url,
        bizwest:     SL.build({ jurisdictionName: placeName,  context: 'bizwest'       }).url,
        countyNews:  SL.build({ countyName: countyName,       context: 'county-news'   }).url
      };
    }
    return {
      googleNews:  'https://news.google.com/search?q=' + nFallback + '&hl=en-US&gl=US&ceid=US%3Aen',
      coloradoSun:'https://www.google.com/search?q=site%3Acoloradosun.com+' + nFallback,
      cpr:        'https://www.google.com/search?q=site%3Acpr.org+' + nFallback,
      bizwest:    'https://www.google.com/search?q=site%3Abizwest.com+' + nFallback,
      countyNews: 'https://news.google.com/search?q=' + cFallback + '&hl=en-US&gl=US&ceid=US%3Aen'
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
      var html = '<tr><td colspan="13" class="lof-loading" style="padding:24px 16px;">' +
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
    // Phase-4 follow-up — compact "Top drivers: X, Y" one-liner under the
    // composite score on each list row. Two drivers only here; the detail
    // panel keeps the full drag/move-up template (F163). Visually subtle:
    // 0.66rem muted italic so the score number stays the visual anchor.
    var _activeTarget = state.filters.target;
    var _targetWeights = SCORE_WEIGHTS[_activeTarget] || SCORE_WEIGHTS.any;
    function _rowTopDrivers(op) {
      var dims = [
        { label: 'need',    score: op.needScore,        weight: _targetWeights.need },
        { label: 'recency', score: op.recencyScore,     weight: _targetWeights.recency },
        { label: 'basis',   score: op.basisBoostScore,  weight: _targetWeights.basis },
        { label: 'pop',     score: op.populationScore,  weight: _targetWeights.pop },
        { label: 'civic',   score: op.civicScore,       weight: _targetWeights.civic }
      ];
      var rated = dims.filter(function (d) {
        return Number.isFinite(d.score) && d.weight > 0;
      });
      if (rated.length < 2) return '';
      rated.sort(function (a, b) {
        return (b.score * b.weight) - (a.score * a.weight);
      });
      return rated[0].label + ', ' + rated[1].label;
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
      var topDriversText = _rowTopDrivers(op);
      var topDriversHtml = topDriversText
        ? '<div class="lof-row-drivers" style="margin-top:.15rem;font-size:.66rem;' +
          'line-height:1.25;color:var(--muted,#6b7280);font-style:italic;' +
          'font-weight:400;letter-spacing:.01em">Top drivers: ' + escHtml(topDriversText) + '</div>'
        : '';
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
      // F116 — Small "R1" badge next to the jurisdiction name when CHFA
      // 2026 Round One announced an award here (bridge data — not yet in
      // the ArcGIS feed). Pure visual signal; does not affect score.
      var r1Badge = (op.r1Awards && op.r1Awards.length)
        ? ' <span class="lof-r1-badge" title="' + escHtml(op.r1Awards.length + ' CHFA 2026 Round One award' + (op.r1Awards.length === 1 ? '' : 's') + ' announced 2026-05-21 (not yet in live ArcGIS feed)') + '">R1</span>'
        : '';
      // F121 — Small "W" (Watchlist) badge for jurisdictions flagged as
      // HIGH-signal next-round candidates by the CHFA repeat-submittal proxy
      // analysis. CHFA doesn't publish unsuccessful applicants, so this is
      // pattern-match (drought + need + Prop 123 + multi-phase) rather than
      // a confirmed-pending signal. Tooltip surfaces the action recommendation.
      var watchlistBadge = (op.watchlist)
        ? ' <span class="lof-watchlist-badge" title="' + escHtml('CHFA next-round watchlist · ' + (op.watchlist.signal || '').toUpperCase() + ' signal · last award ' + (op.watchlist.last_award_year || 'never') + ' · ' + (op.watchlist.watchlist_action || '')) + '">W</span>'
        : '';

      return '<tr data-op-id="' + escHtml(op.id) + '" class="' + selectedCls.trim() + '">' +
        '<td data-priority="primary"><span class="lof-score-cell ' + scoreCls + '">' + activeScore + '</span>' + topDriversHtml + '</td>' +
        '<td data-priority="primary"><strong>' + escHtml(op.name) + '</strong>' + r1Badge + watchlistBadge +
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
        '<td data-priority="tertiary">' + (op.needScore != null ? op.needScore : '—') + '<span style="font-size:.7rem;color:var(--muted)">p</span>' +
          // F223 — Disclosure pill when need came from the containing county
          // rather than place-level CHAS. Helps users know two places in the
          // same county aren't being scored as if they're literally identical.
          (op.type === 'place' && op.needSource === 'county'
            ? ' <span style="display:inline-block;font-size:.62rem;padding:1px 4px;border-radius:3px;background:var(--warn-dim);color:var(--warn);margin-left:3px;" title="No place-level CHAS available — this jurisdiction\'s need score is the containing county\'s CHAS composite, applied to every place in the county.">scaled</span>'
            : '') +
        '</td>' +
        '<td data-priority="tertiary">' + (op.population != null ? fmtInt(op.population) : '—') + '</td>' +
        '<td data-priority="primary">' + _captureCell(op) + '</td>' +
        '<td data-priority="secondary">' + _civicCell(op) + '</td>' +
        '<td data-priority="secondary">' + _prop123Cell(op) + '</td>' +
        '<td data-priority="secondary" class="lof-td-progress">' + _progressCell(op) + '</td>' +
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
      // F116 — Surface 2026 R1 award count in the marker tooltip when
      // present. Helps users spot fresh activity at a glance on the map.
      var r1TipLine = (op.r1Awards && op.r1Awards.length)
        ? '<br>🏷 2026 R1: ' + op.r1Awards.length + ' award' + (op.r1Awards.length === 1 ? '' : 's')
        : '';
      marker.bindTooltip(
        '<strong>' + escHtml(op.name) + '</strong><br>' +
        op.countyName + ' · score ' + activeScore + '/100<br>' +
        (op.lastYear != null ? 'Last LIHTC: ' + op.lastYear : 'Never funded') +
        r1TipLine,
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
    // F165: housing-staff lookup also routed through SearchLinks so it
    // gets OR-grouped role terms + last-12-mo time bound + no LinkedIn.
    var SL = (typeof window !== 'undefined' && window.SearchLinks) ? window.SearchLinks : null;
    var staffUrl = SL
      ? SL.build({ jurisdictionName: op.name, context: 'housing-staff' }).url
      : ('https://www.google.com/search?q=' +
         encodeURIComponent('"' + op.name + ' Colorado" Colorado housing coordinator OR director OR manager'));
    // F227 — Two fallback links for small jurisdictions where the focused
    // LIHTC-vocabulary search returns 0 results. The first widens vocabulary
    // (any housing / residential / planning news); the second drops the date
    // restriction entirely to surface archive material.
    var broadUrl   = SL ? SL.build({ jurisdictionName: op.name, context: 'news-broad'   }).url : urls.googleNews;
    var archiveUrl = SL ? SL.build({ jurisdictionName: op.name, context: 'news-archive' }).url : urls.googleNews;
    return '<h4 class="lof-section-h">Housing news &amp; research</h4>' +
      '<p style="margin:0 0 .5rem;font-size:.78rem;color:var(--muted);">' +
        '<strong>Recent news = last 12 months on 12 CO press sites.</strong> ' +
        'Small jurisdictions like Fruita or Silt often return 0 hits with the focused query — try the broader / archive buttons below the first row.' +
      '</p>' +
      '<div class="lof-news-grid">' +
        '<a class="lof-news-btn" href="' + urls.googleNews + '" target="_blank" rel="noopener">' +
          '🗞️ Google News<br><span>"' + escHtml(op.name) + '" + LIHTC vocab · last 12 mo</span></a>' +
        '<a class="lof-news-btn" href="' + urls.coloradoSun + '" target="_blank" rel="noopener">' +
          '☀️ Colorado Sun<br><span>site search</span></a>' +
        '<a class="lof-news-btn" href="' + urls.cpr + '" target="_blank" rel="noopener">' +
          '📻 Colorado Public Radio<br><span>site search</span></a>' +
        '<a class="lof-news-btn" href="' + urls.bizwest + '" target="_blank" rel="noopener">' +
          '📰 BizWest<br><span>site search</span></a>' +
        '<a class="lof-news-btn" href="' + urls.countyNews + '" target="_blank" rel="noopener">' +
          '🏛️ County news<br><span>"' + escHtml(op.countyName) + '"</span></a>' +
        '<a class="lof-news-btn" href="' + staffUrl + '" target="_blank" rel="noopener">' +
          '🔎 Find housing staff<br><span>web search</span></a>' +
        // F227 — fallback row
        '<a class="lof-news-btn" href="' + broadUrl + '" target="_blank" rel="noopener" ' +
              'style="background:var(--warn-dim);color:var(--warn);border-color:var(--warn);">' +
          '🔄 Try broader search<br><span>drop quotes + LIHTC vocab · last 24 mo</span></a>' +
        '<a class="lof-news-btn" href="' + archiveUrl + '" target="_blank" rel="noopener" ' +
              'style="background:var(--warn-dim);color:var(--warn);border-color:var(--warn);">' +
          '📜 Search archives<br><span>open web · all years</span></a>' +
      '</div>';
  }

  // ── F236: Downtown redevelopment panel ────────────────────────────────
  // Pulls Urban Renewal Authority (URA) presence, Opportunity Zone tract
  // count for the county, and the adaptive-reuse pattern menu (hotel-to-
  // housing, office-to-residential, parking-lot infill, underutilized
  // commercial). Surfaces the deeper LIHTC cap-stack tools (URA TIF,
  // OZ deferral, Historic Tax Credit, brownfield grants, Prop 123
  // acquisition) that aren't available on greenfield sites.
  //
  // Cache: lazy-fetch once per page load. Renderer is safe to call before
  // fetch lands — it shows a "Loading…" placeholder and re-renders when
  // the data arrives.
  var _redev = {
    ura: null, uraLoading: false,
    reuse: null, reuseLoading: false,
    oz: null, ozLoading: false
  };

  function _normalizeJurisdName(s) {
    if (!s) return '';
    return String(s).toLowerCase()
      .replace(/^(city|town|city and county) of /, '')
      .replace(/\s+/g, ' ').trim();
  }

  function _findUraForOp(op) {
    if (!_redev.ura || !_redev.ura.uras) return null;
    var target = _normalizeJurisdName(op.name);
    if (!target) return null;
    var matches = _redev.ura.uras.filter(function (u) {
      var j = _normalizeJurisdName(u.jurisdiction);
      return j === target;
    });
    return matches.length ? matches[0] : null;
  }

  function _countOzTractsInCounty(countyFips5) {
    if (!_redev.oz || !_redev.oz.features || !countyFips5) return 0;
    return _redev.oz.features.reduce(function (n, f) {
      var p = f && f.properties;
      return n + ((p && p.county_fips === countyFips5 && p.designated !== false) ? 1 : 0);
    }, 0);
  }

  // F240/F241: Once URA + OZ data is loaded, stamp every existing op with
  // hasUra / uraMatch / ozCount + apply a +10-pt civic score boost for any
  // jurisdiction with a housing-in-mission URA. Re-runs idempotently so
  // it's safe to call multiple times. Civic boost applied to the composite
  // input feeds the existing score formulas without changing the dimension
  // architecture.
  var CIVIC_URA_BOOST = 10; // points (0-100 scale); URA = real cap-stack tool
  function _stampRedevOnOps() {
    if (!Array.isArray(state.opportunities) || !state.opportunities.length) return;
    var uraLoaded = _redev.ura && _redev.ura.uras;
    var ozLoaded = _redev.oz && _redev.oz.features;
    if (!uraLoaded && !ozLoaded) return;
    state.opportunities.forEach(function (op) {
      // URA match
      if (uraLoaded) {
        var ura = _findUraForOp(op);
        op.uraMatch = ura;
        op.hasUra = !!(ura && ura.housing_in_mission !== false);
      }
      // OZ count for op's county
      if (ozLoaded) {
        var c5 = op.containingCounty || '';
        if (c5 && c5.length === 3) c5 = '08' + c5;
        op.ozCount = _countOzTractsInCounty(c5);
      }
      // F241: civic boost for housing-in-mission URA. Stored as the
      // boosted `civicScore` so existing rendering (driver chips, score
      // tooltip) reflects it. We don't re-run compositeScore() — the
      // composite already used the original civic dimension; the boost
      // is informational/post-score so the OF table doesn't reshuffle
      // mid-session. Stamping `civicScoreBoosted` lets the renderer show
      // it explicitly without overwriting the underlying score.
      if (op.hasUra && Number.isFinite(op.civicScore)) {
        op.civicScoreBoosted = Math.min(100, Math.round(op.civicScore + CIVIC_URA_BOOST));
      }
    });
  }

  function _loadRedevData(onArrival) {
    var fired = function () { if (typeof onArrival === 'function') onArrival(); };
    if (!_redev.ura && !_redev.uraLoading) {
      _redev.uraLoading = true;
      fetch('data/market/co-urban-renewal-authorities.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { _redev.ura = j || { uras: [] }; })
        .catch(function () { _redev.ura = { uras: [] }; })
        .then(function () { _redev.uraLoading = false; fired(); });
    }
    if (!_redev.reuse && !_redev.reuseLoading) {
      _redev.reuseLoading = true;
      fetch('data/market/co-adaptive-reuse-references.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { _redev.reuse = j || { patterns: {} }; })
        .catch(function () { _redev.reuse = { patterns: {} }; })
        .then(function () { _redev.reuseLoading = false; fired(); });
    }
    if (!_redev.oz && !_redev.ozLoading) {
      _redev.ozLoading = true;
      fetch('data/market/opportunity_zones_co.geojson')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { _redev.oz = j || { features: [] }; })
        .catch(function () { _redev.oz = { features: [] }; })
        .then(function () { _redev.ozLoading = false; fired(); });
    }
  }

  function _renderRedevPanel(op) {
    var allLoaded = _redev.ura && _redev.reuse && _redev.oz;
    if (!allLoaded) {
      _loadRedevData(function () {
        var mount = document.getElementById('lofDetailRedev');
        if (mount && op && state.selectedId === op.id) {
          mount.innerHTML = _renderRedevPanel(op);
        }
      });
      return '<h4 class="lof-section-h">🏗️ Downtown redevelopment opportunities</h4>' +
        '<div style="font-size:.78rem;color:var(--muted);padding:.5rem 0;">Loading URA + Opportunity Zone + adaptive-reuse references…</div>';
    }

    var countyFips5 = op.containingCounty || '';
    if (countyFips5 && countyFips5.length === 3) countyFips5 = '08' + countyFips5;

    var ura = _findUraForOp(op);
    var ozCount = _countOzTractsInCounty(countyFips5);
    var patterns = (_redev.reuse && _redev.reuse.patterns) || {};

    var html = '<h4 class="lof-section-h">🏗️ Downtown redevelopment opportunities</h4>' +
      '<p style="margin:0 0 .6rem;font-size:.78rem;color:var(--muted);line-height:1.5;">' +
        'Downtown infill — old hotels, vacant offices, surface parking lots, underutilized commercial — ' +
        'stacks 4-5 LIHTC cap-stack tools (basis boost · URA TIF · OZ deferral · Historic Tax Credit · brownfield grants) that greenfield sites can\'t access.' +
      '</p>';

    // 1. URA presence
    html += '<div style="margin:.6rem 0;padding:.6rem .7rem;border-radius:6px;background:var(--surface-2,#f7f7f9);">' +
      '<div style="font-weight:600;font-size:.84rem;margin-bottom:.3rem;">Urban Renewal Authority (URA)</div>';
    if (ura) {
      var tifText = ura.annual_tif_revenue_estimate_M
        ? '~$' + ura.annual_tif_revenue_estimate_M + 'M/yr TIF capacity'
        : 'TIF capacity not published';
      var plans = (ura.active_plans && ura.active_plans.length)
        ? ura.active_plans.slice(0, 4).join(' · ')
        : 'plan areas not published';
      html += '<div style="font-size:.78rem;line-height:1.5;">' +
        '<strong><a href="' + ura.url + '" target="_blank" rel="noopener" style="color:var(--brand);">' +
          escHtml(ura.name) + '</a></strong> — ' + tifText + '.<br>' +
        '<span style="color:var(--muted);"><strong>Active plan areas:</strong> ' + escHtml(plans) + '</span>';
      if (ura.lihtc_track_record) {
        html += '<div style="margin-top:.3rem;font-size:.76rem;color:var(--muted);font-style:italic;">' +
          '<strong style="font-style:normal;color:var(--text);">LIHTC track record:</strong> ' + escHtml(ura.lihtc_track_record) +
        '</div>';
      }
      html += '</div>';
    } else {
      html += '<div style="font-size:.78rem;color:var(--muted);">' +
        'No active URA on file for ' + escHtml(op.name) + '. Smaller cities sometimes operate via a Downtown Development Authority (DDA) or county economic-development arm — worth confirming with the municipality directly. ' +
        '<a href="https://cdola.colorado.gov/funding-programs/urban-renewal" target="_blank" rel="noopener" style="color:var(--brand);">DOLA URA program ↗</a>' +
      '</div>';
    }
    html += '</div>';

    // 2. Opportunity Zone overlap
    html += '<div style="margin:.6rem 0;padding:.6rem .7rem;border-radius:6px;background:var(--surface-2,#f7f7f9);">' +
      '<div style="font-weight:600;font-size:.84rem;margin-bottom:.3rem;">Opportunity Zone overlap</div>';
    if (ozCount > 0) {
      html += '<div style="font-size:.78rem;line-height:1.5;">' +
        '<strong>' + ozCount + ' designated OZ tract' + (ozCount === 1 ? '' : 's') + '</strong> in ' +
        escHtml(op.countyName || 'this county') + '. ' +
        'Property within these tracts qualifies for federal capital-gains deferral via Qualified Opportunity Fund equity — stacks with LIHTC + state credit.<br>' +
        '<a href="https://www.cdfifund.gov/opportunity-zones" target="_blank" rel="noopener" style="color:var(--brand);">HUD CDFI OZ map ↗</a>' +
      '</div>';
    } else {
      html += '<div style="font-size:.78rem;color:var(--muted);">' +
        'No Opportunity Zones designated in ' + escHtml(op.countyName || 'this county') + '. OZ designations are permanent (2018 selections) — no path to add new ones.' +
      '</div>';
    }
    html += '</div>';

    // 3. Adaptive-reuse pattern menu
    html += '<details style="margin:.6rem 0;padding:.5rem .7rem;border-radius:6px;background:var(--surface-2,#f7f7f9);">' +
      '<summary style="cursor:pointer;font-weight:600;font-size:.84rem;">' +
        'Adaptive-reuse patterns to evaluate ' +
        '<span style="color:var(--muted);font-weight:400;font-size:.78rem;">(' +
          Object.keys(patterns).length + ' patterns · cost · timeline · CO examples)</span>' +
      '</summary>' +
      '<div style="margin-top:.5rem;display:grid;gap:.5rem;">';
    var PATTERN_LABELS = {
      hotel_motel_to_residential: { icon: '🏨', label: 'Hotel / motel → residential' },
      office_to_residential:      { icon: '🏢', label: 'Office → residential' },
      surface_parking_infill:     { icon: '🅿️', label: 'Surface parking infill' },
      underutilized_commercial_parcel: { icon: '🏚️', label: 'Underutilized commercial parcel' }
    };
    Object.keys(patterns).forEach(function (key) {
      var p = patterns[key];
      var pmeta = PATTERN_LABELS[key] || { icon: '🏗️', label: key.replace(/_/g, ' ') };
      html += '<div style="padding:.5rem .6rem;border:1px solid var(--border);border-radius:5px;background:var(--surface);font-size:.78rem;line-height:1.5;">' +
        '<div style="font-weight:600;margin-bottom:.25rem;">' + pmeta.icon + ' ' + escHtml(pmeta.label) + '</div>' +
        '<div style="color:var(--muted);">' +
          '<strong style="color:var(--text);">Cost:</strong> $' + escHtml(p.typical_cost_per_unit_K || '—') + 'K/unit · ' +
          '<strong style="color:var(--text);">Timeline:</strong> ' + escHtml(p.typical_timeline_months || '—') + ' months' +
        '</div>' +
        '<div style="margin-top:.25rem;color:var(--muted);">' + escHtml(p.what_it_is || '') + '</div>';
      if (p.colorado_examples && p.colorado_examples.length) {
        html += '<div style="margin-top:.25rem;color:var(--muted);font-size:.74rem;">' +
          '<strong style="color:var(--text);">CO examples:</strong> ' +
          escHtml(p.colorado_examples.slice(0, 2).join(' · ')) +
        '</div>';
      }
      if (p.financing_tools && p.financing_tools.length) {
        html += '<div style="margin-top:.25rem;color:var(--muted);font-size:.74rem;">' +
          '<strong style="color:var(--text);">Cap stack:</strong> ' +
          escHtml(p.financing_tools.slice(0, 3).join(' + ')) +
        '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    html += '<div style="margin-top:.5rem;font-size:.74rem;color:var(--muted);">' +
      '<a href="data/market/co-adaptive-reuse-references.json" target="_blank" rel="noopener" style="color:var(--brand);">' +
        'Full reference + 12-item site evaluation checklist →</a>' +
    '</div>';
    html += '</details>';

    // 4. Tools row
    html += '<div style="margin:.6rem 0 .25rem;font-size:.76rem;color:var(--muted);">' +
      '<strong>Environmental + acquisition tools:</strong> ' +
      '<a href="https://www.epa.gov/brownfields" target="_blank" rel="noopener" style="color:var(--brand);">EPA Brownfields ↗</a> · ' +
      '<a href="https://cdphe.colorado.gov/voluntary-cleanup-program" target="_blank" rel="noopener" style="color:var(--brand);">CO Voluntary Cleanup ↗</a> · ' +
      '<a href="https://cdola.colorado.gov/brownfields-revolving-loan-fund" target="_blank" rel="noopener" style="color:var(--brand);">DOLA Brownfields RLF ↗</a> · ' +
      '<a href="https://www.nps.gov/subjects/taxincentives/index.htm" target="_blank" rel="noopener" style="color:var(--brand);">Federal Historic Tax Credit ↗</a>' +
    '</div>';
    html += '<div style="font-size:.72rem;color:var(--muted);font-style:italic;margin-top:.3rem;">' +
      'Source: DOLA URA registry; HUD CDFI Opportunity Zones (2018 designations); COHO adaptive-reuse reference (CHFA + Novogradac case studies). ' +
      'URA active plans + TIF capacity change frequently — confirm with the URA executive director before pitching.' +
    '</div>';

    return html;
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
    /* F146 — `op.lastYear` is now the max of YR_PIS *and* recent CHFA
       award rounds (2026 R1 bridge), so phrase the dry-spell text as
       "last LIHTC activity" rather than "placed-in-service" specifically;
       the placed-in-service year is still available as op.lastYearPis if
       a future copy needs to be PIS-specific. */
    if (op.yearsSince != null && op.yearsSince >= 10) {
      reasons.push('<strong>Long LIHTC dry spell:</strong> ' + op.yearsSince + ' years since last LIHTC activity (' + op.lastYear + ') — minimal saturation conflict.');
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
    // 9. F116 — Fresh CHFA 2026 R1 award (bridge data, announced 2026-05-21).
    // Informational only — IOI/recency math intentionally not boosted because
    // the underlying CHFA QAP scoring treats recent awards as competitive
    // headwind, not tailwind. But for a developer reading the panel, it's
    // a meaningful "this market is on CHFA's radar right now" signal.
    if (op.r1Awards && op.r1Awards.length) {
      var unitsR1 = op.r1Awards.reduce(function (s, a) { return s + (+a.total_units || 0); }, 0);
      reasons.push('<strong>2026 R1 award' + (op.r1Awards.length === 1 ? '' : 's') + ':</strong> CHFA reserved credits for ' +
        op.r1Awards.length + ' development' + (op.r1Awards.length === 1 ? '' : 's') +
        ' / ' + unitsR1 + 'u here on 2026-05-21 — fresh competitive set + signal that scoring works for this market.');
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

    // F92 — Zoom the map to the selected jurisdiction (per user request).
    // Uses the Census Gazetteer centroid (F16) first; falls back to county
    // centroid for the rare jurisdiction without a place centroid.
    //
    // Zoom level scaled by jurisdiction type so users see useful context:
    //   - city / large municipality: zoom 12 (~ 5-10 mi radius)
    //   - town / CDP: zoom 13         (~ 2-5 mi radius)
    //   - county fallback: zoom 10    (full county visible)
    //
    // flyTo is animated (~1s). Wrapped in try so a map render issue
    // doesn't break the detail panel.
    try {
      if (state.map) {
        var centroid = (op.placeGeoid && state.placeCentroid[op.placeGeoid])
          || (op.containingCounty && state.countyCentroid && state.countyCentroid[op.containingCounty])
          || null;
        if (centroid && Number.isFinite(centroid.lat) && Number.isFinite(centroid.lng)) {
          var zoom = 12;
          if (op.type === 'cdp' || (op.population != null && op.population < 5000)) zoom = 13;
          else if (!op.placeGeoid || !state.placeCentroid[op.placeGeoid]) zoom = 10;
          state.map.flyTo([centroid.lat, centroid.lng], zoom, { duration: 0.9 });
        }
      }
    } catch (_) { /* map can't fly — keep detail panel rendering */ }

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
        '</div>' +
        // F161 — IndiBuild Pipeline mount. Hydrated below only when the
        // visitor has a live IndiBuild session (inline auth check, no
        // gate script load on this public page).
        '<div id="lofDetailPipelineMount" style="margin-top:10px"></div>';

      // F161 — Conditional Pipeline button. Public visitors see nothing;
      // authenticated IndiBuild users (in-session) get the same "+ Add to
      // IndiBuild Pipeline" button as on the brief, prefilled from the
      // OF row's geoid + scorecard composite.
      //
      // Phase-4 cleanup: prefer the canonical window.IndiBuildGate.isAuthed
      // exposed by js/indibuild-gate.js (same SHA + storage key). The
      // local fallback handles public visitors who never load gate.js.
      try {
        function _isIBAuthed() {
          if (window.IndiBuildGate && typeof window.IndiBuildGate.isAuthed === 'function') {
            try { return !!window.IndiBuildGate.isAuthed(); } catch (_) { /* fall through */ }
          }
          // Fallback for unauthed public visitors on pages that never load
          // indibuild-gate.js — keep behaviour byte-identical to the gate.
          try {
            var raw = sessionStorage.getItem('ib-auth-v1');
            if (!raw) return false;
            var v = JSON.parse(raw);
            return v && v.ts && (Date.now() - v.ts < 12 * 60 * 60 * 1000);
          } catch (_) { return false; }
        }
        if (_isIBAuthed() && window.PipelineAddButton && window.PipelineStore) {
          var pipelineMount = document.getElementById('lofDetailPipelineMount');
          if (pipelineMount) {
            window.PipelineAddButton.attach(pipelineMount, {
              jurisdiction: op.name,
              geoid:        op.placeGeoid || op.containingCounty,
              defaults: {
                stage:          'Signal',
                ioi_score:      op.compositeScore ? Math.round(op.compositeScore) : '',
                confidence:     op.compositeScore >= 70 ? 'high' : op.compositeScore >= 50 ? 'medium' : 'low',
                product_type:   op.targetMode === '9pct' ? '9% LIHTC' : op.targetMode === '4pct' ? '4% LIHTC' : '',
                notes:          'From Opportunity Finder · ranked #' + (op.rank || '—')
              }
            });
          }
        }
      } catch (e) { /* never break the public detail panel */ }
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
        : '<em>Never funded on record</em>') +
        // F116 — Bridge-data callout: 2026 R1 awards announced 2026-05-21
        // that the ArcGIS feed has not ingested yet. Surfaced as a pill so
        // the user immediately sees the freshest LIHTC activity even when
        // YR_PIS-based recency math reads "never funded" or stale.
        ((op.r1Awards && op.r1Awards.length)
          ? '<br><span class="lof-pill lof-pill--accent" style="margin-top:6px;display:inline-block;" title="CHFA 2026 Round One — announced 2026-05-21. Not yet in the live HousingTaxCreditProperties ArcGIS feed (latest record dated 2025-12-16).">🏷 RECENT 2026 R1 AWARD' +
              (op.r1Awards.length > 1 ? ' (' + op.r1Awards.length + ')' : '') +
            '</span>' +
            '<div style="margin-top:6px;font-size:.78rem;line-height:1.55;">' +
              op.r1Awards.map(function (a) {
                var credits = [];
                if (a.federal_9pct_credit) credits.push('9%: $' + fmtInt(a.federal_9pct_credit));
                if (a.federal_4pct_credit) credits.push('4%: $' + fmtInt(a.federal_4pct_credit));
                if (a.state_credit)        credits.push('state: $' + fmtInt(a.state_credit));
                if (a.toc_credit)          credits.push('TOC: $' + fmtInt(a.toc_credit));
                return '<div style="margin-top:4px;">' +
                  '<strong>' + escHtml(a.name) + '</strong> — ' +
                  (a.total_units || '—') + 'u · ' +
                  escHtml(a.sponsor || 'sponsor TBD') +
                  (credits.length ? ' <span style="color:var(--muted);font-size:.72rem;">· ' + escHtml(credits.join(' · ')) + '</span>' : '') +
                  '</div>';
              }).join('') +
              (state.chfa2026R1Meta
                ? '<div style="margin-top:4px;font-size:.72rem;color:var(--muted);">Source: <a href="' + escHtml(state.chfa2026R1Meta.source_url || 'https://www.chfainfo.com/rental-housing/housing-credit') + '" target="_blank" rel="noopener">CHFA 2026 R1 award descriptions ↗</a> · bridge data until ArcGIS feed catches up.</div>'
                : '') +
            '</div>'
          : '') +
      '</dd>' +
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
        // F207c — CHAS reliability badge slot. Async-filled after the
        // detail panel renders; stays hidden if the cross-check returns
        // 'chas_only' (precompute pipeline pending).
        ' <span data-of-reliability="' + escHtml(op.placeGeoid || '') + '"></span>' +
      '</dd>' +
      '<dt>Population (approx)</dt><dd>' + (op.population != null ? fmtInt(op.population) : 'unknown') + '</dd>' +
      (op.qctCount > 0 ?
        '<dt>QCT tracts in jurisdiction</dt><dd style="font-family:ui-monospace,monospace;font-size:.78rem">' +
          op.qctTracts.map(function (t) { return t.tract_geoid; }).join(', ') +
        '</dd>' : '');

    // Top drivers / drag footer — one-line plain-English "why" under the
    // composite score for the currently active target. Ranks each of the 5
    // dimensions (need / recency / basis / pop / civic) by weight × score
    // and surfaces the two strongest pull-ups + the biggest drag (only when
    // the drag dimension scored < 45 or noticeably below the row's avg).
    // Detail-panel only — we deliberately do NOT render this on list rows.
    (function _renderOfDrivers() {
      var t = state.filters.target;
      var w = SCORE_WEIGHTS[t] || SCORE_WEIGHTS.any;
      var DRIVER_DIMS = [
        { key: 'need',    label: 'AMI need',     score: op.needScore,        weight: w.need,
          moveUp: 'cost burden / severe burden in this county worsens' },
        { key: 'recency', label: 'Recency gap',  score: op.recencyScore,     weight: w.recency,
          moveUp: 'years since the last LIHTC award here grow (saturation eases)' },
        { key: 'basis',   label: 'Basis boost',  score: op.basisBoostScore,  weight: w.basis,
          moveUp: 'a QCT or DDA designation is added (currently neither)' },
        { key: 'pop',     label: 'Population',   score: op.populationScore,  weight: w.pop,
          moveUp: 'the jurisdiction reaches a larger absorption pool' },
        { key: 'civic',   label: 'Civic capacity', score: op.civicScore,     weight: w.civic,
          moveUp: 'Prop 123 commitment / HNA / comp-plan / housing-lead infrastructure lands' }
      ];
      var rated = DRIVER_DIMS
        .filter(function (d) { return Number.isFinite(d.score) && d.weight > 0; })
        .map(function (d) {
          return { label: d.label, score: d.score, weight: d.weight,
                   contribution: d.score * d.weight, moveUp: d.moveUp };
        });
      if (rated.length < 2) return;
      var sorted = rated.slice().sort(function (a, b) { return b.contribution - a.contribution; });
      var top1 = sorted[0];
      var top2 = sorted[1];
      var bot  = sorted[sorted.length - 1];
      var avg = rated.reduce(function (s, d) { return s + d.score; }, 0) / rated.length;
      var showDrag = bot && bot !== top1 && bot !== top2 && (bot.score < 45 || bot.score < avg - 12);
      var html = '<strong style="font-style:normal;color:var(--text)">Top drivers:</strong> ' +
        top1.label + ' (+' + Math.round(top1.score) + '), ' +
        top2.label + ' (+' + Math.round(top2.score) + ').';
      if (showDrag) {
        html += ' <strong style="font-style:normal;color:var(--text)">Drag:</strong> ' +
          bot.label + ' (-' + Math.round(100 - bot.score) + ').' +
          ' Would move up if ' + bot.moveUp + '.';
      }
      var driversFooter = '<div class="lof-score-drivers" ' +
        'style="margin-top:.5rem;padding:.4rem .55rem;border-top:1px dashed var(--border);' +
        'font-size:.78rem;line-height:1.45;color:var(--muted,#6b7280);font-style:italic">' +
        html + '</div>';
      facts.insertAdjacentHTML('beforeend', driversFooter);
    })();

    // F207c — async-populate the CHAS reliability badge in the need
    // composite row. Kept inline (small) so it sits next to the
    // percentile rank, mirroring the spec's "show the cross-check next
    // to the rate it explains" recommendation.
    (function _populateOfReliability() {
      if (!window.RentBurdenReliability || !op.placeGeoid) return;
      var slot = facts.querySelector('[data-of-reliability="' + op.placeGeoid + '"]');
      if (!slot) return;
      var geoType = String(op.placeGeoid).length === 5 ? 'county' : 'place';
      window.RentBurdenReliability.computeReliability({
        geoid: op.placeGeoid, geoType: geoType, metric: 'renter_cb30',
      }).then(function (rel) {
        if (!rel || !slot.isConnected) return;
        // Stay silent when the precompute pipeline hasn't shipped — we
        // already say "CO percentile rank: p77" next to the rate; an
        // ambient 'insufficient' badge adds noise without value.
        if (rel.data_source === 'chas_only') return;
        slot.innerHTML = window.RentBurdenReliability.confidenceBadge(rel, { compact: true });
      }).catch(function () { /* non-fatal */ });
    })();

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

    // F236: Downtown redevelopment — URA presence + OZ overlap + adaptive-reuse menu.
    // Lazy-fetches three data files on first detail click; subsequent
    // detail clicks render from in-memory cache.
    try {
      var redevEl = $('lofDetailRedev');
      if (redevEl) redevEl.innerHTML = _renderRedevPanel(op);
    } catch (err) { /* non-blocking */ }

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

    // F176 — Soft-funding deadlines callout for the selected
    // jurisdiction. Shows every program eligible here (county === "All"
    // OR matching county), sorted by next LOI deadline ascending so the
    // immediate filing gates float to the top.
    _renderDetailSoftFunding(op);

    // F180 — QAP scoring runway. Statewide data, doesn't change with
    // jurisdiction, but the per-detail render lets users see it in
    // context with the rest of the deal-screen view.
    _renderDetailQap();

    // F137: render comparable affordable-property set (5 nearest)
    _renderCompSet(op);
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

  /* ── F137: Comparable affordable-property set ─────────────────────── */

  // Async — fetches data/affordable-housing/properties.json (deduped,
  // 5-source unified file) via AffordableHousingLayer.loadProperties()
  // and renders the 5 nearest properties to the jurisdiction centroid.
  //
  // This is the single highest-leverage IC-packet credibility add:
  // every underwriter asks "what's the comp set look like?" — now the
  // answer is in the panel, with category badges, distance, units,
  // year placed, credit type, and lookup pills per record.
  /* F176 — Render the soft-funding deadlines callout in the detail
     panel. Sourced from data/policy/soft-funding-status.json. Filters
     by county === "All" OR matching containing county. Sorted by next
     LOI deadline ascending. Urgency chips: red ≤30d, amber ≤60d. */
  function _renderDetailSoftFunding(op) {
    var host = $('lofDetailSoftFunding');
    if (!host) return;
    var progs = state.softFundingPrograms || {};
    var keys = Object.keys(progs);
    if (!keys.length) { host.innerHTML = ''; return; }

    var county = op && op.containingCounty;
    var rows = keys.map(function (k) {
      return Object.assign({ _key: k }, progs[k]);
    }).filter(function (p) {
      var c = (p.county || '').toString();
      return c === 'All' || c === '' || (county && c === county);
    });
    if (!rows.length) {
      host.innerHTML =
        '<h4 style="margin:14px 0 4px">Soft-funding programs</h4>' +
        '<p style="margin:0;color:var(--muted);font-size:.85rem">No statewide or county-matched soft-funding programs in scope. Verify against the live CDOLA / CHFA NOFA roster.</p>';
      return;
    }
    rows.sort(function (a, b) {
      var ad = a.loiDeadline || a.deadline || '9999-12-31';
      var bd = b.loiDeadline || b.deadline || '9999-12-31';
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });

    function _fmtDate(s) {
      if (!s) return '<span style="color:var(--muted)">—</span>';
      try {
        var d = new Date(s + 'T00:00:00Z');
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
      } catch (_) { return s; }
    }
    function _fmtMoney(n) {
      if (n == null) return '—';
      if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
      if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
      return '$' + n;
    }
    function _urgencyChip(date) {
      if (!date) return '';
      var t = new Date(date + 'T00:00:00Z').getTime();
      var days = Math.round((t - Date.now()) / (1000*60*60*24));
      if (days < 0) return '<span style="background:#94a3b822;color:#94a3b8;padding:0 5px;border-radius:8px;font-size:.65rem;font-weight:600;margin-left:5px">past</span>';
      if (days <= 30) return '<span style="background:#dc262622;color:#dc2626;padding:0 5px;border-radius:8px;font-size:.65rem;font-weight:600;margin-left:5px">≤ 30d</span>';
      if (days <= 60) return '<span style="background:#f59e0b22;color:#f59e0b;padding:0 5px;border-radius:8px;font-size:.65rem;font-weight:600;margin-left:5px">≤ 60d</span>';
      return '';
    }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    var bodyHtml = rows.map(function (r) {
      var compColor = r.competitiveness === 'high' ? '#dc2626' : (r.competitiveness === 'moderate' ? '#f59e0b' : '#0891b2');
      var compPill = r.competitiveness
        ? '<span style="background:' + compColor + '22;color:' + compColor + ';padding:0 6px;border-radius:8px;font-size:.7rem;font-weight:600;margin-left:6px">' + r.competitiveness + '</span>'
        : '';
      return '<div style="padding:.55rem .65rem;border-bottom:1px solid var(--border)">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:.5rem;flex-wrap:wrap">' +
          '<div><strong>' + esc(r.name || r._key) + '</strong>' + compPill +
            (r.adminEntity ? ' <span style="color:var(--muted);font-size:.7rem">· ' + esc(r.adminEntity) + '</span>' : '') +
          '</div>' +
          '<div style="font-size:.78rem;color:var(--muted)">' +
            'Avail ' + _fmtMoney(r.available) + ' · Max ' + _fmtMoney(r.maxPerProject) + '/project' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:3px;font-size:.78rem">' +
          '<span style="color:var(--muted)">LOI:</span> ' + _fmtDate(r.loiDeadline) + _urgencyChip(r.loiDeadline) +
          '<span style="margin:0 .5rem;color:var(--muted)">·</span>' +
          '<span style="color:var(--muted)">Application:</span> ' + _fmtDate(r.deadline) + _urgencyChip(r.deadline) +
        '</div>' +
        (r.contactUrl
          ? '<div style="margin-top:3px;font-size:.74rem"><a href="' + esc(r.contactUrl) + '" target="_blank" rel="noopener">Program details ↗</a></div>'
          : '') +
      '</div>';
    }).join('');

    host.innerHTML =
      '<h4 style="margin:14px 0 4px">Soft-funding programs · ' + esc(rows.length) + ' eligible</h4>' +
      '<p style="margin:0 0 .4rem;color:var(--muted);font-size:.78rem">Sorted by next LOI deadline. LOI is the threshold gate — most DOH programs require an LOI ~30–45 days before the full application closes. Click "Program details" for the live NOFA.</p>' +
      '<div style="border:1px solid var(--border);border-radius:6px;overflow:hidden">' +
        bodyHtml +
      '</div>';
  }

  /* F180 — QAP scoring runway. Statewide data from
     data/policy/chfa-awards-historical.json. Renders:
       - Target totals (high 82+ / moderate 74+ / low 65+) with a sample
         visualization
       - 6 scoring categories side-by-side with winners vs losers avg
         scores (the "where competitive deals pull away" view)
       - One-line explanation per category */
  function _renderDetailQap() {
    var host = $('lofDetailQap');
    if (!host) return;
    var sf = state.qapScoring;
    var sm = state.qapSummary;
    if (!sf || !sm) { host.innerHTML = ''; return; }

    function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function _pct(num, denom) {
      if (!denom) return 0;
      return Math.max(0, Math.min(100, Math.round((num / denom) * 100)));
    }

    var totalMaxPts = Object.keys(sf).reduce(function (s, k) { return s + (sf[k].maxPoints || 0); }, 0);
    var thresholds = sm.scoreThreshold || {};
    var avg = sm.avgScore || null;
    var med = sm.medianScore || null;

    // Sort categories by winners-vs-losers gap descending so the
    // highest-leverage scoring areas float to the top.
    var cats = Object.keys(sf).map(function (k) {
      var v = sf[k];
      var gap = (v.avgWinnersScore || 0) - (v.avgLoserScore || 0);
      return { key: k, def: v, gap: gap };
    }).sort(function (a, b) { return b.gap - a.gap; });

    // Threshold bar — a 100-point bar with markers at low/moderate/high
    // and the historical avg + median for context.
    function _markerLabel(x, label, accent) {
      return '<div style="position:absolute;left:' + x + '%;transform:translateX(-50%);top:-2px;font-size:.66rem;color:' + accent + ';font-weight:700;white-space:nowrap">' + label + '</div>' +
             '<div style="position:absolute;left:' + x + '%;transform:translateX(-50%);top:12px;width:1px;height:14px;background:' + accent + '"></div>';
    }
    var barHtml =
      '<div style="position:relative;height:36px;margin:.45rem 0 .85rem">' +
        '<div style="position:absolute;left:0;right:0;top:18px;height:6px;border-radius:3px;background:linear-gradient(90deg,#fecaca 0%,#fecaca 65%,#fde68a 65%,#fde68a 74%,#bbf7d0 82%,#bbf7d0 100%)"></div>' +
        (thresholds.lowLikelihood      ? _markerLabel(thresholds.lowLikelihood,      thresholds.lowLikelihood,      '#dc2626') : '') +
        (thresholds.moderateLikelihood ? _markerLabel(thresholds.moderateLikelihood, thresholds.moderateLikelihood, '#f59e0b') : '') +
        (thresholds.highLikelihood     ? _markerLabel(thresholds.highLikelihood,     thresholds.highLikelihood,     '#16a34a') : '') +
        (avg                            ? '<div style="position:absolute;left:' + avg + '%;transform:translateX(-50%);top:26px;font-size:.62rem;color:var(--muted)">avg ' + avg + '</div>' : '') +
      '</div>';

    var catsHtml = cats.map(function (c) {
      var v = c.def;
      var maxPts  = v.maxPoints || 0;
      var winners = v.avgWinnersScore || 0;
      var losers  = v.avgLoserScore || 0;
      var wPct = _pct(winners, maxPts);
      var lPct = _pct(losers, maxPts);
      return '<div style="padding:.5rem .65rem;border-bottom:1px solid var(--border)">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:.5rem">' +
          '<div>' +
            '<strong style="font-size:.86rem">' + esc(c.key) + '</strong>' +
            '<span style="color:var(--muted);font-size:.72rem;margin-left:.45rem">' + maxPts + ' pts max</span>' +
          '</div>' +
          '<div style="font-size:.72rem">' +
            '<span style="color:#16a34a;font-weight:700">' + winners.toFixed(1) + '</span>' +
            '<span style="color:var(--muted)"> winner vs </span>' +
            '<span style="color:#dc2626;font-weight:700">' + losers.toFixed(1) + '</span>' +
            '<span style="color:var(--muted)"> loser · gap ' + c.gap.toFixed(1) + '</span>' +
          '</div>' +
        '</div>' +
        // Mini bar: winners green over losers red, both scaled to maxPts.
        '<div style="position:relative;height:8px;margin:.3rem 0 .35rem;background:var(--bg2);border-radius:4px;overflow:hidden">' +
          '<div style="position:absolute;left:0;top:0;height:100%;width:' + lPct + '%;background:#dc262640"></div>' +
          '<div style="position:absolute;left:0;top:0;height:100%;width:' + wPct + '%;background:#16a34a;opacity:.7"></div>' +
        '</div>' +
        '<div style="font-size:.72rem;color:var(--muted);line-height:1.35">' + esc(v.description || '') + '</div>' +
      '</div>';
    }).join('');

    host.innerHTML =
      '<h4 style="margin:14px 0 4px">QAP scoring runway · what it takes to win</h4>' +
      '<p style="margin:0 0 .2rem;color:var(--muted);font-size:.78rem">Statewide thresholds from ' + sm.yearsAnalyzed?.[0] + '–' + (sm.yearsAnalyzed?.[sm.yearsAnalyzed.length-1] || '') +
      ' CHFA awards. Award rate ' + Math.round((sm.awardRate || 0) * 100) + '%. ' +
      'Total possible: ' + totalMaxPts + ' pts.</p>' +
      barHtml +
      '<div style="border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--bg)">' +
        catsHtml +
      '</div>' +
      '<p style="margin:.45rem 0 0;color:var(--muted);font-size:.72rem">' +
        '<strong>Reading:</strong> bars sorted by winner-vs-loser gap descending. ' +
        'The wider the gap, the more leverage there is in scoring well in that category. ' +
        '"' + esc(cats[0].key) + '" is the single biggest separator at ' + cats[0].gap.toFixed(1) + ' pts.' +
      '</p>';
  }

  function _renderCompSet(op) {
    var el = $('lofDetailCompSet');
    if (!el) return;
    if (op.centroidLat == null || op.centroidLng == null) {
      el.innerHTML = '<p style="color:var(--muted);font-size:.85rem">' +
        'No centroid available for this jurisdiction — cannot compute nearest comps.</p>';
      return;
    }
    el.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Loading comp set…</p>';
    if (!window.AffordableHousingLayer || !window.AffordableHousingLayer.loadProperties) {
      el.innerHTML = '<p style="color:var(--muted);font-size:.85rem">' +
        'AffordableHousingLayer not available — comp set requires the affordable-housing layer.</p>';
      return;
    }
    window.AffordableHousingLayer.loadProperties().then(function (props) {
      if (!Array.isArray(props) || !props.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:.85rem">' +
          'properties.json returned no records.</p>';
        return;
      }
      // Score every property by distance from the jurisdiction centroid.
      // Skip records with bad coords.
      var scored = [];
      for (var i = 0; i < props.length; i++) {
        var p = props[i];
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
        var dist = haversineMiles(op.centroidLat, op.centroidLng, p.lat, p.lng);
        if (dist == null) continue;
        scored.push({ p: p, miles: dist });
      }
      scored.sort(function (a, b) { return a.miles - b.miles; });
      var top = scored.slice(0, 5);
      if (!top.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:.85rem">' +
          'No properties with valid coords found in properties.json.</p>';
        return;
      }

      // Build the comp-set table. Per-row: distance, category badge
      // (from AffordableHousingLayer.CATEGORIES), name, city, units,
      // year, credit type, key program fact (PBV sunset / USDA expiry /
      // HUD subsidy / etc.).
      var AHL = window.AffordableHousingLayer;
      var PL  = window.PropertyLookup;
      function badgeFor(p) {
        var cat = AHL.categorize ? AHL.categorize(p) : null;
        if (!cat) return '';
        return '<span title="' + escHtml(cat.desc || cat.label) + '" tabindex="0" ' +
               'style="display:inline-flex;align-items:center;gap:3px;font-size:10px;' +
               'padding:1px 6px;border-radius:9px;cursor:help;font-weight:600;white-space:nowrap;' +
               'background:' + cat.color + '20;color:' + cat.color + ';' +
               'border:1px solid ' + cat.color + '60">' +
                 '<span style="width:5px;height:5px;border-radius:50%;background:' + cat.color + '"></span>' +
                 escHtml(cat.label) +
               '</span>';
      }
      function factFor(p) {
        if (p.pbv_contract_sunset)              return 'PBV sunsets ' + escHtml(p.pbv_contract_sunset);
        if (Number.isFinite(p.years_to_expiration)) {
          return p.years_to_expiration <= 5
            ? '⚠ expires in ' + p.years_to_expiration + 'y'
            : p.years_to_expiration + 'y to expiration';
        }
        if (p.subsidy_type && p.subsidy_type !== 'unknown') return escHtml(p.subsidy_type);
        return '';
      }

      var rows = top.map(function (s) {
        var p = s.p;
        var name = escHtml(p.property_name || 'Unnamed');
        var city = escHtml(p.city || '—');
        var units = p.total_units || p.assisted_units || 0;
        var year = p.year_placed_in_service || p.award_year || p.latest_year || '—';
        var credit = p.type_of_credits
          ? (PL ? PL.creditTypeTagHtml(p.type_of_credits) : escHtml(p.type_of_credits))
          : '—';
        var fact = factFor(p);
        var pmaBadge = s.miles <= 5
          ? '<span class="lof-pill lof-pill--accent">in 5mi PMA</span>'
          : s.miles <= 30
          ? '<span class="lof-pill">in 30mi rural PMA</span>'
          : '';
        var lookup = PL ? PL.htmlFor(p, { compact: true, hideLabel: true }) : '';
        return '<li style="padding:.5rem 0;border-bottom:1px solid var(--border)">' +
                 '<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:.4rem">' +
                   '<strong>' + s.miles.toFixed(1) + ' mi</strong>' +
                   badgeFor(p) +
                   '<strong>' + name + '</strong>' +
                   '<span style="opacity:.75">· ' + city + ' · ' + units + 'u · ' + year + '</span>' +
                   pmaBadge +
                 '</div>' +
                 '<div style="font-size:.78rem;margin-top:.15rem">' +
                   '<span style="opacity:.65">Credit:</span> ' + credit +
                   (fact ? ' &nbsp; <span style="opacity:.65">·</span> ' + fact : '') +
                 '</div>' +
                 lookup +
               '</li>';
      }).join('');

      var mfHtml = window.MethodFooter ? window.MethodFooter.html({
        sources: [
          // F254 — co.chfainfo.com is not a valid CHFA domain. These are the
          // actual CHFA ArcGIS FeatureServer endpoints (return JSON when hit
          // in a browser; clearly authoritative).
          { label: 'CHFA LIHTC (live ArcGIS)',                url: 'https://services3.arcgis.com/gSW3qyxbcpEXSMfe/arcgis/rest/services/HousingTaxCreditProperties_view/FeatureServer/0' },
          { label: 'CHFA Preservation (live ArcGIS)',          url: 'https://services3.arcgis.com/gSW3qyxbcpEXSMfe/arcgis/rest/services/PreservationProperties_Layer_Final_view_new/FeatureServer/0' },
          { label: 'HUD MULTIFAMILY_PROPERTIES_ASSISTED',     url: 'https://hudgis-hud.opendata.arcgis.com/' },
          { label: 'USDA Rural Housing Assets',               url: 'https://www.rd.usda.gov/' },
          { label: 'Local PHA roster (curated)',              url: 'https://github.com/pggLLC/Housing-Analytics/tree/main/data/affordable-housing/local-pha-roster' }
        ],
        vintage:    'live CHFA + HUD; curated PHA roster 2026-06',
        method:     '5 nearest deduped affordable-housing records to jurisdiction centroid by great-circle distance. Categorized + color-coded by program. CHFA standard PMA is 5 mi urban / up to 30 mi rural.',
        confidence: 'high'
      }) : '';

      el.innerHTML =
        '<p style="font-size:.82rem;color:var(--muted);margin:.2rem 0 .5rem">' +
          'Drawn from the unified affordable-housing dataset (LIHTC + Preservation + HUD MF + USDA RD + PBV-local), deduped by name+city. ' +
          'Use this as the IC-packet comp set; cross-reference with sales comps from a broker.' +
        '</p>' +
        '<ul style="list-style:none;padding-left:0;margin:0">' + rows + '</ul>' +
        mfHtml;

      // Re-decorate the new external links with stale-link tools
      if (window.ReportStaleLink) {
        window.ReportStaleLink.decorateAnchors(el, { context: 'comp-set:' + (op.placeGeoid || '') });
      }
    }).catch(function (e) {
      console.warn('[OF compSet] load failed', e);
      el.innerHTML = '<p style="color:var(--muted);font-size:.85rem">' +
        'Comp set unavailable: ' + escHtml(e && e.message || 'fetch error') + '</p>';
    });
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
      // F253 — stable tie-breaker. Without this, two jurisdictions with
      // identical scores (common for rural towns with 0 LIHTC projects →
      // recencyScore = 100) could swap positions across refreshes,
      // making users perceive "rankings keep changing." Tie-break by
      // jurisdiction GEOID ascending so the order is fully deterministic.
      var ga = a.placeGeoid || a.id || a.name || '';
      var gb = b.placeGeoid || b.id || b.name || '';
      if (ga < gb) return -1;
      if (ga > gb) return  1;
      return 0;
    });
  }

  /* ── Refresh ──────────────────────────────────────────────────────── */

  function _refresh() {
    // F255 — persist current filter state to localStorage on every
    // refresh. Survives page reload / back-forward navigation.
    _persistFilters();
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
    // F255 — Sync DOM controls FROM state.filters (which may have been
    // populated by _restoreFilters() in init). Runs BEFORE listeners are
    // attached so the initial values reflect the saved state. Each
    // control has a defensive null-guard because partial state restores
    // (forward-compat with future filter dims) might miss some.
    function _syncDomFromState() {
      var f = state.filters;
      var el;
      el = document.getElementById('lofTargetSelect');
      if (el && f.target) el.value = f.target;
      // Basis is a radio group
      var basisRadio = document.querySelector('input[name="lofBasis"][value="' + f.basis + '"]');
      if (basisRadio) basisRadio.checked = true;
      el = document.getElementById('lofCounty');
      if (el) el.value = f.county || '';
      el = document.getElementById('lofRegion');
      if (el) el.value = f.region || '';
      el = document.getElementById('lofMinYearsSince');
      if (el) { el.value = f.minYearsSince || 0;
        var lab = document.getElementById('lofMinYearsSinceVal');
        if (lab) lab.textContent = String(f.minYearsSince || 0);
      }
      el = document.getElementById('lofMinScore');
      if (el) { el.value = f.minScore || 0;
        var lab2 = document.getElementById('lofMinScoreVal');
        if (lab2) lab2.textContent = String(f.minScore || 0);
      }
      el = document.getElementById('lofMinPop');
      if (el) el.value = f.minPop || 0;
      el = document.getElementById('lofMinPreservation');
      if (el) { el.value = f.minPreservation || 0;
        var lab3 = document.getElementById('lofMinPreservationVal');
        if (lab3) lab3.textContent = String(f.minPreservation || 0);
      }
      el = document.getElementById('lofPresUrgent');
      if (el) el.checked = !!f.onlyUrgentPres;
      el = document.getElementById('lofIncludeCdps');
      if (el) el.checked = !!f.includeCdps;
      el = document.getElementById('lofRequireCapture');
      if (el) el.checked = !!f.requireCapture;
      el = document.getElementById('lofRequireRedev');
      if (el) el.checked = !!f.requireRedev;
      el = document.getElementById('lofSearch');
      if (el) el.value = f.searchText || '';
    }
    _syncDomFromState();

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
        // F236 — Re-build the Scenario Builder UI for the new target
        // (loads its saved custom mix or shows preset defaults).
        _scenarioBuilderRebuild();
        _refresh();
      });
    } else {
      var targetRadios = document.querySelectorAll('input[name="lofTarget"]');
      targetRadios.forEach(function (r) {
        r.addEventListener('change', function () {
          if (r.checked) {
            state.filters.target = r.value;
            _scenarioBuilderRebuild();
            _refresh();
          }
        });
      });
    }

    // F236 — Scenario Builder initial mount
    _scenarioBuilderInit();

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

    // F251 — Jurisdiction name search input. Debounce 150ms so we don't
    // re-filter the 482-row table on every keystroke. Cleared input
    // returns to the no-filter state.
    var searchInput = $('lofSearch');
    if (searchInput) {
      var searchDebounceTimer = null;
      searchInput.addEventListener('input', function (e) {
        var v = (e.target.value || '').trim();
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(function () {
          state.filters.searchText = v;
          _refresh();
        }, 150);
      });
      // Submit/enter handler — apply immediately (skip debounce)
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
          state.filters.searchText = (e.target.value || '').trim();
          _refresh();
        }
      });
    }

    // F240 — Downtown redev filter handler. If the redev data isn't loaded
    // yet, trigger the lazy-fetch so subsequent ops carry hasUra / ozCount.
    // F244 audit fix: skip the synchronous refresh when data isn't yet in
    // and the filter is ON — otherwise the table flashes empty for ~200ms.
    // Render only after stamping completes.
    var requireRedev = $('lofRequireRedev');
    if (requireRedev) {
      requireRedev.addEventListener('change', function () {
        state.filters.requireRedev = requireRedev.checked;
        var dataReady = (_redev.ura && _redev.oz);
        if (state.filters.requireRedev && !dataReady) {
          setStatus('Loading downtown redevelopment data…');
          _loadRedevData(function () {
            _stampRedevOnOps();
            _refresh();
          });
          return;
        }
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
        requireCapture: true,   // F13: ON by default (was false)
        requireRedev: false,    // F240: OFF by default
        searchText: ''          // F251: clear search input
      };
      if (requireRedev) requireRedev.checked = false;
      if (searchInput) searchInput.value = '';
      // F255 — Reset also clears the localStorage cache so a refresh
      // returns to fully default filter state instead of restoring the
      // pre-reset snapshot.
      _clearPersistedFilters();
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

    // F100 — Decorative county + place + CDP boundary overlay.
    // Counties are always visible (subtle slate-600 outlines, no fill).
    // Place outlines kick in at zoom 9, CDPs at zoom 10. Sits beneath
    // QCT/DDA/LIHTC overlays in z-order so it never obscures markers.
    if (window.JurisdictionBoundaries) {
      try {
        window.JurisdictionBoundaries.attach(state.map, {
          showCounties: true,
          showPlaces:   true,
          showCdps:     true,
          placesMinZoom: 9,
          cdpsMinZoom:   10,
        });
      } catch (e) { console.warn('[of] jurisdiction boundaries attach failed', e); }
    }

    // F119 — All affordable housing properties color-coded by program.
    // (No legend on OF — the existing OF marker legend is per-jurisdiction
    // score, layering a second legend would be cluttered.)
    if (window.AffordableHousingLayer) {
      try { window.AffordableHousingLayer.attach(state.map, { showLegend: false }); }
      catch (e) { console.warn('[of] affordable housing layer attach failed', e); }
    }
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

    // ── F242: Opportunity Zones (teal fill, OFF by default) ────────────
    // 2018 designations — permanent. Federal capital-gains deferral via
    // Qualified Opportunity Fund equity. Stacks with LIHTC + state credit.
    // Created OFF by default since users typically want QCT + DDA visible
    // first; OZ surfaces when they toggle it on (or via F240 redev filter).
    var ozLayer = window.L.layerGroup();
    state.layers.oz = ozLayer;
    overlays['Opportunity Zones (teal, OZ)'] = ozLayer;
    fetch('data/market/opportunity_zones_co.geojson')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (ozFc) {
        if (!ozFc || !ozFc.features) return;
        // Cache in _redev.oz so F236 detail panel + F240 filter share it
        _redev.oz = ozFc;
        ozFc.features.forEach(function (f) {
          var rings = _geomToLeafletRings(f.geometry);
          if (!rings) return;
          var p = (f.properties || {});
          if (p.designated === false) return;
          var poly = window.L.polygon(rings, {
            color: '#0d9488', weight: 1.0, fillColor: '#5eead4',
            fillOpacity: 0.22, opacity: 0.75, interactive: true
          });
          poly.bindTooltip('OZ tract ' + escHtml(p.geoid || '—') + ' · ' +
            'federal capital-gains deferral · stacks with LIHTC + state credit (2018 designation, permanent)',
            { sticky: true });
          ozLayer.addLayer(poly);
        });
        // Trigger any pending op stamping now that OZ data is in
        _stampRedevOnOps();
      })
      .catch(function (err) {
        console.warn('[OF] OZ overlay fetch failed:', err);
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
      // F184 — site-wide policy: collapsibles default-collapsed regardless
      // of viewport. (F27 had this collapse only on mobile.)
      div.className += ' is-collapsed';
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

  /* ── Public API (F213) ────────────────────────────────────────────
     The F203 cross-page banner uses `window.__LOF.showByGeoid(geoid)` to
     surface the active WorkflowState jurisdiction in the OF table after
     data load. Match by placeGeoid first (places) then by 5-digit FIPS
     prefix (counties). Returns true on success, false if no match. */
  window.__LOF = {
    showByGeoid: function (geoid) {
      var g = String(geoid || '').replace(/\D/g, '');
      if (!g || !state.opportunities || !state.opportunities.length) return false;
      var op = state.opportunities.find(function (o) {
        if (o.placeGeoid && o.placeGeoid === g) return true;
        if (o.containingCounty && o.containingCounty === g) return true;
        return false;
      });
      if (!op) return false;
      _showDetail(op.id);
      return true;
    }
  };

  /* ── Boot ─────────────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', function () {
    _initMap();
    loadAll()
      .then(function () {
        _computeOpportunities();
        // F255 — Restore saved filters BEFORE populating dropdowns or
        // wiring the inputs, so the restored values land in DOM during
        // the populate/wire pass instead of getting overwritten by it.
        _restoreFilters();
        _populateFilterDropdowns();
        _wireFilters();
        _initMapOverlays();
        // F240/F241: eagerly load URA + adaptive-reuse data so the filter +
        // civic boost are immediately available without waiting for first
        // detail click. OZ data is loaded by _initMapOverlays() above.
        _loadRedevData(function () { _stampRedevOnOps(); _refresh(); });
        setStatus('Ranked ' + state.opportunities.length +
          ' Colorado jurisdictions with QCT and/or DDA designations · click a row for project history.');
        _refresh();
      })
      .catch(function (err) {
        console.error('[LIHTC Opportunity Finder] load failed:', err);
        setStatus('Failed to load data: ' + (err && err.message || err));
      });
  });

  /* ─── F236: Scenario Builder ─────────────────────────────────────
     User-adjustable overrides on the 5 component weights + the recency
     signal source. Per-target preset (so a 4% custom mix doesn't leak
     to 9%). Saves to localStorage. Diff row shows exactly what the
     user changed vs the preset.
  ────────────────────────────────────────────────────────────────── */
  var SB_WEIGHT_KEYS = ['need', 'recency', 'basis', 'pop', 'civic'];
  var SB_RECENCY_LABELS = {
    smart:        'Smart (preset default)',
    generic:      'Any LIHTC',
    '9pct':       '9% Comp only',
    '4pct':       '4% only',
    state_credit: 'State credit only',
    competitive:  'Competitive pool',
  };

  function _scenarioBuilderInit() {
    var det = document.getElementById('lofScenarioBuilder');
    if (!det) return;
    _scenarioBuilderRebuild();
    // Reset button
    var resetBtn = document.getElementById('lofSbReset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        var t = state.filters.target;
        var all = _loadScenarios();
        delete all[t];
        _saveScenarios(all);
        state.customScenario = null;
        _scenarioBuilderRebuild();
        _refresh();
      });
    }
    // Recency source picker
    var srcEl = document.getElementById('lofSbRecencySource');
    if (srcEl) {
      srcEl.addEventListener('change', function () {
        _scenarioApplyFromUI();
      });
    }
  }

  function _scenarioBuilderRebuild() {
    var det = document.getElementById('lofScenarioBuilder');
    if (!det) return;
    var t = state.filters.target;
    var preset = SCORE_WEIGHTS[t] || SCORE_WEIGHTS.any;
    // Multiply preset (0..1 fractions) by 100 so the sliders work in
    // whole-percentage units that sum to 100.
    var presetPct = {
      need:    Math.round(preset.need    * 100),
      recency: Math.round(preset.recency * 100),
      basis:   Math.round(preset.basis   * 100),
      pop:     Math.round(preset.pop     * 100),
      civic:   Math.round(preset.civic   * 100),
    };
    // Load any saved scenario for this target.
    var saved = _loadScenarios()[t];
    var current;
    if (saved && saved.weights) {
      current = saved;
    } else {
      current = { target: t, weights: presetPct, recencySource: 'smart' };
    }
    // Push to state — _activeScore() reads state.customScenario when
    // it matches the active target preset.
    var isCustom = _scenarioIsCustom(current, presetPct);
    state.customScenario = isCustom ? current : null;
    // Build slider rows
    var weightsHost = document.getElementById('lofSbWeights');
    if (weightsHost) {
      weightsHost.innerHTML = '';
      SB_WEIGHT_KEYS.forEach(function (k) {
        var row = document.createElement('div');
        row.className = 'lof-sb-weight';
        var lbl = document.createElement('label');
        lbl.textContent = _capitalize(k);
        var range = document.createElement('input');
        range.type = 'range';
        range.min = 0;
        range.max = 80;
        range.value = current.weights[k];
        range.setAttribute('data-w', k);
        range.addEventListener('input', function () {
          _scenarioOnSliderInput(k, +range.value);
        });
        var val = document.createElement('span');
        val.className = 'lof-sb-val';
        var presetDelta = current.weights[k] - presetPct[k];
        var deltaCls = presetDelta > 0 ? 'lof-sb-delta--up' : presetDelta < 0 ? 'lof-sb-delta--down' : '';
        var deltaText = presetDelta === 0 ? '' : (presetDelta > 0 ? '+' + presetDelta : presetDelta);
        val.innerHTML = current.weights[k] + '%' +
          (presetDelta !== 0 ? '<span class="lof-sb-delta ' + deltaCls + '">' + deltaText + ' vs preset</span>' : '');
        row.appendChild(lbl);
        row.appendChild(range);
        row.appendChild(val);
        weightsHost.appendChild(row);
      });
    }
    // Sync recency picker
    var srcEl = document.getElementById('lofSbRecencySource');
    if (srcEl) srcEl.value = current.recencySource || 'smart';
    // Active/diff visuals
    det.setAttribute('data-active', isCustom ? 'true' : 'false');
    _scenarioUpdateDiff(current, presetPct);
  }

  function _scenarioOnSliderInput(changedKey, newPct) {
    // Auto-rebalance: keep sum = 100 by distributing the delta across
    // the other 4 sliders, weighted by their CURRENT proportions.
    var t = state.filters.target;
    var preset = SCORE_WEIGHTS[t] || SCORE_WEIGHTS.any;
    var presetPct = {
      need: Math.round(preset.need * 100),
      recency: Math.round(preset.recency * 100),
      basis: Math.round(preset.basis * 100),
      pop: Math.round(preset.pop * 100),
      civic: Math.round(preset.civic * 100),
    };
    var current = (state.customScenario && state.customScenario.target === t)
      ? Object.assign({}, state.customScenario.weights)
      : Object.assign({}, presetPct);
    var oldVal = current[changedKey];
    var delta = newPct - oldVal;
    current[changedKey] = newPct;
    // Distribute -delta across the others proportionally.
    var otherKeys = SB_WEIGHT_KEYS.filter(function (k) { return k !== changedKey; });
    var otherSum = otherKeys.reduce(function (s, k) { return s + current[k]; }, 0);
    if (otherSum > 0) {
      var remaining = -delta;
      otherKeys.forEach(function (k, i) {
        if (i === otherKeys.length - 1) {
          current[k] = Math.max(0, current[k] + remaining);
        } else {
          var share = Math.round(current[k] / otherSum * -delta);
          current[k] = Math.max(0, current[k] + share);
          remaining -= share;
        }
      });
    }
    // Normalize so sum is exactly 100 (rounding drift)
    var sum = SB_WEIGHT_KEYS.reduce(function (s, k) { return s + current[k]; }, 0);
    if (sum !== 100) current[changedKey] = Math.max(0, current[changedKey] + (100 - sum));
    // Apply
    var srcEl = document.getElementById('lofSbRecencySource');
    var src = srcEl ? srcEl.value : 'smart';
    var scenario = { target: t, weights: current, recencySource: src };
    var all = _loadScenarios();
    all[t] = scenario;
    _saveScenarios(all);
    state.customScenario = _scenarioIsCustom(scenario, presetPct) ? scenario : null;
    _scenarioBuilderRebuild();
    _refresh();
  }

  function _scenarioApplyFromUI() {
    var t = state.filters.target;
    var preset = SCORE_WEIGHTS[t] || SCORE_WEIGHTS.any;
    var presetPct = {
      need: Math.round(preset.need * 100),
      recency: Math.round(preset.recency * 100),
      basis: Math.round(preset.basis * 100),
      pop: Math.round(preset.pop * 100),
      civic: Math.round(preset.civic * 100),
    };
    var current = (state.customScenario && state.customScenario.target === t)
      ? Object.assign({}, state.customScenario.weights)
      : Object.assign({}, presetPct);
    var srcEl = document.getElementById('lofSbRecencySource');
    var src = srcEl ? srcEl.value : 'smart';
    var scenario = { target: t, weights: current, recencySource: src };
    var all = _loadScenarios();
    all[t] = scenario;
    _saveScenarios(all);
    state.customScenario = _scenarioIsCustom(scenario, presetPct) ? scenario : null;
    _scenarioBuilderRebuild();
    _refresh();
  }

  function _scenarioIsCustom(scenario, presetPct) {
    if (!scenario || !scenario.weights) return false;
    if (scenario.recencySource && scenario.recencySource !== 'smart') return true;
    return SB_WEIGHT_KEYS.some(function (k) {
      return scenario.weights[k] !== presetPct[k];
    });
  }

  function _scenarioUpdateDiff(current, presetPct) {
    var diffEl = document.getElementById('lofSbDiff');
    if (!diffEl) return;
    var diffs = [];
    SB_WEIGHT_KEYS.forEach(function (k) {
      var d = current.weights[k] - presetPct[k];
      if (d !== 0) diffs.push(_capitalize(k) + ' ' + (d > 0 ? '+' : '') + d);
    });
    var srcChanged = current.recencySource && current.recencySource !== 'smart';
    var srcLabel = srcChanged ? SB_RECENCY_LABELS[current.recencySource] : null;
    if (!diffs.length && !srcChanged) {
      diffEl.hidden = true;
      diffEl.innerHTML = '';
      return;
    }
    diffEl.hidden = false;
    var html = '<strong>Custom mix:</strong> ';
    if (diffs.length) html += diffs.join(', ');
    if (srcChanged) html += (diffs.length ? ' · ' : '') + 'Recency source: <strong>' + srcLabel + '</strong>';
    diffEl.innerHTML = html;
  }

  function _capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
}());
