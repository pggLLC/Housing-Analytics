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
      basis: 'both',
      county: '',
      region: '',         // '' | 'Front Range' | 'Mountains' | 'Western Slope' | 'Southwest' | 'San Luis Valley' | 'Eastern Plains'
      minYearsSince: 0,
      minScore: 0,
      minPop: 0,
      minPreservation: 0,    // # preservation candidates required in jurisdiction
      onlyUrgentPres: false, // require >=1 USDA RD property expiring ≤5y
      includeCdps: false  // CDPs aren't incorporated; LIHTC typically goes in incorporated places
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

  var SCORE_WEIGHTS = {
    '9pct':              { need: 0.30, recency: 0.30, basis: 0.15, pop: 0.15, civic: 0.10 },
    '4pct':              { need: 0.25, recency: 0.15, basis: 0.15, pop: 0.30, civic: 0.15 },
    'preservation':      { need: 0.20, recency: 0.15, basis: 0.35, pop: 0.10, civic: 0.20 },
    'workforce_resort':  { need: 0.25, recency: 0.15, basis: 0.15, pop: 0.30, civic: 0.15 },
    'prop123_local':     { need: 0.25, recency: 0.10, basis: 0.20, pop: 0.15, civic: 0.30 },
    'any':               { need: 0.25, recency: 0.20, basis: 0.15, pop: 0.20, civic: 0.20 }
  };

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

  function compositeScore(rec, need, basis, pop, civic, target) {
    var w = SCORE_WEIGHTS[target] || SCORE_WEIGHTS.any;
    // civic may be null when no scorecard record exists — treat as 0
    var civicVal = Number.isFinite(civic) ? civic : 0;
    return Math.round(
      rec * w.recency + need * w.need + basis * w.basis +
      pop * w.pop + civicVal * w.civic
    );
  }

  /* ── Data loading ─────────────────────────────────────────────────── */

  function loadAll() {
    setStatus('Loading jurisdiction data (HUD QCT, DDA, LIHTC, CHAS, place memberships, civic capacity)…');
    // Some of these are non-critical (civic-capacity layers) — wrap each in
    // a catch so a missing/malformed file doesn't break the whole page.
    function loadSoft(url) {
      return fetch(url)
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    function loadFirstJson(urls) {
      var i = 0;
      function next() {
        if (i >= urls.length) {
          throw new Error('Unable to load any of: ' + urls.join(', '));
        }
        var url = urls[i++];
        return fetch(url)
          .then(function (r) {
            if (!r.ok) throw new Error(url + ' returned ' + r.status);
            return r.json();
          })
          .catch(next);
      }
      return next();
    }
    return Promise.all([
      fetch('data/qct-colorado.json').then(function (r) { return r.json(); }),
      fetch('data/dda-colorado.json').then(function (r) { return r.json(); }),
      loadFirstJson(['data/chfa-lihtc.json', 'data/market/hud_lihtc_co.geojson']),
      fetch('data/hna/chas_affordability_gap.json').then(function (r) { return r.json(); }),
      fetch('data/hna/place-tract-membership.json').then(function (r) { return r.json(); }),
      fetch('data/co_ami_gap_by_place.json').then(function (r) { return r.json(); }),
      fetch('data/hna/geo-config.json').then(function (r) { return r.json(); }),
      loadSoft('data/policy/housing-policy-scorecard.json'),
      loadSoft('data/hna/local-resources.json'),
      loadSoft('data/policy/prop123_jurisdictions.json'),
      loadSoft('data/market/tract_centroids_co.json'),
      loadSoft('data/hna/ranking-index.json'),
      loadSoft('data/co-county-boundaries.json'),
      loadSoft('data/affordable-housing/properties.json')
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

      // Also derive a {fips → centroid} map from the county polygons.
      // The tract_centroids_co.json file is unreliable (Appendix A.2
      // of repo audit — tract GEOIDs paired with wrong tracts' coords),
      // so we use county centroids as the marker anchor instead.
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

      // Compute score for each target — we'll use the active one in the table
      var score9            = compositeScore(recScore, needPct, bbScore, popScore, civicScoreForComposite, '9pct');
      var score4            = compositeScore(recScore, needPct, bbScore, popScore, civicScoreForComposite, '4pct');
      var scorePreservation = compositeScore(recScore, needPct, bbScore, popScore, civicScoreForComposite, 'preservation');
      var scoreWorkforce    = compositeScore(recScore, needPct, bbScore, popScore, civicScoreForComposite, 'workforce_resort');
      var scoreProp123      = compositeScore(recScore, needPct, bbScore, popScore, civicScoreForComposite, 'prop123_local');
      var scoreAny          = compositeScore(recScore, needPct, bbScore, popScore, civicScoreForComposite, 'any');

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
      if (inside.length) {
        var coords = inside[0].geometry && inside[0].geometry.coordinates;
        if (coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
          centroidLng = coords[0]; centroidLat = coords[1];
        }
      }
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
      return true;
    });
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  function _scoreBand(score) {
    if (score >= 70) return 'high';
    if (score >= 50) return 'med';
    return 'low';
  }

  function _renderSummary(filtered) {
    var n = filtered.length;
    var neverFunded = filtered.filter(function (op) { return op.lastYear == null; }).length;
    var withQctAndDda = filtered.filter(function (op) { return op.hasBoth; }).length;
    var avgScore = n ? Math.round(filtered.reduce(function (s, op) { return s + _activeScore(op); }, 0) / n) : 0;
    var top = filtered[0];
    var TARGET_LABELS = {
      '9pct':             '9% Competitive',
      '4pct':             '4% Bond',
      'preservation':     'Preservation',
      'workforce_resort': 'Workforce / Resort',
      'prop123_local':    'Prop 123 / Local',
      'any':              'Balanced (any)'
    };
    var TARGET_WEIGHTS_DESC = {
      '9pct':             'need 30 · rec 30 · basis 15 · pop 15 · civic 10',
      '4pct':             'need 25 · rec 15 · basis 15 · pop 30 · civic 15',
      'preservation':     'need 20 · rec 15 · basis 35 · pop 10 · civic 20',
      'workforce_resort': 'need 25 · rec 15 · basis 15 · pop 30 · civic 15',
      'prop123_local':    'need 25 · rec 10 · basis 20 · pop 15 · civic 30',
      'any':              'need 25 · rec 20 · basis 15 · pop 20 · civic 20'
    };
    var targetLabel = TARGET_LABELS[state.filters.target] || 'Balanced (any)';
    var weightsDesc = TARGET_WEIGHTS_DESC[state.filters.target] || TARGET_WEIGHTS_DESC.any;
    var html =
      '<div class="lof-summary-card"><div class="k">Target deal type</div>' +
        '<div class="v" style="font-size:.95rem;line-height:1.25">' + targetLabel + '</div>' +
        '<div class="s">' + weightsDesc + '</div></div>' +
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

  function _renderTable(filtered) {
    var tbody = $('lofTableBody');
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="lof-loading">No jurisdictions match the current filters.</td></tr>';
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
      return '<tr data-op-id="' + escHtml(op.id) + '" class="' + selectedCls.trim() + '">' +
        '<td><span class="lof-score-cell ' + scoreCls + '">' + activeScore + '</span></td>' +
        '<td><strong>' + escHtml(op.name) + '</strong>' +
          ' <a href="' + escHtml(hnaUrlForPlace(op.placeGeoid)) + '" ' +
            'target="_blank" rel="noopener" class="lof-hna-link" ' +
            'title="Open Housing Needs Assessment for ' + escHtml(op.name) + '" ' +
            'aria-label="Open Housing Needs Assessment for ' + escHtml(op.name) + ' in new tab" ' +
            'onclick="event.stopPropagation()">→ HNA</a>' +
          '<div style="font-size:.72rem;color:var(--muted);text-transform:capitalize">' + escHtml(op.type) + '</div></td>' +
        '<td>' + typeHtml + (op.qctCount > 1 ? '<span style="font-size:.7rem;color:var(--muted);margin-left:4px">×' + op.qctCount + '</span>' : '') + '</td>' +
        '<td>' + escHtml(op.countyName) + '</td>' +
        '<td>' + lastFundedText + '</td>' +
        '<td>' + op.projectCount + (op.totalUnits ? ' <span style="color:var(--muted);font-size:.72rem">(' + fmtInt(op.totalUnits) + ' u)</span>' : '') + '</td>' +
        '<td>' + (op.needScore != null ? op.needScore : '—') + '<span style="font-size:.7rem;color:var(--muted)">p</span></td>' +
        '<td>' + (op.population != null ? fmtInt(op.population) : '—') + '</td>' +
        '<td>' + _civicCell(op) + '</td>' +
        '<td style="font-size:.72rem;color:var(--muted)">9%·' + op.score9 + ' · 4%·' + op.score4 + '</td>' +
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
      planRows + haRows + advRows;
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

  function _showDetail(opId) {
    var op = state.opportunities.find(function (x) { return x.id === opId; });
    if (!op) return;
    state.selectedId = opId;
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
      // Build compare-with link: pre-populated with this jurisdiction + the
      // top-3 other jurisdictions in the same region (excluding self).
      var sameRegion = state.opportunities
        .filter(function (o) { return o.region === op.region && o.id !== op.id; })
        .sort(function (a, b) { return _activeScore(b) - _activeScore(a); })
        .slice(0, 3)
        .map(function (o) { return o.placeGeoid; });
      var compareIds = [op.placeGeoid].concat(sameRegion).join(',');
      var compareHref = 'compare.html?jurisdictions=' + encodeURIComponent(compareIds) +
        '&target=' + encodeURIComponent(state.filters.target);

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
          '⚖️ Compare with peers' +
        '</a>';
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
      '<dt>Last LIHTC project</dt><dd>' + (op.lastYear != null
        ? op.lastYear + ' (' + op.yearsSince + ' years ago)'
        : '<em>Never funded on record</em>') + '</dd>' +
      '<dt>Existing LIHTC stock</dt><dd>' + op.projectCount + ' project(s) · ' +
        fmtInt(op.totalUnits) + ' total units' +
        (op.lihtcStatePaired > 0 ? ' · <span class="lof-pill">' + op.lihtcStatePaired + ' Prop 123 / state-paired</span>' : '') +
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
        case 'civicScore':    return op.civicScore == null ? -1 : op.civicScore;
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
    var filtered = _sortOps(_applyFilters());
    _renderSummary(filtered);
    _renderTable(filtered);
    _renderMap(filtered);
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

    $('lofCounty').addEventListener('change', function (e) {
      state.filters.county = e.target.value; _refresh();
    });

    var regionEl = $('lofRegion');
    if (regionEl) {
      regionEl.addEventListener('change', function (e) {
        state.filters.region = e.target.value;
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

    $('lofResetFilters').addEventListener('click', function () {
      state.filters = {
        target: '9pct',
        basis: 'both',
        county: '', region: '', minYearsSince: 0, minScore: 0, minPop: 0,
        minPreservation: 0, onlyUrgentPres: false,
        includeCdps: false
      };
      if (minPres) { minPres.value = 0; if (minPresVal) minPresVal.textContent = '0'; }
      if (presUrgent) presUrgent.checked = false;
      var ts = $('lofTargetSelect');
      if (ts) { ts.value = '9pct'; }
      else {
        var r = document.querySelector('input[name="lofTarget"][value="9pct"]');
        if (r) r.checked = true;
      }
      var bothRadio = document.querySelector('input[name="lofBasis"][value="both"]');
      if (bothRadio) bothRadio.checked = true;
      if (includeCdps) includeCdps.checked = false;
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
      var poly = window.L.polygon(rings, {
        color: '#3b82f6', weight: 1.2, fillColor: '#3b82f6',
        fillOpacity: 0.10, opacity: 0.60, interactive: true
      });
      poly.bindTooltip('DDA: ' + escHtml(name) + ' County · 30% basis boost', { sticky: true });
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
    fetch('data/qct-colorado.json').then(function (r) { return r.json(); }).then(function (qctFc) {
      (qctFc.features || []).forEach(function (f) {
        var rings = _geomToLeafletRings(f.geometry);
        if (!rings) return;
        var geoid = f.properties && f.properties.GEOID;
        var poly = window.L.polygon(rings, {
          color: '#f97316', weight: 0.6, fillColor: '#f97316',
          fillOpacity: 0.12, opacity: 0.55, interactive: true
        });
        if (geoid) poly.bindTooltip('QCT: tract ' + escHtml(geoid) + ' · 30% basis boost', { sticky: true });
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
        radius: 3.5,
        color: '#fff',
        weight: 0.8,
        fillColor: color,
        fillOpacity: 0.85
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

    // ── Layer control + legend ──────────────────────────────────────────
    window.L.control.layers(
      state._baseLayers,
      overlays,
      { position: 'topright', collapsed: true }
    ).addTo(state.map);

    // Permanent legend bottom-right explaining marker + polygon colors.
    var legend = window.L.control({ position: 'bottomright' });
    legend.onAdd = function () {
      var div = window.L.DomUtil.create('div', 'lof-map-legend');
      div.innerHTML =
        '<div class="lof-legend-title">Map legend</div>' +
        '<div class="lof-legend-row"><span class="lof-legend-sw" style="background:#f97316;opacity:.5"></span>QCT tract (30% basis boost)</div>' +
        '<div class="lof-legend-row"><span class="lof-legend-sw" style="background:#3b82f6;opacity:.5"></span>DDA county (30% basis boost)</div>' +
        '<div class="lof-legend-row"><span class="lof-legend-dot" style="background:#16a34a"></span>9% LIHTC project</div>' +
        '<div class="lof-legend-row"><span class="lof-legend-dot" style="background:#2563eb"></span>4% LIHTC project</div>' +
        '<div class="lof-legend-row"><span class="lof-legend-dot" style="background:#9333ea"></span>State / MIHTC paired</div>' +
        '<div class="lof-legend-row"><span class="lof-legend-jur" style="background:#16a34a"></span>Jurisdiction (sized by score)</div>';
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
