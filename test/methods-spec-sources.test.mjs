#!/usr/bin/env node
/**
 * methods.html's prose has been read against the code it describes, as that
 * code stands now.
 *
 * test/paper-figures-fresh.test.js already fails when a constant moves. It
 * cannot see a change of shape: #1733 made gap pressure the maximum of two
 * readings without moving a weight, and §06 printed the old formula for three
 * weeks with every check green. This pins the agreement between each section
 * and the functions it specifies (scripts/paper/methods-spec-sources.json),
 * and between the page and the inputs the ranking actually percentiles.
 *
 * Failing here means: re-read the named section against its code, fix the
 * page if it is wrong, then `node scripts/paper/methods-spec.mjs --record <id>`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  ROOT, PAGE, REVIEWED_RE, loadRegistry, evaluate, extract, fingerprint, oldestReview,
} from '../scripts/paper/methods-spec.mjs';

const page = fs.readFileSync(PAGE, 'utf8');
const registry = loadRegistry();
const results = evaluate(registry);

test('every numbered section of methods.html is registered, and nothing else is', () => {
  const onPage = [...page.matchAll(/<h2 id="(m-[\w-]+)"/g)].map((m) => m[1]);
  assert.ok(onPage.length >= 6, `found only ${onPage.length} sections; did the heading markup change?`);
  const registered = registry.sections.map((s) => s.section);
  assert.deepEqual([...registered].sort(), [...onPage].sort(),
    'a section was added to or removed from methods.html without updating methods-spec-sources.json');
  for (const s of registry.sections) {
    if (!s.sources.length) assert.ok(s.no_sources, `§${s.section} names no code and gives no reason why`);
  }
});

test('every named function or region resolves to real code', () => {
  assert.ok(results.length >= 15, `only ${results.length} sources evaluated`);
  const broken = results.filter((r) => r.error || !(r.lines > 0));
  assert.deepEqual(broken.map((r) => `#${r.section.section} ${r.label}: ${r.error || 'empty'}`), []);
});

test('no section\'s code has changed since the section was last read against it', () => {
  const changed = results.filter((r) => !r.error && r.current !== r.source.sha);
  assert.deepEqual(
    changed.map((r) => `#${r.section.section} (${r.section.title}): ${r.label}`),
    [],
    'Re-read each section against its code, fix methods.html if it is now wrong, then run\n'
      + '  node scripts/paper/methods-spec.mjs --record <section-id>',
  );
});

test('the byline\'s review date is the oldest section review', () => {
  const m = page.match(REVIEWED_RE);
  assert.ok(m, 'methods.html has no <time data-spec-reviewed> in its byline');
  const shown = page.match(/<time data-spec-reviewed>([^<]*)<\/time>/)[1];
  assert.equal(shown, oldestReview(registry));
});

test('every input the ranking percentiles is named on the page', () => {
  // The workforce inputs were percentiled and blended into the score for three
  // weeks before this page named them. A new scored input now has to be named.
  const src = fs.readFileSync(path.join(ROOT, 'scripts/hna/build_ranking_index.py'), 'utf8');
  const fields = [...new Set([...src.matchAll(/compute_percentile_ranks\(\s*entries,\s*"(\w+)"/g)].map((m) => m[1]))];
  assert.ok(fields.length >= 15, `found only ${fields.length} percentiled inputs; did the call shape change?`);
  const missing = fields.filter((f) => !page.includes(`<code>${f}</code>`));
  assert.deepEqual(missing, [], 'percentiled in build_ranking_index.py but not named in methods.html §06');
});

test('a comment edit does not demand a review; a code edit does', () => {
  // Sabotage both ways on the real source, proving each mutation applied.
  const file = 'scripts/hna/build_ranking_index.py';
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const sel = { function: '_weighted_average' };
  const base = fingerprint(extract(src, file, sel).lines, file);

  const anchor = '    if total_weight <= 0:\n';
  assert.ok(src.includes(anchor), 'sabotage anchor not found in _weighted_average');

  const commented = src.replace(anchor, `    # a reworded explanation\n\n${anchor}`);
  assert.notEqual(commented, src);
  assert.equal(fingerprint(extract(commented, file, sel).lines, file), base);

  const changed = src.replace(anchor, '    if total_weight < 0:\n');
  assert.notEqual(changed, src);
  assert.notEqual(fingerprint(extract(changed, file, sel).lines, file), base);
});

test('a region and a JS function are bounded where they should be', () => {
  const py = 'x = 1\ndef f(\n    a,\n) -> int:\n    return a\n\n# trailing\ndef g():\n    pass\n';
  assert.deepEqual(extract(py, 'm.py', { function: 'f' }).lines, ['def f(', '    a,', ') -> int:', '    return a']);
  const js = '  function k(a) {\n    if (a) {\n      return 1;\n    }\n    return 0;\n  }\n  function z() {}\n';
  assert.equal(extract(js, 'm.js', { function: 'k' }).lines.length, 6);
  const reg = 'a\n# methods-spec:begin r\nb\nc\n# methods-spec:end r\nd\n';
  assert.deepEqual(extract(reg, 'm.py', { region: 'r' }).lines, ['b', 'c']);
  assert.ok(extract(reg, 'm.py', { region: 'missing' }).error);
});

test('the weekly mortgage-rate refresh does not demand a review', async () => {
  // The Saturday HNA build rewrites MORTGAGE_RATE's value and week. §05 names
  // the source and the one-rate rule, not a value, so that rewrite must leave
  // every fingerprint §05 pins unchanged; on 10-31 it turned main red.
  const { rewrite } = await import('../scripts/hna/sync-mortgage-rate.mjs');
  const engineFile = 'js/hna/ownership-finance.js';
  const engine = fs.readFileSync(path.join(ROOT, engineFile), 'utf8');
  const kernel = fs.readFileSync(path.join(ROOT, 'js/hna/hna-ownership-need.js'), 'utf8');
  const next = rewrite(engine, kernel, { week: '2099-01-01', rateAnnual: 0.0599 }).engine;
  assert.notEqual(next, engine, 'the simulated refresh changed the file');
  const pinned = registry.sections.flatMap((s) => s.sources).filter((s) => s.file === engineFile);
  assert.ok(pinned.length > 0);
  for (const sel of pinned) {
    const label = sel.function || sel.region;
    assert.equal(fingerprint(extract(next, engineFile, sel).lines, engineFile),
      fingerprint(extract(engine, engineFile, sel).lines, engineFile),
      `${label} fingerprint moved with the weekly rate`);
  }
});
