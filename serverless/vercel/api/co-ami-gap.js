// Vercel Serverless Function (Node.js) - /api/co-ami-gap
//
// Set environment variables in Vercel:
// - HUD_USER_TOKEN (required)
// - CENSUS_API_KEY (required — the Census API rejects keyless requests)
//
// Query params: hudYear=2025, acsYear=2024
//
// Returns JSON compatible with /js/co-ami-gap.js front-end module and
// mirroring the schema of data/co_ami_gap_by_county.json (methodology v2).
//
// Methodology v2 (2026-07): the gap's demand side is RENTER households
// (ACS B25118, Tenure × Household Income), matching professional HNA
// practice. v1 used ALL households (B19001) against renter-only supply,
// which structurally inflated gaps ~2.5-4x. The all-tenure series is
// retained as all_households_le_ami_pct.
//
// Sources:
// - HUD FMR/IL API docs: https://www.huduser.gov/portal/dataset/fmr-api.html
// - ACS API tables: B25118 (tenure × income), B19001 (household income), B25063 (gross rent)

const HUD_BASE = "https://www.huduser.gov/hudapi/public/fmr";
const CENSUS_BASE = "https://api.census.gov/data";

const DEFAULT_HUD_YEAR = 2025;
const DEFAULT_ACS_YEAR = 2024;
const BANDS = [30, 40, 50, 60, 70, 80, 100];
const METHODOLOGY_VERSION = 2;

// ACS B25118 renter-household income bins (vars _015E.._025E; _014E is the
// renter total). Demand side of the gap since methodology v2.
const RENTER_INCOME_BINS = [
  [0,5000],[5000,10000],[10000,15000],[15000,20000],[20000,25000],
  [25000,35000],[35000,50000],[50000,75000],[75000,100000],[100000,150000],
  [150000,Infinity]
];
const B25118_RENTER_TOTAL = "B25118_014E";

// ACS B19001 all-tenure income bins (vars _002E.._017E). Legacy series only.
const INCOME_BINS = [
  [0, 10000],[10000,15000],[15000,20000],[20000,25000],[25000,30000],[30000,35000],
  [35000,40000],[40000,45000],[45000,50000],[50000,60000],[60000,75000],[75000,100000],
  [100000,125000],[125000,150000],[150000,200000],[200000,Infinity]
];

// ACS B25063 gross-rent bins, cash rent only (vars _003E.._026E; _003E is
// "Less than $100"). v1 mapped _004E.._024E onto bins starting at [0,100),
// an off-by-one that shifted every rent count one bin down.
const RENT_BINS = [
  [0,100],[100,150],[150,200],[200,250],[250,300],[300,350],[350,400],[400,450],[450,500],
  [500,550],[550,600],[600,650],[650,700],[700,750],[750,800],[800,900],[900,1000],
  [1000,1250],[1250,1500],[1500,2000],[2000,2500],[2500,3000],[3000,3500],[3500,Infinity]
];

function overlapProportion([lo, hi], t) {
  if (t <= lo) return 0;
  if (!Number.isFinite(hi)) {
    // Open-ended top bin: 2×-floor virtual upper edge (matches
    // scripts/hna/build_place_ami_gap.py; never binds at tiers <= 100% AMI).
    const virtualHi = lo * 2;
    return Math.min(1, (t - lo) / (virtualHi - lo));
  }
  if (t >= hi) return 1;
  const w = hi - lo;
  return w > 0 ? (t - lo) / w : 0;
}

function cumulativeAtThreshold(bins, counts, t) {
  let sum = 0;
  for (let i = 0; i < bins.length; i++) sum += (counts[i] || 0) * overlapProportion(bins[i], t);
  return sum;
}

function pctToMonthlyRent(ami, pct) {
  return (ami * (pct / 100) * 0.30) / 12.0;
}

