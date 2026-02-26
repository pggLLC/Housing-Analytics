# Repository audit (HNA + general cleanup)

Generated: 2026-02-26

## 1) Unused / legacy HTML files
These HTML files are not referenced by `js/navigation.js` and are not linked by other pages (based on a repo-wide scan of `href=`, `src=`, and `fetch('*.html')`). Consider moving to a development folder or deleting if truly obsolete.

- `census-dashboard.html`
- `construction-commodities.html`
- `lihtc-guide-for-stakeholders.html`
- `docs/EXAMPLE-USAGE.html`

Notes:
- `construction-commodities.html` was previously flagged as needing fixes (chart height + time adapter). If you plan to revive it, keep it in a dev area.

## 2) Recommended dev folder naming
- **Do not** name a folder `.html`. GitHub Pages treats dot-folders as normal folders, but `.html` is confusing (it looks like a file extension) and will confuse humans + tooling.
- Use one of these instead:
  - `_dev/` (common convention)
  - `dev/`
  - `drafts/`
  - `_wip/`

If you want pages “hidden” from casual navigation, the best approach is:
- Keep them out of `navigation.js` (no nav links)
- Optionally place under `_dev/` and link only from README/dev docs

## 3) Legacy / removable artifacts
Safe to remove:
- `__MACOSX/` (Mac zip metadata)
- Any `CHANGED_FILES.txt` snapshots that are no longer used by your process (keep one if you rely on it)

Review carefully before removing:
- `test/` and `tools/` (keep if used by workflows)
- `cloudflare-worker/` and `serverless/` (keep if you still deploy workers)

## 4) High-impact cleanup opportunities
- **Duplicate dashboards / variants**: if you have `economic-dashboard-2.html` / `economic-dashboard-3.html` etc in other branches/zips, consider consolidating.
- **Centralize config**: ensure every API call reads from `js/config.js` and never hardcodes keys.
- **Data directory structure**: standardize:
  - `data/fred-data.json`
  - `data/hna/...`
  - `data/lihtc/...` (allocations by year)

## 5) HNA data pipelines present
- `scripts/hna/build_hna_data.py`
- `.github/workflows/build-hna-data.yml`

These produce cached public datasets under `data/hna/` for GitHub Pages.
