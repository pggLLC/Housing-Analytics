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
const resaleConventions = require('../data/policy/resale-conventions.json');

Finance.setRegistry(models);
global.window = { OwnershipFinance: Finance };
require('../js/hna/hna-ownership-need.js');
require('../js/hna/ownership-resale.js');
const HNAOwnershipNeed = global.window.HNAOwnershipNeed;
const OwnershipResale = global.window.OwnershipResale;
const ownerValueProfile = { B25075_001E: 100 };
HNAOwnershipNeed.OWNER_VALUE_BINS.forEach((band) => { ownerValueProfile[band[0]] = 0; });
ownerValueProfile[HNAOwnershipNeed.OWNER_VALUE_BINS[0][0]] = 40;
ownerValueProfile[HNAOwnershipNeed.OWNER_VALUE_BINS[1][0]] = 60;
const realOwnerValueSupply = HNAOwnershipNeed.ownerValueSupplySeries(ownerValueProfile);
assert(realOwnerValueSupply, 'real ownerValueSupplySeries fixture is available');
assert.equal(realOwnerValueSupply.summedBandUnits, 100);
assert.deepEqual(Strategy.TIERS, [0.60, 0.80, 1.00, 1.20]);
const datasets = { developerFunding, buyerAssistance, stewardshipProviders, countyOwnership, progress, localResources, resaleConventions };
const ownership = {
  tenureMixRecommendation: 'Mixed tenure strategy',
  recommendationDetail: 'Retain the existing computed recommendation.',
  ownerValueSupply: realOwnerValueSupply,
  priceBandScreen: { rows: [
    { label: '$250k–$350k', potentialBuyerPoolHouseholds: 90, ownerValueSupplyUnits: 42 },
    { label: '101-120% AMI middle-income price', potentialBuyerPoolHouseholds: null, currentGapHouseholds: null, ownerValueSupplyUnits: 12, demandUnavailableReason: HNAOwnershipNeed.CHAS_TOP_BAND_LIMIT },
  ] },
};
function input(geo, ami) {
  return { geo, ami4Person: ami, ownershipNeedResult: ownership, engine: Finance, resaleEngine: OwnershipResale, homeValueCascade: cascade, datasets };
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

const nullValueGeoid = '0800870';
assert.equal(cascade.places[nullValueGeoid].value, null, 'real Air Force Academy CDP cascade record has no home value');
const nullValueGeo = { type: 'cdp', geoid: nullValueGeoid, countyGeoid: '08041', name: 'Air Force Academy (CDP)' };
assert.equal(Strategy.resolvePrice(nullValueGeo, cascade), null, 'resolvePrice preserves a missing cascade value as null');
['', undefined, 0].forEach((missingValue) => {
  const missingCascade = { places: { [nullValueGeoid]: { value: missingValue, source: 'test' } }, counties: {} };
  assert.equal(Strategy.resolvePrice(nullValueGeo, missingCascade), null, String(missingValue) + ' is not converted into a price');
});
const nullValueVm = Strategy.buildViewModel(input(nullValueGeo, 100000));
assert.equal(nullValueVm.price, null, 'view model does not create a zero-valued price record');
assert(nullValueVm.priceUnavailableReason, 'the reason for the unavailable price travels with the view model');
const nullValueHtml = Strategy.renderHtml(nullValueVm);
assert(/Local price:\s*<strong>Value unavailable<\/strong>/.test(nullValueHtml), 'real null-value place renders Value unavailable for local price');
assert(nullValueHtml.includes(nullValueVm.priceUnavailableReason), 'the rendered ownership panel explains why the price is unavailable');
const prop123Model = models.models.find((model) => model.id === 'prop123_dpa_eligibility');
assert.equal(fruita.amiCeilingPct, prop123Model.params.amiCeilingPct, 'registry amiCeilingPct drives the default price bound');
assert.equal(fruita.amiCeilingSource, 'registry');
const changedRegistry = JSON.parse(JSON.stringify(models));
changedRegistry.models.find((model) => model.id === 'prop123_dpa_eligibility').params.amiCeilingPct = 1.35;
assert.equal(Strategy.defaultAmiCeilingPct(changedRegistry), 1.35, 'changing the registry parameter changes the resolved default');
fruita.ladder.forEach((row) => assert.equal(row.maxPrice, Finance.maxAffordablePrice(100000, row.tier, { modelId: defaultModel.id, householdSize: 4 })));
erie.ladder.forEach((row) => assert.equal(row.maxPrice, Finance.maxAffordablePrice(125000, row.tier, { modelId: defaultModel.id, householdSize: 4 })));

const hh2 = Strategy.buildViewModel(Object.assign(input(fruitaGeo, 100000), { householdSize: 2 }));
assert.notEqual(hh2.ladder[1].maxPrice, fruita.ladder[1].maxPrice);
assert.equal(hh2.ladder[1].maxPrice, Finance.maxAffordablePrice(100000, 0.80, { modelId: defaultModel.id, householdSize: 2 }));

const ceiling140 = Strategy.buildViewModel(Object.assign(input(fruitaGeo, 100000), { amiCeilingPct: 1.40 }));
assert.equal(ceiling140.amiCeilingSource, 'user');
assert.equal(ceiling140.ladder.at(-1).tier, 1.40, 'user ceiling becomes the top price tier');
assert.equal(ceiling140.ladder.at(-1).maxPrice, Finance.maxAffordablePrice(100000, 1.40, { modelId: defaultModel.id, householdSize: 4 }));
assert.notEqual(ceiling140.ladder.at(-1).maxPrice, fruita.ladder.at(-1).maxPrice, 'changed ceiling moves the modeled price threshold');
assert.equal(ceiling140.ownership.priceBandScreen.rows[1].potentialBuyerPoolHouseholds, null, 'changed ceiling does not fabricate upper-band demand');
assert.equal(ceiling140.ownership.priceBandScreen.rows[1].currentGapHouseholds, null, 'changed ceiling does not fabricate an upper-band gap');

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
assert(fruitaHtml.includes('Records unverified.'), 'fully quarantined county is labelled unverified rather than zero');
assert(fruitaHtml.includes(countyOwnership.meta.quarantine_reason), 'parcel quarantine reason travels with the strategy view model');
assert(!fruitaHtml.includes('0 public parcels'), 'fully quarantined county never renders a confident zero');
assert(!fruitaHtml.includes('City of Grand Junction — North Ave Corridor'), 'quarantined owner and address are not listed');
assert(fruitaHtml.includes('Available is context, never money.'));
assert(fruitaHtml.includes('status: available'));
assert(fruitaHtml.includes('<strong>100</strong> owner units across existing value bands.'));
assert(!/applied|counted position/i.test(fruitaHtml));
assert(!/% of households|households[^<]{0,40}priced out/i.test(fruitaHtml));

const verifiedOwnership = JSON.parse(JSON.stringify(countyOwnership));
verifiedOwnership.counties['08077'].publicParcels[0].evidence_status = 'verified_primary_record';
const verifiedDatasets = Object.assign({}, datasets, { countyOwnership: verifiedOwnership });
const verifiedFruita = Strategy.buildViewModel(Object.assign(input(fruitaGeo, 100000), { datasets: verifiedDatasets }));
const verifiedFruitaHtml = Strategy.renderHtml(verifiedFruita);
assert(verifiedFruitaHtml.includes('1</strong> verified public parcels'), 'verified county retains its parcel count');
assert(verifiedFruitaHtml.includes('City of Grand Junction — North Ave Corridor'), 'verified parcel still lists its owner and address');
assert(!verifiedFruitaHtml.includes('Records unverified.'), 'verified parcel does not receive the quarantine label');

const thin = Strategy.buildViewModel(input({ type: 'place', geoid: '0899998', countyGeoid: '08999', name: 'Thin Place' }, 100000));
const thinHtml = Strategy.renderHtml(thin);
assert(thinHtml.includes('data not available for this jurisdiction'));
assert(thinHtml.includes('not tracked for this jurisdiction'));
assert(thinHtml.includes(stewardshipProviders.meta.no_stewardship_flag));

const zeroGapCascade = { places: { '0800001': { value: 100000, source: 'fixture', as_of: '2026' } }, counties: {} };
const zeroGap = Strategy.buildViewModel(Object.assign(input({ type: 'place', geoid: '0800001', countyGeoid: '08001', name: 'Attainable' }, 100000), { homeValueCascade: zeroGapCascade, datasets: Object.assign({}, datasets, { developerFunding: { programs: [] }, buyerAssistance: { programs: [] } }) }));
const zeroHtml = Strategy.renderHtml(zeroGap);
assert(zeroHtml.includes('market-attainable at this tier'));
assert(!/subsidy gap|subsidy required|needs subsidy/i.test(zeroHtml), 'zero-gap screen makes no subsidy-need claim while retaining the legal-gate subsidy selector');

assert(fruitaHtml.includes(ownership.tenureMixRecommendation));
assert(fruitaHtml.includes(ownership.recommendationDetail));
assert(fruitaHtml.includes('Potential buyer pool — not committed demand.'));
assert(fruitaHtml.includes(HNAOwnershipNeed.CHAS_TOP_BAND_LIMIT));
assert(fruitaHtml.includes('Price-only control.'));
assert(fruitaHtml.includes('does not create household-demand counts above 100% AMI'));
assert(fruitaHtml.includes('SB26-040 (effective July 1, 2026)'));
assert(fruitaHtml.includes('Rural resort communities may petition DOLA under HB23-1304'));
assert(fruitaHtml.includes(prop123Model.implications.when_not_to_use), 'registry exception caveat is surfaced verbatim');
assert(fruitaHtml.includes('Resale mechanism comparison'));
assert(fruitaHtml.includes('Fixed public-subsidy recapture'));
assert(fruitaHtml.includes('screening estimate; not a completed project market study'));
['developer discussions', 'lender', 'appraiser', 'broker', 'program administrator', 'local jurisdiction'].forEach((party) => assert(fruitaHtml.includes(party)));

const source = fs.readFileSync(path.join(ROOT, 'js/hna/hna-ownership-strategy.js'), 'utf8');
assert.equal(/forecast|capture rate|absorption|time-phasing|qualified buyer|mortgage-ready/i.test(source), false);
assert(source.includes('Household-share data ends at 100% AMI'));
const page = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
assert(page.includes('id="hnaOwnershipStrategy"'));
assert(page.includes('js/hna/hna-ownership-strategy.js'));
assert(!fs.readFileSync(path.join(ROOT, 'js/deal-calculator.js'), 'utf8').includes('HNAOwnershipStrategy'));

const dom = new JSDOM('<div id="mount"></div>', { url: 'http://127.0.0.1/hna-ownership-strategy' });
const mount = dom.window.document.getElementById('mount');
Strategy.render(mount, input(fruitaGeo, 100000));
const select = mount.querySelector('[data-own-strategy-model]');
select.value = 'conventional_dti';
select.dispatchEvent(new dom.window.Event('change'));
assert(mount.textContent.includes('Buyer-risk note:'));
const ceilingSelect = mount.querySelector('[data-own-strategy-ami-ceiling]');
ceilingSelect.value = '1.4';
ceilingSelect.dispatchEvent(new dom.window.Event('change'));
assert(mount.textContent.includes('140% AMI'), 'ceiling control repaints the price ladder at the selected bound');
assert(mount.textContent.includes(HNAOwnershipNeed.CHAS_TOP_BAND_LIMIT), 'ceiling control leaves the CHAS demand limitation visible');
const subsidySelect = mount.querySelector('[data-resale-subsidy-type]');
subsidySelect.value = 'home_development_subsidy';
subsidySelect.dispatchEvent(new dom.window.Event('change'));
assert.equal(mount.querySelector('[data-resale-mechanism] option[value="recapture"]').disabled, true, 'HNA selector disables recapture for HOME development subsidy');
assert(mount.textContent.includes('24 CFR 92.254(a)(5)(ii)(A)(5)'), 'HNA selector renders the legal-gate citation');
const refreshedSubsidy = mount.querySelector('[data-resale-subsidy-type]');
refreshedSubsidy.value = 'other_public_subsidy';
refreshedSubsidy.dispatchEvent(new dom.window.Event('change'));
assert.equal(mount.querySelector('[data-resale-mechanism] option[value="recapture"]').disabled, false, 'HNA selector keeps recapture available for other public subsidy');

console.log('hna-ownership-strategy: PASS');
