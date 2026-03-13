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
  var AREA_MEDIAN_INCOME_CO = 95000;     // approximate CO statewide AMI ($/yr)
  var MAX_AFFORDABLE_RENT_PCT = 0.30;    // 30% of gross income rule
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
  var siteLatLng   = null;
  var bufferMiles  = 5;
  var lastResult   = null;
  var dataLoaded   = false;  // true once loadData() has settled

  var tractCentroids      = null;
  var acsMetrics          = null;
  var lihtcFeatures       = null;
  var lihtcLoadError      = false;  // true when LIHTC data failed to load
  var prop123Jurisdictions = null;
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

  /* ── Get tracts within buffer ───────────────────────────────────── */
  function tractsInBuffer(lat, lon, miles) {
    var tracts = tractCentroids && (tractCentroids.tracts || tractCentroids);
    if (!tracts || !tracts.length) return [];
    return tracts.filter(function (t) {
      return haversine(lat, lon, t.lat, t.lon) <= miles;
    });
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

  function scoreRentPressure(acs) {
    var ami60Rent = (AREA_MEDIAN_INCOME_CO * AMI_60_PCT * MAX_AFFORDABLE_RENT_PCT) / 12;
    var ratio     = acs.median_gross_rent ? acs.median_gross_rent / ami60Rent : 0;
    // If market rent > affordable threshold, it signals unmet demand — higher score
    var score = Math.min(100, Math.max(0, (ratio - 0.70) / (1.50 - 0.70) * 100));
    return { score: Math.round(score), ratio: ratio };
  }

  function scoreLandSupply(acs) {
    var vac = acs.vacancy_rate || 0;
    // Very low vacancy → high demand, strong site signal
    var score = Math.max(0, Math.min(100, (1 - vac / 0.12) * 100));
    return Math.round(score);
  }

  function scoreWorkforce(acs, lat, lon, bufTracts) {
    // Weighted composite workforce score (0–100) using 5 alternative data sources:
    //   25% LODES job accessibility
    //   25% ACS educational attainment + employment (proxied via ACS income/burden)
    //   20% CDLE vacancy rates (inverse: low vacancy = less workforce risk)
    //   15% CDE school quality proximity
    //   15% CDOT traffic connectivity
    //
    // Each sub-score falls back to a neutral value when the connector is unavailable.

    var LODES  = window.LodesCommute;
    var CDLE   = window.CdleJobs;
    var CDE    = window.CdeSchools;
    var CDOT   = window.CdotTraffic;

    // ── 1. LODES job accessibility (25%) ────────────────────────────
    var lodesScore = 50; // neutral fallback
    if (LODES) {
      var tractGeoids = (bufTracts || []).map(function (t) { return t.geoid; });
      var lodesAgg = LODES.aggregateForBuffer(tractGeoids);
      lodesScore = LODES.scoreJobAccessibility(lodesAgg);
    }

    // ── 2. ACS-based educational attainment + employment (25%) ──────
    // Proxy via median HH income relative to area median.
    // Higher income → skilled workforce in area → better workforce availability.
    var acsWfScore = 50;
    if (acs) {
      var incomeRatio = acs.median_hh_income
        ? Math.min(2.0, acs.median_hh_income / AREA_MEDIAN_INCOME_CO)
        : 0.5;
      // Scale 0–2 → 0–100, centred at 1.0
      acsWfScore = Math.min(100, Math.max(0, Math.round(incomeRatio * 60)));
    }

    // ── 3. CDLE vacancy rates (20%) — low vacancy = tight labour = risk ──
    var cdleScore = 50;
    if (CDLE && bufTracts && bufTracts.length) {
      var countyFips = {};
      bufTracts.forEach(function (t) { countyFips[t.geoid.slice(0, 5)] = true; });
      var cdleAgg = CDLE.aggregateForCounties(Object.keys(countyFips));
      cdleScore = CDLE.scoreVacancyRate(cdleAgg);
    }

    // ── 4. CDE school quality proximity (15%) ───────────────────────
    var cdeScore = 55;
    if (CDE && lat != null && lon != null) {
      var nearest = CDE.getNearestDistrict(lat, lon);
      cdeScore = CDE.scoreSchoolQuality(nearest ? { avg_quality_score: nearest.composite_quality_score } : null);
    }

    // ── 5. CDOT traffic connectivity (15%) ──────────────────────────
    var cdotScore = 40;
    if (CDOT && lat != null && lon != null) {
      var trafficAgg = CDOT.aggregateForBuffer(lat, lon, bufferMiles);
      cdotScore = CDOT.scoreTrafficConnectivity(trafficAgg);
    }

    var composite = Math.round(
      lodesScore  * 0.25 +
      acsWfScore  * 0.25 +
      cdleScore   * 0.20 +
      cdeScore    * 0.15 +
      cdotScore   * 0.15
    );

    return Math.min(100, Math.max(0, composite));
  }

  function computePma(acs, existingLihtcUnits, proposedUnits, lat, lon, bufTracts) {
    proposedUnits = proposedUnits || 0;

    var demandScore        = scoreDemand(acs);
    var captureObj         = scoreCaptureRisk(acs, existingLihtcUnits, proposedUnits);
    var rentPressureObj    = scoreRentPressure(acs);
    var landSupplyScore    = scoreLandSupply(acs);
    var workforceScore     = scoreWorkforce(acs, lat, lon, bufTracts);

    var overall = Math.round(
      demandScore          * WEIGHTS.demand +
      captureObj.score     * WEIGHTS.captureRisk +
      rentPressureObj.score * WEIGHTS.rentPressure +
      landSupplyScore      * WEIGHTS.landSupply +
      workforceScore       * WEIGHTS.workforce
    );

    var flags = [];
    if ((acs.cost_burden_rate || 0) >= RISK.costBurdenHigh) {
      flags.push({ level: 'bad', text: 'High cost-burden pressure (≥45%)' });
    }
    if (captureObj.capture >= RISK.captureHigh) {
      flags.push({ level: 'warn', text: 'High capture risk (≥25% of qualified renters)' });
    }
    if (rentPressureObj.ratio >= RISK.rentPressureElev) {
      flags.push({ level: 'warn', text: 'Elevated rent pressure (market ÷ affordable ≥ 1.10)' });
    }
    if (!flags.length) {
      flags.push({ level: 'ok', text: 'No critical risk flags detected' });
    }

    return {
      overall:       Math.min(100, Math.max(0, overall)),
      dimensions: {
        demand:        demandScore,
        captureRisk:   captureObj.score,
        rentPressure:  rentPressureObj.score,
        landSupply:    landSupplyScore,
        workforce:     workforceScore
      },
      capture:         captureObj.capture,
      rentRatio:       rentPressureObj.ratio,
      flags:           flags
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

    var dims = result.dimensions;
    var dimNames = ['demand', 'captureRisk', 'rentPressure', 'landSupply', 'workforce'];
    var dimLabels = ['Demand', 'Capture Risk', 'Rent Pressure', 'Land/Supply', 'Workforce'];
    var listEl = el('pmaDimList');
    if (listEl) {
      listEl.innerHTML = dimNames.map(function (k, i) {
        var s = dims[k] || 0;
        return '<li class="pma-dim-item">' +
          '<span class="pma-dim-name">' + dimLabels[i] + '</span>' +
          '<div class="pma-dim-bar-wrap" style="flex:1">' +
            '<div class="pma-dim-bar" style="width:' + s + '%"></div>' +
          '</div>' +
          '<span class="pma-dim-score">' + s + '</span>' +
        '</li>';
      }).join('');
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

    updateRadarChart(result.dimensions);
    updateSimulator(result);
    renderBenchmark(result);
    renderPipeline(result);
    renderScenarios(result);
  }

  /* ── Radar chart ─────────────────────────────────────────────────── */
  var radarChart = null;

  function updateRadarChart(dims) {
    var canvas = el('pmaRadarChart');
    if (!canvas || !window.Chart) return;

    var data = [
      dims.demand,
      dims.captureRisk,
      dims.rentPressure,
      dims.landSupply,
      dims.workforce
    ];
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--accent').trim() || '#0a7e74';
    var muted  = cs.getPropertyValue('--muted').trim()  || '#476080';
    var border = cs.getPropertyValue('--border').trim() || 'rgba(13,31,53,.11)';

    if (radarChart) {
      radarChart.data.datasets[0].data = data;
      radarChart.update();
      return;
    }
    radarChart = new window.Chart(canvas, {
      type: 'radar',
      data: {
        labels: ['Demand', 'Capture Risk', 'Rent Pressure', 'Land/Supply', 'Workforce'],
        datasets: [{
          label: 'PMA Score',
          data: data,
          borderColor: accent,
          backgroundColor: 'rgba(14,165,160,.15)',
          pointBackgroundColor: accent,
          borderWidth: 2,
          pointRadius: 3
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
    console.log('[market-analysis] runAnalysis(): lat=' + lat + ', lon=' + lon + ', buffer=' + bufferMiles + 'mi');
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

    if (!acs) {
      showEmpty('pmaScoreWrap', 'No ACS tract data found in this buffer. Try a larger radius.');
      return;
    }

    var nearbyLihtc  = lihtcInBuffer(lat, lon, bufferMiles);
    if (lihtcLoadError) {
      showEmpty('pmaScoreWrap',
        'LIHTC data is unavailable — PMA score cannot be computed. ' +
        'Run the "Generate Market Analysis Data" GitHub Actions workflow.');
      return;
    }
    var lihtcCount   = nearbyLihtc.length;
    var lihtcUnits   = nearbyLihtc.reduce(function (s, f) { return s + ((f.properties && f.properties.TOTAL_UNITS) || 0); }, 0);
    var prop123Count = nearbyLihtc.filter(function (f) { return isInProp123Jurisdiction(f); }).length;
    var pma          = computePma(acs, lihtcUnits, 0, lat, lon, bufTracts);

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

    lastResult = Object.assign({}, pma, {
      lat: lat, lon: lon, bufferMiles: bufferMiles,
      tractCount: bufTracts.length, acs: acs,
      lihtcCount: lihtcCount, lihtcUnits: lihtcUnits,
      prop123Count: prop123Count,
      confidence: confidence,
      _tractIds: bufTracts.map(function (t) { return t.geoid; })
    });

    renderScore(lastResult);
    setText('pmaRunBtn', 'Re-run Analysis');

    // ── Delegate to MAController to populate the 8 report sections ──
    // Normalise the aggregated ACS field names to match what MARenderers
    // and SiteSelectionScore expect, then push the data into MAState before
    // calling MAController.runAnalysis() so that _getAcs() / _getLihtc()
    // can retrieve it through the secondary (MAState) path.
    console.log('[market-analysis] runAnalysis(): delegating to MAController.runAnalysis()');
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

    map = L.map('pmaMap', { zoomControl: true }).setView([39.5501, -105.7821], 7);

    // Restrict pan/zoom to within ~50 miles of the Colorado state boundary.
    // Colorado extent: N 41.0°, S 37.0°, W -109.05°, E -102.05°.
    // 50 mi ≈ 0.72° latitude (1°≈69 mi) and ≈0.93° longitude at 39°N (1°≈54.0 mi/°).
    var coloradoBounds = L.latLngBounds(
      L.latLng(36.28, -109.98),  // ~50 mi south-west of CO border
      L.latLng(41.72, -101.12)   // ~50 mi north-east of CO border
    );
    map.setMaxBounds(coloradoBounds);
    map.setMinZoom(6);

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
          var name = p.PROJECT_NAME || p.project_name || 'LIHTC Project';
          var units = p.TOTAL_UNITS || p.total_units || '?';
          var year  = p.YEAR_ALLOC  || p.year_alloc  || '';
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

  /* ── Load overlay GeoJSON files ──────────────────────────────────── */
  function loadOverlays() {
    var DS = window.DataService;
    if (!DS) return Promise.resolve();
    return Promise.all([
      DS.getJSON(DS.baseData('co-county-boundaries.json')).catch(function () { return null; }),
      DS.getJSON(DS.baseData('qct-colorado.json')).catch(function () { return null; }),
      DS.getJSON(DS.baseData('dda-colorado.json')).catch(function () { return null; })
    ]).then(function (results) {
      initOverlayLayers(results[0], results[1], results[2]);
    }).catch(function (e) {
      console.warn('[market-analysis] Overlay load failed:', e);
    });
  }

  function placeSiteMarker(lat, lon) {
    siteLatLng = { lat: lat, lon: lon };
    var L = window.L;
    if (!L) return;

    if (siteMarker) map.removeLayer(siteMarker);
    if (bufferCircle) map.removeLayer(bufferCircle);

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

    setText('pmaSiteCoords', lat.toFixed(5) + ', ' + lon.toFixed(5));
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
    console.log('[market-analysis] loadData(): starting data load');

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
      fetchFile('market/hud_lihtc_co.geojson')
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
      console.log('[market-analysis] loadData(): complete' +
        ' — centroids=' + (((tractCentroids && tractCentroids.tracts) || tractCentroids || []).length) +
        ', acs='        + ((acsMetrics && acsMetrics.tracts) || []).length +
        ', lihtc='      + (lihtcFeatures || []).length +
        (statusParts.length ? ', warnings: ' + statusParts.join('; ') : ''));

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
    bindBufferSelect();
    bindRunBtn();
    bindAmiInputs();
    bindExport();

    // Validate required modules are available.
    ['DataService', 'MAState', 'MARenderers', 'SiteSelectionScore', 'MAController'].forEach(function (name) {
      if (!window[name]) {
        console.warn('[market-analysis] module not found: ' + name);
      } else {
        console.log('[market-analysis] module ready: ' + name);
      }
    });

    loadData().then(function () {
      // Load overlay layers after main data is ready (lihtcFeatures now set)
      loadOverlays();
    }).catch(function (err) {
      console.error('[market-analysis] loadData() failed:', err);
      dataLoaded = true;
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
    haversine:               haversine,
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
      getLastQuality:       function () { return lastQuality; },
      getLastBenchmark:     function () { return lastBenchmark; },
      getLastPipeline:      function () { return lastPipeline; },
      getLastScenarios:     function () { return lastScenarios; },
      getLastConfidence:    function () { return lastConfidence; },
      getReferenceProjects: function () { return referenceProjects; }
    }
  };

}());
