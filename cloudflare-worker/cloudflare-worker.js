/**
 * Cloudflare Worker: Affordable Housing API
 * Routes:
 *   GET  /prop123     -> Proposition 123 commitments (jurisdictions + counties + cities)
 *   GET  /co-ami-gap  -> Colorado county households vs priced-affordable units by %AMI
 *   GET  /health      -> simple status
 *
 * Secrets (Worker Settings > Variables and Secrets):
 *   HUD_USER_TOKEN   (required for /co-ami-gap)
 *   CENSUS_API_KEY   (required for /co-ami-gap — the Census API rejects keyless requests)
 *
 * Optional variables:
 *   ALLOW_ORIGIN          default "https://pggllc.github.io"
 *                         (Set to a comma-separated list, or "*" only when
 *                         deliberately exposing the API to the open web.)
 *   PROP123_CACHE_SECONDS default 86400   (1 day)
 *   AMI_CACHE_SECONDS     default 604800  (7 days)
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, ""); // trim trailing /
    if (request.method === "OPTIONS") return corsPreflight(env);

    try {
      if (path === "" || path === "/") {
        return json({ ok: true, routes: ["/health", "/prop123", "/co-ami-gap"] }, env);
      }
      if (path === "/health") {
        return json({ ok: true, now: new Date().toISOString() }, env);
      }
      if (path === "/prop123") {
        return await handleProp123(request, env, ctx);
      }
      if (path === "/co-ami-gap") {
        return await handleAMI(request, env, ctx);
      }
      return json({ ok: false, error: "Not found" }, env, 404);
    } catch (err) {
      return json({ ok: false, error: String(err?.message || err) }, env, 500);
    }
  },
};

const DEFAULT_ALLOW_ORIGIN = "https://pggllc.github.io";

// Default to the production GitHub Pages origin instead of "*". To allow
// a different origin (or wildcard for local dev), set ALLOW_ORIGIN as a
// Cloudflare Worker variable.
function allowOrigin(env) {
  return (env && env.ALLOW_ORIGIN) ? env.ALLOW_ORIGIN : DEFAULT_ALLOW_ORIGIN;
}

function withCorsHeaders(env, headers = {}) {
  return {
    ...headers,
    "Access-Control-Allow-Origin": allowOrigin(env),
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": headers["Cache-Control"] || "no-store",
    "Content-Type": headers["Content-Type"] || "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

function corsPreflight(env) {
  return new Response(null, { status: 204, headers: withCorsHeaders(env) });
}

function json(obj, env, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: withCorsHeaders(env, extraHeaders),
  });
}

/**
 * Normalise any raw value to a zero-padded 5-digit FIPS string.
 * Handles both full 5-digit codes and bare 3-digit county suffixes (prefixed "08").
 *
 * @param {string|number|null} raw
 * @returns {string}  5-digit FIPS (e.g. "08031") or "" if input is falsy.
 */
function toFips5(raw) {
  if (raw == null || raw === "") return "";
  const s = String(raw).trim().replace(/\D/g, ""); // digits only
  if (s.length >= 5) return s.padStart(5, "0").slice(0, 5);
  if (s.length > 0) return `08${s.padStart(3, "0")}`; // treat as CO county suffix
  return "";
}

async function fromCacheOrCompute(request, env, ctx, cacheSeconds, computeFn) {
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await computeFn();
  const res2 = new Response(response.body, response);
  res2.headers.set("Cache-Control", `public, max-age=${cacheSeconds}`);
  res2.headers.set("Access-Control-Allow-Origin", allowOrigin(env));
  res2.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res2.headers.set("Access-Control-Allow-Headers", "Content-Type");

  ctx.waitUntil(cache.put(cacheKey, res2.clone()));
  return res2;
}

/* ---------------------------
 * /prop123 implementation
 * --------------------------- */
