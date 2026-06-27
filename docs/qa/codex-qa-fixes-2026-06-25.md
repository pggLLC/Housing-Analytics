# Codex Handoff — QA/QC fix list (2026-06-25)

_Internal doc (excluded from the public artifact via the `docs/qa` block). From an independent QA/QC review of
`main` — Housing-Analytics @ `faef8f19`, coho-backend @ `607b56c`. **Free-tier testing site:** do NOT add paid infra,
production monitoring/scaling, destructive git-history rewrites, repo-visibility flips, or deploys beyond the existing
automated `deploy.yml` dispatches. Verdict: **FAIL** on one live blocker (C1); everything else is PASS-with-nits._

**Do these in order. C1 is live on `main` right now — fix it first.**

---

## ✅ C1 (RESOLVED 2026-06-25) — the refresh was CORRECT; spec was stale; guard added (NOT a revert)

> **Resolution.** Tracing the source reversed the original call: the committed/spec value (Silt gap **153**, score 60.5,
> rank 205) was **stale**. The gap source `data/co_ami_gap_by_place.json` has said **157** since 2026-05-09 (`#783`), and a
> fresh `build_ranking_index.py` deterministically produces **157 / 213 / 60.0**, matching the source. So commit
> `faef8f19` **corrected** a stale index rather than regressing it — reverting to 153 would ship a wrong number.
> **Action taken:** added the H1 guard (below) to lock the now-correct values; **no revert.** ➜ **The documented Silt
> spec should update to 60.0 / 213 / 157.** Original (pre-trace) analysis kept below for the record.

---

**Problem.** Commit `faef8f19` ("fix(hna): cap place CHAS household counts…") regenerated `data/hna/ranking-index.json`
as a side effect, shifting **495 of 547 ranks** and moving Silt (`0870195`) from the documented spec
**60.5 / rank 205 / gap 153** to **60.0 / 213 / 157**. The place-chas anchor in that commit only changes household-count
*levels* and **preserves cost-burden rates** — which is all `build_ranking_index.py` reads from place-chas — and Silt
wasn't even anchored (`acs_anchor.applied=false`). So the rank shift is **not** from the anchor; it's
`build_ranking_index.py` re-reading other inputs (`co_ami_gap_by_place.json` / ACS caches) the committed index had
silently drifted from.

**Verify:**
```bash
for ref in faef8f19~1 HEAD; do
  git show $ref:data/hna/ranking-index.json | python3 -c "import json,sys;[print('$ref', e['metrics']['overall_need_score'], e['rank'], e['metrics']['ami_gap_30pct']) for e in json.load(sys.stdin)['rankings'] if e['geoid']=='0870195']"
done
# faef8f19~1  60.5 205 153   (== the documented spec)
# HEAD        60.0 213 157
```

**Fix (narrow — KEEP the place-chas anchor, it is correct):**
1. `git checkout faef8f19~1 -- data/hna/ranking-index.json`
2. `python3 scripts/hna/build_place_pages.py` — pages rebuild from the restored index **plus** the anchored
   `place-chas.json`, so they get spec ranks **and** the corrected household counts.
   - ⚠️ `scripts/check-place-pages-fresh.py` **reverts** the pages it regenerates (leave-no-mess). If you run it, run
     `build_place_pages.py` again before committing.
3. Confirm Silt = `60.5 / 205 / 153`; commit (`data/hna/ranking-index.json` + `places/`). Do **not** revert
   `data/hna/place-chas.json`, `scripts/hna/build_place_chas.py`, or `data/hna/place-chas-coverage-stats.json` — the
   anchor (Fruita 5,949→5,279; 0 overcounts) is the intended fix.

**Decision (see Open Questions):** revert-to-spec (above) **vs.** a deliberate refresh. If the current inputs are the
correct vintage, refresh `ranking-index.json` as its **own reviewed commit** with the 495 deltas inspected, and update
the documented Silt spec to 60.0/213/157.

**Done when:** Silt matches the canonical values on `main`; place pages are consistent with `ranking-index.json`; the
place-chas anchor is retained.

---

## ✅ H1 (DONE 2026-06-25) — staleness guard for `ranking-index.json`

> **Done.** Added `scripts/check-ranking-index-fresh.py` + `npm run test:ranking-fresh`, wired into `test:ci` (after
> `test:hna-ranking-index`). Regenerates the index from committed inputs and fails on drift (ignoring only `generatedAt`).
> Verified: passes on the current index; flags the stale-153 case. This is the guard that was missing when C1 slipped.

---

**Problem.** Nothing in CI catches `ranking-index.json` drifting from its inputs — that's *why* C1 went unnoticed.
`places/` has `scripts/check-place-pages-fresh.py`; the ranking index has no equivalent.

**Fix.** Add `scripts/check-ranking-index-fresh.py` mirroring the place-pages guard: regenerate into the working tree,
`git diff` ignoring volatile fields (metadata `generated_at`), fail on real drift, restore the tree. Wire into `test:ci`
(or a paths-filtered `ranking-index-fresh.yml` over the HNA inputs + `build_ranking_index.py`).

**Done when:** editing an HNA input without re-running `build_ranking_index.py` fails CI.

---

## 🟡 M2 — SEO: sitemap omits all 482 place pages; 0 JSON-LD  *(old Phase 2)*

