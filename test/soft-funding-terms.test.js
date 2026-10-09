'use strict';

const assert = require('node:assert/strict');
const { softFundingIssues } = require('../scripts/validate-schemas');
function validate(data) {
  validate.errors = softFundingIssues(data);
  return validate.errors.length === 0;
}
// Assert the real CLI works even if an installed node_modules could mask a dependency.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-funding-builtins-'));
try {
  const preload = path.join(temp, 'only-builtins.cjs');
  fs.writeFileSync(preload, `
    const Module = require('node:module');
    const path = require('node:path');
    const original = Module._load;
    Module._load = function (id, ...args) {
      if (!Module.isBuiltin(id) && !id.startsWith('.') && !path.isAbsolute(id)) {
        throw new Error('Validator requires a non-builtin dependency: ' + id);
      }
      return original.call(this, id, ...args);
    };
  `);
  execFileSync(process.execPath, ['--require', preload, path.join(__dirname, '../scripts/validate-schemas.js')], { stdio: 'pipe' });
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
const committed = require('../data/policy/soft-funding-status.json');
const partners = require('../data/capital-partners.json');

// INVENTED schema fixture: no client, project, award or application data.
const fixture = () => ({
  lastUpdated: '2026-02-03',
  programs: {
    INVENTED: {
      name: 'Invented program for schema testing',
      funding_type: 'amortizing_loan', rate_pct: 0, term_years: 12,
      repayment: 'must_pay',
      max_rule: {
        text: 'Invented maximum', max_amount: 32100, min_amount: 1700,
        max_per_unit: null, max_project_cost_pct: null, must_pay_dscr: null
      },
      source_url: 'https://example.com/invented-terms',
      source_note: 'Invented source: per-unit and project-cost limits are not stated.',
      last_verified: '2026-02-03', review_by: '2026-05-03'
    }
  }
});
const errors = () => JSON.stringify(validate.errors);
assert(validate(fixture()), errors());
const required = ['funding_type', 'rate_pct', 'term_years', 'repayment', 'max_rule',
  'source_url', 'source_note', 'last_verified', 'review_by'];
for (const field of required) {
  const data = fixture();
  delete data.programs.INVENTED[field];
  assert(!validate(data), `missing ${field} must fail`);
  assert(validate.errors.some(e => e.includes('/' + field + ': required field missing')));
  data.programs.INVENTED[field] = fixture().programs.INVENTED[field];
  assert(validate(data), `restoring ${field} must pass: ${errors()}`);
}
for (const [field, bad] of [
  ['funding_type', 'invented_instrument'], ['repayment', 'no_payments_ever'],
  ['rate_pct', -1], ['term_years', 0], ['source_url', 'http://example.com/invented'],
  ['source_url', 'not a URL'], ['source_note', '   '],
  ['last_verified', '2026-02-30'], ['review_by', 'not a date']
]) {
  const data = fixture();
  data.programs.INVENTED[field] = bad;
  assert(!validate(data), `${field} rejects ${JSON.stringify(bad)}`);
}
for (const field of ['max_amount', 'min_amount', 'max_per_unit', 'max_project_cost_pct', 'must_pay_dscr']) {
  const data = fixture();
  data.programs.INVENTED.max_rule[field] = -1;
  assert(!validate(data), `negative ${field} must fail`);
  data.programs.INVENTED.max_rule[field] = null;
  assert(validate(data), `${field} may be unknown: ${errors()}`);
}
const unknown = fixture();
for (const field of ['funding_type', 'rate_pct', 'term_years', 'repayment', 'max_rule']) {
  unknown.programs.INVENTED[field] = null;
}
unknown.programs.INVENTED.source_note = 'Invented source does not publish an instrument, rate, term, repayment or maximum.';
const before = structuredClone(unknown);
assert(validate(unknown), errors());
assert.deepEqual(unknown, before, 'validation must not coerce unknown terms into zero/defaults');

// Public program-policy agreement, not project test data. Caps and citations travel together.
const caps = [
  ['CHFA-CMF', 750000, 'https://www.chfainfo.com/rental-housing/multifamily-lending/capital-magnet-fund-cmf'],
  ['PROP123-LIHTC-GAP', 6000000, 'https://coloradoaffordablehousingfinancingfund.com/concessionary-debt/lihtc-gap-finance/'],
  ['PROP123-EQUITY', 15000000, 'https://coloradoaffordablehousingfinancingfund.com/equity/'],
  ['CHFA-HOF', 1000000, 'https://www.chfainfo.com/rental-housing/multifamily-lending/chfa-hof-program'],
  ['FHLB-TOPEKA-AHP', 1500000, 'https://www.fhlbtopeka.com/ahp'],
  ['PROP123-LBTF', 5000000, 'https://coloradoaffordablehousingfinancingfund.com/land-banking/']
];
assert(validate(committed), errors());
let checked = 0;
for (const [id, cap, url] of caps) {
  const p = committed.programs[id];
  assert(p, `missing ${id}`);
  assert.deepEqual([p.max_rule.max_amount, p.maxPerProject, p.source_url], [cap, cap, url], `${id}: published cap + official citation`);
  assert.equal(p.last_verified, '2026-10-09', `${id}: actual source-open date`);
  checked++;
}
assert.equal(checked, caps.length);
assert(checked > 0, 'source-agreement scan is not vacuous');
for (const [id, p] of Object.entries(committed.programs)) {
  assert(p.last_verified <= committed.lastUpdated, `${id}: file date covers verification`);
  assert(p.review_by >= p.last_verified, `${id}: review follows verification`);
}
const p = committed.programs;
assert.deepEqual([p['CHFA-CMF'].funding_type, p['CHFA-CMF'].term_years, p['CHFA-CMF'].repayment, p['CHFA-CMF'].rate_pct], ['amortizing_loan', 17, 'must_pay', null]);
assert.deepEqual(p['CHFA-CMF'].latest_award, {
  amount: 4500000, announced: '2024-11-07', source_url: 'https://www.chfainfo.com/chfa-news/11072024-cmf'
});
assert(p['CHFA-CMF'].relatedSourceUrls.includes('https://www.chfainfo.com/rental-housing/multifamily-lending/programs-by-loan-size/program-size-small'));
assert.deepEqual([
  p['PROP123-LIHTC-GAP'].rate_pct, p['PROP123-LIHTC-GAP'].max_rule.min_amount,
  p['PROP123-LIHTC-GAP'].max_rule.max_project_cost_pct, p['PROP123-LIHTC-GAP'].max_rule.must_pay_dscr,
  p['PROP123-LIHTC-GAP'].term_years, p['PROP123-LIHTC-GAP'].funding_type, p['PROP123-LIHTC-GAP'].repayment
], [2.5, 400000, 10, 1.05, null, null, null]);
assert.deepEqual([p['PROP123-EQUITY'].funding_type, p['PROP123-EQUITY'].repayment, p['PROP123-EQUITY'].max_rule.min_amount], ['equity', 'cash_flow', 1500000]);
assert.deepEqual([p['CHFA-HOF'].funding_type, p['CHFA-HOF'].repayment, p['CHFA-HOF'].term_years], ['amortizing_loan', 'must_pay', 30]);
assert.deepEqual([p['FHLB-TOPEKA-AHP'].funding_type, p['FHLB-TOPEKA-AHP'].max_rule.max_per_unit], ['grant', 75000]);
assert.deepEqual(p['FHLB-TOPEKA-AHP'].application_round, {
  opens: '2026-07-01', closes: '2026-07-31', announcements_by: '2026-12-31'
});
const partner = partners.partners.find(entry => entry.name.startsWith('FHLB Topeka'));
assert(partner, 'FHLB Topeka partner remains discoverable');
assert.equal(partner.url, p['FHLB-TOPEKA-AHP'].source_url);
console.log(`Soft-funding terms: invented positive/negative fixtures pass; ${Object.keys(p).length} records validated; ${checked} caps and official citations checked.`);
