// Multifamily Lens — comprehensive Colorado view
//
// Loads two cached snapshots:
//   • data/census-multifamily-co.json   ACS DP04 shares per geography
//   • data/multifamily-inventory-co.json LIHTC + preservation + HUD + USDA rollup
//
// Renders structure mix, tenure split, rent burden, year-built distribution,
// LIHTC siting + portfolio characteristics, and statewide leaderboards.

const SNAPSHOT_PATH = "data/census-multifamily-co.json";
const INVENTORY_PATH = "data/multifamily-inventory-co.json";
// D12 — The snapshot above only carries 2019-2023 structure shares, so the
// summary cards, structure counts, tenure, rent, burden and year-built
// sections were blank or zero. Each geography's own stored ACS 2024 profile
// (data/hna/summary/{geoid}.json) fills them, labelled with the series the
// published margins file records for it.
const SUMMARY_PATH = (geoid) => `data/hna/summary/${geoid}.json`;
const RELIABILITY_PATH = "data/hna/acs-reliability.json";
let reliability = null;
const profileCache = {};
const ACS_BASE = "https://api.census.gov/data/2024/acs/acs5/profile";
const LIVE_VARS = {
  totalHU: "DP04_0001E",
  pct_5_9: "DP04_0011PE",
  pct_10_19: "DP04_0012PE",
  pct_20p: "DP04_0013PE",
};
// Building-type counts DP04_0007E-DP04_0014E, in STRUCTURE_LABELS order.
const STRUCTURE_KEYS = ["1_detached", "1_attached", "2_units", "3_4_units", "5_9", "10_19", "20p", "mobile"];
const STRUCTURE_LIVE_VARS = STRUCTURE_KEYS.map((_, i) => "DP04_00" + String(7 + i).padStart(2, "0") + "E");
const COLORADO_FIPS = "08";

const STRUCTURE_LABELS = [
  ["1_detached", "1-unit detached"],
  ["1_attached", "1-unit attached"],
  ["2_units", "2 units"],
  ["3_4_units", "3-4 units"],
  ["5_9", "5-9 units"],
  ["10_19", "10-19 units"],
  ["20p", "20+ units"],
  ["mobile", "Mobile home"],
];

const STRUCTURE_COLORS = [
  "#4a7c8c", "#5b9aae", "#7bb8c8", "#a8d0db",
  "#f4a261", "#e76f51", "#c1442f", "#8c6249",
];

const YEAR_BUILT_LABELS = [
  ["built_2020_later", "2020+"],
  ["built_2010_2019", "2010-19"],
  ["built_2000_2009", "2000-09"],
  ["built_1990_1999", "1990-99"],
  ["built_1980_1989", "1980-89"],
  ["built_1970_1979", "1970-79"],
  ["built_1960_1969", "1960-69"],
  ["built_1950_1959", "1950-59"],
  ["built_1940_1949", "1940-49"],
  ["built_1939_earlier", "<1940"],
];

const BURDEN_LABELS = [
  ["less_15", "<15%"],
  ["15_19", "15-19%"],
  ["20_24", "20-24%"],
  ["25_29", "25-29%"],
  ["30_34", "30-34%"],
  ["35_plus", "35%+"],
];

let snapshot = null;
let inventory = null;
let lastSelection = null;
let charts = {};   // id → Chart instance (so we can destroy on re-render)

// ── helpers ──────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function censusKey() {
  return window.APP_CONFIG && window.APP_CONFIG.CENSUS_API_KEY
    ? window.APP_CONFIG.CENSUS_API_KEY : "";
}

function fmtNumber(x) {
  if (x == null) return "—";
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return n.toLocaleString();
}

