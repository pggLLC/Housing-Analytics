/**
 * Cloudflare Worker: Colorado county "Renter Households vs Priced-Affordable Units by %AMI"
 *
 * Endpoint: GET /co-ami-gap
 *
 * Env vars (set as secrets in your Worker):
 * - HUD_USER_TOKEN   (required)  HUD USER API token for FMR/IL endpoints
 * - CENSUS_API_KEY   (required)  Census API key — the Census API rejects keyless requests
 *
 * Optional query params:
 * - hudYear=2025 (default 2025)
 * - acsYear=2024 (default latest stable 5-year; set explicitly)
 *
 * Caching:
 * - Uses Cloudflare Cache API for 7 days by default.
 *
 * Methodology v2 (2026-07): the gap's demand side is RENTER households
 * (ACS B25118, Tenure × Household Income), matching professional HNA
 * practice. v1 used ALL households (B19001) against renter-only supply,
 * which structurally inflated gaps ~2.5-4x. The all-tenure series is
 * retained as all_households_le_ami_pct. Output mirrors the schema of
 * data/co_ami_gap_by_county.json.
 *
 * References:
 * - HUD FMR/IL API base: https://www.huduser.gov/hudapi/public/fmr
 * - Census API ACS5 tables B25118/B19001/B25063: https://api.census.gov/data/{year}/acs/acs5
 */

const HUD_BASE = "https://www.huduser.gov/hudapi/public/fmr";
const CENSUS_BASE = "https://api.census.gov/data";

const DEFAULT_HUD_YEAR = 2025;
const DEFAULT_ACS_YEAR = 2024;

const METHODOLOGY_VERSION = 2;

// %AMI bands (cumulative: <= band)
const BANDS = [30, 40, 50, 60, 70, 80, 100];

// Renter-household income bins for ACS B25118 (USD) — vars _015E.._025E;
// _014E is the renter-household total. Demand side of the gap since v2.
const RENTER_INCOME_BINS = [
  [0, 5000],
  [5000, 10000],
  [10000, 15000],
  [15000, 20000],
  [20000, 25000],
  [25000, 35000],
  [35000, 50000],
  [50000, 75000],
  [75000, 100000],
  [100000, 150000],
  [150000, Infinity]
];
const B25118_RENTER_TOTAL = "B25118_014E";

// All-tenure income bins for ACS B19001 (USD) — legacy series only since v2.
const INCOME_BINS = [
  [0, 10000],
  [10000, 15000],
  [15000, 20000],
  [20000, 25000],
  [25000, 30000],
  [30000, 35000],
  [35000, 40000],
  [40000, 45000],
  [45000, 50000],
  [50000, 60000],
  [60000, 75000],
  [75000, 100000],
  [100000, 125000],
  [125000, 150000],
  [150000, 200000],
  [200000, Infinity]
];

// Rent bins for ACS B25063 (monthly USD) — cash rent categories only,
// vars _003E ("Less than $100") .. _026E ("$3,500 or more"). v1 mapped
// _004E.._024E onto bins starting at [0,100), an off-by-one that shifted
// every rent count one bin down.
const RENT_BINS = [
  [0, 100],
  [100, 150],
  [150, 200],
  [200, 250],
  [250, 300],
  [300, 350],
  [350, 400],
  [400, 450],
  [450, 500],
  [500, 550],
  [550, 600],
  [600, 650],
  [650, 700],
  [700, 750],
  [750, 800],
  [800, 900],
  [900, 1000],
  [1000, 1250],
  [1250, 1500],
  [1500, 2000],
  [2000, 2500],
  [2500, 3000],
  [3000, 3500],
  [3500, Infinity]
];

// Default to the production GitHub Pages origin instead of wildcard.
// Override per-call by passing { "access-control-allow-origin": "..." } in headers.
const DEFAULT_CORS_ORIGIN = "https://pggllc.github.io";

function jsonResponse(obj, headers = {}) {
  return new Response(JSON.stringify(obj), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": DEFAULT_CORS_ORIGIN,
      "vary": "Origin",
      "cache-control": "public, max-age=3600",
      ...headers
    }
  });
}

function overlapProportion([lo, hi], t) {
  // proportion of bin <= t assuming uniform distribution in [lo, hi)
  if (t <= lo) return 0;
  if (!Number.isFinite(hi)) {
    // Open-ended top bin: 2×-floor virtual upper edge (matches
    // scripts/hna/build_place_ami_gap.py; never binds at tiers <= 100% AMI).
    const virtualHi = lo * 2;
    return Math.min(1, (t - lo) / (virtualHi - lo));
  }
  if (t >= hi) return 1;
  const width = hi - lo;
  if (width <= 0) return 0;
  return (t - lo) / width;
}

