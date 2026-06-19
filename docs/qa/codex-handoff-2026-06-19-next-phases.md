# Codex Handoff — next phases (2026-06-19)

_Forward-looking work plan. Internal doc (excluded from the public artifact via the `docs/qa` block)._

**Companion docs:** the QA/QC of everything *already shipped* is in
[`codex-qa-handoff-2026-06-18.md`](codex-qa-handoff-2026-06-18.md) — review that first; whatever it flags is fixed
before starting here. The earlier forward plan [`codex-handoff-2026-06-18.md`](codex-handoff-2026-06-18.md) is mostly
done (search ✅); its sitemap + JSON-LD items are folded into Phase 2 below.

**State going in (verified 2026-06-19):** `main`, working tree clean, 0 open PRs. Data layers cleaned (signal log
rebuilt to 2 verified, 12 briefs audited, contacts honest). Three new guardrails live: `test:hna-acs-coverage`,
the trustworthy source-liveness check, and the `place-pages-fresh` workflow.

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
