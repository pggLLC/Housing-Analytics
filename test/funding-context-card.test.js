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
assert(rendered.text.includes('Not yet verified; no confirmed current dollar amount.'), 'pending rows do not invent amounts');

const iraCard = rendered.mount.querySelector('[data-funding-context-program="CEO-IRA-HOME-ENERGY-REBATES"]');
assert(iraCard, 'IRA rebate watch card renders');
assert(!/\$[0-9]/.test(iraCard.textContent), 'IRA rebate watch card contains no fabricated dollar amount');

// Statuses read from the program's own page reach the card (2026-10-26 source check).
{
  const pma = render(softFunding, { surface: 'pma', countyFips: '08031', executionType: '9%', useCase: 'multifamily-new-construction' });
  const ended = pma.mount.querySelector('[data-funding-context-program="CEO-BUILDING-ELECTRIFICATION-GRANTS"]');
  assert(ended, 'the ended electrification grant still renders as context');
  // Agreement, not copy (AGENTS.md "Guards"): every program the data marks ended or paused
  // must say on its card that no money is available, and must not claim any.
  const disclosesNone = (t) => /\b(no funding|not available|unavailable)\b/i.test(t);
  const claimsMoney = (t) => /currently tracked|verify current availability|\$[0-9]/.test(t);
  const checkUnavailable = (doc, label) => {
    const out = render(doc, { surface: 'pma', countyFips: '08031', executionType: '9%', useCase: 'multifamily-new-construction' });
    let checked = 0;
    for (const [id, p] of Object.entries(doc.programs)) {
      if (p.status !== 'ended' && p.status !== 'paused') continue;
      const card = out.mount.querySelector(`[data-funding-context-program="${id}"]`);
      if (!card) continue;
      checked++;
      assert(disclosesNone(card.textContent), `${label}: ${id} is ${p.status} and its card must say no funding is available`);
      assert(!claimsMoney(card.textContent), `${label}: ${id} is ${p.status} and its card must not claim available money`);
    }
    return checked;
  };
  assert(checkUnavailable(softFunding, 'published data') > 0, 'the scan found at least one ended or paused program to check');
  // Rewording stays green; a contradictory claim fails.
  assert(disclosesNone('Ended: not available to new applicants.') && !claimsMoney('Ended: not available to new applicants.'), 'a reworded disclosure still passes');
  assert(claimsMoney('Ended. $250,000 currently tracked'), 'an availability claim on an ended program is caught');
  // Sabotage: a dollar figure left on an ended record must not turn into an availability claim.
  {
    const doc = JSON.parse(JSON.stringify(softFunding));
    doc.programs['CEO-BUILDING-ELECTRIFICATION-GRANTS'].available = 250000;
    assert.strictEqual(doc.programs['CEO-BUILDING-ELECTRIFICATION-GRANTS'].available, 250000, 'sabotage applied');
    assert(checkUnavailable(doc, 'ended record with a leftover amount') > 0, 'sabotaged record was checked');
  }
  const pill = ended.querySelector('[data-funding-context-status]');
  assert(pill && /ended/.test(pill.textContent) && /pill bad/.test(pill.className), 'an ended program carries a visible ended status');
  for (const [id, p] of Object.entries(softFunding.programs)) {
    if (p.status === 'retired') assert(!pma.mount.querySelector(`[data-funding-context-program="${id}"]`), `${id} is retired and must not render`);
  }
  // Sabotage: a retired copy of a rendered row disappears; an un-retired one comes back.
  const doc = JSON.parse(JSON.stringify(softFunding));
  doc.programs['CEO-BUILDING-ELECTRIFICATION-GRANTS'].status = 'retired';
  const gone = render(doc, { surface: 'pma', countyFips: '08031', executionType: '9%', useCase: 'multifamily-new-construction' });
  assert(!gone.mount.querySelector('[data-funding-context-program="CEO-BUILDING-ELECTRIFICATION-GRANTS"]'), 'sabotage: a retired row is hidden');
}

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

// Behavioral non-scored contract: execute the PMA funding render path against
// the live component. A render-path mutation such as
// `window.PMAMarketScoring.WEIGHTS.demand = 0.99` must fail this assertion.
{
  const scoringSrc = fs.readFileSync(path.join(root, 'js', 'market-analysis-scoring.js'), 'utf8');
  const behaviorDom = new JSDOM('<div id="pmaFundingContextCard"></div>', { url: 'http://127.0.0.1/market-analysis.html', runScripts: 'outside-only' });
  const w = behaviorDom.window;
  w.eval(scoringSrc);
  w.eval(fs.readFileSync(path.join(root, 'js', 'provenance-label.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(root, 'js', 'utils', 'format-money.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(root, 'js', 'components', 'funding-context-card.js'), 'utf8'));
  w.__softFundingStatus = softFunding;
  const before = JSON.stringify({
    weights: w.PMAMarketScoring.WEIGHTS,
    risk: w.PMAMarketScoring.RISK || null
  });
  const renderScript = [
    '(function(){',
    'var _softFundingStatus = window.__softFundingStatus;',
    'function _dominantCountyFromResult(){ return "08031"; }',
    marketRenderWindow.replace(/^function renderPmaFundingContext/, 'var renderPmaFundingContext = function renderPmaFundingContext'),
    'renderPmaFundingContext({ tractGeoids: ["080310001001"] });',
    '})();'
  ].join('\n');
  assert.doesNotThrow(() => w.eval(renderScript), 'PMA funding render path executes without swallowed errors');
  const fundingText = w.document.getElementById('pmaFundingContextCard').textContent.replace(/\s+/g, ' ');
  assert(fundingText.includes('CONTEXT'), 'executed PMA render produces funding-context DOM output');
  assert(fundingText.includes('Does not change PMA scores'), 'executed PMA render preserves non-scored disclosure');
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
