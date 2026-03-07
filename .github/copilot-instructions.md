# Housing Analytics — Copilot Workspace Governance Rules

These 18 rules are derived from 30 confirmed production bugs discovered and
fixed across Stages 1–3 of the Solutions Architecture audit. Every rule is
traceable to one or more bug IDs so that future reviewers can audit the
rationale. Rules apply to all AI-assisted code generation in this workspace.

---

## Data Integrity Rules (Stage 1)

### Rule 1 — FIPS codes must always be 5-digit strings
**Root cause:** Bug S1-01 — `co_ami_gap_by_county.json` stored Ouray County
FIPS as `"091"` (3 digits) instead of `"08091"`, breaking every county-level
join with CHFA-LIHTC data. Bug S1-06 — Ouray County was entirely absent from
AMI gap results because the malformed FIPS key never matched. Bug S1-09 —
cross-file FIPS joins silently returned empty result sets whenever a 3-digit
code was compared to a 5-digit code.

**Enforcement:** All JSON fields that hold a Colorado county FIPS code must be
5-character strings (`"08001"`…`"08125"`). Never write bare 3-digit codes such
as `"001"`. Use `str(fips).zfill(5)` in Python and `.padStart(5, '0')` in JS.
The pre-commit check rejects any JSON file whose county FIPS array contains a
value with `len != 5`.

---

### Rule 2 — Data file fields must not be null for required attributes
**Root cause:** Bug S1-02 — `ami_4person` was `null` for several counties,
causing division-by-zero in affordability ratio calculations. Bug S1-03 —
`LI_UNITS` exceeded `N_UNITS` in LIHTC records where a data-entry error
swapped the two columns. Bug S1-04 — `CREDIT`, `NON_PROF`, and `DDA` fields
were `null` in 47 LIHTC features, rendering compliance-dashboard filters
inoperative.

**Enforcement:** Required numeric fields (`ami_4person`, `LI_UNITS`, `N_UNITS`,
`CREDIT`, `NON_PROF`, `DDA`) must never be `null` or omitted. ETL scripts must
validate and backfill with `0` (integer) or `"U"` (unknown string) before
writing JSON. Add a null guard in every data-fetch script's normalization pass.

---

### Rule 3 — Projection `baseYear` / `pyramidYear` must equal the current data vintage
**Root cause:** Bug S1-05 — 64 DOLA SYA county files shipped with
`pyramidYear: 2030` (a planning horizon year) instead of `2024` (the actual
data vintage), making every displayed age pyramid wrong by 6 years. Bug S2-06
— `build_hna_data.py` wrote `baseYear: 2030` in projection output files,
causing the HNA dashboard to display stale forward projections as if they were
base data. Bug S2-08 — `projections/*.json` and `dola_sya/*.json` disagreed on
`baseYear`, producing inconsistent charts on the same page.

**Enforcement:** Set `baseYear` and `pyramidYear` to `2024` in all current
data files. Update both constants simultaneously whenever the data vintage
advances. The pre-commit check rejects SYA or projection files whose
`pyramidYear`/`baseYear` is not `2024`.

---

### Rule 4 — Colorado county coverage must be exactly 64 counties
**Root cause:** Bug S1-07 — Amenity GeoJSON stub files were checked in with 0
features, causing the map layer to silently render nothing. Bug S2-07 —
`lihtc-trends-by-county.json` was missing 12 counties (only 52 of 64 present),
causing blank sparklines for those counties in the LIHTC dashboard.

**Enforcement:** Any data file that claims statewide Colorado county coverage
must include all 64 counties. Amenity GeoJSON files must contain at least one
real feature; stub files must not be committed. The pre-commit check verifies
`lihtc-trends-by-county.json` carries exactly 64 county keys.

---

### Rule 5 — `data/manifest.json` must be regenerated whenever data files change
**Root cause:** Bug S1-08 — `data/manifest.json` was not updated after a batch
of new data files were added, so the service worker served stale cached
responses to clients who had already visited the site.

**Enforcement:** Run `python scripts/rebuild_manifest.py` as the final step of
every data-update workflow. The pre-commit check fails if the manifest
`generated` timestamp is older than 30 days, or if the file count is below
100 entries.

---

## Temporal Logic Rules (Stage 2)

