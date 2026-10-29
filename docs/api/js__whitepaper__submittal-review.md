# `js/whitepaper/submittal-review.js`

submittal-review.js — the gated "Submittal review" page: a draft 2027 Round One
(federal 9%) application scored against CHFA's QAP, the DOH or OEDIT gap-fund
lane under QAP 3.B.9, threshold items, stress tests run through the Deal
Calculator itself, and saved versions compared side by side.

Reads:
  data/policy/chfa-2027-r1-scoring.json   QAP lines, points, pages and quotes
                                          (public CHFA text only; status "draft"
                                          until CHFA adopts the 2027-28 QAP)
  data/policy/prop123_jurisdictions.json  DOLA Prop 123 commitment filings
  /api/deals                              saved deals and versions, served only by
                                          the private backend (coho-backend). Deal
                                          figures never go to this repository.

Stress tests load deal-calculator.html in a hidden frame with the saved
calculator export's own settings, change one input, and read the engine's
results, so the numbers are the calculator's, not a second model.

Lives in js/whitepaper/ because the gated bundle copies that folder and the
public build excludes it. window.SubmittalReview in the browser; module.exports in Node.

_No documented symbols — module has a file-header comment only._
