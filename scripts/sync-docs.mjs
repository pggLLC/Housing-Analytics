#!/usr/bin/env node
/**
 * sync-docs.mjs
 * Generates docs/GENERATED-INVENTORY.md by scanning:
 *   - Root HTML pages (extracts <title>)
 *   - data/**\/*.json files (size, valid JSON, feature count for GeoJSON)
 *   - test/ and tests/ directories
 *   - .github/workflows/ directory
 *   - .gitignore completeness check
 *
 * Also refreshes the auto-sync banner in every deprecated/superseded doc so
 * they always show the current date and live repo stats rather than going stale.
 * Banner blocks are delimited by HTML comments:
 *   <!-- sync-banner:start --> … <!-- sync-banner:end -->
 *
 * Usage: node scripts/sync-docs.mjs
 * npm script: "docs:sync"
 */

import { readFileSync, writeFileSync, statSync, readdirSync, existsSync } from 'fs';
import { join, relative, extname, basename } from 'path';
import { glob } from 'glob';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = join(ROOT, 'docs', 'GENERATED-INVENTORY.md');

const now = new Date().toISOString();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function safeReadJson(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return { ok: true, parsed };
  } catch {
    return { ok: false, parsed: null };
  }
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : '(no title)';
}

function featureCount(parsed) {
  if (parsed && parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
    return parsed.features.length;
  }
  return null;
}

