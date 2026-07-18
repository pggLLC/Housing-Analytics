# Calibration Benchmark — Fruita Mews II Professional PMA vs Tool PMA

**Companion to:** RFC-PMA-BARRIER-COMMUTE-SHED-2026-07.md (§6, benchmark path 1)
**Recorded:** 2026-07-18 by Claude QA from an owner-provided review artifact.

## Benchmark artifacts (two, independent firms, same site)

Market Study of The Fruita Mews II, Kinetic Valuation Group (Amanda Baker MAI /
Brent Griffiths MAI), effective 2026-01-29, prepared to CHFA's Market Study
Guide for a 40-unit 9% LIHTC application at 1138 18 1/2 Road, Fruita, Mesa
County (site census tract 15.03). PMA reviewed and **approved by CHFA's
collateral/review appraiser**. Owner-provided PDF (not publicly published);
retained in the owner's application files.

**Artifact 2:** Rental Market Study, The Fruita Mews (Phase I), Prior &
Associates (Thad Rahn / Josh Roberts), effective 2022-01-05, revised
2022-01-26, same site. Independent firm from Artifact 1. Owner-provided.

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

## Artifact 2 — professional PMA (verbatim facts, 2022)

- **Composition:** "Fruita, Mack, Loma, Redlands, Appleton and northwestern
  Grand Junction." 45,285 inhabitants, ~440 square miles.
- **Named boundaries:** North — Mesa County line; **South — Colorado River /
  Colorado National Monument**; **East — 25 Road / South 5th Street**,
  explicitly because areas east "associate more with central Grand Junction
  which has different commuting patterns and socioeconomic characteristics";
  West — Mesa County line.
- **Tracts (2010 vintage):** 9.00, 14.02, 14.03, 14.04, 15.01, 15.02, 16.00 —
  identical to Artifact 1's set modulo the 2020 census split of 15.01 into
  15.03/15.04.
- **Supplemental demand:** a 40% outside-PMA factor, grounded in the PMA's
  one LIHTC property drawing >25% of tenants from outside.

## Cross-artifact findings

- **F-CAL-5 — professional convergence.** Two independent firms, four years
  apart, drew the same PMA (modulo tract-split). Professional delineation at
  this site is stable and reproducible — a legitimate algorithmic target,
  not one analyst's taste.
- **F-CAL-6 — how professionals actually use barriers.** The 2022 study
  *names* the river/Monument as the southern boundary — but that edge runs
  through uninhabited monument land (nothing excluded), and the analytically
  live eastern edge is a **commuting/socioeconomic line through the middle of
  Grand Junction** (25 Rd/S 5th), not a physical feature. Reconciled with
  Artifact 1's "no inhibiting natural boundaries": barriers serve as polygon
  edges of convenience across empty land; populated-tract exclusion decisions
  are made on commute/socio structure. This sharpens F-CAL-2 and confirms the
  C3 gate: neither artifact shows barriers *binding* — that benchmark is
  still outstanding and must come from a different site type.
- **F-CAL-7 — in-migration prediction vs observation.** 2022 predicted ~40%
  outside-PMA demand; 2024–26 Phase I leasing observed 56% (Artifact 1). Any
  D-full capture threshold must treat outside-PMA demand of 40–56% as the
  professionally documented range at this site.

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
