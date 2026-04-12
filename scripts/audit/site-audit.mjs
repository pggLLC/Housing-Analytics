/**
 * site-audit.mjs
 * Playwright-based site audit runner.
 *
 * Usage:
 *   AUDIT_BASE_URL=http://127.0.0.1:8080 node scripts/audit/site-audit.mjs
 *
 * Outputs JSON + HTML reports to audit-report/{timestamp}/
 * Exits non-zero only for hard failures:
 *   - JS runtime errors
 *   - Missing local data files (4xx on local requests)
 *   - ArcGIS failures (5xx or network error on map service URLs)
 *
 * TIGERweb (tigerweb.geo.census.gov) requests are intercepted and mocked
 * to prevent CI failures caused by external service unavailability.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:8080';
const REPORT_DIR_BASE = path.resolve(__dirname, '..', '..', 'audit-report');

const PAGES_TO_AUDIT = [
  // Map-heavy pages (Critical / High priority)
  { name: 'colorado-deep-dive',       path: '/colorado-deep-dive.html' },
  { name: 'state-allocation-map',     path: '/state-allocation-map.html' },
  { name: 'LIHTC-dashboard',          path: '/LIHTC-dashboard.html' },
  { name: 'housing-needs-assessment', path: '/housing-needs-assessment.html' },
  { name: 'market-analysis',          path: '/market-analysis.html' },
  // Data-rich pages (Medium priority)
  { name: 'index',                    path: '/' },
  { name: 'economic-dashboard',       path: '/economic-dashboard.html' },
  { name: 'colorado-market',          path: '/colorado-market.html' },
  { name: 'market-intelligence',      path: '/market-intelligence.html' },
  // Informational pages (Low priority)
  { name: 'dashboard',                path: '/dashboard.html' },
  { name: 'regional',                 path: '/regional.html' },
  { name: 'compliance-dashboard',     path: '/compliance-dashboard.html' },
  { name: 'census-dashboard',         path: '/census-dashboard.html' },
  { name: 'chfa-portfolio',           path: '/chfa-portfolio.html' },
  { name: 'construction-commodities', path: '/construction-commodities.html' },
  { name: 'cra-expansion-analysis',   path: '/cra-expansion-analysis.html' },
  { name: 'insights',                 path: '/insights.html' },
  // Static / article pages
  { name: 'about',                    path: '/about.html' },
  { name: 'article-pricing',          path: '/article-pricing.html' },
  { name: 'housing-legislation-2026', path: '/housing-legislation-2026.html' },
  { name: 'lihtc-enhancement-ahcia',  path: '/lihtc-enhancement-ahcia.html' },
  { name: 'lihtc-guide',              path: '/lihtc-guide-for-stakeholders.html' },
  { name: 'privacy-policy',           path: '/privacy-policy.html' },
];

// Patterns that indicate hard failures when a request fails
const HARD_FAIL_URL_PATTERNS = [
  /arcgis\.com/i,
  /services\.arcgisonline\.com/i,
  /gis\.ffiec\.gov/i,
];

// TIGERweb requests are intercepted and mocked to avoid CI network failures
const TIGERWEB_URL_PATTERN = /tigerweb\.geo\.census\.gov/i;

// CHFA LIHTC ArcGIS FeatureServer requests are intercepted and mocked to avoid CI network failures.
// Matches the org-specific ArcGIS REST endpoint used by co-lihtc-map.js and data-service.js.
const CHFA_LIHTC_URL_PATTERN = /services\.arcgis\.com\/VTyQ9soqVukalItT\//i;

// Console message types treated as hard failures
const HARD_FAIL_CONSOLE_LEVELS = ['error'];

// URL patterns for requests we want to verify actually fired (map/data)
const MAP_DATA_PATTERNS = [
  /arcgis/i,
  /tigerweb/i,
  /census\.gov/i,
  /api\.census\.gov/i,
  /fred\.stlouisfed\.org/i,
  /hud\.gov/i,
  /\.json$/i,
];

function isLocalUrl(url) {
  return url.startsWith(BASE_URL) || url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost');
}

function isHardFailUrl(url) {
  return HARD_FAIL_URL_PATTERNS.some(p => p.test(url));
}

/**
 * Returns a minimal mock response body for a TIGERweb ArcGIS REST request.
 * Handles both GeoJSON (f=geojson) and ArcGIS JSON (f=json) formats, as well
 * as service-info requests (no /query path segment).
 */
