#!/usr/bin/env node
/**
 * sync-docs.mjs — Unified audit, quarantine, and doc updater
 * - Generates docs/GENERATED-INVENTORY.md
 * - Moves unreferenced files to _audit/
 * - Rewrites _tobedeleted/ to _audit/ everywhere
 * - Updates "Actionable Recommendations" in key doc files
 */

import { readFileSync, writeFileSync, statSync, readdirSync, existsSync, renameSync, mkdirSync } from 'fs';
import { join, relative, extname, basename, dirname } from 'path';
import { glob } from 'glob';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = join(ROOT, 'docs', 'GENERATED-INVENTORY.md');
const now = new Date().toISOString();

const JS_DIR = join(ROOT, 'js');
const CSS_DIR = join(ROOT, 'css');
const SCRIPTS_DIR = join(ROOT, 'scripts');
const DOCS_DIR = join(ROOT, 'docs');
const AUDIT_DIR = join(ROOT, '_audit');

// 1. ==== Inventory functions (your original code, unchanged below) ====

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

// 2. ==== Quarantine, reference updates, actionable recommendations ====

// Utility—find all files with specific extensions recursively in a dir
function findFiles(dir, exts) {
  if (!existsSync(dir)) return [];
  let res = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, item.name);
    if (item.isDirectory()) res = res.concat(findFiles(p, exts));
    else if (exts.some(e => item.name.endsWith(e))) res.push(p);
  }
  return res;
}

// Quarantine dead/unreferenced files
function quarantineDeadFiles(dir, exts, docRefDirs) {
  const files = findFiles(dir, exts);
  const quarantine = [];
  for (const f of files) {
    if (f.includes('_audit')) continue;
    // Check if the file is referenced in HTML, JS, CSS, MD, YML, or Python files:
    const basename_ = basename(f);
    let referenced = false;
    for (const d of docRefDirs) {
      if (!existsSync(d)) continue;
      for (const test of findFiles(d, ['.html', '.js', '.css', '.md', '.yml', '.yaml', '.py'])) {
        if (readFileSync(test, 'utf8').includes(basename_)) {
          referenced = true;
          break;
        }
      }
      if (referenced) break;
    }
    if (!referenced) {
      const dest = join(AUDIT_DIR, dir.replace(ROOT + '/', ''), relative(dir, f));
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(f, dest);
      quarantine.push(dest);
    }
  }
  return quarantine;
}

// Update all _tobedeleted/ to _audit/
function rewriteReferences(rootDirs) {
  for (const dir of rootDirs) {
    if (!existsSync(dir)) continue;
    for (const f of findFiles(dir, ['.js', '.css', '.md', '.html', '.yml', '.yaml'])) {
      const content = readFileSync(f, 'utf8');
      if (content.includes('_tobedeleted')) {
        const updated = content.replace(/_tobedeleted/g, '_audit');
        writeFileSync(f, updated);
      }
    }
  }
}

// For docs: update actionable recommendations
function generateRecommendations() {
  let recs = [];
  // Scan for files in _audit:
  for (const d of [JS_DIR, CSS_DIR, SCRIPTS_DIR]) {
    const auditDir = join(AUDIT_DIR, d.replace(ROOT + '/', ''));
    if (existsSync(auditDir)) {
      for (const f of findFiles(auditDir, ['.js', '.css', '.py', '.mjs'])) {
        recs.push(`Archived file: \`${relative(ROOT, f)}\` — review and remove fully if unneeded.`);
      }
    }
  }
  recs.push('Docs and site-audit pipeline are automatically updated after every merge.');
  return recs;
}

function updateDocsWithRecs(docs, recs) {
  const blockHeader = '## Actionable Recommendations';
  const block = [blockHeader, '', ...recs.map(r => `- ${r}`), ''].join('\n');
  for (const d of docs) {
    if (!existsSync(d)) continue;
    let content = readFileSync(d, 'utf8');
    if (content.includes(blockHeader)) {
      content = content.replace(
        new RegExp(blockHeader + '[\\s\\S]*?(?:\n## |$)', 'g'),
        block + '\n## '
      );
    } else {
      content = content + '\n' + block + '\n';
    }
    writeFileSync(d, content);
  }
}

// ==== MAIN RUNNER ====

async function main() {
  // 1. Quarantine & fix references before inventory:
  const refDirs = [DOCS_DIR, ROOT, join(ROOT, 'test'), join(ROOT, 'tests'), join(ROOT, '.github')];
  quarantineDeadFiles(JS_DIR, ['.js'], refDirs);
  quarantineDeadFiles(CSS_DIR, ['.css'], refDirs);
  quarantineDeadFiles(SCRIPTS_DIR, ['.py'], refDirs);
  rewriteReferences([ROOT, JS_DIR, CSS_DIR, SCRIPTS_DIR, DOCS_DIR, join(ROOT, '.github'), join(ROOT, 'test')]);

  // 2. Docs actionable recommendation auto-update:
  const recommendations = generateRecommendations();
  const mainDocs = [
    join(DOCS_DIR, 'implementation-status.md'),
    join(DOCS_DIR, 'repo-audit-summary.md'),
    join(DOCS_DIR, 'SITE_AUDIT_GIS.md'),
    join(ROOT, 'README.md')
  ];
  updateDocsWithRecs(mainDocs, recommendations);

  // 3. Then regenerate main inventory:
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