function cumulativeAtThreshold(bins, counts, t) {
  let sum = 0;
  for (let i = 0; i < bins.length; i++) {
    sum += Number(counts[i] || 0) * overlapProportion(bins[i], t);
  }
  return sum;
}

function pctToMonthlyRent(ami, pct) {
  return (ami * (pct / 100) * 0.30) / 12.0;
}

async function hudFetch(path, token) {
  const url = `${HUD_BASE}/${path}`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }});
  if (!res.ok) throw new Error(`HUD API ${res.status} for ${path}`);
  return res.json();
}

async function censusFetchAcs5(year, variables, countyFips, apiKey) {
  const vars = variables.join(",");
  const url = `${CENSUS_BASE}/${year}/acs/acs5?get=${encodeURIComponent(vars)}&for=county:${countyFips}&in=state:08&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Census API ${res.status} for ${url}`);
  return res.json();
}

function seqVars(table, from, to) {
  const vars = [];
  for (let i = from; i <= to; i++) vars.push(`${table}_${String(i).padStart(3, "0")}E`);
  return vars;
}

function parseCensusRow(json) {
  const header = json[0];
  const row = json[1];
  const out = {};
  header.forEach((h, idx) => { out[h] = row[idx]; });
  return out;
}

function pickCounts(row, table, from, to) {
  const counts = [];
  for (let i = from; i <= to; i++) counts.push(Number(row[`${table}_${String(i).padStart(3, "0")}E`] || 0));
  return counts;
}

function buildMethodology(hudYear, acsYear) {
  return [
    `Methodology v2 (2026-07): the gap's demand side is RENTER households (ACS ${acsYear} 5-year table B25118, Tenure × Household Income) at or below each income threshold — matching professional HNA practice (renter households vs rental units). v1 used ALL households (B19001, owners included) against renter-only supply, which structurally inflated gaps ~2.5-4x. The all-tenure series is retained as all_households_le_ami_pct.`,
    `Income thresholds use HUD Income Limits year ${hudYear} Area Median Income (AMI / "median_income") for 4-person households (county entity). Thresholds: 30/40/50/60/70/80/100% of AMI. Affordable monthly rent at each threshold assumes 30% of income spent on gross rent: rent = (AMI × pct × 0.30) / 12.`,
    `Priced-affordable units come from ACS ${acsYear} 5-year table B25063 (gross rent for renter-occupied units paying cash rent). Rent bins are prorated at the threshold assuming uniform distribution within each rent bin.`,
    `Gap = units minus renter households at each threshold (negative = deficit).`,
    `These are "priced-affordable" units, not guaranteed vacant/available units, and do not incorporate concessions, quality, or eligibility restrictions.`
  ];
}

async function computeCounty(county, hudYear, acsYear, hudToken, censusKey) {
  const entityid = county.fips_code; // HUD "fips_code" includes trailing 99999; use as entityid.
  const il = await hudFetch(`il/data/${entityid}?year=${hudYear}`, hudToken);
  const ami = Number(il?.data?.median_income);
  if (!ami || Number.isNaN(ami)) throw new Error(`Missing AMI for ${county.county_name}`);

  // Note: HUD fips_code is 10 digits like 0800199999. For CO it's "08" + county(3) + "99999".
  const countyCode = entityid.slice(2,5);

  // Census: renter households by income (v2 demand side)
  const b251r = parseCensusRow(await censusFetchAcs5(acsYear, seqVars("B25118", 14, 25), countyCode, censusKey));
  const renterCounts = pickCounts(b251r, "B25118", 15, 25);
  const renterTotal = Number(b251r[B25118_RENTER_TOTAL] || 0);

  // Census: all households by income (legacy series)
  const b190r = parseCensusRow(await censusFetchAcs5(acsYear, seqVars("B19001", 1, 17), countyCode, censusKey));
  const hhCounts = pickCounts(b190r, "B19001", 2, 17);

  // Census: rent distribution (cash rent bins are _003.._026)
  const b250r = parseCensusRow(await censusFetchAcs5(acsYear, seqVars("B25063", 1, 26), countyCode, censusKey));
  const rentCounts = pickCounts(b250r, "B25063", 3, 26);

  const hhLe = {};
  const allHhLe = {};
  const unitsLe = {};
  const gap = {};
  const coverage = {};
  const affRent = {};

  BANDS.forEach((p) => {
    const incT = ami * (p / 100);
    const rentT = pctToMonthlyRent(ami, p);
    const key = String(p);
    affRent[key] = Math.round(rentT);

    const hh = cumulativeAtThreshold(RENTER_INCOME_BINS, renterCounts, incT);
    const allHh = cumulativeAtThreshold(INCOME_BINS, hhCounts, incT);
    const un = cumulativeAtThreshold(RENT_BINS, rentCounts, rentT);

    hhLe[key] = Math.round(hh);
    allHhLe[key] = Math.round(allHh);
    unitsLe[key] = Math.round(un);
    gap[key] = Math.round(un) - Math.round(hh);
    coverage[key] = hh > 0 ? Number((un / hh).toFixed(4)) : null;
  });

  return {
    fips: `08${countyCode}`,
    county_name: county.county_name,
    ami_4person: ami,
    affordable_rent_monthly: affRent,
    households_le_ami_pct: hhLe,
    all_households_le_ami_pct: allHhLe,
    renter_households_total: renterTotal,
    units_priced_affordable_le_ami_pct: unitsLe,
    gap_units_minus_households_le_ami_pct: gap,
    coverage_le_ami_pct: coverage,
    demand_tenure: "renter"
  };
}

