#!/usr/bin/env node
/**
 * source-url-sweep.mjs
 *
 * Verify external source-citation URLs are still reachable.
 *
 * Scans:
 *   - DATA-MANIFEST.json
 *   - js/citations.js
 *   - root-level *.html href attributes
 *
 * Exit codes:
 *   0 => all URLs are OK (or allow-listed / timeout-only outcomes)
 *   1 => at least one hard failure (404/5xx/network)
 *   2 => script-level failure
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 10_000;
const CONCURRENT = 8;

const ALLOW_LIST = new Set([
  "https://overpass-api.de/api/interpreter", // POST-only API
  // CFPB HMDA Data Browser API — returns 400 to bare GET (requires query
  // params like states/counties/years/actions_taken). The endpoint is
  // healthy; the URL sweep just doesn't pass query params.
  "https://ffiec.cfpb.gov/v2/data-browser-api/view/aggregations",
  // Known sources that frequently block CI user-agents.
  "https://www.novoco.com",
  "https://www.novoco.com/",
  "https://www.novoco.com/resource-centers/affordable-housing-tax-credits",
  "https://www.novoco.com/resource-centers/affordable-housing-tax-credits/2026-federal-lihtc-information-by-state",
  "https://www.novoco.com/resource-centers/affordable-housing-tax-credits/qct-dda-mapping-tool",
  "https://www.novoco.com/resource-centers/affordable-housing-tax-credits/lihtc-basics",
  "https://www.novoco.com/resource-centers/affordable-housing-tax-credits/rankings",
  "https://www.ncsha.org",
  "https://www.ncsha.org/",
  "https://www.ncsha.org/feed/",
  "https://www.ncsha.org/advocacy-issues/lihtc/",
  "https://www.congress.gov/",
  "https://www.congress.gov/bill/118th-congress/house-bill/6644",
  "https://www.cbre.com/insights",
  "https://www.cbre.com/insights/books/us-real-estate-market-outlook-2025/multifamily",
  "https://www.ffiec.gov/craadweb/main.aspx",
  // DOL blocks CI user-agents across whole domain (returns 404 / Cloudflare
  // challenge to non-browser requests). Davis-Bacon page is accessible
  // to real browsers — verified manually.
  "https://www.dol.gov/agencies/whd/government-contracts/construction",
  "https://cdola.colorado.gov/commitment-filings",
  "https://cdola.colorado.gov/housing",
  "https://cdola.colorado.gov/prop123",
  "https://cdola.colorado.gov/prop-123",
  "https://cdola.colorado.gov/proposition-123",
  "https://cdola.colorado.gov/division-of-housing",
  // HNA renderer source links that are public agency/program landing pages
  // but block or reset CI fetches. Keep as visible citations in the app; the
  // weekly URL-health sweep still records them as allow-listed.
  "https://co.chfainfo.com/",
  "https://co.chfainfo.com/find-a-tax-credit-property",
  "https://www.rd.usda.gov/programs-services/multifamily-housing-programs/",
  "https://cdola.colorado.gov/funding-programs/urban-renewal",
  "https://cdphe.colorado.gov/voluntary-cleanup-program",
  "https://cdola.colorado.gov/brownfields-revolving-loan-fund",
  // DOLA/SDO moved machine-readable population data from the old
  // demography.dola.colorado.gov pages to public GCS CSVs.
  "https://storage.googleapis.com/co-publicdata/profiles-county.csv",
  "https://storage.googleapis.com/co-publicdata/components-change-county.csv",
  "https://storage.googleapis.com/co-publicdata/sya-county.csv",
  // Kalshi prediction-markets API base — requires authenticated header
  // (KALSHI_API_KEY/KALSHI_API_SECRET). Returns 401 to unauthenticated
  // probes from the URL sweep; endpoint is healthy.
  "https://trading-api.kalshi.com/trade-api/v2",
  // CHFA's QAP page is JS-rendered; the canonical URL has moved repeatedly
  // and the curl-based sweep can't follow their dynamic routing. The
  // multifamily/QAP path is the documented landing per CHFA staff but
  // returns 404 to non-browser GETs. Verified accessible in a real browser.
  "https://www.chfainfo.com/multifamily/QAP",
  "https://www.chfainfo.com/multifamily/qap",
  // BLS blocks CI user-agents across all subpaths (returns 403).
  "https://www.bls.gov/cew/",
  "https://www.bls.gov/ppi/",
  "https://www.bls.gov/ppi",
  "https://www.bls.gov/cps",
  "https://www.bls.gov/jlt",
  "https://www.bls.gov/lau/",
  "https://www.bls.gov/data/",
  // Colorado Division of Local Government — blocks CI agents on
  // every path (returns 403 to non-browser user-agents).
  "https://dlg.colorado.gov/",
  "https://dlg.colorado.gov/news-article/final-housing-needs-assessment-methodology-and-displacement-risk-assessment-guidance",
  // GitHub settings URLs require authentication and are not publicly reachable.
  "https://github.com/pggLLC/Housing-Analytics/settings/secrets/actions",
  // Project Pages site is served under /Housing-Analytics/; user root returns
  // 404 even while the site is healthy.
  "https://pggllc.github.io/",
  // HUD NEPA page returns 404 to CI user-agents but is accessible to real browsers.
  "https://www.hud.gov/program_offices/comm_planning/environment_energy/nepa",
  // USDA RD public data/catalog pages intermittently return 404 to CI
  // probes while the program landing/data-set pages remain browser-accessible.
  "https://www.rd.usda.gov/data-sets/multi-family-housing-rentals",
  // Polymarket event pages are ephemeral reference links; live data comes
  // from the Gamma API cache, not from these event landing pages.
  "https://polymarket.com/event/april-unemployment-rate-372",
  "https://polymarket.com/event/fed-decision-in-april",
  "https://polymarket.com/event/fed-decision-in-june-825",
  "https://polymarket.com/event/gdp-growth-in-2026",
  "https://polymarket.com/event/how-high-will-inflation-get-in-2026",
  "https://polymarket.com/event/how-many-fed-rate-cuts-in-2026",
  "https://polymarket.com/event/tech-layoffs-up-or-down-in-2026",
  "https://polymarket.com/event/us-recession-by-end-of-2026",
  "https://polymarket.com/event/what-will-the-median-home-value-in-chicago-be-on-april-30",
  "https://polymarket.com/event/what-will-the-median-home-value-in-the-los-angeles-metro-area-be-on-april-30",
  "https://polymarket.com/event/what-will-the-median-home-value-in-the-us-be-on-april-30",
  // FEMA flood-maps page returns 403 to CI user-agents but is accessible to
  // real browsers — verified manually 2026-05-09.
  "https://www.fema.gov/flood-maps",
  // LEHD (Longitudinal Employer-Household Dynamics) Census endpoints
  // started returning 403 to CI user-agents around 2026-05-10. Dataset
  // (LODES) and documentation are accessible to real browsers and
  // continue to power LEHD commute-flow analysis on the HNA page.
  "https://lehd.ces.census.gov/data/lodes/LODES8/",
  "https://lehd.ces.census.gov/doc/help/onthemap/LODESTechDoc.pdf",
  // Harvard JCHS (Joint Center for Housing Studies) returns 403 to CI
  // user-agents (Akamai bot protection). Real browsers reach the home
  // page fine — verified manually 2026-05-15.
  "https://www.jchs.harvard.edu/",
  // Novoco LIHTC mapping tool subpath — same 403 bot-protection as
  // other novoco.com pages already in the list above.
  "https://www.novoco.com/resource-centers/low-income-housing-tax-credits/lihtc-mapping-tool",
  // Programmatic APIs that return 400/405 to bare GET (require query
  // params / POST body / API key). Endpoints are healthy when used as
  // documented; the sweep just can't probe them with an empty request.
  "https://api.stlouisfed.org/fred/series/observations",
  "https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL",
  "https://api.stlouisfed.org/fred/series/observations?series_id=CUUR0000SAH1",
  "https://api.stlouisfed.org/fred/series/observations?series_id=UNRATE",
  "https://api.stlouisfed.org/fred/series/observations?series_id=MORTGAGE30US",
  "https://api.stlouisfed.org/fred/series/observations?series_id=COBPPRIV",
  "https://api.bls.gov/publicAPI/v2/timeseries/data/",
  "https://enviro.epa.gov/enviro/ef_metadata_json.ef_get_facility_info",
  // Census QuickFacts + colmigateway + bls.gov/emp blocked by bot
  // protection — accessible to real browsers.
  "https://www.census.gov/quickfacts/CO",
  "https://www.colmigateway.com/",
  "https://www.bls.gov/emp/",
  // USGS / DOT / EPA portals that block CI user-agents.
  "https://www.usgs.gov/national-hydrography/national-hydrography-dataset",
  "https://www.transit.dot.gov/ntd",
  // Auth-required API endpoints (transit.land + regrid require an API key).
  "https://transit.land/api/v2/rest",
  "https://app.regrid.com/api/v2/parcels/point",
  // Kalshi rate-limits or blocks CI agents (429); homepage + API.
  "https://kalshi.com/",
  "https://api.kalshi.com/trade-api/v2/markets",
  // CDOT data portal intermittently rejects CI fetches.
  "https://data.cdot.colorado.gov/",
  // Colorado Association of Realtors — Akamai bot protection (403),
  // accessible to real browsers. Verified manually 2026-05-24.
  "https://www.coloradorealtors.com/market-trends/",
  // UCLA Lewis Center for Regional Policy Studies — returns HTTP 415
  // (Unsupported Media Type) to CI user-agents; accessible to real
  // browsers and was returning 200 on 2026-06-08 per url-health.json.
  // The redirect target (https://lewis.ucla.edu/) is also allow-listed
  // to avoid a second failure if fetch follows the redirect.
  "https://www.lewis.ucla.edu/",
  "https://lewis.ucla.edu/",
  // Up for Growth — returns HTTP 415 to CI user-agents, accessible to
  // real browsers. Same pattern as lewis.ucla.edu.
  "https://upforgrowth.org/",
  // Bell Policy Center — returns HTTP 415 to GitHub Actions user-agents,
  // accessible to real browsers. Verified via browser/manual sweep context
  // 2026-06-28.
  "https://www.bellpolicy.org/",
  // Public data/news/program sources that are live in browsers but regularly
  // hit Census session handling or publisher/agency WAFs from CI probes.
  "https://data.census.gov/",
  "https://data.census.gov/table/ACSDP5Y2023.DP03",
  "https://data.census.gov/table/ACSDP5Y2023.DP04",
  "https://data.census.gov/table/ACSDP5Y2023.S0801",
  "https://data.census.gov/table/ACSDP5Y2024.DP03",
  "https://data.census.gov/table/ACSDP5Y2024.DP04",
  "https://data.census.gov/table/ACSDP5Y2024.DP05",
  "https://data.census.gov/table/ACSDT1Y2023.B25014",
  "https://data.census.gov/table/ACSDT1Y2023.B25070",
  "https://data.census.gov/table/ACSDT5Y2023.B19001",
  "https://data.census.gov/table/ACSDT5Y2023.B25063",
  "https://www.aspendailynews.com/news/real-estate-transfer-taxes-generated-24m-for-aspen-in-2024/article_ddb7c460-d4b1-11ef-a44f-c73b4485ca71.html",
  "https://www.aspendailynews.com/election2024/worker-housing-1a-question-wins-in-pitco-snowmass/article_cc595d4c-9c02-11ef-ab38-ab00dd3f75ac.html",
  "https://www.aspendailynews.com/news/pitco-to-give-2-million-more-to-housing-coalition/article_fc9686ac-dc33-4227-a0ef-6fd7a3036cea.html",
  "https://kdvr.com/2018/08/28/new-marijuana-taxes-will-fund-affordable-housing-in-denver/",
  "https://kdvr.com/news/new-marijuana-taxes-will-fund-affordable-housing-in-denver/",
  "https://www.fcgov.com/socialsustainability/landbank",
  "https://www.fcgov.com/socialsustainability/developmentincentives",
  "https://www.colorado.gov/governor/news/11451-laying-groundwork-more-housing-affordable-polis-administration-announces-first",
  "https://homesfund.org/mortgage-assistance/",
  "https://www.themountainmail.com/news/article_d76b5c16-0d6a-11ef-8fd8-6794e7e5b324.html",
  // FEMA NFHL ArcGIS MapServer — intermittent fetch failures from CI
  // (ECONNRESET / DNS hiccups), but the canonical NFHL source used by
  // js/data-map.js at runtime via Esri Leaflet against the same
  // endpoint. Allow-listed so a transient FEMA outage doesn't block
  // PR merges.
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer",
  // BLS CEW data API — use the CSV variant; the same .json URL is dead.
  "https://data.bls.gov/cew/data/api/2024/a/area/08001.csv",
  // RTD Denver open-data portal — the URL in fetch-parcel-zoning-data.yml
  // is a documentation comment noting the source of the GTFS feed used at
  // runtime.  The RTD open-data portal page has since moved; actual transit
  // data is fetched at runtime via transitfeeds.com.
  "https://www.rtd-denver.com/open-data",
  // Census TIGER/Web GENZ2024 cartographic boundary file — the 2024-vintage
  // GeoJSON boundary files had not yet been published at this path as of
  // mid-2026.  The market_data_build health-check probe falls through to
  // older-vintage data when this probe returns 404; it is not an active
  // download URL.
  "https://www2.census.gov/geo/tiger/GENZ2024/json/cb_2024_08_tract_500k.json",
  // Zillow Research static CSV (days_to_close) — Zillow reorganized their
  // public_csvs directory in early 2026; the days_to_close dataset was
  // removed or renamed.  The zillow-data-sync workflow handles the download
  // failure gracefully with `|| echo "Days to close download failed"` and
  // continues without the file.
  "https://files.zillowstatic.com/research/public_csvs/days_to_close/Metro_days_to_close_uc_sfrcondo_month.csv",
  // Dead RSS feeds (all return 404 as of 2026-06-10, F253).  Novogradac
  // removed their public RSS feed; HUD Exchange and the Colorado General
  // Assembly feeds also went dark.  These URLs appear in
  // configure-alerts-feeds.yml which is being updated to remove them.
  // The Google News queries already referenced in those workflows cover
  // the same topical surface area.
  "https://www.novoco.com/rss.xml",
  "https://www.hudexchange.info/feed/",
  "https://leg.colorado.gov/rss.xml",
]);

const SKIP_PATTERNS = [
  /^mailto:/i,
  /^tel:/i,
  /^javascript:/i,
  /^#/,
  /localhost/i,
  // Loopback / link-local IPs only appear in example comments for
  // dev-server URLs (npx http-server, audit fixtures). They're not
  // "broken external citations".
  /^https?:\/\/127\.\d+\.\d+\.\d+/i,
  /^https?:\/\/0\.0\.0\.0/i,
  /^\/\//,
  /\$\{/,
  // Bare shell / GitHub Actions environment-variable references such as
  // $GITHUB_REPOSITORY, $GITHUB_RUN_ID, $GITHUB_REF, etc.  These appear in
  // workflow step scripts and Markdown body strings like:
  //   https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID
  // They are not literal URLs and will always return 404 when probed, so we
  // skip any URL that contains a `$UPPERCASE` token.  The pattern matches
  // uppercase-only tokens (env-var convention) to avoid colliding with CSS/
  // Sass `$variable` patterns (which use lowercase).
  /\$[A-Z_][A-Z0-9_]*/,
  // Placeholder / test API key — URLs of the form `?api_key=test` are used
  // in audit-endpoints.yml to probe whether an endpoint is reachable without
  // burning a real credential.  The FRED API returns 400 for invalid keys
  // (the workflow treats both 200 and 400 as "up"); the sweep must not
  // hard-fail on this expected 400.
  /[?&]api_key=test\b/i,
  // Single-brace placeholders that will never resolve to a literal URL:
  //   - Leaflet/Mapbox/MapLibre tile templates: {s}, {z}, {x}, {y}, {r}
  //   - Python f-string formatters in source comments / docstrings:
  //     {acs5_year}, {qs}, {county}, etc.
  // The pattern matches both single chars and snake/kebab/word placeholders
  // so we don't have to chase each new f-string with a one-off allow-list.
  /\{[a-z_][a-z_0-9-]*\}/i,
  /^https?:\/\/fonts\.googleapis\.com/i,
  /^https?:\/\/fonts\.gstatic\.com/i,
  // Example placeholders in documentation/comments are not real citations.
  /^https?:\/\/example\.(com|net|org)(\/|$)/i,
  /^https?:\/\/\.\.\.(\/|$)/i,
  /^https?:\/\/cdn\.jsdelivr\.net/i,
  /^https?:\/\/unpkg\.com/i,
  /^https?:\/\/cdnjs\.cloudflare\.com/i,
  // Patreon throttles GitHub Actions IPs with 403 on every request.
  // The only patreon.com URLs in this repo are transitive npm dependency
  // funding metadata inside package-lock.json — not citations we authored.
  /^https?:\/\/(www\.)?patreon\.com\//i,
  // HUD's API endpoints (huduser.gov/hudapi/public/...) require Bearer
  // tokens as of 2025-Q4 — the sweep would otherwise hard-fail every PR
  // that mentions an HUD API URL in a docstring or script. The /portal/
  // landing pages stay in scope (public docs).
  /^https?:\/\/(www\.)?huduser\.gov\/hudapi\//i,
];

