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
  { name: 'mobile', width: 375, height: 844 },
];

const FLOWS = [
  {
    name: 'HNA default',
    path: '/housing-needs-assessment.html',
    mustContain: ['Housing Needs Assessment', 'Screening tool only'],
    requiredSelectors: ['#geoType', '#geoSelect'],
  },
  // The five generated views. Each asserts its OWN heading, not the canonical
  // page's, so a view that regenerated with the wrong chrome -- or emptied
  // itself -- fails here rather than rendering a plausible-looking shell.
  // The switcher selector is what proves the view identity actually rendered.
  {
    name: 'HNA view: stock',
    path: '/hna-what-housing-exists.html',
    mustContain: ['What housing exists', 'Screening tool only'],
    requiredSelectors: ['#geoType', '#geoSelect', '.hna-view-switcher'],
  },
  {
    name: 'HNA view: people',
    path: '/hna-who-lives-here.html',
    mustContain: ['Who lives here', 'Screening tool only'],
    requiredSelectors: ['#geoType', '#geoSelect', '.hna-view-switcher'],
  },
  {
    name: 'HNA view: afford',
    path: '/hna-what-households-can-afford.html',
    mustContain: ['What households can afford', 'Screening tool only'],
    requiredSelectors: ['#geoType', '#geoSelect', '.hna-view-switcher'],
  },
  {
    name: 'HNA view: outlook',
    path: '/hna-where-its-heading.html',
    mustContain: ['Where it\'s heading', 'Screening tool only'],
    requiredSelectors: ['#geoType', '#geoSelect', '.hna-view-switcher'],
  },
  {
    name: 'HNA view: act',
    path: '/hna-what-to-do.html',
    mustContain: ['What to do about it', 'Screening tool only'],
    requiredSelectors: ['#geoType', '#geoSelect', '.hna-view-switcher'],
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
    name: 'Select Jurisdiction',
    path: '/select-jurisdiction.html',
    mustContain: ['Where are you working?', 'Select Jurisdiction'],
    requiredSelectors: ['#workflowProgress', '#sjKnowPath'],
  },
  {
    name: 'PMA',
    path: '/market-analysis.html',
    mustContain: ['Public Market Analysis', 'screening tool'],
    requiredSelectors: ['#pmaMap', '.pma-intro-text'],
    interact: pmaTractDefaultInteraction,
  },
  {
    // A deferred re-run must not bring a previous site back. The affordable
    // inventory is held until the second site is pending, so the first run
    // takes the stale-cache path and the cache-ready re-run fires while the
    // second site waits for its tracts (Codex review of #1888).
    name: 'PMA deferred re-run',
    path: '/market-analysis.html',
    mustContain: ['Public Market Analysis', 'screening tool'],
    requiredSelectors: ['#pmaMap'],
    beforeLoad: holdAffordableInventory,
    interact: pmaDeferredRerunInteraction,
  },
  {
    // When tract data cannot be read, the picker says so and what to do,
    // rather than leaving an empty picker under "review the pre-selected
    // tracts" (Codex review of #1888). Malformed JSON rather than a 404, so
    // the page logs no console error of its own.
    name: 'PMA tract data unavailable',
    path: '/market-analysis.html',
    mustContain: ['Public Market Analysis'],
    requiredSelectors: ['#pmaMap'],
    beforeLoad: (page) => page.route(/tract_boundaries_co\.geojson/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{' })),
    interact: pmaTractDataUnavailableInteraction,
  },
  {
    name: 'Deal Calculator',
    path: '/deal-calculator.html',
    mustContain: ['Deal Calculator', 'Project Inputs'],
    requiredSelectors: ['#dealCalcMount', '#dc-calc-grid', '#dc-inputs-col'],
  },
  {
    name: 'Data Trust Center',
    path: '/data-review-hub.html',
    mustContain: ['Data Trust Center', 'Sources'],
    requiredSelectors: ['#drhStatTotal', '[data-panel="overview"]'],
  },
];

/**
 * PMA, audit F13: the Tract picker is the default method (CHFA requires a PMA
 * of whole census tracts), but a map click used to run a circular buffer
 * regardless, and a click on a picker tract fell through the county-boundary
 * fill to the map, moving the site. Driven with real mouse clicks because the
 * defect was about which layer receives the click, which only a browser with
 * layout can tell. Desktop only: the map is the interaction surface.
 * Returns a list of failures.
 */
async function pmaTractDefaultInteraction(page, viewport) {
  if (viewport.name !== 'desktop') return [];
  const failures = [];
  const ready = await page.waitForFunction(() => window.PMAEngine && window.PMAEngine._map
    && window.PMAEngine._map() && window.PMAUIController && window.PMATractPicker, null, { timeout: 20000 })
    .then(() => true).catch(() => false);
  if (!ready) return ['PMA map or tract picker never initialised'];
  const method = await page.evaluate(() => window.PMAUIController.getMethod());
  if (method !== 'tract') failures.push(`default method is ${method}, not tract`);
  const SITE = [39.1589, -108.729];          // Fruita, Mesa County
  await page.evaluate((c) => { const m = window.PMAEngine._map(); m.setView(c, 12);
    m.getContainer().scrollIntoView({ block: 'center' }); }, SITE);
  await page.waitForTimeout(800);
  const toScreen = (c) => page.evaluate((cc) => { const m = window.PMAEngine._map();
    const r = m.getContainer().getBoundingClientRect(); const pt = m.latLngToContainerPoint(cc);
    return [r.left + pt.x, r.top + pt.y]; }, c);
  let [x, y] = await toScreen(SITE);
  await page.mouse.click(x, y);
  const opened = await page.waitForFunction(() => window.PMATractPicker.getSelectedGeoids().length > 0,
    null, { timeout: 15000 }).then(() => true).catch(() => false);
  const first = await page.evaluate(() => ({
    boundary: document.getElementById('pmaScoreBoundary') && document.getElementById('pmaScoreBoundary').dataset.boundary,
    picked: window.PMATractPicker.getSelectedGeoids().slice(),
    site: [window.PMAEngine._lastLat, window.PMAEngine._lastLon],
  }));
  if (!opened) failures.push('a map click in tract mode did not open the tract picker');
  if (first.boundary === 'buffer') failures.push('a map click in tract mode produced a circular-buffer result');
  // An unselected tract a few miles out, clicked on screen.
  const target = await page.evaluate(async (args) => {
    const [site, picked] = args; const sel = new Set(picked);
    const r = await fetch('data/market/tract_centroids_co.json'); const d = await r.json();
    const list = Array.isArray(d.tracts || d) ? (d.tracts || d) : Object.values(d.tracts || d);
    const lat = (t) => t.lat || t.latitude; const lon = (t) => t.lon || t.lng || t.longitude;
    const mi = (t) => Math.hypot((lat(t) - site[0]) * 69, (lon(t) - site[1]) * 53);
    const t = list.filter((t) => !sel.has(t.geoid || t.GEOID) && mi(t) > 3 && mi(t) < 6)
      .sort((a, b) => mi(a) - mi(b))[0];
    return t ? [lat(t), lon(t)] : null;
  }, [SITE, first.picked]);
  if (!target) return failures.concat('no unselected tract near the site to click');
  [x, y] = await toScreen(target);
  await page.mouse.click(x, y);
  await page.waitForTimeout(1500);
  const second = await page.evaluate(() => ({
    picked: window.PMATractPicker.getSelectedGeoids().length,
    site: [window.PMAEngine._lastLat, window.PMAEngine._lastLon],
  }));
  if (second.site[0] !== first.site[0] || second.site[1] !== first.site[1]) {
    failures.push('clicking a tract moved the site instead of toggling the tract');
  }
  if (second.picked !== first.picked.length + 1) {
    failures.push(`clicking an unselected tract changed the selection from ${first.picked.length} to ${second.picked}`);
  }
  // Run it, then place a second site by typed coordinates -- the address box
  // is the other way in, and it used to run a buffer too. The first site's
  // results must not stay on screen, or stay exportable, under the new site.
  await page.click('#pmaRunBtn');
  const ran = await page.waitForFunction(() => {
    const b = document.getElementById('pmaScoreBoundary');
    return b && b.dataset.boundary === 'tract';
  }, null, { timeout: 20000 }).then(() => true).catch(() => false);
  if (!ran) failures.push('Run Analysis on the picked tracts did not produce a tract-based result');
  // The exportable-result check below must be able to fail: a result exists
  // after a run, so its absence later means it was cleared.
  if (ran && !(await page.evaluate(() => !!window.PMAEngine._state.getLastResult()))) {
    failures.push('a completed run left no result to export');
  }
  if (ran && !(await page.evaluate(() => !!(window.PMADelineation && window.PMADelineation.getLastPmaPolygon())))) {
    failures.push('a completed run drew no PMA boundary, so the boundary-cleared check below tests nothing');
  }
  // Audit F3: every capture rate names its denominator, they all use the
  // same one, and each displayed rate is its numerator over that
  // denominator. The headline and simulator divided by CHAS-eligible renters
  // while showing the ACS renter total; the scenario table divided by the
  // total, so one project read 16.7% and 10.1% on the same screen.
  if (ran) {
    await page.waitForTimeout(1500);
    const cap = await page.evaluate(() => {
      const num = (t) => { const m = String(t || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
      const r = window.PMAEngine._state.getLastResult();
      const den = window.PMAEngine.captureDenominator(r);
      const sim = document.getElementById('pmaSimResult');
      const scen = document.getElementById('pmaScenarioResult');
      const simVals = sim ? [...sim.querySelectorAll('.pma-stat-value')].map((e) => e.textContent) : [];
      const baseRow = scen ? [...scen.querySelectorAll('tbody tr')].find((tr) => Number(tr.dataset.units) > 0) : null;
      return {
        expected: den ? den.value : null,
        headlineDen: document.getElementById('pmaCaptureDenominator').dataset.denominator,
        headlineText: document.getElementById('pmaCaptureDenominator').textContent,
        simDen: sim && sim.dataset.denominator,
        scenDen: scen && scen.dataset.denominator,
        headlineRate: num(document.getElementById('pmaCaptureRate').textContent),
        lihtcUnits: num(document.getElementById('pmaCaptureDenominator').dataset.numerator),
        simUnits: num(simVals[0]), simRate: num(simVals[1]), simShown: num(simVals[3]),
        scenUnits: baseRow ? num(baseRow.cells[0].textContent) : null,
        scenRate: baseRow ? num(baseRow.cells[2].textContent) : null,
      };
    });
    const d = cap.expected;
    const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 0.051;
    if (!d) failures.push('the tract analysis produced no capture-rate denominator');
    else {
      for (const [where, v] of [['headline', cap.headlineDen], ['simulator', cap.simDen], ['scenario table', cap.scenDen]]) {
        if (Number(v) !== d) failures.push(`the ${where} capture rate declares denominator ${v}; the analysis divides by ${d}`);
      }
      if (!cap.headlineText.includes(d.toLocaleString())) failures.push('the headline capture rate does not show its denominator');
      if (cap.simShown !== d) failures.push(`the simulator shows ${cap.simShown} beside its rate; it divides by ${d}`);
      if (!near(cap.headlineRate, Math.round(cap.lihtcUnits / d * 1000) / 10)) failures.push(`headline ${cap.headlineRate}% is not ${cap.lihtcUnits} existing units / ${d}`);
      if (!near(cap.simRate, Math.round(cap.simUnits / d * 1000) / 10)) failures.push(`simulator ${cap.simRate}% is not ${cap.simUnits} units / ${d}`);
      if (!near(cap.scenRate, Math.round(cap.scenUnits / d * 1000) / 10)) failures.push(`scenario ${cap.scenRate}% is not ${cap.scenUnits} units / ${d}`);
    }
  }

  // Audit F2: one primary score. The scenario table's no-project row is
  // scored with the headline's inputs and must equal it; the site-selection
  // index is marked secondary; each scale carries its own legend.
  if (ran) {
    const sc = await page.evaluate(() => {
      const circle = document.getElementById('pmaScoreCircle');
      const noProject = document.querySelector('#pmaScenarioResult tbody tr[data-units="0"]');
      return {
        primaryRole: circle.dataset.scoreRole,
        primary: Number(circle.textContent),
        noProject: noProject ? Number(noProject.dataset.score) : null,
        primaryCount: document.querySelectorAll('[data-score-role="primary"]').length,
        scale: (document.getElementById('pmaScoreScale') || {}).textContent || '',
        secondary: document.querySelectorAll('#maExecSummaryContent [data-score-role="secondary"]').length,
        secondaryScale: ((document.querySelector('#maExecSummaryContent .ma-score-scale') || {}).textContent) || '',
      };
    });
    if (sc.primaryRole !== 'primary' || sc.primaryCount !== 1) failures.push(`expected one score marked primary, found ${sc.primaryCount}`);
    if (sc.noProject === null) failures.push('the scenario table has no no-project row');
    else if (sc.noProject !== sc.primary) failures.push(`the scenario table's no-project score ${sc.noProject} is not the PMA score ${sc.primary}`);
    if (!/Strong/.test(sc.scale) || !/Weak/.test(sc.scale)) failures.push('the PMA score shows no scale legend');
    if (sc.secondary && !/own scale/.test(sc.secondaryScale)) failures.push('the site-selection index does not say it is on its own scale');
  }

  const SITE2 = [39.0639, -108.5506];        // Grand Junction, same county
  await page.fill('#pmaAddressInput', SITE2.join(', '));
  await page.click('#pmaAddressSearchBtn');
  await page.waitForFunction((c) => Math.abs(window.PMAEngine._lastLat - c[0]) < 1e-6
    && window.PMATractPicker.getSelectedGeoids().length > 0, SITE2, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const third = await page.evaluate(() => {
    const vis = (e) => !!e && e.getClientRects().length > 0;
    const dim = document.getElementById('pmaDimList');
    const csv = document.getElementById('pmaExportCsvBtn');
    return {
      boundary: document.getElementById('pmaScoreBoundary').dataset.boundary,
      site: [window.PMAEngine._lastLat, window.PMAEngine._lastLon],
      priorVisible: vis(dim),
      csvEnabled: !!csv && !csv.disabled,
      lastResult: !!window.PMAEngine._state.getLastResult(),
      priorBoundary: !!(window.PMADelineation && window.PMADelineation.getLastPmaPolygon && window.PMADelineation.getLastPmaPolygon()),
    };
  });
  if (Math.abs(third.site[0] - SITE2[0]) > 1e-6) failures.push('typed coordinates did not place the site');
  if (third.boundary === 'buffer') failures.push('typed coordinates in tract mode produced a circular-buffer result');
  if (third.priorVisible) failures.push("the previous site's dimension scores stayed on screen for the new site");
  if (third.csvEnabled || third.lastResult) failures.push("the previous site's result stayed exportable for the new site");
  if (third.priorBoundary) failures.push("the previous site's PMA boundary stayed on the map for the new site");
  return failures;
}

async function holdAffordableInventory(page) {
  let release;
  const held = new Promise((r) => { release = r; });
  page.__releaseAffordableInventory = release;
  await page.route(/affordable-housing\/properties\.json/, async (route) => { await held; await route.continue(); });
}

async function pmaDeferredRerunInteraction(page, viewport) {
  if (viewport.name !== 'desktop') { if (page.__releaseAffordableInventory) page.__releaseAffordableInventory(); return []; }
  const failures = [];
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const place = async (c) => {
    await page.fill('#pmaAddressInput', c.join(', '));
    await page.click('#pmaAddressSearchBtn');
    await page.waitForFunction((cc) => Math.abs(window.PMAEngine._lastLat - cc[0]) < 1e-6
      && window.PMATractPicker.getSelectedGeoids().length > 0, c, { timeout: 20000 });
  };
  try {
    await page.waitForFunction(() => window.PMAEngine && window.PMAUIController && window.PMATractPicker, null, { timeout: 20000 });
    await place([39.1589, -108.729]);
    await page.click('#pmaRunBtn');
    await page.waitForFunction(() => document.getElementById('pmaScoreBoundary').dataset.boundary === 'tract', null, { timeout: 30000 });
    const stale = await page.evaluate(() => !!document.getElementById('pma-affordable-loading-notice'));
    if (!stale) failures.push('the first run did not take the stale-inventory path, so this check tested nothing');
    await place([39.0639, -108.5506]);
  } finally {
    page.__releaseAffordableInventory();
  }
  await page.waitForTimeout(5000);
  const after = await page.evaluate(() => ({
    boundary: document.getElementById('pmaScoreBoundary').dataset.boundary,
    hasResult: !!window.PMAEngine._state.getLastResult(),
  }));
  if (after.boundary !== 'pending' || after.hasResult) {
    failures.push(`the late inventory re-ran the previous site under the new one (boundary ${after.boundary}, result ${after.hasResult})`);
  }
  return failures;
}

async function pmaTractDataUnavailableInteraction(page, viewport) {
  if (viewport.name !== 'desktop') return [];
  await page.waitForFunction(() => window.PMAEngine && window.PMAUIController && window.PMATractPicker, null, { timeout: 20000 });
  await page.fill('#pmaAddressInput', '39.1589, -108.729');
  await page.click('#pmaAddressSearchBtn');
  const said = await page.waitForFunction(() => document.getElementById('pmaScoreBoundary').dataset.boundary === 'unavailable',
    null, { timeout: 15000 }).then(() => true).catch(() => false);
  return said ? [] : ['with tract data unreadable, the page still asks the analyst to review tracts it could not load'];
}

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

  if (typeof flow.beforeLoad === 'function') await flow.beforeLoad(page, viewport);
  try {
    await page.goto(baseUrl + flow.path, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (_) {}
  } catch (err) {
    loadError = err.message;
  }
  await page.waitForTimeout(SETTLE_MS);

  // Force-open any collapsed <details> disclosure widgets before inspecting
  // text/layout. <details> content is excluded from innerText and reports an
  // empty getBoundingClientRect() while collapsed even though the <details>
  // element itself still computes display:block -- without this, any card
  // legitimately tucked inside a "click to expand" provenance/methodology
  // panel (a pattern used site-wide, e.g. market-analysis.html's "Data
  // quality, sources & integrations" disclosure) is misreported as blank.
  await page.evaluate(() => {
    document.querySelectorAll('details:not([open])').forEach((d) => { d.open = true; });
  });

  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const missingText = flow.mustContain.filter(text => !bodyText.includes(text));
  const missingSelectors = [];
  for (const selector of flow.requiredSelectors) {
    const count = await page.locator(selector).count().catch(() => 0);
    if (count === 0) missingSelectors.push(selector);
  }
  const interactionFailures = typeof flow.interact === 'function'
    ? await flow.interact(page, viewport).catch(err => [`interaction threw: ${err.message}`])
    : [];
  const blankCards = await collectBlankCards(page).catch(err => [{ selector: 'audit-error', text: err.message, width: 0, height: 0 }]);
  const overflow = await collectMobileOverflow(page).catch(err => ({ overflowPx: 0, offenders: [{ selector: 'audit-error', width: 0, left: 0, right: 0, error: err.message }] }));

  const hardFailures = [];
  if (loadError) hardFailures.push(`Page load failed: ${loadError}`);
  if (consoleErrors.length) hardFailures.push(`${consoleErrors.length} console error(s)`);
  if (missingText.length) hardFailures.push(`Missing expected text: ${missingText.join(', ')}`);
  if (missingSelectors.length) hardFailures.push(`Missing selector(s): ${missingSelectors.join(', ')}`);
  if (blankCards.length) hardFailures.push(`${blankCards.length} visible blank/loading card(s)`);
  for (const f of interactionFailures) hardFailures.push(`Interaction: ${f}`);
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
