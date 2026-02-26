# Copilot PR check prompt (paste into GitHub Copilot Chat)

Use this prompt when opening a PR for the Housing Analytics GitHub Pages site.

---

## Prompt

You are reviewing a pull request for a static GitHub Pages site (HTML/CSS/JS) with data ETLs in `.github/workflows/`.

Do a PR review focused on **site correctness, data wiring, and regressions**.

### 1) Functional smoke tests (no terminal)
- Open `housing-needs-assessment.html` in the deployed preview.
- Change the **Type** and **Geography** selectors and confirm the following modules update:
  - Map boundary renders and fits to bounds.
  - Executive Snapshot stats populate (population, income, home value, rent, tenure, rent burden, commute).
  - Charts render (housing stock, tenure, affordability, rent burden bins, mode share, LEHD inflow/outflow).
  - Age pyramid and senior pressure update (county context for place/CDP).
  - **20-year outlook** chart renders and the housing-need stats populate.
- Click **Download PDF** and confirm it either downloads a PDF or triggers print-to-PDF without a blank page.

### 2) Console + network checks
- Open DevTools:
  - No uncaught JS errors.
  - No 404s for local assets (css/js/data).
  - Any failed external fetches should degrade gracefully (banner + partial module).

### 3) Data pipeline checks
- Confirm `.github/workflows/build-hna-data.yml` runs on the PR branch.
- Confirm it produces/updates:
  - `data/hna/summary/*.json`
  - `data/hna/lehd/*.json`
  - `data/hna/dola_sya/*.json`
  - `data/hna/projections/*.json`
- Confirm the repo has required secrets:
  - `CENSUS_API_KEY` (optional but recommended)

### 4) Regression checks
- Confirm navigation/theme look consistent with the rest of the site.
- Confirm charts are legible in **light and dark** modes.
- Confirm print styles are readable.

### 5) Automated checks
- Confirm the **Dead link check** workflow is enabled and passing.
- If it fails, identify the first missing local link and recommend a fix.

### Output format
- Provide a short PR review with:
  1) ✅ What looks good
  2) 🔴 Blockers
  3) 🟡 Suggestions
  4) A quick checklist of files likely needing another pass
