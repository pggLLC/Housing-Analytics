# Codex — Backlog burn-down & data-quality follow-ups (July 2026)

**For**: Codex (implementer)
**Date**: 2026-07-06
**QA**: Claude Code reviews each PR against the acceptance criteria in its task block. One PR per task (or per task-group where noted) — do not bundle unrelated tasks. Deviations from a task's file scope will bounce the PR.
**Repo**: `pggLLC/Housing-Analytics` · Public site: `cohoanalytics.com`

---

## Where the repo stands (context — read before starting)

Shipped in the last 48h, all merged to `main`:

- **#1060** — Housing Need Projection panel now discloses county scope for place/CDP selections (pill suffix, `geoScope` provenance stamp on `HousingNeedProjector` output, dormant county-CHAS fallback labeled via `chasCountyFallback` → confidence chip).
- **#1062** — Opportunity Finder: F223 "scaled" pill guard fixed (was dead code — `op.type === 'place'` never matches; types are `city|town|cdp`), detail-panel county-CHAS disclosure added, and a 100× display bug fixed (`needCompositePct` re-multiplied an already-percent composite).
- **#1047** — Market Data Build same-day-rerun push rejection fixed; verified green (run 28764501860); #1046 closed; artifacts PR #1061 merged.
- **Place-vs-county audit is DONE product-wide** (2026-07-06 two-agent sweep). HNA page panels all disclose correctly. Do not re-audit; do not re-flag the patterns listed as verified-good in the sweep notes.
- **AMI rent-gap tenure mixing is FULLY RESOLVED** (#1032 + #1037; La Plata ≤50% gap calibrates 0.95× vs Root Policy). The ≤30% tier reading ~2× Root is a documented concept difference, **not a bug** — do not "fix" it.

**Concurrent work — avoid conflicts**: the **Affordable Ownership Need module (Phase 1)** is being built per `docs/audits/CODEX-HANDOFF-AFFORDABLE-OWNERSHIP.md`. It inserts a new section after `housing-type-need-section` in `housing-needs-assessment.html` and adds `js/hna/hna-ownership-need.js`. Nothing in THIS handoff touches those insertion points; keep it that way.

---

## Hard rules (apply to every task below)

1. **Squash-merge PRs against `main`.** Run `npm run validate` plus each task's listed tests before opening the PR.
2. **Never `abs()` a gap.** Sign conventions are load-bearing and differ per file: `co_ami_gap_by_county` stores units−households (negative = shortfall); `co_ami_gap_by_place` stores households−units. Derive from raw fields, not precomputed `gap_*`.
3. **Do not touch** `robots.txt`, `sitemap*.xml`, `CNAME`, or `test/pages-availability-check.js` unless the task explicitly says so — and then update + `node`-run the pinned test in the same PR (it gates deploys).
4. **Census API**: keyless calls always fail by design. Summary caches (`data/hna/summaries/…`) are user-facing, not fallbacks. Never commit a build produced without `CENSUS_API_KEY`.
5. **Cache regeneration order**: summary caches BEFORE `place-chas`, or the ACS-anchor cap silently no-ops. After any CHAS change, rerun `scripts/hna/build_place_pages.py` — place pages do NOT auto-regenerate. After any ranking-index regen, rebuild ranking-scenarios or `ci-checks` fails (generatedAt pinning).
6. **`data/market/permits.json` stays minified.**
7. **Contacts / leads**: contact CSVs live in `~/coho-backend` (outside this repo, password-gated Worker). Never add contact names to this repo; never fabricate a contact name anywhere.
8. **Public-facing copy** (hero text, headlines): use owner's verbatim wording only. If a task needs new public copy, flag it in the PR description and use a placeholder — do not draft marketing language.
9. **local-resources links are durable jurisdiction searches by design** (F35). Do not "improve" them back into guessed deep links.
10. **If a PR fails CI on files you did not touch**, `main` likely broke after you branched (digests/briefs regenerate in-place during CI). Rebase and re-check before debugging your own diff.
11. **No paid-plan recommendations** (org is on Free; private-repo Pages is off the table).

---

## Priority 1 — Console Error Audit (issues #919, #840)

**Goal**: zero console errors on audited pages; both issues closed.

The two open Console Audit issues are from 2026-05-18 and 2026-06-01 (18–19 errors each) and predate several large merges — treat them as stale snapshots, not current truth.

- Rerun the audit locally (the `Console Error Audit` workflow's script — find it under `.github/workflows/` / `scripts/audit/`) or reproduce by loading each audited page and capturing console output.
- Fix real, still-reproducing errors. Typical classes: nulled DOM lookups after markup changes, fetches of moved JSON, chart init on absent canvases.
- For errors that no longer reproduce, document which merge resolved them.

**Scope**: `js/**`, page HTML as needed. Not `data/`, not workflows.
**Acceptance**: fresh audit output attached to the PR showing 0 errors (warnings triaged with one-line dispositions); #919 and #840 closed with that evidence; `npm run test:hna` + `npm run validate` green.

---

## Priority 2 — Weekly-issue backlog batch (one PR + issue closures)

Five url-health issues (#1004, #986, #963, #938, #916) and five local-resources issues (#1006, #988, #965, #939, #918) have accumulated. Handle as ONE batch with a disposition table.

**url-health protocol** (the checker over-reports — 415s and WAF blocks read as "broken"):
- For each reported URL, verify by actually fetching with a browser User-Agent before touching anything. CHFA URLs specifically need a browser UA; JCHS/KCFed/DOLA hard-block programmatic fetch entirely (a fetch failure there is NOT a dead link).
- Genuinely dead links (404 from a live host, NXDOMAIN): heal to durable jurisdiction searches using the established pattern in `scripts/audit/heal-local-resource-links.mjs`. Genuine dead-link healing was largely completed by #1015 — expect mostly false positives.
- Close each issue with a per-URL disposition table (false-positive / healed / already-fixed).

**local-resources protocol**: each issue lists "2 top adds + N CO-confirmed". Add the top-add resources to the local-resources data following the existing record shape; keep links as direct-plus-search per the design. Validate with the roster validator (`npm run validate:rosters` if wired, else the script it wraps).

**Scope**: local-resources data file(s) + the heal script's output. No scripts/ logic changes, no workflows.
**Acceptance**: all 10 issues closed with dispositions; `npm run validate` green; zero reverted search-links.

---

## Priority 3 — Fruita jurisdiction brief (#990)

Draft the Fruita city brief (GEOID 0828745) following the existing brief structure.

- Gate: `npm run test:briefs` (`scripts/validate-jurisdiction-briefs.py`) must pass.
- Source rules: do not cite sources you could not actually read. JCHS/KCFed/DOLA block fetching — if you can't read it, don't cite it. CHFA fetches need a browser UA.
- Benchmark context you may use: Fruita appears in the consultant-benchmark work (fast-growing SF-heavy market; workforce squeeze driven by home prices, renter share ~20%).

**Scope**: the new brief file + any index that lists briefs.
**Acceptance**: `test:briefs` green; #990 closed; no unreadable-source citations.

---

## Priority 4 — Place-pages freshness gate (process hardening, small)

`places/<geoid>.html` silently drift from `place-chas.json` (this bit once: Silt showed 5.3 vs 277 households for 3 weeks). A checker already exists: `npm run test:place-pages-fresh` (`scripts/check-place-pages-fresh.py`).

- Wire it into the `test:ci` chain in `package.json` **if it runs offline and fast** (< ~30s, no network). If it needs network or is slow, instead add it to an existing scheduled audit workflow — as a separate job that opens/updates a single issue on drift, following the repo's existing audit-workflow patterns.
- Do not change the checker's logic.

**Scope**: `package.json` (preferred) or one workflow file (fallback — say which and why in the PR).
**Acceptance**: drift check runs automatically; a deliberately-staled fixture (describe your test in the PR, don't commit it) fails the check; full `npm run test:ci` still green.

---

## Priority 5 — Dependency hygiene (#903, lodash-es via Lighthouse)

- `npm audit` — resolve the high lodash-es advisory in the Lighthouse dev-dependency tree (bump Lighthouse, or targeted `overrides` entry as a last resort).
- Dev-dependency only; production site is static and unaffected — say so in the PR to scope the risk honestly.

**Scope**: `package.json` + lockfile only.
**Acceptance**: advisory gone from `npm audit`; `npm run test:ci` green; #903 closed.

---

## Priority 6 — Stale orchestration issue (#915) — verify & close, no code

June 1 "Weekly Data Sync" failure. Verify current state: recent runs of the orchestration and member workflows green (the Market Data Build failure class was fixed by #1047). If everything is green over the trailing 2 weeks, close #915 citing run links. If a member workflow is still failing, STOP — file a fresh issue with the failing job's log excerpt and do not attempt a workflow fix in this task.

---

## Priority 7 — Ranking-index seasonal vacancy (NEEDS OWNER SIGN-OFF — do not implement without it)

Benchmark finding: 23/483 places show >15% rental vacancy in the ranking index (Breckenridge 50%, Vail 41%, Steamboat 27% — structural resort seasonality; Milliken 22.4% — one-year ACS noise). County projections exclude seasonal vacancy; the place ranking metric does not, so resort towns' need scores are distorted.

**Proposed approach (get explicit owner approval on which option before writing code):**
- Option A (disclosure-only, low risk): flag affected places in the ranking UI ("vacancy includes seasonal stock") without changing scores.
- Option B (metric change): cap or exclude seasonal vacancy in the metric — this changes rankings, requires the ranking-index → ranking-scenarios rebuild chain (hard rule 5), and needs benchmark re-validation (`npm run test:hna-benchmarks`).

Post the option question in the issue/PR first. Default to A if no answer.

---

## Investigation-only (findings doc, no code)

- **SDO projection outliers**: repo components-of-change 2030 populations match the official SDO vintage-2023 forecast within ±2% median, but Broomfield reads −11.7% and San Juan +15.4%. Produce `docs/audits/SDO-OUTLIERS-<date>.md` explaining each delta (data issue vs genuine forecast divergence). Do not adjust projections — they are validated overall; see benchmark notes.

## Blocked / deferred — do NOT work on these

- **CHAS vintage refresh**: HUD WAF blocks unauthenticated download; needs the owner to fetch manually in a browser. After the file lands, the regen chain is: summary caches → place-chas → place pages → digests (hard rule 5). Owner-assisted; parked.
- **LODES 2024 OD refresh**: picks up automatically via `.github/workflows/rebuild-place-od-flows.yml` cron. No action.
- **Contact-CSV purge from public git history**: owner decision — deferred to production. Do not touch git history.
- **Senior / replacement "keep-up" methodology components** (Pueblo consultant-comparison gap): methodology enhancement pending owner prioritization.
- **Repo relocation off iCloud** (`" 2"` duplicate cruft): owner-machine task.

---

## QA checklist Claude Code will apply to each PR

1. Diff stays inside the task's stated scope; no drive-by edits.
2. Listed tests + `npm run validate` green in CI.
3. Sign conventions untouched (rule 2); no calculation changes in labeling tasks.
4. Issues closed with evidence (dispositions, run links, audit output) — not bare "fixed".
5. No conflicts with the Affordable Ownership Need module's insertion points.
