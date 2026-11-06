# `js/hna/hna-market-call.js`

js/hna/hna-market-call.js
=========================
One line on the Housing Needs Assessment's market section: the market call
for the geography the report is showing, from data/market/market-direction.json,
linked to the Deep Dive's Market Direction tab where every county and town is.

  [data-market-call]   filled with the call, the signals that decided it,
                       this year's permits against last year's, and, for a
                       town, its county's call.

Which geography: HNAState.state.current, announced by hna-controller.js as
`hna:geography-changed` (the same source js/components/place-deals-limits.js
reads). A combined or regional view covers several places and has no single
call, so the line stays hidden; so does statewide.

A missing reading is said with the file's reason, never shown as a number.
The call names match the tab's (js/market-direction.js CALLS); the test
test/hna-market-call.test.js holds them together.

_No documented symbols — module has a file-header comment only._
