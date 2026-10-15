'use strict';
// Explicit B1 (#2160) corrections to the invented golden, applied after L1's.
// The default budget is now the INVENTED example in js/deal-cost-basis.js
// (Total Development Cost $20,000,000) instead of 80% basis and a 15% fee:
//   basis  20,000,000 - 1,000,000 land - 300,000 financing not in basis
//          - 500,000 reserves = 18,200,000 (all 60 units restricted, no boost)
//   Method One credit 18,200,000 x 9% = 1,638,000, under CHFA's $1,800,000 cap
//   fee    the Developer fee line, 1,900,000
// CHFA reserves the smaller of Method One and Method Two, the gap left after
// every source but credit equity (QAP 3.M.1), so the credit closes the gap:
//   A  20,000,000 - 7,728,434 mortgage = 12,271,566 / $0.82 / 10 = 1,496,532 (61.4%)
//   B  A less the $1,000,000 loan = 11,271,566 / $0.82 / 10 = 1,374,581 (56.4%)
// The gap is $0 and nothing is deferred, so there is no payback year or sponsor IRR.
const SOURCES_ROW = '\n            \n            \n              State credit equity\n              $0\n              —';
module.exports = function expectedFigures(scenario, figures) {
  const out = { ...figures };
  const gap = ['$0', '—'];
  const credit = scenario === 'A' ? '$1,496,532' : '$1,374,581';
  const equity = scenario === 'A' ? ['$12,271,566', '61.4%'] : ['$11,271,566', '56.4%'];
  Object.assign(out, {
    'dc-r-basis': '$18,200,000', 'dc-r-credits': credit, 'dc-r-equity': equity[0],
    'dc-r-devfee': '$1,900,000', 'dc-r-deferred': '$0', 'dc-r-devfee-closing': '$1,900,000',
    'dc-su-equity': equity[0], 'dc-su-equity-pct': equity[1], 'dc-su-deferred': '$0', 'dc-su-deferred-pct': '—',
    'dc-su-gap': gap[0], 'dc-su-gap-pct': gap[1],
    'dc-su-state': '$0', 'dc-su-state-pct': '—', 'dc-su-state-row': 'State credit equity\n              $0\n              —'
  });
  const t = out['dc-su-table'];
  out['dc-su-table'] = t
    .replace('LIHTC Equity\n              $11,808,000\n              59.0%', 'Federal credit equity\n              ' + equity[0] + '\n              ' + equity[1] + SOURCES_ROW)
    .replace(/(not cash at closing\n {16}\n {14}\n {14})\$[\d,]+\n {14}[^\n]+/, '$1$0\n              —')
    .replace(/\$-?[\d,]+\n {14}\S+(\n {12}\n {12}\n {14}USES)/, gap[0] + '\n              ' + gap[1] + '$1');
  {
    out['dc-exit-defyr'] = 'n/a';
    out['dc-exit-irr'] = '—';
    out['dc-exit-notes'] = out['dc-exit-notes'].replace(' IRR proxies sponsor equity = deferred dev fee ($463,566). Excludes GP predev/upfront equity not modeled here.', '');
    out['dc-exit-summary'] = out['dc-exit-summary'].replace('Year 4', 'n/a').replace('34.7%', '—');
  }
  return out;
};
