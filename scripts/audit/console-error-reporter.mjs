/**
 * console-error-reporter.mjs
 * Playwright-based console error audit for all site pages.
 *
 * Visits every HTML page, captures console errors AND warnings, deduplicates
 * repeated messages, and writes structured JSON + Markdown reports.
 *
 * Usage:
 *   AUDIT_BASE_URL=http://127.0.0.1:8080 node scripts/audit/console-error-reporter.mjs
 *
 * Options (env vars):
 *   AUDIT_BASE_URL   Base URL of the running static server (default: http://127.0.0.1:8080)
 *   REPORT_DIR       Override output directory (default: audit-report/console/<timestamp>/)
 *   PAGE_TIMEOUT_MS  Per-page navigation timeout in ms (default: 30000)
 *   SETTLE_MS        Extra wait after networkidle for lazy scripts (default: 3000)
 *
 * Outputs:
 *   <REPORT_DIR>/console-report.json   — machine-readable full report
 *   <REPORT_DIR>/console-report.md     — Markdown summary (used for GitHub Issue body)
 *
 * Exit codes:
 *   0  — audit complete (errors may still have been found; caller decides)
 *   1  — fatal runner error
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL        = process.env.AUDIT_BASE_URL  || 'http://127.0.0.1:8080';
const PAGE_TIMEOUT_MS = parseInt(process.env.PAGE_TIMEOUT_MS || '30000', 10);
const SETTLE_MS       = parseInt(process.env.SETTLE_MS       || '3000',  10);
const REPORT_DIR_BASE = process.env.REPORT_DIR
  || path.resolve(__dirname, '..', '..', 'audit-report', 'console');

// ── All site pages ──────────────────────────────────────────────────────────
const PAGES = [
  // Interactive dashboards (highest priority)
  { name: 'index',                      path: '/' },
  { name: 'dashboard',                  path: '/dashboard.html' },
  { name: 'economic-dashboard',         path: '/economic-dashboard.html' },
  { name: 'housing-needs-assessment',   path: '/housing-needs-assessment.html' },
  { name: 'market-analysis',            path: '/market-analysis.html' },
  { name: 'market-intelligence',        path: '/market-intelligence.html' },
  { name: 'colorado-deep-dive',         path: '/colorado-deep-dive.html' },
  { name: 'colorado-market',            path: '/colorado-market.html' },
  { name: 'LIHTC-dashboard',            path: '/LIHTC-dashboard.html' },
  { name: 'state-allocation-map',       path: '/state-allocation-map.html' },
  { name: 'compliance-dashboard',       path: '/compliance-dashboard.html' },
  { name: 'census-dashboard',           path: '/census-dashboard.html' },
  { name: 'chfa-portfolio',             path: '/chfa-portfolio.html' },
  { name: 'construction-commodities',   path: '/construction-commodities.html' },
  { name: 'cra-expansion-analysis',     path: '/cra-expansion-analysis.html' },
  { name: 'regional',                   path: '/regional.html' },
  { name: 'deal-calculator',            path: '/deal-calculator.html' },
  { name: 'hna-comparative-analysis',   path: '/hna-comparative-analysis.html' },
  { name: 'hna-scenario-builder',       path: '/hna-scenario-builder.html' },
  { name: 'lihtc-allocations',          path: '/lihtc-allocations.html' },
  { name: 'preservation',               path: '/preservation.html' },
  { name: 'select-jurisdiction',        path: '/select-jurisdiction.html' },
  { name: 'data-review-hub',            path: '/data-review-hub.html' },
  { name: 'data-status',                path: '/data-status.html' },
  { name: 'dashboard-data-quality',     path: '/dashboard-data-quality.html' },
  { name: 'colorado-elections',         path: '/colorado-elections.html' },
  // Informational / article pages
  { name: 'insights',                   path: '/insights.html' },
  { name: 'policy-briefs',              path: '/policy-briefs.html' },
  { name: 'housing-legislation-2026',   path: '/housing-legislation-2026.html' },
  { name: 'lihtc-enhancement-ahcia',    path: '/lihtc-enhancement-ahcia.html' },
  { name: 'lihtc-guide',                path: '/lihtc-guide-for-stakeholders.html' },
  { name: 'article-pricing',            path: '/article-pricing.html' },
  { name: 'article-co-housing-costs',   path: '/article-co-housing-costs.html' },
  { name: 'about',                      path: '/about.html' },
  { name: 'privacy-policy',             path: '/privacy-policy.html' },
];

// ── Noise filters ───────────────────────────────────────────────────────────
// Messages matching any of these patterns are suppressed as known-benign noise.
const IGNORE_PATTERNS = [
  /favicon/i,
  /net::ERR_BLOCKED_BY_CLIENT/i,
  /ERR_INTERNET_DISCONNECTED/i,
  // Browser extension injections
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  // Third-party CSP / mixed-content noise
  /Content Security Policy/i,
  // Playwright test helper noise
  /playwright/i,
];

// ── Severity levels we capture ───────────────────────────────────────────────
const CAPTURE_LEVELS = new Set(['error', 'warning', 'warn']);

// ── Deduplication key ────────────────────────────────────────────────────────
function dedupeKey(entry) {
  // Normalise dynamic values so "TypeError: Cannot read properties of undefined (reading 'x')"
  // on the same URL + line + column from the same page don't inflate the count.
  const loc = entry.location
    ? `${entry.location.url || ''}:${entry.location.lineNumber || ''}:${entry.location.columnNumber || ''}`
    : '';
  return `${entry.level}|${entry.text.slice(0, 120)}|${loc}`;
}

// ── Per-page audit ───────────────────────────────────────────────────────────
async function auditPage(browser, pageConfig) {
  const url = BASE_URL + pageConfig.path;
  /** @type {Array<{level:string, text:string, location:object|null}>} */
  const messages = [];
  let loadError = null;

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page    = await context.newPage();

  // Capture all console messages
  page.on('console', (msg) => {
    const level = msg.type(); // 'error', 'warning', 'log', 'info', …
    if (!CAPTURE_LEVELS.has(level)) return;
    const text = msg.text();
    if (IGNORE_PATTERNS.some(p => p.test(text))) return;
    messages.push({ level, text, location: msg.location() || null });
  });

  // Also capture uncaught JS exceptions as errors
  page.on('pageerror', (err) => {
    const text = err.message || String(err);
    if (IGNORE_PATTERNS.some(p => p.test(text))) return;
    messages.push({ level: 'error', text: `[uncaught] ${text}`, location: null });
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS });
  } catch (e) {
    loadError = e.message;
  }

  // Extra settle time for setTimeout-based lazy scripts
  await page.waitForTimeout(SETTLE_MS);
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch (_) { /* ignore */ }

  await context.close();

  // Deduplicate while preserving first-seen order and occurrence count
  const seen  = new Map(); // key → index in deduped array
  const deduped = [];
  for (const msg of messages) {
    const key = dedupeKey(msg);
    if (seen.has(key)) {
      deduped[seen.get(key)].count++;
    } else {
      seen.set(key, deduped.length);
      deduped.push({ ...msg, count: 1 });
    }
  }

  return {
    name: pageConfig.name,
    url,
    loadError,
    errors:   deduped.filter(m => m.level === 'error'),
    warnings: deduped.filter(m => m.level === 'warning' || m.level === 'warn'),
  };
}

