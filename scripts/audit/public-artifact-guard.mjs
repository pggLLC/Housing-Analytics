#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SENSITIVE_PATTERNS } from '../lib/public-sensitive-patterns.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.resolve(ROOT, process.argv[2] || 'dist');

// One public record may print the developer's name, exactly as CHFA's 2022 Round One award
// report and award descriptions print it (paul, 2026-10-23). In this one file, each listed
// parties row is let through once, by role and name; a repeat or any other mention still fails.
const CHFA_RECORD_ONLY = {
  'data/deals/fruita-mews-fruita.json': [
    { role: "Owner (as CHFA's award report prints it)", name: 'Indibuild llc' },
    { role: "Developer (as CHFA's award description prints it)", name: 'Indibuild LLC' }
  ]
};

function withoutChfaQuotes(rel, content) {
  const allowed = CHFA_RECORD_ONLY[rel];
  if (!allowed) return content;
  let rec;
  try { rec = JSON.parse(content); } catch { return content; }
  // The exception holds only for the file exactly as the deal builder writes it (indent 1,
  // no escaped letters, no repeated keys), so the parsed record is the whole raw text.
  if (content !== JSON.stringify(rec, null, 1) + '\n') return content;
  const left = [...allowed];
  rec.parties = (rec.parties || []).map((p) => {
    const i = left.findIndex((a) => a.role === p?.role && a.name === p?.name);
    if (i < 0) return p;
    left.splice(i, 1);
    return { ...p, name: '' };
  });
  // Every remaining key and value, reduced to its letters and digits, must not spell the
  // developer's name, so no invisible, control or spacing character can hide one.
  const strings = [];
  (function walk(v) {
    if (typeof v === 'string') strings.push(v);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { strings.push(k); walk(x); }
  })(rec);
  const letters = strings.map((s) => s.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '')).join(' ');
  // a hidden mention fails outright: the returned text names the developer plainly
  if (/indibuild/i.test(letters)) return 'indibuild (obscured mention)';
  return JSON.stringify(rec, null, 1);
}

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
  'internal',
  '__MACOSX',
  'indibuild.html',
  'indibuild-where.html',
  'indibuild-pipeline.html',
  'indibuild-brief.html',
  'developer.html',
  'developer-where.html',
  'developer-pipeline.html',
  'developer-brief.html',
  'developer-whitepaper.html',
  'developer-methods.html',
  'developer-about.html',
  'developer-round-watch.html',
  'developer-submittal-review.html',
  'developer-deal-workbook.html',
  'js/indibuild-gate.js',
  'js/developer-gate.js',
  'js/where-to-build.js',
  'docs/indibuild-pipeline-prototype',
  'docs/developer-pipeline-prototype',
  'docs/security',
  'docs/audit',
  'docs/audits',
  'docs/codex-audits',
  'docs/qa',
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
  'data/co-housing-costs/qcew_construction_state.json',
  'js/components/jurisdiction-brief.js',
  'js/components/pipeline-add-button.js',
  'js/components/pipeline-store.js',
  'js/components/private-workspace.js',
  'js/whitepaper'
];

const FORBIDDEN_REFERENCES = [
  'indibuild.html',
  'indibuild-where.html',
  'indibuild-pipeline.html',
  'indibuild-brief.html',
  'developer.html',
  'developer-where.html',
  'developer-pipeline.html',
  'developer-brief.html',
  'developer-whitepaper.html',
  'developer-methods.html',
  'developer-about.html',
  'developer-round-watch.html',
  'developer-submittal-review.html',
  'developer-deal-workbook.html',
  'js/indibuild-gate.js',
  'js/developer-gate.js',
  'docs/indibuild-pipeline-prototype/',
  'docs/developer-pipeline-prototype/',
  'data/reports/indibuild-url-health.json',
  'data/reports/developer-url-health.json'
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

    const content = withoutChfaQuotes(file.rel, await readFile(file.abs, 'utf8').catch(() => ''));
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
