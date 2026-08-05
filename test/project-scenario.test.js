'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const Scenario = require('../js/project-market-study/project-scenario.js');
const Finance = require('../js/hna/ownership-finance.js');
const stewardshipProviders = require('../data/policy/stewardship-providers.json');

const names = [
  'fruita-commons.scenario.json',
  'fruita-commons-compact.scenario.json',
  'fruita-commons-family.scenario.json',
  'fruita-commons-broad-income.scenario.json',
];
const docs = names.map((name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/fixtures', name), 'utf8')));
const [baseline, compact, family, broad] = docs;
docs.forEach((doc) => assert.equal(Scenario.validate(doc), true));
docs.forEach((doc) => assert.equal(Scenario.validate(doc, { stewardshipProviders }), true));
assert.equal(Scenario.load(JSON.stringify(baseline)).schema, 'project-scenario/v1');

assert.equal(baseline.program.total_units.value, 50);
assert.deepEqual(baseline.program.unit_mix.map((row) => [row.bedrooms, row.count, row.sqft_range]), [
  [1, 4, [750, 850]], [2, 22, [950, 1100]], [3, 22, [1200, 1350]], [4, 2, [1400, 1550]],
]);
assert.deepEqual(baseline.program.ami_mix.map((row) => [row.band, row.count]), [
  [[0.70, 0.80], 10], [[0.80, 0.90], 15], [[0.90, 1.00], 15], [[1.00, 1.20], 10],
]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function rejected(mutator) { const doc = clone(baseline); mutator(doc); assert.throws(() => Scenario.validate(doc)); }
rejected((doc) => { delete doc.program.total_units.classification; });
rejected((doc) => { delete doc.local_baseline.home_value.source; });
rejected((doc) => { doc.costs.tdc.verify = false; });
rejected((doc) => { doc.costs.tdc.value = 0; });
rejected((doc) => { doc.costs.hard_cost.value = 'unknown'; doc.costs.hard_cost.classification = 'user_entered'; });
rejected((doc) => { doc.program.unit_mix[0].count += 1; });
rejected((doc) => { doc.program.ami_mix[0].count += 1; });
rejected((doc) => { doc.assistance_ranges[0].is_commitment = true; });
rejected((doc) => { doc.stewardship.is_commitment = true; });
rejected((doc) => { doc.land.hypothesis_to_test = false; });
rejected((doc) => { doc.local_baseline.ami_4person.value = 94100; });
rejected((doc) => { doc.meta.classification_note = 'sales forecast'; });
rejected((doc) => { doc.partners[0].role = 'investor'; });
rejected((doc) => { doc.partners[1].is_commitment = true; });
rejected((doc) => { doc.partners.push(clone(doc.partners[0])); });
rejected((doc) => { doc.partners[2].verify = false; });
rejected((doc) => { doc.partners.push({ role: 'developer', name: 'Indibuild', provider_id: null, is_commitment: true, classification: 'user_entered' }); });
const bogusProvider = clone(baseline);
bogusProvider.partners[1].provider_id = 'bogus';
assert.equal(Scenario.validate(bogusProvider), true, 'registry lookup is skipped when registries are absent');
assert.throws(() => Scenario.validate(bogusProvider, { stewardshipProviders }));
const noPartners = clone(baseline); delete noPartners.partners;
assert.equal(Scenario.validate(noPartners), true);
const emptyPartners = clone(baseline); emptyPartners.partners = [];
assert.equal(Scenario.validate(emptyPartners), true);
assert.deepEqual(baseline.meta.owner_inputs_pending, ['tdc_build_up', 'land_value', 'phasing', 'hrwc_terms', 'development_partner', 'lender']);
assert.deepEqual(baseline.partners.map((partner) => partner.role), ['land_owner', 'steward', 'developer', 'lender']);
assert.equal(baseline.partners.find((partner) => partner.role === 'steward').provider_id, 'hrwc');
assert.equal(baseline.partners.find((partner) => partner.role === 'developer').name, null);
assert.equal(baseline.partners.find((partner) => partner.role === 'lender').name, null);

const derived = Scenario.derive(baseline, Finance);
const band90100 = derived.bands.find((row) => row.band[0] === 0.90 && row.band[1] === 1.00);
// Hand derivation: midpoint = (0.90 + 1.00) / 2 = 0.95; the fixture's
// representative 3BR uses the named 4-person convention. The engine call is
// maxAffordablePrice(97,600, 0.95, conservative_screening, householdSize 4)
// = $336,091. Gap = Fruita place value $486,295 - $336,091 = $150,204.
assert.equal(band90100.midpoint, 0.95);
assert.equal(band90100.representativeBedrooms, 3);
assert.equal(band90100.householdSize, 4);
assert.equal(band90100.maxAffordablePrice, 336091);
assert.equal(band90100.gapVsLocalPrice, 150204);
assert.equal(band90100.assistanceRangeCheck, 'insufficient');
assert.equal(derived.tdcDependent.tdcPerUnit, 'not_available');
assert.equal(derived.tdcDependent.subsidyPerUnit, 'not_available');
assert.notEqual(derived.tdcDependent.subsidyPerUnit, 0);

const higherHoa = Scenario.derive(baseline, Finance, { hoaScenario: 'higher_cost' });
assert(higherHoa.bands.some((row) => row.assistanceRangeCheck === 'insufficient'));
const missing = clone(baseline);
missing.local_baseline.home_value = { value: null, verify: true, owner_input_required: true, classification: 'not_available' };
const unknown = Scenario.derive(missing, Finance);
assert(unknown.bands.every((row) => row.assistanceRangeCheck === 'unknown'));

[compact, family, broad].forEach((variant) => {
  const baseOther = clone(baseline); const variantOther = clone(variant);
  delete baseOther.program; delete variantOther.program;
  assert.deepEqual(variantOther, baseOther, 'only program differs');
  assert.equal(variant.program.variant_note.classification, 'modeled');
});
compact.program.unit_mix.forEach((row) => assert.equal(row.classification, 'modeled'));
family.program.unit_mix.forEach((row) => assert.equal(row.classification, 'modeled'));
broad.program.ami_mix.forEach((row) => assert.equal(row.classification, 'modeled'));

const subject = Scenario.toSubjectProject(baseline);
assert.equal(subject.county_fips, '08077');
assert.equal(subject.total_units, 50);
assert.equal(subject.unit_mix.reduce((sum, row) => sum + row.count, 0), 50);
subject.unit_mix.forEach((row) => {
  assert(/^[1-4]BR$/.test(row.bedrooms));
  assert(Number.isInteger(row.ami_tier));
  assert(Number.isInteger(row.count) && row.count > 0);
  assert(Number.isFinite(row.sqft));
});
const subjectSource = fs.readFileSync(path.join(ROOT, 'js/components/subject-project.js'), 'utf8');
['project_name', 'address', 'county_fips', 'county_name', 'total_units', 'site_acres', 'buildings', 'construction_type', 'credit_type', 'in_migration_pct', 'target_population', 'use_hera_special', 'pis_date', 'unit_mix', 'amenities', 'notes', 'updated_at'].forEach((key) => assert(Object.prototype.hasOwnProperty.call(subject, key) && subjectSource.includes(key + ':')));
const dom = new JSDOM('', { url: 'http://localhost' });
global.window = dom.window; global.localStorage = dom.window.localStorage;
delete require.cache[require.resolve('../js/components/subject-project.js')];
require('../js/components/subject-project.js');
assert.equal(window.SubjectProject.set(subject).unit_mix.length, subject.unit_mix.length);

const fixtureText = names.map((name) => fs.readFileSync(path.join(ROOT, 'data/fixtures', name), 'utf8')).join('\n');
assert.equal(/94100|87\.3|82\.2|\b(?:53[6-9]|5[4-8]\d|59[0-4])000\b/.test(fixtureText), false);
assert.equal(/forecast|capture rate|absorption|sellout|time-phasing|\bcommitted\b|\bguaranteed\b/i.test(fixtureText), false);
const productionJs = fs.readdirSync(path.join(ROOT, 'js'), { recursive: true }).filter((name) => name.endsWith('.js')).map((name) => fs.readFileSync(path.join(ROOT, 'js', name), 'utf8')).join('\n');
assert.equal(/486295|489439|97600|fruita-commons(?:-compact|-family|-broad-income)?\.scenario\.json/.test(productionJs), false);
const moduleSource = fs.readFileSync(path.join(ROOT, 'js/project-market-study/project-scenario.js'), 'utf8');
assert.equal(/fetch\s*\(/.test(moduleSource), false);

console.log('project-scenario: PASS');
