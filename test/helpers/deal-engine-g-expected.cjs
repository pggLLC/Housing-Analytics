'use strict';
// Exit-panel label corrections (paul's decisions 3 and 4, 2026-10-23), applied
// after B1's. Text only: every number in the golden is unchanged.
//   - Net sale proceeds are labelled "before selling costs", with a note, because
//     no public source gives a default selling cost to subtract.
//   - "Sponsor IRR" becomes the return on the deferred fee, a stand-in for the
//     sponsor's return, with the reason beside it.
//   - The growth note reads "rents changing" so a negative rate reads correctly.
const NET_NOTE = ' Net sale proceeds are before selling costs (broker, transfer and closing costs are not subtracted).';
module.exports = function expectedFigures(scenario, figures) {
  const out = { ...figures };
  out['dc-exit-summary'] = out['dc-exit-summary']
    .replace('Net sale proceeds\n', 'Net sale proceeds (before selling costs)\n')
    .replace('Sponsor IRR (incl. exit)\n', 'Return on the deferred fee, incl. exit (stand-in for sponsor return)\n');
  let notes = out['dc-exit-notes']
    .replace(/NOI grown at ([-\d.]+)%\/yr rent and ([-\d.]+)%\/yr expense inflation\./, 'NOI with rents changing $1%/yr and $2%/yr expense inflation.');
  const sponsor = / IRR proxies sponsor equity = deferred dev fee \((\$[\d,]+)\)\. Excludes GP predev\/upfront equity not modeled here\./;
  const fee = (notes.match(sponsor) || [])[1];
  notes = notes.replace(sponsor, '');
  if (/^\$/.test(out['dc-exit-net'])) notes += NET_NOTE;
  if (fee) notes += ' The return treats the deferred developer fee (' + fee + ") as the sponsor's only money in. It is not the sponsor's full return: predevelopment spending, GP equity and other distributions are not collected here.";
  out['dc-exit-notes'] = notes;
  return out;
};
