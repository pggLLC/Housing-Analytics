#!/usr/bin/env node
/**
 * scripts/sync-docs.mjs
 *
 * Automated documentation inventory generator.
 * Scans the repo and writes docs/GENERATED-INVENTORY.md
 *
 * Usage:
 *   node scripts/sync-docs.mjs
 *   npm run docs:sync
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { globSync } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : '(no title)';
}

function countGeoJsonFeatures(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.features)) return obj.features.length;
    if (obj && Array.isArray(obj)) return obj.length;
    return null;
  } catch {
    return null;
  }
}

function isValidJson(filePath) {
  try {
    JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return true;
  } catch {
    return false;
  }
}

function readGitignore() {
  const gi = path.join(ROOT, '.gitignore');
  if (!fs.existsSync(gi)) return '';
  return fs.readFileSync(gi, 'utf8');
}

// ---------------------------------------------------------------------------
// 1. Scan HTML pages
// ---------------------------------------------------------------------------

function scanHtmlPages() {
  const files = globSync('*.html', {
    cwd: ROOT,
    ignore: ['_dev/**', 'node_modules/**'],
  }).sort();

  const rows = files.map((f) => {
    const fullPath = path.join(ROOT, f);
    let title = '(unreadable)';
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      title = extractTitle(content);
    } catch { /* ignore */ }
    return `| \`${f}\` | ${title} |`;
  });

  return [
    `## HTML Pages (${files.length} total)\n`,
    '| File | Title |',
    '|------|-------|',
    ...rows,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 2. Scan data/ directory
// ---------------------------------------------------------------------------

function scanDataDirectory() {
  const dataDir = path.join(ROOT, 'data');
  if (!fs.existsSync(dataDir)) return '## Data Directory\n\n_data/ directory not found._\n\n';

  const files = globSync('**/*.{json,geojson}', {
    cwd: dataDir,
    nodir: true,
  }).sort();

  const rows = files.map((rel) => {
    const fullPath = path.join(dataDir, rel);
    let size = '?';
    let valid = '?';
    let features = '';
    try {
      const stat = fs.statSync(fullPath);
      size = formatBytes(stat.size);
      valid = isValidJson(fullPath) ? '✅' : '❌';
      if (rel.endsWith('.geojson') || rel.includes('chfa-lihtc') || rel.endsWith('.json')) {
        const fc = countGeoJsonFeatures(fullPath);
        if (fc !== null) features = `${fc} features`;
      }
    } catch { /* ignore */ }
    return `| \`data/${rel}\` | ${size} | ${valid} | ${features} |`;
  });

  return [
    `## Data Directory (${files.length} JSON/GeoJSON files)\n`,
    '| File | Size | Valid JSON | Features |',
    '|------|------|------------|----------|',
    ...rows,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 3. Scan test files
// ---------------------------------------------------------------------------

function scanTestFiles() {
  const testDirs = ['test', 'tests'];
  const rows = [];

  for (const dir of testDirs) {
    const absDir = path.join(ROOT, dir);
    if (!fs.existsSync(absDir)) continue;
    const files = globSync('**/*.{js,py,mjs}', {
      cwd: absDir,
      nodir: true,
    }).sort();
    for (const f of files) {
      const ext = path.extname(f).slice(1).toLowerCase();
      const type = ext === 'py' ? 'Python' : 'JavaScript';
      rows.push(`| \`${dir}/${f}\` | ${type} |`);
    }
  }

  return [
    `## Test Files (${rows.length} total)\n`,
    '| File | Type |',
    '|------|------|',
    ...rows,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 4. Scan workflows
// ---------------------------------------------------------------------------

function scanWorkflows() {
  const wfDir = path.join(ROOT, '.github', 'workflows');
  if (!fs.existsSync(wfDir)) return '## GitHub Actions Workflows\n\n_No workflows found._\n\n';

  const files = fs.readdirSync(wfDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();

  const rows = files.map((f) => {
    const fullPath = path.join(wfDir, f);
    let nameField = '';
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const m = content.match(/^name:\s*(.+)$/m);
      if (m) nameField = m[1].trim().replace(/^['"]|['"]$/g, '');
    } catch { /* ignore */ }
    return `| \`${f}\` | ${nameField} |`;
  });

  return [
    `## GitHub Actions Workflows (${files.length} total)\n`,
    '| File | Name |',
    '|------|------|',
    ...rows,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 5. Check .gitignore completeness
// ---------------------------------------------------------------------------

function checkGitignore() {
  const content = readGitignore();
  const checks = [
    ['.env', content.includes('.env')],
    ['node_modules/', content.includes('node_modules')],
    ['js/config.local.js', content.includes('config.local.js')],
    ['__pycache__/', content.includes('__pycache__')],
    ['*.pyc', content.includes('.pyc')],
    ['.DS_Store', content.includes('.DS_Store')],
  ];

  const rows = checks.map(([entry, present]) => `| \`${entry}\` | ${present ? '✅ Present' : '⚠️ Missing'} |`);

  return [
    '## .gitignore Completeness Check\n',
    '| Entry | Status |',
    '|-------|--------|',
    ...rows,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Assemble and write output
// ---------------------------------------------------------------------------

const timestamp = new Date().toISOString();

const sections = [
  `# COHO Analytics — Generated Inventory\n`,
  `> **Auto-generated:** ${timestamp}  `,
  `> Run \`npm run docs:sync\` to regenerate.\n`,
  '---\n',
  scanHtmlPages(),
  '---\n',
  scanDataDirectory(),
  '---\n',
  scanTestFiles(),
  '---\n',
  scanWorkflows(),
  '---\n',
  checkGitignore(),
];

const output = sections.join('\n');
const outPath = path.join(ROOT, 'docs', 'GENERATED-INVENTORY.md');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, output, 'utf8');

console.log(`✅  Written: ${outPath}`);
console.log(`    HTML pages, data files, test files, workflows, and .gitignore checked.`);
