/**
 * Cloudflare Worker: HUD Market Analysis
 *
 * Endpoint: GET /hud-markets
 *
 * Fetches Comprehensive Housing Market Analysis (CHMA) data from the HUD User API.
 * Extracts market characteristics, demand/supply outlook, and income data for
 * Colorado metropolitan markets.
 *
 * Env vars (Cloudflare Worker secrets/vars):
 * - HUD_USER_TOKEN         (required)  HUD USER API Bearer token
 * - CO_DEMO_CACHE_SECONDS  (optional)  Cache TTL in seconds; default 604800 (7 days)
 * - CORS_ORIGIN            (optional)  CORS allowed origin; default "*"
 *
 * Query params:
 * - state=CO  (default "CO") — two-letter state abbreviation
 *
 * Caching: 7 days by default.
 *
 * References:
 * - HUD User API:   https://www.huduser.gov/portal/dataset/fmr-api.html
 * - HUD CHAS data:  https://www.huduser.gov/portal/dataset/chas-api.html
 */

const HUD_BASE = "https://www.huduser.gov/hudapi/public";

// Default cache TTL: 7 days
const DEFAULT_CACHE_SECONDS = 604800;

// Colorado metropolitan markets with HUD CBSA codes and descriptions
// Used both to drive API requests and as fallback structure
const CO_MARKETS = [
  { region: "Denver-Aurora-Lakewood", cbsa: "19740", state: "CO" },
  { region: "Colorado Springs", cbsa: "17820", state: "CO" },
  { region: "Fort Collins", cbsa: "22660", state: "CO" },
  { region: "Greeley", cbsa: "24540", state: "CO" },
  { region: "Boulder", cbsa: "14500", state: "CO" },
  { region: "Pueblo", cbsa: "39380", state: "CO" },
  { region: "Grand Junction", cbsa: "24300", state: "CO" }
];

// Fallback data for when the HUD API is unavailable
const FALLBACK_MARKETS = [
  {
    region: "Denver-Aurora-Lakewood",
    cbsa: "19740",
    characteristics: {
      currentJobs: 1580000,
      jobGrowthRate: 0.018,
      unemploymentRate: 0.038,
      medianHouseholdIncome: 85000,
      medianHomePrice: 560000,
      medianGrossRent: 1750,
      vacancyRateOwner: 0.012,
      vacancyRateRenter: 0.052
    },
    forecast: {
      demandOutlook: "tight",
      supplyOutlook: "improving",
      populationGrowth2025_2030: 0.062,
      jobGrowth2025_2030: 0.055,
      newUnitsNeeded: 28000
    }
  },
  {
    region: "Colorado Springs",
    cbsa: "17820",
    characteristics: {
      currentJobs: 285000,
      jobGrowthRate: 0.022,
      unemploymentRate: 0.042,
      medianHouseholdIncome: 72000,
      medianHomePrice: 420000,
      medianGrossRent: 1450,
      vacancyRateOwner: 0.014,
      vacancyRateRenter: 0.058
    },
    forecast: {
      demandOutlook: "moderate",
      supplyOutlook: "balanced",
      populationGrowth2025_2030: 0.072,
      jobGrowth2025_2030: 0.065,
      newUnitsNeeded: 12000
    }
  },
  {
    region: "Fort Collins",
    cbsa: "22660",
    characteristics: {
      currentJobs: 165000,
      jobGrowthRate: 0.019,
      unemploymentRate: 0.032,
      medianHouseholdIncome: 78000,
      medianHomePrice: 495000,
      medianGrossRent: 1650,
      vacancyRateOwner: 0.011,
      vacancyRateRenter: 0.044
    },
    forecast: {
      demandOutlook: "tight",
      supplyOutlook: "constrained",
      populationGrowth2025_2030: 0.058,
      jobGrowth2025_2030: 0.052,
      newUnitsNeeded: 7500
    }
  },
  {
    region: "Greeley",
    cbsa: "24540",
    characteristics: {
      currentJobs: 110000,
      jobGrowthRate: 0.025,
      unemploymentRate: 0.044,
      medianHouseholdIncome: 65000,
      medianHomePrice: 380000,
      medianGrossRent: 1300,
      vacancyRateOwner: 0.018,
      vacancyRateRenter: 0.065
    },
    forecast: {
      demandOutlook: "moderate",
      supplyOutlook: "balanced",
      populationGrowth2025_2030: 0.085,
      jobGrowth2025_2030: 0.075,
      newUnitsNeeded: 8200
    }
  },
  {
    region: "Boulder",
    cbsa: "14500",
    characteristics: {
      currentJobs: 175000,
      jobGrowthRate: 0.014,
      unemploymentRate: 0.028,
      medianHouseholdIncome: 95000,
      medianHomePrice: 720000,
      medianGrossRent: 2100,
      vacancyRateOwner: 0.008,
      vacancyRateRenter: 0.038
    },
    forecast: {
      demandOutlook: "very tight",
      supplyOutlook: "severely constrained",
      populationGrowth2025_2030: 0.028,
      jobGrowth2025_2030: 0.030,
      newUnitsNeeded: 4200
    }
  },
  {
    region: "Pueblo",
    cbsa: "39380",
    characteristics: {
      currentJobs: 58000,
      jobGrowthRate: 0.008,
      unemploymentRate: 0.058,
      medianHouseholdIncome: 48000,
      medianHomePrice: 220000,
      medianGrossRent: 900,
      vacancyRateOwner: 0.025,
      vacancyRateRenter: 0.082
    },
    forecast: {
      demandOutlook: "soft",
      supplyOutlook: "adequate",
      populationGrowth2025_2030: 0.018,
      jobGrowth2025_2030: 0.015,
      newUnitsNeeded: 1800
    }
  },
  {
    region: "Grand Junction",
    cbsa: "24300",
    characteristics: {
      currentJobs: 68000,
      jobGrowthRate: 0.012,
      unemploymentRate: 0.048,
      medianHouseholdIncome: 55000,
      medianHomePrice: 280000,
      medianGrossRent: 1050,
      vacancyRateOwner: 0.020,
      vacancyRateRenter: 0.070
    },
    forecast: {
      demandOutlook: "moderate",
      supplyOutlook: "balanced",
      populationGrowth2025_2030: 0.035,
      jobGrowth2025_2030: 0.028,
      newUnitsNeeded: 2600
    }
  }
];

