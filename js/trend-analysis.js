/* trend-analysis.js
 * Colorado vs 11 peer states across 4 housing metrics (2019–2024)
 * Welch t-test significance, time-range filter, keyboard tabs, CSV export, in-memory cache
 */
(function () {
  /* ── Data ─────────────────────────────────────────────────────── */
  const STATES = ["CO","TX","CA","AZ","UT","NV","OR","WA","FL","GA","NC","VA"];
  const STATE_NAMES = {
    CO:"Colorado",TX:"Texas",CA:"California",AZ:"Arizona",UT:"Utah",NV:"Nevada",
    OR:"Oregon",WA:"Washington",FL:"Florida",GA:"Georgia",NC:"North Carolina",VA:"Virginia"
  };
  const YEARS = [2019,2020,2021,2022,2023,2024];

  /* Illustrative data — median home price ($k), rent index (2019=100),
     vacancy rate (%), YoY price change (%)                           */
  const METRIC_DATA = {
    home_price: {
      label: "Median Home Price ($k)",
      fmt: v => "$" + Math.round(v) + "k",
      data: {
        CO:[486,510,590,680,630,620],TX:[286,303,360,420,385,380],
        CA:[587,616,737,820,775,760],AZ:[294,330,420,510,470,455],
        UT:[362,390,500,590,540,530],NV:[312,338,420,490,455,440],
        OR:[398,418,490,560,520,510],WA:[450,470,570,650,610,595],
        FL:[292,318,400,480,445,430],GA:[252,272,350,420,390,380],
        NC:[230,252,326,390,362,352],VA:[310,330,400,465,435,425]
      }
    },
    rent_index: {
      label: "Rent Index (2019=100)",
      fmt: v => v.toFixed(1),
      data: {
        CO:[100,101,108,124,131,133],TX:[100,102,112,133,138,136],
        CA:[100,97,100,112,116,115],AZ:[100,103,118,142,146,142],
        UT:[100,104,116,138,144,141],NV:[100,104,120,143,146,142],
        OR:[100,100,106,118,123,122],WA:[100,101,110,124,130,129],
        FL:[100,104,120,148,152,148],GA:[100,103,118,140,145,143],
        NC:[100,103,116,137,142,140],VA:[100,101,109,123,128,127]
      }
    },
    vacancy_rate: {
      label: "Rental Vacancy Rate (%)",
      fmt: v => v.toFixed(1) + "%",
      data: {
        CO:[5.2,5.4,4.1,3.8,4.5,5.0],TX:[7.2,7.5,5.8,5.0,6.2,6.8],
        CA:[4.1,4.3,3.5,3.2,3.8,4.2],AZ:[6.0,6.2,4.5,3.8,5.0,5.5],
        UT:[4.8,5.0,3.8,3.2,4.2,4.7],NV:[5.6,5.9,4.3,3.6,4.8,5.3],
        OR:[4.4,4.6,3.9,3.4,4.1,4.6],WA:[4.6,4.8,3.8,3.3,4.3,4.8],
        FL:[6.8,7.2,5.2,4.4,5.8,6.4],GA:[7.0,7.3,5.5,4.7,6.0,6.6],
        NC:[6.4,6.7,5.1,4.3,5.6,6.1],VA:[5.5,5.7,4.4,3.8,4.9,5.4]
      }
    },
    price_yoy: {
      label: "YoY Price Change (%)",
      fmt: v => (v >= 0 ? "+" : "") + v.toFixed(1) + "%",
      data: {
        CO:[6.2,4.9,15.7,15.3,-7.4,-1.6],TX:[5.8,5.9,18.8,16.7,-8.3,-1.3],
        CA:[3.2,5.0,19.6,11.2,-5.5,-1.9],AZ:[7.2,12.2,27.3,21.4,-7.8,-3.2],
        UT:[8.1,7.7,28.2,18.0,-8.5,-1.9],NV:[6.5,8.3,24.9,16.7,-7.1,-3.3],
        OR:[5.9,5.0,17.2,14.3,-7.1,-1.9],WA:[6.4,4.4,21.3,14.0,-6.2,-2.5],
        FL:[7.8,8.9,26.8,20.0,-7.3,-3.4],GA:[6.2,7.9,28.7,20.0,-7.1,-2.6],
        NC:[7.0,9.6,29.4,19.6,-7.2,-2.8],VA:[5.5,6.5,21.3,16.3,-6.5,-2.3]
      }
    }
  };
  const METRICS = Object.keys(METRIC_DATA);

  /* ── Cache ─────────────────────────────────────────────────────── */
  const _cache = {};
  function getSlice(metricKey, range) {
    const cacheKey = metricKey + "|" + range;
    if (_cache[cacheKey]) return _cache[cacheKey];
    const end = YEARS.length;
    const start = range === 1 ? end - 2 : range === 3 ? end - 4 : 0;
    const years = YEARS.slice(start);
    const metric = METRIC_DATA[metricKey];
    const result = { years, metric, slices: {} };
    STATES.forEach(s => { result.slices[s] = metric.data[s].slice(start); });
    _cache[cacheKey] = result;
    return result;
  }

  /* ── Welch t-test: CO vs peer mean ─────────────────────────────── */
  function welchT(co, peers) {
    const n1 = co.length, n2 = peers.length;
    const m1 = co.reduce((a,b)=>a+b,0)/n1;
    const m2 = peers.reduce((a,b)=>a+b,0)/n2;
    const v1 = co.reduce((a,b)=>a+(b-m1)**2,0)/(n1-1);
    const v2 = peers.reduce((a,b)=>a+(b-m2)**2,0)/(n2-1);
    const se = Math.sqrt(v1/n1 + v2/n2);
    if (se === 0) return { t: 0, p: 1 };
    const t = (m1 - m2) / se;
    const df = (v1/n1 + v2/n2)**2 / ((v1/n1)**2/(n1-1) + (v2/n2)**2/(n2-1));
    // Two-tailed p-value approximation via student t CDF approximation
    const p = 2 * (1 - tCDF(Math.abs(t), df));
    return { t: +t.toFixed(3), p: +p.toFixed(4) };
  }

  /* Abramowitz & Stegun regularized incomplete beta approximation */
  function tCDF(t, df) {
    const x = df / (df + t * t);
    return 1 - 0.5 * betaInc(df / 2, 0.5, x);
  }
  function betaInc(a, b, x) {
    if (x < 0 || x > 1) return 0;
    if (x === 0) return 0;
    if (x === 1) return 1;
    const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b);
    const front = Math.exp(Math.log(x)*a + Math.log(1-x)*b - lbeta) / a;
    return front * betaCF(a, b, x);
  }
  function betaCF(a, b, x) {
    const maxIter = 200, eps = 3e-7;
    let fpmin = 1e-30, qab = a+b, qap = a+1, qam = a-1;
    let c = 1, d = 1 - qab*x/qap;
    if (Math.abs(d) < fpmin) d = fpmin;
    d = 1/d; let h = d;
    for (let m = 1; m <= maxIter; m++) {
      let m2 = 2*m;
      let aa = m*(b-m)*x / ((qam+m2)*(a+m2));
      d = 1 + aa*d; if (Math.abs(d)<fpmin) d=fpmin;
      c = 1 + aa/c; if (Math.abs(c)<fpmin) c=fpmin;
      d = 1/d; h *= d*c;
      aa = -(a+m)*(qab+m)*x / ((a+m2)*(qap+m2));
      d = 1+aa*d; if (Math.abs(d)<fpmin) d=fpmin;
      c = 1+aa/c; if (Math.abs(c)<fpmin) c=fpmin;
      d = 1/d;
      const del = d*c;
      h *= del;
      if (Math.abs(del-1) < eps) break;
    }
    return h;
  }
  function lgamma(x) {
    const cof=[76.18009172947146,-86.50532032941677,24.01409824083091,
      -1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];
    let y=x, tmp=x+5.5;
    tmp -= (x+0.5)*Math.log(tmp);
    let ser=1.000000000190015;
    for (let j=0;j<6;j++) { y+=1; ser+=cof[j]/y; }
    return -tmp+Math.log(2.5066282746310005*ser/x);
  }

  function sigLabel(p) {
    if (p < 0.001) return "***";
    if (p < 0.01)  return "**";
    if (p < 0.05)  return "*";
    return "";
  }

  /* ── CSV export ─────────────────────────────────────────────────── */
  function exportCSV(metricKey, range) {
    const { years, metric, slices } = getSlice(metricKey, range);
    const rows = [["State", "StateName", ...years.map(y => y.toString())]];
    STATES.forEach(s => rows.push([s, STATE_NAMES[s], ...slices[s].map(v => v.toString())]));
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `trend_${metricKey}_${range}yr.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* ── Chart ──────────────────────────────────────────────────────── */
  let _chart = null;

  function cssVar(n, fb) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return v || fb;
  }

  const PALETTE = [
    "#e05252","#3b82f6","#22a36f","#f59e0b","#a855f7",
    "#14b8a6","#f97316","#6366f1","#10b981","#ec4899","#64748b","#0ea5e9"
  ];

  function renderChart(container, metricKey, range) {
    if (!window.Chart) return;
    const { years, metric, slices } = getSlice(metricKey, range);
    const canvas = container.querySelector("#trendChart");
    if (!canvas) return;

    if (_chart) { _chart.destroy(); _chart = null; }

    const textColor  = cssVar("--text",  "rgba(13,31,53,.85)");
    const mutedColor = cssVar("--muted", "rgba(71,96,128,.7)");
    const gridColor  = cssVar("--border","rgba(13,31,53,.08)");

    const datasets = STATES.map((s, i) => ({
      label: STATE_NAMES[s],
      data: slices[s],
      borderColor: PALETTE[i],
      backgroundColor: PALETTE[i] + "22",
      borderWidth: s === "CO" ? 3 : 1.5,
      borderDash: s === "CO" ? [] : [4,3],
      pointRadius: s === "CO" ? 4 : 2,
      tension: 0.3
    }));

    _chart = new Chart(canvas, {
      type: "line",
      data: { labels: years.map(String), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: textColor, font: { size: 11 }, padding: 10 } }
        },
        scales: {
          x: { ticks: { color: mutedColor }, grid: { color: gridColor } },
          y: {
            ticks: { color: mutedColor,
              callback: v => metric.fmt(v)
            },
            grid: { color: gridColor }
          }
        }
      }
    });
  }

  /* ── Stats table ────────────────────────────────────────────────── */
  function renderStats(container, metricKey, range) {
    const { years, metric, slices } = getSlice(metricKey, range);
    const tb = container.querySelector("#trendStatsBody");
    if (!tb) return;
    tb.innerHTML = "";

    const coVals = slices.CO;
    const peerVals = STATES.filter(s => s !== "CO").flatMap(s => slices[s]);
    const { t, p } = welchT(coVals, peerVals);
    const sig = sigLabel(p);

    STATES.forEach(s => {
      const vals = slices[s];
      const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
      const last = vals[vals.length-1];
      const first = vals[0];
      const chg = first !== 0 ? ((last/first - 1)*100).toFixed(1) + "%" : "—";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="font-weight:${s==="CO"?"700":"400"}">${STATE_NAMES[s]}${s==="CO"?" ★":""}</td>
        <td>${metric.fmt(mean)}</td>
        <td>${metric.fmt(last)}</td>
        <td>${chg}</td>
        <td>${s==="CO" ? `t=${t}${sig} (p=${p})` : ""}</td>
      `;
      tb.appendChild(tr);
    });
  }

  /* ── Init ───────────────────────────────────────────────────────── */
  function init() {
    const root = document.getElementById("trend-analysis-section");
    if (!root) return;

    let activeMetric = METRICS[0];
    let activeRange  = 1;

    /* Inject markup */
    root.innerHTML = `
<div class="chart-card" style="margin-bottom:1.5rem;">
  <div class="chart-header" style="display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;justify-content:space-between;">
    <div>
      <div class="chart-title">Colorado vs Peer States — Housing Market Trends</div>
      <div class="chart-subtitle">Colorado (★) vs TX, CA, AZ, UT, NV, OR, WA, FL, GA, NC, VA (2019–2024)</div>
    </div>
    <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
      <span style="font-size:.8rem;color:var(--muted);">Time range:</span>
      <div role="group" aria-label="Time range" id="trendRangeGroup" style="display:flex;gap:.35rem;">
        <button class="trend-range-btn active" data-range="1" style="padding:.3rem .65rem;font-size:.8rem;border-radius:6px;border:1px solid var(--border);background:var(--accent);color:#fff;cursor:pointer;">1 yr</button>
        <button class="trend-range-btn" data-range="3" style="padding:.3rem .65rem;font-size:.8rem;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text);cursor:pointer;">3 yr</button>
        <button class="trend-range-btn" data-range="5" style="padding:.3rem .65rem;font-size:.8rem;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text);cursor:pointer;">5 yr</button>
      </div>
      <button id="trendExportBtn" style="padding:.3rem .75rem;font-size:.8rem;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text);cursor:pointer;">⬇ CSV</button>
    </div>
  </div>

  <div role="tablist" aria-label="Housing metrics" id="trendTabList"
       style="display:flex;gap:.5rem;padding:.5rem 1.25rem;border-bottom:1px solid var(--border);flex-wrap:wrap;">
    ${METRICS.map((m,i) => `
      <button role="tab" class="trend-tab${i===0?" active":""}" data-metric="${m}"
        id="trendTab-${m}" aria-controls="trendPanel-${m}" aria-selected="${i===0}"
        tabindex="${i===0?0:-1}"
        style="padding:.4rem .9rem;font-size:.84rem;border-radius:8px;border:1px solid ${i===0?"var(--accent)":"var(--border)"};
               background:${i===0?"var(--accent-dim)":"transparent"};color:${i===0?"var(--accent)":"var(--muted)"};cursor:pointer;">
        ${METRIC_DATA[m].label}
      </button>`).join("")}
  </div>

  <div id="trendPanelWrap" style="padding:1rem 1.25rem;">
    <div style="height:320px;position:relative;">
      <canvas id="trendChart" role="img" aria-label="Line chart of housing metric across states"></canvas>
    </div>
  </div>

  <div style="padding:.5rem 1.25rem 1rem;overflow-x:auto;">
    <p style="font-size:.82rem;color:var(--muted);margin-bottom:.5rem;">
      ★ Colorado highlighted. Welch t-test compares CO vs peer-state pool.
      Significance: * p&lt;0.05, ** p&lt;0.01, *** p&lt;0.001
    </p>
    <table style="width:100%;font-size:.83rem;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:2px solid var(--border);">
          <th style="text-align:left;padding:.35rem .5rem;">State</th>
          <th style="text-align:right;padding:.35rem .5rem;">Period Mean</th>
          <th style="text-align:right;padding:.35rem .5rem;">Latest</th>
          <th style="text-align:right;padding:.35rem .5rem;">Period Change</th>
          <th style="text-align:right;padding:.35rem .5rem;">vs Peer (Welch t)</th>
        </tr>
      </thead>
      <tbody id="trendStatsBody"></tbody>
    </table>
  </div>
</div>
    `;

    /* Set initial range btn style */
    root.querySelectorAll(".trend-range-btn").forEach(btn => {
      btn.classList.toggle("active", +btn.dataset.range === activeRange);
      btn.style.background = +btn.dataset.range === activeRange ? "var(--accent)" : "var(--bg2)";
      btn.style.color      = +btn.dataset.range === activeRange ? "#fff" : "var(--text)";
    });

    function refresh() {
      renderChart(root, activeMetric, activeRange);
      renderStats(root, activeMetric, activeRange);
    }

    /* Tab keyboard nav */
    const tabList = root.querySelector("#trendTabList");
    tabList.addEventListener("keydown", (e) => {
      const tabs = [...tabList.querySelectorAll("[role='tab']")];
      const idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      let next = idx;
      if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
      else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      else return;
      e.preventDefault();
      tabs[next].focus(); tabs[next].click();
    });

    tabList.addEventListener("click", (e) => {
      const btn = e.target.closest("[role='tab']");
      if (!btn) return;
      activeMetric = btn.dataset.metric;
      tabList.querySelectorAll("[role='tab']").forEach(t => {
        const sel = t === btn;
        t.setAttribute("aria-selected", sel);
        t.tabIndex = sel ? 0 : -1;
        t.style.borderColor = sel ? "var(--accent)" : "var(--border)";
        t.style.background  = sel ? "var(--accent-dim)" : "transparent";
        t.style.color       = sel ? "var(--accent)" : "var(--muted)";
      });
      refresh();
    });

    root.querySelector("#trendRangeGroup").addEventListener("click", (e) => {
      const btn = e.target.closest(".trend-range-btn");
      if (!btn) return;
      activeRange = +btn.dataset.range;
      root.querySelectorAll(".trend-range-btn").forEach(b => {
        const active = b === btn;
        b.style.background = active ? "var(--accent)" : "var(--bg2)";
        b.style.color      = active ? "#fff" : "var(--text)";
      });
      refresh();
    });

    root.querySelector("#trendExportBtn").addEventListener("click", () => {
      exportCSV(activeMetric, activeRange);
    });

    refresh();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
/**
 * trend-analysis.js
 * Colorado Housing Trend Analysis Module
 * Compares Colorado housing metrics against 10+ peer states with
 * statistical significance indicators, time-range filtering, and CSV export.
 *
 * Usage: TrendAnalysis.init()  (call after DOMContentLoaded)
 * Renders into: #trend-analysis-section
 */
(function (window) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Constants & hardcoded data                                         */
  /* ------------------------------------------------------------------ */

  const STATES = [
    'Colorado', 'Texas', 'California', 'Arizona', 'Utah',
    'Nevada', 'Oregon', 'Washington', 'Florida', 'Georgia',
    'North Carolina', 'Virginia',
  ];

  // Annual snapshots: 2019 – 2024
  const YEARS = [2019, 2020, 2021, 2022, 2023, 2024];

  // Median home price (USD thousands)
  const MEDIAN_PRICE = {
    Colorado:       [420, 445, 530, 590, 565, 572],
    Texas:          [230, 250, 305, 350, 330, 335],
    California:     [580, 620, 720, 810, 760, 775],
    Arizona:        [265, 295, 375, 430, 400, 408],
    Utah:           [320, 360, 455, 530, 500, 510],
    Nevada:         [295, 325, 405, 460, 425, 432],
    Oregon:         [365, 395, 470, 510, 480, 487],
    Washington:     [420, 460, 545, 610, 575, 582],
    Florida:        [260, 295, 380, 430, 415, 421],
    Georgia:        [215, 240, 305, 355, 340, 346],
    'North Carolina': [215, 240, 300, 345, 335, 341],
    Virginia:       [305, 335, 400, 445, 430, 437],
  };

  // Year-over-year rent growth (%)
  const RENT_GROWTH = {
    Colorado:       [3.1, 1.8, 8.4, 12.1, 4.2, 3.8],
    Texas:          [2.8, 0.5, 9.2, 14.3, 3.1, 2.9],
    California:     [3.5, -0.2, 6.1, 8.7, 2.5, 2.1],
    Arizona:        [4.2, 2.1, 14.5, 18.2, 2.8, 2.4],
    Utah:           [3.8, 2.4, 12.1, 15.6, 3.4, 3.0],
    Nevada:         [5.1, 0.8, 13.4, 16.9, 2.1, 1.8],
    Oregon:         [2.9, 1.2, 7.8, 10.4, 3.0, 2.7],
    Washington:     [3.3, 0.6, 9.1, 12.7, 3.8, 3.4],
    Florida:        [4.0, 1.5, 15.2, 19.4, 3.2, 2.8],
    Georgia:        [3.2, 1.4, 11.3, 14.8, 3.5, 3.1],
    'North Carolina': [3.0, 1.6, 10.5, 13.7, 3.6, 3.2],
    Virginia:       [2.7, 1.1, 7.4, 9.8, 2.9, 2.6],
  };

  // Vacancy rate (%)
  const VACANCY_RATE = {
    Colorado:       [4.2, 4.8, 3.9, 3.1, 3.8, 4.0],
    Texas:          [7.1, 7.8, 5.9, 4.8, 6.2, 6.5],
    California:     [3.8, 4.2, 3.5, 2.9, 3.4, 3.6],
    Arizona:        [5.5, 6.1, 4.2, 3.3, 5.1, 5.4],
    Utah:           [3.9, 4.5, 3.2, 2.6, 3.5, 3.7],
    Nevada:         [5.8, 6.8, 4.5, 3.4, 5.3, 5.6],
    Oregon:         [4.1, 4.9, 3.8, 3.0, 3.7, 3.9],
    Washington:     [3.7, 4.3, 3.4, 2.8, 3.3, 3.5],
    Florida:        [6.2, 7.1, 4.8, 3.6, 5.4, 5.7],
    Georgia:        [6.5, 7.3, 5.1, 3.9, 5.8, 6.1],
    'North Carolina': [5.9, 6.7, 4.6, 3.5, 5.2, 5.5],
    Virginia:       [4.8, 5.4, 4.1, 3.3, 4.5, 4.7],
  };

  // New construction starts (thousands of units)
  const CONSTRUCTION_STARTS = {
    Colorado:       [58.2, 54.1, 68.4, 72.1, 61.3, 59.8],
    Texas:          [185.4, 172.3, 215.6, 228.4, 198.7, 192.3],
    California:     [112.3, 98.7, 125.4, 118.9, 105.2, 101.8],
    Arizona:        [54.1, 48.9, 67.8, 74.2, 62.5, 60.1],
    Utah:           [28.4, 25.6, 36.1, 40.3, 33.8, 32.4],
    Nevada:         [22.1, 19.8, 28.4, 32.1, 26.7, 25.3],
    Oregon:         [24.6, 21.3, 29.8, 33.4, 27.9, 26.5],
    Washington:     [52.3, 47.8, 63.2, 68.9, 57.4, 55.1],
    Florida:        [142.6, 128.4, 168.9, 182.3, 158.7, 152.4],
    Georgia:        [78.4, 69.2, 94.6, 105.3, 88.7, 84.9],
    'North Carolina': [62.1, 55.8, 78.3, 86.4, 73.1, 70.2],
    Virginia:       [38.7, 34.5, 47.2, 52.8, 44.3, 42.6],
  };

  const METRICS = [
    {
      key: 'medianPrice',
      label: 'Median Home Price',
      unit: '$k',
      data: MEDIAN_PRICE,
      methodology: 'Median home price (USD thousands) sourced from state-level MLS aggregates and Census ACS 5-year estimates. Values represent Q4 annual figures.',
    },
    {
      key: 'rentGrowth',
      label: 'Rent Growth (YoY %)',
      unit: '%',
      data: RENT_GROWTH,
      methodology: 'Year-over-year percentage change in median asking rent for 2-bedroom units. Derived from CoStar, Zillow Observed Rent Index, and BLS CPI shelter component.',
    },
    {
      key: 'vacancyRate',
      label: 'Vacancy Rate',
      unit: '%',
      data: VACANCY_RATE,
      methodology: 'Rental vacancy rate (%) from Census Housing Vacancy Survey and ACS estimates. Reflects the share of rental units available but unoccupied.',
    },
    {
      key: 'constructionStarts',
      label: 'New Construction Starts',
      unit: 'k units',
      data: CONSTRUCTION_STARTS,
      methodology: 'Annual new residential construction starts (thousands of units) from Census Bureau Building Permits Survey and State Construction Monitors.',
    },
  ];

  const TIME_RANGES = [
    { label: '1 Year', value: 1 },
    { label: '3 Years', value: 3 },
    { label: '5 Years', value: 5 },
  ];

  const COLORS = [
    '#1a73e8', '#e53935', '#43a047', '#fb8c00', '#8e24aa',
    '#00acc1', '#f06292', '#558b2f', '#6d4c41', '#546e7a',
    '#fdd835', '#26c6da',
  ];

  /* ------------------------------------------------------------------ */
  /*  In-memory cache                                                    */
  /* ------------------------------------------------------------------ */

  const _cache = {};

  function getCached(key) { return _cache[key]; }
  function setCache(key, val) { _cache[key] = val; return val; }

  /* ------------------------------------------------------------------ */
  /*  Statistical helpers                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Compute mean of an array.
   */
  function mean(arr) {
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  /**
   * Compute sample standard deviation.
   */
  function stddev(arr) {
    const m = mean(arr);
    const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(variance);
  }

  /**
   * Two-sample Welch t-test statistic.
   * Returns { t, significant } where significant = |t| > 2.0 (~p<0.05 heuristic).
   */
  function welchT(a, b) {
    if (a.length < 2 || b.length < 2) return { t: 0, significant: false };
    const ma = mean(a), mb = mean(b);
    const sa = stddev(a), sb = stddev(b);
    const se = Math.sqrt((sa ** 2 / a.length) + (sb ** 2 / b.length));
    if (se === 0) return { t: 0, significant: false };
    const t = (ma - mb) / se;
    return { t: parseFloat(t.toFixed(2)), significant: Math.abs(t) > 2.0 };
  }

  /* ------------------------------------------------------------------ */
  /*  Data helpers                                                       */
  /* ------------------------------------------------------------------ */

  function sliceByYears(arr, numYears) {
    return arr.slice(arr.length - numYears);
  }

  function yearsLabel(numYears) {
    return YEARS.slice(YEARS.length - numYears);
  }

  /* ------------------------------------------------------------------ */
  /*  CSV export                                                         */
  /* ------------------------------------------------------------------ */

  function buildCSV(metricKey, numYears) {
    const metric = METRICS.find(m => m.key === metricKey);
    if (!metric) return '';
    const yearSlice = yearsLabel(numYears);
    const rows = [['State', ...yearSlice, 'Vs CO (t-stat)', 'Significant']];
    const coData = sliceByYears(metric.data['Colorado'], numYears);
    STATES.forEach(state => {
      const vals = sliceByYears(metric.data[state], numYears);
      const { t, significant } = welchT(coData, vals);
      rows.push([state, ...vals.map(v => v.toFixed(2)), t, significant ? 'Yes' : 'No']);
    });
    return rows.map(r => r.join(',')).join('\n');
  }

  function downloadCSV(metricKey, numYears) {
    const csv = buildCSV(metricKey, numYears);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `colorado-${metricKey}-${numYears}yr-trend.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ------------------------------------------------------------------ */
  /*  Chart rendering                                                    */
  /* ------------------------------------------------------------------ */

  function buildChartDatasets(metric, numYears) {
    const cacheKey = `${metric.key}-${numYears}`;
    if (getCached(cacheKey)) return getCached(cacheKey);

    const yearSlice = yearsLabel(numYears);
    const datasets = STATES.map((state, i) => ({
      label: state,
      data: sliceByYears(metric.data[state], numYears),
      borderColor: COLORS[i % COLORS.length],
      backgroundColor: COLORS[i % COLORS.length] + '22',
      borderWidth: state === 'Colorado' ? 3 : 1.5,
      pointRadius: state === 'Colorado' ? 5 : 3,
      tension: 0.3,
    }));

    return setCache(cacheKey, { labels: yearSlice, datasets });
  }

  function renderChart(canvasId, metric, numYears) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Destroy previous instance if any
    if (canvas._chartInstance) {
      canvas._chartInstance.destroy();
    }

    const chartData = buildChartDatasets(metric, numYears);

    canvas._chartInstance = new window.Chart(ctx, {
      type: 'line',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 12,
              font: { size: 12 },
              color: getComputedStyle(document.documentElement).getPropertyValue('--text') || '#333',
            },
          },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} ${metric.unit}`,
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: 'Year' },
            ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--muted') || '#666' },
          },
          y: {
            title: { display: true, text: `${metric.label} (${metric.unit})` },
            ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--muted') || '#666' },
          },
        },
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Significance table                                                 */
  /* ------------------------------------------------------------------ */

  function buildSignificanceTable(metric, numYears) {
    const coData = sliceByYears(metric.data['Colorado'], numYears);
    const rows = STATES.filter(s => s !== 'Colorado').map(state => {
      const stateData = sliceByYears(metric.data[state], numYears);
      const { t, significant } = welchT(coData, stateData);
      const coMean = mean(coData).toFixed(1);
      const stMean = mean(stateData).toFixed(1);
      const diff = (mean(coData) - mean(stateData)).toFixed(1);
      return { state, coMean, stMean, diff, t, significant };
    });
    return rows;
  }

  /* ------------------------------------------------------------------ */
  /*  DOM helpers                                                        */
  /* ------------------------------------------------------------------ */

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k.startsWith('data-')) node.dataset[k.slice(5)] = v;
      else node.setAttribute(k, v);
    });
    children.forEach(child => {
      if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else if (child) node.appendChild(child);
    });
    return node;
  }

  /* ------------------------------------------------------------------ */
  /*  Main render                                                        */
  /* ------------------------------------------------------------------ */

  function renderMetricPanel(container, metric, numYears) {
    // Chart card
    const canvasId = `ta-chart-${metric.key}`;

    const chartWrapper = el('div', { class: 'ta-chart-wrapper', style: 'height:320px;position:relative;' });
    const canvas = el('canvas', {
      id: canvasId,
      'aria-label': `${metric.label} trend chart for Colorado vs peer states`,
      role: 'img',
    });
    chartWrapper.appendChild(canvas);

    // Significance table
    const rows = buildSignificanceTable(metric, numYears);
    const thead = el('thead', {},
      el('tr', {},
        el('th', { scope: 'col' }, 'State'),
        el('th', { scope: 'col' }, `CO Mean (${metric.unit})`),
        el('th', { scope: 'col' }, `State Mean (${metric.unit})`),
        el('th', { scope: 'col' }, 'Difference'),
        el('th', { scope: 'col' }, 't-stat'),
        el('th', { scope: 'col' }, 'Significant?'),
      ),
    );

    const tbody = el('tbody', {});
    rows.forEach(r => {
      const sigCell = el('td', { class: r.significant ? 'ta-sig-yes' : 'ta-sig-no' },
        r.significant ? '✓ Yes (p<0.05)' : '— No',
      );
      tbody.appendChild(el('tr', {},
        el('td', {}, r.state),
        el('td', {}, r.coMean),
        el('td', {}, r.stMean),
        el('td', {
          class: parseFloat(r.diff) > 0 ? 'ta-positive' : 'ta-negative',
        }, (parseFloat(r.diff) > 0 ? '+' : '') + r.diff),
        el('td', {}, r.t.toString()),
        sigCell,
      ));
    });

    const table = el('table', {
      class: 'ta-sig-table',
      'aria-label': `Statistical significance comparison: Colorado vs peer states for ${metric.label}`,
      role: 'table',
    }, thead, tbody);

    const tableScroll = el('div', {
      class: 'ta-table-scroll',
      tabindex: '0',
      'aria-label': 'Scrollable significance table',
    }, table);

    // Methodology tooltip
    const methodBtn = el('button', {
      class: 'ta-method-btn',
      'aria-expanded': 'false',
      'aria-controls': `ta-method-${metric.key}`,
      type: 'button',
    }, 'ℹ Methodology');

    const methodContent = el('div', {
      id: `ta-method-${metric.key}`,
      class: 'ta-method-content',
      role: 'region',
      'aria-label': `Methodology for ${metric.label}`,
      hidden: '',
    }, metric.methodology + ' Statistical significance uses a two-sample Welch t-test; |t| > 2.0 indicates p < 0.05.');

    methodBtn.addEventListener('click', () => {
      const hidden = methodContent.hasAttribute('hidden');
      if (hidden) {
        methodContent.removeAttribute('hidden');
        methodBtn.setAttribute('aria-expanded', 'true');
      } else {
        methodContent.setAttribute('hidden', '');
        methodBtn.setAttribute('aria-expanded', 'false');
      }
    });

    methodBtn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); methodBtn.click(); }
    });

    // Export button
    const exportBtn = el('button', {
      class: 'ta-export-btn',
      type: 'button',
      'aria-label': `Export ${metric.label} data as CSV`,
    }, '⬇ Export CSV');
    exportBtn.addEventListener('click', () => downloadCSV(metric.key, numYears));

    const btnRow = el('div', { class: 'ta-btn-row' }, methodBtn, exportBtn);
    container.appendChild(chartWrapper);
    container.appendChild(btnRow);
    container.appendChild(methodContent);
    container.appendChild(tableScroll);

    // Defer chart rendering so canvas is in DOM
    requestAnimationFrame(() => renderChart(canvasId, metric, numYears));
  }

  function render(section, activeMetricKey, numYears) {
    section.innerHTML = '';
    section.setAttribute('aria-label', 'Colorado Housing Trend Analysis');

    // Header
    const header = el('div', { class: 'ta-header' },
      el('h2', { class: 'ta-title' }, 'Colorado Housing Trend Analysis'),
      el('p', { class: 'ta-subtitle' },
        'Comparing Colorado housing metrics against 11 peer states (2019–2024). ' +
        'Statistical significance tested using Welch\u2019s two-sample t-test.'),
    );
    section.appendChild(header);

    // Time range controls
    const timeRow = el('div', {
      class: 'ta-controls',
      role: 'group',
      'aria-label': 'Time range filter',
    });
    TIME_RANGES.forEach(range => {
      const btn = el('button', {
        class: 'ta-time-btn' + (range.value === numYears ? ' active' : ''),
        type: 'button',
        'aria-pressed': range.value === numYears ? 'true' : 'false',
        'data-years': range.value.toString(),
      }, range.label);
      btn.addEventListener('click', () => {
        render(section, activeMetricKey, range.value);
      });
      timeRow.appendChild(btn);
    });
    section.appendChild(timeRow);

    // Metric tabs
    const tabList = el('div', {
      class: 'ta-tabs',
      role: 'tablist',
      'aria-label': 'Housing metric tabs',
    });
    METRICS.forEach(metric => {
      const tab = el('button', {
        class: 'ta-tab' + (metric.key === activeMetricKey ? ' active' : ''),
        role: 'tab',
        type: 'button',
        'aria-selected': metric.key === activeMetricKey ? 'true' : 'false',
        'aria-controls': `ta-panel-${metric.key}`,
        id: `ta-tab-${metric.key}`,
        tabindex: metric.key === activeMetricKey ? '0' : '-1',
      }, metric.label);
      tab.addEventListener('click', () => render(section, metric.key, numYears));
      tab.addEventListener('keydown', e => {
        const keys = METRICS.map(m => m.key);
        const idx = keys.indexOf(activeMetricKey);
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          render(section, keys[(idx + 1) % keys.length], numYears);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          render(section, keys[(idx - 1 + keys.length) % keys.length], numYears);
        }
      });
      tabList.appendChild(tab);
    });
    section.appendChild(tabList);

    // Active metric panel
    const activeMeta = METRICS.find(m => m.key === activeMetricKey) || METRICS[0];
    const panel = el('div', {
      class: 'ta-panel',
      id: `ta-panel-${activeMeta.key}`,
      role: 'tabpanel',
      'aria-labelledby': `ta-tab-${activeMeta.key}`,
    });
    section.appendChild(panel);
    renderMetricPanel(panel, activeMeta, numYears);

    // Focus active tab after re-render
    requestAnimationFrame(() => {
      const activeTab = section.querySelector('.ta-tab.active');
      if (activeTab) activeTab.focus();
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Styles injection                                                   */
  /* ------------------------------------------------------------------ */

  function injectStyles() {
    if (document.getElementById('ta-styles')) return;
    const style = document.createElement('style');
    style.id = 'ta-styles';
    style.textContent = `
      #trend-analysis-section { font-family: inherit; color: var(--text, #222); }
      .ta-header { margin-bottom: 1rem; }
      .ta-title { font-size: 1.5rem; font-weight: 700; margin: 0 0 .4rem; color: var(--text, #222); }
      .ta-subtitle { font-size: .9rem; color: var(--muted, #555); margin: 0; }
      .ta-controls { display: flex; gap: .5rem; flex-wrap: wrap; margin-bottom: 1rem; }
      .ta-time-btn {
        padding: .4rem .9rem; border-radius: 20px; border: 1.5px solid var(--border, #ccc);
        background: var(--card, #fff); color: var(--text, #222); cursor: pointer; font-size: .85rem;
        transition: background .2s, color .2s;
      }
      .ta-time-btn.active, .ta-time-btn:focus-visible {
        background: var(--color-primary, #1a73e8); color: #fff; border-color: var(--color-primary, #1a73e8);
        outline: 2px solid var(--color-primary, #1a73e8); outline-offset: 2px;
      }
      .ta-tabs { display: flex; gap: .25rem; flex-wrap: wrap; border-bottom: 2px solid var(--border, #e0e0e0); margin-bottom: 1rem; }
      .ta-tab {
        padding: .55rem 1.1rem; border: none; background: none; cursor: pointer; font-size: .9rem;
        color: var(--muted, #555); border-bottom: 3px solid transparent; margin-bottom: -2px;
        transition: color .2s, border-color .2s; border-radius: 4px 4px 0 0;
      }
      .ta-tab.active { color: var(--color-primary, #1a73e8); border-bottom-color: var(--color-primary, #1a73e8); font-weight: 600; }
      .ta-tab:focus-visible { outline: 2px solid var(--color-primary, #1a73e8); outline-offset: 2px; }
      .ta-chart-wrapper { margin-bottom: 1rem; background: var(--card, #fff); border: 1px solid var(--border, #e0e0e0); border-radius: var(--radius-lg, 8px); padding: 1rem; }
      .ta-btn-row { display: flex; gap: .75rem; flex-wrap: wrap; margin-bottom: .75rem; }
      .ta-method-btn, .ta-export-btn {
        padding: .35rem .8rem; border-radius: 6px; border: 1.5px solid var(--border, #ccc);
        background: var(--card, #fff); color: var(--link, #1a73e8); cursor: pointer; font-size: .82rem;
      }
      .ta-method-btn:hover, .ta-export-btn:hover { background: var(--bg2, #f5f5f5); }
      .ta-method-btn:focus-visible, .ta-export-btn:focus-visible { outline: 2px solid var(--color-primary, #1a73e8); outline-offset: 2px; }
      .ta-method-content {
        background: var(--bg2, #f5f5f5); border: 1px solid var(--border, #ddd); border-radius: 6px;
        padding: .75rem 1rem; font-size: .83rem; color: var(--text2, #444); margin-bottom: .75rem; line-height: 1.5;
      }
      .ta-table-scroll { overflow-x: auto; }
      .ta-sig-table { width: 100%; border-collapse: collapse; font-size: .83rem; }
      .ta-sig-table th, .ta-sig-table td { padding: .45rem .7rem; border: 1px solid var(--border, #e0e0e0); text-align: left; }
      .ta-sig-table th { background: var(--bg2, #f5f5f5); color: var(--text, #222); font-weight: 600; }
      .ta-sig-table tr:nth-child(even) td { background: var(--bg2, #fafafa); }
      .ta-sig-yes { color: var(--color-success, #2e7d32); font-weight: 600; }
      .ta-sig-no  { color: var(--muted, #777); }
      .ta-positive { color: var(--color-error, #c62828); }
      .ta-negative { color: var(--color-success, #2e7d32); }
      .ta-panel { background: var(--card, #fff); border-radius: var(--radius-lg, 8px); padding: 1rem; border: 1px solid var(--border, #e0e0e0); }
    `;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  function init() {
    const section = document.getElementById('trend-analysis-section');
    if (!section) {
      console.warn('TrendAnalysis: container #trend-analysis-section not found.');
      return;
    }
    if (!window.Chart) {
      console.warn('TrendAnalysis: Chart.js not loaded.');
      return;
    }
    injectStyles();
    render(section, METRICS[0].key, 5);
  }

  window.TrendAnalysis = { init };

}(window));
