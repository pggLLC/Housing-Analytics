// Census Multifamily Dashboard (ACS DP04)
//
// Renders the share of housing units in 5–9, 10–19, and 20+ unit structures
// for Colorado statewide, by county, or by city/place.
//
// Architecture (post-F86): cache-first.
//   • Default: load data/census-multifamily-co.json — a snapshot built at
//     CI time from the ACS 5-year DP04 release (or derived from the HNA
//     summary cache when no CENSUS_API_KEY is available).
//   • Optional live refresh: when the user has stored a Census API key in
//     localStorage (Data Quality Dashboard), clicking "Refresh ↻ Live"
//     re-fetches a single geography from api.census.gov directly. Without
//     a key, the live API returns 302→missing_key.html, which the browser
//     surfaces as "TypeError: Failed to fetch" (CORS-blocked redirect).
//
// DP04 fields (current/post-2018 indexing):
//   DP04_0001E  Total housing units
//   DP04_0011PE % housing units in 5–9-unit structures
//   DP04_0012PE % housing units in 10–19-unit structures
//   DP04_0013PE % housing units in 20+-unit structures

const SNAPSHOT_PATH = "data/census-multifamily-co.json";
const ACS_BASE = "https://api.census.gov/data/2023/acs/acs5/profile";
const LIVE_VARS = {
  totalHU: "DP04_0001E",
  pct_5_9: "DP04_0011PE",
  pct_10_19: "DP04_0012PE",
  pct_20p: "DP04_0013PE",
};
const COLORADO_FIPS = "08";

let chart;
let snapshot = null;          // entire snapshot payload {meta, state, counties, places}
let lastSelection = null;     // the last rendered record (for live-refresh substitution)

function $(id) {
  return document.getElementById(id);
}

function censusKey() {
  return window.APP_CONFIG && window.APP_CONFIG.CENSUS_API_KEY
    ? window.APP_CONFIG.CENSUS_API_KEY
    : "";
}

function fmtNumber(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return x == null ? "—" : String(x);
  return n.toLocaleString();
}

function fmtPct(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

// ── Snapshot loader ──────────────────────────────────────────────────────

async function loadSnapshot() {
  if (snapshot) return snapshot;
  const loader = (typeof window.DataService !== "undefined" && window.DataService.getJSON)
    ? () => window.DataService.getJSON(SNAPSHOT_PATH, { cache: "no-store" })
    : async () => {
        const res = await fetch(SNAPSHOT_PATH, { cache: "no-store" });
        if (!res.ok) throw new Error(`Snapshot fetch failed: HTTP ${res.status}`);
        return res.json();
      };
  snapshot = await loader();
  return snapshot;
}

function snapshotVintageNote() {
  if (!snapshot || !snapshot.meta) return "";
  const pulled = (snapshot.meta.pulled_at_utc || "").slice(0, 10);
  const mode = snapshot.meta.mode || "snapshot";
  const year = snapshot.meta.acs_year || "";
  const tag = mode === "live" ? "Live API snapshot" : "Cached snapshot";
  return `${tag} · ACS ${year} 5-year DP04 · pulled ${pulled || "unknown"}`;
}

// ── Live-refresh (optional, requires Census API key) ─────────────────────

async function fetchLiveOne(record) {
  const key = censusKey();
  if (!key) {
    throw new Error(
      "Live refresh requires a Census API key. Add one in the Data Quality " +
      "Dashboard (free signup: https://api.census.gov/data/key_signup.html), " +
      "or use the cached snapshot — it covers all CO geographies."
    );
  }
  const get = `NAME,${Object.values(LIVE_VARS).join(",")}`;
  let where, within;
  if (record.level === "state") {
    where = `state:${COLORADO_FIPS}`;
  } else if (record.level === "county") {
    where = `county:${record.geoid.slice(2)}`;
    within = `state:${COLORADO_FIPS}`;
  } else if (record.level === "place") {
    where = `place:${record.geoid.slice(2)}`;
    within = `state:${COLORADO_FIPS}`;
  } else {
    throw new Error(`Unknown level: ${record.level}`);
  }
  const params = new URLSearchParams({ get, for: where, key });
  if (within) params.set("in", within);
  const url = `${ACS_BASE}?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Census API returned HTTP ${res.status}`);
  }
  const data = await res.json();
  const header = data[0];
  const row = data[1];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return {
    ...record,
    name: row[idx.NAME],
    totalHU: Number(row[idx[LIVE_VARS.totalHU]]) || record.totalHU,
    pct_5_9: Number(row[idx[LIVE_VARS.pct_5_9]]),
    pct_10_19: Number(row[idx[LIVE_VARS.pct_10_19]]),
    pct_20p: Number(row[idx[LIVE_VARS.pct_20p]]),
    pct_mf: null,
    _live: true,
  };
}

// ── Dropdown population ──────────────────────────────────────────────────

function populateStateSelect() {
  const sel = $("state-select");
  sel.innerHTML = `<option value="${COLORADO_FIPS}">Colorado</option>`;
  sel.value = COLORADO_FIPS;
}

