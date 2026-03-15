# Accessing Private Pages — COHO Analytics

The weekly brief is intentionally hidden from navigation and search engines. There is **no login or password** — access is by direct URL only.

---

## Weekly Housing Intelligence Brief

### Live URL

```
https://pggllc.github.io/Housing-Analytics/private/weekly-brief/
```

Open that URL in any browser to see the latest brief.

### What you'll find there

| Section | Contents |
|---|---|
| **Pills** | Current week date, total article count, generation timestamp |
| **Colorado** | Articles about Colorado affordable housing, LIHTC, housing authorities |
| **Western Slope** | Articles specific to Mesa County, Grand Junction, Eagle/Garfield/Pitkin counties, etc. |
| **National** | LIHTC finance, Fed rates, supply/costs, rent pressure & policy |
| **Signal Counts** | Keyword-hit tallies across six signal buckets |
| **Archive** | Links to all past weeks |

---

## Archive Pages

Each past week has its own static page:

```
https://pggllc.github.io/Housing-Analytics/private/weekly-brief/archive/YYYY-MM-DD.html
```

For example:
```
https://pggllc.github.io/Housing-Analytics/private/weekly-brief/archive/2026-03-09.html
```

The archive list on the main brief page links to every available week automatically.

---

## Raw JSON Data

The underlying data files are also directly accessible:

| File | URL |
|---|---|
| Latest brief | `…/private/weekly-brief/data/latest.json` |
| Archive index | `…/private/weekly-brief/data/archive-index.json` |
| Signals history | `…/private/weekly-brief/data/signals-history.json` |
| A specific week | `…/private/weekly-brief/data/archive/YYYY-MM-DD.json` |

---

## Bookmarking & Sharing

- **Bookmark** the live URL above for quick access.
- **Share** the URL directly with team members — no account is needed.
- The page will **never appear in Google** (it is marked `noindex, nofollow` and the `/private/` path is blocked in `robots.txt`), but it is **not password-protected**. Treat the URL as a low-sensitivity internal link.

---

## Keeping Data Fresh

The brief updates automatically every **Monday at 08:00 UTC** via GitHub Actions.  
To trigger an immediate update, go to:

**GitHub → Actions → Weekly Housing Intelligence Brief → Run workflow**
