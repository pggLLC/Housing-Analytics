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
  const COLOR_SURPLUS  = "rgba(34,163,111,0.65)";
  const COLOR_DEFICIT  = "rgba(224,82,82,0.65)";
  const COLOR_SURPLUS_SOLID = "rgba(34,163,111,1)";
  const COLOR_DEFICIT_SOLID = "rgba(224,82,82,1)";

  function $(sel, root = document) { return root.querySelector(sel); }
  function fmt(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return Math.round(n).toLocaleString();
  }
  function fmtPct(x) {
    if (x === null || x === undefined || Number.isNaN(x)) return "—";
    return (x * 100).toFixed(1) + "%";
  }

  /* Read a CSS custom property value from the document root */
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  /* In-memory fetch cache */
  const _fetchCache = {};
  async function fetchJson(url) {
    if (_fetchCache[url]) return _fetchCache[url];
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
    const data = await res.json();
    _fetchCache[url] = data;
    return data;
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
    if (!sel) return;
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
    const amiEl = $("#amiGapAmi4");
    if (amiEl) amiEl.textContent = ami4 ? `$${fmt(ami4)}` : "—";

    const hh = item.households_le_ami_pct?.[last];
    const un = item.units_priced_affordable_le_ami_pct?.[last];
    const cov = item.coverage_le_ami_pct?.[last];

    const hhEl = $("#amiGapHouseholds100");
    const unEl = $("#amiGapUnits100");
    const covEl = $("#amiGapCoverage100");
    if (hhEl) hhEl.textContent = fmt(hh);
    if (unEl) unEl.textContent = fmt(un);
    if (covEl) covEl.textContent = fmtPct(cov);

    /* Color-code coverage: < 0.5 = bad, 0.5-0.8 = warn, >= 0.8 = ok */
    if (covEl && cov != null) {
      covEl.style.color = cov < 0.5 ? cssVar("--bad", "#e05252") : cov < 0.8 ? cssVar("--warn", "#e09a25") : cssVar("--good", "#22a36f");
    }
    /* Update coverage progress bar */
    const covBar = $("#amiGapCovBar");
    if (covBar && cov != null) {
      const pct = Math.min(100, Math.max(0, cov * 100));
      covBar.style.width = pct.toFixed(1) + "%";
      covBar.style.background = cov < 0.5 ? cssVar("--bad", "#e05252") : cov < 0.8 ? cssVar("--warn", "#e09a25") : cssVar("--accent", "#0ea5a0");
    }
  }

  function renderTable(payload, item) {
    const bands = payload.bands || DEFAULT_BANDS;
    const tb = $("#amiGapTableBody");
    if (!tb) return;
    tb.innerHTML = "";

    bands.forEach(b => {
      const key = String(b);
      const hh = item.households_le_ami_pct?.[key];
      const un = item.units_priced_affordable_le_ami_pct?.[key];
      const gap = item.gap_units_minus_households_le_ami_pct?.[key];
      const cov = item.coverage_le_ami_pct?.[key];
      const rent = item.affordable_rent_monthly?.[key];

      const gapStr = gap == null ? "—" : (gap >= 0 ? "+" : "") + fmt(gap);
      const gapColor = gap == null ? "" : gap >= 0
        ? `style="color:${cssVar("--good", "#22a36f")}"`
        : `style="color:${cssVar("--bad", "#e05252")}"`;

      const covPct = cov == null ? null : cov * 100;
      const covBar = covPct != null
        ? `<div class="ami-gap-cov-bar" style="--pct:${Math.min(100, covPct).toFixed(1)}%"></div>`
        : "";

      /* Color-code entire row: surplus = subtle green tint, shortage = subtle red tint */
      const rowBgValue = gap == null ? ""
        : gap >= 0
          ? `background:${cssVar("--good-dim", "rgba(5,150,105,.06)")}`
          : `background:${cssVar("--bad-dim",  "rgba(220,38,38,.06)")}`;

      const tr = document.createElement("tr");
      if (rowBgValue) tr.style.cssText = rowBgValue;
      tr.innerHTML = `
        <td><strong>≤ ${b}% AMI</strong></td>
        <td>${rent != null ? "$" + fmt(rent) + "/mo" : "—"}</td>
        <td>${fmt(hh)}</td>
        <td>${fmt(un)}</td>
        <td ${gapColor}>${gapStr}</td>
        <td>${fmtPct(cov)}${covBar}</td>
      `;
      tb.appendChild(tr);
    });
  }

  /* CSV export for AMI gap data */
  function exportAmiGapCSV(payload, item) {
    const bands = payload.bands || DEFAULT_BANDS;
    const rows = [["AMI Band","Affordable Rent ($/mo)","Households","Affordable Units","Gap (units-HH)","Coverage"]];
    bands.forEach(b => {
      const key = String(b);
      rows.push([
        `<=${b}% AMI`,
        item.affordable_rent_monthly?.[key] ?? "",
        item.households_le_ami_pct?.[key] ?? "",
        item.units_priced_affordable_le_ami_pct?.[key] ?? "",
        item.gap_units_minus_households_le_ami_pct?.[key] ?? "",
        item.coverage_le_ami_pct?.[key] ?? ""
      ]);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "co_ami_gap.csv";
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* Bar chart: households vs priced-affordable units at each AMI band */
  function renderComparisonChart(payload, item, refs) {
    const bands = payload.bands || DEFAULT_BANDS;
    const ctx = $("#amiGapComparisonChart");
    if (!ctx || !window.Chart) return;

    ctx.setAttribute("role", "img");
    ctx.setAttribute("aria-label", "Bar chart comparing households and affordable units by AMI band");

    const hhs = getSeries(item.households_le_ami_pct, bands).map(v => (v == null ? 0 : v));
    const uns = getSeries(item.units_priced_affordable_le_ami_pct, bands).map(v => (v == null ? 0 : v));

    destroyChart(refs.comparison);

    const textColor   = cssVar("--text",   "rgba(13,31,53,.85)");
    const mutedColor  = cssVar("--muted",  "rgba(71,96,128,.7)");
    const borderColor = cssVar("--border", "rgba(13,31,53,.11)");
    const gridColor   = cssVar("--border", "rgba(13,31,53,.08)");

    refs.comparison = new Chart(ctx, {
      type: "bar",
      data: {
        labels: bands.map(b => `≤${b}% AMI`),
        datasets: [
          {
            label: "Households",
            data: hhs,
            backgroundColor: "rgba(59, 130, 246, 0.70)",
            borderColor: "rgba(59, 130, 246, 1)",
            borderWidth: 1,
            borderRadius: 4
          },
          {
            label: "Affordable Units",
            data: uns,
            backgroundColor: "rgba(34, 163, 111, 0.70)",
            borderColor: "rgba(34, 163, 111, 1)",
            borderWidth: 1,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: { color: textColor, font: { size: 12 }, padding: 16 }
          },
          tooltip: {
            callbacks: {
              label: (c) => ` ${c.dataset.label}: ${Math.round(c.parsed.y).toLocaleString()}`
            }
          }
        },
        scales: {
          x: {
            ticks: { color: mutedColor, font: { size: 11 } },
            grid: { color: gridColor },
            border: { color: borderColor }
          },
          y: {
            ticks: {
              color: mutedColor, font: { size: 11 },
              callback: (v) => {
                if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
                if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
                return v;
              }
            },
            grid: { color: gridColor },
            border: { color: borderColor }
          }
        }
      }
    });
  }

  /* Dual-axis chart: gap bars (left axis) + households & units lines (right axis) */
  function renderGapChart(payload, item, refs) {
    const bands = payload.bands || DEFAULT_BANDS;
    const ctx = $("#amiGapChart");
    if (!ctx || !window.Chart) return;

    ctx.setAttribute("role", "img");
    ctx.setAttribute("aria-label", "Dual-axis chart: affordability gap bars with households and units trend lines");

    const gaps = getSeries(item.gap_units_minus_households_le_ami_pct, bands).map(v => (v == null ? 0 : v));
    const hhs  = getSeries(item.households_le_ami_pct, bands).map(v => (v == null ? 0 : v));
    const uns  = getSeries(item.units_priced_affordable_le_ami_pct, bands).map(v => (v == null ? 0 : v));
    destroyChart(refs.gap);

    const textColor   = cssVar("--text",   "rgba(13,31,53,.85)");
    const mutedColor  = cssVar("--muted",  "rgba(71,96,128,.7)");
    const gridColor   = cssVar("--border", "rgba(13,31,53,.08)");
    const borderColor = cssVar("--border", "rgba(13,31,53,.11)");

    refs.gap = new Chart(ctx, {
      type: "bar",
      data: {
        labels: bands.map(b => `≤${b}% AMI`),
        datasets: [
          {
            label: "Gap (units − households)",
            data: gaps,
            backgroundColor: gaps.map(v => v >= 0 ? COLOR_SURPLUS        : COLOR_DEFICIT),
            borderColor:     gaps.map(v => v >= 0 ? COLOR_SURPLUS_SOLID   : COLOR_DEFICIT_SOLID),
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: "yGap",
            order: 2
          },
          {
            label: "Households",
            data: hhs,
            type: "line",
            borderColor: "rgba(59,130,246,.85)",
            backgroundColor: "transparent",
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            yAxisID: "yCount",
            order: 1
          },
          {
            label: "Affordable Units",
            data: uns,
            type: "line",
            borderColor: "rgba(34,163,111,.85)",
            backgroundColor: "transparent",
            borderWidth: 2,
            borderDash: [4,3],
            pointRadius: 3,
            tension: 0.3,
            yAxisID: "yCount",
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: { color: textColor, font: { size: 12 }, padding: 14 }
          },
          tooltip: {
            callbacks: {
              label: (c) => {
                const v = c.parsed.y;
                if (c.dataset.label === "Gap (units − households)") {
                  return ` Gap: ${(v >= 0 ? "+" : "") + Math.round(v).toLocaleString()} units`;
                }
                return ` ${c.dataset.label}: ${Math.round(v).toLocaleString()}`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: mutedColor, font: { size: 11 } },
            grid: { color: gridColor },
            border: { color: borderColor }
          },
          yGap: {
            type: "linear",
            position: "left",
            ticks: {
              color: mutedColor, font: { size: 11 },
              callback: (v) => {
                if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + "M";
                if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + "K";
                return v;
              }
            },
            grid: { color: gridColor },
            border: { color: borderColor },
            title: { display: true, text: "Gap (units)", color: mutedColor, font: { size: 10 } }
          },
          yCount: {
            type: "linear",
            position: "right",
            ticks: {
              color: mutedColor, font: { size: 11 },
              callback: (v) => {
                if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
                if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
                return v;
              }
            },
            grid: { drawOnChartArea: false },
            border: { color: borderColor },
            title: { display: true, text: "HH / Units", color: mutedColor, font: { size: 10 } }
          }
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
    if (payload.sources && payload.sources.length) {
      el.innerHTML += "<p><strong>Sources:</strong> " +
        payload.sources.map(s => `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`).join(" • ") +
        "</p>";
    }
    /* Methodology tooltips via title + aria-describedby */
    el.querySelectorAll("[data-tooltip]").forEach(node => {
      node.title = node.dataset.tooltip;
      const tipId = "amiTip_" + Math.random().toString(36).slice(2);
      const span = document.createElement("span");
      span.id = tipId;
      span.className = "sr-only";
      span.textContent = node.dataset.tooltip;
      node.insertAdjacentElement("afterend", span);
      node.setAttribute("aria-describedby", tipId);
    });
  }

  function pickItem(payload, fips) {
    if (fips === "STATE") return payload.statewide;
    return payload.counties.find(c => c.fips === fips) || payload.statewide;
  }

  async function init() {
    const root = $("#amiGapModule");
    if (!root) return;

    const endpoint = pickEndpoint();
    const epEl = $("#amiGapEndpoint");
    if (epEl) epEl.textContent = endpoint;

    /* IntersectionObserver-based lazy loading */
    function loadModule() {
      let payload;
      const load = async () => {
        try {
          payload = await fetchJson(endpoint);
        } catch (e) {
          console.error(e);
          const errEl = $("#amiGapError");
          if (errEl) {
            errEl.textContent = `Could not load AMI gap data. Check endpoint or cached JSON. (${e.message})`;
            errEl.style.display = "block";
          }
          return;
        }

        renderMetadata(payload.meta);
        renderMethodology(payload);

        buildCountyOptions(payload.counties || []);
        const refs = { comparison: null, gap: null };

        function update() {
          const sel = $("#amiGapCountySelect");
          const fips = sel ? sel.value : "STATE";
          const item = pickItem(payload, fips);

          const titleEl = $("#amiGapGeoTitle");
          if (titleEl) titleEl.textContent = (fips === "STATE") ? "Colorado (statewide)" : item.county_name;
          renderCards(payload, item);
          renderTable(payload, item);
          renderComparisonChart(payload, item, refs);
          renderGapChart(payload, item, refs);
        }

        const sel = $("#amiGapCountySelect");
        if (sel) sel.addEventListener("change", update);

        /* CSV export button */
        const exportBtn = $("#amiGapExportBtn");
        if (exportBtn) {
          exportBtn.addEventListener("click", () => {
            const fips = sel ? sel.value : "STATE";
            exportAmiGapCSV(payload, pickItem(payload, fips));
          });
        }

        update();
      };
      load();
    }

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries, obs) => {
        if (entries.some(e => e.isIntersecting)) {
          obs.unobserve(root);
          loadModule();
        }
      }, { rootMargin: "200px" });
      observer.observe(root);
    } else {
      loadModule();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
