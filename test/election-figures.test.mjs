// The 2026 election figures in the midterms brief are built from the ballot
// rows and roll-call file by scripts/policy/build_election_figures.py. This
// checks that the committed SVGs match the data, that every figure a brief
// names exists, and that each alt text carries the numbers the picture shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

test('committed election figures match the data they are built from', () => {
  execFileSync('python3', ['scripts/policy/build_election_figures.py', '--check'], { cwd: ROOT, stdio: 'pipe' });
});

const brief = read('data/policy_briefs_curated.json').briefs.find((b) => b.id === 'federal-midterms-2026-housing');
const figures = (brief.sections || []).filter((s) => s.figure);

test('every brief figure exists under assets/briefs and has alt text and a source', () => {
  assert.ok(figures.length >= 4, 'midterms brief should carry its four figures');
  for (const s of figures) {
    assert.match(s.figure.src, /^assets\/briefs\/[\w\-/]+\.svg$/);
    assert.ok(fs.existsSync(path.join(ROOT, s.figure.src)), s.figure.src + ' is missing');
    assert.ok(s.figure.alt && s.figure.alt.length > 40, s.id + ' needs real alt text');
    assert.match(s.figure.source.url, /^https:\/\//);
    assert.match(s.figure.source.text, /20\d\d/, s.id + ' source line needs its date');
  }
});

test('local-measure alt text carries each unofficial yes share in the ballot rows', () => {
  const dir = path.join(ROOT, 'data/policy/ballot-2026/counties');
  const shares = [];
  for (const f of fs.readdirSync(dir)) {
    for (const e of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).entries || []) {
      const note = (e.history || []).at(-1)?.note || '';
      const m = note.match(/Yes [\d,]+ \(([\d.]+)%\), No/);
      if (m) shares.push(Number(m[1]).toFixed(1) + '%');
    }
  }
  assert.ok(shares.length >= 8);
  for (const id of ['local-measures-map', 'local-measures-yes-share']) {
    const alt = figures.find((s) => s.id === id).figure.alt;
    for (const s of shares) assert.ok(alt.includes(s), id + ' alt text is missing ' + s);
    assert.match(alt, /unofficial/i);
  }
});

test('roll-call alt text matches the roll-call file', () => {
  const alt = figures.find((s) => s.id === 'past-votes').figure.alt;
  for (const rc of read('data/policy/housing-roll-calls.json').roll_calls) {
    assert.ok(alt.includes(rc.yes + ' yes, ' + rc.no + ' no') || alt.includes(rc.yes + ' to ' + rc.no),
      'alt text is missing ' + rc.id + ' ' + rc.yes + '-' + rc.no);
  }
});
