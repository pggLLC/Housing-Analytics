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

CHFA convention: capture < 25% per tier is generally fundable;
25–35% is borderline; > 35% is a red flag for the underwriter.

This is screening-grade, not study-grade. The card surfaces what
it can NOT do (under-construction unit deduction, household-size
decomposition, tract-level granularity) so the user knows when to
commission a full study.

Mount target: id="subjectCaptureStackMount".

_No documented symbols — module has a file-header comment only._
