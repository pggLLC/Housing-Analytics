# Fix Scripts Audit

**Generated:** 2026-03-15  
**Purpose:** Document the status of all `fix_*.py` scripts in `scripts/` so future
maintainers know whether each script is still needed at runtime or can be archived.

---

## Audit Criteria

A fix script can be moved to `_tobedeleted/scripts/` when ALL of the following are true:

1. **Idempotent** — running it twice produces the same result (no side effects on already-fixed data)
2. **Fix already applied** — the target data/HTML file has been corrected
3. **Not a runtime/build dependency** — no CI workflow or makefile calls it

When uncertain about any criterion, the script is left in place.

---

## Script Inventory

| Script | Purpose | Idempotent | Fix Applied | Runtime Dep | Recommendation |
|--------|---------|-----------|-------------|-------------|----------------|
| `fix_accent_token.py` | Raise `--accent` CSS token from `#0a7e74` to `#096e65` (WCAG AA) | ✅ Yes | ✅ Yes (`css/site-theme.css`) | ❌ No | Archive |
| `fix_amenity_stubs.py` | Populate empty amenity GeoJSON stub files | ⚠️ Unclear | ⚠️ Partial | ❌ No | Keep — verify stub content |
| `fix_ami_gap_fips.py` | Zero-pad 3-digit FIPS codes to 5 digits in `co_ami_gap_by_county.json` | ✅ Yes | ✅ Yes | ❌ No | Archive |
| `fix_ami_gap_ouray.py` | Re-insert Ouray County (FIPS `08091`) that was missing from AMI gap data | ✅ Yes | ✅ Yes | ❌ No | Archive |
| `fix_ami_gap_statewide.py` | Add/fix statewide AMI gap entry in `co_ami_gap_by_county.json` | ✅ Yes | ✅ Yes | ❌ No | Archive |
| `fix_aria_live.py` | Inject `aria-live="polite"` regions on dynamic-content pages | ✅ Yes | ✅ Yes (pages verified) | ❌ No | Archive |
| `fix_canvas_aria.py` | Add `role="img"` and `aria-label` to bare `<canvas>` elements | ✅ Yes | ✅ Yes (pages verified) | ❌ No | Archive |
| `fix_car_reports.py` | Backfill null fields in CAR market report JSON files | ✅ Yes | ✅ Yes | ❌ No | Archive |
| `fix_car_schema.py` | Normalize field names in `car-market.json` to match report schema | ✅ Yes | ✅ Yes | ❌ No | Archive |
| `fix_chart_colors.py` | Replace failing hex colors with WCAG AA CSS token variables | ✅ Yes | ✅ Yes (HTML files verified) | ❌ No | Archive |
| `fix_chfa_nulls.py` | Backfill null `CREDIT`, `NON_PROF`, `DDA` fields in CHFA LIHTC data | ✅ Yes | ⚠️ Unclear — verify `data/chfa-lihtc.json` | ❌ No | Keep — verify first |
| `fix_fred_empty_series.py` | Fill 5 empty commodity PPI series in `fred-data.json` | ✅ Yes | ✅ Yes | ❌ No | Archive |
| `fix_fred_metadata.py` | Inject missing `title`, `units`, `frequency` metadata for FRED series | ✅ Yes | ✅ Yes | ❌ No | Archive |
| `fix_fred_oct_gap.py` | Interpolate October 2025 gap in 4 monthly FRED series | ✅ Yes | ✅ Yes | ❌ No | Archive |
| `fix_landmarks.py` | Add `<header>`, `<main id="main-content">`, `<footer>` landmarks to pages | ✅ Yes | ✅ Yes (pages verified) | ❌ No | Archive |
| `fix_lihtc_trends.py` | Add 35 missing counties and flag 2025 as preliminary in `lihtc-trends-by-county.json` | ✅ Yes | ✅ Yes | ❌ No | Archive |
| `fix_map_bugs.py` | Fix map rendering bugs (ArcGIS `outSR=4326`, marker offsets) | ⚠️ Unclear | ⚠️ Partial | ❌ No | Keep — review output |
| `fix_projection_baseyear.py` | Update `baseYear` from 2021/2030 to 2024 in 64 DOLA projection files | ✅ Yes | ✅ Yes | ❌ No | Archive |
| `fix_sya_pyramid_year.py` | Update `pyramidYear` from 2030 to 2024 in DOLA SYA county files | ✅ Yes | ✅ Yes | ❌ No | Archive |
| `fix_touch_targets.py` | Fix touch target sizes and color-only information in HTML pages | ✅ Yes | ✅ Yes | ❌ No | Archive |

---

## Actions Taken in This PR

**Archived to `_tobedeleted/scripts/`:** None in this PR — the audit above shows most fixes
have already been applied, but full verification of target data files was not completed.

**Recommended next step:** Run each "Archive" candidate script against its target file in a
clean environment and confirm no changes are made (idempotency check). If the script exits
cleanly with no modifications, it is safe to move to `_tobedeleted/scripts/`.

**Flagged for manual review (Keep):**
- `fix_amenity_stubs.py` — stub file content needs verification
- `fix_chfa_nulls.py` — verify `data/chfa-lihtc.json` null fields are addressed
- `fix_map_bugs.py` — review target HTML/JS for completeness

---

## How to Run a Fix Script

```bash
# Verify idempotency (run twice, diff the output)
python3 scripts/fix_<name>.py
python3 scripts/fix_<name>.py
```

If the second run produces no output and the target file is unchanged, the fix is applied
and the script is safe to archive.
