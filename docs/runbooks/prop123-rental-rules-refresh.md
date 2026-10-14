# Prop 123 rental rules refresh

`data/policy/prop123-rental-rules.json` holds the income and rent limits for rental
housing funded by Proposition 123 (C.R.S. Title 29, Article 32), by program. It is
curated by hand: every limit is copied from the statute or a program guideline with
a verbatim quote, and anything not confirmed from a primary source is `null` with a
reason.

Re-check it by `meta.review_by`, and whenever OEDIT/CHFA publish new Affordable
Housing Financing Fund guidelines (each fiscal year), DOLA publishes commitment or
petition guidance, or the legislature amends Article 32.

1. Re-read each source in `sources`. The AHFF guideline PDFs are on
   coloradoaffordablehousingfinancingfund.com; DOLA's pages are on cdola.colorado.gov.
   Some of these sites answer scripted requests with HTTP 403, so read them in a browser.
2. Update any limit, quote, version or petition that changed. Do not carry forward a
   figure the source no longer states.
3. When CHFA publishes a new rent table, point `meta.rent_table` at it and re-list
   `rent_table_deviations` from it: the cells whose published maximum rent differs
   from 30% of the income limit for 1.5 persons per bedroom.
4. Set `meta.last_verified` and `meta.review_by`, run
   `npm run test:prop123-rental-rules`, and follow AGENTS.md for the manifest steps on
   any `data/` change.