function fmtPct(x, decimals = 1) {
  if (x == null) return "—";
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(decimals)}%`;
}

const moneyFormatter = window.MoneyFormatter || (typeof require === 'function' ? require('./utils/format-money.js') : null);
function fmtMoney(x) {
  if (moneyFormatter.isAbsent(x) || Number(x) <= 0) return "—";
  return moneyFormatter.formatMoney(x);
}

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); charts[id] = null; }
}

// ── data loading ─────────────────────────────────────────────────────────

async function fetchJSON(path) {
  if (typeof window.DataService !== "undefined" && window.DataService.getJSON) {
    return window.DataService.getJSON(path, { cache: "no-store" });
  }
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

async function loadAll() {
  if (snapshot && inventory) return;
  // Inventory is optional — page renders ACS sections even if it 404s.
  const results = await Promise.allSettled([
    fetchJSON(SNAPSHOT_PATH),
    fetchJSON(INVENTORY_PATH),
  ]);
  if (results[0].status === "fulfilled") snapshot = results[0].value;
  else throw new Error(`Snapshot load failed: ${results[0].reason.message}`);
  try { reliability = await fetchJSON(RELIABILITY_PATH); } catch (_) { reliability = null; }
  if (results[1].status === "fulfilled") inventory = results[1].value;
  else {
    console.warn("[multifamily] inventory missing:", results[1].reason);
    inventory = { state: null, counties: {}, places: {} };
  }
}

function acsLabel(series, year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return "ACS";
  return series === "acs1" ? `ACS ${y} 1-year` : `ACS ${y - 4}-${y} 5-year`;
}

function snapshotVintageNote(record) {
  if (record && record._vintage) return `${record._vintage} (Census DP04)`;
  if (!snapshot || !snapshot.meta) return "";
  return `${acsLabel("acs5", snapshot.meta.acs_year)} (Census DP04)`;
}

async function loadProfile(geoid) {
  if (profileCache[geoid] !== undefined) return profileCache[geoid];
  try {
    const sum = await fetchJSON(SUMMARY_PATH(geoid));
    profileCache[geoid] = (sum && sum.acsProfile) || null;
  } catch (_) {
    profileCache[geoid] = null;
  }
  return profileCache[geoid];
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > -1e8 ? n : null;
}

// Merge the geography's stored ACS 2024 profile onto its snapshot record.
async function enrich(record) {
  if (!record || record._enriched) return record;
  const p = await loadProfile(record.geoid);
  if (!p) return record;
  const total = num(p.DP04_0001E);
  const keys = ["1_detached", "1_attached", "2_units", "3_4_units", "5_9", "10_19", "20p", "mobile"];
  const structure_count = {};
  const structure_pct = {};
  keys.forEach((k, i) => {
    const c = num(p["DP04_00" + String(7 + i).padStart(2, "0") + "E"]);
    structure_count[k] = c;
    structure_pct[k] = c != null && total ? Math.round((c / total) * 1000) / 10 : null;
  });
  const mf = ["5_9", "10_19", "20p"].map((k) => structure_count[k]);
  const year_built = {};
  const ybKeys = ["built_2020_later", "built_2010_2019", "built_2000_2009", "built_1990_1999", "built_1980_1989",
    "built_1970_1979", "built_1960_1969", "built_1950_1959", "built_1940_1949", "built_1939_earlier"];
  let ybAny = false;
  ybKeys.forEach((k, i) => {
    const v = num(p["DP04_00" + String(17 + i) + "E"]);
    if (v != null) { year_built[k] = v; ybAny = true; }
  });
  const g = [137, 138, 139, 140, 141, 142].map((n) => num(p["DP04_0" + n + "PE"]));
  const bKeys = ["less_15", "15_19", "20_24", "25_29", "30_34", "35_plus"];
  const rent_burden_dist = {};
  if (g.every((v) => v != null)) bKeys.forEach((k, i) => { rent_burden_dist[k] = g[i]; });
  const rel = reliability && reliability.geos && reliability.geos[record.geoid];
  const relHU = rel && rel.DP04_0001E;
  const series = relHU && relHU.e != null && total != null && Math.abs(relHU.e - total) < 0.5 ? relHU.s : null;
  const year = (relHU && relHU.y) || Number(p._acsYear) || 2024;
  return {
    ...record,
    totalHU: total != null ? total : record.totalHU,
    structure_count,
    structure_pct,
    // Same rounding as the structure table's total row, so the two match.
    pct_mf: mf.every((v) => v != null) && total
      ? Math.round((structure_pct["5_9"] + structure_pct["10_19"] + structure_pct["20p"]) * 10) / 10 : record.pct_mf,
    mf_units: mf.every((v) => v != null) ? mf.reduce((a, b) => a + b, 0) : null,
    pct_owner: num(p.DP04_0046PE),
    pct_renter: num(p.DP04_0047PE),
    median_gross_rent: num(p.DP04_0134E),
    median_home_value: num(p.DP04_0089E),
    pct_renter_cost_burdened: g[4] != null && g[5] != null ? Math.round((g[4] + g[5]) * 10) / 10 : null,
    rent_burden_dist,
    year_built: ybAny ? year_built : {},
    _vintage: series ? acsLabel(series, year) : `ACS ${year}`,
    _enriched: true,
  };
}

// ── live refresh (single geography, requires Census key) ─────────────────

async function fetchLiveOne(record) {
  const key = censusKey();
  if (!key) {
    throw new Error("Live refresh requires a Census API key.");
  }
  const get = `NAME,${Object.values(LIVE_VARS).concat(STRUCTURE_LIVE_VARS).join(",")}`;
  let where, within;
  if (record.level === "state") { where = `state:${COLORADO_FIPS}`; }
  else if (record.level === "county") { where = `county:${record.geoid.slice(2)}`; within = `state:${COLORADO_FIPS}`; }
  else if (record.level === "place") { where = `place:${record.geoid.slice(2)}`; within = `state:${COLORADO_FIPS}`; }
  else throw new Error(`Unknown level: ${record.level}`);
  const params = new URLSearchParams({ get, for: where, key });
  if (within) params.set("in", within);
  const url = `${ACS_BASE}?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Census API returned HTTP ${res.status}`);
  const data = await res.json();
  const header = data[0]; const row = data[1];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  // The building-type table and the multifamily card read these fields, so
  // the live figures replace the stored ones rather than sit beside them.
  const total = num(row[idx[LIVE_VARS.totalHU]]);
  const structure_count = {};
  const structure_pct = {};
  STRUCTURE_KEYS.forEach((k, i) => {
    const c = num(row[idx[STRUCTURE_LIVE_VARS[i]]]);
    structure_count[k] = c;
    structure_pct[k] = c != null && total ? Math.round((c / total) * 1000) / 10 : null;
  });
  const mf = ["5_9", "10_19", "20p"].map((k) => structure_count[k]);
  const mfOk = mf.every((v) => v != null) && total;
  return {
    ...record,
    name: row[idx.NAME],
    totalHU: total || record.totalHU,
    structure_count,
    structure_pct,
    pct_mf: mfOk ? Math.round((structure_pct["5_9"] + structure_pct["10_19"] + structure_pct["20p"]) * 10) / 10 : null,
    mf_units: mfOk ? mf.reduce((a, b) => a + b, 0) : null,
    // Only the total and building types come from the live call; the
    // other figures keep the stored vintage in _vintage.
    _liveVintage: acsLabel("acs5", 2024),
    pct_5_9: Number(row[idx[LIVE_VARS.pct_5_9]]),
    pct_10_19: Number(row[idx[LIVE_VARS.pct_10_19]]),
    pct_20p: Number(row[idx[LIVE_VARS.pct_20p]]),
    _live: true,
  };
}

// ── dropdowns + selection ────────────────────────────────────────────────

function populateStateSelect() {
  const sel = $("state-select");
  sel.innerHTML = `<option value="${COLORADO_FIPS}">Colorado</option>`;
  sel.value = COLORADO_FIPS;
}

function populateLocalSelect(level) {
  const sel = $("local-select");
  if (level === "state") { sel.innerHTML = ""; return; }
  const list = level === "county" ? snapshot.counties : snapshot.places;
  sel.innerHTML = list.map((r) => {
    const label = (r.name || "").replace(/,\s*Colorado$/, "");
    return `<option value="${r.geoid}">${label}</option>`;
  }).join("");
}

function selectedRecord() {
  const level = $("geo-level").value;
  if (level === "state") return snapshot.state[0] || null;
  const geoid = $("local-select").value;
  if (!geoid) return null;
  const list = level === "county" ? snapshot.counties : snapshot.places;
  return list.find((r) => r.geoid === geoid) || null;
}

function selectedInventory(record) {
  if (!record || !inventory) return null;
  if (record.level === "state") return inventory.state || null;
  if (record.level === "county") return inventory.counties[record.geoid] || null;
  if (record.level === "place")  return inventory.places[record.geoid] || null;
  return null;
}

// ── renderers ────────────────────────────────────────────────────────────

function renderSummary(record, inv) {
  const grid = $("summary-grid");
  const mfShare = record.pct_mf;
  const renter = record.pct_renter;
  const burden = record.pct_renter_cost_burdened;
  const rent = record.median_gross_rent;
  const lihtc = inv && inv.lihtc ? inv.lihtc : null;

  const cards = [
    {
      label: "Total housing units",
      value: fmtNumber(record.totalHU),
      sub: record._live ? `${record._liveVintage}, Census DP04 (refreshed live)`
        : (record._vintage ? `${record._vintage}, Census DP04` : "Census DP04"),
    },
    {
      label: "Multifamily (5+ units)",
      value: fmtPct(mfShare),
      sub: record.mf_units != null
        ? `${fmtNumber(record.mf_units)} units`
        : (mfShare != null ? `${fmtNumber(Math.round(record.totalHU * (mfShare / 100)))} units` : "—"),
    },
    {
      label: "Renter share",
      value: fmtPct(renter),
      sub: record.pct_owner != null ? `${fmtPct(record.pct_owner)} owner-occupied` : "",
    },
    {
      label: "Median gross rent",
      value: fmtMoney(rent),
      sub: record.median_home_value > 0 ? `Home value ${fmtMoney(record.median_home_value)}` : "",
    },
    {
      label: "Renter cost-burdened",
      value: fmtPct(burden),
      sub: burden != null ? "30% or more of household income on rent" : "",
    },
    {
      label: "LIHTC properties",
      value: lihtc ? fmtNumber(lihtc.properties) : "—",
      sub: lihtc ? `${fmtNumber(lihtc.units)} affordable units (CHFA)` : "",
    },
  ].filter((c) => c.value !== "—");

  grid.innerHTML = cards.map((c) => `
    <div class="mf-stat">
      <div class="mf-stat__label">${c.label}</div>
      <div class="mf-stat__value">${c.value}</div>
      ${c.sub ? `<div class="mf-stat__sub">${c.sub}</div>` : ""}
    </div>
  `).join("");
}

function renderStructure(record) {
  const labels = STRUCTURE_LABELS.map(([, lbl]) => lbl);
  const data = STRUCTURE_LABELS.map(([k]) => {
    const v = record.structure_pct && record.structure_pct[k];
    return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  });
  const counts = STRUCTURE_LABELS.map(([k]) => {
    const v = record.structure_count && record.structure_count[k];
    return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  });
  // No structure counts for this geography: hide the table rather than
  // show a column of zeros.
  if (counts.every((v) => v == null)) {
    destroyChart("structure-chart");
    $("structure-table").innerHTML = `<p class="mf-empty">Building-type counts are not published for ${record.name}.</p>`;
    return;
  }

  destroyChart("structure-chart");
  // eslint-disable-next-line no-undef
  charts["structure-chart"] = new Chart($("structure-chart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: `% of housing units — ${record.name}`,
        data,
        backgroundColor: STRUCTURE_COLORS,
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => `${v}%` } },
      },
    },
  });

  const rows = STRUCTURE_LABELS.map(([k, lbl], i) => `
    <tr>
      <td>${lbl}</td>
      <td class="num">${fmtPct(data[i])}</td>
      <td class="num">${fmtNumber(counts[i])}</td>
    </tr>
  `).join("");
  const mfShare = (data[4] || 0) + (data[5] || 0) + (data[6] || 0);
  const mfUnits = (counts[4] || 0) + (counts[5] || 0) + (counts[6] || 0);
  $("structure-table").innerHTML = `
    <table class="mf-table-compact">
      <thead>
        <tr><th data-tip="Number of homes in the building (ACS units in structure).">Building type</th><th class="num" data-tip="Share of all housing units in this building type.">Share</th><th class="num" data-tip="Housing units in this building type.">Units</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="font-weight:700; border-top:2px solid var(--border,#ccc)">
          <td>Multifamily total (5+ units)</td>
          <td class="num">${fmtPct(mfShare)}</td>
          <td class="num">${fmtNumber(mfUnits)}</td>
        </tr>
      </tfoot>
    </table>
  `;
}

function renderInventory(record, inv) {
  const grid = $("inventory-grid");
  if (!inv) {
    grid.innerHTML = `<p class="mf-empty">No affordable-housing inventory for ${record.name}.</p>`;
    destroyChart("pis-chart");
    const emptyBox = $("pis-chart").parentElement;
    if (emptyBox) emptyBox.style.display = "none";
    $("lihtc-siting").innerHTML = `<p class="mf-empty">—</p>`;
    return;
  }
  const lihtc = inv.lihtc || {};
  const cards = [
    { label: "Total affordable records", value: fmtNumber(inv.total_records), sub: `${fmtNumber(inv.total_units)} units` },
    { label: "LIHTC properties", value: fmtNumber(lihtc.properties || 0), sub: `${fmtNumber(lihtc.units || 0)} units` },
    { label: "9% LIHTC", value: fmtNumber(lihtc.pct_9 || 0), sub: "Competitive credits" },
    { label: "4% LIHTC", value: fmtNumber(lihtc.pct_4 || 0), sub: "Bond + non-competitive" },
    { label: "Preservation candidates", value: fmtNumber(inv.preservation_candidates), sub: "CHFA portfolio" },
    { label: "HUD multifamily", value: fmtNumber(inv.hud_multifamily), sub: "Project-based subsidies" },
    { label: "USDA Rural Dev.", value: fmtNumber(inv.usda_rural), sub: "Section 515 / 538" },
  ];
  grid.innerHTML = cards.map((c) => `
    <div class="mf-stat">
      <div class="mf-stat__label">${c.label}</div>
      <div class="mf-stat__value">${c.value}</div>
      ${c.sub ? `<div class="mf-stat__sub">${c.sub}</div>` : ""}
    </div>
  `).join("");

  // Award-year chart. The builder fills yr_pis_distribution from the CHFA
  // feed's YR_PIS, which is AwardYear under another name — CHFA publishes
  // no placed-in-service year — so the chart is labelled an award year.
  const dist = inv.yr_pis_distribution || {};
  const decades = Object.keys(dist).sort();
  const values = decades.map((d) => dist[d]);
  destroyChart("pis-chart");
  // An empty award-year rollup hides the chart and its heading.
  const pisBox = $("pis-chart").parentElement;
  if (pisBox) pisBox.style.display = decades.length > 0 ? "" : "none";
  if (decades.length > 0) {
    // eslint-disable-next-line no-undef
    charts["pis-chart"] = new Chart($("pis-chart"), {
      type: "bar",
      data: {
        labels: decades.map((d) => `${d}s`),
        datasets: [{ label: "LIHTC projects by CHFA award year", data: values, backgroundColor: "#0b6e6d" }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  } else {
    const ctx = $("pis-chart").getContext("2d");
    ctx.clearRect(0, 0, $("pis-chart").width, $("pis-chart").height);
  }

  // QCT / DDA / Non-profit
  const lihtcTotal = lihtc.properties || 0;
  // QCT, DDA and non-profit flags are not filled in the inventory (zero
  // statewide), so those rows are left out rather than shown as 0.
  const st = (inventory && inventory.state) || {};
  const flagRow = (key, label) => {
    if (!st[key]) return "";
    const pct = lihtcTotal ? (inv[key] || 0) / lihtcTotal * 100 : null;
    return `<tr><td>${label}</td><td class="num">${fmtNumber(inv[key] || 0)}</td><td class="num">${fmtPct(pct)}</td></tr>`;
  };
  $("lihtc-siting").innerHTML = `
    <table class="mf-table-compact">
      <thead>
        <tr><th data-tip="A feature of the tax-credit properties in this area.">Characteristic</th><th class="num" data-tip="Tax-credit (LIHTC) properties with this feature (CHFA).">LIHTC count</th><th class="num" data-tip="Share of all tax-credit properties in this area.">Share</th></tr>
      </thead>
      <tbody>
        ${flagRow("qct", "In Qualified Census Tract (QCT)")}
        ${flagRow("dda", "In Difficult Development Area (DDA)")}
        ${flagRow("nonprofit", "Non-profit sponsor")}
        <tr><td>State-paired</td><td class="num">${fmtNumber(lihtc.state_paired || 0)}</td><td class="num">${fmtPct(lihtcTotal ? (lihtc.state_paired || 0) / lihtcTotal * 100 : null)}</td></tr>
        <tr><td>TOC-paired</td><td class="num">${fmtNumber(lihtc.toc_paired || 0)}</td><td class="num">${fmtPct(lihtcTotal ? (lihtc.toc_paired || 0) / lihtcTotal * 100 : null)}</td></tr>
      </tbody>
    </table>
  `;
}

function renderTenureAndBurden(record) {
  // Tenure doughnut
  destroyChart("tenure-chart");
  const renterPct = Number(record.pct_renter) || 0;
  const ownerPct = Number(record.pct_owner) || 0;
  if (renterPct + ownerPct > 0) {
    // eslint-disable-next-line no-undef
    charts["tenure-chart"] = new Chart($("tenure-chart"), {
      type: "doughnut",
      data: {
        labels: ["Renter-occupied", "Owner-occupied"],
        datasets: [{
          data: [renterPct, ownerPct],
          backgroundColor: ["#e76f51", "#4a7c8c"],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: { label: (c) => `${c.label}: ${c.parsed.toFixed(1)}%` },
          },
        },
      },
    });
  }

  // Rent burden distribution
  destroyChart("burden-chart");
  const dist = record.rent_burden_dist || {};
  if (Object.keys(dist).length > 0) {
    const data = BURDEN_LABELS.map(([k]) => Number(dist[k] || 0));
    // eslint-disable-next-line no-undef
    charts["burden-chart"] = new Chart($("burden-chart"), {
      type: "bar",
      data: {
        labels: BURDEN_LABELS.map(([, lbl]) => lbl),
        datasets: [{
          data,
          backgroundColor: BURDEN_LABELS.map(([k]) =>
            k === "30_34" || k === "35_plus" ? "#c1442f" : "#7bb8c8"
          ),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => `${v}%` } } },
      },
    });
    const burdened = record.pct_renter_cost_burdened;
    $("burden-note").textContent = burdened != null
      ? `${fmtPct(burdened)} of renter households are cost-burdened (paying 30% or more of income on rent). Source: ${record._vintage || "ACS"}, Census DP04.`
      : "GRAPI rent-burden data unavailable for this geography (often the case for the smallest places).";
  } else {
    const ctx = $("burden-chart").getContext("2d");
    ctx.clearRect(0, 0, $("burden-chart").width, $("burden-chart").height);
    $("burden-note").textContent = "Rent burden distribution not published for this geography (sample-size suppression).";
  }
}

function renderYearBuilt(record) {
  const section = $("year-built-section");
  const yb = record.year_built || {};
  if (Object.keys(yb).length === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "";
  destroyChart("year-built-chart");
  const labels = YEAR_BUILT_LABELS.map(([, lbl]) => lbl);
  const data = YEAR_BUILT_LABELS.map(([k]) => Number(yb[k] || 0));
  // eslint-disable-next-line no-undef
  charts["year-built-chart"] = new Chart($("year-built-chart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Housing units",
        data,
        backgroundColor: data.map((_, i) => i < 3 ? "#0b6e6d" : "#a0b5b5"),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => v.toLocaleString() } } },
    },
  });
}

function renderLeaderboards(record) {
  const section = $("leaderboard-section");
  if (!snapshot || record.level !== "state") {
    section.style.display = "none";
    return;
  }
  section.style.display = "";

  // Top counties by multifamily share
  const counties = (snapshot.counties || [])
    .filter((c) => Number.isFinite(Number(c.pct_mf)))
    .sort((a, b) => Number(b.pct_mf) - Number(a.pct_mf))
    .slice(0, 10);
  $("top-mf-counties").innerHTML = `
    <table class="mf-table-compact">
      <thead><tr><th data-tip="Colorado county.">County</th><th class="num" data-tip="Share of housing units in buildings of 5 or more homes, ACS 2019-2023 5-year (Census DP04).">MF share</th><th class="num" data-tip="Total housing units, ACS 2019-2023 5-year (Census DP04).">Total HU</th></tr></thead>
      <tbody>
        ${counties.map((c) => `
          <tr>
            <td>${c.name.replace(/,\s*Colorado$/, "")}</td>
            <td class="num">${fmtPct(c.pct_mf)}</td>
            <td class="num">${fmtNumber(c.totalHU)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  // Top counties by LIHTC units
  const lihtcCounties = inventory && inventory.counties
    ? Object.entries(inventory.counties)
        .map(([fips, c]) => ({ fips, ...c }))
        .filter((c) => c.lihtc && c.lihtc.units > 0)
        .sort((a, b) => b.lihtc.units - a.lihtc.units)
        .slice(0, 10)
    : [];
  const countyNameByFips = Object.fromEntries(
    (snapshot.counties || []).map((c) => [c.geoid, c.name.replace(/,\s*Colorado$/, "")])
  );
  $("top-lihtc-counties").innerHTML = lihtcCounties.length === 0
    ? `<p class="mf-empty">Inventory not loaded.</p>`
    : `
    <table class="mf-table-compact">
      <thead><tr><th data-tip="Colorado county.">County</th><th class="num" data-tip="Tax-credit (LIHTC) properties in the county (CHFA).">LIHTC props</th><th class="num" data-tip="Homes in those tax-credit properties (CHFA).">LIHTC units</th></tr></thead>
      <tbody>
        ${lihtcCounties.map((c) => `
          <tr>
            <td>${countyNameByFips[c.fips] || c.fips}</td>
            <td class="num">${fmtNumber(c.lihtc.properties)}</td>
            <td class="num">${fmtNumber(c.lihtc.units)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

let renderSeq = 0;
async function render(record) {
  const seq = ++renderSeq;
  if (record) {
    try { record = await enrich(record); } catch (_) { /* keep snapshot record */ }
    if (seq !== renderSeq) return;
  }
  if (!record) {
    $("geo-note").textContent = "Select a Colorado county or place to continue.";
    $("geo-note").style.color = "crimson";
    return;
  }
  lastSelection = record;
  const liveTag = record._live ? ` · housing units and building types refreshed live (${record._liveVintage})` : "";
  $("geo-note").innerHTML =
    `<strong>${record.name}</strong> ` +
    `<span style="opacity:.75">— ${snapshotVintageNote(record)}${liveTag}</span>`;
  $("geo-note").style.color = "";

  const inv = selectedInventory(record);
  renderSummary(record, inv);
  renderStructure(record);
  renderInventory(record, inv);
  renderTenureAndBurden(record);
  renderYearBuilt(record);
  renderLeaderboards(record);
}

// ── UI flow ──────────────────────────────────────────────────────────────

function setGeoUi() {
  const level = $("geo-level").value;
  const localSel = $("local-select");
  $("state-select").disabled = true;
  localSel.disabled = level === "state";
}

function onGeoLevelChange() {
  setGeoUi();
  populateLocalSelect($("geo-level").value);
  render(selectedRecord());
}

function onLocalChange() { render(selectedRecord()); }

async function onRefreshClick() {
  if (!lastSelection) { render(selectedRecord()); return; }
  if (!censusKey()) { render(lastSelection); return; }
  const btn = $("refresh");
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = "Refreshing live…";
  try {
    const live = await fetchLiveOne(lastSelection);
    // Merge live shares onto the cached record so other sections still render.
    render({ ...lastSelection, ...live });
  } catch (e) {
    console.warn("[multifamily] live refresh failed:", e);
    render(lastSelection);
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
}

// ── init ─────────────────────────────────────────────────────────────────

(async function init() {
  try {
    populateStateSelect();
    setGeoUi();

    $("geo-note").textContent = "Loading Colorado multifamily snapshot…";
    await loadAll();
    populateLocalSelect($("geo-level").value);

    const btn = $("refresh");
    if (btn) {
      btn.title =
        "Re-render the selected geography. Live refresh requires a Census API key.";
      btn.textContent = censusKey() ? "Refresh ↻ Live" : "Refresh ↻";
    }

    $("geo-level").addEventListener("change", onGeoLevelChange);
    $("state-select").addEventListener("change", () => render(selectedRecord()));
    $("local-select").addEventListener("change", onLocalChange);
    $("refresh").addEventListener("click", onRefreshClick);

    render(selectedRecord());
  } catch (e) {
    console.error("[multifamily] init failed:", e);
    $("geo-note").textContent =
      "The multifamily data could not be loaded. Please reload the page or try again later.";
    $("geo-note").style.color = "crimson";
  }
})();
