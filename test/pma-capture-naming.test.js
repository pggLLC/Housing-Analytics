'use strict';

// Two ratios on the Market Analysis page divide by the same qualified-renter
// count and must not share a name:
//   existing affordable units ÷ qualified renters  -> existing affordable penetration
//   proposed project units   ÷ qualified renters  -> proposed-project capture rate
// (the measure CHFA means by "capture rate"). Every surface that shows one
// must use the name js/market-analysis.js defines for it in MEASURE_NAMES.
//
// Found 2026-09-26: the headline KPI, the methodology note, the JSON and CSV
// exports called the existing-units ratio a "capture rate", the same name as
// the simulator's proposed-project rate beside it. The Help dialog said the
// tool calculates a "capture rate" score, and its tip tied a ">35%" capture
// rate to market saturation — saturation is what penetration measures, and
// the simulator itself rates capture high from 25% (RISK.captureHigh).
//
// Runs the production code: market-analysis.html's real markup, with the
// page's modules loaded in jsdom; the simulator, the scenario table and the
// exports rendered by the page's own functions; the Help dialog's configured
// copy read by running the page's own CohoHelp.init call against a stub.
// Text is read through the DOM (textContent), never by stripping tags.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

const HTML = read('market-analysis.html');
const dom = new JSDOM(HTML, { url: 'http://localhost/market-analysis.html', runScripts: 'outside-only' });
const w = dom.window;
const doc = w.document;
// The page's own markup, captured before any script can change it.
const staticDoc = new JSDOM(HTML).window.document;

const downloads = [];
w.Blob = function (parts) { downloads.push(parts.join('')); };
w.URL.createObjectURL = () => 'blob:test';
w.URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = () => {};
w.alert = () => {};
const quiet = { log: console.log, warn: console.warn, error: console.error, info: console.info };
console.warn = console.error = console.info = () => {};
w.console.log = w.console.warn = w.console.error = w.console.info = () => {};
[
  'js/utils/format-money.js',
  'js/market-analysis/market-analysis-utils.js',
  'js/market-analysis/market-report-renderers.js',
  'js/market-analysis-scoring.js',
  'js/market-analysis.js',
  'js/market-analysis-enhancements.js',
].forEach((rel) => w.eval(read(rel)));

// The Help dialog's copy, as the page configures it: run the page's own
// inline CohoHelp.init(...) script against a stub that records the config.
function helpConfig() {
  const script = Array.from(staticDoc.querySelectorAll('script:not([src])'))
    .find((s) => s.textContent.includes('CohoHelp.init'));
  assert(script, 'market-analysis.html no longer configures a Help dialog');
  let config = null;
  vm.runInNewContext(script.textContent, { CohoHelp: { init: (c) => { config = c; } }, window: {}, document: {} });
  assert(config, 'the Help script did not call CohoHelp.init');
  return [config.title, config.description]
    .concat((config.steps || []).map((s) => s.label + '. ' + s.desc), config.tips || [])
    .filter(Boolean);
}

// Every "capture rate" / "capture-rate" (the measure's name, not the verb)
// must be the page's proposed-project name for it. A bare capture rate is
// ambiguous between the two ratios.
function strayCaptureNames(text, names) {
  const want = names.capture.toLowerCase();
  const out = [];
  const lower = text.toLowerCase();
  const re = /capture[\s-]+rates?/g;
  let m;
  while ((m = re.exec(lower))) {
    const start = m.index - (want.length - 'capture'.length);
    if (lower.slice(start, m.index + 'capture'.length) !== want) {
      out.push(text.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, ' '));
    }
  }
  return out;
}

const numbersIn = (t) => (t.match(/\d[\d,]*/g) || []).map((x) => Number(x.replace(/,/g, '')));

