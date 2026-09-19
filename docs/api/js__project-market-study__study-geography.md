# `js/project-market-study/study-geography.js`

Which jurisdiction is this for-sale study about?

Before this module the answer was always Fruita. The page hard-coded one
place GEOID in two places and fetched that place's summary, so a planner who
chose Longmont at step 1 and walked into the for-sale study read Fruita's
AMI, Fruita's home values and Fruita's buyer pool, with nothing on screen
saying so. Every figure was correct arithmetic about the wrong town.

The split this module draws is deliberate:

  - the PROGRAM (unit mix, AMI bands, costs, partners) stays in the scenario
    fixtures. It is an example project and is labelled as one.
  - the MARKET (AMI, home value, buyer pool) follows the reader's selected
    jurisdiction.

So "example program, your market" — which is the only honest thing a
screening page can offer, because nobody has supplied a real program.

The scenario document itself is never rewritten. The baseline travels as an
override into ProjectScenario.derive(), because the fixture validator carries
provenance checks that only make sense for the shipped fixtures (see
validateLocalBaseline in project-scenario.js).

Pure: every dataset arrives already parsed, so Node tests run the same code
the browser does.

## Symbols

### `resolve(global)`

Read the reader's jurisdiction. Delegates to JurisdictionUrlContext, which
is the site's one resolver for ?fips= → WorkflowState → SiteState. This
page must not grow a fourth.

### `datasetPaths(context)`

The datasets inputs() needs, as page-relative paths.

### `amiGapEntry(context, data)`

Mirrors buildOwnershipRecords() in scripts/hna/build_jurisdiction_metrics_digest.mjs.
Deliberately the same shape, including the gapSource tag, so the page and
the precomputed data/hna/ownership-need.json cannot drift apart —
test:forsale-jurisdiction replays a sample of geographies through here and
compares the result against that file.

### `salePrice(context, data)`

The sale-price node, from SalePriceEvidence.

A stale row (five of the 121 are a year or more behind the rest) is NOT
folded into the current figure. It travels as the value it is, with the
months-behind count in its source string, because the alternative is a
2024 price sitting in a 2026 column with nothing to mark it.

### `inputs(context, data, engines)`

Assemble everything the page needs for one jurisdiction.

Returns a result whose `unavailable` is either null or a named reason. It
is never a silent fallback to the example jurisdiction: a study that
cannot be computed for the reader's town says so.

### `observedFor(geography, scenario, EffectiveDemand)`

Turn the ownership need into the funnel's starting pool, for one scenario.
Separate from inputs() because it is per-scenario and inputs() is not.
