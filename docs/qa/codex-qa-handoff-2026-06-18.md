# Codex QA/QC Handoff — everything since the 2026-06-17 search/SEO checkpoint

_Date: 2026-06-18 · internal QA doc (excluded from the public artifact)._

## Scope / boundary

**Last Codex checkpoint:** [`docs/qa/codex-handoff-2026-06-18.md`](codex-handoff-2026-06-18.md)
(commit `e2e0affd`, 2026-06-17). Its "state going in" baseline already verified
everything **through #977** (domain cutover, the #975→#977 deploy outage fix, PR
triage 11→5, phase-2 rename merged).

**This handoff = `e2e0affd..HEAD`** — 19 commits, of which **7 are substantive**
(below) and the rest are automated data refreshes (FRED, Polymarket, quarantine/
audit bots) that don't need review.

Please QA/QC the 7 items, then sanity-check the two **still-open** prior-handoff
phases at the bottom (they're unfinished work, not regressions).

| # | Commit | What | Surface |
|---|--------|------|---------|
| 1 | `fab05e6b` #979 | De-pin deploy-gate sitemap assertion | CI / deploy gate |
| 2 | `bf9e2202` #980 | Site-wide search box | `search.html`, `js/site-search.js` |
| 3 | `7bdee708` #981 | "What do these AMI tiers mean?" explainer | place profiles |
| 4 | `995a533d` #982 | Clearer pipeline dashboard + cross-device priorities + civic-panel fix | `developer.html`, `developer-brief.html` |
| 5 | `bafdaa89` #983 | House favicon (replaces stale Wix icon) | `favicon.svg`, build + nav |
| 6 | `42961189` | Cross-device pipeline drafts via backend sync (KV) | `js/components/pipeline-store.js`, `developer-pipeline.html` |
| 7 | `88685789` | Regenerate place pages from corrected CHAS apportionment | `places/` (464 updated, 18 new) |

---

## 1. #979 — de-pin deploy-gate sitemap assertion (`fab05e6b`)

**Why:** #975 changed `robots.txt`'s `Sitemap:` line and the pinned literal URL in
`test/pages-availability-check.js` (which runs *inside* `deploy.yml`) silently broke
**every** deploy for ~1h. #977 repointed it; #979 de-pins it entirely.

**What changed:** the assertion now derives the expected sitemap host from `CNAME`
instead of a hard-coded URL — so a future `robots.txt`/`CNAME` edit can't break deploys.

**QA focus:**
- Re-read the regex/derivation in `test/pages-availability-check.js`; confirm it still
  *fails* if the sitemap line genuinely goes missing or points off-domain (don't want it
  de-fanged into a no-op).
- `node test/pages-availability-check.js` → expect 114 passed, 0 failed.

## 2. #980 — site-wide search (`bf9e2202`)

**Goal (from prior handoff Phase 1):** typing "Silt" surfaces all analytics for that place.

**What shipped:** `search.html` + `js/site-search.js`, driven by `search-index.json`
(generated in `scripts/build-public-site.mjs` from every public page's title/desc/headings).
Place profiles are intentionally down-weighted (`*= 0.25` for `places/<geoid>.html` on a
non-title hit) so topic pages aren't buried.

**QA focus:**
- Name normalization: "Silt", "Silt, Colorado", "Silt town" should all resolve to
  `places/0870195.html`. Census suffixes (` town| city| CDP| village`) stripped.
- **Confirm the search index only references pages that exist** (the prior handoff's #1
  risk was 18 place profiles that would 404 — see item 7; those now exist, but verify the
  index has no other dangling entries).
- Is there resolver test coverage? Prior handoff asked for a unit test; verify or flag.

## 3. #981 — AMI-tier explainer (`7bdee708`)

**What:** an injector (`js/place-profile-help.js`, loaded by `navigation.js`) adds a
"What do these AMI tiers mean?" explainer to place profiles; the same markup was also baked
into `places/_template.html`.

**⚠️ Interaction with item 7 (must verify):** regenerated place pages (item 7) now contain
the explainer **natively** from the template, and the runtime injector is written to
**no-op** when it's already present. Confirm **no double render** on a regenerated page
(e.g. `places/0870195.html`) — grep shows exactly one `"AMI tiers mean"` occurrence, but
verify in-browser that the injector detects it and bails.

## 4. #982 — pipeline dashboard + cross-device priorities + civic fix (`995a533d`)

Three things in `developer.html` / `developer-brief.html` (private pages, stripped from the
public artifact):
- **Dashboard clarity:** "This Week — Top Priorities" is now user-controlled (manual list,
  `/api/priorities` + localStorage fallback); the auto-derived list demoted to "Upcoming
  Actions"; per-counter tooltips explain how rows enter each bucket; a "how a conversation
  moves through the pipeline" legend added.
- **Civic panel fix (`developer-brief.html`):** `civicSection()` was rendering the v1.0
  count-of-7 scorecard as if it were a v2 percentile ("3/100"); rewritten to read
  `{totalScore, maxPossible, knownDimensions, dimensions{true|false|null}}` and show
  "3 of 7", Yes/No/Not-assessed.

**QA focus:** spot-check the civic panel against `data/policy/housing-policy-scorecard.json`
for a place with mixed/null dimensions; confirm "Not assessed" renders for nulls and the
denominator is `knownDimensions`, not 7, where applicable. (See item 6 re: `/api/priorities`.)

## 5. #983 — favicon (`bafdaa89`)

`favicon.svg` (teal house) added to `PUBLIC_ROOT_FILES` in `build-public-site.mjs` and
injected via `navigation.js` `ensureFavicon()`. **QA:** confirm it lands in `dist/`, is
referenced on built pages, and doesn't double-inject where a page already declares one.

## 6. Cross-device pipeline sync (`42961189`) — spans two repos

**Problem:** the in-app "Add to pipeline" layer wrote only to per-device `localStorage`, so
a jurisdiction added on the laptop never appeared on the phone.

**Client change (in THIS repo — review here):** `js/components/pipeline-store.js` gained an
optional `syncUrl` and now mirrors `{drafts, edits, deletes}` to a backend endpoint:
- **pull once on init** (resolves `PipelineStore.ready`); **first contact MERGES** local into
  the server copy (so a pre-sync draft is never lost); **steady-state adopts** the server (so
  deletes/clears propagate). Guarded by a `_synced_v1` localStorage flag.
- **push after every mutation**, routed through `_writeJson` → `_maybeSync` (with a
  `_suspendPush` guard so adopted writes aren't echoed back).
- `developer-pipeline.html` repaints the kanban when `ready` resolves.

**Backend contract (in the SEPARATE private repo `~/coho-backend`, NOT in Codex's review
scope):** the password-gated Cloudflare Worker now serves `GET/POST /api/pipeline` and
`/api/priorities`, both backed by one KV namespace (binding `STATE`, keys `pipeline` / `week`).
Returns `null`/`[]` when KV is unbound so the client falls back to localStorage.

**QA focus (skeptic's lens — this is the riskiest item):**
- **Data-loss edges:** trace what happens if a push fails offline then the device reloads
  (steady-state adopt would discard the un-pushed change). The page is Worker-gated so it
  can't load offline — confirm that assumption holds and is the reason this is acceptable.
- **First-run merge correctness:** two devices each holding *different* pre-sync drafts —
  verify neither is lost on first sync (union by geoid).
- **Delete propagation:** removing a draft on device A should not resurrect from device B.
- Confirm the public site is unaffected: `pipeline-store.js` is in `BLOCKED_PATHS`, so it's
  stripped from `dist/` and `syncUrl` only ever resolves against the gated Worker origin.

## 7. Place-page regeneration (`88685789`) — the big one

**What:** ran `scripts/hna/build_place_pages.py` (stdlib-only) to regenerate all place
profiles from `data/hna/place-chas.json`. **464 updated + 18 new = 483 files.** `dist/` is
gitignored and excluded.

**Why it was required:** the pages were last generated at `#803` (May 10), *before* the
May 29 apportionment fix (`75857316`, "small towns undercounted ~70x"), and no workflow
regenerates them. They served badly wrong figures — **Silt showed 5.3 renter / 17.6 owner
households** (a town of ~3,000) vs the corrected **277 / 915**.

**This closes the prior handoff's Phase-1 risk:** the **18 places that "would 404"**
(Air Force Academy, Fort Carson, Security-Widefield, Southern Ute, …) now have real pages.

**Apportionment is vetted:** per locked-in **product decision 2026-04-20 #1** (downscale
county→place by share + approximation disclaimer; do not hide place panels). Distribution:
473 `population-apportionment`, 6 `area-apportionment`, 3 `rate-only-fallback`.

**QA focus:**
- **Spot-check 3–4 geoids** (one tiny CDP, one mid town, one rate-only-fallback) against ACS
  household counts for plausibility — the fix is a ~50× swing for small places, so a wrong
  apportionment denominator would be very visible.
- **Source-label nuance:** `build_place_pages.py` (~line 213) renders the visible "CHAS
  source" stat as `'TIGER 2024 place-CHAS'` for everything except `rate-only-fallback`, even
  when the embedded `source` is `population-apportionment`. Decide whether that label should
  distinguish the apportionment method.
- Confirm the approximation disclaimer is present on a regenerated page.

**Already verified before commit:** `pages-availability-check` 114/0 · `build:public` clean
(528 pages) · `audit:public-artifact` passed (1863 files).

---

## Still open from the prior handoff (unfinished, NOT regressions)

- **Phase 2 — auto-generate the sitemap:** `sitemap.xml` is *still* the hand-maintained
  **21-URL** file. `build-public-site.mjs` only **copies** it (it's in `PUBLIC_ROOT_FILES`);
  it does not emit the 464 place profiles — and now the **18 new pages are also absent**.
  This is the biggest remaining SEO lever. (Mind the deploy-gate trap when changing it.)
- **Phase 3 — structured data:** **0** `application/ld+json` blocks in `index.html`; no
  `Place`/`Dataset` JSON-LD on place profiles. Not started.

## Verification commands

```bash
node test/pages-availability-check.js      # deploy gate — expect 114/0
npm run build:public                       # builds dist/ + search-index + sitemap copy
npm run audit:public-artifact              # public-artifact guard
npm run test:developer-geoids              # developer geoid integrity
```

## Suggested verdict format

Per item: **PASS / PASS-WITH-NITS / FAIL**, with file:line citations. Prioritize items 6 and
7 (highest blast radius: cross-device data integrity and 483 public-facing pages).