function run() {
  Object.assign(console, quiet);
  const E = w.PMAEngine;
  const N = E && E.MEASURE_NAMES;
  const RISK = require(path.join(ROOT, 'js/market-analysis-scoring.js')).RISK;

  console.log('\nExisting affordable penetration and proposed-project capture are named apart');

  test('the page defines two different names for the two ratios', () => {
    assert(N && N.penetration && N.capture, 'PMAEngine.MEASURE_NAMES is missing');
    assert.notStrictEqual(N.penetration.toLowerCase(), N.capture.toLowerCase());
    assert(!/capture/i.test(N.penetration), 'the penetration name still says capture: ' + N.penetration);
  });

  test('the headline KPI for existing units carries the penetration name', () => {
    const value = staticDoc.getElementById('pmaCaptureRate');
    assert(value, 'the headline KPI is gone');
    const label = value.parentElement.querySelector('.pma-stat-label');
    assert.strictEqual(label.textContent.trim(), N.penetration);
  });

  test('the methodology entry that divides existing units is named penetration', () => {
    const entries = Array.from(staticDoc.querySelectorAll('dt')).filter((dt) => {
      const dd = dt.nextElementSibling;
      return dd && dd.tagName === 'DD' && /existing affordable units/i.test(dd.textContent) && /÷/.test(dd.textContent);
    });
    assert(entries.length > 0, 'no methodology entry describes existing affordable units ÷ renters');
    entries.forEach((dt) => assert.strictEqual(dt.textContent.trim(), N.penetration));
  });

  // A result the page's own scoring produced, with a CHAS denominator.
  const acs = { pop: 9000, renter_hh: 1500, total_hh: 3600, vacancy_rate: 0.05, cost_burden_rate: 0.4,
    median_gross_rent: 1500, median_hh_income: 65000 };
  const result = Object.assign(E.computePma(acs, 120, 0, 39.74, -104.99, [], 95000, [], {}), {
    acs, lat: 39.74, lon: -104.99, bufferMiles: 3, tractCount: 6,
    affordableUnitsKnown: 120, capture: 120 / 598,
    captureDenominator: { value: 598, source: 'chas_lihtc_eligible' },
  });

  test('the high-ratio flag names the measure it tested: penetration, with the proposed units only when there are any', () => {
    const crowded = { lat: 39.74, lon: -104.99 };
    // The denominator computePma itself uses here (no CHAS for an empty
    // tract list, so ACS renters), read from its result, not assumed.
    const qual = E.computePma(acs, 0, 0, crowded.lat, crowded.lon, [], 95000, [], {}).captureDenominator.value;
    assert(qual > 0, 'no denominator to size the fixture from');
    // Existing units alone past the threshold: the headline's own call, 0 proposed.
    const existing = Math.ceil(qual * RISK.captureHigh) + 1;
    const headline = E.computePma(acs, existing, 0, crowded.lat, crowded.lon, [], 95000, [], {});
    const flag = (r) => r.flags.map((f) => f.text).find((t) => numbersIn(t).includes(Math.round(RISK.captureHigh * 100)));
    // The fixture must trip the flag, or this checks nothing.
    const h = flag(headline);
    assert(h, 'the existing-only fixture raised no high-ratio flag: ' + headline.flags.map((f) => f.text).join(' | '));
    assert(h.toLowerCase().includes(N.penetration.toLowerCase()), 'headline flag: ' + h);
    assert.deepStrictEqual(strayCaptureNames(h, N), [], 'headline flag uses a capture name for existing units: ' + h);
    assert(!/capture/i.test(h), 'a flag on existing units alone mentions capture: ' + h);
    const withProject = E.computePma(acs, 10, existing, crowded.lat, crowded.lon, [], 95000, [], {});
    const p = flag(withProject);
    assert(p && numbersIn(p).includes(existing), 'the flag does not say the ' + existing + ' proposed units are included: ' + p);
  });

  test('the simulator and the scenario table name the proposed-project rate, and the table says it is not penetration', () => {
    E._setLastResultForTest(result);
    E._renderCaptureSurfacesForTest(result);
    const sim = doc.getElementById('pmaSimResult');
    const scen = doc.getElementById('pmaScenarioResult');
    const simLabels = Array.from(sim.querySelectorAll('.pma-stat-label')).map((n) => n.textContent);
    assert(simLabels.some((t) => t.includes(N.capture)), 'simulator labels: ' + simLabels.join(' | '));
    const headers = Array.from(scen.querySelectorAll('th')).map((n) => n.textContent);
    assert(headers.some((t) => t.includes(N.capture)), 'scenario headers: ' + headers.join(' | '));
    const foot = scen.querySelector('.pma-capture-denominator').textContent;
    assert(foot.includes(N.capture) && foot.toLowerCase().includes(N.penetration.toLowerCase()),
      'the scenario footnote does not name both measures: ' + foot);
    for (const [where, text] of [['simulator', sim.textContent], ['scenario table', scen.textContent]]) {
      assert.deepStrictEqual(strayCaptureNames(text, N), [], where + ' uses an ambiguous capture name');
    }
  });

  test('both exports name the existing-units ratio as penetration, beside the same figure the KPI shows', () => {
    E._setLastResultForTest(result);
    downloads.length = 0;
    doc.getElementById('pmaExportJsonBtn').click();
    doc.getElementById('pmaExportCsv').click();
    assert.strictEqual(downloads.length, 2, 'the export buttons did not produce a JSON and a CSV');
    const json = JSON.parse(downloads[0]);
    assert.strictEqual(json.captureRate.measure, N.penetration);
    assert.strictEqual(json.captureRate.existingPct, +(result.capture * 100).toFixed(1));
    const rows = {};
    downloads[1].split('\n').forEach((line) => { const i = line.indexOf(','); rows[line.slice(0, i)] = line.slice(i + 1); });
    assert.strictEqual(rows.capture_rate_measure, N.penetration, 'CSV does not name the measure');
    assert.strictEqual(Number(rows.capture_rate), result.capture);
    const meta = w.PMAEnhancements.exportWithMetadata(result, {}, []);
    assert.strictEqual(meta.score.capture, result.capture);
    assert.strictEqual(meta.score.captureMeasure, N.penetration, 'the metadata export does not name its capture field');
  });

  test('the Help dialog uses the page\'s names, ties saturation to penetration, and states the simulator\'s own risk threshold', () => {
    const copy = helpConfig();
    const all = copy.join(' ');
    assert.deepStrictEqual(strayCaptureNames(all, N), [], 'Help copy uses an ambiguous capture name');
    assert(all.toLowerCase().includes(N.penetration.toLowerCase()), 'Help copy never names ' + N.penetration);
    const saturation = copy.filter((t) => /saturat/i.test(t));
    assert(saturation.length > 0, 'no Help text about saturation to check');
    saturation.forEach((t) => assert(t.toLowerCase().includes(N.penetration.toLowerCase()),
      'saturation is attributed without naming penetration: ' + t));
    const thresholds = copy.filter((t) => t.toLowerCase().includes(N.capture.toLowerCase()) && /\d+\s*%/.test(t));
    assert(thresholds.length > 0, 'no Help text states a capture threshold to check');
    thresholds.forEach((t) => {
      const pct = Number(t.match(/(\d+)\s*%/)[1]);
      assert.strictEqual(pct, Math.round(RISK.captureHigh * 100),
        'Help says ' + pct + '% but the simulator rates capture high from ' + RISK.captureHigh * 100 + '%');
    });
  });

  test('no visible text on the page uses an ambiguous capture name', () => {
    const body = staticDoc.body.cloneNode(true);
    body.querySelectorAll('script, style, noscript').forEach((n) => n.remove());
    const text = body.textContent;
    assert(text.toLowerCase().includes(N.capture.toLowerCase()), 'the scan found no capture wording to check');
    assert.deepStrictEqual(strayCaptureNames(text, N), []);
    const labels = Array.from(staticDoc.querySelectorAll('[aria-label]')).map((n) => n.getAttribute('aria-label')).join(' ');
    assert.deepStrictEqual(strayCaptureNames(labels, N), [], 'an aria-label uses an ambiguous capture name');
  });

  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
  process.exit(failures ? 1 : 0);
}

if (w.document.readyState === 'complete') run();
else w.addEventListener('load', run);
