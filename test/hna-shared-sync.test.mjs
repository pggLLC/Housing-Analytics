// The HNA chapter pages carry copies of housing-needs-assessment.html's shared
// sections; scripts/sync-hna-shared.mjs keeps them identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MASTER, PAGES, plan, sections, syncPage } from '../scripts/sync-hna-shared.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('every chapter page matches the master copy of each shared section', () => {
  const { master, changes } = plan();
  assert.ok(master.size >= 20, `${master.size} shared sections in ${MASTER}`);
  assert.deepEqual([...changes.keys()], [], 'run node scripts/sync-hna-shared.mjs');
});

test('every shared section appears on at least one chapter page', () => {
  const master = sections(read(MASTER), MASTER);
  const used = new Set(PAGES.flatMap((p) => [...sections(read(p), p).keys()]));
  for (const name of master.keys()) assert.ok(used.has(name), `shared:${name} is used by a chapter page`);
});

test('an edit to the master reaches the chapter page, and a stray edit is caught', () => {
  const master = sections(read(MASTER), MASTER);
  const page = 'hna-what-to-do.html';
  const text = read(page);
  const [name, body] = [...sections(text, page)].find(([, b]) => b.includes('<'));
  const edited = new Map(master);
  edited.set(name, body + '\n<p>edited once</p>');
  assert.ok(syncPage(text, edited, page).includes('<p>edited once</p>'));
  const stray = text.replace(body, body + '\n<p>edited on the chapter page only</p>');
  assert.notEqual(syncPage(stray, master, page), stray, 'the check sees a chapter-only edit');
});

test('markers outside the master and unclosed markers refuse', () => {
  const master = sections(read(MASTER), MASTER);
  assert.throws(() => syncPage('<!-- shared:99 -->\nx\n<!-- /shared:99 -->', master, 't'), /not in/);
  assert.throws(() => sections('<!-- shared:01 -->\nx\n', 't'), /no matching/);
});
