/* policy-simulator.js
 * LIHTC policy scenario simulator: 5 scenarios, bar + radar charts, CSV export
 */
(function () {
  /* ── Scenario definitions ─────────────────────────────────────── */
  const SCENARIOS = [
    {
      id: "baseline",
      label: "Current Baseline",
      color: "#64748b",
      units: 1800,
      cost_per_unit: 285000,
      roi: 5.2,
      households: 4200
    },
    {
      id: "basis_boost",
      label: "Basis Boost",
      color: "#3b82f6",
      units: 2450,
      cost_per_unit: 275000,
      roi: 6.8,
      households: 5720
    },
    {
      id: "per_capita",
      label: "Per-Capita Increase",
      color: "#22a36f",
      units: 2900,
      cost_per_unit: 282000,
      roi: 7.1,
      households: 6760
    },
    {
      id: "zoning_reform",
      label: "Zoning Reform",
      color: "#f59e0b",
      units: 3600,
      cost_per_unit: 258000,
      roi: 9.4,
      households: 8400
    },
    {
      id: "rural_focus",
      label: "Rural Focus",
      color: "#a855f7",
      units: 2100,
      cost_per_unit: 242000,
      roi: 8.1,
      households: 4900
    }
  ];

  const METRICS = [
    { key: "units",          label: "Units Produced",   fmt: v => v.toLocaleString() },
    { key: "cost_per_unit",  label: "Cost / Unit ($)",  fmt: v => "$" + v.toLocaleString() },
    { key: "roi",            label: "ROI (%)",           fmt: v => v.toFixed(1) + "%" },
    { key: "households",     label: "Households Served", fmt: v => v.toLocaleString() }
  ];

  /* ── CSV export ─────────────────────────────────────────────────── */
  function exportCSV() {
    const header = ["Scenario", ...METRICS.map(m => m.label)];
    const rows = SCENARIOS.map(s => [
      s.label, s.units, s.cost_per_unit, s.roi, s.households
    ]);
    const csv = [header, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "lihtc_policy_scenarios.csv";
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* ── Chart helpers ──────────────────────────────────────────────── */
  function cssVar(n, fb) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return v || fb;
  }

  let _barChart = null, _radarChart = null;

  function renderBarCharts(container) {
    if (!window.Chart) return;
    const textColor  = cssVar("--text",  "rgba(13,31,53,.85)");
    const mutedColor = cssVar("--muted", "rgba(71,96,128,.7)");
    const gridColor  = cssVar("--border","rgba(13,31,53,.08)");
    const labels = SCENARIOS.map(s => s.label);
    const colors = SCENARIOS.map(s => s.color);

    METRICS.forEach(m => {
      const canvas = container.querySelector(`#psBar_${m.key}`);
      if (!canvas) return;
      const data = SCENARIOS.map(s => s[m.key]);
      new Chart(canvas, {
        type: "bar",
        data: {
          labels,
          datasets: [{
            label: m.label,
            data,
            backgroundColor: colors.map(c => c + "bb"),
            borderColor: colors,
            borderWidth: 1.5,
            borderRadius: 5
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: c => " " + m.fmt(c.parsed.y) } }
          },
          scales: {
            x: { ticks: { color: mutedColor, font: { size: 10 }, maxRotation: 35 }, grid: { display: false } },
            y: { ticks: { color: mutedColor, font: { size: 10 }, callback: v => m.fmt(v) }, grid: { color: gridColor } }
          }
        }
      });
    });
  }

  function renderRadarChart(container) {
    if (!window.Chart) return;
    const textColor  = cssVar("--text",  "rgba(13,31,53,.85)");
    const mutedColor = cssVar("--muted", "rgba(71,96,128,.7)");
    const gridColor  = cssVar("--border","rgba(13,31,53,.18)");

    /* Normalize each metric to 0–100 relative to max across scenarios */
    const maxVals = {};
    METRICS.forEach(m => {
      maxVals[m.key] = Math.max(...SCENARIOS.map(s => s[m.key]));
    });
    /* For cost, lower = better → invert */
    const normalize = (key, val) => {
      if (key === "cost_per_unit") return (1 - val / maxVals[key]) * 100;
      return (val / maxVals[key]) * 100;
    };

    const radarLabels = METRICS.map(m =>
      m.key === "cost_per_unit" ? "Cost Efficiency" : m.label);

    const datasets = SCENARIOS.map(s => ({
      label: s.label,
      data: METRICS.map(m => +normalize(m.key, s[m.key]).toFixed(1)),
      borderColor: s.color,
      backgroundColor: s.color + "22",
      pointBackgroundColor: s.color,
      borderWidth: 1.8
    }));

    const canvas = container.querySelector("#psRadar");
    if (!canvas) return;
    new Chart(canvas, {
      type: "radar",
      data: { labels: radarLabels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: textColor, font: { size: 11 }, padding: 10 } } },
        scales: {
          r: {
            min: 0, max: 100,
            ticks: { color: mutedColor, font: { size: 9 }, stepSize: 25, display: false },
            grid: { color: gridColor },
            angleLines: { color: gridColor },
            pointLabels: { color: textColor, font: { size: 11 } }
          }
        }
      }
    });
  }

  /* ── Init ───────────────────────────────────────────────────────── */
  function init() {
    const root = document.getElementById("policy-simulator-section");
    if (!root) return;

    root.innerHTML = `
<div class="chart-card" style="margin-bottom:1.5rem;">
  <div class="chart-header" style="display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;justify-content:space-between;padding:1rem 1.25rem .5rem;">
    <div>
      <div class="chart-title">LIHTC Policy Scenario Simulator</div>
      <div class="chart-subtitle">Side-by-side comparison of 5 policy scenarios across key housing metrics</div>
    </div>
    <button id="psExportBtn"
      style="padding:.3rem .75rem;font-size:.8rem;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text);cursor:pointer;">
      ⬇ Export CSV
    </button>
  </div>

  <!-- Scenario legend pills -->
  <div style="display:flex;flex-wrap:wrap;gap:.5rem;padding:.5rem 1.25rem 1rem;">
    ${SCENARIOS.map(s => `
      <span style="display:inline-flex;align-items:center;gap:.4rem;padding:.25rem .65rem;
            border-radius:20px;font-size:.8rem;background:${s.color}22;border:1px solid ${s.color}55;color:var(--text);">
        <span style="width:8px;height:8px;border-radius:50%;background:${s.color};display:inline-block;"></span>
        ${s.label}
      </span>`).join("")}
  </div>

  <!-- Bar charts 2×2 grid -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;padding:0 1.25rem 1.25rem;">
    ${METRICS.map(m => `
      <div>
        <div style="font-size:.84rem;font-weight:600;color:var(--text);margin-bottom:.4rem;">${m.label}</div>
        <div style="height:200px;position:relative;">
          <canvas id="psBar_${m.key}" role="img" aria-label="Bar chart: ${m.label} by policy scenario"></canvas>
        </div>
      </div>`).join("")}
  </div>

  <!-- Radar chart -->
  <div style="padding:0 1.25rem 1.25rem;">
    <div style="font-size:.84rem;font-weight:600;color:var(--text);margin-bottom:.4rem;">
      Normalized Scenario Comparison (0–100 = relative to top performer)
    </div>
    <div style="height:300px;position:relative;max-width:480px;margin:0 auto;">
      <canvas id="psRadar" role="img" aria-label="Radar chart comparing policy scenarios across all metrics"></canvas>
    </div>
  </div>

  <!-- Summary table -->
  <div style="padding:0 1.25rem 1.25rem;overflow-x:auto;">
    <table style="width:100%;font-size:.83rem;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:2px solid var(--border);">
          <th style="text-align:left;padding:.35rem .5rem;">Scenario</th>
          ${METRICS.map(m => `<th style="text-align:right;padding:.35rem .5rem;">${m.label}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${SCENARIOS.map(s => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:.35rem .5rem;font-weight:${s.id==="baseline"?"400":"600"};">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;
                           background:${s.color};margin-right:.4rem;vertical-align:middle;"></span>
              ${s.label}
            </td>
            ${METRICS.map(m => `<td style="text-align:right;padding:.35rem .5rem;">${m.fmt(s[m.key])}</td>`).join("")}
          </tr>`).join("")}
      </tbody>
    </table>
  </div>
</div>
    `;

    /* Responsive bar grid */
    const barGrid = root.querySelector("[style*='grid-template-columns:1fr 1fr']");
    if (barGrid) {
      const mq = window.matchMedia("(max-width:640px)");
      const applyGrid = q => { barGrid.style.gridTemplateColumns = q.matches ? "1fr" : "1fr 1fr"; };
      applyGrid(mq);
      mq.addEventListener("change", applyGrid);
    }

    renderBarCharts(root);
    renderRadarChart(root);

    root.querySelector("#psExportBtn").addEventListener("click", exportCSV);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
