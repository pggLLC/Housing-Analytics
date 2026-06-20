# Codex Handoff — next phases (2026-06-19)

_Forward-looking work plan. Internal doc (excluded from the public artifact via the `docs/qa` block)._

**Companion docs:** the most recent QA/QC — covering everything shipped 2026-06-19 → 06-20 (brief expansion, the
11-brief repair, the CI gate, the redirect fix, and the pre-existing issues this window fixed) — is in
[`codex-qa-handoff-2026-06-20.md`](codex-qa-handoff-2026-06-20.md); **read that first.** The prior QA/QC is in
[`codex-qa-handoff-2026-06-18.md`](codex-qa-handoff-2026-06-18.md). The earlier forward plan
[`codex-handoff-2026-06-18.md`](codex-handoff-2026-06-18.md) is mostly done (search ✅); its sitemap + JSON-LD items
are folded into Phase 2 below.

**State going in (verified 2026-06-19):** `main`, working tree clean, 0 open PRs. Data layers cleaned (signal log
rebuilt to 2 verified, 12 briefs audited, contacts honest). Three new guardrails live: `test:hna-acs-coverage`,
the trustworthy source-liveness check, and the `place-pages-fresh` workflow.

---

## Update — 2026-06-20 session (done since the plan below)

**Jurisdiction briefs — expanded + repaired; all 12 pass `npm run test:briefs`.**

