# Non-Technical Implementation Guide

This guide is written for non-technical operators who need to understand, review, or approve changes to the COHO Analytics housing platform.  It does not require programming experience.

---

## 1. How to Run GitHub Copilot on This Repository

GitHub Copilot is an AI assistant that can suggest or make code changes when you describe what you want.

**Steps:**
1. Open the repository at [github.com/pggLLC/Housing-Analytics](https://github.com/pggLLC/Housing-Analytics).
2. Click the **Copilot** icon (looks like a robot head) in the left sidebar of GitHub.com, or open a Codespace by clicking **Code → Open in Codespace**.
3. In the chat box, type a clear description of the change you want — for example:  
   *"Add a page about Colorado housing legislation to the site."*
4. Copilot will propose changes.  Review them before approving.
5. When you are satisfied, click **Create Pull Request** to submit the changes for review.

**Tips:**
- Be specific.  Instead of "fix the map," say "the LIHTC map shows year 8888 for some projects — change it to show Unknown instead."
- If Copilot misunderstands, close the session and start over with a more precise description.

---

## 2. What Files Should Change (and What Shouldn't)

### Files that are expected to change regularly

| File or folder | What it is |
|---|---|
| `data/*.json` | Cached data files updated by automated workflows |
| `data/market/*.json` / `.geojson` | Market analysis data |
| `data/alerts/alerts_archive.json` | News / policy alerts feed |
| `data/policy_briefs.json` | AI-generated policy brief summaries |
| `js/*.js` | Site logic and chart rendering |
| `*.html` | Page content and layout |
| `docs/*.md` | Documentation |

### Files that should **not** change without careful review

| File | Why it is sensitive |
|---|---|
| `css/site-theme.css` | Changing colours may break accessibility (WCAG AA) |
| `js/navigation.js` | Controls the menu on every page |
| `js/path-resolver.js` | Controls how the site loads on GitHub Pages |
| `.github/workflows/*.yml` | Controls automated data-update pipelines |
| `package.json` | Tracks JavaScript dependencies |

### Files that should never be committed

- `node_modules/` — JavaScript library files (auto-generated, too large)
- `__pycache__/` — Python bytecode (auto-generated)
- `.DS_Store` — macOS folder metadata (no value to the project)

---

## 3. How to Run Validation

Validation checks that critical data files exist and contain a minimum number of records.

**In a terminal or Codespace terminal:**
```bash
node scripts/validate-critical-data.js
```

Expected output when everything is fine:
```
OK  data/co-county-boundaries.json: 64 features
OK  data/qct-colorado.json: 224 features
OK  data/dda-colorado.json: 10 features
...
Critical data validation passed.
```

**To check HTML links and asset references:**
```bash
node validate.js
```

**To rebuild market data:**
```bash
python3 scripts/build_market_data.py
```
This will download fresh Census ACS tract metrics, tract centroids, and HUD LIHTC data for Colorado.

---

## 4. What Pages to Preview Before Approving a PR

If a pull request changes any of the following files, open the corresponding page in a browser (use the GitHub Pages preview URL or a local server) and check that it loads correctly:

| Changed file | Page to preview |
|---|---|
| `js/co-lihtc-map.js` | `colorado-deep-dive.html` — Interactive Map section |
| `js/housing-needs-assessment.js` | `housing-needs-assessment.html` |
| `js/navigation.js` | Any page — check the menu opens and closes |
| `LIHTC-dashboard.html` | `LIHTC-dashboard.html` |
| `state-allocation-map.html` | `state-allocation-map.html` |
| `data/fred-data.json` | `economic-dashboard.html` |
| `data/chfa-lihtc.json` | `colorado-deep-dive.html` — LIHTC map markers |
| `policy-briefs.html` | `policy-briefs.html` |
| `colorado-elections.html` | `colorado-elections.html` |

**What to check:**
- Page loads without blank areas or error messages
- Charts and maps display data
- Navigation menu works on mobile and desktop
- No broken images or missing icons
- Text is readable in both light and dark mode

---

## 5. How to Review a Pull Request Before Merging

1. Go to the **Pull Requests** tab on GitHub.
2. Click the PR you want to review.
3. Read the **description** — it should explain what was changed and why.
4. Click the **Files changed** tab to see exactly what was modified.
5. Look for any red ✗ icons next to automated checks at the bottom of the PR page.  If checks are failing, the PR should not be merged until the failures are explained or fixed.
6. Click **Review changes → Approve** if you are satisfied, or **Request changes** if something looks wrong.
7. Once approved and all checks pass, click **Merge pull request**.

---

## 6. Acceptable Warnings vs. Merge Blockers

### ✅ Acceptable — merge can proceed

| Warning type | Why it is OK |
|---|---|
| "X tract records below threshold 500" | Data is sparse but present; full download takes time |
| "LIHTC feature count below 100" | Live API may be rate-limited; local file still serves as fallback |
| "Historical estimate — Colorado detail only" | Expected for years 2010–2023 |
| Missing `data/car-market.json` | Requires manual CAR data fetch; placeholder is shown |
| Lint warnings about `var` vs `let` | Intentional for IE11 compatibility in some files |

### ❌ Merge blockers — do not merge until fixed

| Problem | Why it must be fixed |
|---|---|
| `validate.js` reports broken asset reference | A required CSS/JS file is missing; the page will not load |
| `validate-critical-data.js` exits with code 1 | A critical data file is empty or invalid |
| Navigation menu disappears | `js/navigation.js` error; affects every page |
| Map renders outside Colorado | Bounds or projection error |
| Any page shows a JavaScript error in the browser console | Indicates a code defect that may affect users |
| Accessibility check fails on `--accent` token value | Must be `#096e65` for WCAG AA compliance |

---

## 7. Glossary

| Term | Meaning |
|---|---|
| ACS | American Community Survey — Census Bureau household survey |
| LIHTC | Low-Income Housing Tax Credit — federal affordable housing incentive |
| QCT | Qualified Census Tract — high-poverty/low-income area for LIHTC |
| DDA | Difficult Development Area — high-cost area for LIHTC |
| CHFA | Colorado Housing and Finance Authority |
| FRED | Federal Reserve Bank of St. Louis Economic Data |
| AMI | Area Median Income |
| FMR | Fair Market Rent — HUD rent benchmark |
| CHAS | Comprehensive Housing Affordability Strategy — HUD data on cost burden |
| NHPD | National Housing Preservation Database |
| PR | Pull Request — a proposed set of code changes on GitHub |
| WCAG AA | Web Content Accessibility Guidelines level AA — minimum accessibility standard |

---

## 8. PR: Archive-Aligned Cleanup (March 2026)

This section documents what changed in the archive-aligned cleanup pull request so that
non-technical reviewers can understand what was done and why.

### What moved to `_tobedeleted/`

The folder `_tobedeleted/` is a quarantine area — files are moved there rather than permanently
deleted so they can be recovered if needed. This folder is excluded from the live website.

| File | Why it was moved |
|------|-----------------|
| `js/app.js`, `js/data.js`, `js/metrics.js` | No page on the site loads these files. They had a code error and referenced files that don't exist. |
| `js/data-service.js` | Was loaded by one page but not actually used by that page. |
| `js/dashboard.js` | Was never loaded by dashboard.html, which uses its own built-in script. |
| `js/responsive-nav.js`, `css/responsive-nav.css` | Replaced by `js/mobile-menu.js`, which is already on all pages. |
| `.env` | Contained a personal email address. Should never have been committed. |
| `CHANGED_FILES.txt`, `DEPLOYMENT-GUIDE.txt`, `DATA-SOURCES.md` | Redundant with docs/ equivalents. |

### What was created

| File | Purpose |
|------|---------|
| `scripts/alert_feeds.txt` | Template for adding Google Alerts RSS feeds. Edit this to activate the alerts pipeline. |
| `data/alerts/alerts_archive.json` | Starting file for the alerts pipeline. Will be updated automatically once feeds are configured. |
| `data/policy_briefs.json` | Starting file for the policy briefs pipeline. Updated automatically after alerts flow. |
| `docs/fix-scripts-audit.md` | Documents the status of all fix_*.py scripts. |
| `docs/repo-audit-summary.md` | High-level summary of all cleanup actions taken. |

### Pages you can preview

All existing pages continue to work. No pages were removed or renamed. Improvements were made to:

- `policy-briefs.html` — better empty-state message when no briefs exist yet
- `colorado-elections.html` — added link to the 2026 Housing Legislation Tracker

### Acceptable warnings

- The policy briefs and alerts pages will show "no data yet" messages until RSS feeds are configured.
- This is expected and not a defect.

