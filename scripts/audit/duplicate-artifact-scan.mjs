#!/usr/bin/env node
/**
 * scripts/audit/duplicate-artifact-scan.mjs — F(#1107)
 *
 * Why this exists
 * ----------------
 * When this repo lives under an iCloud-synced folder, sync conflicts create
 * "filename 2.ext", "filename 3.ext", etc. duplicates on disk (macOS Finder
 * save-as conflicts do the same for " 2." only). They're gitignored (see
 * "*\ [0-9].*" in .gitignore) so they can't be committed, but they still
 * distort local `find`/`ls`/glob-based counts and repo sweeps for whoever's
 * running them — 460 such files were found at audit time (2026-07-09), up
 * from 228 a day earlier.
 *
 * This is local-dev-only by design: CI clones a fresh checkout from git, so
 * these files never exist there. Warn-only, always exits 0 — never auto-
 * deletes, since a " 2."/" 3." file may represent a real unresolved sync
 * conflict a developer needs to look at before choosing which copy to keep.
 *
 * Usage:
 *   node scripts/audit/duplicate-artifact-scan.mjs
 *
 * Hooked into `npm run audit:duplicate-artifacts` (not part of test:ci —
 * see rationale above).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '_site', '.venv', '_tobedeleted', '_audit']);
const DUPLICATE_RE = / [0-9]+\.[a-zA-Z0-9]+$/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (DUPLICATE_RE.test(entry.name)) {
      out.push(path.relative(ROOT, full));
    }
  }
  return out;
}

const duplicates = walk(ROOT).sort();

if (duplicates.length === 0) {
  console.log('duplicate-artifact-scan: clean — no "name N.ext" duplicate files found.');
  process.exit(0);
}

console.log(`duplicate-artifact-scan: found ${duplicates.length} "name N.ext" duplicate file(s) in the working tree.`);
console.log('These are gitignored and cannot be committed, but they can distort local find/ls/glob-based counts.');
console.log('If this is an iCloud (or similar) sync-conflict folder, review and resolve the conflicts by hand — this script never deletes files.\n');
for (const f of duplicates.slice(0, 20)) {
  console.log(`  ${f}`);
}
if (duplicates.length > 20) {
  console.log(`  ...and ${duplicates.length - 20} more`);
}
process.exit(0);
