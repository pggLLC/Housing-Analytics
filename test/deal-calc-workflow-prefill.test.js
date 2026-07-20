'use strict';
/**
 * test/deal-calc-workflow-prefill.test.js
 *
 * Regression for 2026-05-16 plus GEO-1: Deal Calculator must preselect
 * from the canonical countyFips when a place/CDP is active, while still
 * falling back to legacy jx.fips for older projects.
 *
 * What this asserts (source-grep):
 *   - Deal Calculator reads workflowCtx.countyFips and falls back to jx.fips.
 *   - PMA still reads jx.fips on its legacy path.
 *
 * Run: node test/deal-calc-workflow-prefill.test.js
 */

const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}

function execOnly(src) {
  return src
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const root = path.join(__dirname, '..');
const dc   = fs.readFileSync(path.join(root, 'js/deal-calculator.js'),    'utf8');
const pma  = fs.readFileSync(path.join(root, 'js/pma-ui-controller.js'),  'utf8');
const resolver = fs.readFileSync(path.join(root, 'js/components/jurisdiction-url-context.js'), 'utf8');
const workflowCore = fs.readFileSync(path.join(root, 'js/workflow-state-core.js'), 'utf8');
const workflowApi = fs.readFileSync(path.join(root, 'js/workflow-state-api.js'), 'utf8');
const geoConfig = JSON.parse(fs.readFileSync(path.join(root, 'data/hna/geo-config.json'), 'utf8'));

console.log('\n[test] deal-calculator.js reads canonical countyFips before legacy fips');
const dcExec = execOnly(dc);
assert(/workflowCtx\.countyFips/.test(dcExec),
  'pre-selection lookup uses canonical workflowCtx.countyFips');
assert(/_jx\s*&&\s*_jx\.fips\s*\)\s*fips\s*=\s*_jx\.fips/.test(dcExec),
  'pre-selection lookup still falls back to _jx.fips for legacy projects');

console.log('\n[test] pma-ui-controller.js reads jx.fips (not jx.countyFips)');
const pmaExec = execOnly(pma);
assert(!/_jx\.countyFips|jx\.countyFips/.test(pmaExec),
  'no executable references to the bogus jx.countyFips field');
assert(/_jx\s*&&\s*_jx\.fips\s*\)\s*countyFips\s*=\s*_jx\.fips/.test(pmaExec),
  'CHFA-awards / AMI-gap wiring uses _jx.fips correctly');

console.log('\n[test] deal calculator context line renders from JurisdictionUrlContext.resolve path');
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing function ' + name);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function ' + name);
}

(async function testResolvePathContextLine() {
  const cdp = geoConfig.cdps.find((row) => row.geoid === '0800320');
  const county = geoConfig.counties.find((row) => row.geoid === cdp.containingCounty);
  const dom = new JSDOM('<!doctype html><span id="dc-jurisdiction-context" hidden></span>', {
    url: 'http://127.0.0.1/deal-calculator.html',
    runScripts: 'outside-only'
  });
  const win = dom.window;
  win.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(geoConfig) });
  win.eval(workflowCore);
  win.eval(workflowApi);
  win.eval(resolver);
  win.WorkflowState.setJurisdiction({
    geoType: 'cdp',
    geoid: cdp.geoid,
    name: cdp.label,
    countyFips: cdp.containingCounty,
    countyName: county.label,
    fips: cdp.containingCounty,
    type: 'city',
    displayName: cdp.label,
    placeGeoid: cdp.geoid
  });
  const ctx = await win.JurisdictionUrlContext.resolve();
  assert(ctx && ctx.source === 'workflow', 'JurisdictionUrlContext.resolve returns workflow context');
  assert(ctx && ctx.geoType === 'cdp', 'resolve path preserves CDP geoType');
  assert(ctx && ctx.name === cdp.label, 'resolve path emits name for renderer');
  win.eval(extractFunction(dc, '_renderJurisdictionContext'));
  win._renderJurisdictionContext(ctx);
  const line = win.document.getElementById('dc-jurisdiction-context');
  assert(!line.hidden, 'resolved place/CDP context line is visible');
  assert(line.textContent.includes('Analyzing ' + cdp.label), 'context line includes CDP name');
  assert(line.textContent.includes(county.label + ' context'), 'context line includes containing county context');

  const displayOnlyCtx = Object.assign({}, ctx);
  delete displayOnlyCtx.name;
  win._renderJurisdictionContext(displayOnlyCtx);
  assert(!line.hidden && line.textContent.includes(cdp.label),
    'renderer also accepts displayName-only resolver contexts');

  console.log('\n=========================================');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
}()).catch((err) => {
  console.error('  ❌ FAIL: threw —', err.message);
  process.exit(1);
});
