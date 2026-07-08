/**
 * core-rendered-smoke.mjs
 * Focused Playwright smoke for the Phase 3.1 rendered-QA gate.
 *
 * Usage:
 *   npm run audit:core-rendered-smoke
 *   AUDIT_BASE_URL=http://127.0.0.1:8080 npm run audit:core-rendered-smoke
 *
 * Options:
 *   AUDIT_BASE_URL  Existing static server base URL. If omitted, this script starts one.
 *   REPORT_DIR      Output directory base (default: audit-report/core-rendered-smoke).
 *
 * Outputs JSON + Markdown evidence to {REPORT_DIR}/{timestamp}/.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import http from 'http';
import net from 'net';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const REPORT_BASE = process.env.REPORT_DIR || path.join(ROOT, 'audit-report', 'core-rendered-smoke');
const PAGE_TIMEOUT_MS = Number.parseInt(process.env.PAGE_TIMEOUT_MS || '45000', 10);
const SETTLE_MS = Number.parseInt(process.env.SETTLE_MS || '3500', 10);
const VIEWPORTS = [
  { name: 'desktop', width: 1366, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const FLOWS = [
  {
    name: 'HNA default',
    path: '/housing-needs-assessment.html',
    mustContain: ['Housing Needs Assessment', 'Screening tool only'],
    requiredSelectors: ['#geoType', '#geoSelect'],
  },
  {
    name: 'County profile: Boulder County',
    path: '/housing-needs-assessment.html?geoid=08013&geoType=county&auto=1',
    mustContain: ['Housing Needs Assessment'],
    requiredSelectors: ['#geoType', '#geoSelect'],
  },
  {
    name: 'Place profile: Erie',
    path: '/places/0824950.html',
    mustContain: ['Erie', 'Affordable Ownership Need'],
    requiredSelectors: ['#place-data', '#psOwnershipCard'],
  },
  {
    name: 'Opportunity Finder',
    path: '/lihtc-opportunity-finder.html',
    mustContain: ['LIHTC Opportunity Finder', 'opportunity score'],
    requiredSelectors: ['#lofTable', '#lofTableBody'],
  },
  {
    name: 'PMA',
    path: '/market-analysis.html',
    mustContain: ['Public Market Analysis', 'screening tool'],
    requiredSelectors: ['#pmaMap', '.pma-intro-text'],
  },
  {
    name: 'Data Trust Center',
    path: '/data-review-hub.html',
    mustContain: ['Data Trust Center', 'Sources'],
    requiredSelectors: ['#drhStatTotal', '[data-panel="overview"]'],
  },
];

const TIGERWEB_URL_PATTERN = /tigerweb\.geo\.census\.gov/i;
const CHFA_LIHTC_URL_PATTERN = /services\.arcgis\.com\/VTyQ9soqVukalItT\//i;
const IGNORED_CONSOLE = [
  /favicon/i,
  /net::ERR_BLOCKED_BY_CLIENT/i,
  /ERR_INTERNET_DISCONNECTED/i,
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  /playwright/i,
];

function mockTigerwebResponse(url) {
  const attrs = { NAME: 'Mock County', NAMELSAD: 'Mock County', STATEFP: '08', GEOID: '08013', COUNTYFP: '013' };
  if (/[?&]f=json(&|$)/i.test(url)) {
    return { geometryType: 'esriGeometryPolygon', features: [{ attributes: attrs, geometry: null }] };
  }
  if (!/\/query(\?|$)/i.test(url)) {
    return { currentVersion: 10.81, layers: [{ id: 1, name: 'Counties', type: 'Feature Layer' }] };
  }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[-105.5, 39.5], [-104.9, 39.5], [-104.9, 40.1], [-105.5, 40.1], [-105.5, 39.5]]] },
      properties: attrs,
    }],
  };
}

function mockChfaLihtcResponse(url) {
  if (/\/layers(\?|$)/i.test(url)) return { layers: [{ id: 0, name: 'LIHTC', type: 'Feature Layer' }], tables: [] };
  const point = [-104.9903, 39.7392];
  if (/[?&]f=json(&|$)/i.test(url)) {
    return {
      features: [{
        attributes: { OBJECTID: 1, Proj_Name: 'Mock LIHTC Project', PROJ_ST: 'CO', CNTY_FIPS: '08031' },
        geometry: { x: point[0], y: point[1], spatialReference: { wkid: 4326 } },
      }],
      exceededTransferLimit: false,
    };
  }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: point },
      properties: { Proj_Name: 'Mock LIHTC Project', PROJ_ST: 'CO', CNTY_FIPS: '08031' },
    }],
  };
}

async function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on('error', reject);
  });
}

function waitForHttpOk(url, timeoutMs = 10000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      req.on('error', retry);
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(poll, 250);
    };
    poll();
  });
}

async function startServerIfNeeded() {
  if (process.env.AUDIT_BASE_URL) return { baseUrl: process.env.AUDIT_BASE_URL.replace(/\/$/, ''), proc: null };
  const port = await findOpenPort();
  const proc = spawn(process.execPath, [path.join(ROOT, 'scripts', 'audit', 'serve-static.mjs'), String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', chunk => process.stdout.write(`[static] ${chunk}`));
  proc.stderr.on('data', chunk => process.stderr.write(`[static] ${chunk}`));
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHttpOk(`${baseUrl}/index.html`);
  return { baseUrl, proc };
}

function browserLaunchOptions() {
  const opts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    || process.env.CHROME_EXECUTABLE_PATH
    || (process.platform === 'darwin' && fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '');
  if (executablePath) opts.executablePath = executablePath;
  return opts;
}

async function installNetworkMocks(page) {
  await page.route(TIGERWEB_URL_PATTERN, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockTigerwebResponse(route.request().url())),
    });
  });
  await page.route(CHFA_LIHTC_URL_PATTERN, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockChfaLihtcResponse(route.request().url())),
    });
  });
}

async function collectBlankCards(page) {
  return page.evaluate(() => {
    function selectorFor(el) {
      if (el.id) return `#${el.id}`;
      const label = el.getAttribute('aria-label');
      if (label) return `${el.tagName.toLowerCase()}[aria-label="${label.slice(0, 60)}"]`;
      const heading = el.querySelector('h1,h2,h3,h4,[role="heading"]');
      const headingText = heading && (heading.innerText || heading.textContent || '').replace(/\s+/g, ' ').trim();
      if (headingText) {
        const cls = el.className && typeof el.className === 'string'
          ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
          : el.tagName.toLowerCase();
        return `${cls} "${headingText.slice(0, 60)}"`;
      }
      return el.className && typeof el.className === 'string'
        ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
        : el.tagName.toLowerCase();
    }

    const candidates = Array.from(document.querySelectorAll([
      '.card',
      '.place-card',
      '.drh-stat-card',
      '.drh-kpi',
      '.lof-summary-card',
      '.pma-card',
      '.stat-card',
      '[class*="card"]',
    ].join(',')));
    return candidates.map((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width < 80 || rect.height < 40) return null;
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      const normalized = text.replace(/[—\-–|·\s]/g, '');
      const hasRenderedGraphic = !!el.querySelector('canvas, svg, img, .leaflet-container, .leaflet-pane');
      if (hasRenderedGraphic) return null;
      if (normalized.length > 0 && !/^Loading\.?$/i.test(text)) return null;
      return {
        selector: selectorFor(el),
        text,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }).filter(Boolean).slice(0, 12);
  });
}

async function collectMobileOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overflowPx = Math.max(0, doc.scrollWidth - doc.clientWidth);
    const offenders = [];
    if (overflowPx > 2) {
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (rect.width < 1 || rect.height < 1) continue;
        if (rect.right > window.innerWidth + 2 || rect.left < -2) {
          offenders.push({
            selector: el.id ? `#${el.id}` : (el.className ? `.${String(el.className).trim().split(/\s+/).join('.')}` : el.tagName.toLowerCase()),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          });
          if (offenders.length >= 12) break;
        }
      }
    }
    return { overflowPx: Math.round(overflowPx), offenders };
  });
}

async function auditFlow(browser, baseUrl, flow, viewport) {
  const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await installNetworkMocks(page);

  const consoleErrors = [];
  const requestFailures = [];
  let loadError = null;

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some(re => re.test(text))) return;
    consoleErrors.push({ text, location: msg.location() || null });
  });
  page.on('pageerror', (err) => {
    const text = err.message || String(err);
    if (!IGNORED_CONSOLE.some(re => re.test(text))) consoleErrors.push({ text: `[uncaught] ${text}`, location: null });
  });
  page.on('requestfailed', (req) => {
    requestFailures.push({
      url: req.url(),
      errorText: req.failure()?.errorText || 'unknown',
    });
  });

  try {
    await page.goto(baseUrl + flow.path, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (_) {}
  } catch (err) {
    loadError = err.message;
  }
  await page.waitForTimeout(SETTLE_MS);

  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const missingText = flow.mustContain.filter(text => !bodyText.includes(text));
  const missingSelectors = [];
  for (const selector of flow.requiredSelectors) {
    const count = await page.locator(selector).count().catch(() => 0);
    if (count === 0) missingSelectors.push(selector);
  }
  const blankCards = await collectBlankCards(page).catch(err => [{ selector: 'audit-error', text: err.message, width: 0, height: 0 }]);
  const overflow = await collectMobileOverflow(page).catch(err => ({ overflowPx: 0, offenders: [{ selector: 'audit-error', width: 0, left: 0, right: 0, error: err.message }] }));

  const hardFailures = [];
  if (loadError) hardFailures.push(`Page load failed: ${loadError}`);
  if (consoleErrors.length) hardFailures.push(`${consoleErrors.length} console error(s)`);
  if (missingText.length) hardFailures.push(`Missing expected text: ${missingText.join(', ')}`);
  if (missingSelectors.length) hardFailures.push(`Missing selector(s): ${missingSelectors.join(', ')}`);
  if (blankCards.length) hardFailures.push(`${blankCards.length} visible blank/loading card(s)`);
  if (viewport.name === 'mobile' && overflow.overflowPx > 2) hardFailures.push(`Document overflows mobile viewport by ${overflow.overflowPx}px`);

  await context.close();
  return {
    flow: flow.name,
    path: flow.path,
    viewport: viewport.name,
    url: baseUrl + flow.path,
    title,
    loadError,
    consoleErrors,
    requestFailures,
    missingText,
    missingSelectors,
    blankCards,
    overflow,
    hardFailures,
  };
}

function escMd(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function buildMarkdown(report) {
  const lines = [
    `# Core Rendered Smoke — ${report.status}`,
    '',
    `Generated: ${report.timestamp}`,
    `Base URL: \`${report.baseUrl}\``,
    '',
    '| Flow | Viewport | Status | Evidence |',
    '|---|---:|---|---|',
  ];
  for (const result of report.results) {
    const status = result.hardFailures.length ? 'FAIL' : 'PASS';
    const evidence = result.hardFailures.length
      ? result.hardFailures.join('; ')
      : `title "${result.title}"; ${result.requestFailures.length} request failure(s) captured`;
    lines.push(`| ${escMd(result.flow)} | ${result.viewport} | ${status} | ${escMd(evidence)} |`);
  }
  lines.push('');
  lines.push('## Detail');
  for (const result of report.results.filter(r => r.hardFailures.length || r.consoleErrors.length || r.blankCards.length || r.overflow.overflowPx > 2)) {
    lines.push('');
    lines.push(`### ${result.flow} (${result.viewport})`);
    lines.push(`URL: \`${result.url}\``);
    if (result.hardFailures.length) {
      lines.push('Hard failures:');
      for (const failure of result.hardFailures) lines.push(`- ${failure}`);
    }
    if (result.consoleErrors.length) {
      lines.push('Console errors:');
      for (const entry of result.consoleErrors.slice(0, 8)) lines.push(`- ${entry.text}`);
    }
    if (result.blankCards.length) {
      lines.push('Blank/loading cards:');
      for (const card of result.blankCards) lines.push(`- ${card.selector} (${card.width}x${card.height}) text="${card.text || ''}"`);
    }
    if (result.overflow.overflowPx > 2) {
      lines.push(`Mobile overflow: ${result.overflow.overflowPx}px`);
      for (const offender of result.overflow.offenders) lines.push(`- ${offender.selector} width=${offender.width} left=${offender.left} right=${offender.right}`);
    }
  }
  return lines.join('\n');
}

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.join(REPORT_BASE, timestamp);
  fs.mkdirSync(reportDir, { recursive: true });

  const server = await startServerIfNeeded();
  let browser;
  try {
    browser = await chromium.launch(browserLaunchOptions());
    const results = [];
    console.log(`Core rendered smoke: ${FLOWS.length} flows x ${VIEWPORTS.length} viewport(s) at ${server.baseUrl}`);
    for (const flow of FLOWS) {
      for (const viewport of VIEWPORTS) {
        process.stdout.write(`  ${flow.name} [${viewport.name}] ... `);
        const result = await auditFlow(browser, server.baseUrl, flow, viewport);
        results.push(result);
        console.log(result.hardFailures.length ? `FAIL (${result.hardFailures.join('; ')})` : 'PASS');
      }
    }

    const totalHardFailures = results.reduce((sum, r) => sum + r.hardFailures.length, 0);
    const report = {
      timestamp,
      baseUrl: server.baseUrl,
      status: totalHardFailures ? 'FAIL' : 'PASS',
      summary: {
        flows: FLOWS.length,
        viewports: VIEWPORTS.map(v => v.name),
        checks: results.length,
        totalHardFailures,
        totalConsoleErrors: results.reduce((sum, r) => sum + r.consoleErrors.length, 0),
        totalBlankCards: results.reduce((sum, r) => sum + r.blankCards.length, 0),
        mobileOverflowFailures: results.filter(r => r.viewport === 'mobile' && r.overflow.overflowPx > 2).length,
      },
      results,
    };

    fs.writeFileSync(path.join(reportDir, 'core-rendered-smoke.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(reportDir, 'core-rendered-smoke.md'), buildMarkdown(report));
    console.log(`\nReport written to ${reportDir}`);
    if (totalHardFailures) {
      console.error(`Core rendered smoke failed with ${totalHardFailures} hard failure(s).`);
      process.exitCode = 1;
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server.proc) server.proc.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
