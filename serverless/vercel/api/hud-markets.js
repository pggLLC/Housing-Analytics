// Vercel Serverless Function: /api/hud-markets
//
// Fetches HUD market analysis data (FMR + Income Limits) for Colorado
// metropolitan areas and returns enriched market characteristics.
// Falls back to embedded data if the HUD API is unavailable.
//
// Environment variables (set in Vercel project settings):
// - HUD_USER_TOKEN         (required)  HUD USER API Bearer token
// - CO_DEMO_CACHE_SECONDS  (optional)  Cache TTL in seconds; default 604800 (7 days)
//
// Query params:
// - state=CO  (default "CO")
//
// References:
// - HUD User API: https://www.huduser.gov/portal/dataset/fmr-api.html

const HUD_BASE = "https://www.huduser.gov/hudapi/public";
const DEFAULT_CACHE_SECONDS = 604800; // 7 days

const CO_MARKETS = [
  { region: "Denver-Aurora-Lakewood", cbsa: "19740", state: "CO" },
  { region: "Colorado Springs", cbsa: "17820", state: "CO" },
  { region: "Fort Collins", cbsa: "22660", state: "CO" },
  { region: "Greeley", cbsa: "24540", state: "CO" },
  { region: "Boulder", cbsa: "14500", state: "CO" },
  { region: "Pueblo", cbsa: "39380", state: "CO" },
  { region: "Grand Junction", cbsa: "24300", state: "CO" }
];

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

async function fetchHUDFMR(state, token) {
  const url = `${HUD_BASE}/fmr/statedata/${state}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HUD FMR API ${res.status}`);
  return res.json();
}

async function fetchHUDIL(state, token) {
  const url = `${HUD_BASE}/il/summary/statedata?stateId=${state}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HUD IL API ${res.status}`);
  return res.json();
}

function mergeHUDData(fmrData, ilData) {
  const fmrByCbsa = new Map();
  for (const row of (fmrData?.data?.basicdata || [])) {
    if (row.metro_code) fmrByCbsa.set(String(row.metro_code), row);
  }

  const ilByCbsa = new Map();
  for (const row of (ilData?.data || [])) {
    if (row.cbsasub) ilByCbsa.set(String(row.cbsasub), row);
    else if (row.cbsa) ilByCbsa.set(String(row.cbsa), row);
  }

  return CO_MARKETS.map((market, idx) => {
    const fallback = FALLBACK_MARKETS[idx];
    const fmr = fmrByCbsa.get(market.cbsa);
    const il = ilByCbsa.get(market.cbsa);

    const medianGrossRent = fmr
      ? Math.round(Number(fmr.fmr_2) || fallback.characteristics.medianGrossRent)
      : fallback.characteristics.medianGrossRent;
    const medianHouseholdIncome = il
      ? Math.round(Number(il.median_income) || fallback.characteristics.medianHouseholdIncome)
      : fallback.characteristics.medianHouseholdIncome;

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

export default async function handler(req, res) {
  const cacheTtl = Number(process.env.CO_DEMO_CACHE_SECONDS || DEFAULT_CACHE_SECONDS);

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const hudToken = process.env.HUD_USER_TOKEN;
  if (!hudToken) {
    return res.status(500).json({ ok: false, error: "Missing HUD_USER_TOKEN" });
  }

  const state = (req.query.state || "CO").toUpperCase();
  let markets;
  let usedFallback = false;

  try {
    const [fmrData, ilData] = await Promise.all([
      fetchHUDFMR(state, hudToken),
      fetchHUDIL(state, hudToken)
    ]);
    markets = mergeHUDData(fmrData, ilData);
  } catch (e) {
    console.error(`[hud-markets] HUD API fetch failed (${e.message}); using fallback data`);
    markets = FALLBACK_MARKETS;
    usedFallback = true;
  }

  res.setHeader("Cache-Control", `public, s-maxage=${cacheTtl}, stale-while-revalidate=86400`);
  return res.status(200).json({
    ok: true,
    source: "HUD User",
    timestamp: new Date().toISOString(),
    state,
    usedFallback,
    markets
  });
}
