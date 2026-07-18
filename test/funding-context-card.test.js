'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const softFunding = require(path.join(root, 'data', 'policy', 'soft-funding-status.json'));
const component = require(path.join(root, 'js', 'components', 'funding-context-card.js'));

function render(doc, opts) {
  const dom = new JSDOM('<section id="mount" hidden></section>', { url: 'http://127.0.0.1/' });
  const mount = dom.window.document.getElementById('mount');
  const ctx = component.render(mount, doc, opts || {});
  return { dom, mount, ctx, text: mount.textContent.replace(/\s+/g, ' ') };
}

console.log('\nFunding context card tests');
console.log('='.repeat(38));

assert(softFunding.programs, 'soft-funding data has programs');
assert(softFunding.programs['CEO-BUILDING-ELECTRIFICATION-GRANTS'], 'energy new-construction authority fixture is present');
assert(softFunding.programs['CEO-WAP'], 'retrofit/owner WAP fixture is present');
assert(softFunding.programs['CEO-LBD-SHOWCASE'], 'retrofit LBD fixture is present');

const pmaCtx = component.buildContext(softFunding, {
  surface: 'pma',
  countyFips: '08031',
  executionType: '9%',
  useCase: 'multifamily-new-construction'
});
const pmaIds = new Set(pmaCtx.programs.map((program) => program.id));
assert(pmaCtx.ok, 'PMA funding context is non-vacuous against real data');
assert(pmaIds.has('CEO-BUILDING-ELECTRIFICATION-GRANTS'), 'new-construction energy authority appears');
assert(!pmaIds.has('CEO-WAP'), 'retrofit/owner WAP does not appear in new-construction context');
assert(!pmaIds.has('CEO-LBD-SHOWCASE'), 'retrofit LBD does not appear in new-construction context');
assert(!pmaIds.has('CEO-IRA-HOME-ENERGY-REBATES'), 'retrofit/owner IRA rebates do not appear in new-construction context');

const noCountyCtx = component.buildContext(softFunding, {
  surface: 'deal-calculator',
  executionType: '9%',
  useCase: 'multifamily-new-construction'
});
const noCountyIds = new Set(noCountyCtx.programs.map((program) => program.id));
assert(!noCountyIds.has('Denver-AHTF'), 'county-specific local funds wait for a selected county');

const ownershipCtx = component.buildContext(softFunding, {
  surface: 'deal-calculator',
  countyFips: '08031',
  executionType: 'non-LIHTC',
  useCase: 'owner-occupied'
});
const ownershipIds = new Set(ownershipCtx.programs.map((program) => program.id));
assert(ownershipIds.has('CEO-WAP'), 'owner-occupied context includes WAP');
assert(ownershipIds.has('CEO-IRA-HOME-ENERGY-REBATES'), 'owner-occupied context includes IRA rebate watch');
assert(ownershipIds.has('CEO-SOLAR-FOR-ALL'), 'owner-occupied context includes Solar for All watch');
assert(!ownershipIds.has('CEO-BUILDING-ELECTRIFICATION-GRANTS'), 'developer grant authority does not appear in owner-occupied context');

const empty = render({ lastUpdated: softFunding.lastUpdated, programs: {} }, {
  surface: 'pma',
  countyFips: '08031',
  executionType: '9%',
  useCase: 'multifamily-new-construction'
});
assert.strictEqual(empty.ctx.ok, false, 'empty funding JSON is not treated as successful render');
assert(empty.mount.querySelector('[data-funding-context-empty="true"]'), 'empty data renders visible warning');

const rendered = render(softFunding, {
  surface: 'deal-calculator',
  countyFips: '08031',
  executionType: 'non-LIHTC',
  useCase: 'owner-occupied'
});
assert(rendered.text.includes('CONTEXT'), 'render pins context badge');
assert(rendered.text.includes('Does not change PMA scores'), 'render says no PMA score change');
assert(rendered.text.includes('Deal Calculator outputs'), 'render says no Deal Calculator output change');
assert(rendered.text.includes('VERIFY before use; no verified current dollar amount.'), 'VERIFY rows do not invent amounts');

