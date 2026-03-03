// Vercel Serverless Function: /api/co-demographics
//
// Fetches Colorado population, housing, and migration forecasts from the
// Colorado State Demography Office (SDO) and returns them as JSON.
// Falls back to embedded data if the SDO APIs are unavailable.
//
// Environment variables (set in Vercel project settings):
// - CO_DEMO_CACHE_SECONDS  (optional)  Cache TTL in seconds; default 604800 (7 days)
//
// References:
// - CO SDO Data Portal: https://demography.dola.colorado.gov/
// - CO SDO GIS API:     https://gis.dola.colorado.gov/population/

const CO_SDO_BASE = "https://gis.dola.colorado.gov/population";
const FORECAST_YEARS = [2025, 2030, 2035, 2040, 2050];
const DEFAULT_CACHE_SECONDS = 604800; // 7 days

// Fallback data for when the SDO API is unavailable
const FALLBACK_DATA = {
  populationForecast: [
    { county: "Adams", fips: "001", forecasts: [{ year: 2025, population: 560000 }, { year: 2030, population: 610000 }, { year: 2040, population: 705000 }] },
    { county: "Arapahoe", fips: "005", forecasts: [{ year: 2025, population: 700000 }, { year: 2030, population: 750000 }, { year: 2040, population: 845000 }] },
    { county: "Boulder", fips: "013", forecasts: [{ year: 2025, population: 335000 }, { year: 2030, population: 350000 }, { year: 2040, population: 375000 }] },
    { county: "Denver", fips: "031", forecasts: [{ year: 2025, population: 730000 }, { year: 2030, population: 780000 }, { year: 2040, population: 870000 }] },
    { county: "El Paso", fips: "041", forecasts: [{ year: 2025, population: 760000 }, { year: 2030, population: 820000 }, { year: 2040, population: 935000 }] },
    { county: "Jefferson", fips: "059", forecasts: [{ year: 2025, population: 590000 }, { year: 2030, population: 620000 }, { year: 2040, population: 675000 }] },
    { county: "Larimer", fips: "069", forecasts: [{ year: 2025, population: 375000 }, { year: 2030, population: 405000 }, { year: 2040, population: 465000 }] },
    { county: "Weld", fips: "123", forecasts: [{ year: 2025, population: 360000 }, { year: 2030, population: 410000 }, { year: 2040, population: 505000 }] }
  ],
  housingForecast: [
    { county: "Adams", fips: "001", forecasts: [{ year: 2025, units: 205000 }, { year: 2030, units: 230000 }, { year: 2040, units: 270000 }] },
    { county: "Arapahoe", fips: "005", forecasts: [{ year: 2025, units: 265000 }, { year: 2030, units: 290000 }, { year: 2040, units: 335000 }] },
    { county: "Boulder", fips: "013", forecasts: [{ year: 2025, units: 135000 }, { year: 2030, units: 143000 }, { year: 2040, units: 157000 }] },
    { county: "Denver", fips: "031", forecasts: [{ year: 2025, units: 355000 }, { year: 2030, units: 385000 }, { year: 2040, units: 440000 }] },
    { county: "El Paso", fips: "041", forecasts: [{ year: 2025, units: 295000 }, { year: 2030, units: 325000 }, { year: 2040, units: 380000 }] },
    { county: "Jefferson", fips: "059", forecasts: [{ year: 2025, units: 235000 }, { year: 2030, units: 252000 }, { year: 2040, units: 280000 }] },
    { county: "Larimer", fips: "069", forecasts: [{ year: 2025, units: 155000 }, { year: 2030, units: 170000 }, { year: 2040, units: 197000 }] },
    { county: "Weld", fips: "123", forecasts: [{ year: 2025, units: 140000 }, { year: 2030, units: 162000 }, { year: 2040, units: 205000 }] }
  ],
  migration: [
    { region: "Denver Metro", netMigration2020: 18500, netMigration2021: 22000, netMigration2022: 15200, netMigration2023: 12800 },
    { region: "Front Range (non-Denver)", netMigration2020: 12000, netMigration2021: 16500, netMigration2022: 11000, netMigration2023: 9500 },
    { region: "Mountain / Resort", netMigration2020: 8200, netMigration2021: 10500, netMigration2022: 6800, netMigration2023: 5200 },
    { region: "Eastern Plains", netMigration2020: -800, netMigration2021: -600, netMigration2022: -900, netMigration2023: -750 },
    { region: "San Luis Valley", netMigration2020: -300, netMigration2021: -150, netMigration2022: -400, netMigration2023: -280 }
  ]
};

