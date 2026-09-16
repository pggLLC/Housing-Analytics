#!/usr/bin/env node
/**
 * scripts/audit/a11y-audit.mjs — WCAG 2.1 AA accessibility audit via axe-core.
 *
 * Partial closeout of #658 (WCAG audit + axe-core configured and runnable
 * as `npm run audit:a11y`).
 *
 * Design:
 *   - Uses Playwright to open each configured HTML page via file:// URLs.
 *     file:// is fine for this first pass — axe inspects the rendered DOM,
 *     and dynamic-data issues show up on pages whose static markup is
 *     already WCAG-clean (so file:// is a strict subset of what a live
 *     audit would surface).
 *   - Loads axe-core via page.addScriptTag from node_modules. axe-core is
 *     already a transitive devDep via lighthouse — no new package needed.
 *   - Emits:
 *       data/reports/a11y-baseline.json  — raw axe output per page
 *       docs/reports/a11y-baseline-2026.md — human-readable baseline
 *     The baseline file is committed so a PR-time diff shows regressions.
 *
 * Exit codes:
 *   0  — audit ran to completion (violations OK; this is a reporter)
 *   1  — script-level error (Playwright failed to launch, page 404, etc.)
 *
 * Usage:
 *   npm run audit:a11y             # default: all pages in AUDIT_PAGES
 *   node scripts/audit/a11y-audit.mjs --page index.html
 *   node scripts/audit/a11y-audit.mjs --json-only
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');

// Pages covered by the audit. Keep in sync with test/pages-availability-check.js
// HTML_PAGES list — this is the user-facing entry-point set.
const AUDIT_PAGES = [
  'index.html',
  'housing-needs-assessment.html',
  // The five views generated from housing-needs-assessment.html by
  // scripts/hna/build_hna_views.py. They are public pages in their own
  // right -- own <title>, own chrome, and a PRUNED script set (no
  // Leaflet on the four without a map) -- so auditing the canonical page
  // alone does not cover them. Rule: if the source page is audited, the
  // pages generated from it are too.
  'hna-what-housing-exists.html',
  'hna-who-lives-here.html',
  'hna-what-households-can-afford.html',
  'hna-where-its-heading.html',
  'hna-what-to-do.html',
  'hna-comparative-analysis.html',
  'economic-dashboard.html',
  'lihtc-allocations.html',
  'colorado-deep-dive.html',
  'lihtc-guide-for-stakeholders.html',
  'dashboard.html',
  'regional.html',
  'market-analysis.html',
  'deal-calculator.html',
  'land-value.html',
  'historical-trends.html',
  'housing-legislation-2026.html',
  'about.html',
  'insights.html',
];

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

function parseArgs() {
  const args = process.argv.slice(2);
  const pageArgIdx = args.indexOf('--page');
  return {
    pages:    pageArgIdx !== -1 && args[pageArgIdx + 1] ? [args[pageArgIdx + 1]] : AUDIT_PAGES,
    // A --page run is a probe at one page, not an audit of the site.
    singlePage: pageArgIdx !== -1 && Boolean(args[pageArgIdx + 1]),
    jsonOnly: args.includes('--json-only'),
    quiet:    args.includes('--quiet'),
  };
}

async function locateAxeScript() {
  // axe-core is bundled inside node_modules/axe-core/axe.js after lighthouse
  // pulls it in transitively. The resolve-on-disk approach avoids a new
  // @axe-core/playwright devDep.
  const candidate = path.join(ROOT, 'node_modules', 'axe-core', 'axe.js');
  await fs.access(candidate);
  return candidate;
}

/**
 * Audit one page. Never throws: a page that cannot be audited comes back as
 * `{ error }` so the run continues and the failure is reported per page.
 *
 * Previously only page.goto() was guarded. addScriptTag() and evaluate() were
 * not, so when Chromium dropped the tab on deal-calculator.html — 219 form
 * inputs, the heaviest page in the set — the rejection escaped this function
 * and killed the whole audit. Two runs of the SAME commit (e7df0d0cc) on
 * 2026-09-16 disagreed: one passed, one failed. An accessibility gate that
 * answers differently for identical code is not measuring accessibility, and
 * what people learn from it is to ignore a red axe.
 *
 * The context is also closed in a `finally`. It was closed only on the success
 * path, so every crash leaked a browser context for the remaining pages to
 * compete with — which is the likeliest reason the last page in a 21-page run
 * is the one that dies.
 */
