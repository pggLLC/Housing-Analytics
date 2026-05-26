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
 * Sources: HUD QCT + DDA designations, HUD LIHTC project data,
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
    projects: [],                   // HUD LIHTC project points (filtered to valid YR_PIS)
    chasByFips: {},                 // 5-digit county FIPS → CHAS county record
    countyName: {},                 // 5-digit county FIPS → display name
    placeMeta: {},                  // place geoid → { label, containingCounty, type }
    opportunities: [],
    map: null,
    layers: { jurisdiction: null, dda: null, qct: null, highlight: null },
    selectedId: null,
    sortKey: 'score',
    sortDir: 'desc',
    filters: {
      target: '9pct',     // '9pct' | '4pct' | 'any'
      requireQct: false,
      requireDda: false,
      requireBoth: true,  // user's primary ask — default ON
      county: '',
      minYearsSince: 0,
      minScore: 0,
      minPop: 0,
      includeCdps: false  // CDPs aren't incorporated; LIHTC typically goes in incorporated places
    }
  };

  var CURRENT_YEAR = new Date().getFullYear();
  var MAX_RECENCY_YEARS = 25;

  /* ── Score weights by target ──────────────────────────────────────── */

  var SCORE_WEIGHTS = {
    '9pct': { recency: 0.40, need: 0.30, basis: 0.20, pop: 0.10 },
    '4pct': { recency: 0.25, need: 0.25, basis: 0.15, pop: 0.35 },
    'any':  { recency: 0.35, need: 0.30, basis: 0.20, pop: 0.15 }
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

  function compositeScore(rec, need, basis, pop, target) {
    var w = SCORE_WEIGHTS[target] || SCORE_WEIGHTS.any;
    return Math.round(rec * w.recency + need * w.need + basis * w.basis + pop * w.pop);
  }

  /* ── Data loading ─────────────────────────────────────────────────── */

  function loadAll() {
    setStatus('Loading jurisdiction data (HUD QCT, DDA, LIHTC, CHAS, place memberships)…');
    return Promise.all([
      fetch('data/qct-colorado.json').then(function (r) { return r.json(); }),
      fetch('data/dda-colorado.json').then(function (r) { return r.json(); }),
      fetch('data/market/hud_lihtc_co.geojson').then(function (r) { return r.json(); }),
      fetch('data/hna/chas_affordability_gap.json').then(function (r) { return r.json(); }),
      fetch('data/hna/place-tract-membership.json').then(function (r) { return r.json(); }),
      fetch('data/co_ami_gap_by_place.json').then(function (r) { return r.json(); }),
      fetch('data/hna/geo-config.json').then(function (r) { return r.json(); })
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

      // HUD LIHTC projects, filtered to valid YR_PIS
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

      setStatus('Rolling up ' + Object.keys(state.placeMembership).length +
        ' jurisdictions against ' + state.qctTractIds.size + ' QCTs · ' +
        state.ddaCountyFips.size + ' DDAs · ' + state.projects.length + ' LIHTC projects…');
    });
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

      // Skip jurisdictions with NEITHER (not basis-boost eligible)
      if (!hasQct && !hasDda) return;

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

      // Compute score for each target — we'll use the active one in the table
      var score9 = compositeScore(recScore, needPct, bbScore, popScore, '9pct');
      var score4 = compositeScore(recScore, needPct, bbScore, popScore, '4pct');
      var scoreAny = compositeScore(recScore, needPct, bbScore, popScore, 'any');

      ops.push({
        id:           placeGeoid,
        placeGeoid:   placeGeoid,
        name:         placeNameToCity(label),
        labelFull:    label,
        type:         type,
        containingCounty: containingCounty,
        countyName:   state.countyName[containingCounty] || (containingCounty ? 'County ' + containingCounty : '—'),
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
        // Target-specific composites
        score9:       score9,
        score4:       score4,
        scoreAny:     scoreAny
      });
    });

    state.opportunities = ops;
  }

  /* ── Filtering ────────────────────────────────────────────────────── */

  function _activeScore(op) {
    var t = state.filters.target;
    if (t === '9pct') return op.score9;
    if (t === '4pct') return op.score4;
    return op.scoreAny;
  }

  function _applyFilters() {
    var f = state.filters;
    return state.opportunities.filter(function (op) {
      if (f.requireBoth && !op.hasBoth) return false;
      if (f.requireQct && !op.hasQct) return false;
      if (f.requireDda && !op.hasDda) return false;
      if (!f.includeCdps && op.type === 'cdp') return false;
      if (f.county && op.containingCounty !== f.county) return false;
      if (f.minYearsSince > 0 && (op.yearsSince == null || op.yearsSince < f.minYearsSince)) return false;
      if (f.minScore > 0 && _activeScore(op) < f.minScore) return false;
      if (f.minPop > 0 && (op.population || 0) < f.minPop) return false;
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
    var targetLabel = state.filters.target === '9pct' ? '9% Competitive'
                    : state.filters.target === '4pct' ? '4% Bond'
                    : 'Balanced (any)';
    var html =
      '<div class="lof-summary-card"><div class="k">Target round</div>' +
        '<div class="v" style="font-size:.95rem;line-height:1.25">' + targetLabel + '</div>' +
        '<div class="s">' + (
          state.filters.target === '9pct' ? '40·30·20·10 weighting' :
          state.filters.target === '4pct' ? '25·25·15·35 weighting' :
                                             '35·30·20·15 weighting'
        ) + '</div></div>' +
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

  function _renderTable(filtered) {
    var tbody = $('lofTableBody');
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="lof-loading">No jurisdictions match the current filters.</td></tr>';
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
          '<div style="font-size:.72rem;color:var(--muted);text-transform:capitalize">' + escHtml(op.type) + '</div></td>' +
        '<td>' + typeHtml + (op.qctCount > 1 ? '<span style="font-size:.7rem;color:var(--muted);margin-left:4px">×' + op.qctCount + '</span>' : '') + '</td>' +
        '<td>' + escHtml(op.countyName) + '</td>' +
        '<td>' + lastFundedText + '</td>' +
        '<td>' + op.projectCount + (op.totalUnits ? ' <span style="color:var(--muted);font-size:.72rem">(' + fmtInt(op.totalUnits) + ' u)</span>' : '') + '</td>' +
        '<td>' + (op.needScore != null ? op.needScore : '—') + '<span style="font-size:.7rem;color:var(--muted)">p</span></td>' +
        '<td>' + (op.population != null ? fmtInt(op.population) : '—') + '</td>' +
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
    ['jurisdiction', 'dda', 'qct', 'highlight'].forEach(function (k) {
      if (state.layers[k]) {
        state.map.removeLayer(state.layers[k]);
        state.layers[k] = null;
      }
    });

    // Draw DDA county polygons (light blue) for jurisdictions in DDA counties
    var ddaCountyInFilter = new Set();
    filtered.forEach(function (op) {
      if (op.hasDda && op.containingCounty) ddaCountyInFilter.add(op.containingCounty);
    });
    var ddaLayer = window.L.layerGroup();
    state.ddaFeatures.forEach(function (f) {
      var fips = f.properties && f.properties.GEOID;
      if (!fips || !ddaCountyInFilter.has(fips)) return;
      var coords = f.geometry.coordinates;
      var rings;
      if (f.geometry.type === 'Polygon') {
        rings = coords.map(function (ring) {
          return ring.map(function (c) { return [c[1], c[0]]; });
        });
      } else if (f.geometry.type === 'MultiPolygon') {
        rings = coords.map(function (poly) {
          return poly.map(function (ring) {
            return ring.map(function (c) { return [c[1], c[0]]; });
          });
        });
      } else return;
      var poly = window.L.polygon(rings, {
        color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.08, opacity: 0.5,
        interactive: false
      });
      ddaLayer.addLayer(poly);
    });
    ddaLayer.addTo(state.map);
    state.layers.dda = ddaLayer;

    // Markers for each jurisdiction using its centroid (computed from
    // average of containing tracts — approximate but fast)
    var jurisLayer = window.L.layerGroup();
    filtered.forEach(function (op) {
      var lat = null, lng = null;
      // Use any LIHTC project in the jurisdiction as the marker anchor;
      // failing that, fall back to county centroid.
      if (op.projects.length) {
        var c = op.projects[0].geometry.coordinates;
        lng = c[0]; lat = c[1];
      } else if (op.containingCounty) {
        // Approximate county centroid from CHAS / fallback to state center
        lat = 39.0; lng = -105.5;
      }
      if (lat == null) return;
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

    var facts = $('lofDetailFacts');
    facts.innerHTML =
      '<dt>Designation</dt><dd>' + designations.join(' + ') + '</dd>' +
      '<dt>9% Competitive score</dt><dd>' + op.score9 + '/100  ' +
        '<span style="color:var(--muted);font-size:.78rem">(rec ' + op.recencyScore +
        ' · need p' + op.needScore + ' · basis ' + op.basisBoostScore +
        ' · pop ' + op.populationScore + ')</span></dd>' +
      '<dt>4% Bond score</dt><dd>' + op.score4 + '/100</dd>' +
      '<dt>Last LIHTC project</dt><dd>' + (op.lastYear != null
        ? op.lastYear + ' (' + op.yearsSince + ' years ago)'
        : '<em>Never funded on record</em>') + '</dd>' +
      '<dt>Existing LIHTC stock</dt><dd>' + op.projectCount + ' project(s) · ' +
        fmtInt(op.totalUnits) + ' total units</dd>' +
      '<dt>HNA need composite</dt><dd>' + (op.needCompositePct != null ? op.needCompositePct + '% ' : '') +
        '<span style="color:var(--muted);font-size:.78rem">(CO percentile rank: p' + op.needScore + ')</span></dd>' +
      '<dt>Population (approx)</dt><dd>' + (op.population != null ? fmtInt(op.population) : 'unknown') + '</dd>' +
      (op.qctCount > 0 ?
        '<dt>QCT tracts in jurisdiction</dt><dd style="font-family:ui-monospace,monospace;font-size:.78rem">' +
          op.qctTracts.map(function (t) { return t.tract_geoid; }).join(', ') +
        '</dd>' : '');

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
    state.opportunities.forEach(function (op) {
      if (op.containingCounty) counties[op.containingCounty] = op.countyName;
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
  }

  function _wireFilters() {
    var targetRadios = document.querySelectorAll('input[name="lofTarget"]');
    targetRadios.forEach(function (r) {
      r.addEventListener('change', function () {
        if (r.checked) {
          state.filters.target = r.value;
          _refresh();
        }
      });
    });

    var reqQct = $('lofRequireQct'), reqDda = $('lofRequireDda'), reqBoth = $('lofRequireBoth');
    [reqQct, reqDda, reqBoth].forEach(function (el) {
      if (!el) return;
      el.addEventListener('change', function () {
        state.filters.requireQct = reqQct.checked;
        state.filters.requireDda = reqDda.checked;
        state.filters.requireBoth = reqBoth.checked;
        _refresh();
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

    $('lofResetFilters').addEventListener('click', function () {
      state.filters = {
        target: '9pct',
        requireQct: false, requireDda: false, requireBoth: true,
        county: '', minYearsSince: 0, minScore: 0, minPop: 0,
        includeCdps: false
      };
      document.querySelector('input[name="lofTarget"][value="9pct"]').checked = true;
      reqQct.checked = false; reqDda.checked = false; reqBoth.checked = true;
      if (includeCdps) includeCdps.checked = false;
      $('lofCounty').value = '';
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
    state.map = window.L.map('lofMap', { preferCanvas: true }).setView([39.0, -105.5], 7);
    var cartoLight = window.L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { attribution: '© OpenStreetMap contributors © CARTO', subdomains: 'abcd', maxZoom: 19 }
    );
    var esriSat = window.L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles © Esri', maxZoom: 19 }
    );
    cartoLight.addTo(state.map);
    window.L.control.layers(
      { 'Street': cartoLight, 'Satellite': esriSat },
      null,
      { position: 'topright', collapsed: true }
    ).addTo(state.map);
  }

  /* ── Boot ─────────────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', function () {
    _initMap();
    loadAll()
      .then(function () {
        _computeOpportunities();
        _populateFilterDropdowns();
        _wireFilters();
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