### Rule 6 — FRED series must have complete metadata fields
**Root cause:** Bug S2-01 — Several FRED series in `fred-data.json` had blank
`title`, `units`, `frequency`, `category`, and `seasonal_adjustment` fields
because the fetch script silently accepted HTTP 200 responses that returned
partial data. Tooltip cards showed empty labels in the Economic Dashboard.

**Enforcement:** Every FRED series object must carry a non-empty `name` field
and at least one observation. Downstream code that reads `title` must fall back
to `name`. The fetch script must reject any series whose `name` is blank.

---

### Rule 7 — FRED temporal continuity must have no gaps larger than 35 days
**Root cause:** Bug S2-02 — Five commodity PPI series (`WPUFD4`,
`PCU236115236115`, `PCU331111331111`, `PCU3313153313153`, `PCU32731327313`)
were stored with zero observations after the fetch script hit a 429 rate-limit
and silently wrote an empty array. Bug S2-03 — CPIAUCSL, CUUR0000SAH1, UNRATE,
and CIVPART were missing the October 2025 observation, creating a 61-day gap;
the interpolated midpoint was not written.

**Enforcement:** All monthly FRED series must have observations with no gap
exceeding 35 days. Any series that arrives empty must trigger an alert rather
than being stored. When interpolating a missing month, write the linear
midpoint explicitly to the JSON file.

---

### Rule 8 — CAR market report fields must never be null
**Root cause:** Bug S2-04 — `car-market-report-2026-02.json` statewide
`median_sale_price`, `active_listings`, and five other required fields were
`null` when the CAR PDF parser failed silently. Bug S2-05 — Metro area records
for `boulder` and `pueblo` had `null` in all seven required fields.

**Enforcement:** All eight statewide fields and all seven metro-area fields
defined in the CAR report schema must be non-null numbers. ETL scripts must
fail loudly (non-zero exit) if any required field is absent or null.

---

## GIS / Projection Rules

### Rule 9 — Every ArcGIS FeatureServer query must include `outSR=4326`
**Root cause:** Bug S3-07 — ArcGIS FeatureServer responses default to
Web Mercator (EPSG:3857), not WGS84. Without `outSR=4326`, map layers were
plotted in metre-units instead of degrees, shifting all LIHTC markers by
thousands of miles.

**Enforcement:** Every ArcGIS REST query string or params object must include
`outSR: '4326'` (object) or `outSR=4326` (query string). The pre-commit check
scans `js/*.js` for ArcGIS query strings containing `f=geojson` that lack
`outSR=4326`.

---

## Accessibility Rules (Stage 3 — WCAG 2.1 AA)

### Rule 10 — Chart colors must use the approved WCAG AA token palette
**Root cause:** Bug S3-01 — Eight inline hex codes were hardcoded across six
HTML files: `#6c7a89` (2.6:1), `#3498db` (3.5:1), `#27ae60` (2.5:1),
`#d4a574` (1.9:1), `#e4b584` (2.1:1), `#2ecc71` (2.4:1), `#f39c12` (2.8:1),
`#c0392b` (3.4:1) — all failing WCAG 1.4.3 (minimum 4.5:1 on white).

**Enforcement:** Use only `var(--chart-1)` through `var(--chart-7)` tokens
defined in `css/site-theme.css`. Never hardcode hex colors in chart
`backgroundColor` arrays. The pre-commit check rejects any HTML file containing
the eight known failing hex codes.

---

### Rule 11 — Dynamic content updates must use aria-live regions
**Root cause:** Bug S3-03 — Filter dropdowns on Dashboard, CRA Analysis,
Construction Commodities, and CHFA Portfolio updated chart data without
announcing the change to screen-reader users, violating WCAG 4.1.3 (Status
Messages).

**Enforcement:** Every interactive page that updates chart data via a user
control must contain an `aria-live="polite"` region with `aria-atomic="true"`,
and call `window.__announceUpdate(message)` in the update handler. The
pre-commit check verifies that pages with `<canvas>` elements also contain
`aria-live`.

---

### Rule 12 — HTML pages must have the full landmark structure
**Root cause:** Bug S3-04 — Six pages (`cra-expansion-analysis.html`,
`dashboard.html`, `construction-commodities.html`, `chfa-portfolio.html`,
`compliance-dashboard.html`, `regional.html`) lacked `<main>`, `<header>`,
and `<footer>` landmarks, making keyboard and screen-reader navigation
impossible.