async function fetchPopulationForecast() {
  const yearList = FORECAST_YEARS.join(",");
  const url = `${CO_SDO_BASE}/population?county=all&year=${yearList}&type=forecast`;
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "co-demographics-vercel" } });
  if (!res.ok) throw new Error(`CO SDO population API ${res.status}`);
  const raw = await res.json();

  const byCounty = new Map();
  for (const row of (Array.isArray(raw) ? raw : (raw.data || []))) {
    const key = row.fips || row.county;
    if (!byCounty.has(key)) {
      byCounty.set(key, { county: row.county || row.county_name, fips: row.fips, forecasts: [] });
    }
    byCounty.get(key).forecasts.push({ year: Number(row.year), population: Number(row.population || row.forecast_pop) });
  }
  return Array.from(byCounty.values());
}

async function fetchHousingForecast() {
  const yearList = FORECAST_YEARS.join(",");
  const url = `${CO_SDO_BASE}/housing?county=all&year=${yearList}&type=forecast`;
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "co-demographics-vercel" } });
  if (!res.ok) throw new Error(`CO SDO housing API ${res.status}`);
  const raw = await res.json();

  const byCounty = new Map();
  for (const row of (Array.isArray(raw) ? raw : (raw.data || []))) {
    const key = row.fips || row.county;
    if (!byCounty.has(key)) {
      byCounty.set(key, { county: row.county || row.county_name, fips: row.fips, forecasts: [] });
    }
    byCounty.get(key).forecasts.push({ year: Number(row.year), units: Number(row.housing_units || row.units) });
  }
  return Array.from(byCounty.values());
}

async function fetchMigration() {
  const url = `${CO_SDO_BASE}/migration?region=all`;
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "co-demographics-vercel" } });
  if (!res.ok) throw new Error(`CO SDO migration API ${res.status}`);
  const raw = await res.json();
  return Array.isArray(raw) ? raw : (raw.data || []);
}

export default async function handler(req, res) {
  const cacheTtl = Number(process.env.CO_DEMO_CACHE_SECONDS || DEFAULT_CACHE_SECONDS);

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  let data;
  let usedFallback = false;

  try {
    const [populationForecast, housingForecast, migration] = await Promise.all([
      fetchPopulationForecast(),
      fetchHousingForecast(),
      fetchMigration()
    ]);

    if (!populationForecast.length && !housingForecast.length) {
      throw new Error("CO SDO returned empty data");
    }

    data = {
      populationForecast: populationForecast.length ? populationForecast : FALLBACK_DATA.populationForecast,
      housingForecast: housingForecast.length ? housingForecast : FALLBACK_DATA.housingForecast,
      migration: migration.length ? migration : FALLBACK_DATA.migration
    };
  } catch (e) {
    console.error(`[co-demographics] Live fetch failed (${e.message}); using fallback data`);
    data = FALLBACK_DATA;
    usedFallback = true;
  }

  res.setHeader("Cache-Control", `public, s-maxage=${cacheTtl}, stale-while-revalidate=86400`);
  return res.status(200).json({
    ok: true,
    source: "Colorado State Demography Office",
    timestamp: new Date().toISOString(),
    usedFallback,
    data
  });
}