function mockTigerwebResponse(url) {
  // Approximate bounding box for a Colorado county (used as a stand-in polygon)
  const MOCK_POLYGON_COORDS = [
    [-105.5, 37.0], [-104.5, 37.0], [-104.5, 38.0], [-105.5, 38.0], [-105.5, 37.0],
  ];
  const mockGeometry = { type: 'Polygon', coordinates: [MOCK_POLYGON_COORDS] };
  const mockAttributes = {
    NAME: 'Mock County',
    NAMELSAD: 'Mock County',
    STATEFP: '08',
    GEOID: '08001',
    COUNTYFP: '001',
  };

  // ArcGIS JSON format (f=json)
  if (/[?&]f=json(&|$)/i.test(url)) {
    return {
      geometryType: 'esriGeometryPolygon',
      features: [{
        attributes: { ...mockAttributes, OBJECTID: 1 },
        geometry: null,
      }],
    };
  }

  // Service info endpoint (no /query segment)
  if (!/\/query(\?|$)/i.test(url)) {
    return {
      currentVersion: 10.81,
      serviceDescription: 'TIGERweb (mocked for CI)',
      layers: [{ id: 1, name: 'Counties', type: 'Feature Layer' }],
    };
  }

  // Default: GeoJSON FeatureCollection
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: mockGeometry, properties: mockAttributes }],
  };
}

/**
 * Returns a minimal mock response body for a CHFA LIHTC ArcGIS REST request.
 * Handles the /layers service-info endpoint as well as /query endpoints in
 * both GeoJSON (f=geojson) and ArcGIS JSON (f=json) formats.
 */
function mockChfaLihtcResponse(url) {
  // /layers endpoint — return a single-layer service descriptor
  if (/\/layers(\?|$)/i.test(url)) {
    return {
      layers: [{ id: 0, name: 'LIHTC', type: 'Feature Layer' }],
      tables: [],
    };
  }

  const MOCK_POINT = [-104.9903, 39.7392]; // Denver, CO

  // ArcGIS JSON format (f=json)
  if (/[?&]f=json(&|$)/i.test(url)) {
    return {
      features: [{
        attributes: {
          OBJECTID: 1,
          Proj_Name: 'Mock LIHTC Project',
          Proj_St: 'CO',
          CNTY_FIPS: '08031',
        },
        geometry: { x: MOCK_POINT[0], y: MOCK_POINT[1], spatialReference: { wkid: 4326 } },
      }],
      exceededTransferLimit: false,
    };
  }

  // Default: GeoJSON FeatureCollection (f=geojson or unspecified)
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: MOCK_POINT },
      properties: {
        Proj_Name: 'Mock LIHTC Project',
        Proj_St: 'CO',
        CNTY_FIPS: '08031',
      },
    }],
  };
}

