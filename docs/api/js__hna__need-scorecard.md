# `js/hna/need-scorecard.js`

Housing Needs Scorecard: the one computation (closeout ledger P04, 2026-11-12).

Moved out of js/hna/hna-renderers.js unchanged, so the HNA pages and the
place hub rank places with the same code rather than two matching copies.
hna-renderers.js draws the panel and calls this module; nothing here reads
the page.

Exposes: window.HNANeedScorecard (and module.exports under Node)
  MIN_RENTER_HH                         fewest renter households for a place's own shares
  components(rec, 'place'|'county')     A, B and D inputs from one CHAS record
  distributions(chas, econ, placeChas)  the two sorted peer pools (cached by data stamp)
  score(placeRec, countyRec, econRec, dist, isPlace)  the scoring policy
  percentile(sorted, value)             share below, ties counted half

## Symbols

### `_scorecardScore(subjectPlaceRec, countyRec, econRec, dist, isPlaceSubject)`

The scoring policy as a pure function: which geography the score
describes, which pool it is ranked in, and how the components combine.

It lives here rather than inline in renderHnaScorecardPanel because a
guard cannot call a renderer. The first version of
test/need-severity-is-place-level.test.mjs reimplemented these three
decisions in the test file, so reverting any of them in the renderer left
the test green — a guard agreeing with its own copy of the logic rather
than with the shipped one. Three sabotage mutations went undetected
before this was extracted.