async function hudFetch(path, token) {
  const res = await fetch(`${HUD_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  if (!res.ok) throw new Error(`HUD API ${res.status} for ${path}`);
  return res.json();
}

async function censusFetchAcs5(year, variables, countyCode, apiKey) {
  const vars = variables.join(",");
  const url = `${CENSUS_BASE}/${year}/acs/acs5?get=${encodeURIComponent(vars)}&for=county:${countyCode}&in=state:08&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Census API ${res.status}`);
  return res.json();
}

function seqVars(table, from, to) {
  const vars = [];
  for (let i = from; i <= to; i++) vars.push(`${table}_${String(i).padStart(3,"0")}E`);
  return vars;
}
function parseRow(json) {
  const header = json[0], row = json[1];
  const out = {};
  header.forEach((h,i)=> out[h]=row[i]);
  return out;
}
function pickCounts(row, table, from, to) {
  const counts = [];
  for (let i = from; i <= to; i++) counts.push(Number(row[`${table}_${String(i).padStart(3,"0")}E`] || 0));
  return counts;
}

function buildMethodology(hudYear, acsYear) {
  return [
    `Methodology v2 (2026-07): the gap's demand side is RENTER households (ACS ${acsYear} 5-year table B25118, Tenure × Household Income) at or below each income threshold — matching professional HNA practice. v1 used ALL households (B19001, owners included) against renter-only supply, which structurally inflated gaps ~2.5-4x. The all-tenure series is retained as all_households_le_ami_pct.`,
    `Income thresholds use HUD Income Limits year ${hudYear} AMI ("median_income") for 4-person households, per county.`,
    `Priced-affordable units come from ACS ${acsYear} 5-year table B25063 (cash rent only); rent bins are prorated at each threshold (30% of income / 12).`,
    `Gap = units minus renter households at each threshold (negative = deficit). Bins are prorated assuming uniform distribution within each bin.`,
    `These are priced-affordable units, not guaranteed vacant/available, and do not incorporate concessions.`
  ];
}

