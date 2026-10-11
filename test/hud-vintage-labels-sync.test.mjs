// Every hard-coded HUD vintage label agrees with the data it describes, and
// a new vintage in the data rewrites all of them (scripts/sync-hud-vintage-labels.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, plan, readVintages } from '../scripts/sync-hud-vintage-labels.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every label names the vintage of the data it describes', () => {
  const vintages = readVintages();
  for (const [k, v] of Object.entries(vintages)) assert.ok(Number.isInteger(v), `${k} vintage readable from data`);
  const { matches, mismatches } = plan(vintages);
  // Non-vacuous: plan() throws if any rule matches nothing in any of its files.
  assert.ok(matches >= RULES.reduce((n, r) => n + r.files.length, 0), `${matches} labels scanned`);
  assert.deepEqual(mismatches, [], 'run node scripts/sync-hud-vintage-labels.mjs');
});

test('a new vintage rewrites every rule, and the result then agrees', () => {
  const current = readVintages();
  const next = Object.fromEntries(Object.entries(current).map(([k, v]) => [k, v + 1]));
  const { mismatches, rewrites } = plan(next);
  const rulesHit = new Set(mismatches.map((m) => m.rule));
  RULES.forEach((rule, i) => assert.ok(rulesHit.has(i), `rule ${i} ${rule.pattern} rewritten`));
  const reread = (rel) => rewrites.get(rel) ?? fs.readFileSync(path.join(ROOT, rel), 'utf8');
  assert.deepEqual(plan(next, reread).mismatches, [], 'rewritten text agrees with the new vintage');
});

test('a missing vintage refuses rather than guessing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-vintage-'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data/hud-fmr-income-limits.json'), JSON.stringify({ meta: { income_limits_fiscal_year: 2026 } }));
  fs.writeFileSync(path.join(dir, 'data/qct-colorado.json'), JSON.stringify({ source: 'HUD ArcGIS Qualified_Census_Tracts_2026 FeatureServer' }));
  fs.writeFileSync(path.join(dir, 'data/dda-colorado.json'), JSON.stringify({ designationYear: 2026 }));
  const v = readVintages(dir);
  assert.equal(v.fmr, null);
  assert.equal(v.qct, 2026, 'falls back to the layer year in source');
  assert.throws(() => plan(v), /no fmr vintage/);
});
