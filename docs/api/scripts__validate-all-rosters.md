# `scripts/validate-all-rosters.js`

validate-all-rosters.js — F135
===============================
Single entry point that runs every roster validator in the repo.
Exits non-zero on any mismatch so the script can gate CI / release.

Currently validates:

  1. Advocacy assignments vs. service areas
     (existing scripts/validate-advocacy-roster.js)

  2. Local PHA roster GEOIDs — every property in data/affordable-
     housing/local-pha-roster/*.json must have lat/lng inside the
     claimed county_fips. Catches the Lake/La Plata-style swap that
     was the trigger for F129.

  3. School district + hospital + major-employer assignments — each
     entry's name must contain the jurisdiction or a recognized
     regional marker so a Granby-area org doesn't get tagged to a
     Garfield-County town (the Mountain Family Center bug, F130).

  4. Affordable-housing properties manifest hash matches actual
     content. If a stale manifest sneaks past dedupe, cache-busts
     silently break.

Run:  node scripts/validate-all-rosters.js
CI:   add to package.json as `npm run validate:rosters`

_No documented symbols — module has a file-header comment only._
