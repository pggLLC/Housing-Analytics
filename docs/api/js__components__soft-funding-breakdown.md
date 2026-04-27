# `js/components/soft-funding-breakdown.js`

js/components/soft-funding-breakdown.js
Renders eligible soft-funding programs below the Sources & Uses gap line
on the Deal Calculator page.

Shows:
  - All eligible programs for the selected county + execution type (9%/4%)
  - Per-program: max per project (published rule), deadline, competitiveness,
    eligibility restrictions, admin entity
  - PAB volume cap qualitative warning for 4% deals

⚠ Dollar-figure policy (2026-04):
  This renderer intentionally does NOT display the `available`, `awarded`,
  or `capacity` fields from `data/policy/soft-funding-status.json`. Those
  figures are quarterly admin-maintained estimates that drift between
  refresh cycles; showing stale balances was confusing users. Tracker API
  methods (`sumEligible`, `getPabStatus`) still expose them for non-UI
  use, but the surface shown to users is verification-pointed, not
  dollar-valued. Verify current balances with the admin entity before
  citing to a client.

Depends on: js/soft-funding-tracker.js (must load first)
Mount: renders into #dcSoftFundingBreakdown (created dynamically)

_No documented symbols — module has a file-header comment only._
