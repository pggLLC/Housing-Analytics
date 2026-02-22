/**
 * census-stats.js
 * Pulls a few national ACS (DP) stats from the Census API and renders them as cards.
 * Uses APP_CONFIG.CENSUS_API_KEY from js/config.js.
 */
(function () {
  const API_KEY = (window.APP_CONFIG && window.APP_CONFIG.CENSUS_API_KEY) ? window.APP_CONFIG.CENSUS_API_KEY : null;

  // ACS 5-year Data Profile (latest available in Census API; we try a few recent vintages).
  const VINTAGES = [2023, 2022, 2021, 2020];

  const SERIES = [
    { id: "DP05_0001E", label: "U.S. Population", fmt: "int" },
    { id: "DP03_0062E", label: "Median Household Income", fmt: "usd" },
    { id: "DP04_0134E", label: "Median Gross Rent", fmt: "usd" },
    { id: "DP04_0089E", label: "Median Home Value", fmt: "usd" }
  ];

  function fmt(val, type) {
    const n = Number(val);
    if (!isFinite(n)) return "—";
    if (type === "usd") return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    if (type === "int") return Math.round(n).toLocaleString();
    return n.toLocaleString();
  }

  async function fetchVintage(v) {
    const vars = SERIES.map(s => s.id).join(",");
    // National level: for=us:1
    const url = `https://api.census.gov/data/${v}/acs/acs5/profile?get=NAME,${vars}&for=us:1${API_KEY ? `&key=${encodeURIComponent(API_KEY)}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Census ${v} failed`);
    const data = await res.json();
    const headers = data[0];
    const row = data[1];
    const out = {};
    headers.forEach((h, i) => { out[h] = row[i]; });
    return { vintage: v, values: out };
  }

  function render(container, payload) {
    const { vintage, values } = payload;
    container.querySelector('[data-census-vintage]').textContent = `ACS ${vintage} (5-year) · Census API`;

    const grid = container.querySelector('.census-grid');
    grid.innerHTML = SERIES.map(s => {
      const v = values[s.id];
      return `
        <div class="card" style="padding:14px" data-contrast-surface>
          <div style="font-size:.78rem;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.08em">${s.label}</div>
          <div style="font-size:1.6rem;font-weight:900;margin-top:6px">${fmt(v, s.fmt)}</div>
        </div>
      `;
    }).join("");
  }

  async function init() {
    const container = document.getElementById('census-stats');
    if (!container) return;

    container.classList.add('card');
    container.setAttribute('data-contrast-surface', 'true');

    for (const v of VINTAGES) {
      try {
        const payload = await fetchVintage(v);
        render(container, payload);
        return;
      } catch (e) { /* try next */ }
    }

    // fallback message
    container.querySelector('.census-grid').innerHTML = `
      <div class="card" style="padding:14px" data-contrast-surface>
        <div style="font-weight:800">Census stats unavailable</div>
        <div style="color:var(--muted);margin-top:6px">Check your CENSUS_API_KEY in <code>js/config.js</code> and try again.</div>
      </div>
    `;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
