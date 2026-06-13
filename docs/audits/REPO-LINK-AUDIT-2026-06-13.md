# Repo-wide link audit — 2026-06-13

## Scope

- Files scanned: **2,598** text-like repo files.
- Local links checked: **4,744** HTML / Markdown links.
- External URLs checked: **2,376** unique `http(s)` URLs.
- Excluded from scanning: `.git`, `.agents`, `.codex`, `node_modules`, generated prior link-health caches, generated repo-link audit Markdown, binary files, and generated inventory noise.
- External probes use HEAD first, then GET with a byte range when HEAD is blocked. Results are evidence of machine reachability, not proof that a browser user cannot access bot-protected pages.

## Summary

| Class | Result | Count |
|---|---:|---:|
| Local | ok | 4,614 |
| Local | skipped | 130 |
| External | skipped | 262 |
| External | ok | 1,651 |
| External | client_error | 198 |
| External | auth | 150 |
| External | other | 86 |
| External | timeout | 25 |
| External | server_error | 4 |

## Fixes Applied Inline

- Corrected the public sitemap from the dead `housinganalytics.pgg.llc` host to the verified live GitHub Pages deployment, `https://pggllc.github.io/Housing-Analytics/`.
- Fixed the stale GitHub Docs pull-request merge guide URL in `docs/NON_TECH_PR_MERGE_GUIDE.md`.
- Fixed the typoed GitHub Pages example URL in `docs/AUTOMATION_SETUP_GUIDE.md`.
- Tightened `scripts/audit/repo-link-audit.mjs` so generated audit Markdown, template URLs, example/test domains, POST-only API endpoints, API-key endpoints, and bot/rate-limited references are classified instead of counted as broken browser links.
- Added Cloudflare migration/security instructions and a reusable Claude QA/QC prompt for this audit class.

## Local Link Result

- **0 true missing local links** remain in the comprehensive scan.
- **130 local links skipped intentionally**: same-page anchors, mailto/tel/data/javascript schemes, templates, and dynamic expressions.

## External Triage Result

- Remaining non-OK external probe results: **313**.
- Status breakdown: `client_error` 198, `other` 86, `timeout` 25, `server_error` 4.
- `auth` results are tracked in the JSON report but not counted as failures here; those are usually bot protection or credential-required resources.
- The remaining failures are mostly stale municipal, state/federal dataset, HUD/HUDUser, CHFA, ArcGIS, and organization pages that should be replaced source-by-source with official current equivalents.

### Top Failure Domains

| Host | Count | Statuses |
|---|---:|---|
| www.chfainfo.com | 13 | client_error:404 (13) |
| www.monument.org | 13 | other (13) |
| bouldercolorado.gov | 6 | client_error:404 (6) |
| greeleygov.com | 6 | client_error:404 (6) |
| www.vailgov.com | 6 | client_error:404 (6) |
| fred.stlouisfed.org | 5 | client_error:404 (5) |
| tigerweb.geo.census.gov | 5 | timeout (3), client_error:400 (2) |
| www.hud.gov | 5 | client_error:404 (5) |
| www.huduser.gov | 5 | client_error:404 (5) |
| www2.census.gov | 5 | timeout (5) |
| gis.dola.colorado.gov | 4 | client_error:404 (4) |
| www.auroragov.org | 4 | client_error:404 (4) |
| www.denvergov.org | 4 | other (2), client_error:404 (2) |
| denvergov.org | 3 | client_error:404 (3) |
| gaftp.epa.gov | 3 | client_error:404 (3) |
| pitkincounty.com | 3 | client_error:404 (3) |
| preservationdatabase.org | 3 | client_error:404 (3) |
| www.census.gov | 3 | client_error:404 (3) |
| www.cogs.us | 3 | client_error:404 (3) |
| www.durangoco.gov | 3 | client_error:404 (3) |
| www.fcgov.com | 3 | client_error:404 (3) |
| www.pueblocounty.us | 3 | other (3) |
| www.telluride-co.gov | 3 | other (3) |
| co.chfainfo.com | 2 | other (2) |
| coloradosprings.gov | 2 | client_error:404 (2) |

### Client Error Samples

- `https://apcha.org/about-us/governance/` — 404; first seen at `scripts/augment-local-resources.js:212`
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
- `https://coloradosprings.gov/community-development/article/affordable-housing-programs` — 404; first seen at `data/tax-abatement-inventory.json:101`
- `https://coloradosprings.gov/community-development/urban-renewal` — 404; first seen at `data/market/co-urban-renewal-authorities.json:34`
- `https://communityservices.elpasoco.com/housing/` — 404; first seen at `housing-needs-assessment.html:2394`
- `https://county.pueblo.org/housing-authority` — 404; first seen at `housing-needs-assessment.html:2407`
- `https://cpw.state.co.us/learn/Pages/GIS.aspx` — 404; first seen at `scripts/market/fetch_climate_and_environment.py:338`
- `https://data.bls.gov/cew/data/api/2024/a/area/08001.json` — 404; first seen at `.github/workflows/audit-endpoints.yml:305`
- `https://demography.dola.colorado.gov/population/population-change-components/` — 404; first seen at `docs/DATA-SOURCES.md:193`
- `https://demography.dola.colorado.gov/population/population-totals-colorado-counties/` — 404; first seen at `data/hna/scenarios/baseline.json:6`

### Timeout Samples

