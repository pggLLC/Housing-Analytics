# Alerts & Policy Briefs Pipeline

**Status:** Implemented · Seeded · Manual activation required  
**Last reviewed:** 2026-03

---

## Overview

The alerts pipeline collects housing news from RSS feeds and generates
AI-assisted policy brief summaries. The pipeline is fully implemented and
seeded with valid empty-state JSON files. It is not yet automated via GitHub
Actions in the current repository configuration — activation requires
configuring feed URLs and running the scripts manually or scheduling them.

---

## Components

| Component | File | Status |
|-----------|------|--------|
| Feed fetcher | `scripts/fetch_google_alerts.py` | ✅ Production-ready |
| Feed URL list | `scripts/alert_feeds.txt` | ✅ Template created (no live feeds yet) |
| Alert archive | `data/alerts/alerts_archive.json` | ✅ Seeded (empty, valid schema) |
| Brief generator | `scripts/generate_policy_briefs.py` | ✅ Production-ready |
| Brief output | `data/policy_briefs.json` | ✅ Seeded (empty, valid schema) |
| Brief display | `policy-briefs.html` | ✅ Graceful empty-state message |

---

## Step 1 — Configure RSS Feed URLs

Open `scripts/alert_feeds.txt` and add one RSS feed URL per line.
Lines starting with `#` are comments and are ignored.

**How to create a Google Alerts RSS feed:**
1. Go to [google.com/alerts](https://www.google.com/alerts)
2. Create an alert (e.g. `"Colorado affordable housing"`)
3. Set **Deliver to:** → **RSS feed**
4. Copy the feed URL and paste it into `scripts/alert_feeds.txt`

**Example `alert_feeds.txt` entry:**
```
https://www.google.com/alerts/feeds/1234567890/abcdefghij
```

Alternatively, set the `ALERT_FEEDS` environment variable to a comma-separated
list of RSS URLs — this overrides the file.

---

## Step 2 — Run the Alert Fetcher

```bash
python3 scripts/fetch_google_alerts.py
```

The script reads `scripts/alert_feeds.txt`, fetches each feed, deduplicates
items against the existing archive, and writes the result to
`data/alerts/alerts_archive.json`.

**Environment variables (all optional):**

| Variable | Default | Description |
|----------|---------|-------------|
| `ALERT_FEEDS` | — | Comma-separated feed URLs (overrides alert_feeds.txt) |
| `ALERT_FEEDS_FILE` | `scripts/alert_feeds.txt` | Path to the feed URL file |
| `ALERTS_MAX_AGE_DAYS` | `90` | Prune alerts older than this many days |

---

## Step 3 — Generate Policy Briefs

After alerts are collected, run:

```bash
python3 scripts/generate_policy_briefs.py
```

The script reads `data/alerts/alerts_archive.json`, groups alerts by policy
topic, and writes structured summaries to `data/policy_briefs.json`.

**LLM-assisted summaries (optional):** Set `OPENAI_API_KEY` in the environment
to enable GPT-4o-mini summaries. Without the key, rule-based summaries are
generated automatically.

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | Enables LLM-assisted brief generation |
| `BRIEFS_MAX` | `20` | Maximum number of briefs to generate |

---

## What "Empty but Healthy" Looks Like

The seed files (`data/alerts/alerts_archive.json` and `data/policy_briefs.json`)
contain valid JSON with an empty `alerts` / `briefs` array. This is the correct
initial state — not an error.

**`data/alerts/alerts_archive.json` (seeded state):**
```json
{
  "meta": {
    "generated": "2026-03-15T00:00:00Z",
    "feed_count": 0,
    "alert_count": 0,
    "max_age_days": 90
  },
  "alerts": []
}
```

**`policy-briefs.html` empty-state message:**  
When no briefs exist, the page displays:
> "No policy briefs available yet. Briefs are generated automatically from
> housing news alerts. Configure RSS feeds in `scripts/alert_feeds.txt` to
> activate."

This is expected behavior before feeds are configured.

---

## Policy Brief Schema

Each brief in `data/policy_briefs.json` follows this schema:

```json
{
  "title": "Affordable Housing Policy Brief — March 2026",
  "policy_topic": "Affordable Housing",
  "summary": "Brief narrative summary…",
  "implications": "Actionable policy implications…",
  "related_data": "data/market/hud_lihtc_co.geojson",
  "sources": ["Source A", "Source B"],
  "alert_count": 12,
  "regions": ["Denver", "Statewide"],
  "generated": "2026-03-15T12:00:00Z"
}
```

---

## GitHub Actions Automation (Future)

No alert or policy brief workflow is currently active in this repository.
To automate the pipeline:

1. Create a workflow file (e.g. `.github/workflows/alerts-and-briefs.yml`)
2. Schedule it (e.g. weekly via `on: schedule`)
3. Add `ALERT_FEEDS` and optionally `OPENAI_API_KEY` as GitHub Secrets
4. Run both scripts in sequence and commit the output JSON files

---

## Related Pages & Docs

- **Display page:** [`policy-briefs.html`](../policy-briefs.html)
- **Architecture:** [`docs/data-architecture.md`](data-architecture.md)
- **Nontechnical guide:** [`docs/nontechnical-implementation-guide.md`](nontechnical-implementation-guide.md)
