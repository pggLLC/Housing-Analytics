# Testing Guide

This document describes the test infrastructure for the COHO Housing Analytics platform.

## Test Directory Structure

```
tests/                          # Python pytest test suite
  conftest.py                   # Shared fixtures and configuration
  test_governance_stress.py     # Pre-commit governance rule validation (12 probes)
  test_hna_geography_coverage.py  # HNA geography coverage consistency
  test_ranking_index_sentinels.py # Sentinel/leak value detection in ranking data
  test_pma_provenance.py        # PMA confidence module and data-quality API
  test_stage2_temporal.py       # FRED temporal continuity checks
  test_stage3_accessibility.py  # WCAG 2.1 AA contrast and landmark checks
  test_stage3_visualization.py  # Chart color tokens, canvas aria, aria-live regions

test/                           # Legacy JavaScript test suites
  hna-functionality-check.js    # HNA module smoke tests (Node.js, no pytest)
  smoke-market-analysis.js      # Market analysis smoke tests (sections 1–18)
  unit/                         # Unit tests for individual modules
  integration/                  # Integration tests for multi-module flows
```

## Running Tests

### Python tests (pytest)

Install pytest once (requires Python 3.8+):

```bash
pip install pytest
```

Run the full suite:

```bash
cd /path/to/Housing-Analytics
python3 -m pytest tests/ -v
```

Run a single test file:

```bash
python3 -m pytest tests/test_hna_geography_coverage.py -v
```

### Build-time validation scripts

These scripts run standalone (no pytest required):

```bash
# Validate HNA geography coverage and ranking consistency
python3 scripts/validate_hna_coverage.py

# Pre-commit governance checks (all 18 rules)
python3 scripts/pre-commit-checks.py
```

### JavaScript tests

```bash
# HNA module smoke test (requires Node.js)
node test/hna-functionality-check.js

# Market analysis smoke tests
node test/smoke-market-analysis.js
```

## CI/CD Integration

All Python tests run automatically via GitHub Actions on every push and pull
request.  Workflow files live in `.github/workflows/`.

Key validation workflows:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `validate-data.yml` | Push, PR | Data schema and sentinel checks |
| `pre-commit-checks.yml` | Push, PR | Governance rule enforcement |
| `run-python-tests.yml` | Push, PR | Full pytest suite |

## Test Conventions

- **Python tests** use `pytest` with class-based test organization (`class
  TestXyz`).  Fixtures are module-scoped for performance.
- **JavaScript tests** use the repository's own mini harness (`_assert()` /
  `_test()` helpers); they exit with code 1 on failure and do not require
  Jest or Mocha.
- **Sentinel detection**: Tests assert that the ACS sentinel value
  (`-666666666`) never appears in production JSON data consumed by the UI.
- **Governance probes**: `test_governance_stress.py` exercises each of the 18
  production governance rules with both a failing and a passing example,
  then confirms the production codebase itself is compliant.

## Adding New Tests

1. Place new Python tests in `tests/` following the existing class-based
   pattern.
2. Add fixtures to `tests/conftest.py` if they are shared across test files.
3. Register any new build-time script in this document and in the relevant
   GitHub Actions workflow.
4. Ensure new tests cover the "detect failure" case as well as the "pass"
   case to prevent silent regressions.
