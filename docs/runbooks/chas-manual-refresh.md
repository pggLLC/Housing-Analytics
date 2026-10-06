# HUD CHAS manual refresh

HUD publishes CHAS annually. As checked on 2026-10-05, 2018–2022 is still the
current release. Automated requests return an HTTP 202 bot challenge even for
nonexistent archive URLs. That response establishes neither publication nor
absence. The weekly vintage watch first checks the known current archive; an
unverifiable check emits a workflow warning and opens or updates the single
upstream-vintage tracker for a manual check. Do not treat its green workflow
conclusion as confirmation that the vintage is current.

`fetch-chas-data.yml` has no schedule. It retains manual dispatch for when HUD
allows automated access; dispatching it does not supply a local cached ZIP.
The normal blocked-source refresh is the local browser/cache procedure below.

## Refresh procedure

1. Open [HUD's CHAS download page](https://www.huduser.gov/portal/datasets/cp.html)
   in a browser. Check the published vintage and record the checked date and
   archive URL in the refresh PR. If the vintage is unchanged, record the manual
   check on the tracking issue; do not regenerate unchanged data just to advance
   timestamps.
2. Download the **140-jurisdiction CSV ZIP** in the browser and place it at
   `.cache/chas_140_csv.zip` in the repository. Replace any older cached archive;
   the fetcher uses this file before any network request. Do not commit the ZIP.
3. If the published vintage changed, update `VINTAGE` and `CHAS_STATE_URL` in
   `scripts/fetch_chas.py` to match the downloaded archive. Review the fallback
   URL too; never label an older cached/fallback archive with the new vintage.
   Run `python3 scripts/fetch_chas.py`. It produces the county and tract files
   below. A bot challenge, HTML, empty body or missing ZIP signature is an error,
   not evidence of empty Colorado data.
4. Run `python3 scripts/hna/build_place_chas.py`, the place-CHAS step of
   `build-hna-data.yml`. Follow **AGENTS.md's ordering**: ACS summary phases and
   Phase 2.5 (statewide summary) must be complete first; place CHAS must run
   **before Phase 7** (ranking index). With a CHAS-only update, use the current
   committed ACS summaries, tract membership, tract metrics and place-LEHD inputs;
   do not launch an unrelated ACS refresh. Check place coverage and tenure anchors.
5. Run `npm run rebuild:derived` after place CHAS. CHAS feeds ranking and
   jurisdiction digests, which in turn feed brief sections, the home snapshot,
   place pages and paper figures. The chain orders ranking/augmentations,
   scenarios, digests, briefs, snapshot and pages before inventory and manifests.
   Run `node scripts/build_rent_burden_crosscheck.mjs` as well if refreshing its
   CHAS comparison output; it is a separate direct consumer.
6. Before **each** rebuild, inspect and remove actual iCloud duplicates using
   AGENTS.md's prescribed cleanup (exclude `.git` and `node_modules`, including
   extensionless duplicate directories). Stage any new intended files before
   `node scripts/compute-inventory.mjs --write`, which counts tracked files. For the final
   local checks, run `npm run audit:file-manifest` **before**
   `python3 scripts/rebuild_manifest.py`, then `node scripts/validate-schemas.js`.
   The second manifest records the first one's byte count. Run the CHAS Python
   tests, place-CHAS method/share/tenure/freshness tests and downstream guards.
7. Review and commit only the intended source and derived data changes. Do not
   commit generated manifests, inventory lines or `data/paper/*`; CI regenerates
   them. Include vintage, coverage and spot-check evidence in the PR, and update
   the tracking issue with the manual check. Do not imply that an unreadable
   source has been verified.

## Direct consumers checked

The files below are written by `scripts/fetch_chas.py`. References were traced
through `js/`, `scripts/`, HTML and workflows on 2026-10-05. Tests and documentation
also cite the files; they are validation/reference uses, not additional feeds.

| Input | Readers and uses |
|---|---|
| `data/market/chas_co.json` | `js/chas-tier-shares.js` loads county shares (used by market analysis and the deal calculator); `js/place-chas-lookup.js` accepts those county records as a fallback. `scripts/market/data_quality_validator.py` checks coverage. |
| `data/market/chas_tract_co.json` | `scripts/hna/build_place_chas.py` builds `data/hna/place-chas.json` and coverage stats. `scripts/check-place-chas-fresh.py` validates that rebuild. |
| `data/hna/chas_affordability_gap.json` | `js/hna/hna-utils.js` supplies the HNA path to the loader; `js/hna/hna-renderers.js`, `js/hna/hna-narratives.js` and `js/components/housing-type-need.js` consume loaded records. Direct loaders are `js/ic-summary.js`, `js/compare.js`, `js/lihtc-opportunity-finder.js`, `js/project-market-study/study-geography.js`, `js/colorado-deep-dive.js` and `js/market-analysis.js`. `js/data-source-discovery.js` registers the source; `index.html` links to it. Build readers are `scripts/hna/build_ranking_index.py`, `scripts/hna/build_jurisdiction_metrics_digest.mjs` and `scripts/build_rent_burden_crosscheck.mjs`. Validation/audit readers are `scripts/validate-critical-data.js`, `scripts/audit/data-freshness-check.mjs` and `scripts/audit/verify-opportunity-finder.mjs`. |

`js/methodology-explainer.js` also names the county and place files as provenance.
`fetch-chas-data.yml` validates/stages the three fetch outputs. Workflow outcome
monitors retain manual-dispatch coverage; no monthly CHAS completion is expected.
