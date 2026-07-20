# `scripts/audit/data-freshness-check.mjs`

data-freshness-check.mjs — verify critical data files haven't gone stale.
Partial closeout of issue #656 (data-freshness monitoring + alerting)
from the #447 epic decomposition.

What it does:
  1. Checks each file in SLA_CONFIG.
  2. For each file: prefer an in-file `updated` / `generated` /
     `metadata.generated` timestamp (many of our pipelines stamp one);
     fall back to the file's mtime if none is present.
  3. Fails non-zero if any file is older than its SLA.

Exit codes:
  0  — every file within its SLA (or warn-only)
  1  — at least one file past its SLA (hard stale)
  2  — internal script error (e.g. missing required file)

Usage:
  node scripts/audit/data-freshness-check.mjs
  node scripts/audit/data-freshness-check.mjs --json      (machine output)
  node scripts/audit/data-freshness-check.mjs --quiet     (only print failures)

To add a new file, append a row to SLA_CONFIG with a reasonable SLA in days.
The SLA should be comfortably longer than the pipeline's refresh cadence —
fortnightly pipeline → ~18-day SLA, weekly → 9-day, annual → ~400-day.

## Symbols

### `findTimestamp(obj)`

Walk an object one level deep looking for a known timestamp field.
