# `js/components/subject-capture-stack.js`

js/components/subject-capture-stack.js
===============================================================
Demand & Capture stack (CHFA method) — anchored to the Subject Project.

For each AMI tier in subject.unit_mix:
  • Qualifying renter HHs in the county  — from data/co_ami_gap_by_county.json
    (cumulative HHs ≤ AMI tier per HUD limits).
  • Subject units at that tier
  • Capture rate = Subject_units / qualifying_HHs × 100%

Also computes overall (portfolio) capture rate folding in the
in-migration assumption from Subject Project.

A second line, "capture with relocation", grows the county pool only by a
share documented at comparable Colorado projects measured at the county
line (data/market/relocation-comparables.json, low end of the range),
capped at the county's lower-paid workers who commute in 20-60 miles
(data/market/commute-strength.json). No comparable on file, no number.

The pool here is county renters at or under each tier, without CHFA's
rent floor or household-size fit, so the card shows the share with no
CHFA verdict. The 85% line from CHFA's 2027-28 QAP is applied in
the Market Analysis simulator to the CHFA-rule count.

This is screening-grade, not study-grade. The card surfaces what
it can NOT do (under-construction unit deduction, household-size
decomposition, tract-level granularity) so the user knows when to
commission a full study.

Mount target: id="subjectCaptureStackMount".

_No documented symbols — module has a file-header comment only._
