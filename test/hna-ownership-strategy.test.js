'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const Strategy = require('../js/hna/hna-ownership-strategy.js');
const Finance = require('../js/hna/ownership-finance.js');
const models = require('../data/policy/affordability-models.json');
const cascade = require('../data/hna/home-value-cascade.json');
const localResources = require('../data/hna/local-resources.json');
const developerFunding = require('../data/policy/developer-ownership-funding.json');
const buyerAssistance = require('../data/policy/buyer-assistance-programs.json');
const stewardshipProviders = require('../data/policy/stewardship-providers.json');
const countyOwnership = require('../data/policy/county-ownership.json');
const progress = require('../data/policy/jurisdiction-housing-progress.json');

Finance.setRegistry(models);
global.window = { OwnershipFinance: Finance };
require('../js/hna/hna-ownership-need.js');
const HNAOwnershipNeed = global.window.HNAOwnershipNeed;
const ownerValueProfile = { B25075_001E: 100 };
HNAOwnershipNeed.OWNER_VALUE_BINS.forEach((band) => { ownerValueProfile[band[0]] = 0; });
ownerValueProfile[HNAOwnershipNeed.OWNER_VALUE_BINS[0][0]] = 40;
ownerValueProfile[HNAOwnershipNeed.OWNER_VALUE_BINS[1][0]] = 60;
const realOwnerValueSupply = HNAOwnershipNeed.ownerValueSupplySeries(ownerValueProfile);
assert(realOwnerValueSupply, 'real ownerValueSupplySeries fixture is available');
assert.equal(realOwnerValueSupply.summedBandUnits, 100);
assert.deepEqual(Strategy.TIERS, [0.60, 0.80, 1.00, 1.20]);
const datasets = { developerFunding, buyerAssistance, stewardshipProviders, countyOwnership, progress, localResources };
const ownership = {
  tenureMixRecommendation: 'Mixed tenure strategy',
  recommendationDetail: 'Retain the existing computed recommendation.',
  ownerValueSupply: realOwnerValueSupply,
  priceBandScreen: { rows: [{ label: '$250k–$350k', potentialBuyerPoolHouseholds: 90, ownerValueSupplyUnits: 42 }] },
};
function input(geo, ami) {
  return { geo, ami4Person: ami, ownershipNeedResult: ownership, engine: Finance, homeValueCascade: cascade, datasets };
}

const defaultModel = Finance.recommendedModel();
assert.equal(defaultModel.id, 'conservative_screening');
const fruitaGeo = { type: 'place', geoid: '0828745', countyGeoid: '08077', name: 'Fruita' };
const erieGeo = { type: 'place', geoid: '0824950', countyGeoid: '08013', name: 'Erie' };
const fruita = Strategy.buildViewModel(input(fruitaGeo, 100000));
const erie = Strategy.buildViewModel(input(erieGeo, 125000));
assert.equal(fruita.modelId, defaultModel.id);
assert.equal(fruita.price.value, cascade.places['0828745'].value);
assert.equal(erie.price.value, cascade.places['0824950'].value);
assert.equal(fruita.price.scope, 'place');
assert.equal(erie.price.scope, 'place');
fruita.ladder.forEach((row) => assert.equal(row.maxPrice, Finance.maxAffordablePrice(100000, row.tier, { modelId: defaultModel.id, householdSize: 4 })));
erie.ladder.forEach((row) => assert.equal(row.maxPrice, Finance.maxAffordablePrice(125000, row.tier, { modelId: defaultModel.id, householdSize: 4 })));

const hh2 = Strategy.buildViewModel(Object.assign(input(fruitaGeo, 100000), { householdSize: 2 }));
assert.notEqual(hh2.ladder[1].maxPrice, fruita.ladder[1].maxPrice);
assert.equal(hh2.ladder[1].maxPrice, Finance.maxAffordablePrice(100000, 0.80, { modelId: defaultModel.id, householdSize: 2 }));

const permissive = Strategy.buildViewModel(Object.assign(input(fruitaGeo, 100000), { modelId: 'conventional_dti' }));
assert.equal(permissive.comparison.riskDisclosureRequired, true);
assert(Strategy.renderHtml(permissive).includes('data-risk-disclosure="true"'));
assert(Strategy.renderHtml(permissive).includes('43% back-end DTI'));