async function auditPage(browser, pageConfig) {
  const url = BASE_URL + pageConfig.path;
  const result = {
    name: pageConfig.name,
    url,
    consoleErrors: [],
    failedRequests: [],
    firedRequests: [],
    mapDataRequests: [],
    leafletDetected: false,
    mapContainerFound: false,
    hardFailures: [],
    warnings: [],
  };

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Intercept TIGERweb requests and return mock GeoJSON to avoid CI network failures
  await page.route(TIGERWEB_URL_PATTERN, async (route) => {
    const reqUrl = route.request().url();
    console.log(`    [mock] TIGERweb intercepted: ${reqUrl}`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockTigerwebResponse(reqUrl)),
    });
  });

  // Intercept CHFA LIHTC ArcGIS FeatureServer requests to avoid CI network failures.
  // The page has local-JSON and embedded fallbacks, but the failed request itself
  // triggers a hard-failure in the audit before the fallback logic can run.
  await page.route(CHFA_LIHTC_URL_PATTERN, async (route) => {
    const reqUrl = route.request().url();
    console.log(`    [mock] CHFA LIHTC ArcGIS intercepted: ${reqUrl}`);
    // Rule 9: every ArcGIS FeatureServer /query must include outSR=4326.
    // The /layers endpoint is metadata-only so the check is skipped for it.
    if (/\/query(\?|$)/i.test(reqUrl) && !/[?&]outSR=4326(&|$)/i.test(reqUrl)) {
      console.warn(`    [Rule 9 violation] ArcGIS query is missing outSR=4326: ${reqUrl}`);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockChfaLihtcResponse(reqUrl)),
    });
  });

  // Inject fetch/XHR hooks to track all network requests from page JS
  await page.addInitScript(() => {
    window.__auditRequests = [];
    const origFetch = window.fetch;
    window.fetch = function(input, init) {
      const reqUrl = typeof input === 'string' ? input : (input && input.url) || String(input);
      window.__auditRequests.push({ type: 'fetch', url: reqUrl, ts: Date.now() });
      return origFetch.apply(this, arguments);
    };

    const XHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      window.__auditRequests.push({ type: 'xhr', url: String(url), ts: Date.now() });
      return XHROpen.apply(this, arguments);
    };
  });

  // Capture console errors
  page.on('console', (msg) => {
    if (HARD_FAIL_CONSOLE_LEVELS.includes(msg.type())) {
      const text = msg.text();
      // Ignore known benign errors from third-party content
      if (
        text.includes('favicon') ||
        text.includes('net::ERR_BLOCKED_BY_CLIENT') ||
        text.includes('ERR_INTERNET_DISCONNECTED')
      ) return;
      result.consoleErrors.push({ type: msg.type(), text, location: msg.location() });
    }
  });

  // Capture failed requests
  page.on('requestfailed', (req) => {
    const reqUrl = req.url();
    const failure = req.failure();
    const errorText = failure ? failure.errorText : 'unknown';
    const entry = {
      url: reqUrl,
      errorText,
      isLocal: isLocalUrl(reqUrl),
      isHardFail: isHardFailUrl(reqUrl),
    };
    result.failedRequests.push(entry);
    // net::ERR_ABORTED on a local request means the browser context closed while a
    // response body was still streaming (e.g. an API-health probe that checked r.ok
    // but never consumed the body).  Real missing files produce HTTP 4xx responses
    // that are caught by the response handler below, so we demote ERR_ABORTED on
    // local URLs to a warning to avoid false-positive hard failures.
    if (entry.isLocal && errorText === 'net::ERR_ABORTED') {
      result.warnings.push(`Local request aborted (body download interrupted): ${reqUrl}`);
    } else if (entry.isLocal || entry.isHardFail) {
      result.hardFailures.push(`Request failed: ${reqUrl} (${errorText})`);
    } else {
      result.warnings.push(`External request failed: ${reqUrl} (${errorText})`);
    }
  });

  // Track all responses to detect map/data requests firing
  page.on('response', (res) => {
    const reqUrl = res.url();
    const status = res.status();
    result.firedRequests.push({ url: reqUrl, status });

    // Check if it's a map/data request
    if (MAP_DATA_PATTERNS.some(p => p.test(reqUrl))) {
      result.mapDataRequests.push({ url: reqUrl, status });
    }

    // Local 4xx = hard failure (missing local data)
    if (isLocalUrl(reqUrl) && status >= 400 && status < 500) {
      result.hardFailures.push(`Local resource missing (HTTP ${status}): ${reqUrl}`);
    }

    // ArcGIS/Tigerweb 5xx = hard failure
    if (isHardFailUrl(reqUrl) && status >= 500) {
      result.hardFailures.push(`Map service error (HTTP ${status}): ${reqUrl}`);
    }
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    result.hardFailures.push(`Page load failed: ${e.message}`);
  }

  // Wait a bit more for lazy-loaded requests (e.g. API health probes fired by
  // setTimeout 2 s after DOMContentLoaded).
  await page.waitForTimeout(3000);

  // Wait for any fetches that were started during the above wait to finish before
  // closing the context.  This prevents open response-body streams from being
  // aborted and falsely reported as hard failures.
  try {
    await page.waitForLoadState('networkidle', { timeout: 10000 });
  } catch (_timeoutErr) {
    // If networkidle is never reached (e.g. pages with continuous polling) proceed
    // anyway — the ERR_ABORTED guard in the requestfailed handler handles any
    // remaining in-flight body downloads.
  }

  // Detect Leaflet presence
  result.leafletDetected = await page.evaluate(() => typeof window.L !== 'undefined');

  // Detect map containers
  result.mapContainerFound = await page.evaluate(() => {
    return document.querySelector('.leaflet-container, #map, [id*="map"], .map-container') !== null;
  });

  // Collect tracked requests from page context
  const pageRequests = await page.evaluate(() => window.__auditRequests || []);
  result.firedRequests.push(...pageRequests.map(r => ({ url: r.url, type: r.type, source: 'hook' })));

  await context.close();
  return result;
}

