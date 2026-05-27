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
  var MAX_RECENCY_YEARS = 25;
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
    needDist: []
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
  function needCompositeFor(fips) {
    var r = state.chasByFips[fips]; if (!r || !r.summary) return null;
    var s = r.summary;
    var rH = +s.total_renter_hh || 0, oH = +s.total_owner_hh || 0, total = rH + oH;
    if (!total) return null;
    var blended = (s.pct_renter_cb30 * rH + s.pct_owner_cb30 * oH) / total;
    var severe = +s.pct_renter_cb50 || 0;
    return blended * 0.7 + severe * 0.3;
  }
  function needScoreFor(fips) {
    var c = needCompositeFor(fips); if (c == null) return 30;
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
    function soft(url) { return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    return Promise.all([
      fetch('data/qct-colorado.json').then(function (r) { return r.json(); }),
      fetch('data/dda-colorado.json').then(function (r) { return r.json(); }),
      fetch('data/chfa-lihtc.json').then(function (r) { return r.json(); }),
      fetch('data/hna/chas_affordability_gap.json').then(function (r) { return r.json(); }),
      fetch('data/hna/place-tract-membership.json').then(function (r) { return r.json(); }),
      fetch('data/co_ami_gap_by_place.json').then(function (r) { return r.json(); }),
      fetch('data/hna/geo-config.json').then(function (r) { return r.json(); }),
      soft('data/policy/housing-policy-scorecard.json'),
      soft('data/affordable-housing/properties.json')
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
    });
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
    var lastYear = inside.reduce(function (m, p) {
      var y = parseInt(p.properties.YR_PIS, 10);
      return (Number.isFinite(y) && y > m) ? y : m;
    }, -Infinity);
    if (lastYear === -Infinity) lastYear = null;

    // Population proxy
    var ami = state.placeFromAmi[placeGeoid];
    var pop = (ami && ami.households_le_ami_pct && ami.households_le_ami_pct['100'])
      ? Math.round((+ami.households_le_ami_pct['100'] || 0) * 2.5) : null;

    // Civic
    var civic = state.policyScores[placeGeoid] || (containingCounty ? state.policyScores[containingCounty] : null);
    var civicRaw = civic && Number.isFinite(civic.totalScore) ? civic.totalScore : null;
    var civicMax = civic && Number.isFinite(civic.maxPossible) && civic.maxPossible > 0 ? civic.maxPossible : 7;
    var civicPct = civicRaw != null ? Math.round((civicRaw / civicMax) * 100) : 0;

    // Preservation
    var prec = state.preservationByCity[cityUpper] || { total: 0, urgent5y: 0 };

    // Component scores
    var rec = recencyScore(lastYear);
    var need = needScoreFor(containingCounty);
    var bb = basisScore(hasQct, hasDda);
    var p = popScore(pop);
    var jType = meta.type || 'place';

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
      population: pop,
      civicScore: civicPct,
      civicRawScore: civicRaw,
      preservationCount: prec.total,
      preservationUrgent5y: prec.urgent5y,
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
    { label: '9% Competitive', info: 'Weights: 30% need · 30% recency · 15% basis · 15% pop · 10% civic. Rewards geographic-gap markets (CHFA QAP scoring).',
      fn: function (r) { return r.score9; }, fmt: function (v) { return v + '/100'; }, best: 'high' },
    { label: '4% Bond', info: 'Weights: 25% need · 15% recency · 15% basis · 30% pop · 15% civic. Rewards scale (bonds need ~150+ units to pencil).',
      fn: function (r) { return r.score4; }, fmt: function (v) { return v + '/100'; }, best: 'high' },
    { label: 'Preservation', info: 'Weights: 20% need · 15% recency · 35% basis · 10% pop · 20% civic. Rewards subsidy-stack feasibility for 4% refi + Year-15 LIHTC exits.',
      fn: function (r) { return r.scorePreservation; }, fmt: function (v) { return v + '/100'; }, best: 'high' },
    { label: 'Workforce / Resort', info: 'Weights: 25% need · 15% recency · 15% basis · 30% pop · 15% civic. Mountain/resort markets with severe workforce-housing pressure.',
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
    { label: 'Civic Readiness', info: 'Count of 7 civic-capacity dimensions (Prop 123 ✓, HNA ✓, comp plan ✓, IZ ✓, local funding ✓, housing authority ✓, nonprofits ✓) ÷ known dims × 100. Source: housing-policy-scorecard.json.',
      fn: function (r) { return r.civicScore; }, fmt: function (v) { return v + '/100'; }, best: 'high' },

    { group: 'Designations + Capacity' },
    { label: 'QCT', info: 'Qualified Census Tract — IRC §42(d)(5)(B)(ii). Tracts with ≥50% of HHs below 60% AMI or ≥25% poverty rate. Eligible for 30% basis boost.',
      fn: function (r) { return r.hasQct ? 'Yes (' + r.qctCount + ')' : 'No'; }, fmt: function (v) { return v; }, raw: true },
    { label: 'DDA', info: 'Difficult Development Area — IRC §42(d)(5)(B)(iii). HUD-designated nonmetro CO counties (10 currently) where construction cost exceeds local rents.',
      fn: function (r) { return r.hasDda ? 'Yes' : 'No'; }, fmt: function (v) { return v; }, raw: true },
    { label: 'Civic dimensions filled', info: 'Raw count of populated civic-capacity flags (out of 7). null indicates data wasn\'t researched.',
      fn: function (r) { return r.civicRawScore == null ? '—' : (r.civicRawScore + '/7'); }, fmt: function (v) { return v; }, raw: true },

    { group: 'LIHTC pipeline' },
    { label: 'Last LIHTC award year', info: 'Most recent CHFA AwardYear for any project with PROJ_CTY matching this jurisdiction. AwardYear is when CHFA reserved the credits (typically 2–3y before placed-in-service).',
      fn: function (r) { return r.lastYear || 'Never'; }, fmt: function (v) { return v; }, raw: true },
    { label: 'LIHTC projects on record', info: 'Count of CHFA-tracked LIHTC projects matching this jurisdiction\'s name. Lower = more saturation headroom = stronger 9% competitive case.',
      fn: function (r) { return r.projectCount; }, fmt: function (v) { return v; }, best: 'low' },

    { group: 'Preservation pipeline' },
    { label: 'Preservation candidates', info: 'CHFA-tracked at-risk subsidized rental properties (CHFA Preservation 1,688 + HUD MF Assisted 343 + USDA Rural 116). High count = preservation deal opportunity.',
      fn: function (r) { return r.preservationCount; }, fmt: function (v) { return v; }, best: 'high' },
    { label: '  …expiring ≤5 years', info: 'USDA Rural Housing properties whose Restrictive Clause Expiration falls within the next 5 years. Most-urgent preservation candidates.',
      fn: function (r) { return r.preservationUrgent5y; }, fmt: function (v) { return v > 0 ? '<span class="cmp-pill cmp-pill--med">' + v + '</span>' : '0'; }, best: 'high' },

    { group: 'Demographics' },
    { label: 'Population (proxy)', info: 'HHs ≤100% AMI × 2.5 (avg CO HH size). Proxy because ACS B01003 isn\'t yet wired in. Resort markets understated (HH-based, not B01003 — but actually CLOSER to renter-base truth in resort markets).',
      fn: function (r) { return r.population; }, fmt: function (v) { return v != null ? fmtInt(v) : '—'; }, best: 'high' }
  ];

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
        var content = (row.fmt ? row.fmt(v) : v);
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
