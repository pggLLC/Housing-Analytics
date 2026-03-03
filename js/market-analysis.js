/**
 * market-analysis.js
 * PMA-style Market Analysis: CHFA-leaning weights, capture scoring,
 * band + overall penetration proxy simulator.
 * Public data only: ACS 5-year, TIGERweb, HUD LIHTC.
 */
(function () {
  'use strict';

  // ── CHFA-leaning default weights (public-data baseline) ───────────────────
  // Emphasizes market depth + capture/penetration risk consistent with
  // LIHTC market-study structure, while retaining affordability pressure framing.
  const WEIGHTS = {
    demand: 0.35,
    capture: 0.35,
    rentPressure: 0.20,
    landSupply: 0.07,
    workforce: 0.03
  };

  // ── AMI band income fractions of renter households ────────────────────────
  // Approximate cumulative fraction of total renter households qualifying
  // at or below each AMI band ceiling (national public-data approximations).
  const AMI_BANDS = {
    '30': { label: '≤30% AMI',   fraction: 0.12, range: '≤30' },
    '50': { label: '31–50% AMI', fraction: 0.25, range: '31–50' },
    '60': { label: '51–60% AMI', fraction: 0.33, range: '51–60' },
    '80': { label: '61–80% AMI', fraction: 0.45, range: '61–80' }
  };

  // ── Colorado county list (mirrors cached data/hna/summary files) ──────────
  const CO_COUNTIES = [
    { geoid: '08001', label: 'Adams County' },
    { geoid: '08003', label: 'Alamosa County' },
    { geoid: '08005', label: 'Arapahoe County' },
    { geoid: '08007', label: 'Archuleta County' },
    { geoid: '08009', label: 'Baca County' },
    { geoid: '08011', label: 'Bent County' },
    { geoid: '08013', label: 'Boulder County' },
    { geoid: '08014', label: 'Broomfield County' },
    { geoid: '08015', label: 'Chaffee County' },
    { geoid: '08017', label: 'Cheyenne County' },
    { geoid: '08019', label: 'Clear Creek County' },
    { geoid: '08021', label: 'Conejos County' },
    { geoid: '08023', label: 'Costilla County' },
    { geoid: '08025', label: 'Crowley County' },
    { geoid: '08027', label: 'Custer County' },
    { geoid: '08029', label: 'Delta County' },
    { geoid: '08031', label: 'Denver County' },
    { geoid: '08033', label: 'Dolores County' },
    { geoid: '08035', label: 'Douglas County' },
    { geoid: '08037', label: 'Eagle County' },
    { geoid: '08039', label: 'Elbert County' },
    { geoid: '08041', label: 'El Paso County' },
    { geoid: '08043', label: 'Fremont County' },
    { geoid: '08045', label: 'Garfield County' },
    { geoid: '08047', label: 'Gilpin County' },
    { geoid: '08049', label: 'Grand County' },
    { geoid: '08051', label: 'Gunnison County' },
    { geoid: '08053', label: 'Hinsdale County' },
    { geoid: '08055', label: 'Huerfano County' },
    { geoid: '08057', label: 'Jackson County' },
    { geoid: '08059', label: 'Jefferson County' },
    { geoid: '08061', label: 'Kiowa County' },
    { geoid: '08063', label: 'Kit Carson County' },
    { geoid: '08065', label: 'Lake County' },
    { geoid: '08067', label: 'La Plata County' },
    { geoid: '08069', label: 'Larimer County' },
    { geoid: '08071', label: 'Las Animas County' },
    { geoid: '08073', label: 'Lincoln County' },
    { geoid: '08075', label: 'Logan County' },
    { geoid: '08077', label: 'Mesa County' },
    { geoid: '08079', label: 'Mineral County' },
    { geoid: '08081', label: 'Moffat County' },
    { geoid: '08083', label: 'Montezuma County' },
    { geoid: '08085', label: 'Montrose County' },
    { geoid: '08087', label: 'Morgan County' },
    { geoid: '08089', label: 'Otero County' },
    { geoid: '08091', label: 'Ouray County' },
    { geoid: '08093', label: 'Park County' },
    { geoid: '08095', label: 'Phillips County' },
    { geoid: '08097', label: 'Pitkin County' },
    { geoid: '08099', label: 'Prowers County' },
    { geoid: '08101', label: 'Pueblo County' },
    { geoid: '08103', label: 'Rio Blanco County' },
    { geoid: '08105', label: 'Rio Grande County' },
    { geoid: '08107', label: 'Routt County' },
    { geoid: '08109', label: 'Saguache County' },
    { geoid: '08111', label: 'San Juan County' },
    { geoid: '08113', label: 'San Miguel County' },
    { geoid: '08115', label: 'Sedgwick County' },
    { geoid: '08117', label: 'Summit County' },
    { geoid: '08119', label: 'Teller County' },
    { geoid: '08121', label: 'Washington County' },
    { geoid: '08123', label: 'Weld County' },
    { geoid: '08125', label: 'Yuma County' }
  ];

  // ── Utility ────────────────────────────────────────────────────────────────
  function safeNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // ── Scoring functions ──────────────────────────────────────────────────────

  /**
   * scoreDemand: renter household depth.
   * Larger renter pool = deeper demand signal.
   */
  function scoreDemand(agg) {
    const renters = agg.renter_households || 0;
    let s;
    if (renters >= 50000)      s = 100;
    else if (renters >= 20000) s = 85;
    else if (renters >= 10000) s = 72;
    else if (renters >= 5000)  s = 60;
    else if (renters >= 2000)  s = 48;
    else                       s = 35;

    return {
      score: Math.round(s),
      inputs: { renter_households: renters }
    };
  }

  /**
   * scoreCapture: market-study style capture rate scoring.
   * capture_rate = (existing_affordable_units + proposed_units) / qualified_renter_households
   * >25% starts to look risky; <15% is strong.
   */
  function scoreCapture(agg, amiBandKey, proposedUnits) {
    const band = AMI_BANDS[amiBandKey] || AMI_BANDS['60'];
    const renters = agg.renter_households || 0;
    const qualified = Math.round(renters * band.fraction);
    const existing = agg.existing_affordable_units || 0;
    const units = proposedUnits || 0;

    let capRate = null;
    if (qualified > 0) {
      capRate = (existing + units) / qualified;
    }

    let s = 60;
    // Market-study style guidance: >25% starts to look risky; <15% is strong
    if (capRate != null) {
      if (capRate < 0.12)      s = 100;  // very strong depth
      else if (capRate < 0.15) s = 90;
      else if (capRate < 0.20) s = 75;
      else if (capRate < 0.25) s = 60;
      else if (capRate < 0.30) s = 45;
      else                     s = 30;   // high capture requirement = elevated risk
    }

    return {
      score: s,
      inputs: {
        qualified_renter_households: qualified,
        existing_affordable_units: existing,
        proposed_units: units,
        capture_rate: capRate
      }
    };
  }

  /**
   * scoreRentPressure: cost burden + rent-to-income pressure.
   * Higher burden = higher need score.
   */
  function scoreRentPressure(agg) {
    const costBurden = agg.cost_burden_rate;      // fraction, e.g. 0.45
    const rpi = agg.rent_pressure_index;           // (medRent*12) / (medIncome*0.30)

    let s = 50;
    if (costBurden != null) {
      if (costBurden >= 0.50)      s = 100;
      else if (costBurden >= 0.45) s = 88;
      else if (costBurden >= 0.40) s = 76;
      else if (costBurden >= 0.35) s = 64;
      else if (costBurden >= 0.30) s = 52;
      else                         s = 40;
    }

    // RPI adjustment
    if (rpi != null) {
      if (rpi >= 1.20)      s = Math.min(100, s + 10);
      else if (rpi >= 1.10) s = Math.min(100, s + 5);
      else if (rpi < 0.90)  s = Math.max(0,   s - 10);
    }

    return {
      score: Math.round(s),
      inputs: {
        cost_burden_rate: costBurden,
        rent_pressure_index: rpi
      }
    };
  }

  /**
   * scoreLandSupply: home-value-to-income ratio as proxy for land cost pressure.
   * Higher ratio = tighter land supply.
   */
  function scoreLandSupply(agg) {
    const homeVal = agg.median_home_value;
    const income  = agg.median_household_income;
    let s = 60;
    if (homeVal != null && income != null && income > 0) {
      const ratio = homeVal / income;
      if (ratio < 3.5)       s = 85;  // affordable land
      else if (ratio < 5.0)  s = 70;
      else if (ratio < 7.0)  s = 55;
      else if (ratio < 10.0) s = 40;
      else                   s = 25;  // very constrained land supply
    }

    return {
      score: Math.round(s),
      inputs: {
        home_value_to_income_ratio: (homeVal != null && income) ? +(homeVal / income).toFixed(2) : null
      }
    };
  }

  /**
   * scoreWorkforce: rent gap relative to 30%-of-income affordability threshold.
   */
  function scoreWorkforce(agg) {
    const income = agg.median_household_income;
    const rent   = agg.median_gross_rent;

    let s = 55;
    if (income != null && rent != null && income > 0) {
      const affordRent = income * 0.30 / 12;
      const gap = rent - affordRent;
      if (gap < 0)         s = 40;
      else if (gap < 100)  s = 50;
      else if (gap < 250)  s = 65;
      else if (gap < 500)  s = 80;
      else                 s = 95;
    }

    return {
      score: Math.round(s),
      inputs: {
        median_household_income: income,
        median_gross_rent: rent,
        affordable_monthly_rent: income ? Math.round(income * 0.30 / 12) : null
      }
    };
  }

  /**
   * computeScore: weighted aggregate using CHFA-leaning WEIGHTS.
   */
  function computeScore(agg, amiBandKey, proposedUnits) {
    const d  = scoreDemand(agg);
    const c  = scoreCapture(agg, amiBandKey, proposedUnits);
    const rp = scoreRentPressure(agg);
    const ls = scoreLandSupply(agg);
    const wf = scoreWorkforce(agg);

    const total = (
      WEIGHTS.demand       * d.score  +
      WEIGHTS.capture      * c.score  +
      WEIGHTS.rentPressure * rp.score +
      WEIGHTS.landSupply   * ls.score +
      WEIGHTS.workforce    * wf.score
    );

    return {
      total: Math.round(total),
      sub: { demand: d, capture: c, rentPressure: rp, landSupply: ls, workforce: wf }
    };
  }

  /**
   * runSimulator: compute band-specific capture rate AND overall penetration proxy.
   * Band capture  = (existing + proposed) / qualified_renter_hh (for selected AMI band)
   * Overall proxy = (existing + proposed) / (0.70 * renter_households)
   */
  function runSimulator(agg, amiBandKey, proposedUnits) {
    const band    = AMI_BANDS[amiBandKey] || AMI_BANDS['60'];
    const renters = agg.renter_households || 0;
    const qualified = Math.round(renters * band.fraction);
    const existing  = agg.existing_affordable_units || 0;
    const units     = proposedUnits || 0;

    const capRate = qualified > 0 ? (existing + units) / qualified : null;

    // Overall penetration proxy: 70% of total renter HH as broad denominator
    const totalQualifiedOverall = Math.round((agg.renter_households || 0) * 0.70);
    const overallCapRate = totalQualifiedOverall > 0
      ? (existing + units) / totalQualifiedOverall
      : null;

    return {
      band: band.label,
      amiBandRange: band.range,
      qualified_renter_hh: qualified,
      existing_affordable: existing,
      proposed_units: units,
      capture_rate: capRate,
      overall_penetration_proxy: overallCapRate
    };
  }

  /**
   * updateUiResult: display score and risk flags in the UI.
   * Risk flags:
   *   - capture_rate >= 0.25 → high risk
   *   - cost_burden_rate >= 0.45 → high pressure
   *   - rent_pressure_index >= 1.10 → elevated
   */
  function updateUiResult(result, scoreData) {
    const resultSection = document.getElementById('ma-result');
    if (!resultSection) return;

    const { total, sub } = scoreData;
    const captureInputs = sub.capture.inputs;
    const rpInputs      = sub.rentPressure.inputs;

    const captureRate = captureInputs.capture_rate;
    const costBurden  = rpInputs.cost_burden_rate;
    const rpi         = rpInputs.rent_pressure_index;

    // Build risk flags
    const flags = [];
    if (captureRate != null && captureRate >= 0.25) {
      flags.push({ level: 'high',   label: 'High capture rate (' + (captureRate * 100).toFixed(1) + '%) — elevated market risk' });
    } else if (captureRate != null && captureRate >= 0.20) {
      flags.push({ level: 'medium', label: 'Moderate capture rate (' + (captureRate * 100).toFixed(1) + '%)' });
    }
    if (costBurden != null && costBurden >= 0.45) {
      flags.push({ level: 'high',   label: 'High cost burden (' + (costBurden * 100).toFixed(1) + '%) — strong affordability pressure' });
    } else if (costBurden != null && costBurden >= 0.35) {
      flags.push({ level: 'medium', label: 'Elevated cost burden (' + (costBurden * 100).toFixed(1) + '%)' });
    }
    if (rpi != null && rpi >= 1.10) {
      flags.push({ level: 'medium', label: 'Rent pressure index elevated (' + rpi.toFixed(2) + ')' });
    }

    const scoreColor = total >= 70 ? '#22a36f' : total >= 50 ? '#f59e0b' : '#ef4444';
    const scoreLabel = total >= 70 ? 'Strong Market' : total >= 50 ? 'Moderate Market' : 'Elevated Risk';

    const flagsHtml = flags.length === 0
      ? '<p style="color:var(--muted,#666);font-size:.85rem;margin:0;">No critical risk flags.</p>'
      : flags.map(f =>
          `<div class="ma-flag ma-flag--${f.level}" role="alert">${f.level === 'high' ? '⚠️' : '🔶'} ${f.label}</div>`
        ).join('');

    const subRows = [
      { key: 'demand',       label: 'Market Demand',   w: WEIGHTS.demand },
      { key: 'capture',      label: 'Capture Risk',    w: WEIGHTS.capture },
      { key: 'rentPressure', label: 'Rent Pressure',   w: WEIGHTS.rentPressure },
      { key: 'landSupply',   label: 'Land Supply',     w: WEIGHTS.landSupply },
      { key: 'workforce',    label: 'Workforce Gap',   w: WEIGHTS.workforce }
    ].map(({ key, label, w }) => {
      const s = sub[key].score;
      const c = s >= 70 ? '#22a36f' : s >= 50 ? '#f59e0b' : '#ef4444';
      return `<div class="ma-sub-row">
        <span class="ma-sub-label">${label} <small style="color:var(--muted,#666);">(w=${(w * 100).toFixed(0)}%)</small></span>
        <div class="ma-sub-bar-wrap" role="meter" aria-label="${label} score ${s}" aria-valuenow="${s}" aria-valuemin="0" aria-valuemax="100">
          <div class="ma-sub-bar" style="width:${s}%;background:${c};"></div>
        </div>
        <span class="ma-sub-val" style="color:${c};">${s}</span>
      </div>`;
    }).join('');

    resultSection.innerHTML = `
      <div class="ma-score-card">
        <div class="ma-score-header">
          <div>
            <div class="ma-score-label">${scoreLabel}</div>
            <div class="ma-score-sub">CHFA-leaning weighted composite</div>
          </div>
          <div class="ma-score-circle" style="border-color:${scoreColor};color:${scoreColor};"
               aria-label="Market score ${total} out of 100" role="img">${total}</div>
        </div>
        <div class="ma-sub-scores">${subRows}</div>
        <div class="ma-flags-section">
          <div class="ma-flags-title">Risk Flags</div>
          ${flagsHtml}
        </div>
      </div>`;
  }

  // ── Data fetching ──────────────────────────────────────────────────────────

  async function fetchCountyData(geoid) {
    try {
      const res = await fetch('data/hna/summary/' + geoid + '.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      console.warn('[market-analysis] summary fetch failed:', e.message);
      return null;
    }
  }

  async function fetchLihtcData(geoid) {
    try {
      const res = await fetch('data/hna/lihtc/' + geoid + '.json');
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  /**
   * aggregateCountyData: build the agg object from ACS summary + LIHTC data.
   * ACS variables used:
   *   DP02_0001E  = total households
   *   DP04_0046PE = renter-occupied % of occupied units
   *   DP04_0134E  = median gross rent
   *   DP03_0062E  = median household income
   *   DP04_0089E  = median home value
   *   DP04_0146PE = % renters paying ≥35% of income (cost burden proxy)
   */
  function aggregateCountyData(summaryData, lihtcData) {
    if (!summaryData) return null;
    const p = summaryData.acsProfile || {};

    const households = safeNum(p.DP02_0001E);
    const renterPct  = safeNum(p.DP04_0046PE);   // renter-occupied %
    const medRent    = safeNum(p.DP04_0134E);
    const medIncome  = safeNum(p.DP03_0062E);
    const medHomeVal = safeNum(p.DP04_0089E);
    const burden35   = safeNum(p.DP04_0146PE);   // % paying 35%+ of income for rent

    // Renter households
    let renterHH = null;
    if (households != null && renterPct != null) {
      renterHH = Math.round(households * renterPct / 100);
    }

    // Cost burden rate (fraction)
    const costBurdenRate = burden35 != null ? burden35 / 100 : null;

    // Rent pressure index = (annual rent) / (30% of annual income)
    let rentPressureIndex = null;
    if (medRent != null && medIncome != null && medIncome > 0) {
      rentPressureIndex = (medRent * 12) / (medIncome * 0.30);
    }

    // Existing affordable units from LIHTC data
    let existingAffordable = 0;
    if (lihtcData && Array.isArray(lihtcData.features)) {
      existingAffordable = lihtcData.features.reduce((sum, f) => {
        const props = f.properties || {};
        const n = safeNum(props.N_UNITS || props.units || props.n_units);
        return sum + (n || 0);
      }, 0);
    }
    // Fallback: estimate ~3% of renter households when LIHTC data is empty
    if (existingAffordable === 0 && renterHH) {
      existingAffordable = Math.round(renterHH * 0.03);
    }

    return {
      renter_households: renterHH,
      cost_burden_rate: costBurdenRate,
      rent_pressure_index: rentPressureIndex,
      median_gross_rent: medRent,
      median_household_income: medIncome,
      median_home_value: medHomeVal,
      existing_affordable_units: existingAffordable,
      geo_label: summaryData.geo && summaryData.geo.label ? summaryData.geo.label : ''
    };
  }

  // ── Simulator output ───────────────────────────────────────────────────────

  function updateSimulatorOutput(agg, amiBandKey, proposedUnits) {
    const sim     = runSimulator(agg, amiBandKey, proposedUnits);
    const outputEl = document.getElementById('ma-sim-output');
    if (!outputEl) return;

    const capPct = sim.capture_rate != null
      ? (sim.capture_rate * 100).toFixed(1) + '%'
      : 'N/A';
    const ovPct  = sim.overall_penetration_proxy != null
      ? (sim.overall_penetration_proxy * 100).toFixed(1) + '%'
      : 'N/A';

    outputEl.textContent =
      'AMI band ' + sim.amiBandRange + ': ' +
      'Qualified renter HH \u2248 ' + (sim.qualified_renter_hh || 0).toLocaleString() + ' \u00B7 ' +
      'Existing affordable units \u2248 ' + (sim.existing_affordable || 0).toLocaleString() + ' \u00B7 ' +
      'Proposed units ' + (sim.proposed_units || 0).toLocaleString() + ' \u00B7 ' +
      'Band capture \u2248 ' + capPct + ' \u00B7 ' +
      'Overall penetration proxy \u2248 ' + ovPct;
  }

  // ── Map ────────────────────────────────────────────────────────────────────

  var _map = null;
  var _countyLayers = {};
  var _selectedGeoid = '08077';  // Default: Mesa County
  var _currentAgg = null;

  function initMap(containerId) {
    if (!window.L) return;
    _map = L.map(containerId, {
      center: [39.0, -105.5],
      zoom: 7,
      zoomControl: true
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' +
        ' contributors &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19
    }).addTo(_map);

    loadCountyBoundaries();
  }

  function loadCountyBoundaries() {
    var url = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query' +
      '?where=STATE%3D08' +
      '&outFields=GEOID,NAME' +
      '&outSR=4326' +
      '&f=geojson' +
      '&returnGeometry=true';

    fetch(url)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (geojson) { renderCountyLayer(geojson); })
      .catch(function () {
        console.warn('[market-analysis] TIGERweb county boundaries unavailable; use dropdown to select county');
      });
  }

  function countyStyle(geoid) {
    return {
      color: geoid === _selectedGeoid ? '#1a73e8' : '#6b7280',
      weight: geoid === _selectedGeoid ? 2.5 : 1,
      fillColor: geoid === _selectedGeoid ? '#1a73e8' : '#e5e7eb',
      fillOpacity: geoid === _selectedGeoid ? 0.25 : 0.12
    };
  }

  function renderCountyLayer(geojson) {
    if (!_map || !window.L) return;
    L.geoJSON(geojson, {
      style: function (feature) { return countyStyle(feature.properties.GEOID); },
      onEachFeature: function (feature, lyr) {
        var geoid = feature.properties.GEOID;
        _countyLayers[geoid] = lyr;
        lyr.bindTooltip(feature.properties.NAME, { sticky: true, opacity: 0.85 });
        lyr.on('click', function () { selectCounty(geoid); });
      }
    }).addTo(_map);

    updateLayerStyles();
  }

  function updateLayerStyles() {
    Object.keys(_countyLayers).forEach(function (geoid) {
      _countyLayers[geoid].setStyle(countyStyle(geoid));
    });
  }

  async function selectCounty(geoid) {
    _selectedGeoid = geoid;
    updateLayerStyles();

    // Sync dropdown
    var sel = document.getElementById('ma-county-select');
    if (sel) sel.value = geoid;

    // Show loading
    var resultEl   = document.getElementById('ma-result');
    var simOutputEl = document.getElementById('ma-sim-output');
    if (resultEl)    resultEl.innerHTML = '<p class="ma-loading" aria-live="polite">\u23F3 Loading market data\u2026</p>';
    if (simOutputEl) simOutputEl.textContent = '';

    // Fetch data
    var results = await Promise.all([fetchCountyData(geoid), fetchLihtcData(geoid)]);
    var summaryData = results[0];
    var lihtcData   = results[1];

    var agg = aggregateCountyData(summaryData, lihtcData);
    if (!agg) {
      if (resultEl) resultEl.innerHTML = '<p style="color:var(--error,#ef4444);">Data not available for this county.</p>';
      return;
    }

    _currentAgg = agg;

    var amiBand  = (document.getElementById('ma-ami-band') || {}).value || '60';
    var proposed = parseInt((document.getElementById('ma-proposed-units') || {}).value || '50', 10);

    var scoreData = computeScore(agg, amiBand, proposed);
    updateUiResult(null, scoreData);
    updateSimulatorOutput(agg, amiBand, proposed);

    var heading = document.getElementById('ma-county-name');
    if (heading) heading.textContent = agg.geo_label || 'Selected County';
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('ma-styles')) return;
    var style = document.createElement('style');
    style.id = 'ma-styles';
    style.textContent = [
      '#ma-map{height:420px;border-radius:var(--radius-lg,8px);border:1px solid var(--border,#e0e0e0);}',
      '.ma-controls{display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-end;margin:1rem 0;}',
      '.ma-control-group{display:flex;flex-direction:column;gap:.35rem;}',
      '.ma-control-group label{font-size:.85rem;font-weight:600;color:var(--text,#222);}',
      '.ma-control-group select,.ma-control-group input[type=number]{padding:.35rem .6rem;border:1px solid var(--border,#ccc);border-radius:6px;background:var(--card,#fff);color:var(--text,#222);font-size:.9rem;min-width:180px;}',
      '.ma-btn{padding:.4rem .9rem;border-radius:6px;border:none;background:var(--accent,#1a73e8);color:#fff;font-size:.9rem;font-weight:600;cursor:pointer;transition:opacity .15s;}',
      '.ma-btn:hover{opacity:.88;}',
      '.ma-btn:focus-visible{outline:2px solid var(--accent,#1a73e8);outline-offset:2px;}',
      '.ma-loading{color:var(--muted,#666);font-style:italic;}',
      '.ma-score-card{background:var(--card,#fff);border:1px solid var(--border,#e0e0e0);border-radius:var(--radius-lg,8px);padding:1.25rem;}',
      '.ma-score-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;}',
      '.ma-score-label{font-size:1.1rem;font-weight:700;color:var(--text,#222);}',
      '.ma-score-sub{font-size:.8rem;color:var(--muted,#666);margin-top:.2rem;}',
      '.ma-score-circle{width:72px;height:72px;border-radius:50%;border:3px solid;display:flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:800;flex-shrink:0;}',
      '.ma-sub-scores{margin-bottom:1rem;}',
      '.ma-sub-row{display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem;}',
      '.ma-sub-label{font-size:.82rem;color:var(--text,#222);min-width:165px;}',
      '.ma-sub-bar-wrap{flex:1;height:8px;background:var(--bg2,#f0f0f0);border-radius:4px;overflow:hidden;}',
      '.ma-sub-bar{height:100%;border-radius:4px;transition:width .3s;}',
      '.ma-sub-val{font-size:.82rem;font-weight:700;min-width:28px;text-align:right;}',
      '.ma-flags-section{margin-top:.75rem;}',
      '.ma-flags-title{font-size:.85rem;font-weight:700;color:var(--text,#222);margin-bottom:.4rem;}',
      '.ma-flag{padding:.3rem .65rem;border-radius:6px;font-size:.83rem;margin-bottom:.3rem;}',
      '.ma-flag--high{background:#fef2f2;border-left:3px solid #ef4444;color:#991b1b;}',
      '.ma-flag--medium{background:#fffbeb;border-left:3px solid #f59e0b;color:#92400e;}',
      '.ma-sim-card{background:var(--card,#fff);border:1px solid var(--border,#e0e0e0);border-radius:var(--radius-lg,8px);padding:1.25rem;margin-top:1.5rem;}',
      '.ma-sim-title{font-size:1rem;font-weight:700;color:var(--text,#222);margin-bottom:.75rem;}',
      '#ma-sim-output{font-size:.88rem;color:var(--text,#222);background:var(--bg2,#f8f9fa);border:1px solid var(--border,#e0e0e0);border-radius:6px;padding:.75rem 1rem;margin-top:.75rem;line-height:1.6;min-height:2.5rem;white-space:pre-wrap;font-family:ui-monospace,monospace;}',
      '.ma-methodology{font-size:.8rem;color:var(--muted,#777);background:var(--bg2,#f9f9f9);border-left:3px solid var(--border,#ccc);padding:.75rem 1rem;border-radius:0 6px 6px 0;margin-top:1.5rem;line-height:1.5;}',
      '@media(max-width:600px){.ma-controls{flex-direction:column;}.ma-sub-label{min-width:110px;font-size:.77rem;}.ma-score-circle{width:56px;height:56px;font-size:1.3rem;}}'
    ].join('');
    document.head.appendChild(style);
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function populateCountyDropdown() {
    var sel = document.getElementById('ma-county-select');
    if (!sel) return;
    CO_COUNTIES.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.geoid;
      opt.textContent = c.label;
      if (c.geoid === _selectedGeoid) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function bindEvents() {
    var sel = document.getElementById('ma-county-select');
    if (sel) {
      sel.addEventListener('change', function (e) { selectCounty(e.target.value); });
    }

    var runBtn = document.getElementById('ma-run-btn');
    if (runBtn) {
      runBtn.addEventListener('click', function () {
        if (!_currentAgg) return;
        var amiBand  = (document.getElementById('ma-ami-band') || {}).value || '60';
        var proposed = parseInt((document.getElementById('ma-proposed-units') || {}).value || '50', 10);
        var scoreData = computeScore(_currentAgg, amiBand, proposed);
        updateUiResult(null, scoreData);
        updateSimulatorOutput(_currentAgg, amiBand, proposed);
      });
    }

    // Live update on AMI band / proposed units change
    ['ma-ami-band', 'ma-proposed-units'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', function () {
          if (!_currentAgg) return;
          var amiBand  = (document.getElementById('ma-ami-band') || {}).value || '60';
          var proposed = parseInt((document.getElementById('ma-proposed-units') || {}).value || '50', 10);
          updateSimulatorOutput(_currentAgg, amiBand, proposed);
        });
      }
    });
  }

  function init() {
    var section = document.getElementById('market-analysis-section');
    if (!section) return;

    injectStyles();
    populateCountyDropdown();
    bindEvents();

    if (window.L) {
      initMap('ma-map');
    }

    // Load default county on page load
    selectCounty(_selectedGeoid);
  }

  document.addEventListener('DOMContentLoaded', init);

})();