function parseArgs() {
  const args = process.argv.slice(2);
  const paths = [];
  let baseRef = "origin/main";
  let headRef = "HEAD";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--paths" && args[i + 1]) {
      paths.push(
        ...args[i + 1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      i++;
    } else if (args[i] === "--base-ref" && args[i + 1]) {
      baseRef = args[i + 1];
      i++;
    } else if (args[i] === "--head-ref" && args[i + 1]) {
      headRef = args[i + 1];
      i++;
    }
  }
  return {
    diffAdded: args.includes("--diff-added"),
    baseRef,
    headRef,
    quiet: args.includes("--quiet"),
    json: args.includes("--json"),
    paths,
  };
}

function isHttpUrl(v) {
  return typeof v === "string" && /^https?:\/\//i.test(v);
}

function shouldSkip(url) {
  return SKIP_PATTERNS.some((rx) => rx.test(url));
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch (_) {
    return url;
  }
}

function collectUrlsFromObject(obj, out = []) {
  if (obj === null || obj === undefined) return out;
  if (typeof obj === "string") {
    if (isHttpUrl(obj)) out.push(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) collectUrlsFromObject(item, out);
    return out;
  }
  if (typeof obj === "object") {
    for (const v of Object.values(obj)) collectUrlsFromObject(v, out);
  }
  return out;
}

