# Codex Handoff — D-full: Commute-Shaped PMA (Opt-in Mode)

**Refs:** #1232 (RFC-PMA-BARRIER-COMMUTE-SHED-2026-07.md §5/§9), CALIBRATION-FRUITA-MEWS-PMA-2026-07.md, #1242 (travel-time matrix, merged in #1262)
**Author:** Claude QA · **Date:** 2026-07-19 · **Status:** implementation-ready
**Owner approvals already in hand (2026-07-18):** D-full as a user-selectable, default-off mode; no separate scope approval needed. This handoff settles the design decisions the RFC deferred to the implementation PR (data sufficiency, anchoring, materiality floor, barrier interaction).

## 1. The decision this document exists to make

**Is the merged travel-time matrix (`data/market/travel_time_matrix_co.json`,
1,447 tracts × 15 hubs) sufficient for D-full, or is the RFC's tract-to-tract
OD materiality artifact still required?**

**Decision: the OD artifact is still required. The travel-time matrix is
supporting context, not the engine.** Three grounds, one of them decisive:

1. **Basin resolution fails at the calibration site (decisive).** Computed
   2026-07-19 from the merged matrix: all 8 professional-PMA tracts at Fruita
   (08077 0009.00–0016.00 set) have `nearest_hub = grand_junction` at 8–41
   minutes — and so does every central/east Grand Junction tract the
   professionals *excluded*. The analytically live PMA edge at this site is
   the 25 Rd / S 5th St commuting-socioeconomic line through the middle of
   Grand Junction (F-CAL-6). Hub drive times are constant across that line;
   OD flows are not. No rule built on tract→hub times can reproduce the
   professional set — it would either stop at the buffer or swallow east
   Grand Junction whole.
2. **Hub-anchored ≠ site-anchored.** D-full must answer "which home tracts
   supply workers to jobs near *this site*" for arbitrary user sites. The
   matrix is anchored to 15 fixed hubs; it cannot be re-anchored without a
   router call at analysis time, which the static site cannot make.
3. **D-full's claims are flow claims.** Capture rates and the F-CAL-7
   validation bracket (40–56% outside-PMA demand) are statements about where
   workers actually live and work — only LODES OD carries that.

