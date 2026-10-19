'use strict';
// Explicit B1 (#2160) corrections to the invented golden, applied after L1's.
// The default budget is now the INVENTED example in js/deal-cost-basis.js
// (Total Development Cost $20,000,000) instead of 80% basis and a 15% fee:
//   basis  20,000,000 - 1,000,000 land - 300,000 financing not in basis
//          - 500,000 reserves = 18,200,000 (all 60 units restricted, no boost)
//   Method One credit 18,200,000 x 9% = 1,638,000, under CHFA's $1,800,000 cap
//   fee    the Developer fee line, 1,900,000
// CHFA reserves the smaller of Method One and Method Two, the gap left after
// every source but credit equity (QAP 3.M.1). The deferred fee is one of those
// sources; auto-balance counts the 40% it may defer, 1,900,000 x 40% = 760,000:
//   A  20,000,000 - 7,728,434 mortgage - 760,000 = 11,511,566 / $0.82 / 10 = 1,403,850 (57.6%)
//   B  A less the $1,000,000 loan = 10,511,566 / $0.82 / 10 = 1,281,898 (52.6%)
// Credit equity then leaves exactly 760,000 (3.8%) for the deferral, the gap is
// $0, and $1,140,000 of fee is paid at closing. The payback year and sponsor IRR
// on that 760,000 come from L1's unchanged exit code: Year 6, 25.4% (A) / 24.2% (B).
const SOURCES_ROW = '\n            \n            \n              State credit equity\n              $0\n              —'
  // #2161: the added credit's row and the credit note row, both hidden with no added credit.
  + '\n            \n            \n              Added credit equity, after its investor fees\n              $0\n              —'
  + '\n            \n            \n              ';
module.exports = function expectedFigures(scenario, figures) {
  const out = { ...figures };
  const gap = ['$0', '—'];
  const credit = scenario === 'A' ? '$1,403,850' : '$1,281,898';
  const equity = scenario === 'A' ? ['$11,511,566', '57.6%'] : ['$10,511,566', '52.6%'];
  const irr = scenario === 'A' ? '25.4%' : '24.2%';
  Object.assign(out, {
    'dc-r-basis': '$18,200,000', 'dc-r-credits': credit, 'dc-r-equity': equity[0],
    'dc-r-devfee': '$1,900,000', 'dc-r-deferred': '$760,000', 'dc-r-devfee-closing': '$1,140,000',
    'dc-su-equity': equity[0], 'dc-su-equity-pct': equity[1], 'dc-su-deferred': '$760,000', 'dc-su-deferred-pct': '3.8%',
    'dc-su-gap': gap[0], 'dc-su-gap-pct': gap[1],
    'dc-su-state': '$0', 'dc-su-state-pct': '—', 'dc-su-state-row': 'State credit equity\n              $0\n              —',
    'dc-su-added': '$0', 'dc-su-added-pct': '—', 'dc-su-added-label': 'Added credit equity, after its investor fees',
    'dc-su-added-row': 'Added credit equity, after its investor fees\n              $0\n              —',
    'dc-su-credit-note': '', 'dc-su-credit-note-row': ''
  });
  const t = out['dc-su-table'];
  out['dc-su-table'] = t
    .replace('LIHTC Equity\n              $11,808,000\n              59.0%', 'Federal credit equity\n              ' + equity[0] + '\n              ' + equity[1] + SOURCES_ROW)
    .replace(/(not cash at closing\n {16}\n {14}\n {14})\$[\d,]+\n {14}[^\n]+/, '$1$760,000\n              3.8%')
    .replace(/\$-?[\d,]+\n {14}\S+(\n {12}\n {12}\n {14}USES)/, gap[0] + '\n              ' + gap[1] + '$1');
  out['dc-exit-defyr'] = 'Year 6';
  out['dc-exit-irr'] = irr;
  // The L1 figures had a deferral in A only, so B gains the sponsor-equity note.
  const sponsorNote = ' IRR proxies sponsor equity = deferred dev fee ($760,000). Excludes GP predev/upfront equity not modeled here.';
  out['dc-exit-notes'] = out['dc-exit-notes'].replace(/ IRR proxies sponsor equity[^]*$/, '') + sponsorNote;
  out['dc-exit-summary'] = out['dc-exit-summary']
    .replace(/(Deferred fee payback year\n {10})[^\n]+/, '$1Year 6')
    .replace(/(Sponsor IRR \(incl\. exit\)\n {10})[^\n]+$/, '$1' + irr);
  return out;
};
