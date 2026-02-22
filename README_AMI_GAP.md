# Colorado AMI Gap Module (Households vs Priced-Affordable Units)

This repo update adds a front-end module on `colorado-deep-dive.html` that visualizes:

- Households (ACS B19001) at/under %AMI thresholds
- Renter units priced-affordable by gross rent (ACS B25063) at/under the corresponding affordable rent thresholds
- Gap = units - households, and coverage ratio

## Why serverless?
Do **not** call HUD/Census directly from the browser:
- keeps API tokens private (HUD USER token)
- avoids CORS/rate-limit issues
- allows caching (daily/weekly)

The front-end module fetches a **single JSON** from:
- `window.APP_CONFIG.AMI_GAP_API_URL` (preferred), or
- `data/co_ami_gap_by_county.json` (fallback placeholder)

## Deploy option A: Cloudflare Worker
File:
- `serverless/cloudflare-worker/co-ami-gap-worker.js`

1) Create a Worker
2) Set secrets:
- `HUD_USER_TOKEN` (required)
- `CENSUS_API_KEY` (optional)
3) Route: `/co-ami-gap`
4) Update `js/config.js`:
```js
AMI_GAP_API_URL: "https://YOUR_WORKER_SUBDOMAIN.workers.dev/co-ami-gap"
```

## Deploy option B: Vercel
File:
- `serverless/vercel/api/co-ami-gap.js`

1) Import repo into Vercel
2) Set env vars:
- `HUD_USER_TOKEN`
- `CENSUS_API_KEY` (optional)
3) Your endpoint will be:
- `https://YOUR_APP.vercel.app/api/co-ami-gap`

Then set `AMI_GAP_API_URL` to that.

## Data notes
- HUD Income Limits: uses `median_income` (AMI) from `/il/data/{entityid}?year=2025` per county entityid.
- ACS 5-year year is configurable (default in serverless code is 2023).
- “Affordable units” are **priced-affordable** by rent, not guaranteed vacant/available units.