function populateLocalSelect(level) {
  const sel = $("local-select");
  if (level === "state") {
    sel.innerHTML = "";
    return;
  }
  const list = level === "county" ? snapshot.counties : snapshot.places;
  // Strip the trailing ", Colorado" for compact display.
  sel.innerHTML = list
    .map((r) => {
      const label = (r.name || "").replace(/,\s*Colorado$/, "");
      return `<option value="${r.geoid}">${label}</option>`;
    })
    .join("");
}

function selectedRecord() {
  const level = $("geo-level").value;
  if (level === "state") return snapshot.state[0] || null;
  const geoid = $("local-select").value;
  if (!geoid) return null;
  const list = level === "county" ? snapshot.counties : snapshot.places;
  return list.find((r) => r.geoid === geoid) || null;
}

// ── Renderers ────────────────────────────────────────────────────────────

function renderShareChart(record) {
  const ctx = $("mf-share");
  const labels = ["5–9 units", "10–19 units", "20+ units"];
  const data = [record.pct_5_9, record.pct_10_19, record.pct_20p].map((v) =>
    Number.isFinite(Number(v)) ? Number(v) : 0
  );

  if (chart) chart.destroy();
  // eslint-disable-next-line no-undef
  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: `% of housing units – ${record.name}`, data }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => `${v}%` } },
      },
    },
  });

  const totalMf =
    [record.pct_5_9, record.pct_10_19, record.pct_20p]
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v))
      .reduce((a, b) => a + b, 0);

  $("mf-table").innerHTML = `
    <table style="width:100%; border-collapse:collapse;">
      <thead><tr><th align="left">Category</th><th align="left">Share</th></tr></thead>
      <tbody>
        <tr><td>5–9 units</td><td>${fmtPct(record.pct_5_9)}</td></tr>
        <tr><td>10–19 units</td><td>${fmtPct(record.pct_10_19)}</td></tr>
        <tr><td>20+ units</td><td>${fmtPct(record.pct_20p)}</td></tr>
        <tr style="border-top:1px solid var(--border, #ccc); font-weight:600;">
          <td>Multifamily total (5+ units)</td><td>${fmtPct(totalMf)}</td>
        </tr>
      </tbody>
    </table>
  `;
}

function render(record) {
  if (!record) {
    $("geo-note").textContent = "Select a Colorado county or place to continue.";
    $("geo-note").style.color = "crimson";
    return;
  }
  lastSelection = record;
  const liveTag = record._live ? " · refreshed live" : "";
  $("geo-note").innerHTML =
    `<strong>${record.name}</strong> ` +
    `<span style="opacity:.75">— ${snapshotVintageNote()}${liveTag}</span>`;
  $("geo-note").style.color = "";
  $("hu").textContent = fmtNumber(record.totalHU);
  $("hu-meta").textContent = "Total housing units (estimate)";
  renderShareChart(record);
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

function onLocalChange() {
  render(selectedRecord());
}

async function onRefreshClick() {
  // If the user has a Census key, do a live single-geography refresh.
  // Otherwise just re-render from the cached snapshot.
  if (!lastSelection) {
    render(selectedRecord());
    return;
  }
  if (!censusKey()) {
    render(lastSelection);
    return;
  }
  const btn = $("refresh");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Refreshing live…";
  try {
    const live = await fetchLiveOne(lastSelection);
    render(live);
  } catch (e) {
    console.warn("[census-multifamily] live refresh failed:", e);
    $("geo-note").innerHTML =
      `<strong>${lastSelection.name}</strong> ` +
      `<span style="opacity:.75">— ${snapshotVintageNote()}</span>` +
      `<br><span style="color:crimson">Live refresh failed: ${e.message}. ` +
      `Showing cached snapshot.</span>`;
    render(lastSelection);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ── Init ─────────────────────────────────────────────────────────────────

(async function init() {
  try {
    populateStateSelect();
    setGeoUi();

    $("geo-note").textContent = "Loading Colorado multifamily snapshot…";
    await loadSnapshot();
    populateLocalSelect($("geo-level").value);

    // Re-label the Refresh button so the cache-first behavior is obvious.
    const btn = $("refresh");
    if (btn) {
      btn.title =
        "Re-render the selected geography. Live refresh requires a Census API key " +
        "(add one in Data Quality Dashboard).";
      btn.textContent = censusKey() ? "Refresh ↻ Live" : "Refresh ↻";
    }

    $("geo-level").addEventListener("change", onGeoLevelChange);
    $("state-select").addEventListener("change", () => render(selectedRecord()));
    $("local-select").addEventListener("change", onLocalChange);
    $("refresh").addEventListener("click", onRefreshClick);

    render(selectedRecord());
  } catch (e) {
    console.error("[census-multifamily] init failed:", e);
    $("geo-note").textContent =
      `Error loading multifamily snapshot: ${e.message}. ` +
      `Check that data/census-multifamily-co.json is deployed.`;
    $("geo-note").style.color = "crimson";
  }
})();
