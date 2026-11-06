# `js/local-support-data.js`

js/local-support-data.js
Local support for affordable housing: the evidence a jurisdiction has
planned for it and voted for it, and the small Opportunity Finder bonus
that evidence earns.

It reads three hand-verified files:
  data/policy/local-support.json        adopted plans and council / commission votes
  data/policy/fee-reductions.json       fee relief (entries) and land-use incentives (land_use)
  data/policy/local-housing-funds.json  dedicated funds, taxes, linkage fees, land tools
and data/policy/incentive-coverage.json for who was checked for incentives.

The bonus is up to +6 points, in three parts of 2 (BONUS_PARTS):
  plans       an adopted plan or HNA with affordable-housing goals, within 5 years
  incentives  a standing fee reduction, a land-use incentive or a dedicated fund
  council     a recorded approval by the governing body or planning commission, within 3 years
A part with no counted evidence adds 0. A jurisdiction nobody has checked
therefore scores exactly what it scored before: unknown is never a penalty,
and never a reward. Denials are shown, not scored.

Nothing counts twice. Inclusionary zoning and the Prop 123 filing are never
counted here: the Civic component scores both. A plan is not counted when
Civic already credits the place with an HNA or comprehensive plan, and a
local fund is not counted when Civic already credits local funding; that
evidence is still listed, marked as credited in Civic.

No DOM, no fetch, no clock: the caller passes `today`, so the page and the
tests get the same answer for the same date.

## Symbols

### `earliestDay(date)`

'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' → the EARLIEST day it could mean, so a vague date never counts as more recent than it is.

### `countedIncentives(fees, landUse, funds, today)`

Incentive records that count toward the bonus, each with a short label.

### `build(docs)`

Build the model once.
docs: { support, fees, funds, coverage }

### `incentiveLabel(item)`

"reduced building permit fees", "density bonus", "housing trust fund".

### `applyBonus(score, bonus)`

Add the bonus to a 0–100 composite without passing 100. A null score stays null.