**Enforcement:** Every HTML page must include `<header>`, `<main
id="main-content">`, and `<footer>` elements. Skip-navigation links targeting
`#main-content` must appear as the first focusable element. The pre-commit
check scans all root-level HTML files for the presence of `<main`.

---

### Rule 13 — `--accent` token value must be `#096e65` for WCAG AA
**Root cause:** Bug S3-05 — The CSS variable `--accent` was set to `#0a7e74`
(4.4:1 contrast ratio on `--bg #eef2f7`) in the original theme, barely below
the 4.5:1 WCAG AA threshold. It was corrected to `#096e65` (4.51:1) in Stage 3.

**Enforcement:** The `--accent` token in `css/site-theme.css` must remain
`#096e65`. Never revert to `#0a7e74` or any other value. The pre-commit check
reads the CSS file and asserts the exact hex value.

---

### Rule 14 — Touch targets must be at least 44 × 44 CSS pixels
**Root cause:** Bug S3-06 — Radio-button labels for housing-type filters and
dot-plot indicators were rendered at 20 × 20 px, below the WCAG 2.5.5 minimum.
Users on touch devices frequently missed the target.

**Enforcement:** Interactive labels, checkbox wrappers, and dot-plot targets
must use the `.dot-wrap` class (or equivalent) that enforces `min-height: 44px`
and `min-width: 44px`. Do not override these minimums in page-level styles.

---

### Rule 15 — Canvas elements must have `role="img"` and `aria-label`
**Root cause:** Bug S3-02 — All 18 Chart.js `<canvas>` elements across six
pages were missing `role="img"` and `aria-label`, making every chart invisible
to screen readers (WCAG 1.1.1 — Non-text Content).

**Enforcement:** Every `<canvas>` element must declare `role="img"` and a
descriptive `aria-label` that names the chart. Companion `<p class="sr-only">`
summaries should follow each canvas for additional detail. The pre-commit check
scans all HTML files for bare canvas tags.

---

### Rule 16 — Skip-navigation links must target `#main-content`
**Root cause:** Bug S3-08 — Pages that were retrofitted with `<main>` used
`id="main"` while the skip link href was `#main-content`, creating a broken
link for keyboard users on every page.

**Enforcement:** The skip-navigation anchor must use `href="#main-content"` and
the `<main>` element must carry `id="main-content"`. Both attributes must be
kept in sync. Prefer the pattern already established in `index.html`.

---

## Cloudflare Worker Rules

### Rule 17 — Cloudflare Workers must always send CORS headers and use `ctx.waitUntil` for cache writes
**Root cause:** Bug CW-01 — An early version of `cloudflare-worker.js` returned
500 responses without CORS headers, causing browsers to report an opaque network
error instead of a useful JSON error. Bug CW-02 — Cache `.put()` calls were
awaited inline instead of being dispatched with `ctx.waitUntil()`, blocking the
response by 50–200 ms on cache misses.

**Enforcement:** Every `Response` returned from a Worker handler must pass
through the `json()` helper which calls `withCorsHeaders(env)`. Cache writes
must use `ctx.waitUntil(cache.put(...))` — never `await cache.put(...)` in the
hot path. Do not add new routes without adding them to the `/health` route list.

---

### Rule 18 — ETL output files must preserve sentinel metadata keys
**Root cause:** Bug S2-09 — A refactor of `fetch-fred-data.yml` replaced the
top-level `fred-data.json` object with a bare `series` array, silently dropping
the `updated` timestamp. The dashboard's freshness indicator showed "—" for
several weeks. Bug S1-10 — `chfa-lihtc.json` lost its `fetchedAt` timestamp
after a schema migration, breaking the "last refreshed" label.

**Enforcement:** ETL output files must preserve the following top-level sentinel
keys verbatim:
- `fred-data.json` → `updated` (ISO-8601 UTC string)
- `chfa-lihtc.json` → `fetchedAt` (ISO-8601 UTC string)
- `co_ami_gap_by_county.json` → `meta` (object with `generated` field)
- `data/manifest.json` → `generated` (ISO-8601 UTC string)

Never strip or rename these keys during schema migrations. The pre-commit check
verifies their presence in each file.
