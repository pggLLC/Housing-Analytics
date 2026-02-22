# Deployment Guide (GitHub Pages)

This repo is a static GitHub Pages site with optional serverless endpoints for data aggregation.
The goal is: **no secrets in the browser** and fast, cached JSON for the heaviest computations.

## 1) GitHub Pages setup

1. Push the site files to your GitHub repo root (same structure as this package).
2. In GitHub: **Settings → Pages**
   - Source: `Deploy from a branch`
   - Branch: `main` (or your branch) / folder: `/ (root)`
3. Wait for Pages to publish.

## 2) Required repo secrets (for scheduled data refresh)

Two GitHub Actions workflows are included in `.github/workflows/`:

- `fetch-fred-data.yml` writes `data/fred-data.json`
- `fetch-census-acs.yml` writes `data/census-acs-state.json`

Add secrets:
- `FRED_API_KEY`
- `CENSUS_API_KEY`

Path: **Repo → Settings → Secrets and variables → Actions**.

## 3) Optional serverless endpoints (recommended)

Some datasets should **not** be fetched directly from the browser (rate limits, CORS, private tokens, heavy math).
This package includes optional serverless functions for:

### A) AMI Gap module (HUD Income Limits + ACS)
- Cloudflare Worker: `serverless/cloudflare-worker/co-ami-gap-worker.js`
- Vercel: `serverless/vercel/api/co-ami-gap.js`

**Secrets**
- `HUD_USER_TOKEN` (required)
- `CENSUS_API_KEY` (optional)

After deployment, set in `js/config.js`:
- `AMI_GAP_API_URL: "https://<your-endpoint>"`

### B) Prop 123 commitments (map overlay)
- Cloudflare Worker: `serverless/cloudflare-worker/prop123-worker.js` (endpoint `/prop123`)
- Vercel: `serverless/vercel/api/prop123.js` (endpoint `/api/prop123`)

After deployment, set in `js/config.js`:
- `PROP123_API_URL: "https://<your-endpoint>"`

If you do not deploy an endpoint, the site falls back to `data/prop123_jurisdictions.json`.

## 4) Colorado Deep Dive map verification checklist

Open `colorado-deep-dive.html` and confirm:

- Map is visible (container `#coMap` has fixed height via `site-theme.css`)
- County outlines toggle works (`Counties`)
- Places toggle works (`Places`)
- QCT + DDA overlays draw (2026 layers)
- LIHTC project points render and filters work (`Only QCT projects`, `Only DDA projects`)
- Prop 123 overlay draws when enabled (`Prop 123 Jurisdictions`)

If any overlays fail intermittently, it is usually an upstream ArcGIS availability issue. The map script times out failed layers and continues rendering the others.

## 5) Common troubleshooting

- **Map shows a blank gray box**: confirm `site-theme.css` is loaded (it sets `#coMap` height).
- **AMI module says “serverless endpoint not configured”**: set `AMI_GAP_API_URL` in `js/config.js`, or upload a cached JSON file to `data/co_ami_gap_by_county.json` and point the UI to it.
- **Prop 123 overlay empty**: deploy the Prop123 worker, or update `data/prop123_jurisdictions.json`.



## Prop 123 overlay (counties + municipalities)
The map overlay fetches a JSON payload from `APP_CONFIG.PROP123_API_URL` (recommended) or falls back to `data/prop123_jurisdictions.json`.

### Expected JSON schema
```json
{
  "updated": "2026-02-21T00:00:00Z",
  "source_url": "https://cdola.colorado.gov/commitment-filings",
  "jurisdictions": [
    {
      "name": "Boulder County",
      "kind": "county",
      "required_commitment": "…",
      "status": "Filed",
      "filing_date": "2025-09-15",
      "source_url": "https://…"
    },
    {
      "name": "City of Boulder",
      "kind": "municipality",
      "required_commitment": "…",
      "status": "Committed",
      "filing_date": "2025-10-01",
      "source_url": "https://…"
    }
  ]
}
```

### Tooltip behavior
Tooltips display the fields above when present (required commitment, status, filing date, and a source link).

### Geometry
Boundaries are pulled live from U.S. Census TIGERweb ArcGIS services:
- Places (municipalities)
- Counties
Jurisdiction names are normalized and matched to TIGER `NAME` fields.