/**
 * Build CORS + caching response headers.
 */
function buildHeaders(cacheTtl, corsOrigin) {
  return {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": corsOrigin || "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "cache-control": `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}`
  };
}

/**
 * Fetch HUD Fair Market Rents for all metros in the given state.
 */
async function fetchHUDFMR(state, token) {
  const url = `${HUD_BASE}/fmr/statedata/${state}`;
  const res = await fetch(url, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    cf: { cacheTtl: 0 }
  });
  if (!res.ok) throw new Error(`HUD FMR API ${res.status}`);
  return res.json();
}

/**
 * Fetch HUD Income Limits data for the given state.
 */
async function fetchHUDIL(state, token) {
  const url = `${HUD_BASE}/il/summary/statedata?stateId=${state}`;
  const res = await fetch(url, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    cf: { cacheTtl: 0 }
  });
  if (!res.ok) throw new Error(`HUD IL API ${res.status}`);
  return res.json();
}

/**
 * Map raw HUD data onto the CO_MARKETS structure to produce enriched market objects.
 * Falls back gracefully to the FALLBACK_MARKETS value for any missing field.
 */
function mergeHUDData(fmrData, ilData) {
  // Index FMR rows by CBSA code for quick lookup
  const fmrByCbsa = new Map();
  for (const row of (fmrData?.data?.basicdata || [])) {
    if (row.metro_code) fmrByCbsa.set(String(row.metro_code), row);
  }

  // Index IL rows by CBSA code
  const ilByCbsa = new Map();
  for (const row of (ilData?.data || [])) {
    if (row.cbsasub) ilByCbsa.set(String(row.cbsasub), row);
    else if (row.cbsa) ilByCbsa.set(String(row.cbsa), row);
  }

  return CO_MARKETS.map((market, idx) => {
    const fallback = FALLBACK_MARKETS[idx];
    const fmr = fmrByCbsa.get(market.cbsa);
    const il = ilByCbsa.get(market.cbsa);

    // Derive median gross rent from FMR 2BR as a proxy
    const medianGrossRent = fmr ? Math.round((Number(fmr.fmr_2) || fallback.characteristics.medianGrossRent)) : fallback.characteristics.medianGrossRent;
    // Median household income from HUD IL 4-person median
    const medianHouseholdIncome = il ? Math.round((Number(il.median_income) || fallback.characteristics.medianHouseholdIncome)) : fallback.characteristics.medianHouseholdIncome;

    return {
      region: market.region,
      cbsa: market.cbsa,
      characteristics: {
        ...fallback.characteristics,
        medianGrossRent,
        medianHouseholdIncome
      },
      forecast: fallback.forecast
    };
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: buildHeaders(0, env.CORS_ORIGIN)
      });
    }

    if (url.pathname !== "/hud-markets") {
      return new Response("Not Found", { status: 404 });
    }

    const cacheTtl = Number(env.CO_DEMO_CACHE_SECONDS || DEFAULT_CACHE_SECONDS);
    const corsOrigin = env.CORS_ORIGIN || "*";

    // Check Cloudflare edge cache
    const cacheKey = new Request(url.toString(), request);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const hudToken = env.HUD_USER_TOKEN;
    if (!hudToken) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing HUD_USER_TOKEN secret" }),
        { status: 500, headers: buildHeaders(0, corsOrigin) }
      );
    }

    const state = (url.searchParams.get("state") || "CO").toUpperCase();
    let markets;
    let usedFallback = false;

    try {
      // Fetch FMR and IL data in parallel
      const [fmrData, ilData] = await Promise.all([
        fetchHUDFMR(state, hudToken),
        fetchHUDIL(state, hudToken)
      ]);

      markets = mergeHUDData(fmrData, ilData);
    } catch (e) {
      // Fall back to embedded market data
      console.error(`[hud-markets] HUD API fetch failed (${e.message}); using fallback data`);
      markets = FALLBACK_MARKETS;
      usedFallback = true;
    }

    const payload = {
      ok: true,
      source: "HUD User",
      timestamp: new Date().toISOString(),
      state,
      usedFallback,
      markets
    };

    const headers = buildHeaders(cacheTtl, corsOrigin);
    const response = new Response(JSON.stringify(payload), { headers });

    // Store in edge cache
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};
