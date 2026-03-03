/**
 * Cloudflare Worker: Colorado county "Households vs Priced-Affordable Units by %AMI"
 *
 * Endpoint: GET /co-ami-gap
 *
 * Env vars (set as secrets in your Worker):
 * - HUD_USER_TOKEN   (required)  HUD USER API token for FMR/IL endpoints
 * - CENSUS_API_KEY   (optional)  Census API key (recommended for higher rate limits)
 *
 * Optional query params:
 * - hudYear=2025 (default 2025)
 * - acsYear=2023 (default latest stable 5-year; set explicitly)
 *
 * Caching:
 * - Uses Cloudflare Cache API for 7 days by default.
 *
 * References:
 * - HUD FMR/IL API base: https://www.huduser.gov/hudapi/public/fmr  citeturn1view0
 * - Census API ACS5 groups B19001/B25063 endpoints: https://api.census.gov/data/{year}/acs/acs5 citeturn0search6turn0search8
 */

const HUD_BASE = "https://www.huduser.gov/hudapi/public/fmr";
const CENSUS_BASE = "https://api.census.gov/data";

const DEFAULT_HUD_YEAR = 2025;
const DEFAULT_ACS_YEAR = 2023;

// %AMI bands (cumulative: <= band)
const BANDS = [30, 40, 50, 60, 70, 80, 100];

// Income bins for ACS B19001 (USD)
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

// Rent bins for ACS B25063 (monthly USD) — cash rent categories only.
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
  [2500, Infinity]
];

function jsonResponse(obj, headers = {}) {
  return new Response(JSON.stringify(obj), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=3600",
      ...headers
    }
  });
}

function overlapProportion([lo, hi], t) {
  // proportion of bin <= t assuming uniform distribution in [lo, hi)
  if (t <= lo) return 0;
  if (t >= hi) return 1;
  if (!Number.isFinite(hi)) return 1; // open-ended bin; treat as fully <= t if t is Infinity (handled above)
  const width = hi - lo;
  if (width <= 0) return 0;
  return (t - lo) / width;
}

function splitBinsToThreshold(bins, counts, thresholds) {
  // thresholds: array of numeric cutoffs (ascending). Returns cumulative counts <= each threshold.
  const out = {};
  thresholds.forEach(t => { out[String(t)] = 0; });

  for (let i = 0; i < bins.length; i++) {
    const bin = bins[i];
    const cnt = Number(counts[i] || 0);
    thresholds.forEach(t => {
      const p = overlapProportion(bin, t);
      out[String(t)] += cnt * p;
    });
  }
  return out;
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
  const keyParam = apiKey ? `&key=${encodeURIComponent(apiKey)}` : "";
  const url = `${CENSUS_BASE}/${year}/acs/acs5?get=${encodeURIComponent(vars)}&for=county:${countyFips}&in=state:08${keyParam}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Census API ${res.status} for ${url}`);
  return res.json();
}

function b19001Vars() {
  const vars = [];
  // B19001_001E is total; _002E.._017E are bins
  for (let i = 1; i <= 17; i++) vars.push(`B19001_${String(i).padStart(3, "0")}E`);
  return vars;
}

function b25063Vars() {
  const vars = [];
  // B25063_001E total, _002E no cash, _003E total cash, _004E.._024E cash bins
  for (let i = 1; i <= 24; i++) vars.push(`B25063_${String(i).padStart(3, "0")}E`);
  return vars;
}

function parseCensusRow(json) {
  const header = json[0];
  const row = json[1];
  const out = {};
  header.forEach((h, idx) => { out[h] = row[idx]; });
  return out;
}

function buildMethodology(hudYear, acsYear) {
  return [
    `Income thresholds use HUD Income Limits year ${hudYear} Area Median Income (AMI / "median_income") for 4-person households (county entity). Thresholds: 30/40/50/60/70/80/100% of AMI. Affordable monthly rent at each threshold assumes 30% of income spent on gross rent: rent = (AMI × pct × 0.30) / 12.`,
    `Households by income come from ACS ${acsYear} 5-year table B19001 (all households). ACS income bins are prorated into the AMI thresholds assuming a uniform distribution within each bin.`,
    `Priced-affordable units come from ACS ${acsYear} 5-year table B25063 (gross rent for renter-occupied units paying cash rent). Rent bins are prorated at the threshold assuming uniform distribution within each rent bin.`,
    `These are "priced-affordable" units, not guaranteed vacant/available units, and do not incorporate concessions, quality, or eligibility restrictions.`
  ];
}

