'use strict';
// Exit-panel corrections (paul's word, 2026-10-25), applied after G's. Every
// earlier number is unchanged; one figure is added.
//   - The NOI and resale rows name the sale year and the cap actually used.
//   - The sponsor's return on the deferred fee comes from the partnership split:
//     only the cash the split pays the sponsor. It is the one new figure, recorded
//     here per scenario.
//   - The older return keeps its value under a label saying it counts the
//     investor's share too, and the notes say what each return counts.
const SPONSOR = { A: { irr: '0.0%', cash: '$760,194' }, B: { irr: '0.0%', cash: '$760,194' } };
module.exports = function expectedFigures(scenario, figures) {
  const out = { ...figures };
  const s = SPONSOR[scenario];
  const hold = (out['dc-exit-notes'].match(/^Year-(\d+) NOI/) || [])[1];
  const cap = (out['dc-exit-notes'].match(/at ([\d.]+)% exit cap/) || [])[1];
  out['dc-exit-noi-label'] = 'Year-' + hold + ' stabilized NOI';
  out['dc-exit-resale-label'] = 'Resale value (year-' + hold + ' NOI ÷ ' + cap + '% cap)';
  out['dc-exit-sponsor-irr'] = s.irr;
  out['dc-exit-summary'] = out['dc-exit-summary']
    .replace('Year-N stabilized NOI\n', out['dc-exit-noi-label'] + '\n')
    .replace('Resale value (NOI ÷ exit cap)\n', out['dc-exit-resale-label'] + '\n')
    .replace('Return on the deferred fee, incl. exit (stand-in for sponsor return)\n',
      "Sponsor's return on the deferred fee (from the partnership split)\n          " + s.irr + "\n          Same fee, counting all partnership cash and sale proceeds (includes the investor's share)\n");
  const fee = (out['dc-exit-notes'].match(/The return treats the deferred developer fee \((\$[\d,]+)\)/) || [])[1];
  let notes = out['dc-exit-notes']
    .replace('Resale capitalizes NOI at', 'Resale capitalizes year-' + hold + ' NOI at')
    .replace(/ The return treats the deferred developer fee \(\$[\d,]+\) as the sponsor's only money in\. It is not the sponsor's full return: predevelopment spending, GP equity and other distributions are not collected here\./, '');
  notes += " The sponsor's return counts the deferred fee (" + fee + ') as its money in and only the cash the partnership split pays the sponsor: ' + s.cash +
    ' over the hold, under the deal terms in the partnership panel.';
  notes += " The second return counts every dollar of yearly cash and sale proceeds as coming back on the fee, including the investor's share, so it overstates what the sponsor keeps. Neither counts predevelopment spending, other GP equity or tax benefits.";
  out['dc-exit-notes'] = notes;
  return out;
};
