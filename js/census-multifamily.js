// Census Multifamily Dashboard (ACS DP04)
// Uses ACS 1-year profile (latest available year in this file) and Census geoinfo endpoints
// Variables (ACS DP04):
// - DP04_0001E: Total housing units (estimate)
// - DP04_0011PE: % housing units in 5 to 9 units
// - DP04_0012PE: % housing units in 10 to 19 units
// - DP04_0013PE: % housing units in 20 or more units
//
// Sources:
// - DP04 variables list: https://api.census.gov/data/2024/acs/acs1/profile/groups/DP04.html
// - Geography tutorial / examples: https://www.census.gov/data/developers/geography/geography-tutorial.html
// - geoinfo examples: https://api.census.gov/data/2024/geoinfo/examples.html

const ACS_YEAR = 2024;
const ACS_BASE = `https://api.census.gov/data/${ACS_YEAR}/acs/acs1/profile`;
const GEOINFO_BASE = `https://api.census.gov/data/${ACS_YEAR}/geoinfo`;

const VARS = {
  totalHU: "DP04_0001E",
  pct_5_9: "DP04_0011PE",
  pct_10_19: "DP04_0012PE",
  pct_20p: "DP04_0013PE"
};

let chart;

function $(id){ return document.getElementById(id); }

function fmtNumber(x){
  const n = Number(x);
  if (!Number.isFinite(n)) return x;
  return n.toLocaleString();
}
function fmtPct(x){
  const n = Number(x);
  if (!Number.isFinite(n)) return x;
  return `${n.toFixed(1)}%`;
}

async function fetchJson(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Census API error: ${res.status}`);
  return await res.json();
}

async function loadStates(){
  // NAME + state FIPS
  const url = `${GEOINFO_BASE}?get=NAME&for=state:*`;
  const data = await fetchJson(url);
  const rows = data.slice(1).map(r => ({ name: r[0], state: r[1] }))
    .sort((a,b)=>a.name.localeCompare(b.name));

  const sel = $("state-select");
  sel.innerHTML = rows.map(r => `<option value="${r.state}">${r.name}</option>`).join("");
}

async function loadCounties(stateFips){
  const url = `${GEOINFO_BASE}?get=NAME&for=county:*&in=state:${stateFips}`;
  const data = await fetchJson(url);
  const rows = data.slice(1).map(r => ({ name: r[0], county: r[1] }))
    .sort((a,b)=>a.name.localeCompare(b.name));
  const sel = $("local-select");
  sel.innerHTML = rows.map(r => `<option value="${r.county}">${r.name}</option>`).join("");
}

async function loadPlaces(stateFips){
  const url = `${GEOINFO_BASE}?get=NAME&for=place:*&in=state:${stateFips}`;
  const data = await fetchJson(url);
  const rows = data.slice(1).map(r => ({ name: r[0], place: r[1] }))
    .sort((a,b)=>a.name.localeCompare(b.name));
  const sel = $("local-select");
  sel.innerHTML = rows.map(r => `<option value="${r.place}">${r.name}</option>`).join("");
}

function buildAcsUrl({ level, state, local }){
  const get = `NAME,${VARS.totalHU},${VARS.pct_5_9},${VARS.pct_10_19},${VARS.pct_20p}`;

  if (level === "us") {
    return `${ACS_BASE}?get=${encodeURIComponent(get)}&for=us:1`;
  }
  if (level === "state") {
    return `${ACS_BASE}?get=${encodeURIComponent(get)}&for=state:${state}`;
  }
  if (level === "county") {
    return `${ACS_BASE}?get=${encodeURIComponent(get)}&for=county:${local}&in=state:${state}`;
  }
  if (level === "place") {
    return `${ACS_BASE}?get=${encodeURIComponent(get)}&for=place:${local}&in=state:${state}`;
  }
  throw new Error("Unknown geography level");
}

function renderShareChart(name, p1, p2, p3){
  const ctx = $("mf-share");
  const labels = ["5–9 units", "10–19 units", "20+ units"];
  const data = [p1, p2, p3].map(v => Number(v));

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: `% of housing units – ${name}`, data }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v)=>`${v}%` } }
      }
    }
  });

  $("mf-table").innerHTML = `
    <table style="width:100%; border-collapse:collapse;">
      <thead><tr><th align="left">Category</th><th align="left">Share</th></tr></thead>
      <tbody>
        <tr><td>5–9 units</td><td>${fmtPct(p1)}</td></tr>
        <tr><td>10–19 units</td><td>${fmtPct(p2)}</td></tr>
        <tr><td>20+ units</td><td>${fmtPct(p3)}</td></tr>
      </tbody>
    </table>
  `;
}

async function refresh(){
  const level = $("geo-level").value;
  const state = $("state-select").value;
  const local = $("local-select").value;

  $("geo-note").textContent = "Loading…";

  const url = buildAcsUrl({ level, state, local });
  const data = await fetchJson(url);

  const header = data[0];
  const row = data[1];
  const idx = Object.fromEntries(header.map((h,i)=>[h,i]));

  const name = row[idx["NAME"]];
  const totalHU = row[idx[VARS.totalHU]];
  const p1 = row[idx[VARS.pct_5_9]];
  const p2 = row[idx[VARS.pct_10_19]];
  const p3 = row[idx[VARS.pct_20p]];

  $("geo-note").textContent = `Selected: ${name} (ACS ${ACS_YEAR} 1-year, DP04)`;
  $("hu").textContent = fmtNumber(totalHU);
  $("hu-meta").textContent = "Total housing units (estimate)";

  renderShareChart(name, p1, p2, p3);
}

function setGeoUi(){
  const level = $("geo-level").value;
  const stateSel = $("state-select");
  const localSel = $("local-select");

  if (level === "us") {
    stateSel.disabled = true;
    localSel.disabled = true;
    return;
  }

  stateSel.disabled = false;

  if (level === "state") {
    localSel.disabled = true;
  } else {
    localSel.disabled = false;
  }
}

async function onGeoChange(){
  const level = $("geo-level").value;
  setGeoUi();

  if (level === "us") return refresh();

  const state = $("state-select").value;
  if (level === "state") return refresh();

  if (level === "county") {
    await loadCounties(state);
    return refresh();
  }

  if (level === "place") {
    await loadPlaces(state);
    return refresh();
  }
}

(async function init(){
  try{
    await loadStates();
    setGeoUi();

    $("geo-level").addEventListener("change", onGeoChange);
    $("state-select").addEventListener("change", onGeoChange);
    $("local-select").addEventListener("change", refresh);
    $("refresh").addEventListener("click", refresh);

    // Initialize local list for default (us)
    await refresh();
  } catch(e){
    console.error(e);
    $("geo-note").textContent = e.message;
    $("geo-note").style.color = "crimson";
  }
})();
