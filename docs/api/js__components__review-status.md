# `js/components/review-status.js`

js/components/review-status.js
Review-date warnings for hand-verified records (#2009).

Homebuyer programs and the tax-credit policy watchlist are checked by a
person against an official source, and each record carries the date it was
checked (last_verified) and the date it must be re-checked by (review_by).
Program amounts, eligibility and deadlines change; a card that keeps
presenting July's terms in November, with nothing to say so, is the defect
this prevents. The warning is computed from today's date every time the page
loads — nothing has to be regenerated for it to appear — and the daily
workflow policy-review-reminders.yml opens an issue so the re-check happens.

States: 'current' (no warning), 'due' (within DUE_SOON_DAYS), 'overdue'
(past review_by), 'unknown' (no review date recorded — said, not hidden).

_No documented symbols — module has a file-header comment only._
