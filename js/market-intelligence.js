/**
 * js/market-intelligence.js
 * Market Intelligence page controller.
 *
 * Data sources (all public — no proprietary API keys required):
 *  - Census ACS 5-year estimates (api.census.gov, public)
 *  - FRED economic series via data/fred-data.json (fetched by CI)
 *  - CHFA / HUD LIHTC data via data/chfa-lihtc.json (fetched by CI)
 *  - Prop 123 jurisdictions via data/policy/prop123_jurisdictions.json (local)
 *  - Census Building Permits via FRED proxy series
 */
(function () {
  'use strict';

  /* ── State ─────────────────────────────────────────────────────── */
  var selectedCounty = '';
  var currentData = {};
  var countyAcsCache = null; // null = not yet fetched; object = keyed by county name

  /* ── Colorado counties list ────────────────────────────────────── */
  var CO_COUNTIES = [
    'Adams','Alamosa','Arapahoe','Archuleta','Baca','Bent','Boulder',
    'Broomfield','Chaffee','Cheyenne','Clear Creek','Conejos','Costilla',
    'Crowley','Custer','Delta','Denver','Dolores','Douglas','Eagle',
    'El Paso','Elbert','Fremont','Garfield','Gilpin','Grand','Gunnison',
    'Hinsdale','Huerfano','Jackson','Jefferson','Kiowa','Kit Carson',
    'La Plata','Lake','Larimer','Las Animas','Lincoln','Logan','Mesa',
    'Mineral','Moffat','Montezuma','Montrose','Morgan','Otero','Ouray',
    'Park','Phillips','Pitkin','Prowers','Pueblo','Rio Blanco',
    'Rio Grande','Routt','Saguache','San Juan','San Miguel','Sedgwick',
    'Summit','Teller','Washington','Weld','Yuma'
  ];

  /* ── Colorado city → county lookup (for LIHTC PROJ_CTY field) ──── */
  var CO_CITY_TO_COUNTY = {
    'ALAMOSA': 'Alamosa', 'ALMA': 'Park', 'ANTONITO': 'Conejos',
    'ARVADA': 'Jefferson', 'ASPEN': 'Pitkin', 'AURORA': 'Arapahoe',
    'AVON': 'Eagle', 'BASALT': 'Eagle', 'BAYFIELD': 'La Plata',
    'BOULDER': 'Boulder', 'BRECKENRIDGE': 'Summit', 'BRIGHTON': 'Adams',
    'BROOMFIELD': 'Broomfield', 'BRUSH': 'Morgan', 'BUENA VISTA': 'Chaffee',
    'BURLINGTON': 'Kit Carson', 'CANON CITY': 'Fremont',
    'CARBONDALE': 'Garfield', 'CASTLE ROCK': 'Douglas', 'CENTER': 'Saguache',
    'CENTRAL CITY': 'Gilpin', 'CLIFTON': 'Mesa',
    'COLORADO SPRINGS': 'El Paso', 'COMMERCE CITY': 'Adams',
    'CORTEZ': 'Montezuma', 'CRESTED BUTTE': 'Gunnison', 'DACONO': 'Weld',
    'DEL NORTE': 'Rio Grande', 'DELTA': 'Delta', 'DENVER': 'Denver',
    'DIVIDE': 'Teller', 'DURANGO': 'La Plata', 'EAGLE': 'Eagle',
    'ENGLEWOOD': 'Arapahoe', 'ESTES PARK': 'Larimer', 'EVANS': 'Weld',
    'EVERGREEN': 'Jefferson', 'FLORENCE': 'Fremont',
    'FORT COLLINS': 'Larimer', 'FORT LUPTON': 'Weld',
    'FORT MORGAN': 'Morgan', 'FOUNTAIN': 'El Paso', 'FRASER': 'Grand',
    'FRUITA': 'Mesa', 'GLENDALE': 'Arapahoe',
    'GLENWOOD SPRINGS': 'Garfield', 'GOLDEN': 'Jefferson',
    'GRAND JUNCTION': 'Mesa', 'GREELEY': 'Weld',
    'GREENWOOD VILLAGE': 'Arapahoe', 'GYPSUM': 'Eagle',
    'HIGHLANDS RANCH': 'Douglas', 'IDAHO SPRINGS': 'Clear Creek',
    'KEYSTONE': 'Summit', 'LA JUNTA': 'Otero', 'LAFAYETTE': 'Boulder',
    'LAKEWOOD': 'Jefferson', 'LAMAR': 'Prowers', 'LAS ANIMAS': 'Bent',
    'LEADVILLE': 'Lake', 'LITTLETON': 'Arapahoe', 'LONGMONT': 'Boulder',
    'LOUISVILLE': 'Boulder', 'LOVELAND': 'Larimer', 'MANCOS': 'Montezuma',
    'MILLIKEN': 'Weld', 'MONTE VISTA': 'Rio Grande', 'MONTROSE': 'Montrose',
    'NEDERLAND': 'Boulder', 'NEW CASTLE': 'Garfield',
    'NORTHGLENN': 'Adams', 'NORWOOD': 'San Miguel', 'NUCLA': 'Montrose',
    'PAONIA': 'Delta', 'PARKER': 'Douglas', 'PONCHA SPRINGS': 'Chaffee',
    'PUEBLO': 'Pueblo', 'PUEBLO WEST': 'Pueblo', 'RIFLE': 'Garfield',
    'SALIDA': 'Chaffee', 'SHERIDAN': 'Arapahoe', 'SILVER CLIFF': 'Custer',
    'SILVERTHORNE': 'Summit', 'SOUTH FORK': 'Rio Grande',
    'STEAMBOAT SPRINGS': 'Routt', 'STERLING': 'Logan',
    'TELLURIDE': 'San Miguel', 'THORNTON': 'Adams', 'VAIL': 'Eagle',
    'WALSENBURG': 'Huerfano', 'WESTMINSTER': 'Adams',
    'WHEAT RIDGE': 'Jefferson', 'WINDSOR': 'Weld', 'YUMA': 'Yuma'
  };

  /* ── Helpers ───────────────────────────────────────────────────── */
  function fmt(n, decimals) {
    if (n == null || n === '' || isNaN(n)) return '—';
    var d = decimals != null ? decimals : 0;
    try { return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); } catch (e) { return String(n); }
  }

  function fmtPct(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    return (Number(n) * 100).toFixed(1) + '%';
  }

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function setStatus(msg, isError) {
    var el = document.getElementById('miLoadingStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'mi-status' + (isError ? ' error' : '');
  }

  function resolveData(key) {
    if (typeof DataService !== 'undefined' && DataService.baseData) {
      return DataService.baseData(key);
    }
    return 'data/' + key;
  }

  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  /* ── Fetch all Colorado county Census ACS data ─────────────────── */
  function fetchAllCountyCensus() {
    if (countyAcsCache !== null) return Promise.resolve(countyAcsCache);
    var url = 'https://api.census.gov/data/2022/acs/acs5' +
      '?get=NAME,B25070_007E,B25070_008E,B25070_009E,B25070_010E,B25070_001E' +
      ',B11001_001E,B25014_008E,B25014_001E,B25002_001E,B25002_003E,B25064_001E,B19013_001E' +
      '&for=county:*&in=state:08';
    return fetchJSON(url).then(function (rows) {
      countyAcsCache = {};
      if (!Array.isArray(rows) || rows.length < 2) return countyAcsCache;
      var headers = rows[0];
      function getVal(row, name) {
        var i = headers.indexOf(name);
        return i >= 0 ? Number(row[i]) : null;
      }
      rows.slice(1).forEach(function (row) {
        var fullName = row[headers.indexOf('NAME')] || '';
        var m = fullName.match(/^(.+?)\s+County/i);
        if (!m) return;
        var cName = m[1].trim();
        var totalRenter = getVal(row, 'B25070_001E');
        var burdened30Plus = ['B25070_007E', 'B25070_008E', 'B25070_009E', 'B25070_010E']
          .reduce(function (s, k) { return s + (getVal(row, k) || 0); }, 0);
        var severe = getVal(row, 'B25070_010E');
        var hh = getVal(row, 'B11001_001E');
        var overcrowded = getVal(row, 'B25014_008E');
        var totalUnits = getVal(row, 'B25014_001E');
        var totalHU = getVal(row, 'B25002_001E');
        var vacantHU = getVal(row, 'B25002_003E');
        var medRent = getVal(row, 'B25064_001E');
        var medIncome = getVal(row, 'B19013_001E');
        countyAcsCache[cName] = {
          cost_burden_share: totalRenter > 0 ? burdened30Plus / totalRenter : null,
          severe_burden_share: totalRenter > 0 ? severe / totalRenter : null,
          household_count: hh,
          overcrowding_rate: totalUnits > 0 ? overcrowded / totalUnits : null,
          vacancy_rate: totalHU > 0 ? vacantHU / totalHU : null,
          median_gross_rent_current: medRent && medRent > 0 ? medRent : null,
          median_gross_rent_prior: null,
          ami_estimate: medIncome && medIncome > 0 ? medIncome : null
        };
      });
      return countyAcsCache;
    });
  }

  /* ── County selector ───────────────────────────────────────────── */
  function buildCountySelector() {
    var sel = document.getElementById('countySelect');
    if (!sel) return;
    CO_COUNTIES.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c + ' County';
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () {
      selectedCounty = sel.value;
      applyCountyFilter();
    });
  }

  /* ── Load all data sources ─────────────────────────────────────── */
  function loadAll() {
    setStatus('Loading data…');

    var tasks = [
      loadDemographics(),
      loadLihtcInventory(),
      loadProp123(),
      loadFredData(),
      loadEconomicIndicators(),
      loadLihtcTrends()
    ];

    Promise.allSettled(tasks).then(function (results) {
      var errors = results.filter(function (r) { return r.status === 'rejected'; });
      if (errors.length === tasks.length) {
        setStatus('Some data sources unavailable. Showing cached or partial data.', true);
      } else if (errors.length > 0) {
        setStatus('Loaded with ' + errors.length + ' source(s) unavailable.');
      } else {
        setStatus('All data loaded.');
      }
      buildCharts();
      buildLihtcTrendChart();
    });
  }

  /* ── Load ACS demographic data ─────────────────────────────────── */
  function loadDemographics() {
    return fetchJSON(resolveData('co-demographics.json')).then(function (data) {
      currentData.demographics = data;
      renderDemandKpis(data, selectedCounty);
      // Re-render risk KPIs now that demographics are available
      if (currentData.fred) renderRiskKpis(currentData.fred);
    }).catch(function () {
      // Attempt Census ACS API directly (public, no key required for some series)
      // B25070: rent burden, B11001: households, B25014: overcrowding,
      // B25002: occupancy status (for vacancy rate), B25064: median gross rent
      return fetchJSON(
        'https://api.census.gov/data/2022/acs/acs5?get=B25070_007E,B25070_008E,B25070_009E,B25070_010E,B25070_001E,B11001_001E,B25014_008E,B25014_001E,B25002_001E,B25002_003E,B25064_001E&for=state:08'
      ).then(function (rows) {
        if (!Array.isArray(rows) || rows.length < 2) return;
        var headers = rows[0];
        var vals = rows[1];
        function get(name) { var i = headers.indexOf(name); return i >= 0 ? Number(vals[i]) : null; }
        var totalRenter = get('B25070_001E');
        // Sum of ≥30% burden buckets (30-34.9, 35-39.9, 40-44.9, 45-49.9, ≥50%)
        var burdened30 = [get('B25070_007E'), get('B25070_008E'), get('B25070_009E'), get('B25070_010E')].reduce(function (a, b) { return a + (b || 0); }, 0);
        var severe50 = get('B25070_010E');
        var hh = get('B11001_001E');
        var overcrowded = get('B25014_008E');
        var totalUnits = get('B25014_001E');
        var totalHousingUnits = get('B25002_001E');
        var vacantUnits = get('B25002_003E');
        var medRent = get('B25064_001E');
        var derived = {
          cost_burden_share: totalRenter > 0 ? burdened30 / totalRenter : null,
          severe_burden_share: totalRenter > 0 ? severe50 / totalRenter : null,
          household_count: hh,
          overcrowding_rate: totalUnits > 0 ? overcrowded / totalUnits : null,
          vacancy_rate: totalHousingUnits > 0 ? vacantUnits / totalHousingUnits : null,
          median_gross_rent_current: medRent || null,
          median_gross_rent_prior: null  // single-year fallback; YoY not available
        };
        currentData.demographics = derived;
        renderDemandKpis(derived, selectedCounty);
        // Re-render risk KPIs with newly fetched demographics
        if (currentData.fred) renderRiskKpis(currentData.fred);
      });
    });
  }

  function renderDemandKpis(data, county) {
    if (!data) return;
    var d = county ? (data[county] || data) : data;
    setText('kpiCostBurden', fmtPct(d.cost_burden_share));
    setText('kpiSevereBurden', fmtPct(d.severe_burden_share));
    setText('kpiHHGrowth', d.household_growth_rate_5yr != null ? (Number(d.household_growth_rate_5yr) * 100).toFixed(1) + '%' : '—');
    setText('kpiOvercrowding', fmtPct(d.overcrowding_rate));
  }

  /* ── Load LIHTC inventory ──────────────────────────────────────── */
  function loadLihtcInventory() {
    return fetchJSON(resolveData('chfa-lihtc.json')).then(function (raw) {
      var features = [];
      if (Array.isArray(raw)) features = raw;
      else if (raw && Array.isArray(raw.features)) features = raw.features.map(function (f) { return f.properties || f; });
      else if (raw && Array.isArray(raw.items)) features = raw.items;
      // Enrich county field from city lookup when CNTY_NAME is absent
      features.forEach(function (f) {
        if (!f.CNTY_NAME && f.PROJ_CTY) {
          var countyName = CO_CITY_TO_COUNTY[(f.PROJ_CTY || '').toUpperCase().trim()];
          if (countyName) f.CNTY_NAME = countyName;
        }
      });
      currentData.lihtc = features;
      renderInventoryKpis(features, selectedCounty);
    });
  }

  function renderInventoryKpis(features, county) {
    var filtered = county
      ? features.filter(function (f) {
          var cnty = (f.CNTY_NAME || f.county || '').toString().toLowerCase();
          return cnty.includes(county.toLowerCase());
        })
      : features;

    var projects = filtered.length;
    var totalUnits = filtered.reduce(function (a, f) { return a + (Number(f.N_UNITS || f.total_units || 0) || 0); }, 0);
    var liUnits = filtered.reduce(function (a, f) { return a + (Number(f.LI_UNITS || f.lihtc_units || 0) || 0); }, 0);

    setText('kpiLihtcProjects', fmt(projects));
    setText('kpiLihtcUnits', fmt(totalUnits));
    setText('kpiLihtcLowIncome', fmt(liUnits));

    // Per-1k-HH ratio (using county demographics if available, otherwise statewide)
    var demoForHH = currentData.countyDemographics || currentData.demographics;
    var hh = demoForHH && demoForHH.household_count;
    if (hh && hh > 0) {
      setText('kpiLihtcPer1k', (liUnits / (hh / 1000)).toFixed(1));
    } else {
      setText('kpiLihtcPer1k', '—');
    }

    var statusEl = document.getElementById('inventoryStatus');
    if (statusEl) {
      statusEl.textContent = projects
        ? ('Showing ' + projects + ' LIHTC project(s) with ' + fmt(liUnits) + ' affordable units' + (county ? ' in ' + county + ' County' : ' statewide') + '.')
        : 'No LIHTC records found for the selected area.';
    }

    // Count LIHTC projects in Prop 123 jurisdictions (update if prop123 data is loaded)
    renderProp123LihtcCount(filtered);
  }

  /* ── Prop 123 LIHTC count ──────────────────────────────────────── */
  function isProp123Jurisdiction(cityName) {
    if (!currentData.prop123 || !cityName) return false;
    var city = cityName.toString().toLowerCase().trim();
    return currentData.prop123.some(function (j) {
      // Match city name within jurisdiction name (e.g. "Denver" in "City and County of Denver")
      return (j.name || '').toLowerCase().includes(city);
    });
  }

  function renderProp123LihtcCount(filteredFeatures) {
    if (!currentData.prop123) return;
    var count = filteredFeatures.filter(function (f) {
      return isProp123Jurisdiction(f.PROJ_CTY || f.city || '');
    }).length;
    setText('kpiLihtcProp123', fmt(count));
  }

  /* ── Load Prop 123 ─────────────────────────────────────────────── */
  function loadProp123() {
    return fetchJSON(resolveData('policy/prop123_jurisdictions.json')).then(function (data) {
      var list = (data && data.jurisdictions) ? data.jurisdictions : (Array.isArray(data) ? data : []);
      currentData.prop123 = list;
      renderPolicyKpis(list, selectedCounty);
      // Re-render LIHTC count now that prop123 is available
      if (currentData.lihtc) {
        var county = selectedCounty;
        var filtered = county
          ? currentData.lihtc.filter(function (f) {
              var cnty = (f.CNTY_NAME || f.county || '').toString().toLowerCase();
              return cnty.includes(county.toLowerCase());
            })
          : currentData.lihtc;
        renderProp123LihtcCount(filtered);
      }
    });
  }

  function renderPolicyKpis(list, county) {
    var filtered = county
      ? list.filter(function (j) { return (j.name || '').toLowerCase().includes(county.toLowerCase()); })
      : list;
    var counties = filtered.filter(function (j) { return (j.kind || j.type || '').toLowerCase().includes('county'); });
    var munis = filtered.filter(function (j) { return !(j.kind || j.type || '').toLowerCase().includes('county'); });
    setText('kpiProp123Count', fmt(filtered.length));
    setText('kpiProp123Counties', fmt(counties.length));
    setText('kpiProp123Munis', fmt(munis.length));
  }

  /* ── Load FRED data ────────────────────────────────────────────── */
  function loadFredData() {
    return fetchJSON(resolveData('fred-data.json')).then(function (data) {
      // fred-data.json may wrap series under a 'series' key; normalise to flat map
      var normalized = (data && data.series) ? data.series : data;
      currentData.fred = normalized;
      renderSupplyKpis(normalized);
      renderRiskKpis(normalized);
    });
  }

  function renderSupplyKpis(data) {
    if (!data) return;
    // FRED series: PERMIT5 = 5+ unit permits, PERMIT = total permits
    // Also accept legacy Colorado-specific series names for backward compatibility
    var permits = data.PERMIT5 || data.PERMIT || data.COBPPRIV5F || data.COBPPRIV || null;
    var latestPermit = permits && Array.isArray(permits.observations)
      ? permits.observations[permits.observations.length - 1] : null;
    var prevPermit = permits && Array.isArray(permits.observations) && permits.observations.length > 12
      ? permits.observations[permits.observations.length - 13] : null; // ~12 months prior

    setText('kpiPermits', latestPermit ? fmt(latestPermit.value) : '—');

    // Completions from FRED COMPUTSA series
    var completions = data.COMPUTSA || null;
    var latestCompletion = completions && Array.isArray(completions.observations)
      ? completions.observations[completions.observations.length - 1] : null;
    setText('kpiCompletions', latestCompletion ? fmt(latestCompletion.value) : '—');

    // Units under construction from FRED UNDCONTSA series
    var underConst = data.UNDCONTSA || null;
    var latestUnderConst = underConst && Array.isArray(underConst.observations)
      ? underConst.observations[underConst.observations.length - 1] : null;
    setText('kpiUnderConst', latestUnderConst ? fmt(latestUnderConst.value) : '—');

    if (latestPermit && prevPermit && prevPermit.value) {
      var yoy = ((latestPermit.value - prevPermit.value) / prevPermit.value * 100).toFixed(1);
      setText('kpiYoyPermits', yoy + '%');
    } else {
      setText('kpiYoyPermits', '—');
    }
  }

  function renderRiskKpis(data) {
    if (!data) return;
    var demo = currentData.countyDemographics || currentData.demographics;

    // Pipeline pressure: filter LIHTC by county when applicable
    var lihtc = currentData.lihtc;
    if (selectedCounty && lihtc) {
      lihtc = lihtc.filter(function (f) {
        var cnty = (f.CNTY_NAME || f.county || '').toString().toLowerCase();
        return cnty.includes(selectedCounty.toLowerCase());
      });
    }

    // Vacancy proxy from ACS B25002 vacancy rate
    var vacEl = document.getElementById('riskVacancy');
    if (vacEl) {
      var vac = demo ? demo.vacancy_rate : null;
      vacEl.textContent = vac != null ? fmtPct(vac) : '—';
      vacEl.className = 'risk-value ' + (vac != null ? (vac > 0.07 ? 'risk-low' : vac > 0.04 ? 'risk-med' : 'risk-high') : '');
    }

    // Rent trend proxy from median gross rent YoY change
    var rentEl = document.getElementById('riskRentTrend');
    if (rentEl) {
      if (demo && demo.median_gross_rent_current && demo.median_gross_rent_prior) {
        var rentYoy = ((demo.median_gross_rent_current - demo.median_gross_rent_prior) / demo.median_gross_rent_prior * 100).toFixed(1);
        rentEl.textContent = rentYoy + '%/yr';
        rentEl.className = 'risk-value ' + (Number(rentYoy) > 5 ? 'risk-high' : Number(rentYoy) > 2 ? 'risk-med' : 'risk-low');
      } else {
        rentEl.textContent = '—';
      }
    }

    // Pipeline pressure: LIHTC projects per 1,000 households
    var hh = demo && demo.household_count;
    var ppEl = document.getElementById('riskPipeline');
    if (ppEl) {
      if (lihtc && hh) {
        var pipelineRate = (lihtc.length / (hh / 1000)).toFixed(2);
        ppEl.textContent = pipelineRate + ' projects/1k HH';
        ppEl.className = 'risk-value risk-med';
      } else {
        ppEl.textContent = '—';
      }
    }

    // Affordability gap: (60% AMI monthly housing budget) − median market rent
    var affordEl = document.getElementById('riskAffordGap');
    if (affordEl) {
      var ami = demo && demo.ami_estimate;
      var medRent = demo && (demo.median_gross_rent_current || demo.median_gross_rent);
      if (ami && medRent) {
        // 60% AMI annual ÷ 12 months × 30% affordability threshold
        var maxAffordRent = Math.round((ami * 0.6 / 12) * 0.30);
        var gap = maxAffordRent - Math.round(medRent);
        affordEl.textContent = (gap >= 0 ? '+' : '') + fmt(gap) + '/mo';
        affordEl.className = 'risk-value ' + (gap >= 0 ? 'risk-low' : gap > -200 ? 'risk-med' : 'risk-high');
      } else {
        affordEl.textContent = '—';
      }
    }
  }

  /* ── Apply county filter ───────────────────────────────────────── */
  function applyCountyFilter() {
    if (currentData.lihtc) renderInventoryKpis(currentData.lihtc, selectedCounty);
    if (currentData.prop123) renderPolicyKpis(currentData.prop123, selectedCounty);
    if (currentData.econIndicators) renderEconomicKpis(currentData.econIndicators, selectedCounty);

    if (!selectedCounty) {
      // Statewide view — restore statewide demographics and rebuild charts
      currentData.countyDemographics = null;
      if (currentData.demographics) renderDemandKpis(currentData.demographics, '');
      if (currentData.fred) renderRiskKpis(currentData.fred);
      buildCharts();
      buildLihtcTrendChart();
      setStatus('Statewide (Colorado) · Census ACS 2022 5-Year Estimates.');
      return;
    }

    setStatus('Loading ' + selectedCounty + ' County data…');
    fetchAllCountyCensus().then(function (cache) {
      var cData = cache[selectedCounty] || null;
      currentData.countyDemographics = cData;
      if (cData) {
        renderDemandKpis(cData, '');
        if (currentData.fred) renderRiskKpis(currentData.fred);
        setStatus(selectedCounty + ' County · Census ACS 2022 5-Year Estimates. Supply data shows statewide FRED series.');
      } else {
        setText('kpiCostBurden', '--');
        setText('kpiSevereBurden', '--');
        setText('kpiHHGrowth', '--');
        setText('kpiOvercrowding', '--');
        if (currentData.fred) renderRiskKpis(currentData.fred);
        setStatus(selectedCounty + ' County Census data unavailable.', true);
      }
      buildDemandChart();
      buildSupplyChart();
      buildLihtcTrendChart();
    }).catch(function () {
      currentData.countyDemographics = null;
      setText('kpiCostBurden', '--');
      setText('kpiSevereBurden', '--');
      setText('kpiHHGrowth', '--');
      setText('kpiOvercrowding', '--');
      if (currentData.fred) renderRiskKpis(currentData.fred);
      buildDemandChart();
      buildSupplyChart();
      buildLihtcTrendChart();
      setStatus('Census API unavailable for ' + selectedCounty + ' County.', true);
    });
  }

  /* ── Load Economic Indicators ──────────────────────────────────── */
  function loadEconomicIndicators() {
    return fetchJSON(resolveData('co-county-economic-indicators.json')).then(function (data) {
      currentData.econIndicators = data;
      renderEconomicKpis(data, selectedCounty);
    });
  }

  function renderEconomicKpis(data, county) {
    if (!data || !data.counties) return;
    var d = county ? (data.counties[county] || null) : null;

    // Statewide: compute averages from all counties
    if (!d && !county) {
      var all = Object.values(data.counties);
      var avg = function (field) {
        var vals = all.map(function (c) { return c[field]; }).filter(function (v) { return v != null; });
        return vals.length ? vals.reduce(function (s, v) { return s + v; }, 0) / vals.length : null;
      };
      d = {
        unemployment_rate: avg('unemployment_rate'),
        job_growth_5yr_pct: avg('job_growth_5yr_pct'),
        affordability_index: avg('affordability_index'),
        population_growth_5yr_pct: avg('population_growth_5yr_pct'),
        median_home_price: avg('median_home_price'),
        median_hh_income: avg('median_hh_income')
      };
    }

    if (!d) return;

    var unemp = d.unemployment_rate;
    var jobGrowth = d.job_growth_5yr_pct;
    var affordIdx = d.affordability_index;
    var popGrowth = d.population_growth_5yr_pct;
    var medPrice = d.median_home_price;
    var medIncome = d.median_hh_income;

    setText('kpiUnemployment', unemp != null ? unemp.toFixed(1) + '%' : '—');
    setText('kpiJobGrowth', jobGrowth != null ? (jobGrowth > 0 ? '+' : '') + jobGrowth.toFixed(1) + '%' : '—');
    setText('kpiAffordIndex', affordIdx != null ? affordIdx.toFixed(1) + 'x' : '—');
    setText('kpiPopGrowth', popGrowth != null ? (popGrowth > 0 ? '+' : '') + popGrowth.toFixed(1) + '%' : '—');
    setText('kpiMedianPrice', medPrice != null ? '$' + fmt(Math.round(medPrice)) : '—');
    setText('kpiMedianIncome', medIncome != null ? '$' + fmt(Math.round(medIncome)) : '—');

    // Status badges
    setBadge('badgeUnemployment', unemp,
      function (v) { return v < 3.8 ? 'good' : v <= 5.5 ? 'warn' : 'bad'; },
      function (v) { return v < 3.8 ? 'Low' : v <= 5.5 ? 'Moderate' : 'High'; });
    setBadge('badgeJobGrowth', jobGrowth,
      function (v) { return v >= 8 ? 'good' : v >= 2 ? 'warn' : 'bad'; },
      function (v) { return v >= 8 ? 'Strong' : v >= 2 ? 'Moderate' : 'Weak'; });
    setBadge('badgeAffordIndex', affordIdx,
      function (v) { return v <= 3 ? 'good' : v <= 6 ? 'warn' : 'bad'; },
      function (v) { return v <= 3 ? 'Affordable' : v <= 6 ? 'Stretched' : 'Unaffordable'; });
    setBadge('badgePopGrowth', popGrowth,
      function (v) { return v >= 3 ? 'good' : v >= 0 ? 'warn' : 'bad'; },
      function (v) { return v >= 3 ? 'Growing' : v >= 0 ? 'Stable' : 'Declining'; });
  }

  function setBadge(id, value, colorFn, labelFn) {
    var el = document.getElementById(id);
    if (!el) return;
    if (value == null) { el.textContent = ''; el.className = 'econ-kpi-badge'; return; }
    var tier = colorFn(value);
    el.textContent = labelFn(value);
    el.className = 'econ-kpi-badge badge-' + tier;
  }

  /* ── Load LIHTC Trends ─────────────────────────────────────────── */
  function loadLihtcTrends() {
    return fetchJSON(resolveData('lihtc-trends-by-county.json')).then(function (data) {
      currentData.lihtcTrends = data;
      buildLihtcTrendChart();
    });
  }

  /* ── Charts ────────────────────────────────────────────────────── */
  var demandChartInst = null;
  var supplyChartInst = null;
  var lihtcTrendChartInst = null;

  function buildCharts() {
    buildDemandChart();
    buildSupplyChart();
  }

  function buildDemandChart() {
    var ctx = document.getElementById('demandChart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (demandChartInst) { demandChartInst.destroy(); }

    var demo = selectedCounty ? currentData.countyDemographics : currentData.demographics;
    var labels = ['Cost-Burdened (≥30%)', 'Severely Burdened (≥50%)', 'Overcrowded'];
    var values = [
      demo ? (Number(demo.cost_burden_share || 0) * 100) : 0,
      demo ? (Number(demo.severe_burden_share || 0) * 100) : 0,
      demo ? (Number(demo.overcrowding_rate || 0) * 100) : 0
    ];

    demandChartInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Share of Households (%)',
          data: values,
          backgroundColor: ['rgba(14,165,160,0.65)', 'rgba(220,38,38,0.65)', 'rgba(217,119,6,0.65)'],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { callback: function (v) { return v + '%'; } } }
        }
      }
    });
  }

  function buildSupplyChart() {
    var ctx = document.getElementById('supplyChart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (supplyChartInst) { supplyChartInst.destroy(); supplyChartInst = null; }

    // For county view, FRED doesn't have county-level permit data
    var msgEl = document.getElementById('supplyCountyMsg');
    if (selectedCounty) {
      ctx.style.display = 'none';
      if (!msgEl) {
        msgEl = document.createElement('p');
        msgEl.id = 'supplyCountyMsg';
        msgEl.className = 'mi-status';
        msgEl.style.cssText = 'text-align:center;padding:3rem 1rem;';
        ctx.parentNode.appendChild(msgEl);
      }
      msgEl.textContent = 'County-level permit data not available via FRED. Supply KPIs above reflect statewide series.';
      return;
    }

    // Statewide: restore canvas and remove county message
    ctx.style.display = '';
    if (msgEl) msgEl.remove();

    var fred = currentData.fred;
    var obs = fred && (fred.PERMIT5 || fred.PERMIT || fred.COBPPRIV5F || fred.COBPPRIV);
    var observations = obs && Array.isArray(obs.observations) ? obs.observations.slice(-24) : [];
    var labels = observations.map(function (o) { return o.date ? o.date.slice(0, 7) : ''; });
    var values = observations.map(function (o) { return Number(o.value) || 0; });

    if (!labels.length) {
      labels = ['No permit data'];
      values = [0];
    }

    supplyChartInst = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Multifamily Permits (5+ units)',
          data: values,
          borderColor: 'rgba(14,165,160,1)',
          backgroundColor: 'rgba(14,165,160,0.12)',
          fill: true,
          tension: 0.3,
          pointRadius: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  function buildLihtcTrendChart() {
    var ctx = document.getElementById('lihtcTrendChart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (lihtcTrendChartInst) { lihtcTrendChartInst.destroy(); lihtcTrendChartInst = null; }

    var trends = currentData.lihtcTrends;
    if (!trends || !trends.counties || !trends.years) return;

    var years = trends.years;
    var COLORS = [
      'rgba(14,165,160,1)', 'rgba(99,102,241,1)', 'rgba(245,158,11,1)',
      'rgba(239,68,68,1)', 'rgba(34,197,94,1)', 'rgba(168,85,247,1)'
    ];

    if (selectedCounty && trends.counties[selectedCounty]) {
      // Single county: bar chart
      var countyData = trends.counties[selectedCounty];
      var values = years.map(function (yr) { return countyData[yr] || 0; });
      lihtcTrendChartInst = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: years.map(String),
          datasets: [{
            label: selectedCounty + ' County — LIHTC Projects',
            data: values,
            backgroundColor: 'rgba(14,165,160,0.65)',
            borderRadius: 5
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
      });
    } else {
      // Statewide: multi-line chart of top 6 counties by total projects
      var countyTotals = Object.entries(trends.counties).map(function (entry) {
        var name = entry[0];
        var yearMap = entry[1];
        var total = years.reduce(function (s, yr) { return s + (yearMap[yr] || 0); }, 0);
        return { name: name, total: total };
      });
      countyTotals.sort(function (a, b) { return b.total - a.total; });
      var top6 = countyTotals.slice(0, 6);

      var datasets = top6.map(function (c, i) {
        var countyData = trends.counties[c.name];
        return {
          label: c.name,
          data: years.map(function (yr) { return countyData[yr] || 0; }),
          borderColor: COLORS[i],
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: 3
        };
      });

      lihtcTrendChartInst = new Chart(ctx, {
        type: 'line',
        data: { labels: years.map(String), datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
      });
    }
  }

  /* ── Export ────────────────────────────────────────────────────── */
  function exportJson() {
    var payload = {
      exported_at: new Date().toISOString(),
      county: selectedCounty || 'Statewide',
      demographics: currentData.countyDemographics || currentData.demographics || null,
      lihtc_summary: currentData.lihtc ? {
        count: currentData.lihtc.length,
        total_units: currentData.lihtc.reduce(function (a, f) { return a + (Number(f.N_UNITS || f.total_units || 0) || 0); }, 0)
      } : null,
      prop123_count: currentData.prop123 ? currentData.prop123.length : null
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'market-intelligence-' + (selectedCounty || 'statewide') + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportCsv() {
    var rows = [
      ['Metric', 'Value', 'County', 'Source'],
      ['Cost-Burdened Renters', document.getElementById('kpiCostBurden') ? document.getElementById('kpiCostBurden').textContent : '—', selectedCounty || 'Statewide', 'ACS B25070'],
      ['Severely Cost-Burdened', document.getElementById('kpiSevereBurden') ? document.getElementById('kpiSevereBurden').textContent : '—', selectedCounty || 'Statewide', 'ACS B25070'],
      ['Household Growth (5yr)', document.getElementById('kpiHHGrowth') ? document.getElementById('kpiHHGrowth').textContent : '—', selectedCounty || 'Statewide', 'ACS B11001'],
      ['Overcrowded Units', document.getElementById('kpiOvercrowding') ? document.getElementById('kpiOvercrowding').textContent : '—', selectedCounty || 'Statewide', 'ACS B25014'],
      ['LIHTC Projects', document.getElementById('kpiLihtcProjects') ? document.getElementById('kpiLihtcProjects').textContent : '—', selectedCounty || 'Statewide', 'CHFA/HUD'],
      ['LIHTC Total Units', document.getElementById('kpiLihtcUnits') ? document.getElementById('kpiLihtcUnits').textContent : '—', selectedCounty || 'Statewide', 'CHFA/HUD'],
      ['Prop 123 Committed', document.getElementById('kpiProp123Count') ? document.getElementById('kpiProp123Count').textContent : '—', selectedCounty || 'Statewide', 'DOLA'],
    ];
    var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'market-intelligence-' + (selectedCounty || 'statewide') + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ── Init ──────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    buildCountySelector();
    loadAll();

    var btnJson = document.getElementById('exportJson');
    if (btnJson) btnJson.addEventListener('click', exportJson);

    var btnCsv = document.getElementById('exportCsv');
    if (btnCsv) btnCsv.addEventListener('click', exportCsv);
  });

  /* ── Public API ────────────────────────────────────────────────── */
  window.MarketIntelligence = {
    reload: loadAll,
    exportJson: exportJson,
    exportCsv: exportCsv
  };

}());
