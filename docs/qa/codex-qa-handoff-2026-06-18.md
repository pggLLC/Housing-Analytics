# Codex QA/QC Handoff — everything since the 2026-06-17 checkpoint

> ⚠️ **Superseded** — the single current handoff is **[CODEX-HANDOFF.md](CODEX-HANDOFF.md)**. This file is retained as historical detail.

_Regenerated 2026-06-18 · internal QA doc (excluded from the public artifact via the `docs/qa` block)._

## Scope / boundary

**The last two handoff checkpoints:** the brief-audit handoff (~2026-06-12, `fdc03083`/`ee4305f6`) and the "next phases" handoff [`codex-handoff-2026-06-18.md`](codex-handoff-2026-06-18.md) (commit `e2e0affd`, 2026-06-17). **Neither was an actual Codex *review*** — the first queued a brief audit, the second was forward-looking and merely *asserted* its baseline was "verified through #977." So nothing from `#956` (2026-06-10) onward has been independently QA'd.

**This handoff therefore spans both: `d985cf4a` (#956, 2026-06-10) → HEAD.** Work since the 2026-06-17 checkpoint is detailed in the table + ⭐ section; the earlier **prior-cycle** work (06-10 → 06-17) is summarized in its own section below so nothing falls between handoffs. Everything else in the range is automated data refreshes (FRED, Polymarket, manifest mtimes, quarantine bots) that don't need review. The newest commits are the handoff docs themselves — this QA doc plus the forward plan in [`codex-handoff-2026-06-19-next-phases.md`](codex-handoff-2026-06-19-next-phases.md). **Every substantive commit through HEAD is accounted for in the table, the ⭐ section, or the prior-cycle section — nothing after the last handoff is omitted** (verified commit-by-commit).

Repo state at handoff: `main`, **working tree clean, 0 open PRs.**

## ⭐ Latest — data-integrity audit + HNA panel fix (2026-06-18)

The most consequential recent work, after the numbered table below:

**Signal log — audited, mostly fabricated, rebuilt (`8ee6803b`, `6ccf31c4`).** Source-first web verification of all 12 lead "signals" (`docs/developer-pipeline-prototype/01-signal-log.csv`) found only **2 accurate as written**; **7 were fabricated/unconfirmable** (one cited a Sky-Hi News URL that 404s — an invented source; another a council meeting on a date with no meeting) and **3 were real events pinned to the wrong fact**. Rebuilt the file to the **2 verified signals** (Carbondale Prop 123 fast-track, Pueblo at-risk), repointed at specific DOLA/Colorado Sun sources, contacts flagged unverified. The file is hand-maintained (nothing regenerates it). **Codex: spot-check the 2 survivors.**

**Briefs — audited, clean (`afd1e3fd`, `385519c4`).** Parallel claim-level verification of all 12 briefs (~55 specific claims — named projects, unit counts, $ amounts, vote splits, ordinance numbers) came back **verbatim-accurate** except two: Glenwood's Canyon Vista date (Dec 2024 → **2025**) and a Garfield-draft invented "21 of 64 counties" stat (**removed**). Link-rot check: **89% of cited URLs live**; the flagged ones are almost all DocumentCenter PDFs that 403 bot-checkers (verified live by downloading them). One genuine 404 (Garfield draft Habitat "L3") repointed to `/the-carter`. **The curated briefs are real, source-backed research — the opposite of the signal log.**

**Contacts — audited, clean.** `04-network.csv` (80 contacts): no fabricated names; unknowns explicitly marked `(unverified — confirm via directory)`.

**HNA demographic panels — fixed (`e4765d01`).** Household-composition/occupation/labor, Race & ethnicity, and Educational-attainment panels (F169/F170) rendered **empty for every cached place** — they read detailed `DP02`/`DP03`/`DP05` vars that live only in the extended ACS fetch, but `missingExtended` only checked `DP03_0052E`/`DP04_0111PE`/`DP04_0083E` (all present in caches), so the extended fetch never fired. Added `DP02_0002E`+`DP05_0037E` to the trigger. Verified: the trigger now fires for cache-shaped profiles and all three panels render when handed the vars. **Note:** the live `api.census.gov` call couldn't be exercised in-sandbox (no outbound network), so confirm on the live site that the panels populate. Follow-up worth considering: precompute these vars into the summary-cache ETL so they don't need a per-load live fetch.

**Guardrails added — so these classes stop happening or get reported.** Three new CI checks (`9317d1a8`, `103a0237`, `5bfc0389`): (1) **`test:hna-acs-coverage`** (wired into `test:ci`) fails if a renderer reads an ACS variable the controller never fetches, or if the extended-fetch trigger can't fire for cached places — the exact empty-panel bug; it immediately found and fixed a *second* gap (the `>$200k` income bracket `DP03_0061E` was never fetched). (2) **source-liveness** (`scripts/check-source-liveness.py`) now uses GET + a browser UA and a distinct `blocked` status, so its weekly cron reliably *reports* genuinely-dead links instead of crying wolf on 403s (15 false → **0** real dead links). (3) **`place-pages-fresh`** (path-filtered workflow + `scripts/check-place-pages-fresh.py`) fails if `place-chas.json` changes but the pages aren't regenerated — the Silt 5.3-vs-277 drift, caught at the source. **Codex: these are new; confirm wiring (`package.json` `test:ci` + `.github/workflows/place-pages-fresh.yml`) and that the guards are sound.** Note: the place generator stamps a wall-clock `Generated:` line, so the staleness check ignores it via `git diff -I` + `--quiet` — making the generator deterministic would be a cleaner long-term fix.

| # | Commit / PR | Area | What |
|---|---|---|---|
| 1 | `fab05e6b` #979 | CI | de-pin deploy-gate sitemap assertion |
| 2 | `bf9e2202` #980 | Site | site-wide search → `search.html` |
| 3 | `7bdee708` #981 | Place | "What do these AMI tiers mean?" explainer |
| 4 | `995a533d` #982 | Private | pipeline dashboard clarity + cross-device priorities + civic-panel fix |
| 5 | `bafdaa89` #983 | Site | house favicon (replaces stale Wix icon) |
| 6 | `42961189` | Private | cross-device pipeline drafts via backend KV sync |
| 7 | `88685789` | Data | regenerate place pages from corrected CHAS apportionment (464 + 18 new) |
| 8 | `cf52b9df` #984 | Data | curated housing-history brief for Town of Silt |
| 9 | `39348120` | Private | merge PipelineStore drafts into the brief pipeline panel |
| 10 | `c6cb36c5` | a11y | `--on-accent` for the priorities Save button (dark-mode contrast) |
| 11 | `0f90ebd7` #974 | CI | harden `audit-and-docs` against non-fast-forward push races |
| 12 | `3dfedd6c`/`6713ea02`/`a5a7c892` #966/#968/#969 | Deps | dependabot bumps (CI action, dev-deps group, nodemailer 8→9) |
| 13 | `328125ed` #976 | Docs | domain runbook rewrite (Wix→Pages) |

Highest blast radius: **#7** (483 public-facing pages), **#6/#9** (cross-device data integrity), **#8** (new published brief).

---

## Site features

**1. #979 — de-pin deploy-gate sitemap assertion.** `test/pages-availability-check.js` now derives the expected sitemap host from `CNAME` instead of a literal URL (#975 had silently broken every deploy ~1h). **QA:** confirm it still *fails* if the sitemap line goes missing/off-domain.

**2. #980 — site-wide search.** `search.html` + `js/site-search.js`, driven by `search-index.json` (built in `scripts/build-public-site.mjs`). Place profiles down-weighted on non-title hits. **QA:** name normalization ("Silt"/"Silt, Colorado"/"Silt town" → `places/0870195.html`); index references only pages that exist.

**3. #981 — AMI explainer.** Injector `js/place-profile-help.js` + same markup baked into `places/_template.html`. **QA (interacts with #7):** confirm **no double render** on a regenerated page — the injector must no-op when the template already includes it.

**5. #983 — favicon.** `favicon.svg` in `PUBLIC_ROOT_FILES` + injected by `navigation.js`. **QA:** lands in `dist/`, no double-inject.

## Private developer surface (gated Cloudflare Worker — see cross-repo note)

**4. #982 — pipeline dashboard + civic fix.** `developer.html`: user-controlled "Top Priorities" (`/api/priorities` + localStorage), per-counter tooltips, stage legend. `developer-brief.html`: rewrote `civicSection()` from a mis-rendered v2 percentile ("3/100") to the real v1 count-of-7 ("3 of 7", Yes/No/Not-assessed). **QA:** civic panel vs `data/policy/housing-policy-scorecard.json` for a mixed/null-dimension place.

**6. Cross-device pipeline sync (`42961189`).** `js/components/pipeline-store.js` gained `syncUrl:'/api/pipeline'`: pull once on init (`PipelineStore.ready`); **first contact MERGES** local into server (no pre-sync draft lost); **steady-state adopts** server (so deletes/clears propagate); push after every mutation. **QA (skeptic's lens — riskiest):** offline-push-then-reload data-loss edge (mitigated by the page being Worker-gated, so it can't load offline — confirm that assumption); two-device divergent-draft first sync; delete propagation; public site unaffected (`pipeline-store.js` is in `BLOCKED_PATHS`).

**9. Brief pipeline-panel draft merge (`39348120`).** `developer-brief.html`'s Stage/IOI/Confidence/Classification/Product panel built `pipelineByGeoid` from canonical `02-pipeline.csv` only — a draft-added jurisdiction showed "—". Now awaits `PipelineStore.ready` and overlays edits + drafts. **QA:** canonical rows still render (verified: Salida shows Stage=Screen/IOI=73/Class=B); a draft jurisdiction now shows its fields.

**10. a11y contrast (`c6cb36c5`).** `developer.html` priorities Save button hardcoded `color:#fff` on `var(--accent)` → 1.7:1 in dark mode; swapped to the paired `--on-accent` token. This was the sole violation making **`ci-checks` red on `main` since ~03:49** — now green.

## Data

**7. Place-page regen (`88685789`).** Ran `scripts/hna/build_place_pages.py`: 464 updated + 18 new (483 files). Pages had drifted from `place-chas.json` since the May 29 apportionment fix (`75857316`) — Silt was serving 5.3 vs corrected 277 renter hh. Closes the prior handoff's "18 places would 404" risk. Apportionment per locked-in product decision (2026-04-20 #1). **QA:** spot-check 3–4 geoids vs ACS; note the visible "CHAS source" label renders `TIGER 2024 place-CHAS` even for `population-apportionment` (decide if it should distinguish method). `dist/` gitignored. Verified pre-commit: availability 114/0, build clean, audit 1863 files.

**8. Silt brief (`cf52b9df` #984).** First curated jurisdiction brief: `data/jurisdiction-briefs/0870195.json` (5 sections, 5 direct-fetch sources, no `search` sources) + the mandatory `_verified/0870195.json`. **⚠️ Caveats before final sign-off:** `curator` flagged `Claude (AI draft)` — rename to `PG`; two GCHA numeric rows marked **`partial`** (figures via fetch extraction) — re-confirm verbatim against the [Post Independent article](https://www.postindependent.com/news/garfield-county-housing-authority-presents-2024-report-to-county-commissioners/); `published:true` (gated surface only).

## PR hygiene (merged this cycle)

- **#974** — `audit-and-docs` push now retries with `pull --rebase` (kills the non-fast-forward races). Already proven on the post-merge automation.
- **#966 / #968 / #969** — dependabot: CI action 6→8, dev-deps group, **nodemailer 8→9**. nodemailer is a **devDependency** (test/audit scripts only, not production); CI doesn't exercise those scripts, so **smoke-test `daily-audit-system.js` / `send-test-email.js` against the v9 API** when next run.
- **#976** — domain runbook rewritten for the Wix→Pages reality (docs only).

## Cross-repo backend note (`~/coho-backend` — separate PRIVATE repo, NOT in Codex's review scope)

The private developer surface is served by a password-gated Cloudflare Worker (`coho-backend.communityplanner.workers.dev`), not the public site. This cycle: `/api/priorities` + `/api/pipeline` endpoints backed by one KV namespace (binding `STATE`); authed `/` and login now 302 → `/developer.html`; `build-bundle.sh` now bundles `jurisdiction-brief.js` + the curated briefs (they were being stripped, so `developer-brief.html` rendered no briefs on the backend). The cross-device client contract for #6/#9 lives here.

## Prior cycle — between the two handoffs (2026-06-10 → 06-17): large, full surface inventory

**~50 substantive commits across many surfaces.** The `e2e0affd` handoff only *asserted* its baseline, and much of the **brief** work below was itself the content of the ~06-12 brief-audit handoff (already handed to Codex once). Complete inventory by surface, with what to re-check:

- **Deploy / SEO boundary (`#973`, `#975`, `#977`, `580e6a87`, `7f7f5b94`, `ce4a4a82`):** public deployment-artifact boundary; canonical surface → cohoanalytics.com; the sitemap-assertion change that caused then cured the ~1h deploy outage; a Pages-deploy-coverage guard for automation commits; robots.txt cleanup; public pipeline-surface rename. **QA:** `npm run audit:public-artifact` still strips all private paths; deploy gate green.
- **CI / deps:** upload-artifact v4→v7 (`a6914fcb`/`18c3bb17`); URL-sweep allow-lists (`5011cede`); link-audit stabilization (`f38e0c9b`/`b19b59c6`); manifest sync + semantic-token fix + checkout/setup-python dependabot (`#972`/`#962`/`#967`/`#970`).
- **Briefs — full source-first overhaul (largest surface):** audit → quarantine → per-city strip → rewrite → re-publish. Source-provenance verdicts (`6a269c22`); all 11 unpublished (`a40a6ccb`); per-jurisdiction **strips** dropping unsupported claims — Aspen `87c8d084`, Denver `b57bdef9`, Fort Collins `1bd5c286`, Glenwood `c4dd2a1b`, Salida `8446ddcc`, Colorado Springs `7314e5ab`, Cortez `d66a7323`, Pitkin `bd674ef4`, Garfield `e14632cf`, Rifle `cf61f4e6`; Carbondale rewritten source-first (`016d1ed2`/`0eb70031`/`e4af2209`/`b12ba2e6`); publish gates + reconciliation + mobile overflow + inaccuracy affordance + weekly source-liveness auto-PR (`f6e3fe67`/`fea1390c`/`0060c319`/`4b15563b`); Codex audit packages + handoff prompts + stabilization summary + decisions log (`06294d36`/`3128e57f`/`cfafc999`/`aaa31734`/`ab0aa6a3`/`0e8a754d`/`89067cff`); cite/kind-badge dark-mode contrast (`10556986`/`a4789ba0`); briefs surfaced on indibuild/HNA/PMA (`0a550cbf`/`cb5566c4`); CHFA 2026 R1 awards + 4 macro sources per brief (`ce87f63e`/`8f5d5755`); methodology audit + validator + Codex prompt (`fdc03083`/`ee4305f6`/`8fe3e095`). **Today's full claim-level re-audit (⭐) covered all 12 — clean — so this is largely re-verified, but the strip cycle rewrote a lot of copy.**
- **HNA:** housing-authority panel reads URL before stale cache (`fa5195e4`); jurisdiction-scope cleanup on Carbondale-class pages (`8afb90c3`); exec-snapshot dev-context copy (`77bacee6`); retire fatalistic/deficit framing (`3fba56ff`); F165 DP04 home-value brackets (`DP04_0080-0088E`) into **546 summary files** + cache rebuild (`529e737d`/`6f1fcdf4`) — relevant to next-phases Phase 3 (cache precompute).
- **LIHTC / Opportunity Finder:** CHFA award history surfaced on PMA + HNA (`21901f4b`); county-level LIHTC recency as regional context (`bb395188`); PHA roster 33-county gap fill (`4a39e271`).
- **Deep-dive page:** plain-English + linked-source June 2026 Read callout (`b8b06cd3`); one source caption per chart (`db036da7`); real data + theme-aware colors for AMI/concessions/foreclosure charts (`5a7f54d0`).
- **PMA — Property Market Analysis (largest code surface):** Subject-Project cards on CHFA-published limits + per-tier rent/income/capture (`a53fbb49`/`2c5c46e5`/`5996d9ec`/`383d362c`); lat,lon pin in address search (`c92fdd01`); Tract-picker CHFA Appendix A compliance (`9c5486ee`); Dimension-Scores bar width (`8c7ac20b`); vacancy card (B25004), unified hull outline, tract-picker persistence, default-to-cached sources, tooltip fix, Pagosa/NOI/FEMA-flood batch, 90/110/120% AMI tiers, policy-briefs cross-state-leakage (`b1853a7b`/`b60ae643`/`ef6387b8`/`c50a206a`/`48b864fd`/`483afde0`/`9275b821`/`f8e32910`/`8a93b691`). **`market-analysis.html` + `js/pma-*` — biggest un-reviewed surface; do a focused pass.**
- **Glossary (`bed04e50`):** repo-wide inline-glossary auto-decoration across **42 HTML pages** — broad blast radius. Spot-check it didn't mangle markup or double-decorate terms (today's repeat-scan found none but covered only the HNA page).
- **Contrast (`5fd487ac`):** dark-mode contrast regressions fixed in HNA overlays + LIHTC recency badges.
- **Signal log (`e5d5dbe5`, `f3f0dcc7`):** fabricated-contact stripping + "make actionable" — the same rot today's full rebuild (12 → 2 verified) finished addressing.

## Still open from the prior handoff (unfinished, NOT regressions)

- **Phase 2 — auto-sitemap:** `sitemap.xml` is still the hand-maintained **21-URL** file; the 464 place profiles (+ 18 new) are absent. Biggest remaining SEO lever. (Mind the deploy-gate trap.)
- **Phase 3 — JSON-LD:** still **0** `application/ld+json`; no `Place`/`Dataset` structured data.

## Known issues worth a look

- **`validate-jurisdiction-briefs.py` exits 1** — pre-existing **orphan-source** warnings + verification-coverage gaps in *other* published briefs (Aspen/Salida/etc.). The **Silt brief (`0870195`) is clean**; the red is not from this cycle, but worth a cleanup pass.
- **Silt has no pipeline data** — not in canonical `02-pipeline.csv`, and the synced KV draft store is empty; its brief pipeline panel correctly shows "—". Not a bug; the data was never committed.

## Verification commands

```bash
node test/pages-availability-check.js          # deploy gate — expect 114/0
npm run build:public                           # dist/ + search-index + sitemap copy
npm run audit:public-artifact                  # public-artifact guard (1863 files)
npm run test:developer-geoids                  # developer geoid integrity
node scripts/audit/inline-contrast-check.mjs   # accent-contrast (now passing)
python3 scripts/validate-jurisdiction-briefs.py  # NOTE: exits 1 on pre-existing orphan-source warnings; Silt 0870195 is clean
```

## Suggested verdict format

Per item: **PASS / PASS-WITH-NITS / FAIL** with `file:line` citations. Prioritize #6/#9 (cross-device data integrity), #7 (483 public pages), and #8 (new published brief + its partial rows).