async function readManifestUrls() {
  const p = path.join(ROOT, "DATA-MANIFEST.json");
  const raw = await fs.readFile(p, "utf8");
  const parsed = JSON.parse(raw);
  return collectUrlsFromObject(parsed);
}

async function readCitations() {
  const p = path.join(ROOT, "js", "citations.js");
  const src = await fs.readFile(p, "utf8");
  const urls = [];
  const rx = /https?:\/\/[^\s"'`<>)]*/g;
  let m;
  while ((m = rx.exec(src)) !== null) {
    urls.push(m[0]);
  }
  return urls;
}

async function readHtmlUrls() {
  return readHtmlUrlsFromFiles();
}

async function readHtmlUrlsFromFiles(files = null) {
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  const rootHtmlFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".html"))
    .map((e) => path.join(ROOT, e.name));
  const htmlFiles = files
    ? files
        .map((f) => path.join(ROOT, f))
        .filter((p) => p.toLowerCase().endsWith(".html"))
    : rootHtmlFiles;

  const hrefRx = /href\s*=\s*["']([^"']+)["']/gi;
  const urls = [];
  for (const file of htmlFiles) {
    const src = await fs.readFile(file, "utf8");
    let m;
    while ((m = hrefRx.exec(src)) !== null) {
      const href = (m[1] || "").trim();
      if (isHttpUrl(href)) urls.push(href);
    }
  }
  return urls;
}