`grep -c '<loc>' sitemap.xml` = **21**; place profiles on disk = **482**; `grep -c 'application/ld+json' index.html` = **0**.
Auto-generate `dist/sitemap.xml` in `scripts/build-public-site.mjs` from built HTML (482 `places/*.html` + tool pages;
exclude `_template.html`, redirect stubs, `404.html`; real `lastmod`; `https://cohoanalytics.com/` URLs). Add
`Organization` + `WebSite` JSON-LD to `index.html` and `Place` to place profiles.
⚠️ **Deploy-gate:** `test/pages-availability-check.js` runs inside `deploy.yml` and asserts the sitemap — de-pin it, then
run `node test/pages-availability-check.js && npm run build:public && npm run audit:public-artifact` before merge.
**Done when:** sitemap ≥ 483 `<loc>`s; JSON-LD validates; deploy gate green.

## 🟡 M3 — Label the two cost-burden numbers

The HNA score uses ACS `pct_cost_burdened` (`scripts/hna/build_ranking_index.py:385`; Silt **51.2%**); the brief/place
panel uses CHAS `renter_cb30_share` (`data/hna/place-chas.json`; Silt **62.5%**). Both are correct (ACS S2503 vs HUD
CHAS, different vintages) but read as contradictory. Label each inline with source + vintage, e.g.
`51.2% (ACS S2503, 2024 5-yr)` vs `62.5% (HUD CHAS, 2018–22)`.
**Done when:** every displayed cost-burden % shows its source + vintage.

## ⚪ L1 — Stale-gated-bundle check  *(Phase-5 item; not yet built)*

`~/coho-backend/scripts/verify-bundle.mjs` checks per-file sha256 drift + reads `.coho-build.json`, but nothing compares
the bundle's recorded build commit to public `main`'s HEAD. Add a lightweight check that reads the `.coho-build.json`
commit and warns if it's behind `git rev-parse origin/main`. Free, no deploy.

---

## Not a bug — explicitly OUT of scope
- **"Switch HNA to HUD place-level CHAS" (the deferred "Phase b"):** infeasible here. No place-level CHAS in-repo
  (`data/market/` has only `chas_co.json` county + `chas_tract_co.json` tract); HUD CHAS download is WAF-blocked; and the
  tract→place spatial join is *already* the accuracy fix over county inheritance. The residual Fruita AMI skew
  (renters 417 vs the Points Consulting HNA's 260 at 100%+) is a CHAS vintage/tabulation limitation, not a fixable bug
  on free tier. Leave as a documented limitation.

## Consolidated phase plan (after C1 + H1)

| # | Phase | Done when |
|---|---|---|
| 0 | **C1** revert ranking shift (above) | Silt back on spec; anchor retained |
| 1 | **Contact-PII, free part** — `git rm` the 4 CSVs in `docs/developer-pipeline-prototype/` from HEAD, relocate into `~/coho-backend`, rewire `build-bundle.sh`. Defer history-purge + private-Pages (owner). | HEAD no longer tracks contact CSVs; bundle still builds |
| 2 | **HNA reliability** — pre-cache extended ACS vars (`DP02_0002E`, `DP03_0027E`, `DP03_0061E`, `DP05_0037E` + any from `test:hna-acs-coverage`) into the summary ETL (not a manual backfill); **H1 guard**; deterministic place + ranking outputs with no-op regen tests; **add the projected-need layer** (`population_projection_20yr` already exists, county-approximated); keep live Census as fallback only | All panels render from cache; `check-*-fresh` green; projected-need shipped |
| 3 | **Operational verification** — nodemailer-9 smoke (no real send); Worker login/logout, extensionless routes, no redirect loop (already fixed via `html_handling="none"`), pipeline + priorities sync, Silt brief render; 2-device pipeline merge+delete; focused Worker tests (auth, cookie expiry, APIs, asset routing); confirm each data-writer dispatches deploy | Worker tests pass; manual checklist signed |
| 4 | **SEO** — M2 | sitemap ≥ 483 locs; JSON-LD validates |
| 5 | **Maintenance** — keep brief/privacy/sitemap/bundle CI; one documented dual-repo no-deploy test command; L1 stale-bundle check; prune stale auto-PRs; data-vintage refreshes when sources available | single command tests both repos without deploying |

## Open questions
- **Which Silt gap is canonical — 153 (committed/spec) or 157 (current inputs)?** Trace `data/co_ami_gap_by_place.json`'s
  git history vs when the committed `ranking-index.json` was last built. This decides whether C1 is *revert-to-spec* or
  *refresh-and-respec*.
- Worker auth path (login/logout, pipeline sync) needs **owner** verification — no gate password in CI.

## Evidence appendix (commands that produced the findings)
```bash
# C1: 495/547 ranks changed in faef8f19
python3 - <<'PY'
import json,subprocess
r=lambda ref:{e['geoid']:e['rank'] for e in json.loads(subprocess.run(['git','show',f'{ref}:data/hna/ranking-index.json'],capture_output=True,text=True).stdout)['rankings']}
a,b=r('faef8f19~1'),r('HEAD'); print(sum(a[g]!=b[g] for g in b if g in a),'/',len(b))
PY
# M2: sitemap/JSON-LD
grep -c '<loc>' sitemap.xml ; grep -c 'application/ld+json' index.html
# OUT-of-scope (b): no place CHAS
ls data/market/chas_* data/hna/*chas*
```
