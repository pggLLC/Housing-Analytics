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
  return [
    '## Root HTML Pages',
    '',
    `${files.length} pages found.`,
    '',
    '| File | Title | Size |',
    '|------|-------|------|',
    ...rows,
  ].join('\n');
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
  return [
    '## Data Files (`data/**/*.json`)',
    '',
    `${files.length} JSON files found.`,
    '',
    '| File | Size | Valid JSON | Notes |',
    '|------|------|-----------|-------|',
    ...rows,
  ].join('\n');
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
    return '## GitHub Actions Workflows\n\n_No `.github/workflows/` directory found._';
  }
  const files = await glob('.github/workflows/*.yml', { cwd: ROOT, absolute: false });
  files.sort();
  const rows = files.map(f => {
    const size = fmtSize(statSync(join(ROOT, f)).size);
    return `| \`${f}\` | ${size} |`;
  });
  return [
    '## GitHub Actions Workflows',
    '',
    `${files.length} workflow files found.`,
    '',
    '| File | Size |',
    '|------|------|',
    ...rows,
  ].join('\n');
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  const html = await scanHtmlPages();
  const data = await scanDataFiles();
  const tests = await scanTestFiles();
  const workflows = await scanWorkflows();
  const gitignore = gitignoreSection();

  const content = [
    '# GENERATED-INVENTORY.md',
    '',
    `> **Auto-generated** by \`scripts/sync-docs.mjs\` on ${now}. Do not edit by hand.`,
    '',
    '---',
    '',
    html,
    '',
    '---',
    '',
    data,
    '',
    '---',
    '',
    tests,
    '',
    '---',
    '',
    workflows,
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
