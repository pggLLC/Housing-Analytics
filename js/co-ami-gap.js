/* Colorado: Households vs Priced-Affordable Units by %AMI
 * Data is fetched from a serverless endpoint (recommended) OR a cached JSON file:
 * - APP_CONFIG.AMI_GAP_API_URL (preferred)
 * - /data/co_ami_gap_by_county.json (fallback)
 *
 * Notes:
 * - "Units" are renter-occupied units by gross rent (ACS B25063) that are priced at or below the affordable rent threshold.
 * - These are not guaranteed vacant/available and do not incorporate concessions.
 *
 * v2 enhancements: data caching, CSV export, methodology tooltips, accessibility (ARIA),
 *   lazy loading via IntersectionObserver, AMI band filter, drill-down county details.
 */
(function () {
  const DEFAULT_BANDS = [30, 40, 50, 60, 70, 80, 100];
  const COLOR_SURPLUS       = "rgba(34,163,111,0.65)";
  const COLOR_DEFICIT       = "rgba(224,82,82,0.65)";
  const COLOR_SURPLUS_SOLID = "rgba(34,163,111,1)";
  const COLOR_DEFICIT_SOLID = "rgba(224,82,82,1)";

  const _fetchCache = {};
  const _cache = {};

  function $(sel, root) { return (root || document).querySelector(sel); }
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

  async function fetchJson(url) {
    if (_fetchCache[url]) return _fetchCache[url];
    if (_cache[url]) return _cache[url];
    // Use resolveAssetUrl when available so the base path is correctly prepended
    const resolvedUrl = (typeof window.resolveAssetUrl === 'function') ? window.resolveAssetUrl(url) : url;
    const res = await fetch(resolvedUrl, { cache: "default" });
    if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url} (resolved: ${resolvedUrl})`);
    const data = await res.json();
    _fetchCache[url] = data;
    return data;
  }

  function pickEndpoint() {
    const cfg = window.APP_CONFIG || {};
    return (cfg.AMI_GAP_API_URL && String(cfg.AMI_GAP_API_URL).trim()) || "data/co_ami_gap_by_county.json";
  }

  // Methodology tooltip definitions
  const TOOLTIPS = {
    households: "Renter households whose income falls at or below the specified % of Area Median Income (AMI), per ACS B19001.",
    units: "Renter-occupied units with gross rent at or below the affordability threshold (30% of income) for each AMI band (ACS B25063). Not necessarily vacant or available.",
    gap: "Difference: affordable units minus eligible households. Negative = shortage; positive = apparent surplus.",
    coverage: "Ratio of affordable units to eligible households at this AMI band.",
    affordableRent: "Maximum gross rent (including utilities) considered affordable at 30% of income for a household at the specified AMI level.",
    ami4person: "HUD Area Median Income for a 4-person household in this geography (FY 2025 Income Limits)."
  };

  function addTooltip(el, text) {
    if (!el) return;
    el.setAttribute("title", text);
    if (el.id) el.setAttribute("aria-describedby", `tip-${el.id}`);
    el.style.cursor = "help";
    el.style.borderBottom = "1px dotted currentColor";
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
        o.textContent = c.county_name || c.fips;
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
    const ami4El = $("#amiGapAmi4");
    if (ami4El) {
      ami4El.textContent = ami4 ? `$${fmt(ami4)}` : "—";
      addTooltip(ami4El, TOOLTIPS.ami4person);
    }

    const hh = item.households_le_ami_pct?.[last];
    const un = item.units_priced_affordable_le_ami_pct?.[last];
    const cov = item.coverage_le_ami_pct?.[last];

    const hhEl = $("#amiGapHouseholds100");
    const unEl = $("#amiGapUnits100");
    const covEl = $("#amiGapCoverage100");
    if (hhEl) { hhEl.textContent = fmt(hh); addTooltip(hhEl, TOOLTIPS.households); }
    if (unEl) { unEl.textContent = fmt(un); addTooltip(unEl, TOOLTIPS.units); }
    if (covEl) { covEl.textContent = fmtPct(cov); addTooltip(covEl, TOOLTIPS.coverage); }

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
  function exportCsv(payload, item, geoLabel) {
    const bands = payload.bands || DEFAULT_BANDS;
    const rows = [["AMI Band", "Affordable Rent", "Households", "Affordable Units", "Gap", "Coverage"]];
    bands.forEach(b => {
      const key = String(b);
      const hh = item.households_le_ami_pct?.[key];
      const un = item.units_priced_affordable_le_ami_pct?.[key];
      const gap = item.gap_units_minus_households_le_ami_pct?.[key];
      const cov = item.coverage_le_ami_pct?.[key];
      const rent = item.affordable_rent_monthly?.[key];
      rows.push([
        `<=${b}%`,
        rent != null ? rent : "",
        hh != null ? Math.round(hh) : "",
        un != null ? Math.round(un) : "",
        gap != null ? Math.round(gap) : "",
        cov != null ? (cov * 100).toFixed(1) + "%" : ""
      ]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `co-ami-gap-${geoLabel.replace(/\s+/g, "-").toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
            borderDash: [4, 3],
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
            mode: "index",
            intersect: false,
            callbacks: {
              label: (c) => {
                const v = c.parsed.y;
                if (c.dataset.label === "Gap (units − households)") {
                  const s = (v >= 0 ? "+" : "") + Math.round(v).toLocaleString();
                  return ` Gap: ${s} units`;
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
    if (!el) return;
    const lines = (payload && payload.methodology) ? payload.methodology : [
      "Households are counted from ACS 5-year estimates (Table B19001) for renter-occupied units where household income ≤ the specified % AMI.",
      "Affordable units are renter-occupied housing units with gross rent ≤ 30% of income at the AMI band threshold (ACS Table B25063).",
      "Gap = affordable units − eligible households. A negative gap indicates more eligible households than affordable units.",
      "Coverage = affordable units ÷ eligible households, expressed as a percentage.",
      "AMI thresholds use HUD FY 2025 Income Limits for 4-person households."
    ];
    el.innerHTML = lines.map(p => `<p>${p}</p>`).join("");
    if (payload.sources && payload.sources.length) {
      el.innerHTML += "<p><strong>Sources:</strong> " +
        payload.sources.map(s => `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`).join(" • ") +
        "</p>";
    }
  }

  function pickItem(payload, fips) {
    if (fips === "STATE") return payload.statewide;
    return (payload.counties || []).find(c => c.fips === fips) || payload.statewide;
  }

  async function init() {
    const root = $("#amiGapModule");
    if (!root) return;

    const endpoint = pickEndpoint();
    const epEl = $("#amiGapEndpoint");
    if (epEl) {
      epEl.textContent = endpoint;
      var epRow = document.getElementById('amiGapEndpointRow');
      if (epRow) epRow.removeAttribute('hidden');
    }

    const loadData = async () => {
      let payload;
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
        const geoLabel = (fips === "STATE") ? "Colorado (statewide)" : (item.county_name || fips);

        const titleEl = $("#amiGapGeoTitle");
        if (titleEl) titleEl.textContent = geoLabel;
        renderCards(payload, item);
        renderTable(payload, item);
        renderComparisonChart(payload, item, refs);
        renderGapChart(payload, item, refs);

        // Wire export button each time geography changes
        const btn = $("#amiGapExportBtn");
        if (btn) {
          btn.onclick = () => exportCsv(payload, item, geoLabel);
        }
      }

      const sel = $("#amiGapCountySelect");
      if (sel) sel.addEventListener("change", update);
      update();

      // Supplement with demographics data if housing-data-integration is available
      if (window.HousingDataIntegration) {
        window.HousingDataIntegration.loadDemographicsData().then(demo => {
          if (!demo) return;
          const metaEl = $("#amiGapMeta");
          if (metaEl && demo.updated_at) {
            const existing = metaEl.textContent;
            const demoNote = `Demographics: ${demo.updated_at}`;
            if (!existing.includes(demoNote)) {
              metaEl.textContent = existing ? `${existing} • ${demoNote}` : demoNote;
            }
          }
        }).catch(() => {});
      }
    };

    // Use IntersectionObserver for lazy loading if available
    if ("IntersectionObserver" in window) {
      const obs = new IntersectionObserver((entries, observer) => {
        if (entries[0].isIntersecting) {
          observer.disconnect();
          loadData();
        }
      }, { rootMargin: "200px" });
      obs.observe(root);
    } else {
      loadData();
    }
  }

  window.CoAmiGap = { init };

})();