- **Silt (0870195)** gained three source-first sections that define content TYPES to roll out to other briefs:
  1. `regional-modular-pipeline` — a regional development pipeline (Habitat RFV's modular-home factory in Rifle: ramping to ~200 net-zero homes/yr; CMC + Colorado River BOCES training; SB25-002).
  2. `silt-recent-planning` — recent local planning/subdivisions (Heron's Nest, Riverview) + the Prop 123 opt-in.
  3. `official-affordability-discussion` — **what elected/appointed officials have said about affordability TARGETS in development review.** For Silt: officials *name* affordability (Feb 9 2026 Board of Trustees, Heron's Nest) but set **no** target, and Riverview's ~198 units carry no condition. The load-bearing quote was read **first-hand from the scanned BOT-minutes PDF** (via the PDF reader), not OCR-by-agent.
  → **OWNER DIRECTIVE: apply these three content types to every jurisdiction brief where the records support them** — the regional pipeline near the place, recent local planning actions, and especially **any official discussion of an affordability target in a specific development** (quote the minutes/packets; if officials set no target, say so — the *absence* is the finding). Verify source-first; never fabricate.

- **The 11 briefs left invalid by the 2026-06-16 bulk edit (`8f5d5755`, `ce87f63e`) are fixed.** CHFA 2026 Round One award paragraphs were verified against the official CHFA list (14 developments; none in Aspen/Carbondale/Fort Collins/Glenwood Springs/Rifle/Salida/Pitkin) and given `_verified` rows; the one verifiable macro source (Enterprise "Curbing the Insurance Spiral") was wired into a `regional-macro-context` section; the **3 macro sources that hard-block automated fetch and have no archive (Harvard JCHS ×2, KC Fed) were removed** rather than ship unread quotes; the Towaoc cross-jurisdiction slip was prefixed `regional-`.

**The validator gap that let that land is closed.** `scripts/validate-jurisdiction-briefs.py` now runs in `test:ci` via **`npm run test:briefs`** — it was previously cron-only (`jurisdiction-briefs-monthly.yml` / `source-liveness-weekly.yml`), which is why 11 invalid briefs sat on `main` for ~3 days unnoticed. Invalid briefs now fail per-PR.

**Backend redirect loop fixed (ERR_TOO_MANY_REDIRECTS).** `~/coho-backend/wrangler.toml` now sets `html_handling = "none"`. The default (`auto-trailing-slash`) 307-redirected `/developer.html` ↔ `/developer` against the worker's extensionless handler, looping any *authenticated* user out of the backend. Deployed.

**Source-fetchability note for brief curation:** CHFA (chfainfo.com) needs a **browser-UA curl** (WebFetch 403s it); **Harvard JCHS, KC Fed, and Colorado DOLA hard-block automated fetch with no Wayback snapshot** — don't cite what you can't read. Scanned PDFs (e.g. Silt BOT minutes) have no text layer — download + read pages with the PDF reader.

Phase-4 Silt items now **DONE** (2026-06-20): the 2 GCHA rows were re-confirmed verbatim against the Post Independent
article and upgraded `partial`→`supported`; `curator` → `PG`. Also closed this window: `test:ci` was red on `main`
since 06-17 (phantom `--accent-weak` token from #980) — now defined; and 34 gitignored macOS/iCloud `" 2"` duplicate
files were cleaned from the working tree. Full detail: [`codex-qa-handoff-2026-06-20.md`](codex-qa-handoff-2026-06-20.md).

---

Do these in priority order.

---

## Phase 1 — 🔒 Contact-PII exposure (highest stakes; mostly an OWNER decision)

**Problem.** `pggLLC/Housing-Analytics` is a **public** repo, and the private CRM data is git-tracked in it:
`docs/developer-pipeline-prototype/04-network.csv` (**80 contacts — name, email, phone**), plus `02-pipeline.csv`,
`01-signal-log.csv`, `03-anti-targets.csv`. These are stripped from the *deployed site* (`BLOCKED_PATHS` in
`scripts/build-public-site.mjs`) and gated on the *backend*, but the **source is readable on github.com** — and has
been for the life of those commits, so treat the 80 contacts as already exposed.

**This is a decision + a careful operation, not a routine Codex task.** Two real paths — **owner picks**:
- **(a) Make the repo private.** Cleanest, but GitHub Pages from a private repo needs a paid plan. Custom domain
  (cohoanalytics.com) keeps working.
- **(b) Purge from history** (`git filter-repo` / BFG) + remove going forward. Destructive history rewrite, force-push,
  invalidates clones. Owner-executed.

**Codex can do the mechanical prep (coordinate before pushing):**
1. Move `docs/developer-pipeline-prototype/` into the **private backend repo** (`~/coho-backend`).
2. **Rewire `~/coho-backend/build-bundle.sh` line 23** — it currently copies the CSVs from `$REPO/docs/developer-pipeline-prototype/*.csv`; point it at the new in-backend location instead (the bundle still needs them).
3. `git rm` the CSVs from the public repo so HEAD + future commits are clean.
4. ⚠️ `git rm` does **not** remove them from history — the purge in (b) (or going private in (a)) is the actual fix and is owner-run.

Do not flip repo visibility or rewrite history autonomously.

## Phase 2 — 🔍 SEO / discoverability (biggest user-facing lever)

`sitemap.xml` is still a hand-maintained **21-URL** file (`grep -c '<loc>'` → 21) that omits all **464 place profiles**;
`index.html` has **0** JSON-LD blocks. This is what "nothing finds this site" was about.

1. **Auto-generate `dist/sitemap.xml`** in `scripts/build-public-site.mjs` from the built HTML: include the 464
   `places/<geoid>.html` + `places/index.html` + main tool pages; **exclude `places/_template.html`, redirect stubs,
   `404.html`**; real `lastmod`; `https://cohoanalytics.com/` URLs. (Detailed spec in the prior handoff's Phase 2.)
2. **JSON-LD:** `Organization` + `WebSite` in `index.html` (brand "COHO Analytics", logo `assets/og-image.png`);
   `Place`/`Dataset` on place profiles.
3. ⚠️ **Deploy-gate trap (this broke every deploy once, #975→#977):** `test/pages-availability-check.js` runs *inside*
   `deploy.yml` and asserts the sitemap. De-pin/update any assertion, then run **all three** before merge:
   `node test/pages-availability-check.js && npm run build:public && npm run audit:public-artifact`.
4. Owner action: submit `https://cohoanalytics.com/sitemap.xml` in Google Search Console + Bing.

## Phase 3 — ⚙️ Reliability / performance (harden today's fixes)

1. **Precompute the HNA demographic vars into the summary cache.** The household-composition / occupation / race /
   education panels currently work only because the **live** extended ACS fetch fires per page-load (today's fix). The
   summary caches (`data/hna/summary/<geoid>.json`, `acsProfile` ≈ 65 keys) don't contain the extended DP02/DP03/DP05
   vars. Add them to the ETL so the panels render from cache with no live fetch (faster, can't silently fail). Model:
   `scripts/backfill_dp04_value_brackets.mjs` already backfills extended vars (F160) — extend that pattern with the
   `fetchAcsExtended` var list from `js/hna/hna-controller.js`. `test:hna-acs-coverage` already guards the wiring.
2. **Make the place generator deterministic.** `scripts/hna/build_place_pages.py` stamps a wall-clock
   `Generated: <ts>` line on every page, so a no-op regen diffs all 482 files and `check-place-pages-fresh.py` has to
   ignore it via `git diff -I`. Drop the timestamp (or derive it from the data vintage). Then regen + commit once;
   afterward the staleness check is a plain `git status` and regen commits show only real data changes.

## Phase 4 — 🧹 Cleanup / smaller items

- **Signal layer (owner decision):** keep the 2 verified signals (`01-signal-log.csv`) or retire the whole
  signal/pipeline lead-tracking surface. Owner said they don't actively work leads → retiring is defensible.
- **Silt brief:** the two GCHA numeric rows in `data/jurisdiction-briefs/_verified/0870195.json` are marked `partial`
  (figures via fetch extraction) — verbatim-confirm against the cited Post Independent article, then upgrade to
  `supported`. Rename `curator` off `"Claude (AI draft)"`.
- **nodemailer v9:** dev-only bump (#969) — smoke-test the `test/` email/audit scripts (`daily-audit-system.js`,
  `send-test-email.js`, `audit-modules/report-generator.js`) against the v9 API.
- **Deferred data:** CHAS + LODES vintage refreshes — HUD WAF blocks the unauthenticated CHAS download; LODES 2024 OD
  picks up via the `rebuild-place-od-flows.yml` cron.

## Owner actions (not Codex)

- Phase 1: pick make-private vs purge-history; execute the visibility change / history rewrite.
- Phase 2.4: Search Console + Bing submission + Request Indexing.
- Phase 4: signal-layer keep/retire decision; confirm the Silt GCHA figures.

## Verification (run before any merge that touches the public build)

```bash
node test/pages-availability-check.js      # deploy gate
npm run build:public                       # dist/ + search-index + sitemap
npm run audit:public-artifact              # public-artifact guard (no private data leaks)
npm run test:hna-acs-coverage              # HNA renderer/fetch coverage
python3 scripts/check-place-pages-fresh.py # place pages match the data
```
