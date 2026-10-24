// Every hard-coded copy of a tracked figure agrees with its data file, a new
// figure rewrites all of them, and no copy is typed outside a rule
// (scripts/sync-site-figures.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, plan, readFigures, strays, strayPatterns, formatFigure, NOT_SCANNED } from '../scripts/sync-site-figures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('every figure is readable from its data file', () => {
  const F = readFigures();
  for (const [k, v] of Object.entries(F)) assert.ok(v != null && v !== '', `${k} readable from data`);
});

test('every copy shows the figure in its data file', () => {
  const { matches, mismatches } = plan(readFigures());
  // Non-vacuous: plan() throws if any rule matches nothing in any of its files.
  assert.ok(matches >= RULES.reduce((n, r) => n + r.files.length, 0), `${matches} copies scanned`);
  assert.deepEqual(mismatches, [], 'run node scripts/sync-site-figures.mjs');
});

test('no tracked figure is typed outside a rule', () => {
  assert.deepEqual(strays(readFigures()), [], 'add a rule in scripts/sync-site-figures.mjs or read the figure from its data at runtime');
});

test('every synced figure is in the stray scan or named as too common to scan', () => {
  const scanned = new Set(strayPatterns(readFigures()).map(([k]) => k));
  const ruled = [...new Set(RULES.map((r) => r.fig).filter(Boolean))];
  assert.deepEqual(ruled.filter((k) => !scanned.has(k) && !NOT_SCANNED.includes(k)), []);
});

test('a typed copy outside a rule is caught', () => {
  const F = readFigures();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-figures-'));
  fs.mkdirSync(path.join(dir, 'js'));
  fs.mkdirSync(path.join(dir, 'data/core'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'new-page.html'), `<p>Credits sell for $${formatFigure('eq9', F)} and Prop 123 raises $${F.p123M} million. North Central: $${formatFigure('eqNC', F)}.</p>`);
  fs.writeFileSync(path.join(dir, 'js/x.js'), `var due = 'Letter of intent ${formatFigure('r1Loi', F)}';`);
  const found = strays(F, dir, new Map());
  assert.deepEqual(found.map((x) => x.fig).sort(), ['eq9', 'eqNC', 'p123M', 'r1Loi']);
});

// Made-up IRS URLs are joined from parts so the source-URL sweep does not
// fetch them as if they were citations.
test('new figures rewrite every rule, and the result then agrees', () => {
  const F = readFigures();
  const next = {
    ...F,
    eq9: F.eq9 + 0.03, eq4: F.eq4 + 0.03, eqCo: F.eqCo + 0.03, eqNC: F.eqNC + 0.03,
    quarter: '2099-Q1', quarterWords: 'Q1 2099', year: F.year + 1,
    perCapita: F.perCapita + 0.1, smallStateMin: F.smallStateMin + 1000,
    revProc: 'IRS Rev. Proc. 2098-99', revProcUrl: ['https:', '', 'www.irs.gov', 'pub', 'irs-drop', 'rp-98-99.pdf'].join('/'),
    coM: F.coM + 1, p123M: F.p123M + 10, p123From: '2099-00',
    r1Loi: '2099-12-01', r1App: '2100-02-01',
    coPop: F.coPop + 1000, notice: 'Notice 2099-01', noticeUrl: ['https:', '', 'www.irs.gov', 'irb', '2099-02_IRB'].join('/'),
  };
  const { mismatches, rewrites } = plan(next);
  const hit = new Set(mismatches.map((m) => m.rule));
  RULES.forEach((rule, i) => assert.ok(hit.has(i), `rule ${i} ${rule.pattern} rewritten`));
  const reread = (rel) => rewrites.get(rel) ?? fs.readFileSync(path.join(ROOT, rel), 'utf8');
  assert.deepEqual(plan(next, reread).mismatches, [], 'rewritten text agrees with the new figures');
});

test('a missing figure refuses rather than guessing', () => {
  const F = { ...readFigures(), eq9: null };
  assert.throws(() => plan(F), /missing from the data/);
});

test('the sources that repeat a figure agree with each other', () => {
  const F = readFigures();
  const scoring = readJson('data/policy/chfa-2027-r1-scoring.json');
  const s = JSON.stringify(scoring);
  assert.match(s, new RegExp(`"loi_due":\\s*"${F.r1Loi}"`), 'scoring file LOI date matches the QAP calendar');
  assert.match(s, new RegExp(`"application_due":\\s*"${F.r1App}"`), 'scoring file application date matches the QAP calendar');
  const lihtc = readJson('data/policy/lihtc-assumptions.json');
  assert.match(JSON.stringify(lihtc), new RegExp(`"default9Pct":${F.eq9}\\b`), 'lihtc-assumptions follows Novogradac');
  const alloc = readJson('data/allocations.json');
  assert.equal(alloc.year, F.year, 'allocations.json is for the ceiling year');
});

test('every equity fallback the LIHTC guide refills at runtime is covered by a rule', () => {
  const guide = 'lihtc-guide-for-stakeholders.html';
  const src = fs.readFileSync(path.join(ROOT, guide), 'utf8');
  // set('id', …) and getElementById('id') … meta.vintage are the runtime refills.
  const ids = new Set([
    ...[...src.matchAll(/\bset\('([A-Za-z0-9]+)',/g)].map((m) => m[1]),
    ...[...src.matchAll(/getElementById\('([A-Za-z0-9]+Vintage)'\)/g)].map((m) => m[1]),
  ]);
  assert.ok(ids.size >= 10, `${ids.size} refilled spans found`);
  const covered = plan(readFigures()).covered.get(guide) || [];
  for (const id of ids) {
    const at = src.indexOf(`id="${id}"`);
    assert.ok(at >= 0, `${id} has a fallback span`);
    assert.ok(covered.some(([s, e]) => at >= s && at < e), `${id}'s static fallback is covered by a rule`);
  }
});

test('the deep dive reads the same ceiling year the sync does', () => {
  const src = fs.readFileSync(path.join(ROOT, 'colorado-deep-dive.html'), 'utf8');
  assert.doesNotMatch(src, /'ceiling_\d{4}'/, 'no hard-coded ceiling year in the runtime loader');
  assert.match(src, /\^ceiling_\\d\{4\}\$/, 'the loader picks the latest ceiling_YYYY');
  assert.match(src, /e\.id === 'obbba-lihtc-ceiling-12pct'/, 'the loader reads the same legislation entry as the sync');
});
