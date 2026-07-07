# Codex — Phased Implementation Master Script (2026-07)

**For**: Codex (implementer)
**QA/QC**: Claude Code reviews each phase's PR against that phase's QA gate before the owner merges. **One phase = one PR = one QA gate. Do not start phase N+1 until phase N is merged.**
**Owner**: paulglasgow (merges; squash-merge convention)
**Repo**: `pggLLC/Housing-Analytics` · Public site: `cohoanalytics.com`

Sequence:

| Phase | Deliverable | Spec |
|---|---|---|
| 1 | Affordable Ownership Need module (HNA section) | `docs/audits/CODEX-HANDOFF-AFFORDABLE-OWNERSHIP.md` — execute as written |
| 2 | Combined Jurisdictions (multi-select + paired view + preset regions) | This document, §Phase 2 |
| 3 | Downstream surfacing: place-page cards, digests, briefs | This document, §Phase 3 |
| — | Full-site audit | Claude runs it after Phase 3; not Codex work |

---

## Global rules (apply to every phase)

1. **Branch from fresh main each phase.** A labeling fix to the Housing Need Projection panel (`housing-needs-assessment.html` ~2913–2938 + `js/housing-need-projector.js`) is landing in a parallel session — rebase over it, never revert it.
2. **The masking rule (most important rule in this document).** This repo's most recurring bug class: a panel silently showing county (or wrong-scope) data for a selected place. Every figure you render must be traceably scoped, and every fallback labeled. In Phase 2 this extends to: **no panel may silently show a single member's or containing county's data for a combined selection** — if a metric can't be aggregated, render an explicit "Not available for combined areas" state.
3. **Screening language everywhere.** Outputs are screening estimates. Banned phrases (all phases): "qualified buyers", "mortgage-ready", "buyer qualification", "guaranteed demand", "investment opportunity", "absorption forecast", or any CHFA-determination implication.
4. **Never touch**: `robots.txt`, `sitemap*.xml`, `CNAME`, `test/pages-availability-check.js` (deploy gate), `.github/workflows/*` (unless a phase explicitly allows it), any file with `" 2"`/`" 3"` in the name (iCloud sync cruft — not real source).
5. **CI coupling**: digests/briefs regenerate in-place during CI. If your PR fails checks on files you didn't touch, main broke after you branched — rebase; do not "fix" untouched files.
6. **Sign conventions are load-bearing.** `co_ami_gap_by_county` stores gap as units−households (negative = shortfall); `co_ami_gap_by_place` stores households−units. Never `Math.abs()` a gap; derive from raw `households_le`/`units_priced_affordable_le` fields.
7. Per-phase file allowlists are hard boundaries. If a change outside the allowlist seems necessary, stop and flag it in the PR description instead of making it.
8. Before each PR: `npm run validate && npm run test:hna` plus the phase's own tests, all green locally.

---

## Phase 1 — Affordable Ownership Need

Execute `docs/audits/CODEX-HANDOFF-AFFORDABLE-OWNERSHIP.md` exactly as written (data contract, CHAS-native AMI bands, file allowlist, tests, acceptance criteria).

**One forward-compatibility addition** now that Phase 2 is defined: `computeOwnershipNeed()` in `js/hna/hna-ownership-need.js` must accept its CHAS input as a plain data object (the place-CHAS record shape) rather than reaching for globals, so Phase 2 can pass it an *aggregated* pseudo-record for combined areas. The Phase 1 spec already requires pure functions with data passed in — this is a reminder, not a change.

**QA gate 1 (Claude runs):** the acceptance-criteria section of the Phase 1 doc, verbatim. Key items: place-level spot checks (Erie `0824950` + one `low_confidence` place), whole-dataset no-NaN smoke, provenance pills on every card, counts-first headlines, diff allowlist, banned-phrase scan, `test:ci` green.

---

## Phase 2 — Combined Jurisdictions

### Product definition

Users can analyze more than one jurisdiction at once, three ways, all sharing **one aggregation engine**:

- **Mode A — ad-hoc combine**: select 2–6 non-overlapping jurisdictions (places, CDPs, and/or whole counties) → the HNA renders one combined-area profile.
- **Mode B — place + containing county paired view**: from any place selection, one click adds the containing county as a **side-by-side comparison** in supporting panels. This is NOT aggregation (a place is inside its county — summing double-counts); it is a paired display.
- **Mode C — preset regions**: curated named combos in a new config `data/hna/combined-regions.json`, appearing in the geo selector under a "Regions" optgroup and behaving exactly like a Mode A selection.

### New module: `js/hna/combined-geo.js`

Same conventions as Phase 1's module: browser namespace on `window`, pure functions, no DOM, no fetches; tests load it via the stub-`window` eval pattern (`test/data-scope.test.js`).

