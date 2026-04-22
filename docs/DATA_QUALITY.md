# Data Quality

How this repo signals and handles data-quality problems in its ETL pipelines. Partial closeout of [#657](https://github.com/pggLLC/Housing-Analytics/issues/657).

Three complementary signals are in place today; this document defines the conventions each follows so new pipelines can plug in consistently.

---

## 1. Staleness — `scripts/audit/data-freshness-check.mjs`

**What it catches:** files whose last refresh is past their SLA threshold.

**Signal:** non-zero exit from the check script; daily scheduled workflow ([`data-freshness-check.yml`](../.github/workflows/data-freshness-check.yml)) runs the check and auto-opens a tracking issue with marker `[data-freshness-alert]` on the first failure. The same issue gets commented on each subsequent failure (bounded). The tracker auto-closes on the next green run.

**Configuration:** edit `SLA_CONFIG` in the check script. Set the SLA comfortably longer than the pipeline's refresh cadence (weekly → 9–10 days, monthly → 32 days, quarterly → 95 days, annual → 400 days). The check prefers an in-file `updated` / `generated` / `metadata.generatedAt` timestamp; falls back to file mtime when no in-file timestamp exists.

## 2. Corruption — `scripts/audit/data-sentinels-check.mjs`

**What it catches:** files that regenerate fresh but with silently-truncated content — a full file with 50 of an expected 500 entries passes the freshness gate but is still broken.

**Signal:** non-zero exit from the check script; daily scheduled workflow ([`data-sentinels-check.yml`](../.github/workflows/data-sentinels-check.yml)) runs the check and auto-opens a tracking issue with marker `[data-sentinels-alert]`. Same auto-close-on-recovery pattern as freshness.

**Configuration:** edit `SENTINELS` in the check script. Each sentinel specifies `path`, `minRows`, a `count` extractor function, and whether it's a `file` or `directory` kind. Set `minRows` comfortably below the current row count so the sentinel triggers on **cratering**, not normal drift.

## 3. Schema drift — `scripts/validate-schemas.js`

**What it catches:** files that structurally violate their declared JSON Schema (missing required keys, wrong types, sentinel-value leakage, row-count invariants like \"AMI gap must cover 64 counties\").

**Signal:** `ci-checks.yml` runs the validator on every push / PR. Currently `continue-on-error: true` — validation failures are surfaced in the **job summary tab** (introduced alongside this document) but do not block PRs while the schema contract is still maturing.

**Posture:** the `continue-on-error` is intentionally a policy lever. Flipping it to `false` would make schema violations hard-blocking for every PR. Revisit when:
  - Schema definitions are stable enough that cross-repo PRs rarely touch them
  - Every pipeline writing to a schema-owned path has been audited for sentinel-value leakage
  - A run of `main` has shown zero schema failures for ≥2 weeks

See [#657](https://github.com/pggLLC/Housing-Analytics/issues/657) for the flip-it checklist.

## 4. Arbitrary workflow failure — `.github/actions/notify-workflow-outcome`

**What it catches:** a scheduled workflow fails for *any* reason — upstream API outage, rate-limit, auth failure, step timeout, partial write.

**Signal:** each workflow wired to the composite action calls it with `if: always()` and passes `${{ job.status }}`. On failure, the composite finds-or-opens a tracking issue with marker `[workflow-fail:<workflow_id>]` and optionally POSTs to Slack if `SLACK_WEBHOOK_URL` is set. On success (with an open tracker), the composite auto-closes it.

---

## The `fetch_errors` manifest convention

ETL scripts that iterate over many items (counties, places, tracts) should **not silently skip** failed items. Accumulate per-item failures and emit them alongside the primary output so downstream visibility is preserved.

### Shape

Any ETL script that produces a JSON output SHOULD include a top-level `fetch_errors` key alongside its data. Empty array when all items fetched cleanly:

```json
{
  "updated": "2026-04-21T03:45:00Z",
  "counties": { "08001": { ... }, "08013": { ... } },
  "fetch_errors": [
    {
      "geoid": "08043",
      "error": "HTTP 429: rate limited by api.census.gov",
      "retries": 3,
      "timestamp": "2026-04-21T03:43:12Z"
    }
  ]
}
```

### Required per-error fields

| Field | Purpose |
|---|---|
| `geoid` or `item_id` | The specific item that failed (county FIPS, tract GEOID, program ID, etc.) |
| `error` | Short one-line description of the failure class + proximate cause |
| `timestamp` | ISO-8601 UTC timestamp when the failure was recorded |

### Optional per-error fields

| Field | Purpose |
|---|---|
| `retries` | Number of retry attempts exhausted before giving up |
| `http_status` | HTTP response code, if the failure was network-layer |
| `suggested_action` | Free-form hint for an operator (\"verify CENSUS_API_KEY\", \"retry after API recovery\") |

### Why alongside the data, not in logs

Logs rot and are hard to grep across a backfill. A `fetch_errors` array inside the output manifest stays with the data through any downstream pipeline step or human inspection. A CI step can also diff `fetch_errors.length` across runs to flag regressions.

### When to fail the script vs. record an error

- **Record + continue**: partial failure is acceptable for the output's intended use (e.g. missing one county's data still leaves 63 usable records).
- **Fail fast**: failure affects the output's structural integrity (primary upstream gone; auth broken for ALL items; required shared lookup missing).

A good rule of thumb: if the output would still be *useful* with the missing items clearly flagged, record and continue. If the output would silently mislead, fail.

### Proposed migration order (tracked in #657)

1. `scripts/fetch-county-demographics.js` — iterates 64 counties, well-scoped
2. `scripts/hna/build_hna_data.py` — iterates 547 geographies
3. `scripts/market/fetch_*.py` (each)
4. Eventually: all multi-item ETL scripts

---

## Sentinel values

ACS variables return `-666666666` for \"data unavailable\" and a handful of related sentinels for \"suppressed\", \"not applicable\", etc. These must not leak through as literal values in outputs — they trash any downstream sort or aggregation that doesn't filter them.

**Current coverage:**
- `scripts/hna/build_ranking_index.py::safe_float` explicitly filters any value ≤ `-1_000_000` as \"missing\"
- `scripts/hna/acs_validator.py` has a sentinel-detection pass that's run on raw ACS responses

**Gap (tracked in #657):** every other fetch script handling ACS data has its own `safe_float`-equivalent — some handle sentinels, some don't. An audit is needed to confirm coverage.

**Rule for new code:** if your fetch script calls `api.census.gov` or consumes any output that originated there, **route every numeric value through a sentinel-aware coercer** before writing it. Don't rely on downstream consumers to filter.

---

## Related issues

- [#656](https://github.com/pggLLC/Housing-Analytics/issues/656) — freshness monitoring + alerting (substantially closed)
- [#657](https://github.com/pggLLC/Housing-Analytics/issues/657) — this page's parent; row-count sentinels + schema surface + fetch_errors + sentinel-value audit
- [#447](https://github.com/pggLLC/Housing-Analytics/issues/447) — parent epic for data quality / monitoring / a11y
