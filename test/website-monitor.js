#!/usr/bin/env node
/**
 * test/website-monitor.js
 * Zero-dependency link checker — crawls all HTML pages and verifies that
 * local asset references (CSS, JS, data, images) resolve.
 *
 * Usage:
 *   node test/website-monitor.js [rootDir]
 *
 * Defaults to the repo root.  Does NOT fetch remote URLs — only validates
 * that referenced local files exist on disk.
 *
 * Exit code: 0 = all links OK, 1 = broken links found.
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

/** Extract local asset references from an HTML file. */
function extractLocalRefs(htmlPath) {
  const content = fs.readFileSync(htmlPath, 'utf8');
  const refs = [];

  // src="..." and href="..." — skip anchors, protocols, data:, template literals
  const attrRe = /(?:src|href)=["']([^"']+)["']/gi;
  let m;
  while ((m = attrRe.exec(content)) !== null) {
    const ref = m[1].trim();
    if (!ref) continue;
    if (ref.startsWith('#') || ref.startsWith('//') || /^https?:/.test(ref)) continue;
    if (ref.startsWith('data:') || ref.startsWith('javascript:') || ref.startsWith('mailto:') || ref.startsWith('tel:')) continue;
    if (ref.includes('{{') || ref.includes('${')) continue;   // template
    // Strip query string and fragment
    const clean = ref.split('?')[0].split('#')[0];
    if (clean) refs.push(clean);
  }

  return [...new Set(refs)];
}

// ── Main ────────────────────────────────────────────────────────────

const htmlFiles = findHtmlFiles(ROOT);
console.log(`Scanning ${htmlFiles.length} HTML files in ${ROOT}\n`);

let totalRefs = 0;
let brokenCount = 0;
const broken = [];

for (const htmlFile of htmlFiles) {
  const relHtml = path.relative(ROOT, htmlFile);
  const htmlDir = path.dirname(htmlFile);
  const refs = extractLocalRefs(htmlFile);

  for (const ref of refs) {
    totalRefs++;
    // Resolve relative to the HTML file's directory
    const resolved = path.resolve(htmlDir, ref);
    if (!fs.existsSync(resolved)) {
      brokenCount++;
      broken.push({ page: relHtml, ref: ref, resolved: path.relative(ROOT, resolved) });
    }
  }
}

console.log(`Checked ${totalRefs} local references across ${htmlFiles.length} pages`);

if (broken.length > 0) {
  console.error(`\n❌ ${brokenCount} broken local references:\n`);
  for (const b of broken) {
    console.error(`  [${b.page}] → ${b.ref}  (missing: ${b.resolved})`);
  }
  process.exitCode = 1;
} else {
  console.log('\n✅ All local references resolve correctly');
}
