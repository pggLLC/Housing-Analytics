#!/usr/bin/env node
/**
 * Keep the prose of methods.html tied to the code it specifies.
 *
 * methods.html already cannot misquote a constant: every weight and threshold
 * it prints is read out of source by extract-model-parameters.mjs, and CI
 * fails when one moves. What that does not catch is a change of SHAPE. On
 * 2026-09-17 (#1733) gap pressure became the larger of a resident reading and
 * a new workforce reading, and two days later (#1771) the 20-year figure took
 * the same maximum. Every weight stayed where it was, so nothing failed, and
 * §06 went on printing a formula with no workforce term while the workforce
 * reading drove the gap score of 265 of 546 jurisdictions.
 *
 * So each section of methods.html names the code it describes, and this
 * records a fingerprint of that code as of the last time someone read the two
 * side by side. When the code changes, the fingerprint no longer matches and
 * test/methods-spec-sources.test.mjs fails, naming the section to re-read.
 * After re-reading it (and fixing the page if it is now wrong):
 *
 *   node scripts/paper/methods-spec.mjs --record m-score   # one section
 *   node scripts/paper/methods-spec.mjs --check            # what the test runs
 *
 * --record takes a section id, never "all": re-blessing every section at once
 * is how a review step turns into a rubber stamp.
 *
 * A fingerprint ignores blank lines and comment-only lines, so rewording a
 * comment does not demand a review. Anything that executes does.
 *
 * Code is named by function (`def name` in Python, `function name` in JS) or,
 * where the relevant logic sits inside a long function, by a region between
 * `methods-spec:begin <name>` and `methods-spec:end <name>` comments.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGISTRY = path.join(ROOT, 'scripts', 'paper', 'methods-spec-sources.json');
export const PAGE = path.join(ROOT, 'methods.html');

const isPython = (file) => file.endsWith('.py');

function isCommentOnly(line, file) {
  const t = line.trim();
  if (isPython(file)) return t.startsWith('#');
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*');
}

/** The lines of one function or marked region, or null with a reason. */
export function extract(src, file, { function: fn, region }) {
  const lines = src.split('\n');
  if (region) {
    const b = lines.findIndex((l) => l.includes(`methods-spec:begin ${region}`));
    const e = lines.findIndex((l) => l.includes(`methods-spec:end ${region}`));
    if (b < 0 || e < 0 || e <= b) return { error: `region "${region}" has no begin/end markers in ${file}` };
    return { lines: lines.slice(b + 1, e) };
  }
  if (isPython(file)) {
    const b = lines.findIndex((l) => new RegExp(`^def ${fn}\\s*\\(`).test(l));
    if (b < 0) return { error: `no top-level def ${fn} in ${file}` };
    let e = b + 1;
    // The function ends at the next top-level statement. A `) -> T:` closing
    // a wrapped signature and a column-0 comment both sit at column 0 without
    // ending anything, so only a name, keyword or decorator counts.
    while (e < lines.length && !/^[A-Za-z_@]/.test(lines[e])) e += 1;
    // Trailing column-0 comments belong to whatever follows.
    while (e > b + 1 && (lines[e - 1].trim() === '' || lines[e - 1].startsWith('#'))) e -= 1;
    return { lines: lines.slice(b, e) };
  }
  const b = lines.findIndex((l) => new RegExp(`\\bfunction ${fn}\\s*\\(`).test(l));
  if (b < 0) return { error: `no function ${fn} in ${file}` };
  const indent = lines[b].match(/^\s*/)[0];
  let e = b + 1;
  while (e < lines.length && !lines[e].startsWith(`${indent}}`)) e += 1;
  if (e >= lines.length) return { error: `function ${fn} in ${file} has no closing brace at its own indent` };
  return { lines: lines.slice(b, e + 1) };
}

export function fingerprint(lines, file) {
  const kept = lines
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '' && !isCommentOnly(l, file));
  return createHash('sha256').update(kept.join('\n')).digest('hex').slice(0, 16);
}

/** The byline date: the OLDEST section review, since that is what holds for every section. */
export const REVIEWED_RE = /(<time data-spec-reviewed>)[^<]*(<\/time>)/;
export function oldestReview(registry) {
  const dates = registry.sections.filter((s) => s.sources.length).map((s) => s.reviewed || '');
  return dates.sort()[0] || '';
}

export function loadRegistry() {
  return JSON.parse(readFileSync(REGISTRY, 'utf8'));
}

/** Every source in the registry with its current fingerprint (or error). */
export function evaluate(registry = loadRegistry()) {
  const out = [];
  for (const section of registry.sections) {
    for (const s of section.sources) {
      const label = `${s.file} ${s.function ? `${s.function}()` : `[${s.region}]`}`;
      const abs = path.join(ROOT, s.file);
      if (!existsSync(abs)) { out.push({ section, source: s, label, error: `${s.file} does not exist` }); continue; }
      const got = extract(readFileSync(abs, 'utf8'), s.file, s);
      if (got.error) { out.push({ section, source: s, label, error: got.error }); continue; }
      out.push({ section, source: s, label, current: fingerprint(got.lines, s.file), lines: got.lines.length });
    }
  }
  return out;
}

function main(argv) {
  const registry = loadRegistry();
  const rec = argv.indexOf('--record');
  if (rec >= 0) {
    const id = argv[rec + 1];
    const section = registry.sections.find((s) => s.section === id);
    if (!section) {
      console.error(`[methods-spec] no section "${id}". Known: ${registry.sections.map((s) => s.section).join(', ')}`);
      return 1;
    }
    for (const r of evaluate({ sections: [section] })) {
      if (r.error) { console.error(`[methods-spec] ${r.error}`); return 1; }
      r.source.sha = r.current;
    }
    section.reviewed = new Date().toISOString().slice(0, 10);
    writeFileSync(REGISTRY, `${JSON.stringify(registry, null, 2)}\n`);
    const page = readFileSync(PAGE, 'utf8');
    writeFileSync(PAGE, page.replace(REVIEWED_RE, `$1${oldestReview(registry)}$2`));
    console.log(`[methods-spec] recorded §${id} (${section.title}) as reviewed ${section.reviewed}`);
    return 0;
  }
  let bad = 0;
  for (const r of evaluate(registry)) {
    if (r.error) { bad += 1; console.log(`BROKEN  #${r.section.section}  ${r.label}: ${r.error}`); continue; }
    const ok = r.current === r.source.sha;
    if (!ok) bad += 1;
    console.log(`${ok ? 'ok     ' : 'CHANGED'} #${r.section.section}  ${r.label}  (${r.lines} lines)`);
  }
  if (bad) {
    console.log(`\n${bad} source(s) changed since methods.html was last read against them.`
      + '\nRe-read each named section against its code, fix the page if it is now wrong, then:'
      + '\n  node scripts/paper/methods-spec.mjs --record <section-id>');
  }
  return bad ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