// ── Markdown report ──────────────────────────────────────────────────────────
function buildMarkdown(results, timestamp, runUrl) {
  const totalErrors   = results.reduce((n, r) => n + r.errors.length, 0);
  const totalWarnings = results.reduce((n, r) => n + r.warnings.length, 0);
  const pagesWithErrors   = results.filter(r => r.errors.length   > 0).length;
  const pagesWithWarnings = results.filter(r => r.warnings.length > 0).length;
  const pagesWithLoadErr  = results.filter(r => r.loadError).length;

  const statusBadge = totalErrors > 0 ? '🔴 **ERRORS FOUND**' : (totalWarnings > 0 ? '🟡 **WARNINGS ONLY**' : '🟢 **CLEAN**');

  const lines = [
    `## Console Error Audit — ${statusBadge}`,
    ``,
    `**Audited:** ${timestamp}  `,
    runUrl ? `**Workflow run:** ${runUrl}  ` : '',
    `**Base URL:** \`${BASE_URL}\`  `,
    `**Pages audited:** ${results.length}`,
    ``,
    `### Summary`,
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Pages with JS errors | ${pagesWithErrors} |`,
    `| Pages with warnings  | ${pagesWithWarnings} |`,
    `| Pages with load errors | ${pagesWithLoadErr} |`,
    `| Total console errors | ${totalErrors} |`,
    `| Total console warnings | ${totalWarnings} |`,
    ``,
  ];

  if (totalErrors === 0 && totalWarnings === 0 && pagesWithLoadErr === 0) {
    lines.push('✅ No console errors or warnings detected across all pages.');
    return lines.filter(l => l !== '').join('\n');
  }

  // Per-page details (only pages that had something)
  lines.push('### Per-page findings');
  lines.push('');

  for (const r of results) {
    if (!r.loadError && r.errors.length === 0 && r.warnings.length === 0) continue;

    lines.push(`<details>`);
    lines.push(`<summary><strong>${r.name}</strong> — ${r.errors.length} error(s), ${r.warnings.length} warning(s)${r.loadError ? ' ⚠️ load error' : ''}</summary>`);
    lines.push('');
    lines.push(`**URL:** \`${r.url}\``);
    lines.push('');

    if (r.loadError) {
      lines.push(`> ⚠️ **Page load error:** ${r.loadError}`);
      lines.push('');
    }

    if (r.errors.length > 0) {
      lines.push('**Console Errors:**');
      lines.push('');
      lines.push('```');
      for (const e of r.errors) {
        const loc  = e.location ? ` (${e.location.url || ''}:${e.location.lineNumber || ''})` : '';
        const rpt  = e.count > 1 ? ` [×${e.count}]` : '';
        lines.push(`[error]${rpt} ${e.text}${loc}`);
      }
      lines.push('```');
      lines.push('');
    }

    if (r.warnings.length > 0) {
      lines.push('**Console Warnings:**');
      lines.push('');
      lines.push('```');
      for (const w of r.warnings) {
        const loc  = w.location ? ` (${w.location.url || ''}:${w.location.lineNumber || ''})` : '';
        const rpt  = w.count > 1 ? ` [×${w.count}]` : '';
        lines.push(`[warn]${rpt} ${w.text}${loc}`);
      }
      lines.push('```');
      lines.push('');
    }

    lines.push('</details>');
    lines.push('');
  }

  lines.push('---');
  lines.push('_Generated by [console-error-reporter.mjs](scripts/audit/console-error-reporter.mjs)_');

  return lines.filter((l, i, arr) => !(l === '' && i > 0 && arr[i - 1] === '')).join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const timestamp = new Date().toISOString();
  const slug      = timestamp.replace(/[:.]/g, '-');
  const reportDir = path.join(REPORT_DIR_BASE, slug);
  fs.mkdirSync(reportDir, { recursive: true });

  console.log(`Console Error Audit`);
  console.log(`  Base URL : ${BASE_URL}`);
  console.log(`  Pages    : ${PAGES.length}`);
  console.log(`  Report   : ${reportDir}`);
  console.log('');

  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const pageConfig of PAGES) {
    process.stdout.write(`  [${String(results.length + 1).padStart(2)}/${PAGES.length}] ${pageConfig.name} … `);
    try {
      const result = await auditPage(browser, pageConfig);
      results.push(result);
      const tag = result.errors.length > 0
        ? `❌ ${result.errors.length} error(s)`
        : result.warnings.length > 0
          ? `⚠️  ${result.warnings.length} warning(s)`
          : '✅';
      console.log(tag);
    } catch (err) {
      console.log(`💥 runner error: ${err.message}`);
      results.push({
        name: pageConfig.name,
        url:  BASE_URL + pageConfig.path,
        loadError: `runner error: ${err.message}`,
        errors:   [],
        warnings: [],
      });
    }
  }

  await browser.close();

  // ── Aggregate summary ──────────────────────────────────────────────────────
  const summary = {
    timestamp,
    baseUrl:        BASE_URL,
    pagesAudited:   results.length,
    totalErrors:    results.reduce((n, r) => n + r.errors.length,   0),
    totalWarnings:  results.reduce((n, r) => n + r.warnings.length, 0),
    pagesWithErrors:    results.filter(r => r.errors.length   > 0).length,
    pagesWithWarnings:  results.filter(r => r.warnings.length > 0).length,
    pagesWithLoadError: results.filter(r => r.loadError).length,
  };

  // ── JSON report ────────────────────────────────────────────────────────────
  const jsonReport = { summary, pages: results };
  const jsonPath   = path.join(reportDir, 'console-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));

  // ── Markdown report ────────────────────────────────────────────────────────
  const runUrl  = process.env.GITHUB_RUN_URL || '';
  const mdBody  = buildMarkdown(results, timestamp, runUrl);
  const mdPath  = path.join(reportDir, 'console-report.md');
  fs.writeFileSync(mdPath, mdBody);

  // Also write a "latest" symlink-style flat copy for easy CI access
  const latestJsonPath = path.join(REPORT_DIR_BASE, 'latest-console-report.json');
  const latestMdPath   = path.join(REPORT_DIR_BASE, 'latest-console-report.md');
  fs.copyFileSync(jsonPath, latestJsonPath);
  fs.copyFileSync(mdPath,   latestMdPath);

  // ── Console summary ────────────────────────────────────────────────────────
  console.log('');
  console.log('────────────────────────────────────────');
  console.log(`Pages audited      : ${summary.pagesAudited}`);
  console.log(`Pages with errors  : ${summary.pagesWithErrors}`);
  console.log(`Pages with warnings: ${summary.pagesWithWarnings}`);
  console.log(`Total errors       : ${summary.totalErrors}`);
  console.log(`Total warnings     : ${summary.totalWarnings}`);
  console.log('────────────────────────────────────────');
  console.log(`Reports saved to   : ${reportDir}`);
  console.log(`  console-report.json`);
  console.log(`  console-report.md`);

  // ── Print per-page details for errors ─────────────────────────────────────
  for (const r of results) {
    if (r.errors.length === 0) continue;
    console.log(`\n  [${r.name}] ${r.errors.length} error(s):`);
    for (const e of r.errors) {
      const loc = e.location ? ` (${e.location.url || ''}:${e.location.lineNumber || ''})` : '';
      console.log(`    • ${e.text.slice(0, 200)}${loc}`);
    }
  }
}

main().catch(err => {
  console.error('Console error reporter failed:', err);
  process.exit(1);
});
