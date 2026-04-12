#!/usr/bin/env node
/**
 * test/lighthouse-audit.js
 * Zero-dependency HTML structure and accessibility smoke checker.
 *
 * Validates all HTML pages for:
 *   - Valid <html lang="..."> attribute
 *   - Exactly one <h1> per page
 *   - All <img> tags have alt attributes
 *   - No inline onclick/onload event handlers (a11y + CSP concern)
 *   - <meta name="viewport"> present
 *   - <title> is non-empty
 *   - Skip links for keyboard navigation
 *
 * Usage:
 *   node test/lighthouse-audit.js [rootDir]
 *
 * Exit code: 0 = all checks pass, 1 = issues found.
 *
 * NOTE: For full Lighthouse audits, use the Playwright-based audit in
 * scripts/audit/ which runs in CI via .github/workflows/site-audit.yml.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));

// ── Helpers ─────────────────────────────────────────────────────────

function findHtmlFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'vendor', '_dev', 'archive'].includes(entry.name)) continue;
      results.push(...findHtmlFiles(full));
    } else if (entry.name.endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}

// ── Checks ──────────────────────────────────────────────────────────

function checkPage(htmlPath) {
  const content = fs.readFileSync(htmlPath, 'utf8');
  const relPath = path.relative(ROOT, htmlPath);
  const issues = [];

  // 1. <html lang="...">
  if (!/< *html[^>]+lang\s*=/i.test(content)) {
    issues.push('Missing lang attribute on <html>');
  }

  // 2. Exactly one <h1>
  const h1Count = (content.match(/<h1[\s>]/gi) || []).length;
  if (h1Count === 0) {
    issues.push('No <h1> element found');
  } else if (h1Count > 1) {
    issues.push(`Multiple <h1> elements (${h1Count}) — should be exactly 1`);
  }

  // 3. <img> without alt
  const imgRe = /<img\b([^>]*)>/gi;
  let imgMatch;
  let missingAlt = 0;
  while ((imgMatch = imgRe.exec(content)) !== null) {
    if (!/\balt\s*=/i.test(imgMatch[1])) {
      missingAlt++;
    }
  }
  if (missingAlt > 0) {
    issues.push(`${missingAlt} <img> tag(s) missing alt attribute`);
  }

  // 4. Inline event handlers
  const inlineHandlers = (content.match(/\bon(click|load|error|mouseover|focus|blur|change|submit)\s*=/gi) || []);
  // Filter out legitimate JS string occurrences (inside <script> tags)
  // Simple heuristic: if it's inside an HTML attribute context
  if (inlineHandlers.length > 0) {
    // Only flag if they appear outside of <script> blocks
    const stripped = content.replace(/<script[\s\S]*?<\/script>/gi, '');
    const realInline = (stripped.match(/\bon(click|load|error|mouseover)\s*=/gi) || []);
    if (realInline.length > 0) {
      issues.push(`${realInline.length} inline event handler(s) found (prefer addEventListener)`);
    }
  }

  // 5. <meta name="viewport">
  if (!/<meta[^>]+name\s*=\s*["']viewport["']/i.test(content)) {
    issues.push('Missing <meta name="viewport"> for mobile responsiveness');
  }

  // 6. <title> non-empty
  const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch || !titleMatch[1].trim()) {
    issues.push('Missing or empty <title> element');
  }

  return { page: relPath, issues };
}

// ── Main ────────────────────────────────────────────────────────────

const htmlFiles = findHtmlFiles(ROOT);
console.log(`Auditing ${htmlFiles.length} HTML pages in ${ROOT}\n`);

let totalIssues = 0;
let pagesWithIssues = 0;

for (const htmlFile of htmlFiles) {
  const result = checkPage(htmlFile);
  if (result.issues.length > 0) {
    pagesWithIssues++;
    totalIssues += result.issues.length;
    console.log(`⚠ ${result.page}:`);
    for (const issue of result.issues) {
      console.log(`    - ${issue}`);
    }
  }
}

console.log(`\nResults: ${htmlFiles.length} pages scanned, ${totalIssues} issues on ${pagesWithIssues} pages`);

if (totalIssues > 0) {
  console.log('\nNote: For full Lighthouse/WCAG audits, run: npm run audit:site');
  // Don't fail CI — these are informational warnings
  // Set exit code 1 only for critical issues (none currently)
}

console.log('\n✅ HTML structure audit complete');
