'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const data = require(path.join(ROOT, 'data/policy/developer-ownership-funding.json'));

const STATUSES = new Set(['available', 'anticipated', 'application_pending', 'awarded', 'committed', 'expired', 'unverified']);
const SIDES = new Set(['project', 'buyer']);
const CATEGORIES = new Set(['A_land', 'B_project_gap', 'C_buyer_gap', 'D_cash_to_close']);
const FUNDING = new Set(['grant', 'deferred_loan', 'equity', 'guarantee', 'in_kind', 'fee_waiver', 'land']);
const CYCLES = new Set(['rolling', 'annual', 'competitive']);
const TIMING = new Set(['waived', 'reduced', 'deferred', 'in_kind']);
const AMOUNTS = ['max_percent', 'max_amount', 'max_per_household', 'max_per_project', 'eligible_buyer_ami_max', 'affordability_period_years', 'amount'];
function hasRank(value) { return value && typeof value === 'object' && Object.keys(value).some((key) => /^(rank|score)$/i.test(key) || hasRank(value[key])); }
function validateProgram(program) {
  assert(program.id && program.name);
  assert(FUNDING.has(program.funding_type));
  assert(SIDES.has(program.side));
  assert(CATEGORIES.has(program.capital_stack_category));
  assert(CYCLES.has(program.application_cycle));
  assert(STATUSES.has(program.commitment_status));
  assert.equal(typeof program.screening_apply, 'boolean');
  assert(Array.isArray(program.stacking_constraints));
  if (program.apply_to_gap) assert(['awarded', 'committed'].includes(program.commitment_status));
  if (program.screening_apply) {
    assert(program.amount_type);
    assert(program.max_amount !== null || program.max_percent !== null);
    assert(/^https:\/\//.test(program.source_url));
    assert(/^\d{4}-\d{2}-\d{2}$/.test(program.last_verified));
  }
  AMOUNTS.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(program, field)) return;
    assert(program[field] === null || (typeof program[field] === 'number' && Number.isFinite(program[field])), field);
    if (program[field] !== null) {
      assert(/^https:\/\//.test(program.source_url), field + ' lacks official source');
      assert(/^\d{4}-\d{2}-\d{2}$/.test(program.last_verified), field + ' lacks dated verification');
    } else assert.equal(program.verify, true, field + ' null requires VERIFY');
  });
  if (program.source_url === null) assert(program.verify === true && program.last_verified === null);
  else assert(/^https:\/\//.test(program.source_url) && !/example\./.test(program.source_url));
  if (program.contribution_mechanism) {
    assert(TIMING.has(program.timing));
    if (program.timing === 'deferred') assert(program.deferral_trigger);
    else assert.equal(program.deferral_trigger, null);
  }
  return true;
}

assert.equal(data.schema, 'developer-ownership-funding/v1');
assert.equal(data.meta.schema_version, 2);
assert.match(data.meta.deferral_note, /carrying-cost benefit, not a TDC reduction/);
assert.match(data.meta.methodology, /screening_apply.*potential.*never counted as committed funding; apply_to_gap.*requires awarded or committed/i);
data.programs.forEach(validateProgram);
assert.deepEqual(data.programs.filter((program) => program.screening_apply).map((program) => program.id), [
  'wmrhc-good-deeds-buydown',
  'chfa-dpa-layering',
]);
assert.equal(hasRank(data), false);
assert.throws(() => validateProgram(Object.assign({}, data.programs[0], { commitment_status: 'available', apply_to_gap: true })));
assert.throws(() => validateProgram(Object.assign({}, data.programs[1], { screening_apply: true })));
assert.throws(() => validateProgram(Object.assign({}, data.programs[0], { commitment_status: 'available', apply_to_gap: true, screening_apply: true })));
assert.throws(() => validateProgram(Object.assign({}, data.programs[0], {
  max_per_project: 100000, source_url: null, last_verified: null,
})));

['dola-prop123-new-construction', 'fhlb-topeka-ahp', 'fhlb-topeka-hsp', 'chfa-construction-financing', 'usda-rd-502-direct', 'usda-rd-502-guaranteed', 'employer-assisted-ownership-placeholder', 'cra-bank-participation-placeholder', 'foundation-participation-placeholder', 'fruita-tap-fee-deferral', 'fruita-permit-plan-review-waiver'].forEach((id) => assert(data.programs.some((item) => item.id === id), id));
['usda-rd-502-direct', 'usda-rd-502-guaranteed', 'fhlb-topeka-hsp', 'chfa-dpa-layering'].forEach((id) => assert.equal(data.programs.find((item) => item.id === id).side, 'buyer'));

const restricted = /forecast|will appreciate|projected|capture rate|absorption|sellout|time-phasing|recommended|best|preferred/i;
['data/policy/buyer-assistance-programs.json', 'data/policy/stewardship-providers.json', 'data/policy/developer-ownership-funding.json'].forEach((file) => assert.equal(restricted.test(fs.readFileSync(path.join(ROOT, file), 'utf8')), false, file));
const pkg = require(path.join(ROOT, 'package.json'));
assert.equal(pkg.scripts['test:buyer-assistance-programs'], 'node test/buyer-assistance-programs.test.js');
assert.equal(pkg.scripts['test:stewardship-providers'], 'node test/stewardship-providers.test.js');
assert.equal(pkg.scripts['test:ownership-funding-schema'], 'node test/ownership-funding-schema.test.js');
const ci = pkg.scripts['test:ci'];
assert(ci.indexOf('test:land-disposition') < ci.indexOf('test:buyer-assistance-programs'));
assert(ci.indexOf('test:buyer-assistance-programs') < ci.indexOf('test:stewardship-providers'));
assert(ci.indexOf('test:stewardship-providers') < ci.indexOf('test:ownership-funding-schema'));

console.log('ownership-funding-schema: PASS');
