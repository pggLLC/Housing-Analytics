const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'economic-dashboard.html'), 'utf8');

assert.ok(
  html.includes('PCU331110331110'),
  'Economic dashboard should use the live iron and steel mills PPI series.'
);

assert.ok(
  !html.includes('WPU10170503'),
  'Economic dashboard should not reference the discontinued steel reinforcing bar series.'
);

assert.match(
  html,
  /id:"COMPUTSA"[\s\S]{0,120}Total/,
  'COMPUTSA indicator title should label total housing completions.'
);

assert.ok(
  !html.includes('Multifamily Completions (5+ units)'),
  'COMPUTSA should not be labeled as multifamily completions.'
);

assert.ok(
  !html.includes('Steel reinforcing bar'),
  'Footer should not cite the discontinued steel reinforcing bar series.'
);

console.log('Economic dashboard series labels guard passed.');
