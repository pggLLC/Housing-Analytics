'use strict';
// INVENTED records only: no actual program terms, allocations or project data.
const sources = structuredClone(require('./deal-engine/invented-sources.cjs'));
const ids = ['CHFA-HTF', 'PROP123-AHTF', 'CHFA-CMF', 'DOLA-HTF', 'HOME-CO', 'NHTF-CO', 'NMTC-CO'];
sources['data/policy/soft-funding-status.json'] = {
  lastUpdated: '2090-02-03', programs: Object.fromEntries(ids.map((id, index) => [id, {
    name: 'Invented ' + id, description: 'Invented description ' + id,
    funding_type: 'amortizing_loan', rate_pct: null, term_years: 17, repayment: 'must_pay',
    max_rule: { max_amount: 321234 + index, text: 'Invented cap rule ' + id },
    source_note: 'Invented source note ' + id, source_url: 'https://example.org/invented/' + id,
    last_verified: '2090-02-03', review_by: '2090-05-03', status: 'active', county: 'All', available: null
  }]))
};
sources['data/policy/tax-credit-legislation.json'] = { entries: [{
  id: 'hb26-1065-invented', last_verified: '2090-02-03', tz_credit_pairing: {
    status: 'draft', source: 'Invented allocation plan', source_date: '2090-01-02', unit: 'annual',
    in_lieu_of_standard_state_credit: true,
    nine_percent: { '2027': 111111, '2028': 222222 },
    four_percent_round_two: { '2027': 333333, '2028': 444444 }
  }
}] };
sources['data/policy/policy-timeline.json'] = { events: [{ id: 'prop123', detail: 'Invented shared timeline description', source_url: 'https://example.org/invented/prop123' }] };
module.exports = sources;
