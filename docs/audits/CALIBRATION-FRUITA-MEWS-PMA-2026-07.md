# Calibration Benchmark — Fruita Mews II Professional PMA vs Tool PMA

**Companion to:** RFC-PMA-BARRIER-COMMUTE-SHED-2026-07.md (§6, benchmark path 1)
**Recorded:** 2026-07-18 by Claude QA from an owner-provided review artifact.

## Benchmark artifact

Market Study of The Fruita Mews II, Kinetic Valuation Group (Amanda Baker MAI /
Brent Griffiths MAI), effective 2026-01-29, prepared to CHFA's Market Study
Guide for a 40-unit 9% LIHTC application at 1138 18 1/2 Road, Fruita, Mesa
County (site census tract 15.03). PMA reviewed and **approved by CHFA's
collateral/review appraiser**. Owner-provided PDF (not publicly published);
retained in the owner's application files. A second artifact (the 2022 Phase I
study) exists but sits behind a macOS-restricted Dropbox path; add it to this
record when copied to a readable location.

## Professional PMA (verbatim facts)

- **Shape:** "a polygon encompassing a portion of northwestern Mesa County
  that includes Fruita and portions of Western Grand Junction."
- **Tract list (8, Mesa County 08077):** 0009.00, 0014.02, 0014.03, 0014.04,
  0015.02, 0015.03, 0015.04, 0016.00. (The study prints a doubled-digit
  county prefix typo "08777…"; the tract numbers are unambiguous.)
- **Delineation basis:** "physical boundaries, which include traffic and
  commute patterns," market surveys, resident managers, planning staff.
  Rationale is explicitly commute-economic: Grand Junction (~12 miles) is the
  hub; smaller-community residents commute to it.
- **On barriers:** "There are no natural boundaries in Fruita that would
  inhibit anyone from relocating to the Subject." The PMA polygon's southwest
  edge nonetheless *runs along* the Colorado River / Colorado National
  Monument — a boundary of convenience, not an exclusion claim.
- **Observed migration (Phase I leasing, ~129 applications since 2024):**
  44% of applicants from PMA zips, 56% outside, 9% from outside Mesa County;
  the study infers in-migration "9 percent to 56 percent."
- SMA = Mesa County. PMA totals used in demand: 995 qualifying renter
  households across 30–80% AMI bands; overall penetration 13.9%.

## Tool output at the same site (computed 2026-07-18, current main)

Centroid-inclusion 3-mile buffer at 39.1660, −108.7080:

| Result | Tracts |
|---|---|
| Tool 3-mile PMA | **2**: 08077001503 (0.88 mi), 08077001504 (1.39 mi) |
| Overlap with professional PMA | 2 of 8 (25% of the professional set) |
| Tool-only (false inclusions) | **none** |
| Professional-only (missed) | 0009.00, 0014.02, 0014.03, 0014.04, 0015.02, 0016.00 — the Fruita periphery and western Grand Junction commute extension |

## Calibration findings

- **F-CAL-1 — the first-order gap at small-town sites is commute extension,
  not barriers.** The professional PMA reaches ~12 miles toward the economic
  hub, asymmetrically (western Grand Junction only). A circular buffer of any
  radius cannot reproduce an asymmetric commute-shaped polygon: 3 miles
  captures 25% of the professional set; a 12-mile circle would over-include
  east Grand Junction the professional excluded.
- **F-CAL-2 — the professional affirms the M3 never-exclude posture.** With a
  major river and a national monument adjacent, the study still finds no
  inhibiting natural boundary; features appear as edges of convenience.
  Barrier *exclusion* would have contradicted the professional here; bounded
  friction downweighting (or nothing) would not.
- **F-CAL-3 — capture humility.** Even the professional PMA contained only
  44% of actual Phase I applicants. Any future D-full capture threshold must
  accommodate documented 9–56% in-migration; over-tight PMAs are wrong in
  the direction the leasing data can prove.
- **F-CAL-4 — no false inclusions.** The tool's conservatism errs by
  under-extension only at this site, which is the correctable direction.

## Effect on the RFC (amendment applied same-day)

Priority reorder: **D (commute-shed) is promoted from optional follow-on to
the primary realism gap for rural/small-town sites**, with barriers (C2/C3)
retained as specified but explicitly second-order pending a benchmark where
barriers bind (an urban river/interstate site would be the right second
artifact). One benchmark satisfies the RFC's floor to *proceed with C1/D-lite
scoping*; the C3 barrier-enable gate still requires a benchmark where barrier
treatment has observable effect.