- `https://corporate.comcast.com/` — timeout; first seen at `data/hna/local-resources.json:510`
- `https://maps.jeffco.us/arcgis/rest/services/Assessor/PublicParcels/MapServer/0` — timeout; first seen at `scripts/market/fetch_parcel_data.py:47`
- `https://maps.jeffco.us/arcgis/rest/services/Planning/` — timeout; first seen at `scripts/market/fetch_zoning.py:55`
- `https://maps.nccs.nasa.gov/mapping/rest/services/` — timeout; first seen at `scripts/market/fetch_hospitals.py:43`
- `https://stmarygj.org/` — timeout; first seen at `data/hna/local-resources.json:119`
- `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4/query` — timeout; first seen at `js/co-lihtc-map.js:644`
- `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query` — timeout; first seen at `docs/data-architecture.md:66`
- `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/2/query` — timeout; first seen at `docs/PMA_DATA_ENHANCEMENTS.md:59`
- `https://www.aurora-housing.com/` — timeout; first seen at `data/hna/local-resources.json:293`
- `https://www.crhdc.org/` — timeout; first seen at `data/hna/local-resources.json:46`
- `https://www.dcha.org/` — timeout; first seen at `housing-needs-assessment.html:2367`
- `https://www.gilpincounty.org/planning-zoning` — timeout; first seen at `data/hna/local-resources.json:1665`

### Server Error Samples

- `https://www.colorado.gov/pacific/dor/property-tax-administration` — 503; first seen at `data/tax-abatement-inventory.json:57`
- `https://www.colorado.gov/pacific/sites/default/files/15CRS39-3.pdf` — 502; first seen at `data/tax-abatement-inventory.json:18`
- `https://www.fhlbtopeka.com/community-investment/affordable-housing` — 500; first seen at `data/capital-partners.json:111`
- `https://www.ncsha.org/feed/` — 500; first seen at `.github/workflows/configure-alerts-feeds.yml:64`

### Other Fetch Failure Samples

- `https://ccncolorado.org/` — fetch failed; first seen at `scripts/augment-local-resources.js:131`
- `https://chaffeeedc.org/` — fetch failed; first seen at `data/hna/local-resources.json:837`
- `https://cholorado.org/prop-123/` — fetch failed; first seen at `data/core/educational-content.json:334`
- `https://citycountydenver-prod.adobecqms.net/content/denvergov/en/denver-office-of-economic-development/housing-neighborhoods/strong-neighborhoods.html.html` — fetch failed; first seen at `docs/codex-audits/0820000.md:175`
- `https://co.chfainfo.com/` — fetch failed; first seen at `js/hna/hna-renderers.js:2218`
- `https://co.chfainfo.com/find-a-tax-credit-property` — fetch failed; first seen at `js/components/chfa-award-history.js:129`
- `https://coloradospringsura.org/` — fetch failed; first seen at `data/tax-abatement-inventory.json:107`
- `https://craighospital.org/` — 307; first seen at `data/hna/local-resources.json:5156`
- `https://csbor.org/` — fetch failed; first seen at `js/colorado-regional-predictions.js:63`
- `https://data.cdot.colorado.gov/` — fetch failed; first seen at `js/data-source-inventory.js:459`
- `https://ejscreen.epa.gov/` — fetch failed; first seen at `README.md:382`
- `https://ejscreen.epa.gov/mapper/ejscreenRESTbroker.aspx` — fetch failed; first seen at `scripts/market/fetch_climate_and_environment.py:57`
- `https://engagedola.org/prop-123/news_feed/2024-commitment-filing` — fetch failed; first seen at `docs/codex-audits/0820000.md:183`
- `https://eph.org/` — fetch failed; first seen at `data/hna/local-resources.json:5428`
- `https://foothillsregionalhousing.org/` — fetch failed; first seen at `housing-needs-assessment.html:2363`
- `https://gis.elpasoco.com/arcgis/rest/services/Assessor/Parcels/FeatureServer/0` — fetch failed; first seen at `scripts/market/fetch_parcel_data.py:77`
- `https://gis.elpasoco.com/arcgis/rest/services/Planning/` — fetch failed; first seen at `scripts/market/fetch_zoning.py:82`
- `https://gis.larimer.org/arcgis/rest/services/Assessor/Parcels/FeatureServer/0` — fetch failed; first seen at `scripts/market/fetch_parcel_data.py:89`
- `https://gis.larimer.org/arcgis/rest/services/Planning/` — fetch failed; first seen at `scripts/market/fetch_zoning.py:91`
- `https://gis.weldgov.com/arcgis/rest/services/Assessor/Parcels/FeatureServer/0` — fetch failed; first seen at `scripts/market/fetch_parcel_data.py:83`

## Artifacts

- Machine-readable full report: `data/reports/repo-link-audit.json`.
- Audit script: `scripts/audit/repo-link-audit.mjs`.
- Cloudflare/domain migration notes: `docs/security/GODADDY-TO-CLOUDFLARE-DOMAIN-MIGRATION.md`.
- Claude QA/QC prompt: `docs/qa/CLAUDE-QA-QC-LINK-AUDIT-PROMPT.md`.

## Recommended Follow-ups

1. Work the machine-readable `external.failures` list by source file, starting with high-repeat domains: `www.chfainfo.com`, `www.monument.org`, Boulder, Greeley, Vail, HUD/HUDUser, Census, and DOLA GIS.
2. Replace stale local-resource and tax-abatement municipal URLs with current direct official pages, not search-result pages.
3. For jurisdictional-brief citations, only replace a dead source with the same official document/page or a more authoritative official source.
4. Keep `npm run audit:repo-links:probe` as a periodic external sweep and use `node scripts/audit/repo-link-audit.mjs --dry-run` for fast local regression checks that do not overwrite the probed JSON.