async function computeCounty(county, hudYear, acsYear, hudToken, censusKey) {
  const entityid = county.fips_code; // includes trailing 99999
  const countyCode = entityid.slice(2,5);

  const il = await hudFetch(`il/data/${entityid}?year=${hudYear}`, hudToken);
  const ami = Number(il?.data?.median_income);
  if (!ami || Number.isNaN(ami)) throw new Error(`Missing AMI for ${county.county_name}`);

  const b251 = parseRow(await censusFetchAcs5(acsYear, seqVars("B25118", 14, 25), countyCode, censusKey));
  const renterCounts = pickCounts(b251, "B25118", 15, 25);
  const renterTotal = Number(b251[B25118_RENTER_TOTAL] || 0);

  const b190 = parseRow(await censusFetchAcs5(acsYear, seqVars("B19001", 1, 17), countyCode, censusKey));
  const hhCounts = pickCounts(b190, "B19001", 2, 17);

  const b250 = parseRow(await censusFetchAcs5(acsYear, seqVars("B25063", 1, 26), countyCode, censusKey));
  const rentCounts = pickCounts(b250, "B25063", 3, 26);

  const hhLe = {}, allHhLe = {}, unitsLe = {}, gap = {}, cov = {}, affRent = {};

  BANDS.forEach((p) => {
    const incT = ami * (p/100);
    const rentT = pctToMonthlyRent(ami, p);
    affRent[String(p)] = Math.round(rentT);

    const hh = cumulativeAtThreshold(RENTER_INCOME_BINS, renterCounts, incT);
    const allHh = cumulativeAtThreshold(INCOME_BINS, hhCounts, incT);
    const un = cumulativeAtThreshold(RENT_BINS, rentCounts, rentT);

    hhLe[String(p)] = Math.round(hh);
    allHhLe[String(p)] = Math.round(allHh);
    unitsLe[String(p)] = Math.round(un);
    gap[String(p)] = Math.round(un) - Math.round(hh);
    cov[String(p)] = hh > 0 ? Number((un / hh).toFixed(4)) : null;
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
    coverage_le_ami_pct: cov,
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
    renter_households_total: counties.reduce((s,c)=>s+(c.renter_households_total||0),0),
    units_priced_affordable_le_ami_pct: {},
    gap_units_minus_households_le_ami_pct: {},
    coverage_le_ami_pct: {},
    demand_tenure: "renter"
  };

  BANDS.forEach((p)=>{
    const k = String(p);
    const hh = counties.reduce((s,c)=>s+(c.households_le_ami_pct?.[k]||0),0);
    const allHh = counties.reduce((s,c)=>s+(c.all_households_le_ami_pct?.[k]||0),0);
    const un = counties.reduce((s,c)=>s+(c.units_priced_affordable_le_ami_pct?.[k]||0),0);
    agg.households_le_ami_pct[k] = Math.round(hh);
    agg.all_households_le_ami_pct[k] = Math.round(allHh);
    agg.units_priced_affordable_le_ami_pct[k] = Math.round(un);
    agg.gap_units_minus_households_le_ami_pct[k] = Math.round(un - hh);
    agg.coverage_le_ami_pct[k] = hh>0 ? Number((un/hh).toFixed(4)) : null;
  });
  return agg;
}

export default async function handler(req, res) {
  try {
    const hudToken = process.env.HUD_USER_TOKEN;
    if (!hudToken) return res.status(500).json({ error: "Missing HUD_USER_TOKEN" });
    // The Census API rejects keyless requests, so the key is required.
    const censusKey = process.env.CENSUS_API_KEY;
    if (!censusKey) return res.status(500).json({ error: "Missing CENSUS_API_KEY" });

    // Validate query-param years before passing them downstream to HUD/Census.
    // Anything outside a sane range is a malformed request — return 400 rather
    // than constructing nonsense URLs and silently swallowing the failures.
    const MIN_YEAR = 2010;
    const MAX_YEAR = new Date().getUTCFullYear() + 1;
    const parseYear = (raw, fallback, name) => {
      if (raw === undefined || raw === null || raw === "") return fallback;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < MIN_YEAR || n > MAX_YEAR) {
        const err = new Error(`Invalid ${name}=${raw}; expected integer in [${MIN_YEAR}, ${MAX_YEAR}]`);
        err.status = 400;
        throw err;
      }
      return n;
    };
    let hudYear, acsYear;
    try {
      hudYear = parseYear(req.query.hudYear, DEFAULT_HUD_YEAR, "hudYear");
      acsYear = parseYear(req.query.acsYear, DEFAULT_ACS_YEAR, "acsYear");
    } catch (validationErr) {
      return res.status(validationErr.status || 400).json({ error: validationErr.message });
    }

    const counties = await hudFetch(`fmr/listCounties/CO?updated=2025`, hudToken);

    const out = [];
    for (const c of (counties?.data || [])) {
      try { out.push(await computeCounty(c, hudYear, acsYear, hudToken, censusKey)); }
      catch (e) { /* skip errors */ }
    }

    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=86400");
    return res.status(200).json({
      meta: {
        state: "CO",
        hud_income_limits_year: hudYear,
        acs_year: acsYear,
        generated_at: new Date().toISOString().slice(0,10),
        methodology_version: METHODOLOGY_VERSION,
        demand_tenure: "renter"
      },
      bands: BANDS.map(String),
      statewide: statewideAgg(out),
      counties: out,
      methodology: buildMethodology(hudYear, acsYear),
      sources: [
        { name: "HUD USER FMR/IL API", url: "https://www.huduser.gov/portal/dataset/fmr-api.html" },
        { name: "Census ACS 5-year B25118 (Tenure by Household Income)", url: "https://api.census.gov/data.html" },
        { name: "Census ACS 5-year B25063 (Gross Rent) and B19001 (Household Income, legacy series)", url: "https://api.census.gov/data.html" }
      ]
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
