# Site Audit & GIS Reliability — Housing Analytics

*Last updated: 2026-03-02*

---

## 1. Page Inventory

| Page | Main JS | Data Sources | Failure Modes | Priority |
|---|---|---|---|---|
| `index.html` | `main.js`, `dashboard.js` | FRED, Census ACS | FRED API timeout, missing `fred-data.json` | High |
| `colorado-deep-dive.html` | `co-lihtc-map.js`, `prop123-map.js`, `colorado-deep-dive.js` | CHFA ArcGIS, HUD ArcGIS, TIGERweb, `data/prop123_jurisdictions.json` | Map init race with toggle, hardcoded colors in dark mode | Critical |
| `LIHTC-dashboard.html` | `lihtc-data-loader.js` | CHFA ArcGIS, HUD ArcGIS | Network timeout, empty local file | High |
| `state-allocation-map.html` | `state-allocations-2026.js`, `national-regional-map.js` | `data/allocations.json` | Missing data file, Leaflet not loaded | High |
| `economic-dashboard.html` | `fred-cards.js`, `fred-kpi-cards.js` | FRED API | API key missing, rate limit, stale cache | Medium |
| `colorado-market.html` | `colorado-map-data.js` | Census ACS, FRED | ACS API timeout | Medium |
| `housing-needs-assessment.html` | `housing-needs-assessment.js` | `data/hna/` files | Missing HNA data, projection errors | Medium |
| `market-intelligence.html` | `market-intelligence.js` | Census ACS, HUD ArcGIS, OpenStreetMap | Network timeouts on public APIs | Medium |
| `regional.html` | `regional.js` | Census, FRED | API timeout | Low |
| `dashboard.html` | `dashboard.js` | FRED | API timeout | Low |

---

## 2. Map Pages Inventory

| Map Container | Global Var | Overlays | External Dependencies |
|---|---|---|---|
| `#coMap` (colorado-deep-dive) | `window.coLihtcMap` | LIHTC, DDA, QCT, Prop 123 | Leaflet, CHFA ArcGIS, TIGERweb, `data/prop123_jurisdictions.json` |
| `#map` (state-allocation-map) | `window.stateMap` | State allocation circles | Leaflet, `data/allocations.json`, `data/states-10m.json` |
| `#nationalMap` (index/regional) | `window.nationalMap` | Regional LIHTC density | Leaflet, HUD ArcGIS |

---

## 3. GIS Reliability Checklist

### 3.1 Base Path Handling
- [x] `path-resolver.js` exposes `resolveAssetUrl()` / `DataService.baseData()` for GitHub Pages sub-path support
- [x] `co-lihtc-map.js` uses `resolveAssetUrl()` for vendor icon paths
- [x] All local data files now loaded via `DataService.baseData()` — no raw fetch paths remain

### 3.2 Fetch Helpers & Timeouts
- [x] `fetch-helper.js` provides `fetchWithTimeout()` utility
- [x] `co-lihtc-map.js` wraps all fetches with 15 s timeout
- [x] `prop123-map.js` uses `AbortController` with 20 s timeout and exponential-backoff retry

### 3.3 Retry Logic
- [x] `prop123-map.js` retries failed requests up to 2 times with exponential backoff
- [x] `prop123-map.js` retries detecting `window.coLihtcMap` up to 10 × 200 ms after DOMContentLoaded

### 3.4 Fallbacks
- [x] `co-lihtc-map.js` falls back: local file → CHFA ArcGIS → HUD ArcGIS → embedded stub
- [x] `colorado-deep-dive.js` falls back: configured API URL → `data/prop123_jurisdictions.json`
- [x] `prop123-map.js` falls back: configured API URL → `data/prop123_jurisdictions.json`

### 3.5 Error Surfaces
- [x] Map status text element `#mapStatus` updated with user-visible messages
- [x] `#prop123Status` shows loading state, feature count, or error message
- [x] `#prop123TableBody` renders error row when data is unavailable

### 3.6 Caching
- [x] `colorado-deep-dive.js` provides `cacheGet` / `cacheSet` with TTL via `localStorage`
- [ ] GIS data layers are not yet cached between sessions — consider adding TTL cache for TIGERweb responses

---

## 4. Proposition 123 Status

**Status:** ✅ Fixed (2026-03-02)

- `#prop123TableBody` now populates from `data/prop123_jurisdictions.json` on GitHub Pages without requiring a serverless API
- `colorado-deep-dive.js` calls `initProp123Section()` at DOMContentLoaded if the policy tab is already active (e.g. via `#tab-policy-simulator` deep link)
- `prop123-map.js` waits up to 2 seconds for `window.coLihtcMap` before giving up
- Status element `#prop123Status` shows "Loaded N features" on success

---

## 5. County Boundary Visibility

**Status:** ✅ Fixed (2026-03-02)

- CSS variables `--map-boundary-stroke` and `--map-boundary-weight` added to `css/site-theme.css`
- Light mode: `rgba(15, 23, 42, 0.55)` — dark slate with 55 % opacity
- Dark mode: `rgba(248, 250, 252, 0.50)` — near-white with 50 % opacity
- Map overlays should read these variables at render time; a theme-change `MutationObserver` is recommended to restyle layers on toggle

---

## 6. Prioritized Recommendations

1. **CRITICAL — Prop 123 overlay toggle**: Verify `#layerProp123` checkbox wires correctly in dark mode and hash-linked navigation
2. **HIGH — Remove hardcoded colors**: All `style="color: #0f172a"` instances replaced with `color: var(--text)` in `colorado-deep-dive.html`
3. ~~**HIGH — DataService path usage**: Audit raw data-path fetch calls in `co-lihtc-map.js`~~ ✅ Fixed — all local data files now load via `DataService.baseData()`
4. **MEDIUM — TIGERweb cache**: Add a 24-hour TTL cache for TIGERweb GeoJSON responses to reduce network round-trips
5. **MEDIUM — Map boundary observer**: Wire a `MutationObserver` on `<html>` class changes to restyle county boundary layers when theme toggles
6. **LOW — Link validation**: Run the automated link checker (test/validate-links.js) in CI to catch broken hrefs before deploy
