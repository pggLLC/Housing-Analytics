# `js/deal-calculator.js`

## Symbols

### `costPerGrossSf(tdc, grossSf)`

Cost per gross square foot, or null.

null, never 0 — and never omitted. $/SF is the figure a developer, lender
or appraiser checks FIRST, because it is the one they can compare against
everything else they have seen. A 0 would read as "this project costs
nothing per foot"; an absent key reads as "this tool does not do that".
Neither is true when the answer is "nobody entered a floor area".

Gross area is deliberately not derived from unit count. Unit sizes sum to
NET rentable area; dividing TDC by that overstates $/SF by however much
circulation, mechanical and common space the building has — commonly
15-25%. Guessing it would produce a plausible number that is wrong in a
consistent direction, which is worse than no number at all.

### `selectedPublicInterestOutcome(screen)`

The public / steward is the third actor on the ownership panel (#1815).
Its claim used to live only inside the resale comparison table. This row
lifts the selected mechanism's moderate-scenario outcome onto the panel:
the capped next-buyer price (how the public interest is expressed under
fixed, lesser-of and shared-appreciation conventions) and any subsidy the
public recovers in cash (recapture conventions). Screening only.

### `setCostPerSf(result)`

Cost per gross SF, or a dash that says why.

A bare "—" is the display equivalent of a coerced zero: it looks like an
answer and means nothing. The reader cannot tell "this tool does not
compute that" from "you have not told me the floor area" — and only one of
those is fixable by them, in five seconds, with a field that is right
there. So the absent state carries its reason in the title attribute and
the note beneath.

### `getZoriPerBrRent(fips)`

Q5: Per-BR ZORI market rent estimate.

ZORI publishes a single all-bedroom index per county. We scale to
per-BR by applying the HUD FMR per-BR ratio (fmr_br / fmr_2br) to
the ZORI value. This preserves the ZORI level while reflecting the
county's actual BR-to-BR rent spread.

Returns { studio, '1br', '2br', '3br', '4br' } or null when either
ZORI county data or HUD FMR for the county is missing.

### `updateAmiLimitsFromFmr(fips)`

Populate every tier/bedroom from the selected shared rent-limit regime.

### `populateCountySelector(sel)`

Populate the county selector dropdown from HudFmr data.
@param {HTMLSelectElement} sel

### `collectBedroomMix()`

Units by bedroom type across every checked AMI tier (split rows win over the tier dropdown).

### `_findAmiGapCounty(fips)`

Find the county record in the AMI gap data by FIPS.

### `_renderCrossCountyDisclosure(fips)`

Render the cross-county jurisdiction disclosure for the chosen county.
Surfaces an info banner when the chosen county contains CO places that
span multiple counties — a parcel on the wrong side of the line uses a
different county's HUD AMI tier.

Idempotent: calling with no fips hides the banner.

### `_renderHmdaContext(fips)`

Render the HMDA mortgage-credit-access context for the chosen county.
Surfaces 1-line callout: origination count, denial rate, mean loan size,
multifamily originations, with state benchmarks. Sourced from CFPB HMDA
Data Browser data (PR #786, refreshed monthly).

Why this matters: tightening credit (rising denial rate, falling
originations) precedes slowdown in multifamily starts and reduced LIHTC
bond demand. Per-county denial-rate variance also exposes underserved
markets that LIHTC deals can target.

Idempotent: calling with no fips hides the banner.

### `_renderPabNote(fips)`

F25: Render the PAB (private-activity-bond) volume-cap note for the 4%
bond path. Shows the selected county's local direct allocation when it's
a designated issuer; otherwise notes it draws from CHFA's statewide pool.
Always keeps the "capacity, not a ceiling" framing.

### `_renderZoriMarketContext(fips)`

Q5: Render the ZORI market context line beneath the achievable-rent-cap
toggle. Shows the county's current ZORI median, YoY change, and vintage
month so the user can see *why* the cap might or might not bind.

### `_alTriangulationLine(fips)`

F96 — Build a one-line Apartment List comparison string for the
selected county. AL is city-level; we surface the largest AL-tracked
city associated with this county (best-effort name match).

### `_dolaTriangulationLine(fips)`

F96 — Build a one-line DOLA Apartment Rent Survey comparison for
the selected county. The survey reports by region; we look up which
region this county falls in from the survey's countyToRegion map.
Shows median rent + vacancy when both are available.

### `_renderAchievableCapStatus(capOn, perBrMarket, bindings)`

Q5: After recalculate() runs, surface which 70%-120% AMI rows actually
had their rents reduced by the market cap. Empty array → cap not binding.

### `_wireCountyDetect(countySel)`

Hook up the lat/lon → county auto-detection UI controls.
@param {HTMLSelectElement} countySel - the dc-county-select element

### `setDesignationContext(basisBoostEligible)`

Update the QCT/DDA indicator in the deal calculator UI.
Called by the market-analysis controller once checkDesignation() resolves.

When basis_boost_eligible is true the checkbox is pre-checked and the
note is shown so the user is aware of the designation.  The basis %
slider is intentionally NOT auto-adjusted — the user retains full
manual control per the principle that the designation does not
automatically apply the 130% boost (IRC §42(d)(5)(B) requires election).

@param {boolean} basisBoostEligible - True when site is in a QCT or DDA.

### `TZ_CREDIT`

HB26-1065 Transit Zone (TZ) state credit — a possible source, never
added to the stack (#1937 Phase 4, #1973). Called by the PMA transit-zone
gate with a TransitZone.status() result. The line appears only when the
site passes TransitZone.fundingPath. It states the draft QAP's per-project
pairing for the selected credit type. The amounts live only in the
HB26-1065 entry's `tz_credit_pairing` in
data/policy/tax-credit-legislation.json, pinned to the QAP text in
data/audit/chfa-qap-watch.json; until that file loads no amount is shown.
The statewide cap below must match the same entry
(test/transit-zone-funding-line.test.js).
