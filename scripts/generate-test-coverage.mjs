#!/usr/bin/env node
/**
 * scripts/generate-test-coverage.mjs — emit a human-readable coverage
 * summary without pulling in c8/nyc.
 *
 * Closes the remaining slice of #655 (weekly docs-sync + test-coverage
 * report). The #654 sub-issue chose this lightweight approach on purpose:
 * assertion-count + test-file-count is enough signal for "coverage is
 * growing / shrinking", and avoids the c8/nyc instrumentation overhead
 * until we have enough test density for line-coverage to matter.
 *
 * What it counts:
 *   - .test.js files in test/
 *   - _test.py + test_*.py files in tests/
 *   - assertion calls: assert(), assert.X(), expect().toX(), and our
 *     in-repo conventions (✅ banner lines and self.assertEqual/pytest
 *     assert statements)
 *
 * Output:
 *   docs/reports/test-coverage.md (committed by docs-sync.yml weekly)
 *
 * Usage:
 *   npm run docs:coverage
 *   node scripts/generate-test-coverage.mjs --json
 */

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

/** Heuristic: infer which js/src module a test file targets. */
function inferTargetModule(testPath) {
  const base = path.basename(testPath)
    .replace(/\.test\.(js|mjs)$/, '')
    .replace(/^test_/, '')
    .replace(/_test$/, '');
  return base;
}

async function main() {
  const { json, quiet } = parseArgs();

  const jsFiles = (await walk(JS_TEST_DIR)).filter(f => f.endsWith('.test.js'));
  const pyFiles = (await walk(PY_TEST_DIR)).filter(f =>
    f.endsWith('.py') && (f.includes('_test') || path.basename(f).startsWith('test_')));

  const jsReports = [];
  for (const f of jsFiles) {
    const src = await fs.readFile(f, 'utf8');
    const assertions = countMatches(src, JS_ASSERT_PATTERNS);
    jsReports.push({
      file:       path.relative(ROOT, f),
      target:     inferTargetModule(f),
      assertions,
      lines:      src.split('\n').length,
    });
  }
  const pyReports = [];
  for (const f of pyFiles) {
    const src = await fs.readFile(f, 'utf8');
    const assertions = countMatches(src, PY_ASSERT_PATTERNS);
    pyReports.push({
      file:       path.relative(ROOT, f),
      target:     inferTargetModule(f),
      assertions,
      lines:      src.split('\n').length,
    });
  }

  jsReports.sort((a, b) => b.assertions - a.assertions);
  pyReports.sort((a, b) => b.assertions - a.assertions);

  const jsTotal = jsReports.reduce((s, r) => s + r.assertions, 0);
  const pyTotal = pyReports.reduce((s, r) => s + r.assertions, 0);

  const summary = {
    generatedAt: new Date().toISOString(),
    js: { files: jsReports.length, assertions: jsTotal },
    py: { files: pyReports.length, assertions: pyTotal },
    total: { files: jsReports.length + pyReports.length, assertions: jsTotal + pyTotal },
    jsFiles: jsReports,
    pyFiles: pyReports,
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const lines = [];
  lines.push('# Test coverage report');
  lines.push('');
  lines.push(`_Auto-generated ${summary.generatedAt.slice(0, 10)} by \`scripts/generate-test-coverage.mjs\` (weekly via \`docs-sync.yml\`)._`);
  lines.push('');
  lines.push('This is an **assertion-count** report, not line-coverage. Pattern-matched counts of `assert()`, `assert.X()`, `expect()`, `self.assert*()`, and bare pytest `assert` statements. Deliberate choice — a c8/nyc lift comes later once the test density justifies the instrumentation cost (see #655).');
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Runtime | Test files | Assertions |');
  lines.push('|---|---:|---:|');
  lines.push(`| JavaScript (\`test/\`) | ${summary.js.files} | ${summary.js.assertions} |`);
  lines.push(`| Python (\`tests/\`)   | ${summary.py.files} | ${summary.py.assertions} |`);
  lines.push(`| **Total** | **${summary.total.files}** | **${summary.total.assertions}** |`);
  lines.push('');

  lines.push('## JavaScript — per file');
  lines.push('');
  lines.push('| File | Target module | Lines | Assertions |');
  lines.push('|---|---|---:|---:|');
  for (const r of jsReports) {
    lines.push(`| \`${r.file}\` | \`${r.target}\` | ${r.lines} | ${r.assertions} |`);
  }
  lines.push('');

  lines.push('## Python — per file');
  lines.push('');
  lines.push('| File | Target module | Lines | Assertions |');
  lines.push('|---|---|---:|---:|');
  for (const r of pyReports) {
    lines.push(`| \`${r.file}\` | \`${r.target}\` | ${r.lines} | ${r.assertions} |`);
  }
  lines.push('');

  lines.push('## Reading this report');
  lines.push('');
  lines.push('- **Assertion count is a floor, not a ceiling** of coverage. A test file with 50 assertions can still miss an important edge case; a file with 10 can have exhaustive coverage via property-based checks. Use it to spot *regression directions* (count drops from one report to the next → tests were deleted or converted to narrow snapshots).');
  lines.push('- **Target module** is inferred from the test file name (e.g. `pma-transit.test.js` → `pma-transit`). Cross-module integration tests naturally show a single heuristic target.');
  lines.push('- **Python assertion count** is lower than line count would suggest because pytest encourages one-assert-per-test — line count per file is closer to \"test-case count\".');
  lines.push('');

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, lines.join('\n') + '\n');

  if (!quiet) {
    console.log(`[docs:coverage] wrote ${path.relative(ROOT, OUT_FILE)}`);
    console.log(`[docs:coverage] ${summary.total.files} files / ${summary.total.assertions} assertions`);
    console.log(`                JS: ${summary.js.files} / ${summary.js.assertions}`);
    console.log(`                Py: ${summary.py.files} / ${summary.py.assertions}`);
  }
}

main().catch(err => {
  console.error('generate-test-coverage crashed:', err);
  process.exit(1);
});
