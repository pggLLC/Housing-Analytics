/**
 * housing-data-integration.js
 * Unified loader for all housing data sources used across the site.
 *
 * Sources:
 *   Census   — /api/co-ami-gap          (real-time serverless)
 *   HUD      — /api/hud-markets         (weekly serverless cache)
 *   Demo     — /api/co-demographics     (weekly serverless cache)
 *   Zillow   — /data/zillow-*.json      (weekly GitHub Actions)
 *   CAR      — /data/car-*.json         (monthly manual workflow)
 *   Kashli   — /data/kashli-market-data.json  (weekly GitHub Actions)
 *
 * Usage:
 *   const hdi = window.HousingDataIntegration;
 *   const all = await hdi.loadAllData();
 *   const car = hdi.getCachedData('car');
 *   const kashli = hdi.getCachedData('kashli');
 */
(function (global) {
  "use strict";

  // 1-hour in-memory cache (ms)
  const CACHE_TTL = 60 * 60 * 1000;

  const _cache = {};

  function _isFresh(entry) {
    return entry && (Date.now() - entry.ts) < CACHE_TTL;
  }

  function _set(key, data) {
    _cache[key] = { ts: Date.now(), data };
  }

  function _get(key) {
    const entry = _cache[key];
    return _isFresh(entry) ? entry.data : null;
  }

  async function _fetchJson(url) {
    const res = await fetch(url, { cache: "default" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }

  // ── Individual loaders ────────────────────────────────────────────

  /**
   * Load Census AMI gap data from serverless endpoint or local JSON fallback.
   */
  async function loadCensusData() {
    const cached = _get("census");
    if (cached) return cached;

    const cfg = (global.APP_CONFIG) || {};
    const url = (cfg.AMI_GAP_API_URL && String(cfg.AMI_GAP_API_URL).trim())
      || "data/co_ami_gap_by_county.json";

    try {
      const data = await _fetchJson(url);
      _set("census", data);
      return data;
    } catch (err) {
      console.warn("[HousingData] Census load failed:", err.message);
      return null;
    }
  }

  /**
   * Load HUD markets data from serverless endpoint.
   */
  async function loadHUDData() {
    const cached = _get("hud");
    if (cached) return cached;

    const cfg = (global.APP_CONFIG) || {};
    const url = (cfg.HUD_MARKETS_API_URL && String(cfg.HUD_MARKETS_API_URL).trim())
      || "data/hud-markets.json";

    try {
      const data = await _fetchJson(url);
      _set("hud", data);
      return data;
    } catch (err) {
      console.warn("[HousingData] HUD load failed:", err.message);
      return null;
    }
  }

  /**
   * Load Colorado demographics data from serverless endpoint.
   */
  async function loadDemographicsData() {
    const cached = _get("demographics");
    if (cached) return cached;

    const cfg = (global.APP_CONFIG) || {};
    const url = (cfg.DEMOGRAPHICS_API_URL && String(cfg.DEMOGRAPHICS_API_URL).trim())
      || "data/co-demographics.json";

    try {
      const data = await _fetchJson(url);
      _set("demographics", data);
      return data;
    } catch (err) {
      console.warn("[HousingData] Demographics load failed:", err.message);
      return null;
    }
  }

  /**
   * Load the most recent Zillow data file from /data/zillow-*.json.
   * Falls back to any matching file found via directory listing.
   */
  async function loadZillowData() {
    const cached = _get("zillow");
    if (cached) return cached;

    // Try a known recent filename pattern; the workflow writes zillow-YYYY-MM-DD.json
    const today = new Date();
    const candidates = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      candidates.push(`data/zillow-${iso}.json`);
    }

    for (const url of candidates) {
      try {
        const data = await _fetchJson(url);
        _set("zillow", data);
        return data;
      } catch (_) {
        // try next
      }
    }

    console.warn("[HousingData] No recent Zillow data file found.");
    return null;
  }

  /**
   * Load the most recent CAR market report from /data/car-market-report-YYYY-MM.json.
   */
  async function loadCARData() {
    const cached = _get("car");
    if (cached) return cached;

    const today = new Date();
    const candidates = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const ym = d.toISOString().slice(0, 7);
      candidates.push(`data/car-market-report-${ym}.json`);
    }

    for (const url of candidates) {
      try {
        const data = await _fetchJson(url);
        _set("car", data);
        return data;
      } catch (_) {
        // try next month
      }
    }

    console.warn("[HousingData] No recent CAR data file found.");
    return null;
  }

  /**
   * Load Kashli Colorado market data from /data/kashli-market-data.json.
   */
  async function loadKashliData() {
    const cached = _get("kashli");
    if (cached) return cached;

    try {
      const data = await _fetchJson("data/kashli-market-data.json");
      _set("kashli", data);
      return data;
    } catch (err) {
      console.warn("[HousingData] Kashli load failed:", err.message);
      return null;
    }
  }

  /**
   * Load all data sources in parallel and return a unified object.
   * Each source gracefully returns null on failure so the rest still load.
   *
   * @returns {Promise<{census, hud, demographics, zillow, car, kashli, metadata}>}
   */
  async function loadAllData() {
    const errors = [];
    const startTime = Date.now();

    const wrap = (promise, name) =>
      promise.catch(err => {
        errors.push({ source: name, message: err.message });
        return null;
      });

    const [census, hud, demographics, zillow, car, kashli] = await Promise.all([
      wrap(loadCensusData(),      "census"),
      wrap(loadHUDData(),         "hud"),
      wrap(loadDemographicsData(),"demographics"),
      wrap(loadZillowData(),      "zillow"),
      wrap(loadCARData(),         "car"),
      wrap(loadKashliData(),      "kashli"),
    ]);

    const sources = [];
    if (census)       sources.push("Census / ACS");
    if (hud)          sources.push("HUD Markets");
    if (demographics) sources.push("CO Demographics");
    if (zillow)       sources.push("Zillow");
    if (car)          sources.push("CAR");
    if (kashli)       sources.push("Kashli");

    const result = {
      census,
      hud,
      demographics,
      zillow,
      car,
      kashli,
      metadata: {
        lastUpdated: new Date(),
        loadTimeMs: Date.now() - startTime,
        sources,
        errors,
      },
    };

    console.info(
      `[HousingData] Loaded ${sources.length} source(s) in ${result.metadata.loadTimeMs}ms.`,
      errors.length ? `Errors: ${errors.map(e => e.source).join(", ")}` : ""
    );

    return result;
  }

  /**
   * Return cached data for a named source without re-fetching.
   * @param {"census"|"hud"|"demographics"|"zillow"|"car"} source
   */
  function getCachedData(source) {
    return _get(source);
  }

  // ── Public API ────────────────────────────────────────────────────

  global.HousingDataIntegration = {
    loadCensusData,
    loadHUDData,
    loadDemographicsData,
    loadZillowData,
    loadCARData,
    loadKashliData,
    loadAllData,
    getCachedData,
  };
})(window);
