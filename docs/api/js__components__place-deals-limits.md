# `js/components/place-deals-limits.js`

js/components/place-deals-limits.js
===================================
Two county lookups for the Housing Needs Assessment pages, drawn from data
the site already publishes elsewhere:

  [data-place-deals]   Awarded tax credit deals in the picked county that have
                       a sourced write-up (data/deals/index.json + each record),
                       newest first, each linking to its deal-summary.html page.
  [data-chfa-limits]   CHFA's 2026 maximum rents and income limits for the
                       picked county (data/chfa-income-rent-limits-2026.json),
                       as CHFA prints them.

Which geography: on an HNA page, the one the report is showing
(HNAState.state.current, announced by hna-controller.js as
`hna:geography-changed`), because a link can open a geography other than the
saved workflow jurisdiction and combined views never save one. Elsewhere,
WorkflowState.getJurisdiction(). A town resolves to its county; a town that
spans counties (data/hna/cross-county-places.json) resolves to all of them.

_No documented symbols — module has a file-header comment only._