async function handleProp123(request, env, ctx) {
  const ttl = parseInt(env.PROP123_CACHE_SECONDS || "86400", 10);
  return fromCacheOrCompute(request, env, ctx, ttl, async () => {
    const dolaUrl = "https://cdola.colorado.gov/commitment-filings";
    const html = await fetchText(dolaUrl);

    const sheetUrl = extractFirstSheetOrCsvUrl(html);
    if (!sheetUrl) {
      return json({
        ok: true,
        source: dolaUrl,
        note: "Could not auto-detect filings sheet link. Returning empty list.",
        jurisdictions: [],
      }, env);
    }

    const csvUrl = normalizeToCsvExport(sheetUrl);
    const csvText = await fetchText(csvUrl);
    const rows = parseCsv(csvText);
    const jurisdictions = normalizeProp123Rows(rows, sheetUrl);

    return json({
      ok: true,
      source: dolaUrl,
      sheet: sheetUrl,
      updated_at: new Date().toISOString(),
      jurisdictions,
    }, env);
  });
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "affordable-housing-worker" } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

function extractFirstSheetOrCsvUrl(html) {
  const patterns = [
    /https?:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+\/[^"' )]+/g,
    /https?:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+/g,
    /https?:\/\/[^"' )]+\.csv/g,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m.length) return m[0];
  }
  return null;
}

function normalizeToCsvExport(sheetUrl) {
  if (/\.csv(\?|$)/i.test(sheetUrl)) return sheetUrl;
  const idMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return sheetUrl;
  const id = idMatch[1];
  const gidMatch = sheetUrl.match(/[?&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    const next = csv[i + 1];

    if (c === '"' && inQuotes && next === '"') {
      field += '"'; i++; continue;
    }
    if (c === '"') { inQuotes = !inQuotes; continue; }

    if (c === "," && !inQuotes) {
      row.push(field); field = ""; continue;
    }
    if ((c === "\n" || c === "\r") && !inQuotes) {
      if (c === "\r" && next === "\n") i++;
      row.push(field);
      if (row.some(v => v && v.trim() !== "")) rows.push(row);
      row = []; field = "";
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some(v => v && v.trim() !== "")) rows.push(row);

  if (!rows.length) return [];
  const header = rows[0].map(h => (h || "").trim());
  return rows.slice(1).map(r => {
    const obj = {};
    header.forEach((h, idx) => obj[h || `col_${idx}`] = (r[idx] ?? "").trim());
    return obj;
  });
}

function normalizeProp123Rows(rows, sheetUrl) {
  const out = [];
  for (const r of rows) {
    const name = pick(r, ["jurisdiction", "jurisdiction name", "local government", "city", "town", "county", "name"]);
    if (!name) continue;

    const kindRaw = pick(r, ["type", "jurisdiction type", "kind"]);
    const kind = inferKind(name, kindRaw);

    const required = pick(r, ["required commitment", "required annual commitment", "commitment", "minimum commitment", "required"]);
    const status = pick(r, ["status", "filing status", "implementation status"]);
    const filingDate = pick(r, ["filing date", "date filed", "date", "effective date"]);
    const sourceUrl = pick(r, ["source", "link", "url"]) || sheetUrl;

    out.push({
      name: normalizeName(name),
      kind,
      required_commitment: required || null,
      status: status || null,
      filing_date: filingDate || null,
      source_url: sourceUrl || sheetUrl,
    });
  }
  return out;
}

function pick(obj, keys) {
  const lowerMap = {};
  for (const k of Object.keys(obj)) lowerMap[k.toLowerCase()] = k;
  for (const want of keys) {
    const k = lowerMap[want.toLowerCase()];
    if (k && obj[k]) return obj[k];
  }
  const wants = keys.map(k => k.toLowerCase());
  for (const real of Object.keys(obj)) {
    const rl = real.toLowerCase();
    if (wants.some(w => rl.includes(w))) {
      const v = obj[real];
      if (v) return v;
    }
  }
  return "";
}

function normalizeName(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

function inferKind(name, kindRaw) {
  const k = (kindRaw || "").toLowerCase();
  if (k.includes("county")) return "county";
  if (k.includes("city") || k.includes("town") || k.includes("municip")) return "municipality";
  if (/\bcounty\b/i.test(name)) return "county";
  return "municipality";
}

/* ---------------------------
 * /co-ami-gap implementation
 * --------------------------- */
async function handleAMI(request, env, ctx) {
  const ttl = parseInt(env.AMI_CACHE_SECONDS || "604800", 10);
  return fromCacheOrCompute(request, env, ctx, ttl, async () => {
    if (!env.HUD_USER_TOKEN) {
      return json({ ok: false, error: "Missing HUD_USER_TOKEN secret" }, env, 500);
    }
    // The Census API rejects keyless requests, so the key is required.
    if (!env.CENSUS_API_KEY) {
      return json({ ok: false, error: "Missing CENSUS_API_KEY secret" }, env, 500);
    }

    const year = 2025;
    const stateFips = "08"; // Colorado
    const amiPercents = [0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 1.00];

    const hudCounties = await hudListCounties(env.HUD_USER_TOKEN, year, stateFips);
    const countyIndex = buildHudCountyIndex(hudCounties);

    const censusKey = env.CENSUS_API_KEY;
    const acsYear = 2024;
    const renter = await censusB25118_CO_Counties(acsYear, censusKey);
    const hh = await censusB19001_CO_Counties(acsYear, censusKey);
    const rent = await censusB25063_CO_Counties(acsYear, censusKey);

    const counties = [];
    for (const c of hh.counties) {
      const fips = c.county_fips;
      const hud = countyIndex[fips];
      if (!hud) continue;

      const il = await hudIncomeLimits(env.HUD_USER_TOKEN, year, hud.entityid);
      const ami4 = pickHudAmi4(il);
      if (!ami4) continue;

      const allHhBins = c.bins;
      const renterBins = renter.by_fips[fips]?.bins || [];
      const renterTotal = renter.by_fips[fips]?.renter_total ?? 0;
      const rentBins = rent.by_fips[fips]?.bins || [];

      const bands = [];
      for (const p of amiPercents) {
        const incomeThreshold = ami4 * p;
        // Methodology v2: demand side is renter households (B25118);
        // the all-tenure B19001 series is retained as all_households.
        const households_leq = prorateSumByThreshold(renterBins, incomeThreshold);
        const all_households_leq = prorateSumByThreshold(allHhBins, incomeThreshold);
        const affRent = (ami4 * p * 0.30) / 12.0;
        const units_leq = prorateRentUnitsByThreshold(rentBins, affRent);

        const gap = units_leq - households_leq;
        const coverage = (households_leq > 0) ? (units_leq / households_leq) : null;

        bands.push({
          pct_ami: Math.round(p * 100),
          income_threshold: Math.round(incomeThreshold),
          affordable_rent: Math.round(affRent),
          households: Math.round(households_leq),
          all_households: Math.round(all_households_leq),
          units_priced_affordable: Math.round(units_leq),
          gap: Math.round(gap),
          coverage: coverage === null ? null : Number(coverage.toFixed(3)),
        });
      }

      counties.push({
        county_fips: fips,
        county_name: hud.county_name,
        hud_entityid: hud.entityid,
        ami4: ami4,
        renter_households_total: renterTotal,
        demand_tenure: "renter",
        acs_year: acsYear,
        hud_year: year,
        bands,
      });
    }

    return json({
      ok: true,
      generated_at: new Date().toISOString(),
      methodology: {
        methodology_version: 2,
        demand_tenure: "renter",
        note: "Methodology v2: the gap's demand side is renter households (ACS B25118); the all-tenure B19001 series is retained as all_households. v1 used all households against renter-only supply, which structurally inflated gaps ~2.5-4x. Priced-affordable units from ACS rent distribution; not guaranteed vacant/available. Bin prorating assumes uniform distribution within ACS bins.",
        ami_basis: "HUD Income Limits (IL API), 4-person AMI",
        households: `ACS ${acsYear} 5-year B25118 (tenure × household income, renter columns)`,
        all_households: `ACS ${acsYear} 5-year B19001 (household income, all tenures — legacy series)`,
        rents: `ACS ${acsYear} 5-year B25063 (gross rent)`,
        formula: "aff_rent = (AMI * %AMI * 0.30)/12; households and units are cumulative <= threshold; gap = units - renter households (negative = deficit)",
      },
      counties,
    }, env);
  });
}

async function hudListCounties(hudToken, year, stateFips) {
  const url = `https://www.huduser.gov/hudapi/public/fmr/listCounties?year=${year}&statecode=${stateFips}`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${hudToken}` } });
  if (!res.ok) throw new Error(`HUD listCounties failed ${res.status}`);
  const data = await res.json();
  return data?.data || [];
}

function buildHudCountyIndex(list) {
  const idx = {};
  for (const item of list) {
    const fips = toFips5(item.fips_code);
    const entityid = item.county_id;
    if (fips && entityid) idx[fips] = { entityid, county_name: item.county_name };
  }
  return idx;
}

async function hudIncomeLimits(hudToken, year, entityid) {
  const url = `https://www.huduser.gov/hudapi/public/fmr/il/data/${entityid}?year=${year}`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${hudToken}` } });
  if (!res.ok) throw new Error(`HUD IL data failed ${res.status}`);
  return await res.json();
}

function pickHudAmi4(ilJson) {
  const d = ilJson?.data || ilJson;
  const candidates = [
    d?.il_data?.median_income,
    d?.il_data?.median_income_4,
    d?.median_income,
    d?.ami,
    d?.area_median_income,
    d?.IncomeLimits?.AMI_4,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 1000) return n;
  }
  const fallback = Number(d?.il100_4 || d?.IL100_4 || d?.income_limit_100_4);
  if (Number.isFinite(fallback) && fallback > 1000) return fallback;
  return null;
}

/* Census fetchers */
async function censusB25118_CO_Counties(acsYear, key) {
  // Renter-household income: B25118_014E is the renter total; _015E.._025E
  // are the renter income bins. Demand side of the gap since methodology v2.
  const vars = [
    "NAME","B25118_014E",
    "B25118_015E","B25118_016E","B25118_017E","B25118_018E","B25118_019E","B25118_020E",
    "B25118_021E","B25118_022E","B25118_023E","B25118_024E","B25118_025E",
  ];
  const url = new URL(`https://api.census.gov/data/${acsYear}/acs/acs5`);
  url.searchParams.set("get", vars.join(","));
  url.searchParams.set("for", "county:*");
  url.searchParams.set("in", "state:08");
  url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Census B25118 failed ${res.status}`);
  const data = await res.json();
  const header = data[0];
  const rows = data.slice(1);

  const by_fips = {};
  for (const r of rows) {
    const o = {};
    header.forEach((h, i) => o[h] = r[i]);
    const fips = toFips5(o["county"]);

    const counts = [];
    for (let i = 15; i <= 25; i++) {
      const keyv = `B25118_${String(i).padStart(3, "0")}E`;
      counts.push(Number(o[keyv] || 0));
    }
    const bins = b25118RenterBins(counts);
    by_fips[fips] = { name: o["NAME"], renter_total: Number(o["B25118_014E"] || 0), bins };
  }
  return { by_fips };
}

function b25118RenterBins(counts) {
  // Half-open [lo, hi) edges — see prorateSumByThreshold.
  const edges = [
    [0, 5000],[5000, 10000],[10000, 15000],[15000, 20000],[20000, 25000],
    [25000, 35000],[35000, 50000],[50000, 75000],[75000, 100000],[100000, 150000],[150000, null],
  ];
  return edges.map((e, i) => ({ lo: e[0], hi: e[1], value: counts[i] || 0 }));
}

async function censusB19001_CO_Counties(acsYear, key) {
  const vars = [
    "NAME","B19001_001E",
    "B19001_002E","B19001_003E","B19001_004E","B19001_005E","B19001_006E","B19001_007E","B19001_008E",
    "B19001_009E","B19001_010E","B19001_011E","B19001_012E","B19001_013E","B19001_014E","B19001_015E","B19001_016E","B19001_017E",
  ];
  const url = new URL(`https://api.census.gov/data/${acsYear}/acs/acs5`);
  url.searchParams.set("get", vars.join(","));
  url.searchParams.set("for", "county:*");
  url.searchParams.set("in", "state:08");
  url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Census B19001 failed ${res.status}`);
  const data = await res.json();
  const header = data[0];
  const rows = data.slice(1);

  const counties = rows.map(r => {
    const o = {};
    header.forEach((h, i) => o[h] = r[i]);
    const fips = toFips5(o["county"]);

    const counts = [];
    for (let i = 2; i <= 17; i++) {
      const keyv = `B19001_${String(i).padStart(3, "0")}E`;
      counts.push(Number(o[keyv] || 0));
    }
    const bins = b19001Bins(counts);

    return { county_fips: fips, name: o["NAME"], bins };
  });

  return { counties };
}

function b19001Bins(counts) {
  // Half-open [lo, hi) edges — see prorateSumByThreshold.
  const edges = [
    [0, 10000],[10000, 15000],[15000, 20000],[20000, 25000],[25000, 30000],[30000, 35000],[35000, 40000],[40000, 45000],[45000, 50000],
    [50000, 60000],[60000, 75000],[75000, 100000],[100000, 125000],[125000, 150000],[150000, 200000],[200000, null],
  ];
  return edges.map((e, i) => ({ lo: e[0], hi: e[1], value: counts[i] || 0 }));
}

async function censusB25063_CO_Counties(acsYear, key) {
  // Cash-rent bins are B25063_003E ("Less than $100") .. _026E ("$3,500 or
  // more"). _001E is the total and _002E the "with cash rent" subtotal —
  // the pre-v2 version counted _002E as the lowest rent bin, massively
  // inflating sub-$200 supply, and used invented $100-wide edges.
  const vars = [
    "NAME","B25063_001E","B25063_002E",
    "B25063_003E","B25063_004E","B25063_005E","B25063_006E","B25063_007E","B25063_008E","B25063_009E",
    "B25063_010E","B25063_011E","B25063_012E","B25063_013E","B25063_014E","B25063_015E","B25063_016E","B25063_017E","B25063_018E","B25063_019E","B25063_020E","B25063_021E","B25063_022E","B25063_023E","B25063_024E","B25063_025E","B25063_026E",
  ];
  const url = new URL(`https://api.census.gov/data/${acsYear}/acs/acs5`);
  url.searchParams.set("get", vars.join(","));
  url.searchParams.set("for", "county:*");
  url.searchParams.set("in", "state:08");
  url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Census B25063 failed ${res.status}`);
  const data = await res.json();
  const header = data[0];
  const rows = data.slice(1);

  const by_fips = {};
  for (const r of rows) {
    const o = {};
    header.forEach((h, i) => o[h] = r[i]);
    const fips = toFips5(o["county"]);

    const counts = [];
    for (let i = 3; i <= 26; i++) {
      const keyv = `B25063_${String(i).padStart(3, "0")}E`;
      counts.push(Number(o[keyv] || 0));
    }
    const bins = b25063Bins(counts);
    by_fips[fips] = { name: o["NAME"], bins };
  }
  return { by_fips };
}

function b25063Bins(counts) {
  // Half-open [lo, hi) edges — see prorateSumByThreshold.
  const edges = [
    [0,100],[100,150],[150,200],[200,250],[250,300],[300,350],[350,400],[400,450],[450,500],
    [500,550],[550,600],[600,650],[650,700],[700,750],[750,800],[800,900],[900,1000],
    [1000,1250],[1250,1500],[1500,2000],[2000,2500],[2500,3000],[3000,3500],[3500,null],
  ];
  return edges.map((e,i)=>({ lo:e[0], hi:e[1], value: counts[i] || 0 }));
}

function prorateSumByThreshold(bins, threshold) {
  // Cumulative count <= threshold, uniform within half-open bins [lo, hi).
  // Open-ended top bin uses a 2×-floor virtual upper edge (matches
  // scripts/hna/build_place_ami_gap.py; never binds at tiers <= 100% AMI).
  let sum = 0;
  for (const b of bins) {
    const lo = b.lo, hi = b.hi, v = b.value;
    if (threshold <= lo) continue;
    if (hi === null) { sum += v * clamp01((threshold - lo) / lo); continue; }
    if (threshold >= hi) { sum += v; continue; }
    sum += v * clamp01((threshold - lo) / (hi - lo));
  }
  return sum;
}

function prorateRentUnitsByThreshold(bins, rentThreshold) {
  return prorateSumByThreshold(bins, rentThreshold);
}
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
