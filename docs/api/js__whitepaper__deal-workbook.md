# `js/whitepaper/deal-workbook.js`

deal-workbook.js — the gated "Deal workbook" page: one deal's pro forma laid out
the way a lender or partner reads it. Executive view first, then sources and
uses, basis and credits, rents by AMI tier against the limits, operating costs
against CHFA's minimums, the 15-year cash flow with debt coverage, deferred fee
payback, and checks written as findings.

Every figure is the Deal Calculator's own. The page opens deal-calculator.html in
a hidden frame with the deal's settings and reads its result, so there is one
engine (js/deal-engine.js) and no second model to disagree with it.

Reads:
  /api/deals                                  saved deals and versions (coho-backend,
                                              per login). Deal figures never go to
                                              this repository.
  data/policy/lihtc-underwriting-rules.json   CHFA minimum pro forma assumptions,
                                              each quoted from the QAP

Lives in js/whitepaper/ because the gated bundle copies that folder and the
public build excludes it. window.DealWorkbook in the browser; module.exports in Node.

_No documented symbols — module has a file-header comment only._
