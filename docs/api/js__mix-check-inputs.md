# `js/mix-check-inputs.js`

mix-check-inputs.js — gathers what js/mix-check.js needs for one county or place,
so every recommender reads the same files the same way.

  data/market/chas_co.json (or data/hna/chas_affordability_gap.json, same rows)
      county renter cost burden by income band, HUD CHAS
  data/hna/place-chas.json          place renter cost burden (low_confidence skipped)
  data/chfa-income-rent-limits-2026.json   CHFA two-bedroom rent limits, 30–80% AMI,
      and the rural resort flag
  data/policy/lihtc-underwriting-rules.json  CHFA minimum pro forma assumptions
  data/policy/co-developer-funding-guide.json   the MIHTC program (id chfa-mihtc)
  data/hud-fmr-income-limits.json, data/market/zori_rents_co.json,
  data/market/apartment_list_co.json   current rents (never ACS median gross rent)

build() and check() are pure and run in node; load() fetches what a page has not
already loaded; renderHtml() is the shared block each page drops into its card.
An unknown input stays null; nothing is coerced to 0.
Exposed as window.MixCheckInputs and module.exports.

## Symbols

### `build(files, opts, MixCheck)`

build(files, { countyFips, placeGeoid?, placeName?, placeRecord? }, MixCheck)
files: { countyChas, placeChas, limits, rules, guide, fmr, zori, apartmentList }, any may be null.

### `check(MixCheck, inputs, opts)`

check(MixCheck, inputs, { units?, gap50?, need20yr?, senior? }) → the need notes and the
15-year pencil for these inputs, plus the sentences pages print.

### `renderHtml(result, inputs, opts)`

renderHtml(result, inputs, { heading?, mixLead?, showTiers? }) → an HTML block.
Plain markup with the site's colour tokens so it sits in any card.

### `load(opts)`

load({ have?: { key: alreadyLoadedJson }, keys?: [...], fetchJson? }) → Promise<files>.
Files the page already holds are reused; each missing file is fetched once per page
and a failed fetch gives null for that file, never a rejection.
