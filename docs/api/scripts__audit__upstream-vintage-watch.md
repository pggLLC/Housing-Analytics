# `scripts/audit/upstream-vintage-watch.mjs`

scripts/audit/upstream-vintage-watch.mjs

Watches external data publishers for new vintage releases. Runs weekly
on cron and opens or updates one tracking issue for a newer vintage or
an unverifiable check that needs human attention.

Background — why this exists
----------------------------
Most upstream data providers (HUD CHAS, HUD FMR, Census ACS) publish
new vintages on a known annual cadence but with no API alerting. Without
an automated watcher, "new CHAS vintage shipped 6 months ago and we
never upgraded" is the kind of slow drift that's easy to miss.

This watcher does two things:
  1. Check the configured vintage against source-specific evidence.
  2. Record outdated or unverifiable results for the workflow's issue tracker.

Sources currently tracked
-------------------------
  - HUD CHAS: current-vintage ZIP control, then candidate ZIP probes.
    A blocked response requires a manual check of the HUD download page.
  - HUD FMR and Census ACS 5-year: calendar-based refresh heuristics,
    not HTTP probes or confirmation that a new release is published.

Output
------
  data/audit/upstream-vintage-watch.json — most recent watch result
  GitHub issue (auto-created/updated for outdated or unverifiable sources)

Exit codes
----------
  0  — watch completed (regardless of findings)
  1  — internal error (network failure, parse failure)

Usage
-----
  node scripts/audit/upstream-vintage-watch.mjs
  node scripts/audit/upstream-vintage-watch.mjs --json

## Symbols

### `watchHudChas(fetchImpl = fetch)`

Check the known published archive before probing possible newer vintages.

### `watchHudFmr()`

HUD FMR — typically published annually in April; we read the
generated fiscal year out of data/hud-fmr-income-limits.json and
compare against the current US fiscal year.

### `watchAcs5Year()`

Census ACS 5-year — Census Bureau publishes new vintages every December.
We check what year build_place_ami_gap.py is configured for.
