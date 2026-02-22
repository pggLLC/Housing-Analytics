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
          legend: { labels: { color: textColor, font: { size: 11 }, padding: 10,
            filter: (item) => item.text === "Colorado" || true } }
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
    let activeRange  = 5;

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
