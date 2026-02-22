/* housing-predictions.js
 * Housing Predictive Modeling dashboard — illustrative mock data, clearly labeled.
 * Covers: home price movements, mortgage rates, housing starts, vacancy.
 * Colorado-specific forecasts, market vs expert consensus, historical accuracy.
 *
 * ⚠ DISCLAIMER: All forecast values are illustrative mock data for demonstration
 *   purposes only and do not represent actual market forecasts or investment advice.
 */
(function () {
  /* ── Mock forecast data ─────────────────────────────────────────── */
  const QUARTERS = ["Q3 2025","Q4 2025","Q1 2026","Q2 2026","Q3 2026","Q4 2026"];

  const FORECASTS = {
    home_price: {
      label: "Median Home Price — Colorado ($k)",
      unit: "$k",
      market:  [615, 618, 622, 630, 638, 642],
      expert:  [612, 620, 628, 634, 640, 645],
      actual:  [613, null, null, null, null, null]
    },
    mortgage_rate: {
      label: "30-Year Fixed Mortgage Rate (%)",
      unit: "%",
      market:  [6.85, 6.70, 6.55, 6.40, 6.30, 6.20],
      expert:  [6.90, 6.75, 6.60, 6.45, 6.35, 6.25],
      actual:  [6.88, null, null, null, null, null]
    },
    housing_starts: {
      label: "Housing Starts — Colorado (annualized, k units)",
      unit: "k units",
      market:  [42.1, 43.5, 44.8, 46.2, 47.0, 47.8],
      expert:  [41.8, 43.2, 44.5, 45.9, 46.7, 47.5],
      actual:  [42.3, null, null, null, null, null]
    },
    vacancy: {
      label: "Rental Vacancy Rate — Colorado (%)",
      unit: "%",
      market:  [5.0, 5.1, 5.2, 5.0, 4.9, 4.8],
      expert:  [4.9, 5.0, 5.1, 4.9, 4.8, 4.7],
      actual:  [5.0, null, null, null, null, null]
    }
  };

  const METRIC_KEYS = Object.keys(FORECASTS);

  /* Historical accuracy data */
  const ACCURACY = [
    { period: "Q1 2024", metric: "Home Price", market_err: 1.8, expert_err: 1.4, winner: "expert" },
    { period: "Q2 2024", metric: "Home Price", market_err: 2.1, expert_err: 1.9, winner: "expert" },
    { period: "Q3 2024", metric: "Home Price", market_err: 1.5, expert_err: 1.8, winner: "market" },
    { period: "Q4 2024", metric: "Home Price", market_err: 1.3, expert_err: 1.6, winner: "market" },
    { period: "Q1 2024", metric: "Mortgage Rate", market_err: 0.12, expert_err: 0.10, winner: "expert" },
    { period: "Q2 2024", metric: "Mortgage Rate", market_err: 0.15, expert_err: 0.18, winner: "market" },
    { period: "Q3 2024", metric: "Mortgage Rate", market_err: 0.09, expert_err: 0.11, winner: "market" },
    { period: "Q4 2024", metric: "Mortgage Rate", market_err: 0.11, expert_err: 0.08, winner: "expert" }
  ];

  /* ── CSV export ─────────────────────────────────────────────────── */
  function exportCSV(key) {
    const f = FORECASTS[key];
    const rows = [["Quarter","Market Forecast","Expert Consensus","Actual"]];
    QUARTERS.forEach((q, i) => rows.push([q, f.market[i], f.expert[i], f.actual[i] ?? ""]));
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `housing_forecast_${key}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* ── Chart helpers ──────────────────────────────────────────────── */
  function cssVar(n, fb) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return v || fb;
  }

  const _charts = {};

  function renderForecastChart(container, key) {
    if (!window.Chart) return;
    const f = FORECASTS[key];
    const canvas = container.querySelector(`#predChart_${key}`);
    if (!canvas) return;
    if (_charts[key]) { _charts[key].destroy(); delete _charts[key]; }

    const textColor  = cssVar("--text",  "rgba(13,31,53,.85)");
    const mutedColor = cssVar("--muted", "rgba(71,96,128,.7)");
    const gridColor  = cssVar("--border","rgba(13,31,53,.08)");

    _charts[key] = new Chart(canvas, {
      type: "line",
      data: {
        labels: QUARTERS,
        datasets: [
          {
            label: "Market Consensus",
            data: f.market,
            borderColor: "#3b82f6",
            backgroundColor: "#3b82f622",
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 4
          },
          {
            label: "Expert Forecast",
            data: f.expert,
            borderColor: "#22a36f",
            backgroundColor: "#22a36f22",
            borderWidth: 2,
            borderDash: [5, 3],
            tension: 0.3,
            pointRadius: 4
          },
          {
            label: "Actual",
            data: f.actual,
            borderColor: "#f59e0b",
            backgroundColor: "#f59e0b22",
            borderWidth: 2.5,
            pointRadius: 6,
            pointStyle: "rectRot"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: textColor, font: { size: 11 }, padding: 12 } },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y ?? "—"} ${f.unit}` } }
        },
        scales: {
          x: { ticks: { color: mutedColor, font: { size: 11 } }, grid: { color: gridColor } },
          y: { ticks: { color: mutedColor, font: { size: 11 }, callback: v => v + " " + f.unit }, grid: { color: gridColor } }
        }
      }
    });
  }

  /* ── Init ───────────────────────────────────────────────────────── */
  function init() {
    const root = document.getElementById("housing-predictions-section");
    if (!root) return;

    root.innerHTML = `
<div style="margin-bottom:1.5rem;">

  <!-- Disclaimer banner -->
  <div role="note" aria-label="Data disclaimer"
       style="background:var(--warn-dim,rgba(217,119,6,.10));border:1px solid var(--warn,#d97706);
              border-radius:8px;padding:.65rem 1rem;margin-bottom:1.25rem;font-size:.82rem;color:var(--text);">
    <strong>⚠ Illustrative Mock Data Only.</strong> All forecast values on this page are
    synthetic demonstration data and do not constitute financial or investment advice.
    Past model accuracy shown for methodology illustration purposes only.
  </div>

  <div class="chart-card" style="margin-bottom:1.5rem;">
    <div class="chart-header" style="padding:1rem 1.25rem .5rem;">
      <div class="chart-title">Housing Predictive Modeling — Colorado</div>
      <div class="chart-subtitle">Market consensus vs expert forecasts, Q3 2025–Q4 2026</div>
    </div>

    <!-- Forecast chart grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;padding:1rem 1.25rem 1.25rem;" id="predGrid">
      ${METRIC_KEYS.map(key => `
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem;">
            <div style="font-size:.84rem;font-weight:600;color:var(--text);">${FORECASTS[key].label}</div>
            <button class="pred-export-btn" data-key="${key}"
              style="padding:.2rem .55rem;font-size:.75rem;border-radius:5px;border:1px solid var(--border);
                     background:var(--bg2);color:var(--muted);cursor:pointer;">⬇</button>
          </div>
          <div style="height:200px;position:relative;">
            <canvas id="predChart_${key}" role="img" aria-label="Forecast chart: ${FORECASTS[key].label}"></canvas>
          </div>
        </div>`).join("")}
    </div>
  </div>

  <!-- Historical accuracy table -->
  <div class="chart-card" style="margin-bottom:1.5rem;">
    <div class="chart-header" style="padding:1rem 1.25rem .5rem;">
      <div class="chart-title">Historical Forecast Accuracy</div>
      <div class="chart-subtitle">Mean absolute error (MAE) by quarter — market vs expert</div>
    </div>
    <div style="padding:.5rem 1.25rem 1.25rem;overflow-x:auto;">
      <table style="width:100%;font-size:.83rem;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);">
            <th style="text-align:left;padding:.35rem .5rem;">Period</th>
            <th style="text-align:left;padding:.35rem .5rem;">Metric</th>
            <th style="text-align:right;padding:.35rem .5rem;">Market MAE</th>
            <th style="text-align:right;padding:.35rem .5rem;">Expert MAE</th>
            <th style="text-align:center;padding:.35rem .5rem;">Winner</th>
          </tr>
        </thead>
        <tbody>
          ${ACCURACY.map(row => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:.35rem .5rem;">${row.period}</td>
              <td style="padding:.35rem .5rem;">${row.metric}</td>
              <td style="text-align:right;padding:.35rem .5rem;${row.winner==="market"?"font-weight:600;color:var(--good);":""}">${row.market_err}</td>
              <td style="text-align:right;padding:.35rem .5rem;${row.winner==="expert"?"font-weight:600;color:var(--good);":""}">${row.expert_err}</td>
              <td style="text-align:center;padding:.35rem .5rem;">${row.winner==="market"?"🏅 Market":"🏅 Expert"}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Methodology -->
  <div class="chart-card">
    <details style="padding:1rem 1.25rem;">
      <summary style="font-size:.92rem;font-weight:600;color:var(--text);cursor:pointer;list-style:none;display:flex;align-items:center;gap:.5rem;">
        <span style="font-size:1.1rem;">ℹ</span> Methodology &amp; Disclaimer
      </summary>
      <div style="margin-top:.75rem;font-size:.83rem;color:var(--muted);line-height:1.65;">
        <p><strong>Market Consensus</strong> represents aggregated predictions from prediction market platforms
          (e.g., Kalshi, Polymarket) where available, normalized to reflect housing-specific outcomes.
          Values are synthetic proxies for demonstration purposes.</p>
        <p><strong>Expert Forecast</strong> reflects a consensus of institutional forecasters including
          Fannie Mae, Freddie Mac, NAR, and Zillow Research estimates. All values shown are illustrative.</p>
        <p><strong>Historical Accuracy (MAE)</strong> measures mean absolute error between forecast and
          realized values over the preceding four quarters. Lower is better.</p>
        <p><strong>Colorado-specific data</strong> is derived from Colorado Division of Housing,
          Colorado Association of Realtors, and DOLA estimates, adjusted to statewide aggregates.</p>
        <p style="color:var(--bad,#dc2626);font-weight:600;">
          ⚠ All data on this page is illustrative mock data for UI demonstration only.
          Do not use for investment, lending, or policy decisions.
        </p>
      </div>
    </details>
  </div>

</div>
    `;

    /* Responsive grid */
    const grid = root.querySelector("#predGrid");
    if (grid) {
      const mq = window.matchMedia("(max-width:640px)");
      const applyGrid = q => { grid.style.gridTemplateColumns = q.matches ? "1fr" : "1fr 1fr"; };
      applyGrid(mq);
      mq.addEventListener("change", applyGrid);
    }

    /* Render charts */
    METRIC_KEYS.forEach(key => renderForecastChart(root, key));

    /* Export buttons */
    root.querySelectorAll(".pred-export-btn").forEach(btn => {
      btn.addEventListener("click", () => exportCSV(btn.dataset.key));
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
