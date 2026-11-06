# `js/mix-check.js`

mix-check.js — two checks every "ideal deal" recommendation on the site shares.

1. needNotes(): the full range of rental need, not only the homes-short counts.
   The ≤30/≤50/≤60% AMI shortfalls are cumulative (households minus homes priced
   for them) and can read 0 at a band whose renters still pay too much, because
   higher-income households occupy the cheaper homes. HUD CHAS cost burden by
   band (31–50, 51–80, 81–100% AMI) shows that need directly. The notes also test
   70–80% AMI units under income averaging against current rents, name the
   middle-income (80–120% AMI) route, and say the 20-year need is not split by
   income.

2. pencil(): does a rent tier, or a mix of them, pay its own operating costs for
   the 15-year pro forma CHFA underwrites? It uses only CHFA's minimum pro forma
   assumptions from data/policy/lihtc-underwriting-rules.json (vacancy, rent and
   expense growth, operating cost per unit, replacement reserve, debt coverage),
   each quoted from the Qualified Allocation Plan. It assumes the owner pays
   utilities, so a unit's rent is its full CHFA two-bedroom limit; with tenant-paid
   utilities the rent is lower by the utility allowance, so results are a ceiling.
   It sizes no loan: it reports the debt service the net income can carry at
   CHFA's minimum coverage in the weakest year, and the subsidy a tier needs.

Pure, no DOM. An unknown input gives null with a reason, never 0.
Exposed as window.MixCheck and module.exports.

## Symbols

### `needNotes(opts)`

opts: { burden (from burdenByBand), gap50 (cumulative ≤50% shortfall or null),
  lim70, lim80 (CHFA two-bedroom limits), rentRange: { low, high } of current rents
  for a recently leased home (FMR, Zillow, Apartment List; not ACS median),
  ruralResort (bool), mihtc: { name } or null, need20yr (number or null) }
Returns { notes: [string], workforce: object|null }.

### `pencil(opts)`

pencil({ limits: { '30': rent2br, ... }, units: { '30': n, ... } optional, homes optional, rules, senior })
homes: [{ tier, bedrooms, rent, units }] prices the mix by bedroom size and wins over units.
Returns { ok, reason?, tiers: [{ tier, rent, noi1, noi15, debtServiceCapacity, firstShortYear, subsidy15 }],
  mix: { units, noi1, noi15, debtServiceCapacity, firstShortYear, subsidy15 } | null, assumptions }.
Figures are per unit per year; mix figures are for the whole mix.
