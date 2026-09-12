#!/usr/bin/env node
/*
 * Behavioural guard for scripts/audit/refresh-inventory-mtimes.mjs — the
 * script that rewrites `lastUpdated:` and `features:` in
 * js/data-source-inventory.js and is auto-committed to main by
 * .github/workflows/sync-data-mtimes.yml.
 *
 * Why this exists
 * ---------------
 * Nothing in PR CI executed that script. The drift test only `require`s the
 * shared count map; the script's ESM entry point, its counting loop and its
 * line-surgery ran solely in the scheduled workflow — unattended, with
 * `contents: write`, against whatever main looked like that morning. A
 * regression would have landed as a bad auto-commit rather than a red PR.
 *
 * Everything runs against a sandbox repo in os.tmpdir() built from fixtures,
 * so a failing assertion can never corrupt the committed inventory or the
 * real data/ tree.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SCRIPT_REL = path.join('scripts', 'audit', 'refresh-inventory-mtimes.mjs');
const MAP_REL = path.join('scripts', 'audit', 'inventory-count-paths.cjs');
const INVENTORY_REL = path.join('js', 'data-source-inventory.js');

const { JSON_COUNT_PATHS } = require('../scripts/audit/inventory-count-paths.cjs');

// --- Fixtures --------------------------------------------------------------

// Real ids, so the real JSON_COUNT_PATHS map applies. Each one exercises a
// different shape the script has to handle.
const FIXTURE_IDS = {
  nestedPath: 'fred-mortgage30',   // series.MORTGAGE30US.observations (array, dotted)
  objectCount: 'regrid-parcels',   // counties (plain object → Object.keys)
  arrayCount: 'data-manifest',     // files (array → .length)
  uncounted: 'cde-schools-co',     // features: null, must never be given a number
  missingFile: 'kalshi-housing',   // localFile declared but absent from the sandbox
  notInMap: 'hud-lihtc-co',        // no JSON_COUNT_PATHS entry → left alone
};

for (const [role, id] of Object.entries(FIXTURE_IDS)) {
  const inMap = Object.prototype.hasOwnProperty.call(JSON_COUNT_PATHS, id);
  const expected = role !== 'notInMap';
  assert.strictEqual(inMap, expected,
    `fixture id ${id} (${role}) must ${expected ? '' : 'not '}be in JSON_COUNT_PATHS — ` +
    'update this fixture if the map changed');
}

assert.strictEqual(JSON_COUNT_PATHS[FIXTURE_IDS.nestedPath], 'series.MORTGAGE30US.observations');
assert.strictEqual(JSON_COUNT_PATHS[FIXTURE_IDS.objectCount], 'counties');
assert.strictEqual(JSON_COUNT_PATHS[FIXTURE_IDS.arrayCount], 'files');
assert.strictEqual(JSON_COUNT_PATHS[FIXTURE_IDS.uncounted], 'districts');

// Honest counts the sandbox data files actually contain.
const TRUE_COUNTS = { nestedPath: 3, objectCount: 2, arrayCount: 4 };

const DATA_FILES = {
  'data/fred-data.json': {
    series: { MORTGAGE30US: { observations: [{ value: '6.1' }, { value: '6.2' }, { value: '6.3' }] } },
  },
  'data/regrid-parcels.json': { counties: { '08031': { parcels: 1 }, '08041': { parcels: 2 } } },
  'data/manifest-fixture.json': { files: ['a.json', 'b.json', 'c.json', 'd.json'] },
  'data/schools-fixture.json': { districts: { '0800001': {} } },
};

// Mirrors the real inventory's shape: entries open with `{` at indent 4 and
// carry their own keys at indent 6. `notInMap` deliberately nests a `features`
// and a `lastUpdated` key one level deeper — the parser must not mistake those
// for the entry's own fields.
function buildInventory(counts) {
  const entry = (id, localFile, lastUpdated, features, extra = '') => [
    '    {',
    `      id: '${id}',`,
    `      name: '${id} fixture',`,
    `      url: 'http://127.0.0.1/${id}',`,
    `      localFile: ${localFile === null ? 'null' : `'${localFile}'`},`,
    `      lastUpdated: ${lastUpdated === null ? 'null' : `'${lastUpdated}'`},`,
    `      features: ${features === null ? 'null' : features},`,
    extra,
    '    },',
  ].filter(Boolean).join('\n');

  return [
    '(function () {',
    "  'use strict';",
    '',
    '  var SOURCES = [',
    entry(FIXTURE_IDS.nestedPath, 'data/fred-data.json', '2020-01-01', counts.nestedPath),
    entry(FIXTURE_IDS.objectCount, 'data/regrid-parcels.json', '2020-01-01', counts.objectCount),
    entry(FIXTURE_IDS.arrayCount, 'data/manifest-fixture.json', '2020-01-01', counts.arrayCount),
    // Declares a count of null *and* a real localFile. The committed inventory
    // never pairs those, but if it ever did the script must still refuse to
    // invent a number for a source whose count doesn't exist upstream.
    entry(FIXTURE_IDS.uncounted, 'data/schools-fixture.json', '2020-01-01', null),
    entry(FIXTURE_IDS.missingFile, 'data/absent-from-sandbox.json', '2020-01-01', counts.missingFile),
    entry(FIXTURE_IDS.notInMap, 'data/fred-data.json', '2020-01-01', counts.notInMap,
      [
        '      nested: {',
        "        lastUpdated: '1999-12-31',",
        '        features: 999,',
        '      },',
      ].join('\n')),
    '  ];',
    '',
    '  window.DataSourceInventory = { getSources: function () { return SOURCES; } };',
    '}());',
    '',
  ].join('\n');
}

const HONEST_COUNTS = { ...TRUE_COUNTS, missingFile: 7, notInMap: 42 };

// Sandbox files are created now, so without this every entry's 2020-01-01
// would look stale and the lastUpdated half of the script would fire on every
// case. Pin the mtimes behind the declared date; the lastUpdated test below
// moves them deliberately.
const FIXTURE_MTIME = new Date('2019-01-01T00:00:00Z');

// --- Sandbox ---------------------------------------------------------------

function makeSandbox(counts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-mtime-sync-'));
  fs.mkdirSync(path.join(dir, 'scripts', 'audit'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });

  fs.copyFileSync(path.join(REPO, SCRIPT_REL), path.join(dir, SCRIPT_REL));
  fs.copyFileSync(path.join(REPO, MAP_REL), path.join(dir, MAP_REL));
  for (const [rel, contents] of Object.entries(DATA_FILES)) {
    const abs = path.join(dir, rel);
    fs.writeFileSync(abs, JSON.stringify(contents, null, 2));
    fs.utimesSync(abs, FIXTURE_MTIME, FIXTURE_MTIME);
  }
  fs.writeFileSync(path.join(dir, INVENTORY_REL), buildInventory(counts));
  return dir;
}

function run(dir, args = []) {
  const result = spawnSync(process.execPath, [path.join(dir, SCRIPT_REL), ...args], {
    encoding: 'utf8',
  });
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

function inventoryOf(dir) {
  return fs.readFileSync(path.join(dir, INVENTORY_REL), 'utf8');
}

function declaredFeatures(text, id) {
  const entry = new RegExp(`id: '${id}',[\\s\\S]*?\\n    \\},`).exec(text);
  assert.ok(entry, `${id} missing from inventory`);
  const found = /^ {6}features: (\d+|null),$/m.exec(entry[0]);
  assert.ok(found, `${id} has no own features: line`);
  return found[1] === 'null' ? null : Number(found[1]);
}

function withSandbox(counts, body) {
  const dir = makeSandbox(counts);
  try {
    body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const checks = [];
function check(label, fn) {
  fn();
  checks.push(label);
}

// --- 1. Honest data is a no-op ---------------------------------------------

check('honest counts are a no-op', () => {
  withSandbox(HONEST_COUNTS, (dir) => {
    const before = inventoryOf(dir);
    const first = run(dir);
    assert.strictEqual(first.status, 0, `expected exit 0, got ${first.status}:\n${first.output}`);
    assert.match(first.output, /nothing to update/,
      `honest fixture must report nothing to update:\n${first.output}`);
    assert.strictEqual(inventoryOf(dir), before, 'no-op run must not rewrite the inventory');

    // Idempotent: a second pass still finds nothing.
    const second = run(dir);
    assert.strictEqual(second.status, 0);
    assert.match(second.output, /nothing to update/);
    assert.strictEqual(inventoryOf(dir), before, 'second run must not rewrite the inventory');
  });
});

// --- 2. Counts are repaired in both directions -----------------------------

check('drifted counts are repaired up and down, byte-identically', () => {
  const drifted = {
    ...HONEST_COUNTS,
    nestedPath: TRUE_COUNTS.nestedPath + 1,   // grew, as an append-only series does
    objectCount: TRUE_COUNTS.objectCount - 1, // shrank
    arrayCount: 0,                            // collapsed
  };

  // Non-vacuous: the sabotaged fixture must actually differ from the honest
  // one, or "restored byte-identically" would be asserting nothing.
  const honestText = buildInventory(HONEST_COUNTS);
  assert.notStrictEqual(buildInventory(drifted), honestText,
    'sabotage fixture is identical to the honest one — the guard would be vacuous');

  withSandbox(drifted, (dir) => {
    const result = run(dir);
    assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}:\n${result.output}`);
    assert.match(result.output, /3 features counts to reconcile/,
      `all three drifted counts must be reported:\n${result.output}`);
    assert.strictEqual(inventoryOf(dir), honestText,
      'repaired inventory must match the honest fixture byte for byte');
  });
});

// --- 3. A null count is never invented -------------------------------------

check('features: null is preserved even with a readable localFile', () => {
  withSandbox({ ...HONEST_COUNTS, nestedPath: TRUE_COUNTS.nestedPath + 1 }, (dir) => {
    const result = run(dir);
    assert.strictEqual(result.status, 0);
    const after = inventoryOf(dir);
    assert.strictEqual(declaredFeatures(after, FIXTURE_IDS.uncounted), null,
      'an uncounted source must keep features: null — the count does not exist upstream');
    assert.doesNotMatch(result.output, new RegExp(`${FIXTURE_IDS.uncounted}\\s+null`),
      'the uncounted source must not appear in the reconcile list');
    // The run did do its job on the source that actually drifted.
    assert.strictEqual(declaredFeatures(after, FIXTURE_IDS.nestedPath), TRUE_COUNTS.nestedPath);
  });
});

// --- 4. Nested keys are not mistaken for the entry's own --------------------

check('a nested features/lastUpdated key is left untouched', () => {
  withSandbox({ ...HONEST_COUNTS, nestedPath: TRUE_COUNTS.nestedPath + 1 }, (dir) => {
    assert.strictEqual(run(dir).status, 0);
    const after = inventoryOf(dir);
    assert.match(after, /^ {8}features: 999,$/m,
      'nested features: must survive — the parser must anchor to the entry key depth');
    assert.match(after, /^ {8}lastUpdated: '1999-12-31',$/m,
      'nested lastUpdated: must survive');
    assert.strictEqual(declaredFeatures(after, FIXTURE_IDS.notInMap), HONEST_COUNTS.notInMap,
      'a source outside JSON_COUNT_PATHS must keep its declared count');
  });
});

// --- 5. Unusable data warns and skips rather than guessing ------------------

check('an unparseable count target warns, skips and exits 0', () => {
  withSandbox(HONEST_COUNTS, (dir) => {
    const broken = { series: { MORTGAGE30US: { observations: 'not-a-collection' } } };
    const abs = path.join(dir, 'data/fred-data.json');
    fs.writeFileSync(abs, JSON.stringify(broken));
    fs.utimesSync(abs, FIXTURE_MTIME, FIXTURE_MTIME);

    const result = run(dir);
    assert.strictEqual(result.status, 0,
      `a bad count target must not fail the sync step:\n${result.output}`);
    assert.match(result.output, /cannot count 'series\.MORTGAGE30US\.observations'/,
      `the skip must be reported, got:\n${result.output}`);
    assert.strictEqual(declaredFeatures(inventoryOf(dir), FIXTURE_IDS.nestedPath),
      HONEST_COUNTS.nestedPath,
      'the declared count must be left alone rather than replaced with a guess');
  });
});

check('malformed JSON warns and skips rather than throwing', () => {
  withSandbox(HONEST_COUNTS, (dir) => {
    const abs = path.join(dir, 'data/fred-data.json');
    fs.writeFileSync(abs, '{ not json');
    fs.utimesSync(abs, FIXTURE_MTIME, FIXTURE_MTIME);
    const result = run(dir);
    assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}:\n${result.output}`);
    assert.match(result.output, /cannot count/, `expected a skip warning, got:\n${result.output}`);
    assert.strictEqual(declaredFeatures(inventoryOf(dir), FIXTURE_IDS.nestedPath),
      HONEST_COUNTS.nestedPath);
  });
});

check('a declared localFile that is absent is skipped, not crashed on', () => {
  withSandbox(HONEST_COUNTS, (dir) => {
    assert.ok(!fs.existsSync(path.join(dir, 'data/absent-from-sandbox.json')));
    const result = run(dir);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(declaredFeatures(inventoryOf(dir), FIXTURE_IDS.missingFile),
      HONEST_COUNTS.missingFile,
      'a source whose file is absent must keep its declared count');
  });
});

// --- 6. lastUpdated keeps its existing one-way semantics -------------------

check('lastUpdated bumps forward but never rolls backward', () => {
  withSandbox(HONEST_COUNTS, (dir) => {
    const stale = path.join(dir, 'data/fred-data.json');   // entry declares 2020-01-01
    const mtime = new Date('2024-06-15T12:00:00Z');
    fs.utimesSync(stale, mtime, mtime);

    // A file older than its curated date must not drag the date backward.
    const curated = path.join(dir, 'data/regrid-parcels.json');
    const older = new Date('2001-01-01T00:00:00Z');
    fs.utimesSync(curated, older, older);

    const result = run(dir);
    assert.strictEqual(result.status, 0);
    const after = inventoryOf(dir);
    assert.match(after, /lastUpdated: '2024-06-15',/,
      `a newer mtime must bump lastUpdated forward:\n${result.output}`);
    assert.doesNotMatch(after, /lastUpdated: '2001-01-01',/,
      'an older mtime must not roll a curated lastUpdated backward');
  });
});

// --- 7. --dry-run reports without writing ----------------------------------

check('--dry-run reports drift without writing', () => {
  withSandbox({ ...HONEST_COUNTS, nestedPath: TRUE_COUNTS.nestedPath + 1 }, (dir) => {
    const before = inventoryOf(dir);
    const result = run(dir, ['--dry-run']);
    assert.strictEqual(result.status, 0);
    assert.match(result.output, /1 features counts to reconcile/,
      `--dry-run must still report the drift:\n${result.output}`);
    assert.match(result.output, /--dry-run, no writes/);
    assert.strictEqual(inventoryOf(dir), before, '--dry-run must not write');
  });
});

// --- 8. The committed inventory's counts are already reconciled -------------

// Only the `features` half is asserted here, and deliberately so. Feature
// counts derive from file *content*, so they're identical on any checkout.
// `lastUpdated` derives from mtime, and git does not preserve mtimes — a
// fresh clone stamps every file with the checkout time, so on a CI runner
// every source looks newer than its declared date. Asserting "nothing to
// update" would pass locally and fail in CI for reasons that say nothing
// about the committed data. (That mtime behaviour is also why every entry
// currently carries the same lastUpdated; see the note in the PR.)
check('the committed inventory needs no count repair', () => {
  const result = spawnSync(process.execPath, [path.join(REPO, SCRIPT_REL), '--dry-run'], {
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0,
    `refresher must exit 0 on the committed tree:\n${result.stdout}${result.stderr}`);
  assert.doesNotMatch(result.stdout, /features counts to reconcile/,
    'js/data-source-inventory.js has feature-count drift — run ' +
    '`node scripts/audit/refresh-inventory-mtimes.mjs` and commit the result:\n' +
    result.stdout);
});

console.log(`inventory mtime + feature-count sync: PASS (${checks.length} behaviours verified)`);
checks.forEach((label) => console.log(`  · ${label}`));