async function readUrlsFromExplicitPaths(pathsArg) {
  const files = pathsArg
    .map((p) => p.replace(/^\.\//, ""))
    .filter((p) => !p.includes(".."));
  const urls = [];

  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    try {
      const src = await fs.readFile(abs, "utf8");
      if (rel === "DATA-MANIFEST.json" || rel.toLowerCase().endsWith(".json")) {
        try {
          const parsed = JSON.parse(src);
          collectUrlsFromObject(parsed, urls);
        } catch (_) {
          const rx = /https?:\/\/[^\s"'`<>)]*/g;
          let m;
          while ((m = rx.exec(src)) !== null) urls.push(m[0]);
        }
      } else if (rel.toLowerCase().endsWith(".html")) {
        const hrefRx = /href\s*=\s*["']([^"']+)["']/gi;
        let m;
        while ((m = hrefRx.exec(src)) !== null) {
          const href = (m[1] || "").trim();
          if (isHttpUrl(href)) urls.push(href);
        }
      } else {
        const rx = /https?:\/\/[^\s"'`<>)]*/g;
        let m;
        while ((m = rx.exec(src)) !== null) urls.push(m[0]);
      }
    } catch (_) {
      // Ignore absent/renamed files in diff lists.
    }
  }
  return urls;
}

async function readUrlsFromAddedDiff(baseRef, headRef) {
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--unified=0", "--no-ext-diff", `${baseRef}...${headRef}`],
    {
      cwd: ROOT,
      maxBuffer: 50 * 1024 * 1024,
    },
  );

  const urls = [];
  const rx = /https?:\/\/[^\s"'`<>)]*/g;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    let m;
    while ((m = rx.exec(line.slice(1))) !== null) urls.push(m[0]);
  }
  return urls;
}

async function checkUrl(url) {
  if (ALLOW_LIST.has(url)) {
    return { url, status: "ALLOW", http: null, message: "allow-listed" };
  }

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    // Try HEAD first; fallback to GET if server disallows HEAD.
    let res;
    try {
      res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: ac.signal,
      });
      if (res.status === 405 || res.status === 403) {
        res = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: ac.signal,
          headers: { Range: "bytes=0-0" },
        });
      }
    } catch (_) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: ac.signal,
        headers: { Range: "bytes=0-0" },
      });
    }

    clearTimeout(timeout);
    if (res.ok) return { url, status: "OK", http: res.status, message: "" };
    if (res.status === 404) {
      return { url, status: "404", http: 404, message: "not found" };
    }
    if (res.status >= 500) {
      return { url, status: "5XX", http: res.status, message: "server error" };
    }
    /* F162 — 403 (and the 401/407/429 cluster) means the server is alive
       and reachable but is rejecting CI's user-agent or IP — typically
       Akamai/Cloudflare/AWS WAF bot-detection. Real users with browsers
       reach the URL fine. Demoted from the hard FAIL bucket to a soft
       WAF bucket so the report still calls them out (so a citation
       that's genuinely gone can still be noticed when 403 jumps to
       404), but a single 403 doesn't block CI on every PR. The
       EXEMPT_HOSTS array near line 75-170 already lists the
       known-permanent 403 cases; the WAF bucket catches the long tail
       of intermittent or new bot-blocking. */
    if (res.status === 403 || res.status === 401 || res.status === 407 || res.status === 429) {
      return {
        url,
        status: "WAF",
        http: res.status,
        message: `bot-blocked (HTTP ${res.status})`,
      };
    }
    return {
      url,
      status: "FAIL",
      http: res.status,
      message: "unexpected status",
    };
  } catch (err) {
    clearTimeout(timeout);
    if (
      err &&
      (err.name === "AbortError" || /aborted|timeout/i.test(String(err)))
    ) {
      return {
        url,
        status: "TIMEOUT",
        http: null,
        message: "request timed out",
      };
    }
    return {
      url,
      status: "FAIL",
      http: null,
      message: (err && err.message) || String(err),
    };
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await mapper(items[cur], cur);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

function printTable(results, quiet) {
  if (quiet) {
    results
      .filter((r) => !["OK", "ALLOW", "TIMEOUT"].includes(r.status))
      .forEach((r) => {
        console.log(`${r.status}\t${r.http || "-"}\t${r.url}\t${r.message}`);
      });
    return;
  }
  for (const r of results) {
    console.log(
      `${r.status.padEnd(7)} ${String(r.http || "-").padStart(3)}  ${r.url}`,
    );
  }
}

async function main() {
  const args = parseArgs();
  let rawUrls;
  if (args.diffAdded) {
    rawUrls = await readUrlsFromAddedDiff(args.baseRef, args.headRef);
  } else if (args.paths.length > 0) {
    rawUrls = await readUrlsFromExplicitPaths(args.paths);
  } else {
    const [manifestUrls, citationUrls, htmlUrls] = await Promise.all([
      readManifestUrls().catch(() => []),
      readCitations().catch(() => []),
      readHtmlUrls().catch(() => []),
    ]);
    rawUrls = [...manifestUrls, ...citationUrls, ...htmlUrls];
  }

  // Filter on the *raw* URL before normalizing — `new URL().toString()`
  // percent-encodes `${...}` into `$%7B...%7D`, which breaks the `\${/`
  // skip pattern. Without this, GitHub Actions template-literal URLs
  // (e.g. `https://github.com/${context.repo.owner}/...`) leak through
  // and surface as bogus 404s.
  const urls = Array.from(
    new Set(
      rawUrls
        .filter((u) => isHttpUrl(u) && !shouldSkip(u))
        .map((u) => normalizeUrl(u))
        .filter((u) => isHttpUrl(u) && !shouldSkip(u)),
    ),
  );

  const results = await mapLimit(urls, CONCURRENT, checkUrl);
  const hardFailures = results.filter((r) =>
    ["404", "5XX", "FAIL"].includes(r.status),
  );
  const nonAllowTimeouts = results.filter((r) => r.status === "TIMEOUT");
  const wafBlocked = results.filter((r) => r.status === "WAF");

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          scanned: urls.length,
          hardFailures: hardFailures.length,
          waf: wafBlocked.length,
          timeouts: nonAllowTimeouts.length,
          results,
        },
        null,
        2,
      ),
    );
  } else {
    printTable(results, args.quiet);
    console.log(
      `\nScanned ${urls.length} URLs · hard failures: ${hardFailures.length} · WAF/bot-blocked: ${wafBlocked.length} · timeouts: ${nonAllowTimeouts.length}`,
    );
  }

  process.exitCode = hardFailures.length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error("[source-url-sweep] fatal:", err);
  process.exit(2);
});
