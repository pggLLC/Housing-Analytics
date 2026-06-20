# Codex QA/QC Handoff — 2026-06-20

> ⚠️ **Superseded** — consolidated into the single current handoff **[CODEX-HANDOFF.md](CODEX-HANDOFF.md)**. This file is retained as the detailed QA/QC record.

_QA/QC of everything shipped since the previous two handoffs
([`codex-qa-handoff-2026-06-18.md`](codex-qa-handoff-2026-06-18.md) and
[`codex-handoff-2026-06-19-next-phases.md`](codex-handoff-2026-06-19-next-phases.md)).
Internal doc — excluded from the public artifact via the `docs/qa` block._

**Window:** 2026-06-19 → 2026-06-20. **State going out:** `main` clean, working tree clean, 0 open PRs,
**`test:ci` green end-to-end** (see §Gates).

## Commit inventory (substantive; automated cron commits omitted)

| Commit | What | QA verdict |
|---|---|---|
| `6e9ced42` | Silt brief: `regional-modular-pipeline` + `silt-recent-planning` sections | ✅ source-verified |
| `0de30f49` | 11-brief repair (CHFA verified, Enterprise macro, 3 unreadable sources dropped, Towaoc fix) + `test:briefs` added to `test:ci` | ✅ verified + gated |
| `82e93bb4` | Silt brief: `official-affordability-discussion` section | ✅ first-hand verified |
| `06bec5a5` | Silt cleanup: `curator`→`PG`; GCHA rows `partial`→`supported` | ✅ verbatim-confirmed |
| `890d404b` | Define phantom `--accent-weak` token (a #980 regression) | ✅ guard green |
| `~/coho-backend` (sep. repo) | `html_handling="none"` — fix ERR_TOO_MANY_REDIRECTS | ⚠️ deployed; authed path needs owner login confirm |

Automated cron commits in the window (`ec02d3c3`, `e2f951b5`, `c8acb4c3`, `7c7b762c` — pipeline/quarantine/data-refresh) are not reviewed here.

## QA/QC by surface

### Jurisdiction briefs (the bulk of the work)
- **All 12 pass `npm run test:briefs`.** Every published cited (section, paragraph, source) pair has a `_verified`
  row; every `supported` row carries a verbatim quote; direct-fetch methodology declared.
- **Silt (0870195)** — 8 sections, 13 sources, 22 `_verified` rows (**17 supported / 5 partial**). Load-bearing
  claims were verified **first-hand by the curator**: the CHFA award list, the Enterprise PDF, the Habitat page,
  SB25-002, Post Independent ×3, and the **Feb-9 Board of Trustees minutes read page-by-page** (scanned PDF). The two
  GCHA rows were upgraded `partial`→`supported` after verbatim re-confirmation against the Post Independent article.
- **11 repaired briefs** — CHFA 2026 Round One award claims verified against the official CHFA list (14 developments
  in Aurora, Cañon City, Clifton, Colorado Springs, Denver, Divide, Fort Lupton, Lafayette, Manitou Springs, Montrose,
  Towaoc; **none** in the 7 jurisdictions that make a "not awarded" claim). The 3 macro sources that hard-block
  automated fetch with no archive (Harvard JCHS ×2, KC Fed) were **removed, not faked**.
- **Residual risk:** the 5 Silt `partial` rows (large-P&Z-packet extractions + the Riverview absence-finding) and
  similar packet/absence rows elsewhere are vicinity-verified via agent PDF extraction, not curator-verbatim.
  Acceptable per the gate; flagged for a future verbatim pass. **No fabricated content shipped.**

### CI gate (the fix for *why* the 11 broke)
`scripts/validate-jurisdiction-briefs.py` now runs in `test:ci` via `npm run test:briefs` — previously cron-only
(`jurisdiction-briefs-monthly.yml` / `source-liveness-weekly.yml`), which is why 11 invalid briefs sat on `main` for
~3 days. An invalid brief now fails per-PR.

### Backend redirect loop (ERR_TOO_MANY_REDIRECTS)
Root cause: Cloudflare Assets' default `auto-trailing-slash` 307-redirected `/developer.html` ↔ `/developer` against
the worker's extensionless handler → an infinite loop for *authenticated* users. Fix: `html_handling = "none"` in
`~/coho-backend/wrangler.toml`, committed + deployed. **Verified:** unauthenticated paths resolve in 0 redirects.
**Not verifiable here:** the authenticated path (no password) — owner should confirm a fresh login lands on the dashboard.

### Pre-existing issues this QA pass found and fixed
- **Phantom `--accent-weak` token** — `search.html:44` (from #980, 2026-06-17) referenced an undefined token (with a
  fallback), so `test:phantom-css-vars` / `test:ci` had been **red on main since 06-17**, unrelated to this session's
  work. Defined the token in both `:root` and `html.dark-mode` at the fallback value — rendering unchanged, guard green.
- **34 macOS/iCloud `" 2"` duplicate files** (e.g. `dist/css 2`, `places/… 2.html`, `scripts/… 2.py`) cluttered the
  working tree and broke the **local** `audit:public-artifact` (it forbids `" 2"`/`._` paths). All were confirmed
  redundant (canonicals present), **gitignored** (so the handoff was never affected), and removed. **Root cause: the
  repo lives under `~/Documents`, which is iCloud-synced; iCloud recreates these on sync conflict.** Recommend moving
  the working copy outside iCloud, or they will return.

## Gates (run 2026-06-20, all green)
- `npm run test:ci` — ✅ pass (end-to-end; the new `test:briefs` is the final step)
- `npm run test:briefs` — ✅ 12 briefs pass
- `npm run audit:public-artifact` — ✅ 1863 files, no private-path leaks, no sensitive-pattern hits
- `npm run test:phantom-css-vars` — ✅ 164 tokens, 0 phantoms
- Private layers confirmed **blocked from the public dist**: no `data/jurisdiction-briefs`, no `js/components/jurisdiction-brief.js`.

## Repo cleanliness (handoff-ready)
- **Housing-Analytics:** working tree clean, 0 git-tracked cruft, 0 open PRs, `test:ci` green.
- **`~/coho-backend`:** redirect fix committed; working tree clean.

## Open items for Codex / owner
- **Owner directive:** apply the 3 new brief content types — regional development pipeline, recent local planning
  actions, and **official affordability-target discussion in specific developments** — to other jurisdiction briefs
  where the records support it. Source-first; if officials set no target, state the absence.
- Verbatim-verify the remaining `partial` brief rows (Silt's 5 + analogous packet/absence rows) for a full upgrade.
- **Owner actions:** confirm the backend login works after the redirect fix; consider moving the repo off iCloud-synced
  `~/Documents` to stop the `" 2"` duplicate churn.
