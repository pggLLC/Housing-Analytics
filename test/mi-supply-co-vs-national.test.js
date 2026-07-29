const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(repoRoot, 'js/market-intelligence.js'), 'utf8');
const html = fs.readFileSync(path.join(repoRoot, 'market-intelligence.html'), 'utf8');

assert.match(
  js,
  /var permits = data\.COBPPRIV\b/,
  'Supply KPI permits must prefer Colorado COBPPRIV before national permit series.'
);

assert.match(
  js,
  /var obs = fred && \(fred\.COBPPRIV\b/,
  'Supply chart must prefer Colorado COBPPRIV before national permit series.'
);

assert.ok(
  html.includes('CO Building Permits'),
  'Supply permits label should identify Colorado building permits.'
);

assert.ok(
  !html.includes('Multifamily Permits (12 mo)'),
  'Supply permits label should not claim a stale 12-month multifamily metric.'
);

assert.ok(
  html.includes('U.S. Completions (SAAR)'),
  'Completions card should disclose that the value is U.S. national context.'
);

assert.ok(
  html.includes('U.S. Under Construction (SAAR)'),
  'Under-construction card should disclose that the value is U.S. national context.'
);

assert.ok(
  !html.includes('via FRED series COBPPRIV and COBPPRIV5F'),
  'Data note should not imply all supply cards use Colorado FRED series.'
);

console.log('Market Intelligence supply source labels guard passed.');
