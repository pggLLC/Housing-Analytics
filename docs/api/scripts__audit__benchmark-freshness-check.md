# `scripts/audit/benchmark-freshness-check.mjs`

## Symbols

### `parseWhen(raw)`

scripts/audit/benchmark-freshness-check.mjs — F(#1147)

Why this exists
----------------
The Deal Calculator cites two static market-benchmark snapshots:

  - data/market/novogradac-equity-pricing.json   (LIHTC equity pricing)
  - data/market/freddie-mac-multifamily-outlook.json (rates/cap-rate outlook)

Each was added in a one-time commit and has no refresh workflow. The UI
discloses the vintage honestly (shows `as_of` inline, links the source,
tells the user to verify before quoting), so a stale file is not a live
bug — but nothing surfaces staleness to a developer until a user notices.
This script makes it visible on demand.

NOT the same thing as scripts/audit/data-freshness-check.mjs: that script
enforces SLAs on pipeline-generated files (and fails CI when violated).
These two files are hand-captured external snapshots with a *stated
update cadence*; staleness here is advisory. Warn-only, always exits 0,
and deliberately NOT part of test:ci.

What it checks, per file:
  1. `meta.next_expected_update` (when present) has not passed.
  2. `meta.as_of` (falling back to `meta.vintage`) is not older than
     STALE_AFTER_DAYS (60 — both sources publish roughly quarterly).

Date parsing accepts, in order:
  - ISO dates ("2026-07-01")
  - Month-name references ("early August 2026" → 2026-08-01)
  - Quarter strings ("2026-Q3" → end of that quarter, since an update
    "expected in Q3" isn't overdue until Q3 ends)

Usage:
  node scripts/audit/benchmark-freshness-check.mjs
  npm run audit:benchmark-freshness
/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const STALE_AFTER_DAYS = 60;

const BENCHMARK_FILES = [
  {
    file: 'data/market/novogradac-equity-pricing.json',
    label: 'Novogradac LIHTC equity pricing',
  },
  {
    file: 'data/market/freddie-mac-multifamily-outlook.json',
    label: 'Freddie Mac multifamily outlook',
  },
];

const MONTHS = ['january','february','march','april','may','june','july',
                'august','september','october','november','december'];

/**
Best-effort parse of a "when" string into a Date, or null.
Order: ISO date → "Month YYYY" → "YYYY-Qn" (end of quarter).
