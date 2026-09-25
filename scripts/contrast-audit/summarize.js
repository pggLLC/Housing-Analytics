/**
 * scripts/contrast-audit/summarize.js
 * Builds the per-page table of contrast-audit.yml's report from the JSON
 * reports scripts/contrast-audit/run.js writes, one per page.
 *
 * Usage:
 *   node scripts/contrast-audit/summarize.js <reports-dir> <pages-file>
 *
 * <pages-file> lists one page per line (the workflow's discovered pages).
 * Prints the markdown table + summary to stdout, and "key=value" counts to
 * the file named by $GITHUB_OUTPUT when set.
 *
 * Every page lands in exactly one of four states, read from its report and
 * never from run.js's exit code alone:
 *   ✅ Pass         scanned, no violations
 *   ❌ Fail         scanned, N violations (the count is totals.violations;
 *                   the table used to read a .summary key that does not exist
 *                   at the top level, so every failing page showed 0)
 *   ⚠️ Not scanned  the page errored, or no report was written. This used to
 *                   print as "✅ Pass | 0": run.js swallowed the error and
 *                   exited 0.
 *   ↪️ Redirect     a meta-refresh page; its target is audited on its own row
 */
'use strict';

const fs   = require('fs');
const path = require('path');

function reportPath(dir, page) {
  return path.join(dir, page.replace(/\.html$/, '').replace(/\//g, '-') + '.json');
}

function classify(report) {
  if (!report || !Array.isArray(report.pages) || report.pages.length === 0) {
    return { state: 'not-scanned', detail: 'no report written' };
  }
  const p = report.pages[0];
  if (p.error) return { state: 'not-scanned', detail: p.error };
  if (p.redirect) return { state: 'redirect', detail: p.redirect };
  const n = report.totals && Number.isInteger(report.totals.violations)
    ? report.totals.violations
    : (Array.isArray(p.violations) ? p.violations.length : null);
  if (n === null) return { state: 'not-scanned', detail: 'report has no violation count' };
  return n > 0 ? { state: 'fail', violations: n } : { state: 'pass', violations: 0 };
}

function readReport(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function cell(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 120);
}

function summarize(dir, pages) {
  const counts = { total: 0, passed: 0, failed: 0, not_scanned: 0, redirects: 0 };
  const rows = ['| Page | Status | Issues |', '|------|--------|--------|'];
  for (const page of pages) {
    counts.total += 1;
    const r = classify(readReport(reportPath(dir, page)));
    let status, issues;
    if (r.state === 'pass') {
      counts.passed += 1; status = '✅ Pass'; issues = '0';
    } else if (r.state === 'fail') {
      counts.failed += 1; status = '❌ Fail'; issues = String(r.violations);
    } else if (r.state === 'redirect') {
      counts.redirects += 1; status = '↪️ Redirect → `' + cell(r.detail) + '`'; issues = '—';
    } else {
      counts.not_scanned += 1; status = '⚠️ Not scanned'; issues = '— (' + cell(r.detail) + ')';
    }
    rows.push('| `' + page + '` | ' + status + ' | ' + issues + ' |');
  }
  const summary = [
    '',
    '## Summary',
    '',
    '- **Total pages:** ' + counts.total,
    '- **Passed:** ' + counts.passed,
    '- **Failed:** ' + counts.failed,
    '- **Not scanned:** ' + counts.not_scanned,
    '- **Redirects (target audited separately):** ' + counts.redirects,
  ];
  return { markdown: rows.concat(summary).join('\n') + '\n', counts };
}

module.exports = { classify, summarize, reportPath };

if (require.main === module) {
  const [dir, pagesFile] = process.argv.slice(2);
  if (!dir || !pagesFile) {
    console.error('usage: summarize.js <reports-dir> <pages-file>');
    process.exit(64);
  }
  const pages = fs.readFileSync(pagesFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  const { markdown, counts } = summarize(dir, pages);
  process.stdout.write(markdown);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
      Object.entries(counts).map(([k, v]) => k + '=' + v).join('\n') + '\n');
  }
}
