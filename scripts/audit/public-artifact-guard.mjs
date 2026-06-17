#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.resolve(ROOT, process.argv[2] || 'dist');

const FORBIDDEN_PATHS = [
  '.git',
  '.github',
  '.agents',
  '.codex',
  '.claude',
  'node_modules',
  'scripts',
  'test',
  'tests',
  'tools',
  'serverless',
  'cloudflare-worker',
  'work',
  'out',
  'audit-report',
  'archive',
  'private',
  '__MACOSX',
  'indibuild.html',
  'indibuild-where.html',
  'indibuild-pipeline.html',
  'indibuild-brief.html',
  'js/indibuild-gate.js',
  'docs/indibuild-pipeline-prototype',
  'docs/security',
  'data/reports',
  'data/discovery-reports',
  'data/audit',
  'data/jurisdiction-briefs',
  'data/hna/source',
  'data/zillow',
  'data/url-health.json',
  'data/co-housing-costs/acs_county_latest.parquet',
  'data/co-housing-costs/bls_series.parquet',
  'data/co-housing-costs/fhfa_hpi_county_raw.parquet',
  'data/co-housing-costs/permits_county.parquet',
  'data/co-housing-costs/qcew_construction_county.parquet',
  'data/co-housing-costs/drivers_ranking.csv',
  'data/co-housing-costs/README.md',
  'js/components/jurisdiction-brief.js',
  'js/components/pipeline-add-button.js',
  'js/components/pipeline-store.js'
];

const FORBIDDEN_REFERENCES = [
  'indibuild.html',
  'indibuild-where.html',
  'indibuild-pipeline.html',
  'indibuild-brief.html',
  'js/indibuild-gate.js',
  'docs/indibuild-pipeline-prototype/',
  'data/reports/indibuild-url-health.json'
];

const SENSITIVE_PATTERNS = [
  { label: 'default IndiBuild password', regex: /DEFAULT PASSWORD/i },
  { label: 'IndiBuild gate implementation', regex: /IndiBuild Password Gate/i },
  { label: 'pipeline relationship tier field', regex: /\brelationship_tier\b/i },
  { label: 'pipeline anti-targets file', regex: /\banti-targets\b/i },
  { label: 'pipeline next action field', regex: /\bnext_action\b/i },
  { label: 'local draft pipeline badge', regex: /\bLocal draft\b/i },
  { label: 'contact CSV email/phone fields', regex: /\bemail,phone\b/i },
  { label: 'network contact fields', regex: /\bphone,last_talked,relationship_tier\b/i },
  { label: 'legacy IndiBuild password', regex: /\bsalida2026\b/i }
];

const TEXT_EXTENSIONS = new Set([
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.md',
  '.svg',
  '.txt',
  '.xml',
  ''
]);

const REFERENCE_SCAN_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.xml',
  ''
]);

function toPosix(absPath) {
  return path.relative(DIST, absPath).split(path.sep).join('/');
}

function isForbiddenPath(relPath) {
  if (relPath.split('/').some((part) => /(^\._| 2($|\.))/.test(part))) return true;
  if (path.extname(relPath).toLowerCase() === '.parquet') return true;
  return FORBIDDEN_PATHS.some((blocked) => relPath === blocked || relPath.startsWith(`${blocked}/`));
}

async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = toPosix(abs);
    if (isForbiddenPath(rel)) {
      files.push({ rel, forbiddenPath: true });
      continue;
    }
    if (entry.isDirectory()) {
      await walk(abs, files);
    } else if (entry.isFile()) {
      files.push({ rel, abs, forbiddenPath: false });
    }
  }
  return files;
}

async function main() {
  const info = await stat(DIST).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`Public artifact directory not found: ${DIST}`);
  }

  const findings = [];
  const files = await walk(DIST);

  for (const file of files) {
    if (file.forbiddenPath) {
      findings.push(`${file.rel}: forbidden path is present`);
      continue;
    }

    const ext = path.extname(file.rel).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;

    const content = await readFile(file.abs, 'utf8').catch(() => '');
    if (REFERENCE_SCAN_EXTENSIONS.has(ext) || ext === '.json' || file.rel === '_headers' || file.rel === 'robots.txt') {
      for (const ref of FORBIDDEN_REFERENCES) {
        if (content.includes(ref)) {
          findings.push(`${file.rel}: references forbidden private path ${ref}`);
        }
      }
    }
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.regex.test(content)) {
        findings.push(`${file.rel}: contains ${pattern.label}`);
      }
    }
  }

  if (findings.length) {
    console.error('Public artifact guard failed:');
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exit(1);
  }

  console.log(`Public artifact guard passed (${files.filter((f) => !f.forbiddenPath).length} files checked).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
