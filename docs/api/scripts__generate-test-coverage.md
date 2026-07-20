# `scripts/generate-test-coverage.mjs`

scripts/generate-test-coverage.mjs — emit a human-readable coverage
summary without pulling in c8/nyc.

Closes the remaining slice of #655 (weekly docs-sync + test-coverage
report). The #654 sub-issue chose this lightweight approach on purpose:
assertion-count + test-file-count is enough signal for "coverage is
growing / shrinking", and avoids the c8/nyc instrumentation overhead
until we have enough test density for line-coverage to matter.

What it counts:
  - .test.js files in test/
  - _test.py + test_*.py files in tests/
  - assertion calls: assert(), assert.X(), expect().toX(), and our
    in-repo conventions (✅ banner lines and self.assertEqual/pytest
    assert statements)

Output:
  docs/reports/test-coverage.md (committed by docs-sync.yml weekly)

Usage:
  npm run docs:coverage
  node scripts/generate-test-coverage.mjs --json

## Symbols

### `inferTargetModule(testPath)`

Heuristic: infer which js/src module a test file targets.
