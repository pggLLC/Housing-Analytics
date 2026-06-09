/**
 * js/compare.js — Compare Jurisdictions page controller.
 *
 * Loads the same data as the Opportunity Finder (CHFA LIHTC, QCT, DDA,
 * CHAS, policy scorecard, affordable-housing properties), computes the
 * SAME 5-dimension scoring math (need / recency / basis / pop / civic),
 * and renders a side-by-side comparison table for 2–6 user-picked
 * jurisdictions.
 *
 * URL params:
 *   ?jurisdictions=0851690,0874815,0818750   (comma-separated 7-digit place GEOIDs)
 *   ?target=9pct|4pct|preservation|workforce_resort|prop123_local|any
 *
 * Re-uses the public scoring helpers from lihtc-opportunity-finder.js
 * where possible; falls back to local copies of the formulas otherwise
 * (the OF module is an IIFE without a clean export surface — that's
 * audit P0-1 backlog).
 */

(function () {
  'use strict';

  /* ── Config (mirror of OF) ────────────────────────────────────────── */
  // F9 (2026-05-26): civic re-weighted on 9pct/4pct/workforce_resort + new
  // CDP_PENALTY. Must match SCORE_WEIGHTS in js/lihtc-opportunity-finder.js
  // exactly — both consumers compute the same composite for the same
  // jurisdiction (verified by the OF audit harness).
  var SCORE_WEIGHTS = {
    '9pct':             { need: 0.30, recency: 0.22, basis: 0.15, pop: 0.15, civic: 0.18 },
    '4pct':             { need: 0.25, recency: 0.12, basis: 0.15, pop: 0.30, civic: 0.18 },
    'preservation':     { need: 0.20, recency: 0.15, basis: 0.35, pop: 0.10, civic: 0.20 },
    'workforce_resort': { need: 0.25, recency: 0.15, basis: 0.15, pop: 0.25, civic: 0.20 },
    'prop123_local':    { need: 0.25, recency: 0.10, basis: 0.20, pop: 0.15, civic: 0.30 },
    'any':              { need: 0.25, recency: 0.20, basis: 0.15, pop: 0.20, civic: 0.20 }
  };
  var CDP_PENALTY = -8;
  var CDP_PENALTY_TARGETS = { '9pct': true, '4pct': true, 'workforce_resort': true, 'any': true };
  var CURRENT_YEAR = new Date().getFullYear();
  /* F146 — Mirror lihtc-opportunity-finder.js: recency window dropped
     from 25 → 4 years per user direction ("anything over 4 years is not
     recent"). Keep this value identical to the OF constant so the two
     pages don't disagree on the same jurisdiction's score. */
  var MAX_RECENCY_YEARS = 4;
  var MAX_COMPARE = 6;

  var state = {
    selectedGeoids: [],            // ordered list of 7-digit place GEOIDs
    target: '9pct',
    placeMembership: {},
    placeFromAmi: {},
    qctTractIds: new Set(),
    ddaCountyFips: new Set(),
    projects: [],
    chasByFips: {},
    countyName: {},
    placeMeta: {},
    policyScores: {},
    preservationByCity: {},
    geoConfig: null,
    needDist: [],
    pabByGeoid: {},    // F25: PAB direct allocation by place GEOID / county FIPS
    placeChasByGeoid: {}, // F45: place-level CHAS for need composite
    placeOdFlows: {},  // F69: block-classified LODES OD by place GEOID
    // F116 — CHFA 2026 Round One bridge (14 awards announced 2026-05-21,
    // not yet in the live ArcGIS feed). Indexed by normalized lowercase
    // city name; each entry tagged with _source/_bridge so one line of
    // code can drop them when the feed catches up.
    chfa2026R1ByCity: {},
    chfa2026R1Meta: null
  };

  function $(id) { return document.getElementById(id); }
  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
  }); }
  function fmtInt(n) { return Number.isFinite(+n) ? Math.round(+n).toLocaleString('en-US') : '—'; }

  /* ── Scoring math (mirror of OF) ──────────────────────────────────── */
  function recencyScore(lastYear) {
    if (lastYear == null) return 100;
    var years = Math.max(0, CURRENT_YEAR - lastYear);
    return Math.min(100, Math.round((years / MAX_RECENCY_YEARS) * 100));
  }
  function buildNeedDistribution(chasByFips) {
    var dist = [];
    Object.keys(chasByFips).forEach(function (fips) {
      var s = chasByFips[fips].summary || {};
      var rH = +s.total_renter_hh || 0, oH = +s.total_owner_hh || 0, total = rH + oH;
      if (!total || s.pct_renter_cb30 == null || s.pct_owner_cb30 == null) return;
      var blended = (s.pct_renter_cb30 * rH + s.pct_owner_cb30 * oH) / total;
      var severe = +s.pct_renter_cb50 || 0;
      dist.push(blended * 0.7 + severe * 0.3);
    });
    dist.sort(function (a, b) { return a - b; });
    return dist;
  }
  // F45: needCompositeFor accepts an optional placeGeoid. When supplied AND a
  // place-CHAS summary exists, we use the place's own (TIGER pop-apportioned)
  // cost-burden rates rather than the containing county's — so small towns
  // don't all collapse to their county composite. Place file stores
  // *_cb30_share / *_cb50_share (fractions); county stores pct_*_cb30 (also
  // fractions). Field names differ; values are on the same 0–1 scale.
  function needCompositeFor(fips, placeGeoid) {
    var s = placeGeoid ? placeChasSummary(placeGeoid) : null;
    var fromPlace = !!s;
    if (!s) {
      var r = state.chasByFips[fips]; if (!r || !r.summary) return null;
      s = r.summary;
    }
    var rH = +s.total_renter_hh || 0, oH = +s.total_owner_hh || 0, total = rH + oH;
    if (!total) return null;
    var rcb30 = (s.pct_renter_cb30 != null) ? +s.pct_renter_cb30 : +s.renter_cb30_share;
    var ocb30 = (s.pct_owner_cb30  != null) ? +s.pct_owner_cb30  : +s.owner_cb30_share;
    var rcb50 = (s.pct_renter_cb50 != null) ? +s.pct_renter_cb50 : +s.renter_cb50_share;
    if (!Number.isFinite(rcb30) || !Number.isFinite(ocb30)) return null;
    var blended = (rcb30 * rH + ocb30 * oH) / total;
    var severe  = Number.isFinite(rcb50) ? rcb50 : 0;
    // fromPlace flag is reserved for future disclosure in the Compare row; for
    // now the data fix alone (place vs county composite) is the win.
    void fromPlace;
    return blended * 0.7 + severe * 0.3;
  }
  function needScoreFor(fips, placeGeoid) {
    var c = needCompositeFor(fips, placeGeoid); if (c == null) return 30;
    var below = 0;
    for (var i = 0; i < state.needDist.length; i++) {
      if (state.needDist[i] < c) below++;
      else if (state.needDist[i] === c) below += 0.5;
    }
    return Math.round((below / state.needDist.length) * 100);
  }
  function basisScore(hasQct, hasDda) {
    if (hasQct && hasDda) return 100;
    if (hasQct || hasDda) return 60;
    return 0;
  }
  function popScore(p) {
    if (p == null || !Number.isFinite(+p)) return 0;
    var n = +p;
    if (n < 500) return 0;
    if (n < 2000) return 30;
    if (n < 5000) return 60;
    if (n < 15000) return 85;
    return 100;
  }
  function composite(rec, need, basis, pop, civic, target, jurisdictionType) {
    var w = SCORE_WEIGHTS[target] || SCORE_WEIGHTS.any;
    var c = Number.isFinite(civic) ? civic : 0;
    var raw = rec * w.recency + need * w.need + basis * w.basis + pop * w.pop + c * w.civic;
    if (jurisdictionType === 'cdp' && CDP_PENALTY_TARGETS[target]) raw += CDP_PENALTY;
    return Math.max(0, Math.round(raw));
  }

  /* ── Data loading ─────────────────────────────────────────────────── */
  function loadAll() {
    // F84: route all JSON loads through window.DataService.getJSON so we
    // pick up the centralized cache:'no-store' policy + path-resolver fixes.
    // Falls back to plain fetch when DataService isn't available (older
    // pages still load) so we don't hard-fail.
    function get(url) {
      if (window.DataService && window.DataService.getJSON) {
        return window.DataService.getJSON(url);
      }
      return fetch(url).then(function (r) { return r.json(); });
    }
    function soft(url) {
      return get(url).catch(function () { return null; });
    }
    return Promise.all([
      get('data/qct-colorado.json'),
      get('data/dda-colorado.json'),
      get('data/chfa-lihtc.json'),
      get('data/hna/chas_affordability_gap.json'),
      get('data/hna/place-tract-membership.json'),
      get('data/co_ami_gap_by_place.json'),
      get('data/hna/geo-config.json'),
      soft('data/policy/housing-policy-scorecard.json'),
      soft('data/affordable-housing/properties.json'),
      soft('data/policy/pab-allocations.json'),  // F25
      soft('data/hna/place-chas.json'),          // F45: place-level CHAS
      soft('data/hna/place-od-flows.json'),      // F69: block-classified LODES OD
      // F116 — CHFA 2026 R1 bridge (14 awards announced 2026-05-21,
      // not yet ingested into the live ArcGIS feed).
      soft('data/affordable-housing/chfa-awards/2026-round-one.json'),
      // F176 — Watchlist (drought + signal per place) + soft funding
      // (statewide program deadlines). The watchlist materializes
      // "competition staleness" signals the OF computes at runtime; the
      // soft funding data drives the deadlines panel above the
      // comparison table.
      soft('data/policy/chfa-watchlist.json'),
      soft('data/policy/soft-funding-status.json')
    ]).then(function (parts) {
      (parts[0].features || []).forEach(function (f) { if (f.properties && f.properties.GEOID) state.qctTractIds.add(f.properties.GEOID); });
      (parts[1].features || []).forEach(function (f) { if (f.properties && f.properties.GEOID && f.properties.GEOID.length === 5) state.ddaCountyFips.add(f.properties.GEOID); });
      state.projects = (parts[2].features || []).filter(function (f) {
        var y = parseInt(f.properties && f.properties.YR_PIS, 10);
        return Number.isFinite(y) && y >= 1980 && y <= 2030;
      });
      state.chasByFips = parts[3].counties || {};
      state.placeMembership = (parts[4].places) || {};
      state.placeFromAmi = (parts[5].places) || {};
      state.geoConfig = parts[6] || {};
      (state.geoConfig.counties || []).forEach(function (c) { state.countyName[c.geoid] = c.label; });
      [].concat(state.geoConfig.featured || [], state.geoConfig.places || [], state.geoConfig.cdps || []).forEach(function (p) {
        if (!p.geoid) return;
        var lower = (p.label || '').toLowerCase();
        var type = 'place';
        if (lower.indexOf('cdp') !== -1) type = 'cdp';
        else if (lower.indexOf('city') !== -1) type = 'city';
        else if (lower.indexOf('town') !== -1) type = 'town';
        else if (p.type) type = p.type;
        state.placeMeta[p.geoid] = { label: p.label, containingCounty: p.containingCounty, type: type };
      });
      state.policyScores = (parts[7] && parts[7].scores) || {};
      // Index affordable-housing preservation by city
      var ahProps = parts[8];
      if (ahProps && Array.isArray(ahProps.properties)) {
        ahProps.properties.forEach(function (p) {
          var city = (p.city || '').toUpperCase().trim();
          if (!city) return;
          if (p.program_type.indexOf('preservation-candidate') !== -1) {
            var r = state.preservationByCity[city] || { total: 0, urgent5y: 0 };
            r.total++;
            if (Number.isFinite(p.years_to_expiration) && p.years_to_expiration <= 5) r.urgent5y++;
            state.preservationByCity[city] = r;
          }
        });
      }
      state.needDist = buildNeedDistribution(state.chasByFips);
      // F25: PAB direct allocations keyed by place GEOID / county FIPS.
      state.pabByGeoid = (parts[9] && parts[9].allocations) || {};
      // F45: place-level CHAS — preferred for needComposite when present so a
      // small town's need score reflects the town, not its containing county.
      state.placeChasByGeoid = (parts[10] && parts[10].places) || {};
      // F69: block-classified OD flows for the Compare commute rows.
      state.placeOdFlows     = (parts[11] && parts[11].places) || {};
      // F116 — CHFA 2026 R1 bridge. Tag every record with _source/_bridge
      // so the bridge can be dropped in one line when the ArcGIS feed
      // catches up. Indexed by normalized lowercase city name.
      var r1 = parts[12];
      if (r1 && Array.isArray(r1.awards)) {
        state.chfa2026R1Meta = r1.metadata || null;
        r1.awards.forEach(function (a) {
          a._source = 'chfa-2026-r1-bridge';
          a._bridge = true;
          var key = (a.city || '').trim().toLowerCase();
          if (!key) return;
          (state.chfa2026R1ByCity[key] = state.chfa2026R1ByCity[key] || []).push(a);
        });
      }
      // F176 — Watchlist index: by place_geoid for fast lookup. Each
      // entry carries drought_years + signal (high/med/low) + prior
      // LIHTC count/mix. Lets the Compare table surface "this place
      // hasn't seen an award in N years" without recomputing from the
      // raw CHFA feed.
      var wl = parts[13];
      state.watchlistByGeoid = {};
      if (wl && Array.isArray(wl.entries)) {
        wl.entries.forEach(function (e) {
          if (e && e.place_geoid) state.watchlistByGeoid[e.place_geoid] = e;
        });
      }
      // F176 — Soft funding programs (statewide deadlines + capacity).
      // Used by the deadlines-at-a-glance panel above the comparison
      // table + the per-jurisdiction "soft-funding programs" row.
      state.softFundingPrograms = (parts[14] && parts[14].programs) || {};
      state.softFundingMeta = (parts[14] && parts[14].meta) || null;
      if (window.PlaceLehd && window.PlaceLehd.init) { window.PlaceLehd.init().catch(function () { /* non-fatal */ }); }
    });
  }

  // F45: place-CHAS summary lookup. Returns the apportioned per-place summary
  // (renter_cb30_share / owner_cb30_share / renter_cb50_share / total_*_hh)
  // when available; else null.
  function placeChasSummary(geoid) {
    if (!geoid) return null;
    var p = state.placeChasByGeoid[geoid];
    return (p && p.summary) || null;
  }

  /* ── Build per-jurisdiction record ────────────────────────────────── */
  function buildRecord(placeGeoid) {
    var membership = state.placeMembership[placeGeoid];
    if (!membership) return null;
    var meta = state.placeMeta[placeGeoid] || {};
    var label = (membership.name || meta.label || placeGeoid).replace(/\s*\([^)]+\)\s*$/, '').trim();
    var containingCounty = meta.containingCounty;
    if (!containingCounty) {
      var t = (membership.tracts || [])[0];
      if (t && t.tract_geoid) containingCounty = t.tract_geoid.substring(0, 5);
    }
    var cityUpper = label.toUpperCase();

    // Geo dims
    var qctTracts = (membership.tracts || []).filter(function (t) {
      if (!state.qctTractIds.has(t.tract_geoid)) return false;
      var sp = +t.share_of_place_area || 0, st = +t.share_of_tract_area || 0;
      return sp > 0.05 || st > 0.20;
    });
    var hasQct = qctTracts.length > 0;
    var hasDda = containingCounty && state.ddaCountyFips.has(containingCounty);

    // LIHTC projects
    var inside = state.projects.filter(function (p) {
      return ((p.properties.PROJ_CTY || '').toUpperCase().trim()) === cityUpper;
    });
    var lastYearPis = inside.reduce(function (m, p) {
      var y = parseInt(p.properties.YR_PIS, 10);
      return (Number.isFinite(y) && y > m) ? y : m;
    }, -Infinity);
    if (lastYearPis === -Infinity) lastYearPis = null;

    // F116 — 2026 R1 bridge awards in this place (matched by lowercased
    // city name). Surfaces fresh CHFA activity that the live feed lags.
    var r1Awards = state.chfa2026R1ByCity[label.toLowerCase()] || [];
    var r1Count = r1Awards.length;
    var r1Units = r1Awards.reduce(function (s, a) { return s + (+a.total_units || 0); }, 0);

    // F116 — Award-year-based recency. The OF uses YR_PIS (placed in
    // service), but the live ArcGIS feed also exposes AwardYear which is
    // 2-3y earlier and what scouts actually care about. Sample it here
    // so the Compare row can show "fresh awards" as a distinct signal
    // from "fresh placed-in-service".
    var lastAwardYear = inside.reduce(function (m, p) {
      var y = parseInt(p.properties.AwardYear || p.properties.YR_ALLOC, 10);
      return (Number.isFinite(y) && y > m) ? y : m;
    }, -Infinity);
    if (lastAwardYear === -Infinity) lastAwardYear = null;

    // F146 — Bridge the 2026 R1 award year into the recency calc. Parse
    // the round string ("2026 Round One") for a 4-digit year and prefer
    // it when newer than YR_PIS or AwardYear. Keeps recency consistent
    // between the OF and Compare pages: a place that won a R1 award shows
    // as "recently funded" (low recency-score) on both pages even before
    // the HUD LIHTC database catches up.
    var bridgeYear = null;
    if (r1Awards.length && state.chfa2026R1Meta) {
      var roundStr = state.chfa2026R1Meta.round || '';
      var rm = /(\d{4})/.exec(roundStr);
      if (rm) bridgeYear = parseInt(rm[1], 10);
      if (bridgeYear == null && typeof state.chfa2026R1Meta.announcement_date === 'string') {
        var rm2 = /^(\d{4})/.exec(state.chfa2026R1Meta.announcement_date);
        if (rm2) bridgeYear = parseInt(rm2[1], 10);
      }
    }
    var lastYear = lastYearPis;
    if (bridgeYear != null && (lastYear == null || bridgeYear > lastYear)) {
      lastYear = bridgeYear;
    }
    // Also let AwardYear (from the live feed) win if it's newer than both.
    if (lastAwardYear != null && (lastYear == null || lastAwardYear > lastYear)) {
      lastYear = lastAwardYear;
    }

    // Population proxy
    var ami = state.placeFromAmi[placeGeoid];
    var pop = (ami && ami.households_le_ami_pct && ami.households_le_ami_pct['100'])
      ? Math.round((+ami.households_le_ami_pct['100'] || 0) * 2.5) : null;

    // Civic — prefer the place's scorecard; fall back to its containing
    // county's. Track whether we fell back so the rendered cell can be
    // honest about it (mirrors the PAB pabIsCounty pattern below). Without
    // this flag the Compare table silently shows a county-level civic
    // score next to a place name as if it were that place's own data.
    var ownCivic = state.policyScores[placeGeoid];
    var civic = ownCivic || (containingCounty ? state.policyScores[containingCounty] : null);
    var civicIsCounty = !ownCivic && !!civic;
    var civicRaw = civic && Number.isFinite(civic.totalScore) ? civic.totalScore : null;
    var civicMax = civic && Number.isFinite(civic.maxPossible) && civic.maxPossible > 0 ? civic.maxPossible : 7;
    var civicPct = civicRaw != null ? Math.round((civicRaw / civicMax) * 100) : 0;

    // Preservation
    var prec = state.preservationByCity[cityUpper] || { total: 0, urgent5y: 0 };

    // Component scores
    var rec = recencyScore(lastYear);
    var need = needScoreFor(containingCounty, placeGeoid);
    var bb = basisScore(hasQct, hasDda);
    var p = popScore(pop);
    var jType = meta.type || 'place';

    // F25: PAB direct allocation — place's own if it's a designated issuer,
    // else the containing county's (likely conduit issuer), else null.
    var ownPab = state.pabByGeoid[placeGeoid];
    var countyPab = containingCounty ? state.pabByGeoid[containingCounty] : null;
    var pabDirect = (ownPab && ownPab.directAllocation) || null;
    var pabIsCounty = false;
    if (pabDirect == null && countyPab && countyPab.directAllocation) {
      pabDirect = countyPab.directAllocation;
      pabIsCounty = true;
    }

    return {
      placeGeoid: placeGeoid,
      name: label,
      type: jType,
      countyFips: containingCounty,
      countyName: state.countyName[containingCounty] || '—',
      hasQct: hasQct, hasDda: hasDda,
      qctCount: qctTracts.length,
      projectCount: inside.length,
      lastYear: lastYear,
      yearsSince: lastYear != null ? CURRENT_YEAR - lastYear : null,
      // F116 — Award-year-based and bridge-data freshness signals.
      lastAwardYear: lastAwardYear,
      r1Awards: r1Awards,
      r1Count: r1Count,
      r1Units: r1Units,
      // Combined "most-recent CHFA activity year" — picks the highest of
      // (live-feed AwardYear, live-feed YR_PIS, 2026 if R1 bridge has any).
      latestChfaActivityYear: (function () {
        var ys = [lastYear, lastAwardYear];
        if (r1Count > 0) ys.push(2026);
        var max = ys.filter(function (y) { return Number.isFinite(y); }).reduce(function (a, b) { return a > b ? a : b; }, -Infinity);
        return max === -Infinity ? null : max;
      }()),
      population: pop,
      civicScore: civicPct,
      civicRawScore: civicRaw,
      civicIsCounty: civicIsCounty,
      // F69: place-level commute flows. Prefer the OD-flows table (clean
      // block classification) and fall back to the place-LEHD aggregate
      // that the F58/F63 cards use.
      labor: (function () {
        var od = state.placeOdFlows && state.placeOdFlows[placeGeoid];
        var lehd = (window.PlaceLehd && window.PlaceLehd.lookup)
          ? window.PlaceLehd.lookup(placeGeoid) : null;
        var src;
        var within = null, inflow = null, outflow = null, jobs = null;
        if (od) {
          within  = Number.isFinite(od.within)  ? od.within  : null;
          inflow  = Number.isFinite(od.inflow)  ? od.inflow  : null;
          outflow = Number.isFinite(od.outflow) ? od.outflow : null;
          jobs    = Number.isFinite(od.jobs)    ? od.jobs    : null;
          src = 'block-od';
        } else if (lehd) {
          within  = Number.isFinite(lehd.within)  ? lehd.within  : null;
          inflow  = Number.isFinite(lehd.inflow)  ? lehd.inflow  : null;
          outflow = Number.isFinite(lehd.outflow) ? lehd.outflow : null;
          jobs    = Number.isFinite(lehd.C000)    ? lehd.C000    : null;
          src = lehd.flows_source || 'tract-lodes';
        }
        var residents = (within || 0) + (outflow || 0);
        var outflowPct = residents > 0 ? Math.round(100 * (outflow || 0) / residents) : null;
        var character = null;
        if (outflowPct != null) {
          if (outflowPct >= 70)      character = 'bedroom';
          else if (outflowPct >= 40) character = 'mixed';
          else                       character = 'self-contained';
        }
        return { within: within, inflow: inflow, outflow: outflow, jobs: jobs, outflowPct: outflowPct, character: character, source: src };
      })(),
      preservationCount: prec.total,
      preservationUrgent5y: prec.urgent5y,
      pabDirect: pabDirect,
      pabIsCounty: pabIsCounty,
      // F176 — Watchlist signal (drought + competition flags), placed
      // here so the rows below can render it without a second lookup.
      // Falls back to runtime-computed drought_years when the watchlist
      // doesn't have an entry (most non-featured places).
      watchlist: state.watchlistByGeoid && state.watchlistByGeoid[placeGeoid] || null,
      droughtYears: (function () {
        var wlEntry = state.watchlistByGeoid && state.watchlistByGeoid[placeGeoid];
        if (wlEntry && Number.isFinite(wlEntry.drought_years)) return wlEntry.drought_years;
        if (lastYear == null) return null;
        return Math.max(0, CURRENT_YEAR - lastYear);
      })(),
      // F176 — Soft funding eligibility. Counts the programs whose
      // `county` field matches this jurisdiction's county (or is "All").
      // Most DOH/CHFA programs are statewide-eligible; the count varies
      // for HOME-PJ-specific or rural-set-aside programs.
      softFundingEligible: (function () {
        var progs = state.softFundingPrograms || {};
        var n = 0;
        Object.keys(progs).forEach(function (k) {
          var p = progs[k];
          if (!p) return;
          var c = (p.county || '').toString();
          if (c === 'All' || c === '' || c === containingCounty) n++;
        });
        return n;
      })(),
      // Component scores (for the comparison rows)
      needScore: need,
      recencyScore: rec,
      basisScore: bb,
      popScore: p,
      // All six target composites. F9: jType passed so CDPs get the
      // -8 incorporation penalty on 9pct/4pct/workforce_resort/any.
      score9:            composite(rec, need, bb, p, civicPct, '9pct', jType),
      score4:            composite(rec, need, bb, p, civicPct, '4pct', jType),
      scorePreservation: composite(rec, need, bb, p, civicPct, 'preservation', jType),
      scoreWorkforce:    composite(rec, need, bb, p, civicPct, 'workforce_resort', jType),
      scoreProp123:      composite(rec, need, bb, p, civicPct, 'prop123_local', jType),
      scoreAny:          composite(rec, need, bb, p, civicPct, 'any', jType)
    };
  }

  function activeScore(rec, target) {
    if (target === '9pct')             return rec.score9;
    if (target === '4pct')             return rec.score4;
    if (target === 'preservation')     return rec.scorePreservation;
    if (target === 'workforce_resort') return rec.scoreWorkforce;
    if (target === 'prop123_local')    return rec.scoreProp123;
    return rec.scoreAny;
  }

  /* ── Rendering ────────────────────────────────────────────────────── */
  // F13: Render the "Overall winner" verdict card above the comparison
  // table. Picks the jurisdiction with the most per-dimension wins;
  // ties broken by active-target composite score.
  function _renderVerdict(records, winsByIdx) {
    var el = document.getElementById('cmpVerdict');
    if (!el || !records.length) return;
    if (records.length < 2) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    // Find max wins (ties go to the higher composite score)
    var maxWins = Math.max.apply(null, winsByIdx);
    var winnerIdx = -1;
    var winnerScore = -1;
    winsByIdx.forEach(function (w, i) {
      if (w !== maxWins) return;
      var s = activeScore(records[i], state.target);
      if (s > winnerScore) { winnerScore = s; winnerIdx = i; }
    });
    if (winnerIdx < 0) { el.hidden = true; return; }
    var winner = records[winnerIdx];
    var totalRows = 0;
    // Count non-group rows for "X of Y dimensions" phrasing
    ROWS.forEach(function (r) { if (!r.group && !r.raw) totalRows++; });
    var TARGET_LABELS = {
      '9pct':'9% Competitive','4pct':'4% Bond','preservation':'Preservation',
      'workforce_resort':'Workforce / Resort','prop123_local':'Prop 123 / Local','any':'Balanced'
    };
    el.hidden = false;
    el.innerHTML =
      '<div class="cmp-verdict-label">↑ Overall winner for ' + escHtml(TARGET_LABELS[state.target] || 'Balanced') + '</div>' +
      '<div class="cmp-verdict-name">' + escHtml(winner.name) +
        ' <span class="cmp-verdict-meta">· ' + escHtml(winner.countyName) + ' · score ' + winnerScore + '/100</span>' +
      '</div>' +
      '<div class="cmp-verdict-detail">Wins <strong>' + maxWins + '</strong> of ' + totalRows +
        ' dimensions across this comparison set. Other jurisdictions: ' +
        winsByIdx.map(function (w, i) {
          if (i === winnerIdx) return null;
          return escHtml(records[i].name) + ' ' + w;
        }).filter(Boolean).join(' · ') +
      '</div>';
  }

  function _rmJurisdiction(geoid) {
    state.selectedGeoids = state.selectedGeoids.filter(function (g) { return g !== geoid; });
    _syncUrl();
    render();
  }

  // Row definitions. `info` is the plain-English definition shown when the
  // user clicks the row label (opens an inline popover).
  var ROWS = [
    { group: 'Composite scores' },
    { label: 'Active target score',  info: 'The composite for the deal type currently selected in the Target dropdown above. Highest = strongest opportunity FOR THAT deal type.',
      fn: function (r, t) { return activeScore(r, t); }, fmt: function (v) { return '<strong>' + v + '</strong>/100'; }, best: 'high' },
    { label: '9% Competitive', info: 'Weights: 30% need · 22% recency · 15% basis · 15% pop · 18% civic. Rewards geographic-gap markets (CHFA QAP scoring) with civic-capacity floor.',
      fn: function (r) { return r.score9; }, fmt: function (v) { return v + '/100'; }, best: 'high' },
    { label: '4% Bond', info: 'Weights: 25% need · 12% recency · 15% basis · 30% pop · 18% civic. Rewards scale (bonds need ~150+ units to pencil) + local IZ/soft-debt match.',
      fn: function (r) { return r.score4; }, fmt: function (v) { return v + '/100'; }, best: 'high' },
    { label: 'Preservation', info: 'Weights: 20% need · 15% recency · 35% basis · 10% pop · 20% civic. Rewards subsidy-stack feasibility for 4% refi + Year-15 LIHTC exits.',
      fn: function (r) { return r.scorePreservation; }, fmt: function (v) { return v + '/100'; }, best: 'high' },
    { label: 'Workforce / Resort', info: 'Weights: 25% need · 15% recency · 15% basis · 25% pop · 20% civic. Mountain/resort markets with severe workforce-housing pressure — civic strategy is the differentiator.',
      fn: function (r) { return r.scoreWorkforce; }, fmt: function (v) { return v + '/100'; }, best: 'high' },
    { label: 'Prop 123 / Local', info: 'Weights: 25% need · 10% recency · 20% basis · 15% pop · 30% civic. Civic capacity is the GATE — must have filed Prop 123 commitment + comp plan.',
      fn: function (r) { return r.scoreProp123; }, fmt: function (v) { return v + '/100'; }, best: 'high' },
    { label: 'Balanced (any)', info: 'Weights: 25% need · 20% recency · 15% basis · 20% pop · 20% civic. Equal-ish across dimensions — exploratory mode.',
      fn: function (r) { return r.scoreAny; }, fmt: function (v) { return v + '/100'; }, best: 'high' },

    { group: 'Component scores (0–100)' },
    { label: 'Housing Need', info: 'Tenure-blended cost burden + severe rent burden, percentile-normalized vs CO peers. Source: HUD CHAS 2018–2022 Table 7. Formula: blended_cb30 × 0.7 + cb50 × 0.3, then percentile-rank.',
      fn: function (r) { return r.needScore; }, fmt: function (v) { return v + 'p'; }, best: 'high' },
    { label: 'Recency / Competition', info: 'min(100, years_since_last_LIHTC × 4). 25-year cap. Never-funded = 100. Source: CHFA HousingTaxCreditProperties_view AwardYear (2025-current).',
      fn: function (r) { return r.recencyScore; }, fmt: function (v) { return v; }, best: 'high' },
    { label: 'Basis-Boost', info: 'QCT-only: 60 · DDA-only: 60 · Both: 100 · Neither: 0. IRC §42(d)(5)(B) basis boost. Source: HUD QCT 2025 (224 CO tracts) + HUD DDA 2025 (10 CO nonmetro counties).',
      fn: function (r) { return r.basisScore; }, fmt: function (v) { return v; }, best: 'high' },
    { label: 'Population / Feasibility', info: 'Bucketed: <500: 0 · 500–2k: 30 · 2k–5k: 60 · 5k–15k: 85 · ≥15k: 100. Source: CHAS HHs ≤100% AMI × 2.5 proxy.',
      fn: function (r) { return r.popScore; }, fmt: function (v) { return v; }, best: 'high' },
    { label: 'Civic Readiness', info: 'Count of 7 civic-capacity dimensions (Prop 123 ✓, HNA ✓, comp plan ✓, IZ ✓, local funding ✓, housing authority ✓, nonprofits ✓) ÷ known dims × 100. Source: housing-policy-scorecard.json. "county" tag = the place has no place-level scorecard so this is its containing county\'s readiness — interpret as a ceiling for the place.',
      fn: function (r) { return r.civicScore; },
      fmt: function (v, r) {
        var s = v + '/100';
        return (r && r.civicIsCounty)
          ? s + ' <span class="cmp-pill" title="No place-level civic scorecard on file — this is the containing county\'s readiness.">county</span>'
          : s;
      }, best: 'high' },

    { group: 'Designations + Capacity' },
    { label: 'QCT', info: 'Qualified Census Tract — IRC §42(d)(5)(B)(ii). Tracts with ≥50% of HHs below 60% AMI or ≥25% poverty rate. Eligible for 30% basis boost.',
      fn: function (r) { return r.hasQct ? 'Yes (' + r.qctCount + ')' : 'No'; }, fmt: function (v) { return v; }, raw: true },
    { label: 'DDA', info: 'Difficult Development Area — IRC §42(d)(5)(B)(iii). HUD-designated nonmetro CO counties (10 currently) where construction cost exceeds local rents.',
      fn: function (r) { return r.hasDda ? 'Yes' : 'No'; }, fmt: function (v) { return v; }, raw: true },
    { label: 'Civic dimensions filled', info: 'Raw count of populated civic-capacity flags (out of 7). null indicates data wasn\'t researched. "county" tag = containing-county data, no place-level scorecard on file.',
      fn: function (r) {
        if (r.civicRawScore == null) return '—';
        var s = r.civicRawScore + '/7';
        return r.civicIsCounty
          ? s + ' <span class="cmp-pill" title="Containing-county scorecard — no place-level entry on file.">county</span>'
          : s;
      }, fmt: function (v) { return v; }, raw: true },

    { group: 'LIHTC pipeline' },
    { label: 'Last LIHTC award year', info: 'Most recent CHFA AwardYear for any project with PROJ_CTY matching this jurisdiction. AwardYear is when CHFA reserved the credits (typically 2–3y before placed-in-service). "Never on record" means the live CHFA ArcGIS feed has no matching project — usually accurate for small towns but verify against historical CHFA reports if surprising.',
      fn: function (r) { return r.lastYear || 'Never on record'; }, fmt: function (v) { return v; }, raw: true },
    // F176 — Explicit drought count. Mirrors the recencyScore semantics
    // but exposes the human-readable years-since-last-award the OF
    // computes at runtime + the watchlist persists for featured places.
    { label: 'Years since last LIHTC (drought)', info: 'CURRENT_YEAR − last_award_year. Captures "competition staleness" — long droughts often signal political will, sponsor capacity gap, or oversupply elsewhere. CHFA QAP scores reward longer droughts. "—" means no known prior LIHTC; the F146 recency score treats this as 100 (maximum opportunity).',
      fn: function (r) { return r.droughtYears; },
      fmt: function (v, r) {
        if (v == null) return '<span style="color:var(--muted)">—</span>';
        var color = v >= 8 ? 'var(--accent)' : (v >= 4 ? 'inherit' : 'var(--muted)');
        var note = v >= 8 ? ' yrs · drought signal' : (v >= 4 ? ' yrs' : ' yrs · recent');
        return '<span style="color:' + color + ';font-weight:' + (v >= 8 ? '700' : '400') + '">' + v + note + '</span>';
      }, best: 'high' },
    // F176 — CHFA watchlist signal (curated by signals workflow). Only
    // present for ~50 featured jurisdictions today — others show "—".
    { label: 'CHFA watchlist signal', info: 'High/medium/low priority flag from data/policy/chfa-watchlist.json. Combines drought, need rank, and prior LIHTC pattern into a single competition-intelligence signal. "—" means this place is not yet in the curated watchlist (most non-featured CDPs).',
      fn: function (r) { return r.watchlist && r.watchlist.signal || null; },
      fmt: function (v) {
        if (!v) return '<span style="color:var(--muted)">—</span>';
        var color = v === 'high' ? '#dc2626' : (v === 'medium' ? '#f59e0b' : '#0891b2');
        return '<span style="background:' + color + '22;color:' + color + ';padding:1px 8px;border-radius:9px;font-size:.78rem;font-weight:600">' + v + '</span>';
      }, raw: true },
    // F116 — Recent CHFA activity (live feed + 2026 R1 bridge) per place.
    // Combines two freshness signals so a stale ArcGIS feed doesn't make
    // an active jurisdiction look dormant:
    //   1. Live feed: latest AwardYear OR YR_PIS for this place.
    //   2. Bridge: 2026 R1 awards (announced 2026-05-21).
    // Renders as e.g. "2026 R1 · 1 award · 50u" or "2024 · live feed".
    { label: 'Recent CHFA activity', info: 'Combines the live CHFA feed (latest AwardYear / YR_PIS) with the 2026 R1 bridge file (14 developments announced 2026-05-21, not yet ingested). Higher year + non-zero R1 count = active CHFA pipeline here. The bridge can be dropped in one line of code (_bridge:true filter) when the ArcGIS feed catches up.',
      fn: function (r) { return r.latestChfaActivityYear || 0; },
      fmt: function (v, r) {
        if (!r) return v;
        var parts = [];
        if (r.r1Count > 0) {
          parts.push('<strong style="color:var(--accent);">2026 R1</strong> · ' + r.r1Count + ' award' + (r.r1Count === 1 ? '' : 's') + ' · ' + r.r1Units + 'u');
        }
        if (r.lastAwardYear || r.lastYear) {
          var ly = r.lastAwardYear || r.lastYear;
          parts.push('<span style="color:var(--muted);font-size:.78rem;">live feed: ' + ly + '</span>');
        }
        if (!parts.length) return '<span style="color:var(--muted)">— never funded on record</span>';
        return parts.join('<br>');
      }, best: 'high' },
    { label: 'LIHTC projects on record', info: 'Count of CHFA-tracked LIHTC projects matching this jurisdiction\'s name. Lower = more saturation headroom = stronger 9% competitive case.',
      fn: function (r) { return r.projectCount; }, fmt: function (v) { return v; }, best: 'low' },
    { label: 'Local PAB issuing authority', info: 'A jurisdiction\'s OWN private-activity-bond direct allocation — NOT how a 4% deal typically gets cap. In Colorado, 4% LIHTC volume cap comes primarily from CHFA\'s statewide pool ($376.6M in 2025), not local allocations. This row shows whether a city/county is a designated local issuer (≥ ~$1M / 15,300-pop minimum, at $65.28/capita); that slice mostly funds single-family bonds / MCCs. "$0 · statewide pool" = below the minimum, uses CHFA\'s pool (expected, not missing data); "—" = dataset failed to load; "county" tag = the place\'s containing county is the issuer. Issuing-authority signal, not a deal cap. Source: Colorado DOLA 2025.',
      fn: function (r) { return r.pabDirect; },
      fmt: function (v, r) {
        // Distinguish genuinely-$0 (below the issuer threshold, by design)
        // from "data unavailable" — the former is a real answer, the latter
        // means the file didn't load. Without this, an empty dataset would
        // falsely read as "no jurisdiction has any cap."
        var loaded = state.pabByGeoid && Object.keys(state.pabByGeoid).length > 0;
        if (v == null) {
          return loaded
            ? '<span style="color:var(--muted)" title="No direct allocation — this jurisdiction is below the $1M / ~15,300-population minimum, so 4% deals here use CHFA’s statewide bond-cap pool. Expected, not missing data.">$0 · statewide pool</span>'
            : '<span style="color:var(--muted)" title="Bond-cap dataset unavailable.">—</span>';
        }
        var amt = '$' + Math.round(v).toLocaleString('en-US');
        return (r && r.pabIsCounty)
          ? amt + ' <span class="cmp-pill" title="This is the containing county’s allocation — the place itself is below the issuer threshold and would issue through the county.">county</span>'
          : amt;
      }, best: 'high' },

    { group: 'Preservation pipeline' },
    { label: 'Preservation candidates', info: 'CHFA-tracked at-risk subsidized rental properties (CHFA Preservation 1,688 + HUD MF Assisted 343 + USDA Rural 116). High count = preservation deal opportunity.',
      fn: function (r) { return r.preservationCount; }, fmt: function (v) { return v; }, best: 'high' },
    { label: '  …expiring ≤5 years', info: 'USDA Rural Housing properties whose Restrictive Clause Expiration falls within the next 5 years. Most-urgent preservation candidates.',
      fn: function (r) { return r.preservationUrgent5y; }, fmt: function (v) { return v > 0 ? '<span class="cmp-pill cmp-pill--med">' + v + '</span>' : '0'; }, best: 'high' },

    { group: 'Labor market & commute (LEHD LODES)' },
    { label: 'Labor character', info: 'Inferred from outflow share of resident workers. Bedroom community = ≥70% commute out (housing demand tracks regional job hubs). Mixed = 40–70%. Self-contained = <40% (local jobs anchor demand). Source: block-classified LEHD LODES OD via data/hna/place-od-flows.json.',
      fn: function (r) {
        var c = r.labor && r.labor.character;
        if (!c) return '—';
        var emoji = c === 'bedroom' ? '🛏️' : c === 'mixed' ? '🔀' : '🏢';
        var label = c === 'bedroom' ? 'Bedroom' : c === 'mixed' ? 'Mixed' : 'Self-contained';
        var pct = r.labor.outflowPct != null ? ' (' + r.labor.outflowPct + '% out)' : '';
        return emoji + ' ' + label + pct;
      }, fmt: function (v) { return v; }, raw: true },
    { label: 'Local jobs (C000)', info: 'Total primary jobs located in this jurisdiction (LEHD LODES Workforce Area Characteristics, latest year). Higher = larger anchor economy.',
      fn: function (r) { return (r.labor && r.labor.jobs) || null; }, fmt: function (v) { return v != null ? fmtInt(v) : '—'; }, best: 'high' },
    { label: 'Commute in (inflow)', info: 'Workers commuting INTO this jurisdiction from outside it. High = job-hub character; constrains workforce-housing supply because inflow workers are competing for the same units.',
      fn: function (r) { return (r.labor && r.labor.inflow) || null; }, fmt: function (v) { return v != null ? fmtInt(v) : '—'; }, best: 'high' },
    { label: 'Commute out (outflow)', info: 'Resident workers leaving the jurisdiction for jobs elsewhere. High = bedroom-community character; LIHTC demand is housing-pressure-driven (residents priced out of the job-hub markets they commute to).',
      fn: function (r) { return (r.labor && r.labor.outflow) || null; }, fmt: function (v) { return v != null ? fmtInt(v) : '—'; }, best: 'high' },

    { group: 'Soft funding eligibility' },
    // F176 — Number of statewide DOH/CHFA/federal soft-funding programs
    // that explicitly cover this jurisdiction's county (or are
    // statewide). Most jurisdictions show the same baseline ~6 — places
    // in HOME-PJ counties or rural set-asides show more.
    { label: 'Soft-funding programs eligible', info: 'Count of programs in data/policy/soft-funding-status.json whose `county` field is "All" or matches this jurisdiction\'s containing county. Includes DOH-AHTF/HDG/HHPG, HOME, NHTF-CO, and PJ-specific programs. The actual deadlines + capacity for each are shown in the panel above the table.',
      fn: function (r) { return r.softFundingEligible; },
      fmt: function (v) { return v != null ? v + ' programs' : '—'; }, best: 'high' },

    { group: 'Demographics' },
    { label: 'Population (proxy)', info: 'HHs ≤100% AMI × 2.5 (avg CO HH size). Proxy because ACS B01003 isn\'t yet wired in. Resort markets understated (HH-based, not B01003 — but actually CLOSER to renter-base truth in resort markets).',
      fn: function (r) { return r.population; }, fmt: function (v) { return v != null ? fmtInt(v) : '—'; }, best: 'high' }
  ];

  /* F176 — Soft-funding deadlines panel. Renders above the comparison
     table with one row per program — LOI deadline, application
     deadline, capacity, available, competitiveness. Sort by next-LOI
     ascending so the most-urgent gate floats to the top. Mounts into
     #cmpSoftFundingPanel; the panel div is created on demand so we
     don't need an HTML change. */
  function _renderSoftFundingDeadlinesPanel() {
    var progs = state.softFundingPrograms || {};
    var keys = Object.keys(progs);
    if (!keys.length) return;

    var host = document.getElementById('cmpSoftFundingPanel');
    if (!host) {
      host = document.createElement('div');
      host.id = 'cmpSoftFundingPanel';
      host.className = 'cmp-soft-funding';
      host.style.cssText = 'margin:.4rem 0 1rem;padding:.7rem .9rem;border:1px solid var(--border);border-radius:8px;background:var(--bg2);';
      var anchor = document.getElementById('cmpTableWrap');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor);
    }

    // Sort by next-LOI then application deadline, ascending.
    var rows = keys.map(function (k) { return Object.assign({ _key: k }, progs[k]); });
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
      if (n == null) return '<span style="color:var(--muted)">—</span>';
      if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
      if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
      return '$' + n;
    }
    function _urgencyChip(date) {
      if (!date) return '';
      var t = new Date(date + 'T00:00:00Z').getTime();
      var days = Math.round((t - Date.now()) / (1000*60*60*24));
      if (days < 0) return '<span style="background:#94a3b822;color:#94a3b8;padding:0 6px;border-radius:8px;font-size:.7rem;font-weight:600;margin-left:6px">past</span>';
      if (days <= 30) return '<span style="background:#dc262622;color:#dc2626;padding:0 6px;border-radius:8px;font-size:.7rem;font-weight:600;margin-left:6px">≤ 30d</span>';
      if (days <= 60) return '<span style="background:#f59e0b22;color:#f59e0b;padding:0 6px;border-radius:8px;font-size:.7rem;font-weight:600;margin-left:6px">≤ 60d</span>';
      return '';
    }

    var html = '' +
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:.5rem;margin-bottom:.5rem">' +
        '<strong style="font-size:.92rem">Soft-funding programs · next deadlines</strong>' +
        '<span style="font-size:.72rem;color:var(--muted)">Source: data/policy/soft-funding-status.json · sorted by next gate ascending</span>' +
      '</div>' +
      '<div style="overflow-x:auto"><table class="cmp-soft-table" style="width:100%;border-collapse:collapse;font-size:.82rem">' +
        '<thead><tr style="border-bottom:1px solid var(--border)">' +
          '<th style="text-align:left;padding:4px 8px 4px 0;font-weight:600">Program</th>' +
          '<th style="text-align:left;padding:4px 8px;font-weight:600">LOI deadline</th>' +
          '<th style="text-align:left;padding:4px 8px;font-weight:600">Application deadline</th>' +
          '<th style="text-align:right;padding:4px 8px;font-weight:600">Available</th>' +
          '<th style="text-align:right;padding:4px 8px;font-weight:600">Max / project</th>' +
          '<th style="text-align:left;padding:4px 0 4px 8px;font-weight:600">Competition</th>' +
        '</tr></thead><tbody>' +
        rows.map(function (r) {
          var compColor = r.competitiveness === 'high' ? '#dc2626' : (r.competitiveness === 'moderate' ? '#f59e0b' : '#0891b2');
          var compPill = r.competitiveness
            ? '<span style="background:' + compColor + '22;color:' + compColor + ';padding:0 6px;border-radius:8px;font-size:.7rem;font-weight:600">' + r.competitiveness + '</span>'
            : '<span style="color:var(--muted)">—</span>';
          return '<tr style="border-bottom:1px solid var(--border)">' +
            '<td style="padding:5px 8px 5px 0"><strong>' + escHtml(r.name || r._key) + '</strong>' +
              (r.adminEntity ? ' <span style="color:var(--muted);font-size:.7rem">· ' + escHtml(r.adminEntity) + '</span>' : '') +
            '</td>' +
            '<td style="padding:5px 8px">' + _fmtDate(r.loiDeadline) + _urgencyChip(r.loiDeadline) + '</td>' +
            '<td style="padding:5px 8px">' + _fmtDate(r.deadline) + _urgencyChip(r.deadline) + '</td>' +
            '<td style="padding:5px 8px;text-align:right">' + _fmtMoney(r.available) + '</td>' +
            '<td style="padding:5px 8px;text-align:right">' + _fmtMoney(r.maxPerProject) + '</td>' +
            '<td style="padding:5px 0 5px 8px">' + compPill + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>' +
      '<div style="margin-top:.5rem;font-size:.72rem;color:var(--muted)">' +
        '<strong>Reading:</strong> LOI (Letter of Intent) is the threshold gate — most DOH programs require an LOI ~30–45 days before the application closes. ' +
        'Available = current cycle remaining; Max/project = ceiling on any single deal\'s ask. ' +
        'Most programs are statewide-eligible; per-jurisdiction eligibility is reflected in the "Soft-funding programs eligible" row in the comparison below.' +
      '</div>';

    host.innerHTML = html;
  }

  function render() {
    var n = state.selectedGeoids.length;
    var empty = n === 0;
    $('cmpEmpty').hidden = !empty;
    $('cmpTableWrap').hidden = empty;
    $('cmpControls').hidden = false;

    // Status
    $('cmpStatus').textContent = empty
      ? ''
      : 'Comparing ' + n + ' of max ' + MAX_COMPARE + ' jurisdictions. Active target: ' +
        ({'9pct':'9% Competitive','4pct':'4% Bond','preservation':'Preservation','workforce_resort':'Workforce / Resort','prop123_local':'Prop 123 / Local','any':'Balanced'}[state.target]);

    if (empty) return;

    // F176 — Soft-funding deadlines panel above the comparison table.
    // Surfaces what an underwriter needs to see RIGHT NOW for any deal
    // they're scoping in any of the selected jurisdictions — LOI dates
    // are screening gates, application deadlines are the actual filings.
    // Renders only once per comparison render — no per-jurisdiction
    // variability for statewide programs (the per-place
    // softFundingEligible row below the comparison body handles the
    // jurisdiction-specific count).
    _renderSoftFundingDeadlinesPanel();

    // Build records
    var records = state.selectedGeoids.map(buildRecord).filter(Boolean);

    // Build header row
    var head = '<th class="cmp-dim-label">Dimension</th>';
    records.forEach(function (rec) {
      head += '<th>' +
        '<button class="cmp-rmBtn" type="button" data-geoid="' + escHtml(rec.placeGeoid) + '" title="Remove">×</button>' +
        '<span class="cmp-name">' + escHtml(rec.name) + '</span>' +
        '<span class="cmp-county">' + escHtml(rec.countyName) + ' · ' + escHtml(rec.type) + '</span>' +
      '</th>';
    });
    $('cmpHeadRow').innerHTML = head;

    // Build body. F13: track win-count per jurisdiction across all numeric
    // dimensions so we can render an "Overall winner" verdict above the table.
    var winsByIdx = new Array(records.length).fill(0);
    var body = '';
    ROWS.forEach(function (row) {
      if (row.group) {
        body += '<tr class="cmp-row-header"><td colspan="' + (records.length + 1) + '">' + escHtml(row.group) + '</td></tr>';
        return;
      }
      // Row label cell with click-to-toggle info popover when row.info exists
      var hasInfo = !!row.info;
      var labelCell = hasInfo
        ? '<td class="cmp-dim-label cmp-dim-label--clickable" tabindex="0" role="button" aria-expanded="false" ' +
            'title="Click for definition + formula" ' +
            'data-info="' + escHtml(row.info) + '">' +
            escHtml(row.label) + ' <span class="cmp-info-icon" aria-hidden="true">ⓘ</span>' +
          '</td>'
        : '<td class="cmp-dim-label">' + escHtml(row.label) + '</td>';
      body += '<tr>' + labelCell;
      // Compute all values
      var vals = records.map(function (r) { return row.fn(r, state.target); });
      // Find best (numeric only)
      var numericVals = vals.filter(function (v) { return typeof v === 'number' && Number.isFinite(v); });
      var bestVal = null;
      if (!row.raw && numericVals.length) {
        bestVal = row.best === 'low' ? Math.min.apply(null, numericVals) : Math.max.apply(null, numericVals);
      }
      vals.forEach(function (v, idx) {
        var isBest = !row.raw && bestVal != null && v === bestVal && numericVals.length > 1;
        if (isBest) winsByIdx[idx]++;
        // F13: add visible "✓ best" pill inside the winning cell so users
        // see WHICH cell won without relying only on background tint.
        var cls = isBest ? 'cmp-best' : '';
        // F25: pass the record as a 2nd arg so fmt can annotate (e.g. the
        // bond-cap row marks county-level fallbacks with a "county" pill).
        var content = (row.fmt ? row.fmt(v, records[idx]) : v);
        if (isBest) {
          content = '<span class="cmp-best-mark" aria-label="best in row">✓</span> ' + content;
        }
        body += '<td class="' + cls + '">' + content + '</td>';
      });
      body += '</tr>';
    });
    $('cmpBody').innerHTML = body;

    // F13: render Overall winner verdict above the table. Picks the
    // jurisdiction with the most per-dimension wins. Ties broken by
    // active-target composite score.
    _renderVerdict(records, winsByIdx);

    // Wire remove buttons
    Array.from($('cmpHeadRow').querySelectorAll('.cmp-rmBtn')).forEach(function (btn) {
      btn.addEventListener('click', function () { _rmJurisdiction(btn.getAttribute('data-geoid')); });
    });

    // Wire info popovers — click label to toggle inline definition row
    Array.from($('cmpBody').querySelectorAll('.cmp-dim-label--clickable')).forEach(function (cell) {
      function toggle() {
        var existing = cell.parentElement.nextElementSibling;
        if (existing && existing.classList.contains('cmp-info-row')) {
          existing.remove();
          cell.setAttribute('aria-expanded', 'false');
          return;
        }
        var info = cell.getAttribute('data-info');
        var nCols = cell.parentElement.children.length;
        var row = document.createElement('tr');
        row.className = 'cmp-info-row';
        row.innerHTML = '<td colspan="' + nCols + '" class="cmp-info-cell">💡 ' + info + '</td>';
        cell.parentElement.parentNode.insertBefore(row, cell.parentElement.nextSibling);
        cell.setAttribute('aria-expanded', 'true');
      }
      cell.addEventListener('click', toggle);
      cell.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
  }

  /* ── URL sync ─────────────────────────────────────────────────────── */
  function _syncUrl() {
    var u = new URL(window.location.href);
    if (state.selectedGeoids.length) {
      u.searchParams.set('jurisdictions', state.selectedGeoids.join(','));
    } else {
      u.searchParams.delete('jurisdictions');
    }
    if (state.target && state.target !== '9pct') {
      u.searchParams.set('target', state.target);
    } else {
      u.searchParams.delete('target');
    }
    history.replaceState({}, '', u);
  }
  function _readUrlParams() {
    var u = new URL(window.location.href);
    var j = u.searchParams.get('jurisdictions');
    if (j) {
      state.selectedGeoids = j.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return /^\d{7}$/.test(s); }).slice(0, MAX_COMPARE);
    }
    var t = u.searchParams.get('target');
    if (t && SCORE_WEIGHTS[t]) state.target = t;

    // F203 — WorkflowState fallback. If the URL has NO jurisdictions param
    // and the user is mid-workflow (active project has a jurisdiction),
    // pre-seed Compare with that jurisdiction so cross-page navigation
    // from HNA / Deal Calc / Select Jurisdiction isn't a dead end.
    // F216 — also call _syncUrl() after hydration so a copy-paste of the
    // current URL carries the jurisdiction (audit catch #5). Counties are
    // explicitly skipped — Compare's data model is place-only (catch #6).
    if (!state.selectedGeoids.length && window.WorkflowState && window.WorkflowState.getActiveProject) {
      try {
        var proj = window.WorkflowState.getActiveProject();
        var jx = proj && (proj.jurisdiction || (proj.steps && proj.steps.jurisdiction));
        var g = jx && (jx.geoid || '').replace(/\D/g, '');
        if (g && /^\d{7}$/.test(g)) {
          state.selectedGeoids = [g];
          _syncUrl();  // F216: persist hydration so copy/share shows the geoid
          console.log('[Compare] Hydrated selectedGeoids from WorkflowState:', g);
        } else if (g && /^\d{5}$/.test(g)) {
          // Compare supports places only. County-level workflows can't be
          // hydrated — log so the user sees why the page didn't pre-seed.
          console.log('[Compare] WorkflowState jurisdiction is a county FIPS (' + g + '); Compare supports 7-digit place geoids only.');
        }
      } catch (_) {}
    }
  }

  /* ── Wire UI ──────────────────────────────────────────────────────── */
  function _populateAddSelect() {
    var sel = $('cmpAddSel');
    // Get all place GEOIDs from place-membership, sorted by name
    var entries = Object.entries(state.placeMembership)
      .map(function (e) { return { geoid: e[0], name: (e[1].name || e[0]) }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    entries.forEach(function (e) {
      var meta = state.placeMeta[e.geoid] || {};
      var label = e.name + (meta.containingCounty && state.countyName[meta.containingCounty] ? '  (' + state.countyName[meta.containingCounty] + ')' : '');
      var opt = document.createElement('option');
      opt.value = e.geoid;
      opt.textContent = label;
      sel.appendChild(opt);
    });
  }

  function _wire() {
    $('cmpAddBtn').addEventListener('click', function () {
      var sel = $('cmpAddSel');
      var g = sel.value;
      if (!g || state.selectedGeoids.indexOf(g) !== -1) return;
      if (state.selectedGeoids.length >= MAX_COMPARE) {
        alert('Max ' + MAX_COMPARE + ' jurisdictions at once.');
        return;
      }
      state.selectedGeoids.push(g);
      sel.value = '';
      _syncUrl();
      render();
    });
    $('cmpClearBtn').addEventListener('click', function () {
      state.selectedGeoids = [];
      _syncUrl();
      render();
    });
    $('cmpTargetSel').addEventListener('change', function () {
      state.target = $('cmpTargetSel').value;
      _syncUrl();
      render();
    });
  }

  /* ── Boot ─────────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    loadAll().then(function () {
      _readUrlParams();
      _populateAddSelect();
      $('cmpTargetSel').value = state.target;
      _wire();
      render();
    }).catch(function (e) {
      console.error('compare: load failed', e);
      $('cmpStatus').textContent = 'Failed to load data: ' + (e && e.message);
    });
  });
}());
