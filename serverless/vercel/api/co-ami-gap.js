// Vercel Serverless Function (Node.js) - /api/co-ami-gap
//
// Set environment variables in Vercel:
// - HUD_USER_TOKEN (required)
// - CENSUS_API_KEY (optional)
//
// Query params: hudYear=2025, acsYear=2023
//
// Returns JSON compatible with /js/co-ami-gap.js front-end module.
//
// Sources:
// - HUD FMR/IL API docs: https://www.huduser.gov/portal/dataset/fmr-api.html citeturn1view0
// - ACS API tables: B19001 (household income), B25063 (gross rent) citeturn0search6turn0search8

const HUD_BASE = "https://www.huduser.gov/hudapi/public/fmr";
const CENSUS_BASE = "https://api.census.gov/data";

const DEFAULT_HUD_YEAR = 2025;
const DEFAULT_ACS_YEAR = 2023;
const BANDS = [30, 40, 50, 60, 70, 80, 100];

const INCOME_BINS = [
  [0, 10000],[10000,15000],[15000,20000],[20000,25000],[25000,30000],[30000,35000],
  [35000,40000],[40000,45000],[45000,50000],[50000,60000],[60000,75000],[75000,100000],
  [100000,125000],[125000,150000],[150000,200000],[200000,Infinity]
];

const RENT_BINS = [
  [0,100],[100,150],[150,200],[200,250],[250,300],[300,350],[350,400],[400,450],[450,500],
  [500,550],[550,600],[600,650],[650,700],[700,750],[750,800],[800,900],[900,1000],
  [1000,1250],[1250,1500],[1500,2000],[2000,2500],[2500,Infinity]
];

function overlapProportion([lo, hi], t) {
  if (t <= lo) return 0;
  if (t >= hi) return 1;
  if (!Number.isFinite(hi)) return 1;
  const w = hi - lo;
  return w > 0 ? (t - lo) / w : 0;
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
  const keyParam = apiKey ? `&key=${encodeURIComponent(apiKey)}` : "";
  const url = `${CENSUS_BASE}/${year}/acs/acs5?get=${encodeURIComponent(vars)}&for=county:${countyCode}&in=state:08${keyParam}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Census API ${res.status}`);
  return res.json();
}

function b19001Vars() {
  const vars = [];
  for (let i = 1; i <= 17; i++) vars.push(`B19001_${String(i).padStart(3,"0")}E`);
  return vars;
}
function b25063Vars() {
  const vars = [];
  for (let i = 1; i <= 24; i++) vars.push(`B25063_${String(i).padStart(3,"0")}E`);
  return vars;
}
function parseRow(json) {
  const header = json[0], row = json[1];
  const out = {};
  header.forEach((h,i)=> out[h]=row[i]);
  return out;
}

function buildMethodology(hudYear, acsYear) {
  return [
    `Income thresholds use HUD Income Limits year ${hudYear} AMI ("median_income") for 4-person households, per county.`,
    `Households by income come from ACS ${acsYear} 5-year table B19001; bins are prorated into AMI thresholds assuming uniform distribution.`,
    `Priced-affordable units come from ACS ${acsYear} 5-year table B25063 (cash rent only); rent bins are prorated at each threshold.`,
    `These are priced-affordable units, not guaranteed vacant/available, and do not incorporate concessions.`
  ];
}

async function computeCounty(county, hudYear, acsYear, hudToken, censusKey) {
  const entityid = county.fips_code; // includes trailing 99999 citeturn2view0
  const countyCode = entityid.slice(2,5);

  const il = await hudFetch(`il/data/${entityid}?year=${hudYear}`, hudToken);
  const ami = Number(il?.data?.median_income);
  if (!ami || Number.isNaN(ami)) throw new Error(`Missing AMI for ${county.county_name}`);

  const b190 = parseRow(await censusFetchAcs5(acsYear, b19001Vars(), countyCode, censusKey));
  const hhCounts = [];
  for (let i = 2; i <= 17; i++) hhCounts.push(Number(b190[`B19001_${String(i).padStart(3,"0")}E`] || 0));

  const b250 = parseRow(await censusFetchAcs5(acsYear, b25063Vars(), countyCode, censusKey));
  const rentCounts = [];
  for (let i = 4; i <= 24; i++) rentCounts.push(Number(b250[`B25063_${String(i).padStart(3,"0")}E`] || 0));

  const hhLe = {}, unitsLe = {}, gap = {}, cov = {}, affRent = {};

  BANDS.forEach((p) => {
    const incT = ami * (p/100);
    const rentT = pctToMonthlyRent(ami, p);
    affRent[String(p)] = Math.round(rentT);

    let hh = 0;
    for (let i=0;i<INCOME_BINS.length;i++) hh += hhCounts[i] * overlapProportion(INCOME_BINS[i], incT);

    let un = 0;
    for (let i=0;i<RENT_BINS.length;i++) un += rentCounts[i] * overlapProportion(RENT_BINS[i], rentT);

    hhLe[String(p)] = Math.round(hh);
    unitsLe[String(p)] = Math.round(un);
    gap[String(p)] = Math.round(un - hh);
    cov[String(p)] = hh > 0 ? (un / hh) : null;
  });

  return {
    fips: countyCode,
    county_name: county.county_name,
    ami_4person: ami,
    affordable_rent_monthly: affRent,
    households_le_ami_pct: hhLe,
    units_priced_affordable_le_ami_pct: unitsLe,
    gap_units_minus_households_le_ami_pct: gap,
    coverage_le_ami_pct: cov
  };
}

function statewideAgg(counties) {
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

  BANDS.forEach((p)=>{
    const k = String(p);
    const hh = counties.reduce((s,c)=>s+(c.households_le_ami_pct?.[k]||0),0);
    const un = counties.reduce((s,c)=>s+(c.units_priced_affordable_le_ami_pct?.[k]||0),0);
    agg.households_le_ami_pct[k] = Math.round(hh);
    agg.units_priced_affordable_le_ami_pct[k] = Math.round(un);
    agg.gap_units_minus_households_le_ami_pct[k] = Math.round(un - hh);
    agg.coverage_le_ami_pct[k] = hh>0 ? (un/hh) : null;
  });
  return agg;
}

export default async function handler(req, res) {
  try {
    const hudToken = process.env.HUD_USER_TOKEN;
    if (!hudToken) return res.status(500).json({ error: "Missing HUD_USER_TOKEN" });

    const hudYear = Number(req.query.hudYear || DEFAULT_HUD_YEAR);
    const acsYear = Number(req.query.acsYear || DEFAULT_ACS_YEAR);
    const censusKey = process.env.CENSUS_API_KEY || null;

    const counties = await hudFetch(`fmr/listCounties/CO?updated=2025`, hudToken);

    const out = [];
    for (const c of (counties?.data || [])) {
      try { out.push(await computeCounty(c, hudYear, acsYear, hudToken, censusKey)); }
      catch (e) { /* skip errors */ }
    }

    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=86400");
    return res.status(200).json({
      meta: { state: "CO", hud_income_limits_year: hudYear, acs_year: acsYear, generated_at: new Date().toISOString().slice(0,10) },
      bands: BANDS,
      statewide: statewideAgg(out),
      counties: out,
      methodology: buildMethodology(hudYear, acsYear),
      sources: [
        { name: "HUD USER FMR/IL API", url: "https://www.huduser.gov/portal/dataset/fmr-api.html" },
        { name: "Census API", url: "https://api.census.gov/data.html" }
      ]
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