function statewideAgg(counties) {
  const agg = {
    fips: "08",
    county_name: "Colorado (statewide)",
    ami_4person: null,
    affordable_rent_monthly: {},
    households_le_ami_pct: {},
    all_households_le_ami_pct: {},
    renter_households_total: counties.reduce((s,c) => s + (c.renter_households_total || 0), 0),
    units_priced_affordable_le_ami_pct: {},
    gap_units_minus_households_le_ami_pct: {},
    coverage_le_ami_pct: {},
    demand_tenure: "renter"
  };

  BANDS.forEach(p => {
    const key = String(p);
    let hh = 0, allHh = 0, un = 0;
    counties.forEach((c) => {
      hh += (c.households_le_ami_pct?.[key] || 0);
      allHh += (c.all_households_le_ami_pct?.[key] || 0);
      un += (c.units_priced_affordable_le_ami_pct?.[key] || 0);
    });
    agg.households_le_ami_pct[key] = Math.round(hh);
    agg.all_households_le_ami_pct[key] = Math.round(allHh);
    agg.units_priced_affordable_le_ami_pct[key] = Math.round(un);
    agg.gap_units_minus_households_le_ami_pct[key] = Math.round(un - hh);
    agg.coverage_le_ami_pct[key] = hh > 0 ? Number((un / hh).toFixed(4)) : null;
  });

  return agg;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/co-ami-gap") {
      return new Response("Not Found", { status: 404 });
    }

    const cacheKey = new Request(url.toString(), request);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const hudToken = env.HUD_USER_TOKEN;
    if (!hudToken) return jsonResponse({ error: "Missing HUD_USER_TOKEN secret" }, { "cache-control": "no-store" });
    // The Census API rejects keyless requests, so the key is required.
    const censusKey = env.CENSUS_API_KEY;
    if (!censusKey) return jsonResponse({ error: "Missing CENSUS_API_KEY secret" }, { "cache-control": "no-store" });

    const hudYear = Number(url.searchParams.get("hudYear") || DEFAULT_HUD_YEAR);
    const acsYear = Number(url.searchParams.get("acsYear") || DEFAULT_ACS_YEAR);

    // Get CO counties, updated=2025 recommended for 2025 IL dataset.
    const counties = await hudFetch(`fmr/listCounties/CO?updated=2025`, hudToken);

    const results = [];
    for (const c of (counties?.data || [])) {
      try {
        results.push(await computeCounty(c, hudYear, acsYear, hudToken, censusKey));
      } catch (e) {
        results.push({ fips: c.fips_code ? `08${c.fips_code.slice(2,5)}` : null, county_name: c.county_name, error: String(e.message || e) });
      }
    }

    const okCounties = results.filter(r => !r.error);
    const payload = {
      meta: {
        state: "CO",
        hud_income_limits_year: hudYear,
        acs_year: acsYear,
        generated_at: new Date().toISOString().slice(0, 10),
        methodology_version: METHODOLOGY_VERSION,
        demand_tenure: "renter"
      },
      bands: BANDS.map(String),
      statewide: statewideAgg(okCounties),
      counties: okCounties,
      methodology: buildMethodology(hudYear, acsYear),
      sources: [
        { name: "HUD USER FMR/IL API", note: "Income Limits (AMI/median_income) by county entityid via /il/data/{entityid}", url: "https://www.huduser.gov/portal/dataset/fmr-api.html" },
        { name: "Census API ACS 5-year", note: "B25118 tenure × household income (demand side), B25063 gross rent (supply side), B19001 household income (legacy all-tenure series)", url: "https://api.census.gov/data.html" }
      ]
    };

    const response = jsonResponse(payload, { "cache-control": "public, max-age=86400" });
    // cache for 7 days at edge
    ctx.waitUntil(cache.put(cacheKey, response.clone(), { expirationTtl: 60 * 60 * 24 * 7 }));
    return response;
  }
};
