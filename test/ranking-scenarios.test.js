'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CANONICAL_PATH = path.join(ROOT, 'data/hna/ranking-index.json');
const SCENARIO_DIR = path.join(ROOT, 'data/hna/ranking-scenarios');
const EXPECTED = [
  'balanced',
  'rate-sensitive',
  'large-gap',
  'commuter-pressure',
  'rural-lens',
];

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertNoDiff(paths) {
  execFileSync('git', ['diff', '--quiet', '--', ...paths], {
    cwd: ROOT,
    stdio: 'pipe',
  });
}

const canonical = readJSON(CANONICAL_PATH);
const canonicalRows = canonical.rankings || [];
const canonicalGeoids = new Set(canonicalRows.map(row => row.geoid));
const canonicalGeneratedAt = canonical.metadata && canonical.metadata.generatedAt;

assert.ok(canonicalGeneratedAt, 'canonical ranking index must have metadata.generatedAt');
assert.ok(fs.existsSync(SCENARIO_DIR), 'data/hna/ranking-scenarios must exist');

const files = fs.readdirSync(SCENARIO_DIR).filter(name => name.endsWith('.json')).sort();
assert.deepEqual(files, EXPECTED.map(id => `${id}.json`).sort(), 'unexpected ranking scenario files');

for (const id of EXPECTED) {
  const file = path.join(SCENARIO_DIR, `${id}.json`);
  const data = readJSON(file);
  assert.equal(data.metadata.scenario_id, id, `${id} metadata.scenario_id mismatch`);
  assert.equal(data.metadata.based_on, canonicalGeneratedAt, `${id} must be based on the current canonical index`);
  assert.ok(data.metadata.scenario_name, `${id} missing scenario_name`);
  assert.ok(data.metadata.description, `${id} missing description`);
  assert.ok(data.metadata.weights, `${id} missing weights`);
  assert.ok(data.metadata.params, `${id} missing params`);
  assert.ok(data.metadata.generated_at, `${id} missing generated_at`);
  assert.ok(data.metadata.source_commit, `${id} missing source_commit`);
  assert.equal(data.rankings.length, canonicalRows.length, `${id} row count mismatch`);

  const ranks = new Set();
  const scenarioGeoids = new Set();
  for (const row of data.rankings) {
    assert.deepEqual(Object.keys(row).sort(), ['geoid', 'overall_need_score', 'rank'], `${id} rows must stay slim`);
    assert.ok(canonicalGeoids.has(row.geoid), `${id} unknown geoid ${row.geoid}`);
    assert.equal(Number.isInteger(row.rank), true, `${id} rank must be an integer`);
    assert.ok(row.rank >= 1 && row.rank <= canonicalRows.length, `${id} rank out of range`);
    assert.equal(typeof row.overall_need_score, 'number', `${id} score must be numeric`);
    ranks.add(row.rank);
    scenarioGeoids.add(row.geoid);
  }
  assert.equal(ranks.size, canonicalRows.length, `${id} ranks must be unique`);
  assert.equal(scenarioGeoids.size, canonicalRows.length, `${id} geoids must be unique`);

  const size = fs.statSync(file).size;
  assert.ok(size < 250_000, `${id} should be a slim overlay, got ${size.toLocaleString()} bytes`);
}

assertNoDiff(['data/hna/ranking-index.json', 'data/hna/scenarios']);

console.log(`ranking-scenarios: validated ${EXPECTED.length} slim overlays`);
