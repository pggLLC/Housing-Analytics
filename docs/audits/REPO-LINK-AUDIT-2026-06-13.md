# Repo-wide link audit — 2026-06-13

## Scope

- Files scanned: **2,596** text-like repo files.
- Local links checked: **4,744** HTML / Markdown links.
- External URLs checked: **2,377** unique `http(s)` URLs.
- Excluded from scanning: `.git`, `.agents`, `.codex`, `node_modules`, generated prior link-health caches, binary files, and generated inventory noise.
- External probes use HEAD first, then GET with a byte range when HEAD is blocked. Results are evidence of machine reachability, not proof that a browser user cannot access bot-protected pages.

## Summary

| Class | Result | Count |
|---|---:|---:|
| Local | ok | 4,614 |
| Local | skipped | 130 |
| External | skipped | 221 |
| External | ok | 1,629 |
| External | client_error | 228 |
| External | auth | 158 |
| External | other | 120 |
| External | timeout | 17 |
| External | server_error | 4 |

## Fixes Applied Inline

- Added `scripts/audit/repo-link-audit.mjs`, a repo-wide extractor/prober that records source file and line for each URL.
- Fixed stale GitHub Actions links in `.github/WORKFLOW_TROUBLESHOOTING.md`.
- Fixed `docs/EXAMPLE-USAGE.html` asset links to resolve from the `docs/` directory.
- Updated the home-page `All data sources` link to `dashboard-data-sources-ui.html`.
- Updated `indibuild-pipeline.html` to point at `docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md`.
- Converted the stale PMA guide commit link to an absolute GitHub commit URL.
- Renamed the stale Aspen audit package from `docs/codex-audits/0803455.md` to `docs/codex-audits/0803620.md` and updated references after the earlier Aspen/Arvada GEOID correction.
- Fixed archived page stylesheet/vendor links so `archive/*.html` no longer looks for `archive/css/...` assets.

## Local Link Result

- **0 true missing local links** remain in the comprehensive scan.
- **130 local links skipped intentionally**: same-page anchors, mailto/tel/data/javascript schemes, templates, and dynamic expressions.

## External Triage Result

- Remaining non-OK external probe results: **369**.
- Status breakdown: `client_error` 228, `other` 120, `timeout` 17, `server_error` 4.
- `auth` results are tracked in the JSON report but not counted as failures here; those are usually bot protection or credential-required resources.

### Top Failure Domains

| Host | Count | Statuses |
|---|---:|---|
| housinganalytics.pgg.llc | 21 | other |
| www.chfainfo.com | 13 | client_error:404 |
| www.monument.org | 13 | other |
| kalshi.com | 7 | client_error:429 |
| bouldercolorado.gov | 6 | client_error:404 |
| greeleygov.com | 6 | client_error:404 |
| www.vailgov.com | 6 | client_error:404 |
| api.stlouisfed.org | 5 | client_error:400 |
| coho.indibuild.com | 5 | other |
| fred.stlouisfed.org | 5 | client_error:404 |
| www.hud.gov | 5 | client_error:404 |
| www.huduser.gov | 5 | client_error:404 |
| www2.census.gov | 5 | client_error:404 |
| gis.dola.colorado.gov | 4 | client_error:404 |
| tigerweb.geo.census.gov | 4 | timeout, client_error:400 |
| www.auroragov.org | 4 | client_error:404 |
| www.denvergov.org | 4 | other, client_error:404 |
| denvergov.org | 3 | client_error:404 |
| gaftp.epa.gov | 3 | client_error:404 |
| github.com | 3 | client_error:404 |
| pitkincounty.com | 3 | client_error:404 |
| preservationdatabase.org | 3 | client_error:404 |
| www.census.gov | 3 | client_error:404 |
| www.cogs.us | 3 | client_error:404 |
| www.durangoco.gov | 3 | client_error:404 |

### Client Error Samples