async function auditPage(browser, pagePath, axeScript) {
  const context = await browser.newContext();
  const page    = await context.newPage();

  // Silence page console errors during audit — many of our pages fetch data
  // from relative paths that 404 under file://, which is not an a11y issue.
  page.on('pageerror', () => {});
  page.on('console',   () => {});

  const fileUrl = pathToFileURL(path.join(ROOT, pagePath)).href;
  try {
    await page.goto(fileUrl, { waitUntil: 'load', timeout: 15_000 });

    // Inject axe-core then run it. Inside the try: a crash here used to take
    // the entire run with it.
    await page.addScriptTag({ path: axeScript });

    const result = await page.evaluate(async (wcagTags) => {
    // eslint-disable-next-line no-undef
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: wcagTags } });
    // Trim the raw result to the fields we surface in the baseline.
    return {
      violations: r.violations.map(v => ({
        id:          v.id,
        impact:      v.impact,
        description: v.description,
        help:        v.help,
        helpUrl:     v.helpUrl,
        tags:        v.tags,
        nodeCount:   v.nodes.length,
        sampleNode:  v.nodes[0] && {
          target: v.nodes[0].target,
          html:   (v.nodes[0].html || '').slice(0, 200),
        },
      })),
      passCount:       r.passes.length,
      incompleteCount: r.incomplete.length,
      inapplicable:    r.inapplicable.length,
    };
    }, WCAG_TAGS);

    return { page: pagePath, ...result };
  } catch (err) {
    // Chromium dropping the tab reads as "Target crashed". Report it against
    // this page and let the run continue; summarize() counts it as UNAUDITED,
    // which is neither clean nor a violation.
    return { page: pagePath, error: err.message.split('\n')[0].slice(0, 200), violations: [] };
  } finally {
    await context.close().catch(() => {});
  }
}

function summarize(results) {
  const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const byRule   = {};
  let totalNodes = 0;

  // A page that could not be audited is NOT a page with no violations. Before
  // this it was skipped here and contributed nothing, so a page that failed to
  // load produced a clean summary and an exit code of 0 — the audit reporting
  // "no accessibility problems" about a page it never looked at.
  const unaudited = results.filter(r => r.error).map(r => ({ page: r.page, error: r.error }));

  for (const r of results) {
    if (r.error) continue;
    for (const v of r.violations) {
      const impact = v.impact || 'moderate';
      byImpact[impact] = (byImpact[impact] || 0) + v.nodeCount;
      byRule[v.id] = byRule[v.id] || { impact, help: v.help, nodeCount: 0, pages: [] };
      byRule[v.id].nodeCount += v.nodeCount;
      byRule[v.id].pages.push(r.page);
      totalNodes += v.nodeCount;
    }
  }

  return {
    byImpact, byRule, totalNodes,
    pageCount: results.length,
    auditedCount: results.length - unaudited.length,
    unaudited,
  };
}