**Validation** — `validateCombo(members)`:
- 2–6 members, each `{geoType: 'place'|'cdp'|'county', geoid}`.
- Reject overlap: a place/CDP whose containing county is also a member (resolve containment via `data/hna/derived/place_county_lookup.json`; cross-county places via `data/hna/cross-county-places.json` → `places[geoid].all_counties[]` — overlap if ANY of its counties is a member). Rejection message offers Mode B instead.
- Resolve phantom geoids through `data/hna/place-phantom-aliases.json` before any lookup (the `PlaceChas.lookup` path already does this — reuse it, don't reimplement).

**Aggregation** — `aggregate(members, datasets)` returns a combined pseudo-record plus a per-metric availability map:
- **Counts** (households, cost-burdened counts, AMI-band totals): sum across members. Place CHAS from `data/hna/place-chas.json` (`summary` + `*_hh_by_ami`); county CHAS from `data/hna/chas_affordability_gap.json`. Mind the field-name split: place uses `renter_cb30_share`/counts in `summary`; county uses `pct_renter_cb30` + `*_count` fields.
- **Rates/shares**: never average member shares — re-derive from summed numerator / summed denominator.
- **AMI gap**: per-band from the raw cumulative fields in `data/co_ami_gap_by_place.json` / `co_ami_gap_by_county.json` (`households_le_ami_pct`, `all_households_le_ami_pct`, unit-supply equivalents, keyed "30"…"100"). Sum members per band FIRST, then compute per-band gap = max(0, Δhouseholds − Δunits) band-over-band, then cumulate the clamped per-band gaps (monotonic by construction). Netting cumulative totals directly is a known past bug (F33) — don't repeat it.
- **Median-type metrics** (home value, gross rent): a true combined median doesn't exist. Show the member **range** (min–max with member names) and a household-weighted average labeled **MODELED**. Never present the weighted average as a median.
- **HUD AMI income limits**: county-level by definition. Single-county combo → that county's limits. Multi-county combo → list each county's limits separately, labeled; never blend them.
- **Commuting / LEHD flows**: do NOT sum member flows (flows between members would double-count as both in- and out-flows). v1: the commuting panel renders "Not available for combined areas — view members individually." Same for any panel whose input can't be summed correctly (projections when any member lacks a place-level projection in `data/hna/projections/places.json`; neighborhood context; LIHTC map stays county/statewide-scoped with a note).
- **Ownership Need (Phase 1 section)**: build the aggregated pseudo-record in place-CHAS shape and pass it to `computeOwnershipNeed()`. `dataQuality` for a combo = the WORST member's level, with a caveat naming which member dragged it down.
- Availability map: for every HNA panel, `available: true|false` + reason. Renderers consult it — this is what makes global rule 2 enforceable.

### UI

- **Selector**: a "Combine jurisdictions" toggle near `#geoSelect` (single `<select>` populated at `js/hna/hna-controller.js:133–205`). When on, selections accumulate as removable chips; a "Combined area" pill (member names) appears at the top of the HNA and in every panel header that shows aggregated data. Keep the existing single-select path completely untouched when the toggle is off — `HNAState.state.current` gains `{geoType:'combined', members:[...]}` only in combine mode.
- **Mode B**: "Compare with <County>" button on place selections; supporting panels render place and county columns side-by-side, each column labeled. Reuse the side-by-side machinery from `js/hna/hna-comparison.js` where practical rather than building a second comparison layout.
- **Mode C**: "Regions" optgroup in `#geoSelect` fed from `data/hna/combined-regions.json`. Config schema: `{regions: [{id, label, members: [{geoType, geoid}], note}]}`. Ship these four starter presets (owner will tune later — resolve names to geoids from `data/hna/geography-registry.json`, do not guess geoids): Colorado River Valley (New Castle, Silt, Rifle, Parachute); Roaring Fork Valley (Glenwood Springs, Carbondale, Basalt); Yampa Valley (Steamboat Springs, Craig, Hayden); San Luis Valley Core (Alamosa, Monte Vista).
- **URL state**: combined selections serialize to a shareable query param (e.g. `?geos=0850700+0869590+0864255`); presets serialize as `?region=<id>`. Restore on load.
- **Export**: HNA export (`js/hna/hna-export.js`) stamps the member list and the "combined screening area" label on every page/sheet it produces for a combo.
- Accessibility: chips keyboard-removable, toggle state announced, combined pill is text (not color-only).

### Out of scope for Phase 2

Opportunity Finder, Compare page, Deal Calculator, place pages, briefs/digests, ranking index — none of them learn about combos in this phase. No new ETL; `data/hna/combined-regions.json` is the only new data file, and it's hand-curated config, not generated.

### Allowlist (Phase 2)

`js/hna/combined-geo.js` (new), `js/hna/hna-controller.js`, `js/hna/hna-renderers.js`, `js/hna/hna-export.js`, `housing-needs-assessment.html`, `data/hna/combined-regions.json` (new), `docs/methodology/COMBINED-JURISDICTIONS-METHODOLOGY.md` (new — purpose, aggregation rules incl. the per-band clamp, what's unavailable and why, median caveat, AMI-limit handling, screening framing), `test/combined-geo.test.js` (new), `package.json` (test script + `test:ci` chain).

### Tests (`test/combined-geo.test.js`)

- Aggregation math: counts sum; shares re-derived (assert a case where averaging shares would give a different, wrong answer); AMI bands sum per band.
- Per-band gap clamping: fixture where cumulative netting would go non-monotonic → assert monotonic output.
- Overlap rejection: place + its county; cross-county place (use a real entry from `cross-county-places.json`, e.g. Arvada `0803455` spans Jefferson + Adams) + either county.
- Phantom-alias member resolves to canonical record.
- Availability map: LEHD/commuting marked unavailable; multi-county combo lists 2+ AMI-limit entries.
- Mixed place+county combo (non-overlapping) aggregates correctly.
- `computeOwnershipNeed()` accepts the aggregated pseudo-record; combo `dataQuality` = worst member.
- No `NaN`/`undefined` anywhere (walk the output); zero-household member tolerated.
- Preset config: every `combined-regions.json` member resolves against the registry and passes `validateCombo`.

### QA gate 2 (Claude runs)

1. Mode A: New Castle + Silt + Rifle — combined counts equal the hand-summed member values from `place-chas.json`; every rendered rate equals summed-numerator/summed-denominator.
2. **Masking sweep**: for a combined selection, walk every HNA panel — each either shows aggregated data with the combined pill or an explicit unavailable state. Any panel silently showing one member's or a county's numbers = automatic fail.
3. Mode B: paired columns both labeled; no aggregation of place+county anywhere.
4. Mode C: each preset loads, URL round-trips, members match the registry.
5. Multi-county combo shows per-county AMI limits, never a blend.
6. Ownership Need section renders for a combo with worst-member dataQuality + caveat.
7. Single-select regression: with the toggle off, HNA output is byte-identical in behavior to pre-phase (spot-check Erie + one county against pre-branch rendering; `test:hna` 730+ green).
8. Diff allowlist; methodology doc complete; banned phrases absent.

---

## Phase 3 — Downstream surfacing (place pages, digests, briefs)

Now that both features are stable on the live HNA, surface them in generated artifacts. **This phase intentionally touches `scripts/` and regenerates committed data artifacts — the allowlists above no longer apply; this one does.**

### Work items

1. **Place pages**: add one short "Affordable Ownership Need" card to the place-page template in `scripts/hna/build_place_pages.py` — recommendation + top 2–3 indicators + link to the HNA section and methodology. No methodology copy duplicated across ~500 pages. Port the JS calc faithfully to Python (same constants; cite the JS module in a comment) OR precompute a small JSON the generator reads — pick whichever matches how the generator handles similar derived content today, and say which you chose in the PR. Then regenerate ALL place pages in the same PR (`test:place-pages-fresh` fails CI on drift since PR #1072).
2. **Jurisdiction metrics digests**: add ownership-need fields (tiers, recommendation, headline counts) to `scripts/hna/build_jurisdiction_metrics_digest.mjs` output. Regenerate digests in the same PR.
3. **Briefs**: add a short tenure-strategy block (screening framing, verbatim intro from the Phase 1 doc) to the brief template so regenerated briefs carry it. Regeneration happens via the existing CI path — do not hand-edit generated briefs. `npm run test:briefs` must pass.
4. **Combined areas in artifacts**: preset regions (Mode C) get NO generated pages/briefs in this phase — generated artifacts stay per-geoid. Note it as future work in the PR.

### Landmines specific to this phase

- Regeneration order matters elsewhere in this repo (summary caches before place-chas). You are NOT regenerating those here — if you find yourself running `build_place_chas.py` or touching `data/hna/summary/`, you've left the phase's scope.
- Keyless Census API calls fail hard in this repo's pipelines; nothing in this phase should call the Census API at all. If a builder you touch tries to, stop and flag.
- `permits.json` and other minified artifacts stay minified.
- Do not edit `" 2"`/`" 3"` duplicate files (e.g. `build_place_pages 2.py`) — the real file has no suffix.

### Allowlist (Phase 3)

`scripts/hna/build_place_pages.py`, `scripts/hna/build_jurisdiction_metrics_digest.mjs`, the brief template file(s) (locate via `scripts/validate-jurisdiction-briefs.py` and the digest→brief chain; name them in the PR), regenerated artifacts (`places/*.html`, `data/hna/jurisdiction-metrics-digest/*.json`, briefs), a small precomputed ownership JSON under `data/hna/` if you chose that route, tests, `package.json` if a test script is added.

### QA gate 3 (Claude runs)

1. Place-page card matches the live HNA section's values for 3 spot-check places (Erie, one `low_confidence` place, one small town) — the Python/JS port produces identical tiers and recommendations.
2. `test:place-pages-fresh`, `test:briefs`, `test:jurisdiction-metrics-digest`, full `test:ci` green.
3. Digest fields present and sane for all jurisdictions (no NaN/null regressions — compare digest record counts before/after).
4. No methodology bloat: place-page card ≤ ~15 lines of rendered content, links out for detail.
5. Diff contains only allowlisted files + their regenerated outputs.

After QA gate 3 passes and merges: **stop**. Claude runs the full-site audit next; any findings become follow-up work, not Codex free-lancing.

---

## Deliverables per phase (PR description template)

1. Summary of what changed and why
2. Files changed vs the phase allowlist
3. Constants/thresholds chosen, with evidence
4. Tests added and their results
5. Known limitations
6. Owner decisions needed (if any)
