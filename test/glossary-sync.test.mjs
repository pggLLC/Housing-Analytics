// data/glossary.json is the one place a definition is written: the inline
// tooltips and the callout summaries are copies kept by scripts/sync-glossary.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, writeInline, writeCallouts, termsBlock, GLOSSARY, INLINE, CALLOUTS } from '../scripts/sync-glossary.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const glossary = JSON.parse(read(GLOSSARY));

test('the tooltips and callout summaries match data/glossary.json', () => {
  assert.deepEqual([...plan().keys()], [], 'run node scripts/sync-glossary.mjs');
});

test('every tooltip term comes from a glossary entry', () => {
  const src = read(INLINE);
  const block = src.slice(src.indexOf('var TERMS = {'), src.indexOf('\n  };', src.indexOf('var TERMS = {')));
  const keys = [...block.matchAll(/^\s+'((?:[^'\\]|\\.)+)':/gm)].map((m) => m[1].replace(/\\'/g, "'"));
  const fromGlossary = glossary.terms.filter((t) => t.short).map((t) => t.inline_key || t.term);
  assert.ok(keys.length >= 100, `${keys.length} tooltip terms`);
  assert.deepEqual(keys, fromGlossary);
});

test('every callout linked to the glossary shows its short definition', () => {
  const entries = JSON.parse(read(CALLOUTS)).entries;
  const byKey = new Map(glossary.terms.map((t) => [t.inline_key || t.term, t]));
  const linked = Object.entries(entries).filter(([, e]) => e.glossary);
  assert.ok(linked.length >= 20, `${linked.length} callouts linked`);
  for (const [k, e] of linked) {
    assert.ok(byKey.get(e.glossary)?.short, `${k} → ${e.glossary} has a short definition`);
    assert.equal(e.short, byKey.get(e.glossary).short, `${k} summary matches the glossary`);
  }
});

test('a change in the glossary reaches the tooltip and the callout', () => {
  const g = structuredClone(glossary);
  const ami = g.terms.find((t) => (t.inline_key || t.term) === 'AMI');
  ami.short = "Area Median Income — it's a test.";
  const inline = writeInline(read(INLINE), g);
  assert.ok(inline.includes("'AMI': 'Area Median Income — it\\'s a test.'"), 'tooltip rewritten and escaped');
  const callouts = JSON.parse(writeCallouts(read(CALLOUTS), g));
  assert.equal(callouts.entries.ami.short, "Area Median Income — it's a test.");
});

test('two entries cannot claim one tooltip key', () => {
  const g = structuredClone(glossary);
  g.terms.push({ term: 'AMI', definition: 'x', short: 'x' });
  assert.throws(() => termsBlock(g), /two glossary entries/);
});

test('terms added for tooltips only are not auto-wrapped by the header glossary', () => {
  const quiet = glossary.terms.filter((t) => t.autolink === false);
  assert.ok(quiet.length > 0);
  assert.match(read('js/glossary.js'), /t\.autolink !== false/);
});