- `https://apcha.org/about-us/governance/` — 404; first seen at `scripts/augment-local-resources.js:212`
- `https://api.openai.com/v1/chat/completions` — 404; first seen at `scripts/generate_policy_briefs.py:154`
- `https://api.stlouisfed.org/fred/series/observations?series_id=COBPPRIV` — 400; first seen at `js/data-source-inventory.js:985`
- `https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL` — 400; first seen at `js/data-source-inventory.js:913`
- `https://api.stlouisfed.org/fred/series/observations?series_id=CUUR0000SAH1` — 400; first seen at `js/data-source-inventory.js:931`
- `https://api.stlouisfed.org/fred/series/observations?series_id=MORTGAGE30US` — 400; first seen at `js/data-source-inventory.js:967`
- `https://api.stlouisfed.org/fred/series/observations?series_id=UNRATE` — 400; first seen at `js/data-source-inventory.js:949`
- `https://app.regrid.com/account/api` — 404; first seen at `dashboard-data-quality.html:409`
- `https://aspen.gov/DocumentCenter/View/15465/Nov-2025-TABOR-Notice-for-City-Website` — 404; first seen at `data/jurisdiction-briefs/0803620.json:216`
- `https://bouldercolorado.gov/affordable-housing` — 404; first seen at `data/tax-abatement-inventory.json:83`
- `https://bouldercolorado.gov/government/planning-board` — 404; first seen at `data/hna/local-resources.json:3484`
- `https://bouldercolorado.gov/planning/boulder-valley-comprehensive-plan-bvcp` — 404; first seen at `scripts/augment-local-resources.js:63`
- `https://bouldercolorado.gov/services/affordable-housing` — 404; first seen at `data/hna/local-resources.json:3491`
- `https://bouldercolorado.gov/services/inclusionary-housing-program` — 404; first seen at `data/tax-abatement-inventory.json:76`
- `https://bouldercolorado.gov/services/urban-renewal` — 404; first seen at `data/market/co-urban-renewal-authorities.json:52`
- `https://bouldercounty.gov/community/economy/worthy-cause/` — 404; first seen at `data/capital-partners.json:231`
- `https://coloradomtn.edu/jobs/` — 404; first seen at `data/hna/local-resources.json:244`
- `https://coloradorealtors.com/market-statistics/` — 404; first seen at `data/car-market.json:4`
- `https://coloradorealtors.com/market-trends/**` — 404; first seen at `docs/CAR_DATA_PROCESS.md:9`
- `https://coloradosprings.gov/community-development/article/affordable-housing-programs` — 404; first seen at `data/tax-abatement-inventory.json:101`

### Timeout Samples

- `https://corporate.comcast.com/` — timeout; first seen at `data/hna/local-resources.json:510`
- `https://maps.jeffco.us/arcgis/rest/services/Assessor/PublicParcels/MapServer/0` — timeout; first seen at `scripts/market/fetch_parcel_data.py:47`
- `https://maps.jeffco.us/arcgis/rest/services/Planning/` — timeout; first seen at `scripts/market/fetch_zoning.py:55`
- `https://maps.nccs.nasa.gov/mapping/rest/services/` — timeout; first seen at `scripts/market/fetch_hospitals.py:43`
- `https://stmarygj.org/` — timeout; first seen at `data/hna/local-resources.json:119`
- `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4/query` — timeout; first seen at `js/co-lihtc-map.js:644`
- `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query` — timeout; first seen at `docs/data-architecture.md:66`
- `https://www.dcha.org/` — timeout; first seen at `housing-needs-assessment.html:2367`
- `https://www.gilpincounty.org/planning-zoning` — timeout; first seen at `data/hna/local-resources.json:1665`
- `https://www.gilpincounty.org/planning-zoning/comprehensive-plan` — timeout; first seen at `data/hna/local-resources.json:1657`
- `https://www.hpe.com/` — timeout; first seen at `data/hna/local-resources.json:2221`
- `https://www.intermountainhealthcare.org/` — timeout; first seen at `data/hna/local-resources.json:1900`

### Server Error Samples

