# Weekly Housing Intelligence Brief

A hidden, non-indexed weekly brief system for COHO Analytics that tracks affordable housing news signals across Colorado, the Western Slope, and National markets.

---

## Where the page lives

```
https://pggllc.github.io/Housing-Analytics/private/weekly-brief/
```

This page is **not linked from site navigation** and includes `<meta name="robots" content="noindex, nofollow">` to prevent search engine indexing. It is not secured — anyone with the URL can view it.

---

## How the weekly workflow works

1. **Schedule:** `.github/workflows/weekly_housing_brief.yml` runs every Monday at 08:00 UTC.
2. **Script:** `scripts/build_weekly_brief.py` fetches RSS feeds defined in `feeds.json`.
3. **Output:** Writes to:
   - `data/latest.json` — current week's payload (loaded by `index.html`)
   - `data/archive/YYYY-MM-DD.json` — per-week JSON archive
   - `archive/YYYY-MM-DD.html` — per-week static HTML archive page
   - `data/archive-index.json` — index of all archived weeks
   - `data/signals-history.json` — rolling ~3-year signals history (156 weeks max)
4. **Commit:** The workflow commits and pushes only if there are changes.

You can also trigger the workflow manually via **Actions → Weekly Housing Intelligence Brief → Run workflow**.

---

## How to run the backfill workflow

The backfill reconstructs approximately 3 years of weekly briefs using the [GDELT 2.1 DOC API](https://blog.gdeltproject.org/gdelt-2-0-the-next-evolution/).

**Trigger manually:**
1. Go to **Actions** → **Backfill Housing Brief (GDELT)**
2. Click **Run workflow**
3. Set inputs:
   - `weeks` — number of past weeks to backfill (default: `156`)
   - `maxrecords` — max articles per GDELT query (default: `75`)
4. Click **Run workflow**

**Run locally:**
```bash
python private/weekly-brief/scripts/backfill_gdelt.py --weeks 52 --maxrecords 75
```

Use `--force` to overwrite already-generated weeks.

> **Important:** GDELT backfill is an **approximate historic reconstruction**. GDELT indexes a broad set of online news but coverage is not exhaustive and varies by time period, outlet, and geography. Do not rely on backfilled data as exact historical records.

---

## How to edit feeds and keyword rules

### RSS feeds (`feeds.json`)

Each entry in `rss_feeds` has:
- `id` — unique key
- `label` — human-readable label
- `region_hint` — `"Colorado"`, `"Western Slope"`, or `"National"`
- `url` — RSS feed URL (currently Google News RSS queries)

To add a publisher-specific feed, append a new entry and set `url` to the publisher's RSS URL.

### GDELT queries (`feeds.json → gdelt_queries`)

Used only by the backfill script. Edit the query strings under each region key.

### Signal keyword rules (`scripts/common.py → SIGNAL_KEYWORDS`)

Each signal bucket contains a list of keywords. Articles are matched case-insensitively against title + source. Edit the lists to adjust sensitivity.

### Region classification (`scripts/common.py → WESTERN_SLOPE_KEYWORDS / COLORADO_KEYWORDS`)

Edit the keyword lists to adjust region assignment. The classifier checks Western Slope first, then Colorado, then defaults to National.

---

## Files reference

| Path | Purpose |
|---|---|
| `index.html` | Client-side page, fetches `data/latest.json` + `data/archive-index.json` |
| `feeds.json` | RSS feed definitions and GDELT query strings |
| `scripts/common.py` | Shared utilities (fetch, parse, classify, signal extraction, write helpers) |
| `scripts/build_weekly_brief.py` | Weekly RSS-based updater |
| `scripts/backfill_gdelt.py` | Historic GDELT backfill |
| `data/latest.json` | Current week's brief payload |
| `data/archive-index.json` | Index of all archived weeks |
| `data/signals-history.json` | Rolling ~3-year signals history |
| `data/archive/YYYY-MM-DD.json` | Per-week JSON archive |
| `archive/YYYY-MM-DD.html` | Per-week static HTML archive page |

---

## Notes

- **No secrets required.** All data sources (Google News RSS, GDELT) are public APIs.
- **stdlib only.** Scripts use only Python standard library: `urllib`, `json`, `datetime`, `hashlib`, `xml.etree`, `pathlib`, `re`, `html`.
- **Failure-tolerant.** If one feed or query fails, the script continues with the rest.
- **Deduplication.** Articles are deduped by hashing normalized title + domain + week bucket.