**What the matrix DOES contribute to D-full** (and why #1262 was still the
right build): (a) a *basin outer bound* — the extension rule may never add a
tract whose `nearest_hub` differs from the site tract's basin, which prevents
absurd cross-mountain extensions on thin OD flows; (b) drive-time sanity
disclosure per extended tract in the audit table ("+Loma · 14 min to hub ·
OD 212 jobs"); (c) QA cross-checks. Its `context_only`/consumer-gate guard
stays exactly as shipped — D-full consumes it read-only for bounds/labels,
never as the extension signal, and the toggle-off path must not load it.

## 2. PR D-F1 — the OD artifact (data only, no behavior change)

**Artifact:** `data/market/lodes_tract_od_co.json` (minified, like
permits.json).

**Build:** new `scripts/hna/build_tract_od_matrix.py`, reusing the existing
download/cache in `scripts/hna/build_place_od_flows.py`
(`co_od_main_JT00_{year}.csv.gz`, LODES8, currently 2023; block-level).
Aggregation is exact, not apportioned: 15-digit block geocode → first 11
digits = 2020 tract GEOID, on both ends. Colorado-only both ends (JT00 main
is in-state by definition). Sum `S000` per (home_tract, work_tract) pair.

**Materiality floor — coverage-defined, not invented:** retain the smallest
pair set (by descending S000) covering **≥95% of total statewide S000 flow**;
`meta` records the retained/dropped flow shares, retained pair count, and the
implied minimum-jobs cutoff that the 95% rule produced. The floor is thus a
compression disclosure, not a modeling threshold — no invented number, per
the RFC's fabrication ban. If the artifact exceeds ~25 MB minified at 95%,
drop to 90% and disclose; do not silently truncate.

**Meta:** LODES version/vintage/fetch date, `context_only: true`,
`not_scoring_input: true` (until D-F2's mode consumes it *behind the
toggle*), computed `review_by` (run date + 90d — the #1258/#1260 convention),
LODES public-domain citation, and the standing limitation that LODES is
synthetic-noise-protected jobs data, not a household survey.

**Tests (`test:lodes-tract-od`, wired into test:ci):** non-vacuous counts
(both-ends-CO 11-digit GEOIDs; pair count within shrink-guard bounds);
coverage share ≥ the declared floor, recomputed from the rows; Fruita-area
fixture — pairs (08077001503→08077000900-area work tracts and the reverse)
present with plausible magnitudes; **consumer gate** — neither
`js/market-analysis.js` nor `js/market-analysis-scoring.js` references the
file in this PR (same guard shape as #1259/#1262, sabotage-provable).

**Refresh:** extend `.github/workflows/rebuild-place-od-flows.yml` (existing
cron already picks up new LODES vintages) to also rebuild this artifact —
one workflow, one source download, two outputs.

## 3. PR D-F2 — the mode (behind the toggle, default off)

**Anchoring decision: workplace-anchored.** The professional logic at Fruita
is "residents of the shed commute to jobs in/near the hub; renters at the
site come from that shed." Concretely: the workplace set **W** = the current
buffer PMA's tract set (the seed — unchanged default geography). Candidate
extension tracts are home tracts *h* ∉ seed with:

1. `flow(h → W) ≥ m` — absolute materiality (jobs commuting from *h* into
   the seed's workplaces), and
2. `flow(h → W) / outflow(h) ≥ s` — orientation share (the tract's commute
   is *pointed at* the site area, the F-CAL-6 discriminator), and
3. same basin: `nearest_hub(h) == nearest_hub(site tract)` (travel-matrix
   outer bound, §1), and
4. F-CAL-3 humility: the rule extends by evidence and never claims capture —
   outputs report the OD flow shares; they do not assert "X% of demand."

**Parameter honesty — fit, don't invent:** *m* and *s* are chosen as the
values that reproduce the Fruita professional set, and the doc pre-registers
the acceptance gate below. They ship in a fixture file labeled
`calibration_source: "Fruita Mews II (KVG 2026 / Prior 2022)"` with
`production_use: "beta"`; the mode carries a "beta" label until a second
professional benchmark validates the same parameters unmodified (same
pattern as the C3 barrier gate). One benchmark is a calibration set of one —
the doc and UI must say so.

**Pre-registered Fruita acceptance gate (D-F2 cannot merge without it):**
- Captures **≥6 of the 8** professional tracts (Jaccard ≥ 0.6 vs the
  professional set);
- **Zero false inclusions east of the 25 Rd / S 5th St line** (the tracts
  the professionals excluded for commute orientation — pin 2–3 central/east
  GJ GEOIDs in the fixture as must-not-include);
- Implied outside-PMA share reported by the mode falls inside the
  **40–56%** documented bracket (F-CAL-7) — reported as validation output,
  never used as a tuning target.

**Barrier interaction: none in D-F2.** Fruita affirmed barriers are
second-order (F-CAL-2); M3 composes later at C3 by multiplying the same
`_bufferShare` weights, so nothing in D-F2 needs barrier awareness.

**UX/disclosure (RFC §7 contract, restated as requirements):**
- Toggle: "Commute-shaped PMA (beta)" — default off; circular buffer always
  one click back; whole-tract fills with weight opacity, no clipping.
- **Every output and export carries its mode label** — demand counts and
  capture context mean different things per mode (RFC hard requirement b).
- Extended tracts badged in the audit table with their OD evidence and the
  travel-matrix drive-time context field.
- OD artifact missing/stale → toggle disabled with a data warning chip;
  never a silent fallback to the buffer while claiming commute shaping.

## 4. Tests and QA (D-F2)

1. **Pinned Fruita fixture:** site 39.1660, −108.7080 with the toggle on
   yields the acceptance-gate tract set exactly; toggle off yields today's
   2-tract buffer byte-identically.
2. **Toggle-off invariance (CI-asserted):** all existing PMA scoring tests
   and pinned scores unchanged; the mode module is not even fetched until
   toggled (network-guard in test, same shape as the D-lite gate).
3. **Sabotage pre-registration for external QA:** (a) disable the
   orientation-share condition → east-GJ must-not-include fixture fails;
   (b) disable the OD extension entirely → the ≥6-of-8 capture fails;
   (c) strip the mode label from the export path → label guard fails.
4. Synthetic-commute guard carried forward (RFC test 6): forcing
   `_buildSyntheticWorkplaces` on changes nothing in shipped output.
5. Travel-matrix guard: `context_only` consumer gate from #1262 still passes
   — D-F2 reads it only in the mode module, which asserts bounds/labels
   usage only (no weight derivation from drive times; grep + behavior test).
6. Mode-label guard on every export surface (CSV/JSON/summary).

## 5. PR split and sequencing

- **D-F1** — OD artifact + tests + cron wiring. No behavior change. Ships
  immediately; unblocks everything.
- **D-F2** — mode implementation behind the default-off toggle + Fruita
  acceptance gate + full test battery. External QA re-runs the acceptance
  gate and the pre-registered sabotages before merge.
- **D-F3 (later, evidence-gated)** — remove the "beta" label and consider
  default-visibility promotion only after a second professional benchmark
  (ideally the urban river/interstate site that also gates C3) validates the
  Fruita-fit parameters unmodified. Not scheduled; do not start.

Sequencing vs the rest of the board: D-F1/D-F2 sit behind #1253 PR 1 and
#1251 in the queue unless the owner pulls them forward; C2 (barrier flag,
already merged flag-off) and C3 are untouched by this work.

## 6. Owner items

None blocking — scope was approved 2026-07-18. Standing request repeated:
a second professional market study (urban site with a river/interstate) when
available; it advances both D-F3 and the C3 barrier gate at once.
