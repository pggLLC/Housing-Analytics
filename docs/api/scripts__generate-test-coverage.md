# `scripts/generate-test-coverage.mjs`

## Symbols

### `inferTargetModule(testPath)`

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
/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const OUT_FILE  = path.join(ROOT, 'docs', 'reports', 'test-coverage.md');

const JS_TEST_DIR  = path.join(ROOT, 'test');
const PY_TEST_DIR  = path.join(ROOT, 'tests');

function parseArgs() {
  const args = process.argv.slice(2);
  return { json: args.includes('--json'), quiet: args.includes('--quiet') };
}

async function walk(dir, out = []) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { await walk(full, out); continue; }
    out.push(full);
  }
  return out;
}

// JS assertion patterns — node:assert/strict (assert + assert.X) and
// Mocha/Jest expect(). Deliberately NOT matching ✅ console.log banners:
// our queue-based harness (soft-funding-tracker.test.js and later)
// prints a ✅ AFTER each assert() call, so including the banner would
// double-count every assertion in those files.
const JS_ASSERT_PATTERNS = [
  /\bassert\s*\(/g,
  /\bassert\.[a-zA-Z_]+\s*\(/g,
  /\bexpect\s*\(/g,
];

// Python: unittest + pytest patterns.
const PY_ASSERT_PATTERNS = [
  /\bself\.assert[A-Z][a-zA-Z]+\s*\(/g,   // self.assertEqual(…)
  /^\s*assert\s+/gm,                      // pytest bare assert
];

function countMatches(src, patterns) {
  let n = 0;
  for (const rx of patterns) {
    rx.lastIndex = 0;
    const m = src.match(rx);
    if (m) n += m.length;
  }
  return n;
}

/** Heuristic: infer which js/src module a test file targets.
