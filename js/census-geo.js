/**
 * Census snapshot (ACS Profile) with geography dropdowns for:
 *  - National (United States aggregate)
 *  - States (uses cached data/census-acs-state.json first, no API key required)
 *  - Counties (within a state)
 *  - Places (within a state)
 *
 * Also renders a Housing Construction Activity sub-section from fred-data.json.
 *
 * Uses window.APP_CONFIG.CENSUS_API_KEY (js/config.js) for county/place/national.
 * State-level data is served from data/census-acs-state.json (pre-fetched cache).
 */
(() => {
  const KEY      = (window.APP_CONFIG && window.APP_CONFIG.CENSUS_API_KEY) ? window.APP_CONFIG.CENSUS_API_KEY : "";
  const VINTAGES = ["2023", "2022", "2021", "2020"];
  const DATASET  = (v) => `https://api.census.gov/data/${v}/acs/acs5/profile`;

  /* ---- ACS metrics (shown per geography) ---- */
  const METRICS = [
    { key: "DP05_0001E",  label: "Population",              fmt: formatNumber   },
    { key: "DP03_0062E",  label: "Median household income", fmt: formatCurrency },
    { key: "DP04_0134E",  label: "Median gross rent",       fmt: formatCurrency },
    { key: "DP04_0089E",  label: "Median home value",       fmt: formatCurrency },
    { key: "DP03_0099PE", label: "Uninsured rate",          fmt: formatPct      },
    { key: "DP02_0067PE", label: "Bachelor's degree+",      fmt: formatPct      },
    { key: "DP03_0009PE", label: "Unemployment rate",       fmt: formatPct      },
    { key: "DP04_0003PE", label: "Vacancy rate",            fmt: formatPct      },
  ];

  /* ---- Housing construction metrics (national, from FRED cache) ---- */
  const CONSTRUCTION_METRICS = [
    {
      id:    "HOUST5F",
      label: "Multifamily housing starts",
      sub:   "5+ unit structures, SAAR",
      scale: 1000,
      unit:  "units/yr",
      fmt:   (n) => Math.round(n * 1000).toLocaleString(),
      src:   "https://fred.stlouisfed.org/series/HOUST5F",
      note:  "New privately-owned 5+ unit housing starts (seasonally adjusted annual rate)"
    },
    {
      id:    "PERMIT5",
      label: "Building permits",
      sub:   "5+ unit structures, SAAR",
      scale: 1000,
      unit:  "units/yr",
      fmt:   (n) => Math.round(n * 1000).toLocaleString(),
      src:   "https://fred.stlouisfed.org/series/PERMIT5",
      note:  "New privately-owned 5+ unit housing units authorized by building permits (SAAR)"
    },
    {
      id:    "UNDCONTSA",
      label: "Units under construction",
      sub:   "All multifamily, SAAR",
      scale: 1000,
      unit:  "units",
      fmt:   (n) => Math.round(n * 1000).toLocaleString(),
      src:   "https://fred.stlouisfed.org/series/UNDCONTSA",
      note:  "New privately-owned housing units under construction (seasonally adjusted)"
    },
    {
      id:    "COMPUTSA",
      label: "Completions",
      sub:   "5+ unit structures, SAAR",
      scale: 1000,
      unit:  "units/yr",
      fmt:   (n) => Math.round(n * 1000).toLocaleString(),
      src:   "https://fred.stlouisfed.org/series/COMPUTSA",
      note:  "New privately-owned 5+ unit housing units completed (seasonally adjusted annual rate)"
    },
  ];

  const $ = (sel) => document.querySelector(sel);

  function formatNumber(n)   { return isFinite(n) ? Math.round(n).toLocaleString() : "—"; }
  function formatCurrency(n) { return isFinite(n) ? Math.round(n).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "—"; }
  function formatPct(n)      { return isFinite(n) ? Number(n).toFixed(1) + "%" : "—"; }

  /* ---- Cached state data (data/census-acs-state.json) ---- */
  let _stateCache = null;
  async function loadStateCacheJson() {
    if (_stateCache) return _stateCache;
    const json = await DataService.getJSON(DataService.baseData("census-acs-state.json"));
    _stateCache = json;
    return json;
  }

  /* ---- Derived metrics (computed client-side from cached fields) ---- */
  const DERIVED_METRICS = [
    {
      key: "rent_to_income",
      label: "Rent-to-income ratio",
      compute: (r) => {
        const rent = Number(r.median_gross_rent);
        const inc  = Number(r.median_household_income);
        if (!isFinite(rent) || !isFinite(inc) || inc <= 0) return null;
        return (rent * 12) / inc;
      },
      fmt: (v) => (v * 100).toFixed(1) + "% of income",
      note: "Annual rent as % of median household income"
    },
    {
      key: "renter_share",
      label: "Renter-occupied share",
      compute: (r) => {
        // Prefer pre-computed field; fall back to derived
        if (r.renter_share != null && isFinite(Number(r.renter_share))) return Number(r.renter_share);
        const own  = Number(r.owner_occupied);
        const rent = Number(r.renter_occupied);
        if (!isFinite(own) || !isFinite(rent) || (own + rent) <= 0) return null;
        return rent / (own + rent);
      },
      fmt: (v) => (v * 100).toFixed(1) + "%",
      note: "Share of occupied housing units that are renter-occupied"
    },
    {
      key: "newer_stock_share",
      label: "Built 2010 or later",
      compute: (r) => {
        const newer = Number(r.built_2010_or_later);
        const total = Number(r.housing_units_year_built_total);
        if (!isFinite(newer) || !isFinite(total) || total <= 0) return null;
        return newer / total;
      },
      fmt: (v) => (v * 100).toFixed(1) + "% of stock",
      note: "Share of housing units built in 2010 or later"
    }
  ];

  function renderDerivedMetrics(record, container) {
    DERIVED_METRICS.forEach(dm => {
      const val = dm.compute(record);
      const existing = container.querySelector(`[data-derived="${dm.key}"]`);
      if (existing) existing.remove();
      if (val === null || !isFinite(val)) return; // hide if fields missing
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.derived = dm.key;
      card.title = dm.note;
      card.innerHTML = `<p class="num">${dm.fmt(val)}</p><p class="lbl">${dm.label}</p>`;
      container.appendChild(card);
    });
  }

  function censusProfileUrl(record) {
    // Build a data.census.gov profile link for the selected geography
    if (record.county && record.state) return `https://data.census.gov/profile?g=0500000US${record.state}${record.county}`;
    if (record.place  && record.state) return `https://data.census.gov/profile?g=1600000US${record.state}${record.place}`;
    if (record.state && !record.county && !record.place) return `https://data.census.gov/profile?g=0400000US${record.state}`;
    return "https://data.census.gov/";
  }

  function renderCachedStateStats(record, vintage, grid, vintageEl) {
    const stateFips = record.state_fips || record.state;
    const srcUrl = stateFips ? `https://data.census.gov/profile?g=0400000US${stateFips}` : "https://data.census.gov/";
    if (vintageEl) vintageEl.innerHTML = `ACS ${vintage} 5-year (cached) &bull; ${record.state_name} &bull; <a href="${srcUrl}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">View source ↗</a>`;
    grid.innerHTML = "";

    // Standard metrics from cache
    const CACHE_METRICS = [
      { field: "population_total",        label: "Population",              fmt: formatNumber   },
      { field: "median_household_income", label: "Median household income", fmt: formatCurrency },
      { field: "median_gross_rent",       label: "Median gross rent",       fmt: formatCurrency },
      { field: "median_home_value",       label: "Median home value",       fmt: formatCurrency },
    ];
    CACHE_METRICS.forEach(m => {
      const val = Number(record[m.field]);
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `<p class="num">${m.fmt(val)}</p><p class="lbl">${m.label}</p>`;
      grid.appendChild(card);
    });

    // Derived metrics (hidden individually if fields missing)
    renderDerivedMetrics(record, grid);
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  }

  function apiKey() { return KEY ? `&key=${encodeURIComponent(KEY)}` : ""; }

  function buildUrl(vintage, geography, params) {
    const vars = ["NAME", ...METRICS.map(m => m.key)].join(",");
    if (geography === "national") return `${DATASET(vintage)}?get=${vars}&for=us:1${apiKey()}`;
    if (geography === "state")    return `${DATASET(vintage)}?get=${vars}&for=state:*${apiKey()}`;
    if (geography === "county")   return `${DATASET(vintage)}?get=${vars}&for=county:*&in=state:${params.state}${apiKey()}`;
    if (geography === "place")    return `${DATASET(vintage)}?get=${vars}&for=place:*&in=state:${params.state}${apiKey()}`;
    throw new Error("Unknown geography");
  }

  async function getWorkingVintage(geography, params) {
    for (const v of VINTAGES) {
      try {
        const url  = buildUrl(v, geography, params);
        const data = await fetchJson(url);
        if (Array.isArray(data) && data.length > 1) return { vintage: v, data };
      } catch (e) { /* try next */ }
    }
    throw new Error("No working ACS vintage found");
  }

  function toRows(table) {
    const [header, ...rows] = table;
    return rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  }

  function fillOptions(selectEl, items, placeholder) {
    selectEl.innerHTML = "";
    if (placeholder) {
      const ph = document.createElement("option");
      ph.value = ""; ph.textContent = placeholder;
      selectEl.appendChild(ph);
    }
    items.forEach(it => {
      const o = document.createElement("option");
      o.value = it.value; o.textContent = it.label;
      selectEl.appendChild(o);
    });
  }

  /* ============================================================
     HOUSING CONSTRUCTION SECTION  (FRED cache, always national)
     ============================================================ */
  async function renderConstructionSection() {
    const section = document.getElementById("census-construction");
    if (!section) return;

    let fredData = null;
    try {
      const raw = await fetchJson("data/fred-data.json");
      fredData = raw.series || {};
    } catch (e) {
      console.warn("[census-geo] Could not load fred-data.json:", e);
    }

    section.innerHTML = "";

    for (const m of CONSTRUCTION_METRICS) {
      const card = document.createElement("div");
      card.className = "card census-construction-card";
      card.title = m.note;

      let valueStr = "—";
      let dateStr  = "";
      let yoyStr   = "";
      let yoyClass = "";

      if (fredData && fredData[m.id]) {
        const obs = (fredData[m.id].observations || [])
          .filter(o => o.value !== "." && o.value != null)
          .map(o => ({ date: o.date, value: Number(o.value) }))
          .filter(o => isFinite(o.value));

        if (obs.length) {
          const last = obs[obs.length - 1];
          valueStr = m.fmt(last.value);

          // Date label: show month/year
          try {
            const d = new Date(last.date + "T12:00:00Z");
            dateStr = d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
          } catch (_) { dateStr = last.date; }

          // YoY change (12 months ago)
          if (obs.length >= 13) {
            const prev = obs[obs.length - 13];
            const pct  = ((last.value - prev.value) / Math.abs(prev.value)) * 100;
            const sign = pct >= 0 ? "▲" : "▼";
            yoyStr   = `${sign} ${Math.abs(pct).toFixed(1)}% yr/yr`;
            yoyClass = pct >= 0 ? "delta-up" : "delta-down";
          }
        }
      }

      card.innerHTML = `
        <p class="num">${valueStr}</p>
        <p class="lbl">${m.label}</p>
        <p class="sub-lbl">${m.sub}</p>
        ${dateStr  ? `<p class="census-date">${dateStr}</p>` : ""}
        ${yoyStr   ? `<p class="census-yoy ${yoyClass}">${yoyStr}</p>` : ""}
        <p class="census-src"><a href="${m.src}" target="_blank" rel="noopener">FRED ↗</a></p>
      `;

      section.appendChild(card);
    }
  }

  /* ============================================================
     ACS STAT CARDS
     ============================================================ */
  function renderStats(name, record, vintage) {
    const grid      = $(".census-grid");
    const vintageEl = document.querySelector("[data-census-vintage]");
    const srcUrl = censusProfileUrl(record);
    if (vintageEl) vintageEl.innerHTML = `ACS ${vintage} 5-year (profile) &bull; ${name} &bull; <a href="${srcUrl}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">View source ↗</a>`;

    grid.innerHTML = "";
    METRICS.forEach(m => {
      const val  = Number(record[m.key]);
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `<p class="num">${m.fmt(val)}</p><p class="lbl">${m.label}</p>`;
      grid.appendChild(card);
    });
  }

  /* ---- loaders ---- */
  async function loadNational() {
    const { vintage, data } = await getWorkingVintage("national", {});
    return { vintage, record: toRows(data)[0] };
  }

  async function loadStates() {
    const { vintage, data } = await getWorkingVintage("state", {});
    const rows   = toRows(data);
    const states = rows.map(r => ({ value: r.state, label: r.NAME }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { vintage, states, rows };
  }

  async function loadCounties(stateFips) {
    const { vintage, data } = await getWorkingVintage("county", { state: stateFips });
    const rows  = toRows(data);
    const items = rows.map(r => ({ value: `${r.state}:${r.county}`, label: r.NAME, raw: r }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { vintage, items };
  }

  async function loadPlaces(stateFips) {
    const { vintage, data } = await getWorkingVintage("place", { state: stateFips });
    const rows  = toRows(data);
    const items = rows.map(r => ({ value: `${r.state}:${r.place}`, label: r.NAME, raw: r }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { vintage, items };
  }

  /* ---- UI helpers ---- */
  function showEl(id, show) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? "" : "none";
  }

  /* ============================================================
     INIT
     ============================================================ */
  async function init() {
    const levelEl = $("#censusLevel");
    const stateEl = $("#censusState");
    const geoEl   = $("#censusGeo");
    const vintageEl = document.querySelector("[data-census-vintage]");

    if (!levelEl || !stateEl || !geoEl) return;

    showEl("censusStateWrap", false);
    showEl("censusGeoWrap", false);

    /* Always render the construction section from FRED cache */
    renderConstructionSection().catch(e => console.warn("[census-geo] construction section:", e));

    /* --- Try to load cached state data first (no API key required) --- */
    let cachedStateData = null; // array of state records from census-acs-state.json
    let cachedVintage   = "";
    try {
      const cacheJson  = await loadStateCacheJson();
      cachedStateData  = cacheJson.data || [];
      cachedVintage    = (cacheJson.meta && cacheJson.meta.dataset) ? cacheJson.meta.dataset.split("/")[0] : String(new Date().getFullYear() - 2);
    } catch (e) {
      console.warn("[census-geo] Could not load census-acs-state.json:", e);
    }

    /* Build state list from cache and populate select */
    if (cachedStateData && cachedStateData.length) {
      const cacheStates = cachedStateData
        .map(r => ({ value: r.state_fips, label: r.state_name }))
        .sort((a, b) => a.label.localeCompare(b.label));
      fillOptions(stateEl, cacheStates, "Select a state…");
      fillOptions(geoEl,   cacheStates, "Select a state…");
    }

    /* Load national + state list from Census API in parallel (fallback for non-cached geographies) */
    let statesInfo   = null;
    let nationalInfo = null;

    Promise.allSettled([loadNational(), loadStates()]).then(([natResult, stResult]) => {
      if (natResult.status === "fulfilled") nationalInfo = natResult.value;
      if (stResult.status === "fulfilled") {
        statesInfo = stResult.value;
        // Only refill if we don't have cached data
        if (!cachedStateData || !cachedStateData.length) {
          fillOptions(stateEl, statesInfo.states, "Select a state…");
          fillOptions(geoEl,   statesInfo.states, "Select a state…");
        }
      }
    }).catch(err => console.warn("[census-geo] API pre-fetch:", err));

    const grid = $(".census-grid");

    /* Default: show state view using cached data */
    if (cachedStateData && cachedStateData.length) {
      levelEl.value = "state";
      showEl("censusGeoWrap", true);
      // Default to Colorado if available, else first state
      const defaultRec = cachedStateData.find(r => r.state_name === "Colorado") || cachedStateData[0];
      if (defaultRec) {
        geoEl.value = defaultRec.state_fips;
        renderCachedStateStats(defaultRec, cachedVintage, grid, vintageEl);
      }
    } else if (vintageEl) {
      vintageEl.textContent = "Loading Census data…";
    }

    /* ---- level change ---- */
    async function onLevelChange() {
      const lvl = levelEl.value;

      if (lvl === "national") {
        showEl("censusStateWrap", false);
        showEl("censusGeoWrap", false);
        if (nationalInfo) {
          renderStats("United States", nationalInfo.record, nationalInfo.vintage);
        } else {
          try {
            if (vintageEl) vintageEl.textContent = "Loading national data…";
            nationalInfo = await loadNational();
            renderStats("United States", nationalInfo.record, nationalInfo.vintage);
          } catch (e) {
            if (vintageEl) vintageEl.textContent = "National data unavailable";
          }
        }
        return;
      }

      if (lvl === "state") {
        showEl("censusStateWrap", false);
        showEl("censusGeoWrap", true);
        if (cachedStateData && cachedStateData.length) {
          // Use cached data — no API needed
          const cacheStates = cachedStateData
            .map(r => ({ value: r.state_fips, label: r.state_name }))
            .sort((a, b) => a.label.localeCompare(b.label));
          fillOptions(geoEl, cacheStates, "Select a state…");
          geoEl.value = "";
          geoEl.onchange = () => {
            const rec = cachedStateData.find(r => r.state_fips === geoEl.value);
            if (rec) renderCachedStateStats(rec, cachedVintage, grid, vintageEl);
          };
        } else if (statesInfo) {
          fillOptions(geoEl, statesInfo.states, "Select a state…");
          geoEl.value = "";
          geoEl.onchange = () => {
            const rec = statesInfo.rows.find(r => r.state === geoEl.value);
            if (rec) renderStats(rec.NAME, rec, statesInfo.vintage);
          };
        } else {
          // Neither cache nor API available yet; try API
          try {
            statesInfo = await loadStates();
            fillOptions(geoEl, statesInfo.states, "Select a state…");
            geoEl.value = "";
            geoEl.onchange = () => {
              const rec = statesInfo.rows.find(r => r.state === geoEl.value);
              if (rec) renderStats(rec.NAME, rec, statesInfo.vintage);
            };
          } catch (e) {
            if (vintageEl) vintageEl.textContent = "Unable to load state list";
          }
        }
        return;
      }

      /* county / place */
      showEl("censusStateWrap", true);
      showEl("censusGeoWrap", true);
      geoEl.innerHTML = `<option value="">Select a state first…</option>`;

      stateEl.onchange = async () => {
        const st = stateEl.value;
        if (!st) return;
        try {
          geoEl.disabled  = true;
          geoEl.innerHTML = `<option value="">Loading…</option>`;
          if (lvl === "county") {
            const { vintage, items } = await loadCounties(st);
            fillOptions(geoEl, items, "Select a county…");
            geoEl.disabled = false;
            geoEl.onchange = () => {
              const match = items.find(i => i.value === geoEl.value);
              if (match) renderStats(match.label, match.raw, vintage);
            };
          } else {
            const { vintage, items } = await loadPlaces(st);
            fillOptions(geoEl, items, "Select a place…");
            geoEl.disabled = false;
            geoEl.onchange = () => {
              const match = items.find(i => i.value === geoEl.value);
              if (match) renderStats(match.label, match.raw, vintage);
            };
          }
        } catch (e) {
          console.warn("[census-geo] geography load error:", e);
          geoEl.disabled  = false;
          geoEl.innerHTML = `<option value="">Unable to load</option>`;
        }
      };
    }

    levelEl.addEventListener("change", onLevelChange);
  }

  const start = () => init().catch(e => console.warn("[census-geo] fatal:", e));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
