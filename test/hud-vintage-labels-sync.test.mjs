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

test('a rewrite changes only the captured year, not equal digits beside it', () => {
  const current = readVintages();
  const v = { ...current, fmr: current.fmr + 1, acs5: current.acs5 + 1 };
  // The CHFA year equals the FMR year in the label as read, so a rewrite that
  // searched the match for the year's digits would hit CHFA first.
  const rel = 'market-analysis.html';
  const label = /data-vintage="CHFA \d{4} · HUD FMR FY\d{4}"/;
  const same = `data-vintage="CHFA ${current.fmr} · HUD FMR FY${current.fmr}"`;
  const read = (f) => {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (f !== rel) return text;
    assert.match(text, label, 'the CHFA + FMR label exists');
    const out = text.replace(label, same);
    assert.ok(out.includes(same), 'the fixture label is in the text plan() reads');
    return out;
  };
  const { rewrites } = plan(v, read);
  assert.ok(rewrites.get(rel).includes(`data-vintage="CHFA ${current.fmr} · HUD FMR FY${v.fmr}"`), 'CHFA year kept, FMR year moved');
  const hna = rewrites.get('housing-needs-assessment.html');
  assert.ok(hna.includes(`data-vintage="ACS ${v.acs5 - 4}–${v.acs5}"`), 'an ACS range moves both ends');
  assert.ok(!hna.includes(`data-vintage="ACS ${current.acs5 - 4}–${current.acs5}"`), 'no old ACS range left behind');
});

test('ACS and LODES vintages are read from the data files the pages show', () => {
  const v = readVintages();
  const summary = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/summary/08.json'), 'utf8'));
  assert.equal(v.acs5, Number(summary.acsProfile._acsYear));
  const tract = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market/acs_tract_metrics_co.json'), 'utf8'));
  assert.equal(v.acsTract, Number(tract.meta.vintage));
  const county = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/lehd/08001.json'), 'utf8'));
  assert.equal(v.lodes, county.year);
});

test('county LODES files that disagree on a year name no vintage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lodes-vintage-'));
  fs.mkdirSync(path.join(dir, 'data/hna/lehd'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data/hud-fmr-income-limits.json'), JSON.stringify({ meta: {} }));
  fs.writeFileSync(path.join(dir, 'data/qct-colorado.json'), '{}');
  fs.writeFileSync(path.join(dir, 'data/dda-colorado.json'), '{}');
  fs.writeFileSync(path.join(dir, 'data/hna/lehd/08001.json'), JSON.stringify({ year: 2023 }));
  fs.writeFileSync(path.join(dir, 'data/hna/lehd/08003.json'), JSON.stringify({ year: 2022 }));
  assert.equal(readVintages(dir).lodes, null);
  fs.writeFileSync(path.join(dir, 'data/hna/lehd/08003.json'), JSON.stringify({ year: 2023 }));
  assert.equal(readVintages(dir).lodes, 2023);
  assert.equal(readVintages(dir).acs5, null, 'a missing summary is no vintage, not a guess');
});
