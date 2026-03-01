# Serverless Demographics & HUD Markets Setup

This guide covers deploying the Colorado Demographics and HUD Markets endpoints on both
**Cloudflare Workers** and **Vercel**.

---

## Endpoints

| Path | Description |
|---|---|
| `GET /co-demographics` | CO State Demography Office — population, housing, and migration forecasts |
| `GET /hud-markets` | HUD User API — market characteristics and outlook for CO metro areas |

---

## 1. Colorado Demographics Worker (`/co-demographics`)

### What it does

Fetches data from the [Colorado State Demography Office GIS API](https://gis.dola.colorado.gov/population/):
- Population forecasts by county (2025–2050)
- Housing unit forecasts by county
- Net migration by region

If the SDO API is unavailable the worker returns embedded fallback data so the endpoint
is always operational.

### Response shape

```json
{
  "ok": true,
  "source": "Colorado State Demography Office",
  "timestamp": "2026-02-23T03:25:00.000Z",
  "usedFallback": false,
  "data": {
    "populationForecast": [
      { "county": "Denver", "fips": "031", "forecasts": [{ "year": 2025, "population": 730000 }] }
    ],
    "housingForecast": [
      { "county": "Denver", "fips": "031", "forecasts": [{ "year": 2025, "units": 355000 }] }
    ],
    "migration": [
      { "region": "Denver Metro", "netMigration2020": 18500, "netMigration2023": 12800 }
    ]
  }
}
```

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CO_DEMO_CACHE_SECONDS` | No | `604800` | Edge cache TTL in seconds (7 days) |
| `CORS_ORIGIN` | No | `*` | Value for `Access-Control-Allow-Origin` header |

No API key is required — the CO SDO data portal is publicly accessible.

---

## 2. HUD Markets Worker (`/hud-markets`)

### What it does

Fetches HUD Fair Market Rents and Income Limits for Colorado metro areas via the
[HUD User API](https://www.huduser.gov/portal/dataset/fmr-api.html) and returns
enriched market-analysis objects with characteristics and demand/supply forecasts.

Falls back to embedded data when the HUD API is unavailable.

### Query parameters

| Param | Default | Description |
|---|---|---|
| `state` | `CO` | Two-letter state code |

### Response shape

```json
{
  "ok": true,
  "source": "HUD User",
  "timestamp": "2026-02-23T03:25:00.000Z",
  "state": "CO",
  "usedFallback": false,
  "markets": [
    {
      "region": "Denver-Aurora-Lakewood",
      "cbsa": "19740",
      "characteristics": {
        "medianHouseholdIncome": 85000,
        "medianGrossRent": 1750
      },
      "forecast": {
        "demandOutlook": "tight",
        "supplyOutlook": "improving",
        "newUnitsNeeded": 28000
      }
    }
  ]
}
```

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `HUD_USER_TOKEN` | **Yes** | — | HUD USER API Bearer token |
| `CO_DEMO_CACHE_SECONDS` | No | `604800` | Edge cache TTL in seconds |
| `CORS_ORIGIN` | No | `*` | Value for `Access-Control-Allow-Origin` header |

---

## Deploying to Cloudflare Workers

### Individual workers (recommended for simplicity)

Deploy each worker file independently:

```bash
# Colorado Demographics
wrangler deploy serverless/cloudflare-worker/colorado-demographics-worker.js \
  --name co-demographics-worker \
  --compatibility-date 2024-01-01

# HUD Markets
wrangler deploy serverless/cloudflare-worker/hud-markets-worker.js \
  --name hud-markets-worker \
  --compatibility-date 2024-01-01
```

### Unified router (all endpoints in one worker)

Alternatively, deploy `cloudflare-worker.js` to serve all four endpoints
(`/co-ami-gap`, `/prop123`, `/co-demographics`, `/hud-markets`) from a single worker:

```bash
wrangler deploy serverless/cloudflare-worker/cloudflare-worker.js \
  --name housing-analytics-api \
  --compatibility-date 2024-01-01
```

### Adding secrets to Cloudflare

```bash
# Required for /hud-markets (and /co-ami-gap)
echo "YOUR_HUD_TOKEN_HERE" | wrangler secret put HUD_USER_TOKEN

# Optional: override cache TTL
wrangler secret put CO_DEMO_CACHE_SECONDS   # enter value when prompted

# Optional: restrict CORS to a specific origin
wrangler secret put CORS_ORIGIN             # e.g. https://your-site.com
```

---

## Deploying to Vercel

### File locations

| Endpoint | File |
|---|---|
| `/api/co-demographics` | `serverless/vercel/api/co-demographics.js` |
| `/api/hud-markets` | `serverless/vercel/api/hud-markets.js` |

### Deploy

```bash
cd serverless/vercel
vercel deploy
```

Or link the `serverless/vercel` directory as a Vercel project and push — Vercel will
auto-detect the `api/` directory and create serverless functions automatically.

### Adding environment variables to Vercel

Via the Vercel dashboard:
1. Go to **Project Settings → Environment Variables**
2. Add `HUD_USER_TOKEN` (required for `/api/hud-markets`)
3. Optionally add `CO_DEMO_CACHE_SECONDS` (default: `604800`)

Via the Vercel CLI:

```bash
vercel env add HUD_USER_TOKEN production
vercel env add CO_DEMO_CACHE_SECONDS production  # optional
```

---

## Testing

### Cloudflare (local dev)

```bash
# Start local dev server
wrangler dev serverless/cloudflare-worker/colorado-demographics-worker.js --port 8787

# In another terminal
curl http://localhost:8787/co-demographics | jq .
curl http://localhost:8787/hud-markets | jq .
```

### Vercel (local dev)

```bash
cd serverless/vercel
HUD_USER_TOKEN=your_token vercel dev

curl http://localhost:3000/api/co-demographics | jq .
curl http://localhost:3000/api/hud-markets | jq .
```

### Validate response structure

A successful response will have `"ok": true`. If the upstream API was unreachable,
`"usedFallback": true` will be set, but all required fields will still be present.

```bash
# Quick smoke test
curl -s https://your-worker.workers.dev/co-demographics | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert d['ok'], 'ok must be true'
assert 'data' in d, 'data key missing'
assert len(d['data']['populationForecast']) > 0, 'populationForecast is empty'
print('✅ co-demographics OK — usedFallback:', d.get('usedFallback'))
"

curl -s https://your-worker.workers.dev/hud-markets | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert d['ok'], 'ok must be true'
assert 'markets' in d, 'markets key missing'
assert len(d['markets']) > 0, 'markets list is empty'
print('✅ hud-markets OK — usedFallback:', d.get('usedFallback'))
"
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `"usedFallback": true` on every request | CO SDO or HUD API unreachable from the worker | Check network / firewall; data is still served from fallback |
| `{"ok":false,"error":"Missing HUD_USER_TOKEN secret"}` | Secret not set | Run `wrangler secret put HUD_USER_TOKEN` |
| `HUD API 401` in worker logs | Token expired or invalid | Obtain a new token at [huduser.gov](https://www.huduser.gov/portal/home.html) |
| CORS errors in browser | `CORS_ORIGIN` set to wrong value | Set to `*` or your exact origin (e.g. `https://yourdomain.com`) |
| Stale data after a code change | Old response in edge cache | Purge via Cloudflare dashboard → Caching → Purge Everything |
