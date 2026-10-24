#!/usr/bin/env node
/**
 * One glossary: data/glossary.json holds every term's definitions, and the
 * other places that show a definition are written from it.
 *
 *   - `definition`: the header glossary pop-up (js/glossary.js reads the JSON).
 *   - `short`: the inline tooltip (the TERMS list in
 *     js/components/inline-glossary.js, written here so the tooltips need no
 *     fetch) and the one-line summary of any info callout
 *     (data/core/educational-content.json entry with a `glossary` key). The
 *     callouts keep their own notes for elected officials, developers and
 *     lenders; only the summary comes from here.
 *   - `inline_key`: the tooltip's key when it differs from `term`.
 *   - `autolink: false`: listed in the pop-up and used for tooltips, but not
 *     auto-wrapped on every page by js/glossary.js.
 *
 *   node scripts/sync-glossary.mjs           # rewrite the copies
 *   node scripts/sync-glossary.mjs --check   # exit 1 if a copy differs
 *
 * test/glossary-sync.test.mjs runs the check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GLOSSARY = 'data/glossary.json';
export const INLINE = 'js/components/inline-glossary.js';
export const CALLOUTS = 'data/core/educational-content.json';

const START = '  var TERMS = {\n';
const END = '\n  };\n';

const jsString = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** The TERMS object literal body, one line per term with a short definition. */
export function termsBlock(glossary) {
  const seen = new Set();
  const lines = [];
  for (const t of glossary.terms) {
    if (!t.short) continue;
    const key = t.inline_key || t.term;
    if (seen.has(key)) throw new Error(`two glossary entries use the tooltip key "${key}"`);
    seen.add(key);
    lines.push(`    ${jsString(key)}: ${jsString(t.short)}`);
  }
  return lines.join(',\n');
}

export function writeInline(src, glossary) {
  const s = src.indexOf(START);
  if (s < 0) throw new Error(`${INLINE}: no "var TERMS = {" block`);
  const e = src.indexOf(END, s);
  return src.slice(0, s + START.length) + termsBlock(glossary) + src.slice(e);
}

/** Each callout entry linked to a glossary term gets that term's short text. */
export function writeCallouts(text, glossary) {
  const byKey = new Map();
  for (const t of glossary.terms) byKey.set(t.inline_key || t.term, t);
  return text.replace(/("glossary": "([^"]+)",\n(\s*)"short": )("(?:[^"\\]|\\.)*")/g, (m, head, key, _ind, _old) => {
    const t = byKey.get(key);
    if (!t || !t.short) throw new Error(`${CALLOUTS}: "${key}" has no short definition in ${GLOSSARY}`);
    return head + JSON.stringify(t.short);
  });
}

export function plan(root = ROOT) {
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const glossary = JSON.parse(read(GLOSSARY));
  const out = new Map();
  for (const [rel, fn] of [[INLINE, writeInline], [CALLOUTS, writeCallouts]]) {
    const before = read(rel);
    const after = fn(before, glossary);
    if (after !== before) out.set(rel, after);
  }
  return out;
}

function main() {
  const changes = plan();
  if (process.argv.includes('--check')) {
    for (const rel of changes.keys()) console.error(`${rel} differs from ${GLOSSARY}; run node scripts/sync-glossary.mjs`);
    process.exit(changes.size ? 1 : 0);
  }
  for (const [rel, text] of changes) fs.writeFileSync(path.join(ROOT, rel), text);
  console.log(`rewrote ${changes.size} file(s) from ${GLOSSARY}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