- `https://www.colorado.gov/pacific/dor/property-tax-administration` — 503; first seen at `data/tax-abatement-inventory.json:57`
- `https://www.colorado.gov/pacific/sites/default/files/15CRS39-3.pdf` — 502; first seen at `data/tax-abatement-inventory.json:18`
- `https://www.fhlbtopeka.com/community-investment/affordable-housing` — 500; first seen at `data/capital-partners.json:111`
- `https://www.ncsha.org/feed/` — 500; first seen at `.github/workflows/configure-alerts-feeds.yml:64`

### Other Fetch Failure Samples

- `https://api.kalshi.com/trade-api/v2/markets` — fetch failed; first seen at `js/data-source-inventory.js:1023`
- `https://ccncolorado.org/` — fetch failed; first seen at `scripts/augment-local-resources.js:131`
- `https://chaffeeedc.org/` — fetch failed; first seen at `data/hna/local-resources.json:837`
- `https://cholorado.org/prop-123/` — fetch failed; first seen at `data/core/educational-content.json:334`
- `https://citycountydenver-prod.adobecqms.net/content/denvergov/en/denver-office-of-economic-development/housing-neighborhoods/strong-neighborhoods.html.html` — fetch failed; first seen at `docs/codex-audits/0820000.md:175`
- `https://co.chfainfo.com/` — fetch failed; first seen at `js/hna/hna-renderers.js:2218`
- `https://co.chfainfo.com/find-a-tax-credit-property` — fetch failed; first seen at `js/components/chfa-award-history.js:129`
- `https://coho.indibuild.com/compare.html?jurisdictions=` — fetch failed; first seen at `docs/indibuild-pipeline-prototype/README.md:154`
- `https://coho.indibuild.com/deal-calculator.html?fips=` — fetch failed; first seen at `docs/indibuild-pipeline-prototype/README.md:153`
- `https://coho.indibuild.com/housing-needs-assessment.html?fips=` — fetch failed; first seen at `docs/indibuild-pipeline-prototype/README.md:151`
- `https://coho.indibuild.com/indibuild-pipeline.html` — fetch failed; first seen at `docs/CLOUDFLARE-SETUP.md:84`
- `https://coho.indibuild.com/lihtc-opportunity-finder.html` — fetch failed; first seen at `docs/indibuild-pipeline-prototype/README.md:152`
- `https://coloradospringsura.org/` — fetch failed; first seen at `data/tax-abatement-inventory.json:107`
- `https://craighospital.org/` — 307; first seen at `data/hna/local-resources.json:5156`
- `https://csbor.org/` — fetch failed; first seen at `js/colorado-regional-predictions.js:63`
- `https://data.cdot.colorado.gov/` — fetch failed; first seen at `js/data-source-inventory.js:459`
- `https://ejscreen.epa.gov/` — fetch failed; first seen at `README.md:382`
- `https://ejscreen.epa.gov/mapper/ejscreenRESTbroker.aspx` — fetch failed; first seen at `scripts/market/fetch_climate_and_environment.py:57`
- `https://engagedola.org/prop-123/news_feed/2024-commitment-filing` — fetch failed; first seen at `docs/codex-audits/0820000.md:183`
- `https://eph.org/` — fetch failed; first seen at `data/hna/local-resources.json:5428`

## Artifacts

- Machine-readable full report: `data/reports/repo-link-audit.json`.
- Audit script: `scripts/audit/repo-link-audit.mjs`.

## Recommended Follow-ups

1. Work the machine-readable `external.failures` list by source file, starting with high-repeat domains (`housinganalytics.pgg.llc`, `www.chfainfo.com`, `www.monument.org`, Boulder/Greeley/Vail municipal pages, HUD/HUDUser).
2. Move POST-only or API-key-required references into a formal allow/skip list when they are endpoint examples rather than user-facing links.
3. Replace stale local-resource and tax-abatement municipal URLs with current direct pages, not search results.
4. Add `node scripts/audit/repo-link-audit.mjs` to a periodic workflow in dry-run/no-probe mode for local-link regression detection, and keep the existing `url-health-weekly` workflow for external monitoring.
