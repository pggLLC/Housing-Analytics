/**
 * Live FRED KPI cards for economic-dashboard.html
 * Updates:
 *  - #statCpi    CPIAUCSL YoY (%)
 *  - #statUnemp  UNRATE (%)
 *  - #stat10y    DGS10 (%)
 *  - #statStarts HOUST (SAAR, thousands of units -> units)
 *
 * Uses window.APP_CONFIG.FRED_API_KEY from js/config.js
 */
(() => {
  const KEY = (window.APP_CONFIG && window.APP_CONFIG.FRED_API_KEY) ? window.APP_CONFIG.FRED_API_KEY : "";
  const el = (id) => document.getElementById(id);

  const SERIES = [
    { id:"CPIAUCSL", el:"statCpi", units:"pc1", fmt:(v)=> `${v.toFixed(1)}%` },
    { id:"UNRATE",  el:"statUnemp", units:"lin", fmt:(v)=> `${v.toFixed(1)}%` },
    { id:"DGS10",   el:"stat10y", units:"lin", fmt:(v)=> `${v.toFixed(2)}%` },
    { id:"HOUST",   el:"statStarts", units:"lin", fmt:(v)=> {
        const units = v * 1000; // HOUST is thousands
        if (!isFinite(units)) return "—";
        if (units >= 1_000_000) return `${(units/1_000_000).toFixed(2)}M`;
        if (units >= 1_000) return `${(units/1_000).toFixed(0)}k`;
        return `${Math.round(units)}`;
      }
    },
  ];

  const set = (id, txt) => { const n = el(id); if (n) n.textContent = txt; };

  function buildUrl(seriesId, units){
    const base = "https://api.stlouisfed.org/fred/series/observations";
    const params = new URLSearchParams({
      series_id: seriesId,
      api_key: KEY,
      file_type: "json",
      sort_order: "desc",
      limit: "1"
    });
    if (units && units !== "lin") params.set("units", units);
    return `${base}?${params.toString()}`;
  }

  async function latest(seriesId, units){
    if (!KEY) throw new Error("Missing FRED_API_KEY (js/config.js)");
    const res = await fetch(buildUrl(seriesId, units));
    if (!res.ok) throw new Error(`FRED ${seriesId} failed: ${res.status}`);
    const data = await res.json();
    const obs = data && data.observations && data.observations[0];
    if (!obs) throw new Error(`No obs for ${seriesId}`);
    const raw = obs.value;
    const val = (raw === "." || raw == null) ? NaN : Number(raw);
    return val;
  }

  async function run(){
    SERIES.forEach(s => set(s.el, "Loading…"));
    try{
      await Promise.all(SERIES.map(async (s) => {
        const v = await latest(s.id, s.units);
        set(s.el, isFinite(v) ? s.fmt(v) : "—");
      }));
    } catch(err){
      console.warn("[fred-kpi-cards] ", err);
      SERIES.forEach(s => set(s.el, "—"));
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
