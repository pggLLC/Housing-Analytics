# `js/whitepaper/submittal-tieout.js`

submittal-tieout.js — the application tie-out on the gated Submittal review page
(developer-submittal-review.html): each figure typed from the CHFA application
sits beside the same figure from the Deal Calculator export, with a flag.

  green   matches within the figure's tolerance
  yellow  differs: fix the application or re-run the model before it goes in
  red     the application figure breaks a rule (QAP 3.M.1 credit amount, 3.M.3
          developer fee limit, 3.D debt coverage minimum, sources not equal to uses)

Limits come from the round's rules file (data/policy/chfa-2027-r*-scoring.json,
"tie_out" and "underwriting"), each with its QAP quote and page. The model
figures are the export's own; js/deal-engine.js is not run or changed here.
Application figures are saved with the version through /api/deals (coho-backend).

window.SubmittalTieOut in the browser; module.exports in Node.

_No documented symbols — module has a file-header comment only._
