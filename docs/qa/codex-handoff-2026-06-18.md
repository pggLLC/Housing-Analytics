# Codex Handoff — cohoanalytics.com: search, SEO, cleanup

_Date: 2026-06-18 · internal QA doc (excluded from the public artifact)._

**State going in (verified live 2026-06-18):**

- ✅ Domain cutover **live** — `cohoanalytics.com` serves GitHub Pages over HTTPS (DNS at Wix, custom domain connected, HTTPS enforced).
- ✅ **Deploy outage fixed** (#977). It had silently failed ~1h: #975 changed `robots.txt`'s sitemap line, but `test/pages-availability-check.js` (which runs *inside* `deploy.yml`) pinned the old github.io URL. Canonical `sitemap.xml`/`robots.txt` are now live on the domain.
- ✅ **PRs triaged 11 → 5:** merged #975/#970/#967/#977; closed #964/#971/#961; rebased dependabot #966/#968/#969. phase-2 rename is merged.

Do these in order of impact.

## Phase 1 — 🔍 Place search (highest user impact)

**Goal:** typing a place ("Silt, Colorado") navigates to all analytics for that place.

**Exact data path (exists):**

- **Index:** `data/co-place-centroids.json` → `byGeoid["<geoid>"] = { name, lat, lng }`, **482 CO places**.
- **Result page:** `places/<geoid>.html` — the per-place "COHO Place Profile." Silt = `places/0870195.html`. It already links onward to `housing-needs-assessment.html?type=place&geoid=<geoid>`, `market-analysis.html`, `deal-calculator.html` — so it *is* "all analytics on Silt."

**⚠️ Required 404 guard (QA-verified):** only **464 of the 482** index places have a profile page — **18 would 404** (`Aetna Estates CDP`, `Air Force Academy CDP`, `Alamosa East CDP`, `Bonanza town`, …). **Filter the index to geoids where `places/<geoid>.html` exists.** Best: have the build emit a `places-search-index.json` containing only the 464 real pages (Node `fs.existsSync`).

**Build:**

1. `js/place-search.js`: load the filtered index, build name→geoid map, render an accessible combobox (ARIA + keyboard nav). On select → `location.href = 'places/<geoid>.html'` (path-relative).
2. **Normalize names** — index names carry Census suffixes (`Silt town`, `Acres Green CDP`, `Aguilar town`). Strip ` town| city| CDP| village| municipality` and trailing `, CO`/`Colorado` so "Silt" matches. Prefix + light fuzzy.
3. **Placement:** `index.html` hero + the existing `places/index.html` directory, and ideally global nav. (`js/geo-search.js` exists but is lat/lng geocoding via Nominatim — different; don't reuse.)
4. **Test:** unit-test the resolver — `"Silt, Colorado" → 0870195`, suffix/whitespace variants, and that a no-page place (e.g. `Air Force Academy CDP`) is excluded.

## Phase 2 — 🗺️ Auto-generate the sitemap (high SEO)

`sitemap.xml` is a hand-maintained **21-URL** file with frozen `lastmod`; it omits all **464 place profiles** and most tool pages. Generate `dist/sitemap.xml` in `scripts/build-public-site.mjs` from the built public HTML: include the 464 place profiles + the `places/index.html` directory + main pages; **exclude `places/_template.html`, redirect stubs, and `404.html`**; real `lastmod`; `https://cohoanalytics.com/` URLs.

> ⚠️ **Deploy-gate trap:** `test/pages-availability-check.js` runs inside `deploy.yml`. A pinned sitemap assertion there is exactly what broke deploys in #975→#977. Relax/update any assertion pinning exact sitemap URLs/counts, then run `node test/pages-availability-check.js` **+** `npm run build:public` **+** `npm run audit:public-artifact` before merge.

## Phase 3 — 🏷️ Structured data + meta (SEO)

- JSON-LD `Organization` + `WebSite` in `index.html` (brand "COHO Analytics", `https://cohoanalytics.com`, logo `assets/og-image.png` — confirmed present).
- `Place`/`Dataset` JSON-LD on place profiles.
- Audit every page for unique `<title>` + meta description + self-referential canonical (homepage & place pages already good).

## Phase 4 — 🛡️ Deploy reliability

Deploys failed silently for an hour. Finish/merge **#974** (hardens `audit-and-docs`) and make `pages-deploy-watchdog.yml` flag a *failed* `deploy.yml` run, not just a missing one. Stop pinning exact URLs in the deploy-gate tests so a `robots.txt`/`sitemap.xml`/`CNAME` edit can't break deploys again.

## Phase 5 — 🧹 Finish PR triage

- **#976** (docs runbook, `MERGEABLE/UNSTABLE`): blocked only by the bogus `ci-checks` "source URL sweep" — it hard-fails probing `https://pggllc.github.io/` (404 bare root) and `…/Housing-Analytics/` (now 301). Fix the sweep to tolerate 3xx + the old host, then merge.
- **#966 / #968** (dependabot, just rebased — recomputing): merge once `ci-checks` is green.
- **#969** (`nodemailer` 8→9 major): it's a **devDependency** used only in `test/` audit/monitoring scripts (`daily-audit-system.js`, `send-test-email.js`, `audit-modules/report-generator.js`, `website-monitor-enhanced.js`) — **not production**. Verify those against the v9 API, then merge.

## Phase 6 — 👤 Owner actions (not Codex)

- **Google Search Console** — add `cohoanalytics.com`, verify via **DNS TXT in Wix**, submit `https://cohoanalytics.com/sitemap.xml`, Request Indexing on homepage + key pages. Repeat in Bing. *This is the #1 discoverability lever; Phases 1–3 maximize what the crawl finds.*
- Optional: set `CORS_ORIGIN=https://cohoanalytics.com` on the Workers (live serverless data path; cached-JSON fallback works without it). Cancel the Wix **site plan**, keep the **domain**.
