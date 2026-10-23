#!/usr/bin/env node
/**
 * The five HNA chapter pages repeat sections of housing-needs-assessment.html
 * (head scripts, geography picker, method notes, the Prop 123 checklist, the
 * scripts at the foot of the page). Each repeated section is wrapped in
 *
 *   <!-- shared:NN · edit in housing-needs-assessment.html, ... -->
 *   ...
 *   <!-- /shared:NN -->
 *
 * on every page that carries it. housing-needs-assessment.html holds the
 * master copy; this script copies each master section into the other pages:
 *
 *   node scripts/sync-hna-shared.mjs           # rewrite the chapter pages
 *   node scripts/sync-hna-shared.mjs --check   # exit 1 if a copy differs
 *
 * test/hna-shared-sync.test.mjs runs the check. To change a shared section,
 * edit it in housing-needs-assessment.html and run this script; to stop
 * sharing one, remove its markers from every page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MASTER = 'housing-needs-assessment.html';
export const PAGES = [
  'hna-who-lives-here.html', 'hna-what-housing-exists.html', 'hna-what-households-can-afford.html',
  'hna-where-its-heading.html', 'hna-what-to-do.html',
];

const BLOCK = /(<!-- shared:(\d{2})\b[^>]*-->\n)([\s\S]*?)(\n<!-- \/shared:\2 -->)/g;

/** name → section body, from one page's text. */
export function sections(text, file = '') {
  const out = new Map();
  for (const m of text.matchAll(BLOCK)) {
    if (out.has(m[2])) throw new Error(`${file}: shared:${m[2]} appears twice`);
    out.set(m[2], m[3]);
  }
  const opens = (text.match(/<!-- shared:\d{2}\b/g) || []).length;
  if (opens !== out.size) throw new Error(`${file}: a shared marker has no matching /shared end`);
  return out;
}

/** The page text with every shared section replaced by the master's. */
export function syncPage(text, master, file = '') {
  const own = sections(text, file);
  for (const name of own.keys()) {
    if (!master.has(name)) throw new Error(`${file}: shared:${name} is not in ${MASTER}`);
  }
  return text.replace(BLOCK, (all, open, name, _body, close) => open + master.get(name) + close);
}

export function plan(read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')) {
  const master = sections(read(MASTER), MASTER);
  const out = new Map();
  for (const page of PAGES) {
    const before = read(page);
    const after = syncPage(before, master, page);
    if (after !== before) out.set(page, after);
  }
  return { master, changes: out };
}

function main() {
  const { changes } = plan();
  if (process.argv.includes('--check')) {
    for (const p of changes.keys()) console.error(`${p}: a shared section differs from ${MASTER}; run node scripts/sync-hna-shared.mjs`);
    process.exit(changes.size ? 1 : 0);
  }
  for (const [p, text] of changes) fs.writeFileSync(path.join(ROOT, p), text);
  console.log(`rewrote ${changes.size} page(s) from ${MASTER}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
