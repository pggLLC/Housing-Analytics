/**
 * Census snapshot (ACS Profile) with geography dropdowns for:
 *  - National (United States aggregate)
 *  - States
 *  - Counties (within a state)
 *  - Places (within a state)
 *
 * Also renders a Housing Construction Activity sub-section from fred-data.json.
 *
 * Uses window.APP_CONFIG.CENSUS_API_KEY (js/config.js)
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

    // If available in ACS profile: percent below poverty level (all people)
    { key: "DP03_0128PE", label: "Poverty rate",            fmt: formatPct      },

    // Derived (HUD cost burden definition: >=30% of income toward housing costs).
    // Uses ACS 5-year profile variables referenced by FRED Burdened Households release:
    // Renters: DP04_0141E (30.0–34.9%) + DP04_0142E (35.0%+) divided by DP04_0136E (total renters).
    { calc: (r) => {
        const totalRenters = Number(r.DP04_0136E);
        const rent30_34    = Number(r.DP04_0141E);
        const rent35p      = Number(r.DP04_0142E);
        if (!isFinite(totalRenters) || totalRenters <= 0) return NaN;
        if (!isFinite(rent30_34) || !isFinite(rent35p)) return NaN;
        return ((rent30_34 + rent35p) / totalRenters) * 100;
      },
      label: "Rent burdened (≥30%)",
      fmt: formatPct
    },
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
    const grid      = document.getElementById("census-stats");
    if (!grid) return;
    const vintageEl = document.querySelector("[data-census-vintage]");
    if (vintageEl) vintageEl.textContent = `ACS ${vintage} 5-year (profile) • ${name}`;

    grid.innerHTML = "";
    METRICS.forEach(m => {
      const val = (typeof m.calc === "function") ? m.calc(record) : Number(record[m.key]);
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
    if (!KEY) console.warn("[census-geo] Missing CENSUS_API_KEY — requests may be rate-limited.");

    showEl("censusStateWrap", false);
    showEl("censusGeoWrap", false);

    /* Always render the construction section from FRED cache */
    renderConstructionSection().catch(e => console.warn("[census-geo] construction section:", e));

    /* Load national + state list in parallel */
    let statesInfo   = null;
    let nationalInfo = null;

    try {
      const [natResult, stResult] = await Promise.allSettled([loadNational(), loadStates()]);

      if (natResult.status === "fulfilled") nationalInfo = natResult.value;
      else console.warn("[census-geo] National fetch:", natResult.reason);

      if (stResult.status === "fulfilled") {
        statesInfo = stResult.value;
        fillOptions(stateEl, statesInfo.states, "Select a state…");
      } else {
        console.warn("[census-geo] States fetch:", stResult.reason);
      }

      /* Default: national */
      if (nationalInfo) {
        levelEl.value = "national";
        renderStats("United States", nationalInfo.record, nationalInfo.vintage);
      } else if (statesInfo) {
        levelEl.value = "state";
        showEl("censusGeoWrap", true);
        const co = statesInfo.states.find(s => s.label === "Colorado") || statesInfo.states[0];
        if (co) {
          fillOptions(geoEl, statesInfo.states, "Select a state…");
          geoEl.value = co.value;
          const rec = statesInfo.rows.find(r => r.state === co.value);
          if (rec) renderStats(rec.NAME, rec, statesInfo.vintage);
        }
      }

    } catch (e) {
      console.warn("[census-geo] init error:", e);
      if (vintageEl) vintageEl.textContent = "Unable to load Census data";
      return;
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
        if (!statesInfo) {
          try {
            statesInfo = await loadStates();
            fillOptions(stateEl, statesInfo.states, "Select a state…");
          } catch (e) {
            if (vintageEl) vintageEl.textContent = "Unable to load state list";
            return;
          }
        }
        fillOptions(geoEl, statesInfo.states, "Select a state…");
        geoEl.value = "";
        geoEl.onchange = () => {
          const rec = statesInfo.rows.find(r => r.state === geoEl.value);
          if (rec) renderStats(rec.NAME, rec, statesInfo.vintage);
        };
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
