# `js/economic-section-callouts.js`

economic-section-callouts.js

F217 — "Why this matters" callouts for the Economic Dashboard.
Mirrors the F211 HNA developer-context + F216 HNA section takeaway
pattern: matches section headings by id/text, injects a styled
aside under the existing heading, idempotent.

The dashboard is a wall of macro indicators (CPI, Fed funds rates,
mortgage rates, prediction-market odds, LIHTC trends). Without an
orienting "why does this matter for housing" line under each
section, the page reads as financial newswire rather than a
housing-development context tool.

Each callout explains WHY the indicators in that section matter to
affordable housing — connecting macro signals to construction
lending costs, LIHTC equity pricing, rental demand pools, the
pipeline of CHFA deals. Audience: developers, lenders, policy
staff, residents, journalists, students. Voice neutral per F211.

Exposes: window.EconomicSectionCallouts (debug/extend)

_No documented symbols — module has a file-header comment only._
