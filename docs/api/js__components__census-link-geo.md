# `js/components/census-link-geo.js`

js/components/census-link-geo.js — F114
========================================
Rewrite static <a href="https://data.census.gov/table/..."> links and
data-source-url attributes so they include the correct ?g= geography
parameter for the currently-selected jurisdiction. Without this fix,
every hard-coded Census link on the site (mostly on the HNA page) points
at the table page with no geo filter, which silently defaults to the
entire United States — useless to anyone screening a Colorado place.

Geography encoding (Census "g=" param):
  STATE_COUNTY_PLACE_TRACT
  0400000US08          → CO statewide
  0500000US08097       → Pitkin County  (state 08 + county 097)
  1600000US0867280     → Salida city    (state 08 + place 67280)

Selection precedence:
  1. window.JurisdictionUrlContext.resolveSync() (URL ?fips= / ?geoid=)
  2. WorkflowState session jurisdiction (if SiteState is loaded)
  3. State (Colorado) — fallback

Idempotent — re-runs safely on each invocation. Listens for the
jurisdiction-url-context:resolved event so it picks up the right geo
once the brief / OF / HNA dispatch their async resolution.

_No documented symbols — module has a file-header comment only._