const fallback = Strategy.resolvePrice({ type: 'place', geoid: '0899999', countyGeoid: '08077', allowCountyFallback: true }, cascade);
assert.equal(fallback.value, cascade.counties['08077'].value);
assert.equal(fallback.scope, 'county-fallback');
assert(Strategy.renderHtml(Strategy.buildViewModel(Object.assign(input({ type: 'place', geoid: '0899999', countyGeoid: '08077', allowCountyFallback: true }, 100000), { price: fallback }))).includes('County fallback — not place data'));

const fruitaHtml = Strategy.renderHtml(fruita);
assert(fruitaHtml.includes('$486,295'));
assert(fruitaHtml.includes('data-scope="place"'));
assert(fruitaHtml.includes('Place value</span>'));
assert(fruitaHtml.includes('Fruita Housing Authority'));
assert(fruitaHtml.includes('Proposition 123: Committed'));
assert(fruitaHtml.includes('Housing Resources of Western Colorado'));
assert(fruitaHtml.includes('Available is context, never money.'));
assert(fruitaHtml.includes('status: available'));
assert(fruitaHtml.includes('<strong>100</strong> owner units across existing value bands.'));
assert(!/applied|counted position/i.test(fruitaHtml));
assert(!/% of households|households[^<]{0,40}priced out/i.test(fruitaHtml));

const thin = Strategy.buildViewModel(input({ type: 'place', geoid: '0899998', countyGeoid: '08999', name: 'Thin Place' }, 100000));
const thinHtml = Strategy.renderHtml(thin);
assert(thinHtml.includes('data not available for this jurisdiction'));
assert(thinHtml.includes('not tracked for this jurisdiction'));
assert(thinHtml.includes(stewardshipProviders.meta.no_stewardship_flag));

const zeroGapCascade = { places: { '0800001': { value: 100000, source: 'fixture', as_of: '2026' } }, counties: {} };
const zeroGap = Strategy.buildViewModel(Object.assign(input({ type: 'place', geoid: '0800001', countyGeoid: '08001', name: 'Attainable' }, 100000), { homeValueCascade: zeroGapCascade, datasets: Object.assign({}, datasets, { developerFunding: { programs: [] }, buyerAssistance: { programs: [] } }) }));
const zeroHtml = Strategy.renderHtml(zeroGap);
assert(zeroHtml.includes('market-attainable at this tier'));
assert(!/subsid/i.test(zeroHtml));

assert(fruitaHtml.includes(ownership.tenureMixRecommendation));
assert(fruitaHtml.includes(ownership.recommendationDetail));
assert(fruitaHtml.includes('Potential buyer pool — not committed demand.'));
assert(fruitaHtml.includes('screening estimate; not a completed project market study'));
['developer discussions', 'lender', 'appraiser', 'broker', 'program administrator', 'local jurisdiction'].forEach((party) => assert(fruitaHtml.includes(party)));

const source = fs.readFileSync(path.join(ROOT, 'js/hna/hna-ownership-strategy.js'), 'utf8');
assert.equal(/forecast|capture rate|absorption|time-phasing|qualified buyer|mortgage-ready/i.test(source), false);
assert(source.includes('Household-share data ends at 100% AMI'));
const page = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
assert(page.includes('id="hnaOwnershipStrategy"'));
assert(page.includes('js/hna/hna-ownership-strategy.js'));
assert(!fs.readFileSync(path.join(ROOT, 'js/deal-calculator.js'), 'utf8').includes('HNAOwnershipStrategy'));

const dom = new JSDOM('<div id="mount"></div>');
const mount = dom.window.document.getElementById('mount');
Strategy.render(mount, input(fruitaGeo, 100000));
const select = mount.querySelector('[data-own-strategy-model]');
select.value = 'conventional_dti';
select.dispatchEvent(new dom.window.Event('change'));
assert(mount.textContent.includes('Buyer-risk note:'));

console.log('hna-ownership-strategy: PASS');
