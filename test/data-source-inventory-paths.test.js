#!/usr/bin/env node
// test/data-source-inventory-paths.test.js
//
// User-facing Data Trust Center "Local File" provenance must resolve to a
// committed path. Runtime or unavailable sources carry null instead.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function loadSources() {
  const inventoryPath = path.join(ROOT, 'js/data-source-inventory.js');
  delete require.cache[require.resolve(inventoryPath)];
  global.window = global;
  require(inventoryPath);
  return global.DataSourceInventory.getSources();
}

function resolveLocalFile(localFile) {
  return path.join(ROOT, localFile);
}

function assertInventoryPaths(sources) {
  assert(sources.length >= 60, 'expected a substantial data-source inventory');
  const localSources = sources.filter((source) => source.localFile);
  const missing = localSources
    .filter((source) => !fs.existsSync(resolveLocalFile(source.localFile)))
    .map((source) => `${source.id}: ${source.localFile}`);

  assert.deepEqual(missing, [], `missing localFile path(s): ${missing.join(', ')}`);
  return localSources.length;
}

if (require.main === module) {
  const sources = loadSources();
  const localCount = assertInventoryPaths(sources);
  console.log(`data-source-inventory paths: PASS (${localCount} resolvable localFile entries)`);
}

module.exports = { ROOT, loadSources, resolveLocalFile, assertInventoryPaths };