async function computeCounty(county, hudYear, acsYear, hudToken, censusKey) {
  const entityid = county.fips_code; // HUD "fips_code" includes trailing 99999; use as entityid. citeturn2view0
  const il = await hudFetch(`il/data/${entityid}?year=${hudYear}`, hudToken);
  const ami = Number(il?.data?.median_income);
  if (!ami || Number.isNaN(ami)) throw new Error(`Missing AMI for ${county.county_name}`);

  const thresholdsIncome = BANDS.map(p => ami * (p / 100));
  const thresholdsRent = BANDS.map(p => pctToMonthlyRent(ami, p));
    // Census: households by income
  // Note: HUD fips_code is 10 digits like 5100199999. For CO it's "08" + county(3) + "99999".
  const countyCode = entityid.slice(2,5);
  const b190r = parseCensusRow(await censusFetchAcs5(acsYear, b19001Vars(), countyCode, censusKey));
  const hhCounts = [];
  for (let i = 2; i <= 17; i++) hhCounts.push(Number(b190r[`B19001_${String(i).padStart(3, "0")}E`] || 0));

  // Census: rent distribution
  const b250r = parseCensusRow(await censusFetchAcs5(acsYear, b25063Vars(), countyCode, censusKey));
  const rentCounts = [];
  // cash rent bins are _004.._024
  for (let i = 4; i <= 24; i++) rentCounts.push(Number(b250r[`B25063_${String(i).padStart(3, "0")}E`] || 0));

  const hhLe = {};
  const unitsLe = {};
  const gap = {};
  const coverage = {};
  const affRent = {};

  BANDS.forEach((p, idx) => {
    const incT = thresholdsIncome[idx];
    const rentT = thresholdsRent[idx];
    affRent[String(p)] = Math.round(rentT);

    // cumulative households <= incT
    let hh = 0;
    for (let i = 0; i < INCOME_BINS.length; i++) hh += hhCounts[i] * overlapProportion(INCOME_BINS[i], incT);
    // cumulative priced-affordable units <= rentT
    let un = 0;
    for (let i = 0; i < RENT_BINS.length; i++) un += rentCounts[i] * overlapProportion(RENT_BINS[i], rentT);

    hhLe[String(p)] = hh;
    unitsLe[String(p)] = un;
    gap[String(p)] = un - hh;
    coverage[String(p)] = hh > 0 ? (un / hh) : null;
  });

  return {
    fips: countyCode,
    county_name: county.county_name,
    ami_4person: ami,
    affordable_rent_monthly: affRent,
    households_le_ami_pct: Object.fromEntries(Object.entries(hhLe).map(([k,v]) => [k, Math.round(v)])),
    units_priced_affordable_le_ami_pct: Object.fromEntries(Object.entries(unitsLe).map(([k,v]) => [k, Math.round(v)])),
    gap_units_minus_households_le_ami_pct: Object.fromEntries(Object.entries(gap).map(([k,v]) => [k, Math.round(v)])),
    coverage_le_ami_pct: coverage
  };
}

function weightedStatewide(counties) {
  // renter-occupied weights not available in our calc without DP04; use households at 100% as a rough weight.
  const weights = counties.map(c => (c.households_le_ami_pct?.["100"] || 0));
  const sumW = weights.reduce((a,b) => a+b, 0) || 1;

  const agg = {
    fips: "08",
    county_name: "Colorado (statewide)",
    ami_4person: null,
    affordable_rent_monthly: {},
    households_le_ami_pct: {},
    units_priced_affordable_le_ami_pct: {},
    gap_units_minus_households_le_ami_pct: {},
    coverage_le_ami_pct: {}
  };

  BANDS.forEach(p => {
    const key = String(p);
    let hh = 0, un = 0;
    counties.forEach((c, i) => {
      const w = weights[i];
      hh += (c.households_le_ami_pct?.[key] || 0);
      un += (c.units_priced_affordable_le_ami_pct?.[key] || 0);
    });
    agg.households_le_ami_pct[key] = Math.round(hh);
    agg.units_priced_affordable_le_ami_pct[key] = Math.round(un);
    agg.gap_units_minus_households_le_ami_pct[key] = Math.round(un - hh);
    agg.coverage_le_ami_pct[key] = hh > 0 ? (un / hh) : null;
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

    const hudYear = Number(url.searchParams.get("hudYear") || DEFAULT_HUD_YEAR);
    const acsYear = Number(url.searchParams.get("acsYear") || DEFAULT_ACS_YEAR);
    const censusKey = env.CENSUS_API_KEY || null;

    // Get CO counties, updated=2025 recommended for 2025 IL dataset. citeturn1view0
    const counties = await hudFetch(`fmr/listCounties/CO?updated=2025`, hudToken);

    const results = [];
    for (const c of (counties?.data || [])) {
      try {
        results.push(await computeCounty(c, hudYear, acsYear, hudToken, censusKey));
      } catch (e) {
        results.push({ fips: c.fips_code?.slice(2,5) || null, county_name: c.county_name, error: String(e.message || e) });
      }
    }

    const okCounties = results.filter(r => !r.error);
    const payload = {
      meta: {
        state: "CO",
        hud_income_limits_year: hudYear,
        acs_year: acsYear,
        generated_at: new Date().toISOString().slice(0, 10)
      },
      bands: BANDS,
      statewide: weightedStatewide(okCounties),
      counties: okCounties,
      methodology: buildMethodology(hudYear, acsYear),
      sources: [
        { name: "HUD USER FMR/IL API", note: "Income Limits (AMI/median_income) by county entityid via /il/data/{entityid}", url: "https://www.huduser.gov/portal/dataset/fmr-api.html" },
        { name: "Census API ACS 5-year", note: "B19001 household income, B25063 gross rent", url: "https://api.census.gov/data.html" }
      ]
    };

    const response = jsonResponse(payload, { "cache-control": "public, max-age=86400" });
    // cache for 7 days at edge
    ctx.waitUntil(cache.put(cacheKey, response.clone(), { expirationTtl: 60 * 60 * 24 * 7 }));
    return response;
  }
};
