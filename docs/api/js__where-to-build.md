# `js/where-to-build.js`

js/where-to-build.js
Scoring for the gated "Where Should I Build?" page (developer-where.html).

Every town, community and county in the HNA ranking is scored on factors
the reader weights. Each factor earns 0–10 points by a written rule (RULES
below, printed on the page) or is "not yet checked" (points null).

  score      = sum(weight × points) / sum(weight × 10), over checked factors, × 100
               + signals (up to +10) − red flags (down to −30), held to 0–100
  confidence = the share of the total weight that rests on checked factors:
               High ≥ 80%, Medium 50–79%, Low < 50%
  tier       = Target ≥ 70 and not Low; Promising ≥ 50; Monitor ≥ 35

"Not yet checked" is never a zero: it leaves the factor out of the score and
lowers confidence instead, and Low confidence keeps a place out of Target.

Inputs (all already on the site; see FACTORS[].source):
  ranking   data/hna/ranking-index.json
  prop123   data/policy/prop123_jurisdictions.json
  awards    data/policy/prop123-land-banking-awards.json
  lbStatus  data/policy/prop123-land-banking-status.json (optional)
  hud       data/hud-fmr-income-limits.json
  context   data/policy/where-to-build-context.json (county votes, parks)
  commitment data/policy/local-commitment.json (HNAs, written goals, housing authorities)
  support, fees, funds, coverage   read through js/local-support-data.js

No DOM, no fetch, no clock: the caller passes `today`, so the page and the
tests get the same answer for the same date.

## Symbols

### `nameKey(name)`

"Cañon City (city)" / "City of Canon City" / "Mt. Crested Butte" → one key.

### `build(docs, today)`

Build the scoring model once from the loaded files.
Returns { places, meta }; each place carries its factors already evaluated.

### `score(place, weights)`

Score one place under the reader's group weights (0–5 each).

### `reason(place, s)`

One plain sentence: what lifts the score, what holds it back, how much was checked.