function toMarkdown(results, summary) {
  const lines = [];
  lines.push('# WCAG 2.1 AA accessibility baseline — 2026');
  lines.push('');
  lines.push(`_Generated: ${new Date().toISOString()}_`);
  lines.push('');
  lines.push(`Audited ${summary.pageCount} page(s) via axe-core. Any regression from this baseline will appear in the diff of this file on the next weekly run.`);
  lines.push('');
  lines.push('## Summary by impact');
  lines.push('');
  lines.push('| Impact | Affected element count |');
  lines.push('|---|---:|');
  for (const impact of ['critical', 'serious', 'moderate', 'minor']) {
    lines.push(`| ${impact} | ${summary.byImpact[impact] || 0} |`);
  }
  lines.push(`| **Total** | **${summary.totalNodes}** |`);
  lines.push('');
  lines.push('## Summary by rule');
  lines.push('');
  lines.push('| Rule | Impact | Elements | Pages | Help |');
  lines.push('|---|---|---:|---:|---|');
  const rules = Object.entries(summary.byRule)
    .sort((a, b) => b[1].nodeCount - a[1].nodeCount);
  for (const [id, info] of rules) {
    lines.push(`| \`${id}\` | ${info.impact} | ${info.nodeCount} | ${info.pages.length} | ${info.help} |`);
  }
  lines.push('');
  lines.push('## Per-page detail');
  lines.push('');
  for (const r of results) {
    lines.push(`### ${r.page}`);
    lines.push('');
    if (r.error) {
      lines.push(`_Audit failed: ${r.error}_`);
      lines.push('');
      continue;
    }
    lines.push(`- Passing rules: **${r.passCount}**`);
    lines.push(`- Incomplete (needs manual check): **${r.incompleteCount}**`);
    lines.push(`- Violations: **${r.violations.length}** (${r.violations.reduce((s, v) => s + v.nodeCount, 0)} element(s))`);
    if (r.violations.length) {
      lines.push('');
      lines.push('| Rule | Impact | Elements | Help |');
      lines.push('|---|---|---:|---|');
      for (const v of r.violations.sort((a, b) => (b.nodeCount - a.nodeCount))) {
        lines.push(`| \`${v.id}\` | ${v.impact || '—'} | ${v.nodeCount} | ${v.help} |`);
      }
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const { pages, jsonOnly, quiet, singlePage } = parseArgs();

  let playwright;
  try { playwright = await import('playwright'); }
  catch {
    console.error('Playwright not installed. Run `npm ci` and `npx playwright install chromium`.');
    process.exit(1);
  }

  const axeScript = await locateAxeScript().catch(() => null);
  if (!axeScript) {
    console.error('axe-core not found in node_modules. Run `npm ci`.');
    process.exit(1);
  }

  if (!quiet) console.log(`[a11y-audit] auditing ${pages.length} page(s) via axe-core`);

  const browser = await playwright.chromium.launch();
  const results = [];
  for (const p of pages) {
    if (!quiet) process.stdout.write(`[a11y-audit] ${p} ... `);
    // One retry in a fresh context. These crashes are resource-related and
    // transient — the same commit passed and failed within a minute of itself.
    // A retry is not a fix for a real failure: if the second attempt also
    // fails, the page is reported UNAUDITED and the run exits non-zero.
    let r = await auditPage(browser, p, axeScript);
    if (r.error) {
      if (!quiet) process.stdout.write('retrying ... ');
      r = await auditPage(browser, p, axeScript);
    }
    results.push(r);
    if (!quiet) {
      if (r.error) console.log(`error: ${r.error}`);
      else        console.log(`${r.violations.length} violation(s), ${r.violations.reduce((s, v) => s + v.nodeCount, 0)} element(s)`);
    }
  }
  await browser.close();

  const summary = summarize(results);

  // Write outputs — but NOT for a single-page probe.
  //
  // `--page foo.html` used to overwrite the whole baseline with a one-page
  // result, so checking one page destroyed the record of the other twenty and
  // left a committable file claiming the site is one page long. Debugging a
  // single page should not rewrite the site's accessibility record.
  const jsonOut = path.join(ROOT, 'data', 'reports', 'a11y-baseline.json');
  const mdOut   = path.join(ROOT, 'docs', 'reports', 'a11y-baseline-2026.md');
  if (singlePage) {
    if (!quiet) console.log('[a11y-audit] single-page probe — baseline left untouched');
  } else {
    await fs.mkdir(path.dirname(jsonOut), { recursive: true });
    await fs.mkdir(path.dirname(mdOut),   { recursive: true });
    await fs.writeFile(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), summary, results }, null, 2));
    if (!jsonOnly) {
      await fs.writeFile(mdOut, toMarkdown(results, summary));
    }
  }

  if (!quiet) {
    console.log('');
    console.log(`Summary: ${summary.totalNodes} total violation element(s)`);
    console.log(`  critical: ${summary.byImpact.critical || 0}`);
    console.log(`  serious:  ${summary.byImpact.serious  || 0}`);
    console.log(`  moderate: ${summary.byImpact.moderate || 0}`);
    console.log(`  minor:    ${summary.byImpact.minor    || 0}`);
    console.log(`  audited:  ${summary.auditedCount}/${summary.pageCount} page(s)`);
    console.log(`Raw JSON:   ${path.relative(ROOT, jsonOut)}`);
    if (!jsonOnly) console.log(`Report:     ${path.relative(ROOT, mdOut)}`);
  }

  // Exit non-zero for pages nobody audited, with a message that says so rather
  // than implying a violation. A red axe should mean one specific thing.
  if (summary.unaudited.length > 0) {
    console.error('');
    console.error(`a11y-audit: ${summary.unaudited.length} page(s) could not be audited:`);
    for (const u of summary.unaudited) console.error(`  ${u.page} — ${u.error}`);
    console.error('');
    console.error('This is not a clean result and not a violation count. Those pages');
    console.error('were never looked at. Re-run, or reduce the page set if a page');
    console.error('genuinely cannot be loaded under file://.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('a11y-audit crashed:', err);
  process.exit(1);
});
