/* Colorado: Households vs Priced-Affordable Units by %AMI
 * Data is fetched from a serverless endpoint (recommended) OR a cached JSON file:
 * - APP_CONFIG.AMI_GAP_API_URL (preferred)
 * - /data/co_ami_gap_by_county.json (fallback)
 *
 * Notes:
 * - "Units" are renter-occupied units by gross rent (ACS B25063) that are priced at or below the affordable rent threshold.
 * - These are not guaranteed vacant/available and do not incorporate concessions.
 */
(function () {
  const DEFAULT_BANDS = [30, 40, 50, 60, 70, 80, 100];

  function $(sel, root = document) { return root.querySelector(sel); }
  function fmt(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return Math.round(n).toLocaleString();
  }
  function fmtPct(x) {
    if (x === null || x === undefined || Number.isNaN(x)) return "—";
    return (x * 100).toFixed(1) + "%";
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
    return res.json();
  }

  function pickEndpoint() {
    const cfg = window.APP_CONFIG || {};
    return (cfg.AMI_GAP_API_URL && String(cfg.AMI_GAP_API_URL).trim()) || "data/co_ami_gap_by_county.json";
  }

  function renderMetadata(meta) {
    const el = $("#amiGapMeta");
    if (!el || !meta) return;
    const parts = [];
    if (meta.hud_income_limits_year) parts.push(`HUD Income Limits: ${meta.hud_income_limits_year}`);
    if (meta.acs_year) parts.push(`ACS: ${meta.acs_year} (5-year)`);
    if (meta.generated_at) parts.push(`Updated: ${meta.generated_at}`);
    el.textContent = parts.join(" • ");
  }

  function buildCountyOptions(counties) {
    const sel = $("#amiGapCountySelect");
    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "STATE";
    opt0.textContent = "Colorado (statewide)";
    sel.appendChild(opt0);

    counties
      .slice()
      .sort((a, b) => (a.county_name || "").localeCompare(b.county_name || ""))
      .forEach(c => {
        const o = document.createElement("option");
        o.value = c.fips;
        o.textContent = `${c.county_name}`;
        sel.appendChild(o);
      });
  }

  function getSeries(obj, bands) {
    return bands.map(b => (obj && obj[String(b)] != null ? obj[String(b)] : null));
  }

  function destroyChart(chartRef) {
    if (chartRef && typeof chartRef.destroy === "function") chartRef.destroy();
  }

  function renderCards(payload, item) {
    const bands = payload.bands || DEFAULT_BANDS;
    const last = String(bands[bands.length - 1]);

    const ami4 = item.ami_4person;
    $("#amiGapAmi4").textContent = ami4 ? `$${fmt(ami4)}` : "—";

    const hh = item.households_le_ami_pct?.[last];
    const un = item.units_priced_affordable_le_ami_pct?.[last];
    const cov = item.coverage_le_ami_pct?.[last];

    $("#amiGapHouseholds100").textContent = fmt(hh);
    $("#amiGapUnits100").textContent = fmt(un);
    $("#amiGapCoverage100").textContent = fmtPct(cov);
  }

  function renderTable(payload, item) {
    const bands = payload.bands || DEFAULT_BANDS;
    const tb = $("#amiGapTableBody");
    tb.innerHTML = "";

    bands.forEach(b => {
      const key = String(b);
      const hh = item.households_le_ami_pct?.[key];
      const un = item.units_priced_affordable_le_ami_pct?.[key];
      const gap = item.gap_units_minus_households_le_ami_pct?.[key];
      const cov = item.coverage_le_ami_pct?.[key];
      const rent = item.affordable_rent_monthly?.[key];

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>≤ ${b}%</td>
        <td>${rent != null ? "$" + fmt(rent) : "—"}</td>
        <td>${fmt(hh)}</td>
        <td>${fmt(un)}</td>
        <td>${gap == null ? "—" : (gap >= 0 ? "+" : "") + fmt(gap)}</td>
        <td>${fmtPct(cov)}</td>
      `;
      tb.appendChild(tr);
    });
  }

  function renderGapChart(payload, item, chartRefHolder) {
    const bands = payload.bands || DEFAULT_BANDS;
    const ctx = $("#amiGapChart");
    if (!ctx || !window.Chart) return;

    const gaps = getSeries(item.gap_units_minus_households_le_ami_pct, bands).map(v => (v == null ? 0 : v));
    destroyChart(chartRefHolder.current);

    chartRefHolder.current = new Chart(ctx, {
      type: "bar",
      data: {
        labels: bands.map(b => `≤${b}%`),
        datasets: [{
          label: "Gap (units - households)",
          data: gaps
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => {
                const v = c.parsed.y;
                const s = (v >= 0 ? "+" : "") + Math.round(v).toLocaleString();
                return ` ${s}`;
              }
            }
          }
        },
        scales: {
          y: { ticks: { callback: (v) => Number(v).toLocaleString() } }
        }
      }
    });
  }

  function renderMethodology(payload) {
    const el = $("#amiGapMethodology");
    if (!el || !payload.methodology) return;
    el.innerHTML = payload.methodology
      .map(p => `<p>${p}</p>`)
      .join("");
  }

  function pickItem(payload, fips) {
    if (fips === "STATE") return payload.statewide;
    return payload.counties.find(c => c.fips === fips) || payload.statewide;
  }

  async function init() {
    const root = $("#amiGapModule");
    if (!root) return;

    const endpoint = pickEndpoint();
    $("#amiGapEndpoint").textContent = endpoint;

    let payload;
    try {
      payload = await fetchJson(endpoint);
    } catch (e) {
      console.error(e);
      $("#amiGapError").textContent = `Could not load AMI gap data. Check endpoint or cached JSON. (${e.message})`;
      $("#amiGapError").style.display = "block";
      return;
    }

    renderMetadata(payload.meta);
    renderMethodology(payload);

    buildCountyOptions(payload.counties || []);
    const chartRefHolder = { current: null };

    function update() {
      const fips = $("#amiGapCountySelect").value;
      const item = pickItem(payload, fips);

      $("#amiGapGeoTitle").textContent = (fips === "STATE") ? "Colorado (statewide)" : item.county_name;
      renderCards(payload, item);
      renderTable(payload, item);
      renderGapChart(payload, item, chartRefHolder);
    }

    $("#amiGapCountySelect").addEventListener("change", update);
    update();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
