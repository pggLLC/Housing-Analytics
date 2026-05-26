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
  var SCORE_WEIGHTS = {
    '9pct':             { need: 0.30, recency: 0.30, basis: 0.15, pop: 0.15, civic: 0.10 },
    '4pct':             { need: 0.25, recency: 0.15, basis: 0.15, pop: 0.30, civic: 0.15 },
    'preservation':     { need: 0.20, recency: 0.15, basis: 0.35, pop: 0.10, civic: 0.20 },
    'workforce_resort': { need: 0.25, recency: 0.15, basis: 0.15, pop: 0.30, civic: 0.15 },
    'prop123_local':    { need: 0.25, recency: 0.10, basis: 0.20, pop: 0.15, civic: 0.30 },
    'any':              { need: 0.25, recency: 0.20, basis: 0.15, pop: 0.20, civic: 0.20 }
  };
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
  function composite(rec, need, basis, pop, civic, target) {
    var w = SCORE_WEIGHTS[target] || SCORE_WEIGHTS.any;
    var c = Number.isFinite(civic) ? civic : 0;
    return Math.round(rec * w.recency + need * w.need + basis * w.basis + pop * w.pop + c * w.civic);
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

    return {
      placeGeoid: placeGeoid,
      name: label,
      type: meta.type || 'place',
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
      // All six target composites
      score9:            composite(rec, need, bb, p, civicPct, '9pct'),
      score4:            composite(rec, need, bb, p, civicPct, '4pct'),
      scorePreservation: composite(rec, need, bb, p, civicPct, 'preservation'),
      scoreWorkforce:    composite(rec, need, bb, p, civicPct, 'workforce_resort'),
      scoreProp123:      composite(rec, need, bb, p, civicPct, 'prop123_local'),
      scoreAny:          composite(rec, need, bb, p, civicPct, 'any')
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
  function _rmJurisdiction(geoid) {
    state.selectedGeoids = state.selectedGeoids.filter(function (g) { return g !== geoid; });
    _syncUrl();
    render();
  }

  // Row definitions: { label, key fn (rec) → value, formatFn (val) → cell html, best='high'|'low' }
  var ROWS = [
    { group: 'Composite scores' },
    { label: 'Active target score',  fn: function (r, t) { return activeScore(r, t); }, fmt: function (v) { return '<strong>' + v + '</strong>/100'; }, best: 'high' },
    { label: '9% Competitive',       fn: function (r) { return r.score9; },            fmt: function (v) { return v + '/100'; }, best: 'high' },
    { label: '4% Bond',              fn: function (r) { return r.score4; },            fmt: function (v) { return v + '/100'; }, best: 'high' },
    { label: 'Preservation',         fn: function (r) { return r.scorePreservation; }, fmt: function (v) { return v + '/100'; }, best: 'high' },
    { label: 'Workforce / Resort',   fn: function (r) { return r.scoreWorkforce; },    fmt: function (v) { return v + '/100'; }, best: 'high' },
    { label: 'Prop 123 / Local',     fn: function (r) { return r.scoreProp123; },      fmt: function (v) { return v + '/100'; }, best: 'high' },
    { label: 'Balanced (any)',       fn: function (r) { return r.scoreAny; },          fmt: function (v) { return v + '/100'; }, best: 'high' },

    { group: 'Component scores (0–100)' },
    { label: 'Housing Need',         fn: function (r) { return r.needScore; },        fmt: function (v) { return v + 'p'; }, best: 'high' },
    { label: 'Recency / Competition',fn: function (r) { return r.recencyScore; },     fmt: function (v) { return v; }, best: 'high' },
    { label: 'Basis-Boost',          fn: function (r) { return r.basisScore; },       fmt: function (v) { return v; }, best: 'high' },
    { label: 'Population / Feasibility', fn: function (r) { return r.popScore; },     fmt: function (v) { return v; }, best: 'high' },
    { label: 'Civic Readiness',      fn: function (r) { return r.civicScore; },       fmt: function (v) { return v + '/100'; }, best: 'high' },

    { group: 'Designations + Capacity' },
    { label: 'QCT', fn: function (r) { return r.hasQct ? 'Yes (' + r.qctCount + ')' : 'No'; }, fmt: function (v) { return v; }, raw: true },
    { label: 'DDA', fn: function (r) { return r.hasDda ? 'Yes' : 'No'; }, fmt: function (v) { return v; }, raw: true },
    { label: 'Civic dimensions filled', fn: function (r) { return r.civicRawScore == null ? '—' : (r.civicRawScore + '/7'); }, fmt: function (v) { return v; }, raw: true },

    { group: 'LIHTC pipeline' },
    { label: 'Last LIHTC award year', fn: function (r) { return r.lastYear || 'Never'; }, fmt: function (v) { return v; }, raw: true },
    { label: 'LIHTC projects on record', fn: function (r) { return r.projectCount; }, fmt: function (v) { return v; }, best: 'low' },

    { group: 'Preservation pipeline' },
    { label: 'Preservation candidates', fn: function (r) { return r.preservationCount; }, fmt: function (v) { return v; }, best: 'high' },
    { label: '  …expiring ≤5 years',    fn: function (r) { return r.preservationUrgent5y; }, fmt: function (v) { return v > 0 ? '<span class="cmp-pill cmp-pill--med">' + v + '</span>' : '0'; }, best: 'high' },

    { group: 'Demographics' },
    { label: 'Population (proxy)',   fn: function (r) { return r.population; }, fmt: function (v) { return v != null ? fmtInt(v) : '—'; }, best: 'high' }
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

    // Build body
    var body = '';
    ROWS.forEach(function (row) {
      if (row.group) {
        body += '<tr class="cmp-row-header"><td colspan="' + (records.length + 1) + '">' + escHtml(row.group) + '</td></tr>';
        return;
      }
      body += '<tr><td class="cmp-dim-label">' + escHtml(row.label) + '</td>';
      // Compute all values
      var vals = records.map(function (r) { return row.fn(r, state.target); });
      // Find best (numeric only)
      var numericVals = vals.filter(function (v) { return typeof v === 'number' && Number.isFinite(v); });
      var bestVal = null;
      if (!row.raw && numericVals.length) {
        bestVal = row.best === 'low' ? Math.min.apply(null, numericVals) : Math.max.apply(null, numericVals);
      }
      vals.forEach(function (v) {
        var isBest = !row.raw && bestVal != null && v === bestVal && numericVals.length > 1;
        var cls = isBest ? 'cmp-best' : '';
        body += '<td class="' + cls + '">' + (row.fmt ? row.fmt(v) : v) + '</td>';
      });
      body += '</tr>';
    });
    $('cmpBody').innerHTML = body;

    // Wire remove buttons
    Array.from($('cmpHeadRow').querySelectorAll('.cmp-rmBtn')).forEach(function (btn) {
      btn.addEventListener('click', function () { _rmJurisdiction(btn.getAttribute('data-geoid')); });
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
