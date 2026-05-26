/**
 * js/lihtc-opportunity-finder.js
 *
 * Client-side analysis that joins HUD LIHTC projects to QCT + DDA polygons,
 * computes a per-area opportunity score, and drives a filterable ranked
 * table + Leaflet map. No build pipeline — all data is loaded directly
 * from /data/ and the join happens in-browser at page load.
 *
 * Scoring (matches the methodology disclosure in the page):
 *   opportunity = 0.35 * recency
 *               + 0.30 * housing_need
 *               + 0.20 * basis_boost
 *               + 0.15 * population_feasibility
 *
 * Data sources:
 *   data/qct-colorado.json                 — 224 QCT polygons
 *   data/dda-colorado.json                 — 10 DDA polygons
 *   data/market/hud_lihtc_co.geojson       — 716 LIHTC project points (YR_PIS)
 *   data/hna/chas_affordability_gap.json   — Housing-need composite per county
 *   data/market/acs_tract_metrics_co.json  — Population per tract (for QCT pop join)
 *
 * Author: 2026-05-25 LIHTC Opportunity Finder MVP.
 */

(function () {
  'use strict';

  /* ── State ────────────────────────────────────────────────────────── */

  var state = {
    qctFeatures: [],     // raw QCT polygons
    ddaFeatures: [],     // raw DDA polygons
    projects:    [],     // HUD LIHTC project points (filtered to valid YR_PIS)
    chasByFips:  {},     // CHAS data keyed by 5-digit county FIPS
    tractPop:    {},     // population by 11-digit tract GEOID
    countyName:  {},     // county FIPS → display name
    opportunities: [],   // computed per-area records (after _computeOpportunities)
    map:         null,
    layers:      { qct: null, dda: null, projects: null, highlight: null },
    selectedId:  null,
    sortKey:     'score',
    sortDir:     'desc',
    filters: {
      showQct: true, showDda: true, showBoth: true,
      county: '', city: '',
      minYearsSince: 0, minScore: 0, minPop: 0
    }
  };

  var CURRENT_YEAR = new Date().getFullYear();
  var MAX_RECENCY_YEARS = 25;  // years-since-last capped at 25 for score

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
  function fmtMaybe(s) {
    return (s != null && s !== '') ? s : '—';
  }
  function setStatus(text) {
    var el = $('lofStatusBanner');
    if (el) el.textContent = text;
  }

  // Ray-casting point-in-polygon. polygon = array of [lng, lat] rings.
  // For MultiPolygon callers iterate the outer container themselves.
  function pointInPolygon(lng, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1];
      var xj = ring[j][0], yj = ring[j][1];
      var intersect = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Test whether a Point falls inside a GeoJSON Polygon or MultiPolygon.
  function pointInGeoFeature(lng, lat, feature) {
    var g = feature.geometry;
    if (!g) return false;
    if (g.type === 'Polygon') {
      // First ring = outer, subsequent = holes. For LIHTC opportunity
      // analysis the hole case is rare enough we treat outer ring only.
      return pointInPolygon(lng, lat, g.coordinates[0]);
    }
    if (g.type === 'MultiPolygon') {
      for (var i = 0; i < g.coordinates.length; i++) {
        if (pointInPolygon(lng, lat, g.coordinates[i][0])) return true;
      }
    }
    return false;
  }

  // Centroid of polygon ring (rough average — good enough for naming /
  // map labels, not for area calculations).
  function ringCentroid(ring) {
    var x = 0, y = 0;
    for (var i = 0; i < ring.length; i++) {
      x += ring[i][0]; y += ring[i][1];
    }
    return [x / ring.length, y / ring.length];
  }
  function featureCentroid(feature) {
    var g = feature.geometry;
    if (!g) return [-105.5, 39];
    if (g.type === 'Polygon') return ringCentroid(g.coordinates[0]);
    if (g.type === 'MultiPolygon') return ringCentroid(g.coordinates[0][0]);
    return [-105.5, 39];
  }

  // Look up the county for a tract GEOID (first 5 chars).
  function tractToCounty(tractGeoid) {
    return String(tractGeoid).substring(0, 5);
  }

  /* ── Score components ─────────────────────────────────────────────── */

  /**
   * Years-since-last → 0–100. ≥MAX_RECENCY_YEARS years = full score.
   * "Never funded" (no projects in area) also gets full score.
   */
  function recencyScore(lastYear) {
    if (lastYear == null) return 100;
    var years = Math.max(0, CURRENT_YEAR - lastYear);
    return Math.min(100, Math.round((years / MAX_RECENCY_YEARS) * 100));
  }

  /**
   * Housing-need from county CHAS summary (mirrors Scorecard v2 inputs).
   * Composite of renter cost burden + owner cost burden weighted by HHs
   * + severe burden share. Normalised against CO statewide distribution.
   */
  function buildNeedDistribution() {
    var dist = [];
    Object.values(state.chasByFips).forEach(function (rec) {
      var s = rec.summary || {};
      var renterHH = +s.total_renter_hh || 0;
      var ownerHH  = +s.total_owner_hh  || 0;
      var total = renterHH + ownerHH;
      if (!total || s.pct_renter_cb30 == null || s.pct_owner_cb30 == null) return;
      var blended = (s.pct_renter_cb30 * renterHH + s.pct_owner_cb30 * ownerHH) / total;
      var severe = +s.pct_renter_cb50 || 0;
      var composite = blended * 0.7 + severe * 0.3;
      dist.push(composite);
    });
    dist.sort(function (a, b) { return a - b; });
    return dist;
  }
  function needScoreFor(countyFips, needDist) {
    var rec = state.chasByFips[countyFips];
    if (!rec || !rec.summary) return 30;  // default low if unknown
    var s = rec.summary;
    var renterHH = +s.total_renter_hh || 0;
    var ownerHH  = +s.total_owner_hh  || 0;
    var total = renterHH + ownerHH;
    if (!total) return 30;
    var blended = (s.pct_renter_cb30 * renterHH + s.pct_owner_cb30 * ownerHH) / total;
    var severe = +s.pct_renter_cb50 || 0;
    var composite = blended * 0.7 + severe * 0.3;
    // Percentile rank within CO
    var below = 0;
    for (var i = 0; i < needDist.length; i++) {
      if (needDist[i] < composite) below++;
      else if (needDist[i] === composite) below += 0.5;
    }
    return Math.round((below / needDist.length) * 100);
  }

  /**
   * Basis-boost score:
   *   QCT only:  60  (40 of 100)
   *   DDA only:  60  (40 of 100)
   *   Both:      100 (60 of 100 in the composite — the strongest case)
   *   Neither:   0
   * The "Neither" branch is unreachable here because everything in our
   * opportunity list is by definition a QCT or DDA, but kept for clarity.
   */
  function basisBoostScore(isQct, isDda) {
    if (isQct && isDda) return 100;
    if (isQct || isDda) return 60;
    return 0;
  }

  /**
   * Population feasibility — under 500 = 0, 500-2000 = 50, 2000+ = 100.
   * Floor that filters out small rural tracts where a 50-unit project
   * couldn't lease up.
   */
  function populationScore(pop) {
    if (pop == null || !Number.isFinite(+pop)) return 50;  // unknown = mid
    var n = +pop;
    if (n < 500) return 0;
    if (n < 2000) return 50;
    return 100;
  }

  /* ── Data loading ─────────────────────────────────────────────────── */

  function loadAll() {
    setStatus('Loading data (HUD QCT, DDA, LIHTC projects, CHAS, ACS)…');
    return Promise.all([
      fetch('data/qct-colorado.json').then(function (r) { return r.json(); }),
      fetch('data/dda-colorado.json').then(function (r) { return r.json(); }),
      fetch('data/market/hud_lihtc_co.geojson').then(function (r) { return r.json(); }),
      fetch('data/hna/chas_affordability_gap.json').then(function (r) { return r.json(); }),
      fetch('data/market/acs_tract_metrics_co.json').then(function (r) { return r.json(); }),
      fetch('data/hna/geo-config.json').then(function (r) { return r.json(); })
        .catch(function () { return null; })
    ]).then(function (parts) {
      state.qctFeatures = parts[0].features || [];
      state.ddaFeatures = parts[1].features || [];

      // Filter projects to those with usable YR_PIS (excludes the 8888 placeholder)
      state.projects = (parts[2].features || []).filter(function (f) {
        var y = parseInt(f.properties && f.properties.YR_PIS, 10);
        return Number.isFinite(y) && y >= 1980 && y <= 2030;
      });

      state.chasByFips = (parts[3].counties || {});

      // Tract population index — for QCT population join
      (parts[4].tracts || []).forEach(function (t) {
        state.tractPop[t.geoid] = +t.pop || 0;
      });

      // County name index
      if (parts[5] && Array.isArray(parts[5].counties)) {
        parts[5].counties.forEach(function (c) {
          state.countyName[c.geoid] = c.label;
        });
      } else {
        // Build from CHAS records as fallback
        Object.keys(state.chasByFips).forEach(function (fips) {
          var nm = state.chasByFips[fips].name;
          if (nm) state.countyName[fips] = nm + ' County';
        });
      }

      setStatus('Computing opportunity scores for ' +
        state.qctFeatures.length + ' QCTs + ' +
        state.ddaFeatures.length + ' DDAs against ' +
        state.projects.length + ' LIHTC projects…');
    });
  }

  /* ── Opportunity assembly ─────────────────────────────────────────── */

  function _computeOpportunities() {
    var needDist = buildNeedDistribution();
    var ops = [];

    // ── Per-QCT analysis ──
    state.qctFeatures.forEach(function (feat) {
      var props = feat.properties || {};
      var tractGeoid = props.GEOID;
      var countyFips = tractToCounty(tractGeoid);
      var pop = state.tractPop[tractGeoid] || null;
      var centroid = featureCentroid(feat);

      // Projects inside this QCT polygon
      var inside = state.projects.filter(function (p) {
        var c = p.geometry && p.geometry.coordinates;
        return c && pointInGeoFeature(c[0], c[1], feat);
      });
      var lastYear = inside.reduce(function (max, p) {
        var y = parseInt(p.properties.YR_PIS, 10);
        return (Number.isFinite(y) && y > max) ? y : max;
      }, -Infinity);
      if (lastYear === -Infinity) lastYear = null;
      var totalUnits = inside.reduce(function (sum, p) {
        return sum + (+p.properties.N_UNITS || 0);
      }, 0);

      // Score components
      var recScore = recencyScore(lastYear);
      var needS  = needScoreFor(countyFips, needDist);
      var bbS    = basisBoostScore(true, false);  // QCT only (will upgrade if also DDA later)
      var popS   = populationScore(pop);
      var composite = Math.round(
        0.35 * recScore + 0.30 * needS + 0.20 * bbS + 0.15 * popS
      );

      ops.push({
        id:           'qct-' + tractGeoid,
        kind:         'QCT',
        geoid:        tractGeoid,
        name:         props.NAME || ('Census Tract ' + (props.TRACT || '')),
        countyFips:   countyFips,
        countyName:   state.countyName[countyFips] || ('County ' + countyFips),
        city:         null,  // QCT is a tract — city derived from projects inside
        type:         'QCT',
        isQct:        true,
        isDda:        false,
        projects:     inside,
        projectCount: inside.length,
        totalUnits:   totalUnits,
        lastYear:     lastYear,
        yearsSince:   lastYear != null ? CURRENT_YEAR - lastYear : null,
        population:   pop,
        recencyScore: recScore,
        needScore:    needS,
        basisBoostScore: bbS,
        populationScore: popS,
        score:        composite,
        centroid:     centroid,
        feature:      feat
      });
    });

    // ── Per-DDA analysis ──
    state.ddaFeatures.forEach(function (feat) {
      var props = feat.properties || {};
      var ddaName = props.DDA_NAME || props.NAME || ('DDA ' + props.DDA_CODE);
      var ddaType = props.DDATYPE || props.DDA_TYPE; // M = metro, NM = nonmetro
      var countyFips;
      if (props.GEOID && props.GEOID.length === 5) {
        countyFips = props.GEOID;  // nonmetro DDAs are county-based
      } else {
        // Metro DDAs are ZIP-based — pick the county whose centroid is closest
        // to the DDA centroid (approximate but good enough for display)
        var centroid0 = featureCentroid(feat);
        countyFips = null; // best-effort, may stay null
      }
      var centroid = featureCentroid(feat);

      var inside = state.projects.filter(function (p) {
        var c = p.geometry && p.geometry.coordinates;
        return c && pointInGeoFeature(c[0], c[1], feat);
      });
      var lastYear = inside.reduce(function (max, p) {
        var y = parseInt(p.properties.YR_PIS, 10);
        return (Number.isFinite(y) && y > max) ? y : max;
      }, -Infinity);
      if (lastYear === -Infinity) lastYear = null;
      var totalUnits = inside.reduce(function (sum, p) {
        return sum + (+p.properties.N_UNITS || 0);
      }, 0);

      // Population: sum population of all CO tracts whose centroid falls inside
      // the DDA polygon. For county-based nonmetro DDAs we can shortcut by
      // summing tract pops for that county, but the polygon-based count is
      // more accurate so we use it uniformly.
      var pop = 0;
      // Cheap heuristic: use county-level pop estimate when available
      // (full tract iteration would be slower). For nonmetro DDAs the
      // polygon IS the county boundary so this is correct.
      if (countyFips && state.chasByFips[countyFips]) {
        var s = state.chasByFips[countyFips].summary || {};
        pop = ((+s.total_renter_hh) || 0) + ((+s.total_owner_hh) || 0);
        // HHs to pop heuristic: × 2.5 (avg CO household size)
        pop = Math.round(pop * 2.5);
      }

      var recScore = recencyScore(lastYear);
      var needS  = countyFips ? needScoreFor(countyFips, needDist) : 50;
      var bbS    = basisBoostScore(false, true);
      var popS   = populationScore(pop);
      var composite = Math.round(
        0.35 * recScore + 0.30 * needS + 0.20 * bbS + 0.15 * popS
      );

      ops.push({
        id:           'dda-' + (props.DDA_CODE || props.OBJECTID || ddaName),
        kind:         'DDA',
        geoid:        props.GEOID || props.DDA_CODE,
        name:         ddaName,
        countyFips:   countyFips,
        countyName:   countyFips ? (state.countyName[countyFips] || ('County ' + countyFips)) : '—',
        type:         ddaType === 'M' ? 'DDA · metro' : 'DDA · nonmetro',
        isQct:        false,
        isDda:        true,
        projects:     inside,
        projectCount: inside.length,
        totalUnits:   totalUnits,
        lastYear:     lastYear,
        yearsSince:   lastYear != null ? CURRENT_YEAR - lastYear : null,
        population:   pop || null,
        recencyScore: recScore,
        needScore:    needS,
        basisBoostScore: bbS,
        populationScore: popS,
        score:        composite,
        centroid:     centroid,
        feature:      feat
      });
    });

    // ── Detect QCT × DDA overlap → flip "both" + recompute basis-boost ──
    // O(qct × dda) = 224 × 10 = 2240 tests, negligible.
    var ddaOps = ops.filter(function (o) { return o.kind === 'DDA'; });
    ops.forEach(function (op) {
      if (op.kind !== 'QCT') return;
      for (var i = 0; i < ddaOps.length; i++) {
        var ddaCentroid = ddaOps[i].centroid;
        // Quick test: does the QCT contain the DDA centroid OR does the
        // DDA contain the QCT centroid? Either signals overlap.
        if (pointInGeoFeature(ddaCentroid[0], ddaCentroid[1], op.feature) ||
            pointInGeoFeature(op.centroid[0], op.centroid[1], ddaOps[i].feature)) {
          op.isDda = true;
          op.type = 'QCT + DDA';
          var newBbS = basisBoostScore(true, true);
          op.basisBoostScore = newBbS;
          op.score = Math.round(
            0.35 * op.recencyScore + 0.30 * op.needScore +
            0.20 * newBbS + 0.15 * op.populationScore
          );
          break;
        }
      }
    });

    state.opportunities = ops;
  }

  /* ── Filtering ────────────────────────────────────────────────────── */

  function _applyFilters() {
    var f = state.filters;
    return state.opportunities.filter(function (op) {
      // Area-type toggles
      if (op.isQct && op.isDda) {
        if (!f.showBoth) return false;
      } else if (op.isQct) {
        if (!f.showQct) return false;
      } else if (op.isDda) {
        if (!f.showDda) return false;
      }
      // County
      if (f.county && op.countyFips !== f.county) return false;
      // City — match against any project's PROJ_CTY
      if (f.city) {
        var matchCity = op.projects.some(function (p) {
          return ((p.properties && p.properties.PROJ_CTY) || '').toUpperCase() === f.city.toUpperCase();
        });
        if (!matchCity) return false;
      }
      // Years-since-last-funded
      if (f.minYearsSince > 0) {
        if (op.yearsSince == null || op.yearsSince < f.minYearsSince) return false;
      }
      // Score
      if (op.score < f.minScore) return false;
      // Population
      if (f.minPop > 0 && (op.population || 0) < f.minPop) return false;
      return true;
    });
  }

  /* ── Render: summary cards + table + map ──────────────────────────── */

  function _scoreBand(score) {
    if (score >= 70) return 'high';
    if (score >= 50) return 'med';
    return 'low';
  }

  function _renderSummary(filtered) {
    var n = filtered.length;
    var neverFunded = filtered.filter(function (op) { return op.lastYear == null; }).length;
    var qctOnly = filtered.filter(function (op) { return op.isQct && !op.isDda; }).length;
    var ddaOnly = filtered.filter(function (op) { return op.isDda && !op.isQct; }).length;
    var both = filtered.filter(function (op) { return op.isQct && op.isDda; }).length;
    var avgScore = n ? Math.round(filtered.reduce(function (s, op) { return s + op.score; }, 0) / n) : 0;
    var html =
      '<div class="lof-summary-card"><div class="k">Areas matching filters</div>' +
        '<div class="v">' + n + '</div>' +
        '<div class="s">QCT only ' + qctOnly + ' · DDA only ' + ddaOnly + ' · Both ' + both + '</div></div>' +
      '<div class="lof-summary-card"><div class="k">Avg opportunity score</div>' +
        '<div class="v">' + avgScore + '<span style="font-size:.7rem;color:var(--muted)">/100</span></div></div>' +
      '<div class="lof-summary-card"><div class="k">Never-funded areas</div>' +
        '<div class="v">' + neverFunded + '</div>' +
        '<div class="s">no LIHTC project on record</div></div>';
    var top = filtered.length ? filtered[0] : null;
    if (top) {
      html += '<div class="lof-summary-card"><div class="k">Top-ranked area</div>' +
        '<div class="v" style="font-size:.95rem;line-height:1.25">' + escHtml(top.name) + '</div>' +
        '<div class="s">' + escHtml(top.countyName) + ' · ' + top.score + '/100</div></div>';
    }
    $('lofSummaryCards').innerHTML = html;
  }

  function _renderTable(filtered) {
    var tbody = $('lofTableBody');
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="lof-loading">No areas match the current filters.</td></tr>';
      return;
    }
    var rows = filtered.map(function (op) {
      var typeHtml = '';
      if (op.isQct && op.isDda) {
        typeHtml = '<span class="lof-badge lof-badge--both">QCT + DDA</span>';
      } else if (op.isQct) {
        typeHtml = '<span class="lof-badge lof-badge--qct">QCT</span>';
      } else {
        typeHtml = '<span class="lof-badge lof-badge--dda">DDA</span>';
      }
      var lastFundedText = op.lastYear != null
        ? op.lastYear + ' (' + op.yearsSince + ' yrs ago)'
        : '<em>Never</em>';
      var scoreCls = 'lof-score-' + _scoreBand(op.score);
      var selectedCls = (state.selectedId === op.id) ? ' is-selected' : '';
      return '<tr data-op-id="' + escHtml(op.id) + '" class="' + selectedCls.trim() + '">' +
        '<td><span class="lof-score-cell ' + scoreCls + '">' + op.score + '</span></td>' +
        '<td>' + escHtml(op.name) + '</td>' +
        '<td>' + typeHtml + '</td>' +
        '<td>' + escHtml(op.countyName) + '</td>' +
        '<td>' + lastFundedText + '</td>' +
        '<td>' + op.projectCount + '</td>' +
        '<td>' + fmtInt(op.totalUnits) + '</td>' +
        '<td>' + (op.population != null ? fmtInt(op.population) : '—') + '</td>' +
      '</tr>';
    }).join('');
    tbody.innerHTML = rows;
    // Bind row clicks
    Array.from(tbody.querySelectorAll('tr[data-op-id]')).forEach(function (tr) {
      tr.addEventListener('click', function () {
        _showDetail(tr.getAttribute('data-op-id'));
      });
    });
  }

  function _renderMap(filtered) {
    if (!state.map) return;
    ['qct', 'dda', 'highlight'].forEach(function (k) {
      if (state.layers[k]) {
        state.map.removeLayer(state.layers[k]);
        state.layers[k] = null;
      }
    });

    var qctLayer = window.L.layerGroup();
    var ddaLayer = window.L.layerGroup();

    filtered.forEach(function (op) {
      var color = op.score >= 70 ? '#16a34a' : op.score >= 50 ? '#f59e0b' : '#94a3b8';
      var coords = op.feature.geometry.coordinates;
      var ringsForLeaflet;
      if (op.feature.geometry.type === 'Polygon') {
        ringsForLeaflet = coords.map(function (ring) {
          return ring.map(function (c) { return [c[1], c[0]]; });
        });
      } else if (op.feature.geometry.type === 'MultiPolygon') {
        ringsForLeaflet = coords.map(function (poly) {
          return poly.map(function (ring) {
            return ring.map(function (c) { return [c[1], c[0]]; });
          });
        });
      } else {
        return;
      }
      var poly = window.L.polygon(ringsForLeaflet, {
        color: color, weight: 1.4, fillColor: color, fillOpacity: 0.18, opacity: 0.85
      });
      poly.bindTooltip(
        '<strong>' + escHtml(op.name) + '</strong><br>' +
        op.type + ' · ' + escHtml(op.countyName) + '<br>' +
        'Score: ' + op.score + '/100',
        { sticky: true }
      );
      poly.on('click', function () { _showDetail(op.id); });
      if (op.kind === 'QCT') qctLayer.addLayer(poly);
      else ddaLayer.addLayer(poly);
    });
    qctLayer.addTo(state.map);
    ddaLayer.addTo(state.map);
    state.layers.qct = qctLayer;
    state.layers.dda = ddaLayer;
  }

  function _showDetail(opId) {
    var op = state.opportunities.find(function (x) { return x.id === opId; });
    if (!op) return;
    state.selectedId = opId;
    var detail = $('lofDetail');
    $('lofDetailTitle').textContent = op.name + '  ·  ' + op.type;
    var facts = $('lofDetailFacts');
    facts.innerHTML =
      '<dt>County</dt><dd>' + escHtml(op.countyName) + '</dd>' +
      '<dt>Opportunity score</dt><dd>' + op.score + '/100  (rec ' + op.recencyScore +
        ' · need ' + op.needScore + ' · basis ' + op.basisBoostScore + ' · pop ' + op.populationScore + ')</dd>' +
      '<dt>Last LIHTC project</dt><dd>' + (op.lastYear != null
        ? op.lastYear + ' (' + op.yearsSince + ' years ago)'
        : 'Never funded on record') + '</dd>' +
      '<dt>Existing LIHTC saturation</dt><dd>' + op.projectCount + ' project(s) · ' +
        fmtInt(op.totalUnits) + ' total units</dd>' +
      '<dt>Population</dt><dd>' + (op.population != null ? fmtInt(op.population) : 'unknown') + '</dd>';

    // Projects in same city + county
    var sameCityNames = new Set();
    op.projects.forEach(function (p) {
      var c = (p.properties && p.properties.PROJ_CTY) || '';
      if (c) sameCityNames.add(c.toUpperCase());
    });
    var sameCityProjects = state.projects.filter(function (p) {
      var c = ((p.properties && p.properties.PROJ_CTY) || '').toUpperCase();
      return c && sameCityNames.has(c);
    });
    var sameCountyProjects = op.countyFips
      ? state.projects.filter(function (p) {
          return (p.properties && p.properties.CNTY_FIPS) === op.countyFips;
        })
      : [];
    var combined = new Map();
    sameCityProjects.concat(sameCountyProjects).forEach(function (p) {
      var key = (p.properties.PROJECT || '') + '|' + (p.properties.YR_PIS || '');
      if (!combined.has(key)) combined.set(key, p);
    });
    var projectList = Array.from(combined.values()).sort(function (a, b) {
      return (+b.properties.YR_PIS || 0) - (+a.properties.YR_PIS || 0);
    });

    var projHtml = '';
    if (!projectList.length) {
      projHtml = '<div class="lof-detail-project" style="color:var(--muted);font-style:italic;">No LIHTC projects on record in this city or county.</div>';
    } else {
      projHtml = projectList.slice(0, 30).map(function (p) {
        var pr = p.properties;
        return '<div class="lof-detail-project">' +
          '<div class="lof-detail-project-name">' + escHtml(pr.PROJECT || '(unnamed)') + '</div>' +
          '<div class="lof-detail-project-meta">' +
            escHtml(pr.PROJ_CTY || '—') + ' · ' +
            escHtml(pr.CNTY_NAME || '—') + ' · ' +
            'YR_PIS ' + (pr.YR_PIS || '—') + ' · ' +
            (pr.N_UNITS || 0) + ' units · ' +
            (pr.CREDIT || '—') + ' credit' +
          '</div>' +
        '</div>';
      }).join('');
      if (projectList.length > 30) {
        projHtml += '<div class="lof-detail-project" style="color:var(--muted);">' +
          '+ ' + (projectList.length - 30) + ' more not shown' +
        '</div>';
      }
    }
    $('lofDetailProjects').innerHTML = projHtml;
    detail.hidden = false;

    // Highlight on map
    if (state.map && op.centroid) {
      if (state.layers.highlight) state.map.removeLayer(state.layers.highlight);
      state.layers.highlight = window.L.circleMarker(
        [op.centroid[1], op.centroid[0]],
        { radius: 12, color: '#ef4444', weight: 3, fillOpacity: 0.0 }
      ).addTo(state.map);
      state.map.setView([op.centroid[1], op.centroid[0]], 10);
    }
    // Highlight table row
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
        case 'score':         return op.score;
        case 'name':          return (op.name || '').toLowerCase();
        case 'type':          return op.type;
        case 'county':        return (op.countyName || '').toLowerCase();
        case 'lastYear':      return op.lastYear == null ? -Infinity : op.lastYear;
        case 'projectCount':  return op.projectCount;
        case 'totalUnits':    return op.totalUnits;
        case 'population':    return op.population || 0;
        default:              return op.score;
      }
    }
    return arr.slice().sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return  1 * dir;
      return 0;
    });
  }

  /* ── Refresh pipeline ─────────────────────────────────────────────── */

  function _refresh() {
    var filtered = _sortOps(_applyFilters());
    _renderSummary(filtered);
    _renderTable(filtered);
    _renderMap(filtered);
  }

  /* ── Wire UI ──────────────────────────────────────────────────────── */

  function _populateFilterDropdowns() {
    var counties = {};
    var cities = {};
    state.opportunities.forEach(function (op) {
      if (op.countyFips) counties[op.countyFips] = op.countyName;
      op.projects.forEach(function (p) {
        var c = (p.properties && p.properties.PROJ_CTY) || '';
        if (c) cities[c.toUpperCase()] = c.split(' ').map(function (w) {
          return w.charAt(0) + w.slice(1).toLowerCase();
        }).join(' ');
      });
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
    var citySel = $('lofCity');
    Object.keys(cities).sort().forEach(function (key) {
      var opt = document.createElement('option');
      opt.value = key;  // upper-case key for matching
      opt.textContent = cities[key];
      citySel.appendChild(opt);
    });
  }

  function _wireFilters() {
    var qctEl = $('lofShowQct'), ddaEl = $('lofShowDda'), bothEl = $('lofShowBoth');
    var countyEl = $('lofCounty'), cityEl = $('lofCity');
    var minYearsEl = $('lofMinYearsSince'), minScoreEl = $('lofMinScore'), minPopEl = $('lofMinPop');
    var minYearsValEl = $('lofMinYearsSinceVal'), minScoreValEl = $('lofMinScoreVal');

    [qctEl, ddaEl, bothEl].forEach(function (el) {
      el.addEventListener('change', function () {
        state.filters.showQct = qctEl.checked;
        state.filters.showDda = ddaEl.checked;
        state.filters.showBoth = bothEl.checked;
        _refresh();
      });
    });
    countyEl.addEventListener('change', function () {
      state.filters.county = countyEl.value;
      _refresh();
    });
    cityEl.addEventListener('change', function () {
      state.filters.city = cityEl.value;
      _refresh();
    });
    minYearsEl.addEventListener('input', function () {
      state.filters.minYearsSince = +minYearsEl.value;
      minYearsValEl.textContent = minYearsEl.value;
      _refresh();
    });
    minScoreEl.addEventListener('input', function () {
      state.filters.minScore = +minScoreEl.value;
      minScoreValEl.textContent = minScoreEl.value;
      _refresh();
    });
    minPopEl.addEventListener('change', function () {
      state.filters.minPop = +minPopEl.value || 0;
      _refresh();
    });
    $('lofResetFilters').addEventListener('click', function () {
      state.filters = {
        showQct: true, showDda: true, showBoth: true,
        county: '', city: '',
        minYearsSince: 0, minScore: 0, minPop: 0
      };
      qctEl.checked = true; ddaEl.checked = true; bothEl.checked = true;
      countyEl.value = ''; cityEl.value = '';
      minYearsEl.value = 0; minYearsValEl.textContent = '0';
      minScoreEl.value = 0; minScoreValEl.textContent = '0';
      minPopEl.value = 0;
      _refresh();
    });

    // Column-header sort clicks
    Array.from(document.querySelectorAll('#lofTable thead th[data-sort]')).forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDir = 'desc';
        }
        // Update aria-sort attrs
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
    state.map = window.L.map('lofMap', { preferCanvas: true })
      .setView([39.0, -105.5], 7);
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
          ' opportunity zones across Colorado · click a row or polygon for details.');
        _refresh();
      })
      .catch(function (err) {
        console.error('[LIHTC Opportunity Finder] load failed:', err);
        setStatus('Failed to load data: ' + (err && err.message || err));
      });
  });
}());