function generateHtmlReport(results, timestamp) {
  const totalHardFailures = results.reduce((n, r) => n + r.hardFailures.length, 0);
  const totalConsoleErrors = results.reduce((n, r) => n + r.consoleErrors.length, 0);
  const totalFailedRequests = results.reduce((n, r) => n + r.failedRequests.length, 0);

  const pageRows = results.map(r => {
    const status = r.hardFailures.length > 0 ? '❌ FAIL' : (r.warnings.length > 0 ? '⚠️ WARN' : '✅ PASS');
    const errList = r.hardFailures.map(f => `<li class="hard-fail">${escHtml(f)}</li>`).join('');
    const warnList = r.warnings.map(w => `<li class="warning">${escHtml(w)}</li>`).join('');
    const consoleList = r.consoleErrors.map(e => `<li>${escHtml(e.text)}</li>`).join('');
    const mapDataCount = r.mapDataRequests.length;

    return `
    <tr>
      <td><a href="${escHtml(r.url)}" target="_blank">${escHtml(r.name)}</a></td>
      <td>${status}</td>
      <td>${r.consoleErrors.length}</td>
      <td>${r.failedRequests.length}</td>
      <td>${mapDataCount}</td>
      <td>${r.leafletDetected ? '✅' : '—'}</td>
    </tr>
    ${errList || warnList || consoleList ? `
    <tr class="details-row">
      <td colspan="6">
        ${errList ? `<strong>Hard Failures:</strong><ul>${errList}</ul>` : ''}
        ${warnList ? `<strong>Warnings:</strong><ul>${warnList}</ul>` : ''}
        ${consoleList ? `<strong>Console Errors:</strong><ul>${consoleList}</ul>` : ''}
      </td>
    </tr>` : ''}`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Site Audit Report – ${timestamp}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #222; }
  h1 { color: #1a3a5c; }
  .summary { background: #f4f8ff; border-left: 4px solid #1a3a5c; padding: 1rem; margin: 1rem 0; }
  .fail { color: #c00; }
  .pass { color: #080; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }
  th { background: #1a3a5c; color: #fff; }
  tr:nth-child(even) { background: #f9f9f9; }
  .details-row td { background: #fff8f0; font-size: 0.9em; }
  ul { margin: 0.25rem 0; padding-left: 1.25rem; }
  li.hard-fail { color: #c00; }
  li.warning { color: #a60; }
</style>
</head>
<body>
<h1>Site Audit Report</h1>
<p>Generated: ${timestamp} | Base URL: ${escHtml(BASE_URL)}</p>
<div class="summary">
  <strong>Summary:</strong>
  Total hard failures: <span class="${totalHardFailures > 0 ? 'fail' : 'pass'}">${totalHardFailures}</span> |
  Console errors: ${totalConsoleErrors} |
  Failed requests: ${totalFailedRequests}
</div>
<table>
  <thead>
    <tr>
      <th>Page</th><th>Status</th><th>Console Errors</th><th>Failed Requests</th><th>Map/Data Requests</th><th>Leaflet</th>
    </tr>
  </thead>
  <tbody>${pageRows}</tbody>
</table>
</body>
</html>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.join(REPORT_DIR_BASE, timestamp);
  fs.mkdirSync(reportDir, { recursive: true });

  console.log(`Auditing ${PAGES_TO_AUDIT.length} pages at ${BASE_URL}`);
  console.log(`Report will be saved to: ${reportDir}`);

  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const pageConfig of PAGES_TO_AUDIT) {
    console.log(`  Auditing: ${pageConfig.name} (${pageConfig.path})`);
    try {
      const result = await auditPage(browser, pageConfig);
      results.push(result);
      const hfCount = result.hardFailures.length;
      const status = hfCount > 0 ? `FAIL (${hfCount} hard failures)` : 'PASS';
      console.log(`    → ${status}`);
      if (result.consoleErrors.length) console.log(`    Console errors: ${result.consoleErrors.length}`);
      if (result.failedRequests.length) console.log(`    Failed requests: ${result.failedRequests.length}`);
      if (result.mapDataRequests.length) console.log(`    Map/data requests fired: ${result.mapDataRequests.length}`);
    } catch (err) {
      console.error(`    ERROR auditing ${pageConfig.name}:`, err.message);
      results.push({
        name: pageConfig.name,
        url: BASE_URL + pageConfig.path,
        consoleErrors: [],
        failedRequests: [],
        firedRequests: [],
        mapDataRequests: [],
        leafletDetected: false,
        mapContainerFound: false,
        hardFailures: [`Audit error: ${err.message}`],
        warnings: [],
      });
    }
  }

  await browser.close();

  // Write JSON report
  const jsonReport = {
    timestamp,
    baseUrl: BASE_URL,
    pages: results,
    summary: {
      totalHardFailures: results.reduce((n, r) => n + r.hardFailures.length, 0),
      totalConsoleErrors: results.reduce((n, r) => n + r.consoleErrors.length, 0),
      totalFailedRequests: results.reduce((n, r) => n + r.failedRequests.length, 0),
    },
  };
  fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(jsonReport, null, 2));

  // Write HTML report
  const html = generateHtmlReport(results, timestamp);
  fs.writeFileSync(path.join(reportDir, 'report.html'), html);

  console.log(`\nReport written to: ${reportDir}`);
  console.log(`  report.json`);
  console.log(`  report.html`);

  const totalHardFailures = jsonReport.summary.totalHardFailures;
  if (totalHardFailures > 0) {
    console.error(`\n❌ Audit FAILED: ${totalHardFailures} hard failure(s) detected.`);
    results.forEach(r => {
      if (r.hardFailures.length) {
        console.error(`  [${r.name}]`);
        r.hardFailures.forEach(f => console.error(`    - ${f}`));
      }
    });
    process.exit(1);
  } else {
    console.log(`\n✅ Audit PASSED. No hard failures.`);
  }
}

main().catch(err => {
  console.error('Audit runner error:', err);
  process.exit(1);
});
