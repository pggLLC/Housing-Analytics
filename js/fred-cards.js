/**
 * FRED KPI cards for economic-dashboard.html
 * Reads from data/fred-data.json (pre-fetched cache) — no API key required.
 * Updates: #statCpi, #statUnemp, #stat10y, #statStarts
 */
(() => {
  const setText = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };

  function latestObs(series) {
    // series.observations is chronological; return last valid numeric value
    const obs = (series.observations || [])
      .filter(o => o.value !== "." && o.value != null)
      .map(o => ({ date: o.date, value: Number(o.value) }))
      .filter(o => isFinite(o.value));
    return obs.length ? obs[obs.length - 1] : null;
  }

  async function run() {
    let data;
    try {
      const res = await fetch("data/fred-data.json");
      if (!res.ok) throw new Error("Could not load data/fred-data.json");
      data = await res.json();
    } catch (e) {
      console.warn("[fred-cards] failed to load cache:", e);
      return; // leave values as-is; inline loadAll() will populate them
    }

    const s = data.series || {};

    // CPI YoY — computed from level series
    try {
      const obs = (s.CPIAUCSL.observations || [])
        .filter(o => o.value !== "." && o.value != null)
        .map(o => Number(o.value))
        .filter(isFinite);
      if (obs.length >= 13) {
        const yoy = (obs[obs.length - 1] / obs[obs.length - 13] - 1) * 100;
        setText("statCpi", yoy.toFixed(1) + "%");
      }
    } catch (e) { console.warn("[fred-cards] CPIAUCSL:", e); }

    // Unemployment rate
    try {
      const last = latestObs(s.UNRATE);
      if (last) setText("statUnemp", last.value.toFixed(1) + "%");
    } catch (e) { console.warn("[fred-cards] UNRATE:", e); }

    // 10-Year Treasury
    try {
      const last = latestObs(s.DGS10);
      if (last) setText("stat10y", last.value.toFixed(2) + "%");
    } catch (e) { console.warn("[fred-cards] DGS10:", e); }

    // Housing starts (SAAR) — series in thousands of units
    try {
      const last = latestObs(s.HOUST);
      if (last) {
        const units = Math.round(last.value) * 1000;
        setText("statStarts", units >= 1000 ? `${(units / 1000).toFixed(0)}k` : String(units));
      }
    } catch (e) { console.warn("[fred-cards] HOUST:", e); }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
