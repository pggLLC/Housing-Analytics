# `js/components/subject-project.js`

js/components/subject-project.js
===============================================================
The Subject Project panel anchors the PMA tool to a SPECIFIC proposed
LIHTC project (unit mix × AMI tier × bedroom × proposed rent + size),
rather than just a site location. Every downstream card (rent
comparison vs LIHTC max, income eligibility, demand & capture by tier)
keys off this single source of truth.

Persistence: localStorage under one global key (the Subject Project
applies to whichever site is active — it travels with the analysis).

Income-limit / max-rent source: CHFA's "Income Limit and Maximum Rent
Tables for All Colorado Counties" — the authoritative table for CO
LIHTC underwriting. CHFA republishes HUD MTSP with any HERA-Special
adjustments and the Prop 123 rural-resort extensions (130-160% AMI for
12 rural-resort counties: Archuleta, Chaffee, Eagle, Grand, Gunnison,
La Plata, Ouray, Pitkin, Routt, San Juan, San Miguel, Summit).

The CHFA table publishes rents DIRECTLY by AMI tier × bedroom (no
formula needed) and income limits by 1-8 person household size.

HERA Special applies only to Housing Tax Credit projects placed in
service on or before 12.31.2008. The same county can have BOTH HERA
and non-HERA limits in the table; toggle in the Subject Project to
pick the right set for the project's PIS date.

LIHTC family-size-by-bedroom (IRS §42):
  Eff = 1.0 person, 1BR = 1.5, 2BR = 3.0, 3BR = 4.5, 4BR = 6.0

Exposes window.SubjectProject:
  • mount(container)            — render input + cards
  • get()                       — read current Subject from storage
  • set(subject)                — write Subject + notify subscribers
  • subscribe(fn)               — fire on every change
  • computeLihtcMaxRent(c,fips,tier,br,opts) — published CHFA rent
  • computeIncomeLimit(c,fips,tier,size,opts) — published CHFA income
  • loadChfa() / loadHud()      — singleton data loaders
  • DEFAULT_SUBJECT             — empty starter shape

_No documented symbols — module has a file-header comment only._
