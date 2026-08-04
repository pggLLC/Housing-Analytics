'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const data = require(path.join(ROOT, 'data/policy/buyer-assistance-programs.json'));

const STATUSES = new Set(['available', 'anticipated', 'application_pending', 'awarded', 'committed', 'expired', 'unverified']);
const FUNDING = new Set(['grant', 'deferred_loan', 'equity', 'guarantee', 'in_kind', 'fee_waiver', 'land']);
function hasRank(value) {
  return value && typeof value === 'object' && Object.keys(value).some((key) => /^(rank|score)$/i.test(key) || hasRank(value[key]));
}
function validateProgram(program) {
  assert(program.id && program.provider && program.side === 'buyer');
  assert(FUNDING.has(program.funding_type));
  assert(STATUSES.has(program.commitment_status));
  if (program.apply_to_gap) assert(['awarded', 'committed'].includes(program.commitment_status));
  ['max_assistance', 'interest_rate', 'monthly_payment', 'term_years', 'appreciation_share', 'recapture_amount'].forEach((field) => {
    assert(program[field] === null || (typeof program[field] === 'number' && Number.isFinite(program[field])), field);
    if (program[field] !== null) {
      assert(/^https:\/\//.test(program.source_url));
      assert(/^\d{4}-\d{2}-\d{2}$/.test(program.last_verified));
    } else assert.equal(program.verify, true);
  });
  if (program.source_url === null) assert(program.verify && program.last_verified === null);
  else assert(/^https:\/\//.test(program.source_url) && !/example\./.test(program.source_url));
  assert(Array.isArray(program.project_specific_commitments));
  program.project_specific_commitments.forEach((item) => assert(['awarded', 'committed'].includes(item.commitment_status)));
  return true;
}

assert.equal(data.schema, 'buyer-assistance-programs/v1');
assert(data.programs.length >= 1);
data.programs.forEach(validateProgram);
assert.equal(hasRank(data), false);
assert.throws(() => validateProgram(Object.assign({}, data.programs[0], { commitment_status: 'available', apply_to_gap: true })));
assert.throws(() => validateProgram(Object.assign({}, data.programs[0], { max_assistance: 12345, source_url: null, last_verified: null })));

const chain = fs.readFileSync(path.join(ROOT, 'js/hna/ownership-decision-chain.js'), 'utf8');
const deal = fs.readFileSync(path.join(ROOT, 'js/deal-calculator.js'), 'utf8');
assert(!chain.includes('buyer-assistance-programs.json'));
assert(!deal.includes('buyer-assistance-programs.json'));
assert.equal(fs.existsSync(path.join(ROOT, 'data/policy/homeownership-programs.json')), true);

console.log('buyer-assistance-programs: PASS');