const iraCard = rendered.mount.querySelector('[data-funding-context-program="CEO-IRA-HOME-ENERGY-REBATES"]');
assert(iraCard, 'IRA rebate watch card renders');
assert(!/\$[0-9]/.test(iraCard.textContent), 'IRA rebate watch card contains no fabricated dollar amount');

const marketHtml = fs.readFileSync(path.join(root, 'market-analysis.html'), 'utf8');
const dealHtml = fs.readFileSync(path.join(root, 'deal-calculator.html'), 'utf8');
const marketJs = fs.readFileSync(path.join(root, 'js', 'market-analysis.js'), 'utf8');
const dealJs = fs.readFileSync(path.join(root, 'js', 'deal-calculator.js'), 'utf8');
const marketRenderWindow = marketJs.slice(
  marketJs.indexOf('function renderPmaFundingContext'),
  marketJs.indexOf('function placeSiteMarker')
);
const dealRenderWindow = dealJs.slice(
  dealJs.indexOf('function _renderFundingContextCard'),
  dealJs.indexOf('// -------------------------------------------------------------------', dealJs.indexOf('function _renderFundingContextCard'))
);
assert(marketHtml.includes('js/components/funding-context-card.js'), 'PMA page loads funding context component');
assert(dealHtml.includes('js/components/funding-context-card.js'), 'Deal Calculator page loads funding context component');
assert(marketHtml.includes('pmaFundingContextCard'), 'PMA page has funding context mount');
assert(dealJs.includes('dc-funding-context-card'), 'Deal Calculator has funding context mount');
assert(marketRenderWindow.includes('function renderPmaFundingContext'), 'PMA funding render function is present');
assert(dealRenderWindow.includes('function _renderFundingContextCard'), 'Deal funding render function is present');
assert(!/PMA_WEIGHTS|weights\s*=|overall\s*=/.test(marketRenderWindow), 'PMA funding render does not alter scoring weights/results');
assert(!/gap\s*=|tdc\s*=|equity\s*=|mortgage\s*=/.test(dealRenderWindow), 'Deal funding render does not alter underwriting variables');

// Behavioral non-scored contract: the source-regex checks above are shallow
// (a mutation like `window.PMAMarketScoring.WEIGHTS.demand = 0.99` slips past
// them — caught in QA of #1250). Execute the PMA render path against the real
// scoring module and assert the scoring constants are byte-identical after.
{
  const scoringSrc = fs.readFileSync(path.join(root, 'js', 'market-analysis-scoring.js'), 'utf8');
  const behaviorDom = new JSDOM('<div id="pmaFundingContextCard"></div>', { url: 'http://127.0.0.1/market-analysis.html', runScripts: 'outside-only' });
  const w = behaviorDom.window;
  w.eval(scoringSrc);
  w.eval(fs.readFileSync(path.join(root, 'js', 'components', 'funding-context-card.js'), 'utf8'));
  const before = JSON.stringify({
    weights: w.PMAMarketScoring.WEIGHTS,
    risk: w.PMAMarketScoring.RISK || null
  });
  // Execute the extracted PMA render-path body with the card component live.
  w.eval('(function(){ ' + marketRenderWindow.replace(/^function renderPmaFundingContext/, 'var renderPmaFundingContext = function renderPmaFundingContext') + '\n if (typeof renderPmaFundingContext === "function") { try { renderPmaFundingContext({ countyFips: "08077", countyName: "Mesa County" }); } catch (_) {} } })();');
  const after = JSON.stringify({
    weights: w.PMAMarketScoring.WEIGHTS,
    risk: w.PMAMarketScoring.RISK || null
  });
  assert.strictEqual(after, before, 'executing the PMA funding render path leaves scoring constants byte-identical');
}

const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
assert(packageJson.includes('test:funding-context-card'), 'npm script exists');
assert(packageJson.includes('npm run test:funding-context-card'), 'test:ci includes funding context guard');

console.log('All Funding Context Card tests passed.');