function checkGitignore() {
  const gitignorePath = join(ROOT, '.gitignore');
  if (!existsSync(gitignorePath)) return { exists: false, entries: [] };
  const lines = readFileSync(gitignorePath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  const required = ['js/config.local.js', '.env', '.env.local', 'node_modules/'];
  const missing = required.filter(r => !lines.some(l => l === r || l.startsWith(r)));
  return { exists: true, lines, missing };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

async function scanHtmlPages() {
  const files = await glob('*.html', { cwd: ROOT, absolute: false });
  files.sort();
  const rows = [];
  for (const f of files) {
    const fullPath = join(ROOT, f);
    const html = readFileSync(fullPath, 'utf8');
    const title = extractTitle(html);
    const size = fmtSize(statSync(fullPath).size);
    rows.push(`| \`${f}\` | ${title} | ${size} |`);
  }
  const markdown = [
    '## Root HTML Pages',
    '',
    `${files.length} pages found.`,
    '',
    '| File | Title | Size |',
    '|------|-------|------|',
    ...rows,
  ].join('\n');
  return { markdown, count: files.length };
}

async function scanDataFiles() {
  const files = await glob('data/**/*.json', { cwd: ROOT, absolute: false });
  files.sort();
  const rows = [];
  for (const f of files) {
    const fullPath = join(ROOT, f);
    const size = fmtSize(statSync(fullPath).size);
    const { ok, parsed } = safeReadJson(fullPath);
    const validJson = ok ? '✅' : '❌';
    const fc = ok ? featureCount(parsed) : null;
    const features = fc !== null ? `${fc} features` : (ok ? '—' : 'invalid JSON');
    rows.push(`| \`${f}\` | ${size} | ${validJson} | ${features} |`);
  }
  const markdown = [
    '## Data Files (`data/**/*.json`)',
    '',
    `${files.length} JSON files found.`,
    '',
    '| File | Size | Valid JSON | Notes |',
    '|------|------|-----------|-------|',
    ...rows,
  ].join('\n');
  return { markdown, count: files.length };
}

async function scanTestFiles() {
  const testDirs = ['test', 'tests'];
  const rows = [];
  let total = 0;
  for (const dir of testDirs) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    const files = await glob(`${dir}/**/*`, { cwd: ROOT, absolute: false, nodir: true });
    files.sort();
    for (const f of files) {
      const size = fmtSize(statSync(join(ROOT, f)).size);
      rows.push(`| \`${f}\` | ${size} |`);
      total++;
    }
  }
  return [
    '## Test Files',
    '',
    `${total} test files found.`,
    '',
    '| File | Size |',
    '|------|------|',
    ...rows,
  ].join('\n');
}

async function scanWorkflows() {
  const dir = join(ROOT, '.github', 'workflows');
  if (!existsSync(dir)) {
    return { markdown: '## GitHub Actions Workflows\n\n_No `.github/workflows/` directory found._', count: 0 };
  }
  const files = await glob('.github/workflows/*.yml', { cwd: ROOT, absolute: false });
  files.sort();
  const rows = files.map(f => {
    const size = fmtSize(statSync(join(ROOT, f)).size);
    return `| \`${f}\` | ${size} |`;
  });
  const markdown = [
    '## GitHub Actions Workflows',
    '',
    `${files.length} workflow files found.`,
    '',
    '| File | Size |',
    '|------|------|',
    ...rows,
  ].join('\n');
  return { markdown, count: files.length };
}

function gitignoreSection() {
  const { exists, missing } = checkGitignore();
  if (!exists) {
    return '## .gitignore Completeness\n\n⚠️ `.gitignore` not found.';
  }
  if (missing.length === 0) {
    return '## .gitignore Completeness\n\n✅ All required entries present.';
  }
  return [
    '## .gitignore Completeness',
    '',
    '⚠️ Missing recommended entries:',
    '',
    ...missing.map(m => `- \`${m}\``),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Deprecated-doc banner refresh
// ---------------------------------------------------------------------------

const BANNER_START = '<!-- sync-banner:start -->';
const BANNER_END   = '<!-- sync-banner:end -->';

/**
 * Docs that carry a "superseded" notice.  Each entry describes the file,
 * which canonical doc to point to, and optional secondary references.
 */
const DEPRECATED_DOCS = [
  {
    path: 'docs/DATA_SOURCES_TABLE.md',
    canonical: 'SITE_AUDIT_GIS.md',
    reason: 'authoritative data source catalog',
  },
  {
    path: 'docs/data-sources-audit.md',
    canonical: 'SITE_AUDIT_GIS.md',
    reason: 'authoritative data source audit',
  },
  {
    path: 'docs/data-architecture.md',
    canonical: 'GIS_DATA_MODEL.md',
    reason: 'authoritative data architecture reference',
    also: 'SITE_AUDIT_GIS.md',
  },
  {
    path: 'docs/implementation-status.md',
    canonical: 'FEATURE_COMPLETE.md',
    reason: 'current feature status matrix',
  },
  {
    path: 'docs/SITE-DESIGN-AUDIT.md',
    canonical: 'SITE_AUDIT_GIS.md',
    reason: 'current platform audit',
  },
];

/**
 * Build the blockquote banner text for a deprecated doc.
 * @param {{ canonical: string, reason: string, also?: string }} entry
 * @param {{ date: string, htmlCount: number, dataFileCount: number, workflowCount: number }} stats
 */
function makeBanner(entry, stats) {
  const statsLine = `${stats.htmlCount} pages · ${stats.dataFileCount} data files · ${stats.workflowCount} workflows`;
  const alsoNote  = entry.also
    ? ` Also see [\`${entry.also}\`](${entry.also}).`
    : '';

  return [
    BANNER_START,
    `> **⚠️ Superseded** — See [\`${entry.canonical}\`](${entry.canonical}) for the ${entry.reason}.${alsoNote}  `,
    `> *Auto-synced ${stats.date} by \`scripts/sync-docs.mjs\` · ${statsLine}*`,
    BANNER_END,
  ].join('\n');
}

/**
 * Read each deprecated doc, replace (or insert) the sync-banner block, and
 * write it back.  Returns the number of files updated.
 */
function syncDeprecatedBanners(stats) {
  let updated = 0;
  for (const entry of DEPRECATED_DOCS) {
    const filePath = join(ROOT, entry.path);
    if (!existsSync(filePath)) {
      console.warn(`  ⚠️  ${entry.path} not found — skipping banner sync`);
      continue;
    }

    let content = readFileSync(filePath, 'utf8');
    const newBanner = makeBanner(entry, stats);

    if (content.includes(BANNER_START)) {
      const startIdx = content.indexOf(BANNER_START);
      const endIdx   = content.indexOf(BANNER_END, startIdx);
      if (endIdx === -1) {
        console.warn(`  ⚠️  ${entry.path}: sync-banner:start found but no end marker — skipping`);
        continue;
      }
      content =
        content.slice(0, startIdx) +
        newBanner +
        content.slice(endIdx + BANNER_END.length);
    } else {
      // No marker yet — prepend banner before the first heading or content
      content = newBanner + '\n\n' + content;
    }

    writeFileSync(filePath, content, 'utf8');
    updated++;
    console.log(`  ↻  Refreshed banner in ${entry.path}`);
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Run scans once — each returns { markdown, count } so we can build
  // the stats object without duplicate glob calls.
  const htmlResult = await scanHtmlPages();
  const dataResult = await scanDataFiles();
  const testsResult = await scanTestFiles();
  const wfResult   = await scanWorkflows();
  const gitignore  = gitignoreSection();

  const stats = {
    date: now.slice(0, 10),                // YYYY-MM-DD  (now is module-scope)
    htmlCount: htmlResult.count,
    dataFileCount: dataResult.count,
    workflowCount: wfResult.count,
  };

  // Refresh deprecated-doc banners first so the counts are consistent with
  // what we're about to write into GENERATED-INVENTORY.md.
  console.log('Refreshing deprecated-doc banners…');
  const refreshed = syncDeprecatedBanners(stats);
  console.log(`  ${refreshed} banner(s) refreshed\n`);

  const content = [
    '# GENERATED-INVENTORY.md',
    '',
    `> **Auto-generated** by \`scripts/sync-docs.mjs\` on ${now}. Do not edit by hand.`,
    '',
    '---',
    '',
    htmlResult.markdown,
    '',
    '---',
    '',
    dataResult.markdown,
    '',
    '---',
    '',
    testsResult,
    '',
    '---',
    '',
    wfResult.markdown,
    '',
    '---',
    '',
    gitignore,
    '',
  ].join('\n');

  writeFileSync(OUT, content, 'utf8');
  console.log(`✅ Generated ${relative(ROOT, OUT)} (${fmtSize(Buffer.byteLength(content, 'utf8'))})`);
}

main().catch(err => {
  console.error('❌ sync-docs.mjs failed:', err.message);
  process.exit(1);
});
