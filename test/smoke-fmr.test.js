// test/smoke-fmr.test.js
//
// Smoke tests for HUD FMR / Income Limits integration.
// Verifies that all required files exist and contain valid, complete data.
//
// Usage:
//   node test/smoke-fmr.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let passed   = 0;
let failed   = 0;
let warnings = 0;

function pass(msg) { console.log('  ✅ PASS: ' + msg); passed++; }
function fail(msg) { console.error('  ❌ FAIL: ' + msg); failed++; }
function warn(msg) { console.warn('  ⚠️  WARN: ' + msg); warnings++; }

function fileExists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function parseJSON(rel) {
  const content = readFile(rel);
  return JSON.parse(content);
}

// ─── 1. Static data file ─────────────────────────────────────────────────────
console.log('\n── 1. data/hud-fmr-income-limits.json ──');

const DATA_FILE = 'data/hud-fmr-income-limits.json';

if (fileExists(DATA_FILE)) {
  pass(DATA_FILE + ' exists');

  let data;
  try {
    data = parseJSON(DATA_FILE);
    pass('Parses as valid JSON');
  } catch (e) {
    fail('JSON parse error: ' + e.message);
    data = null;
  }

  if (data) {
    // Rule 18: sentinel key must be present
    if (data.meta && data.meta.generated) {
      pass('meta.generated sentinel key present');
    } else {
      fail('meta.generated sentinel key missing (Rule 18)');
    }

    if (data.meta && data.meta.fiscal_year) {
      pass('meta.fiscal_year present: ' + data.meta.fiscal_year);
    } else {
      fail('meta.fiscal_year missing');
    }

    // Rule 4: exactly 64 counties
    if (Array.isArray(data.counties)) {
      const count = data.counties.length;
      if (count === 64) {
        pass('Exactly 64 county records present');
      } else {
        fail('Expected 64 counties, got ' + count + ' (Rule 4)');
      }
    } else {
      fail('counties array missing');
    }

    if (Array.isArray(data.counties) && data.counties.length > 0) {
      // Rule 1: all FIPS codes must be 5 digits
      const badFips = data.counties.filter(c => !c.fips || String(c.fips).length !== 5);
      if (badFips.length === 0) {
        pass('All county FIPS codes are 5 digits (Rule 1)');
      } else {
        fail(badFips.length + ' county records have non-5-digit FIPS: ' +
          badFips.map(c => c.fips).join(', ') + ' (Rule 1)');
      }

      // Rule 2: required numeric fields must not be null/zero
      const badAmi = data.counties.filter(c =>
        !c.income_limits || !c.income_limits.ami_4person || c.income_limits.ami_4person <= 0
      );
      if (badAmi.length === 0) {
        pass('All counties have non-zero ami_4person (Rule 2)');
      } else {
        fail(badAmi.length + ' counties have missing/zero ami_4person (Rule 2): ' +
          badAmi.map(c => c.fips).join(', '));
      }

      // FMR values must be non-zero
      const badFmr = data.counties.filter(c =>
        !c.fmr || !c.fmr.two_br || c.fmr.two_br <= 0
      );
      if (badFmr.length === 0) {
        pass('All counties have non-zero fmr.two_br');
      } else {
        fail(badFmr.length + ' counties have missing/zero fmr.two_br: ' +
          badFmr.map(c => c.fips).join(', '));
      }

      // Spot-check Denver (08031) data
      const denver = data.counties.find(c => c.fips === '08031');
      if (denver) {
        pass('Denver County (08031) record present');
        if (denver.fmr && denver.fmr.two_br > 0) {
          pass('Denver 2BR FMR: $' + denver.fmr.two_br);
        } else {
          fail('Denver 2BR FMR missing or zero');
        }
        if (denver.income_limits && denver.income_limits.il50_4person > 0) {
          pass('Denver 50% AMI 4-person income limit: $' + denver.income_limits.il50_4person);
        } else {
          fail('Denver il50_4person income limit missing or zero');
        }
      } else {
        fail('Denver County (08031) not found in data');
      }

      // Spot-check Ouray (08091) FIPS is 5 digits — previously was "091" (Rule 1)
      const ouray = data.counties.find(c => c.fips === '08091');
      if (ouray) {
        pass('Ouray County (08091) record present with correct 5-digit FIPS');
      } else {
        fail('Ouray County (08091) not found — check FIPS padding (Rule 1)');
      }
    }
  }
} else {
  fail(DATA_FILE + ' not found');
}

// ─── 2. JS connector ─────────────────────────────────────────────────────────
console.log('\n── 2. js/data-connectors/hud-fmr.js ──');

const CONNECTOR = 'js/data-connectors/hud-fmr.js';

if (fileExists(CONNECTOR)) {
  pass(CONNECTOR + ' exists');
  const src = readFile(CONNECTOR);

  const checks = [
    { pattern: /window\.HudFmr\s*=/, label: 'Exposes window.HudFmr' },
    { pattern: /function load\b/,     label: 'load() function present' },
    { pattern: /function isLoaded/,   label: 'isLoaded() function present' },
    { pattern: /getFmrByFips/,        label: 'getFmrByFips() function present' },
    { pattern: /getIncomeLimitsByFips/, label: 'getIncomeLimitsByFips() function present' },
    { pattern: /computeFmrRatio/,     label: 'computeFmrRatio() function present' },
    { pattern: /getGrossRentLimit/,   label: 'getGrossRentLimit() function present' },
    { pattern: /safeFetchJSON/,       label: 'Uses safeFetchJSON (fetch-helper)' },
    { pattern: /hud-fmr-income-limits\.json/, label: 'References data file path' },
  ];
  checks.forEach(function (c) {
    if (c.pattern.test(src)) {
      pass(c.label);
    } else {
      fail(c.label);
    }
  });
} else {
  fail(CONNECTOR + ' not found');
}

// ─── 3. HNA HTML integration ─────────────────────────────────────────────────
console.log('\n── 3. housing-needs-assessment.html ──');

const HNA_HTML = 'housing-needs-assessment.html';
if (fileExists(HNA_HTML)) {
  const html = readFile(HNA_HTML);

  const checks = [
    { pattern: /hud-fmr\.js/,               label: 'Loads hud-fmr.js' },
    { pattern: /id=["']hudFmrPanel["']/,     label: '#hudFmrPanel section present' },
    { pattern: /id=["']hudFmrTable["']/,     label: '#hudFmrTable element present' },
    { pattern: /id=["']hudIncomeLimitsTable["']/, label: '#hudIncomeLimitsTable element present' },
    { pattern: /id=["']hudFmrAreaName["']/,  label: '#hudFmrAreaName element present' },
  ];
  checks.forEach(function (c) {
    if (c.pattern.test(html)) {
      pass(c.label);
    } else {
      fail(c.label);
    }
  });
} else {
  fail(HNA_HTML + ' not found');
}

// ─── 4. market-analysis.html integration ─────────────────────────────────────
console.log('\n── 4. market-analysis.html ──');

const MA_HTML = 'market-analysis.html';
if (fileExists(MA_HTML)) {
  const html = readFile(MA_HTML);
  if (/hud-fmr\.js/.test(html)) {
    pass('market-analysis.html loads hud-fmr.js');
  } else {
    fail('market-analysis.html does not load hud-fmr.js');
  }
} else {
  fail(MA_HTML + ' not found');
}

// ─── 5. market-analysis-controller.js ────────────────────────────────────────
console.log('\n── 5. js/market-analysis/market-analysis-controller.js ──');

const MA_CTRL = 'js/market-analysis/market-analysis-controller.js';
if (fileExists(MA_CTRL)) {
  const src = readFile(MA_CTRL);
  const checks = [
    { pattern: /_computeFmrRatio/,    label: '_computeFmrRatio helper present' },
    { pattern: /HudFmr/,              label: 'References window.HudFmr' },
    { pattern: /computeFmrRatio\(lat/, label: 'Calls _computeFmrRatio(lat, lon, acs)' },
  ];
  checks.forEach(function (c) {
    if (c.pattern.test(src)) {
      pass(c.label);
    } else {
      fail(c.label);
    }
  });
} else {
  fail(MA_CTRL + ' not found');
}

// ─── 6. deal-calculator.js ───────────────────────────────────────────────────
console.log('\n── 6. js/deal-calculator.js ──');

const DEAL_CALC = 'js/deal-calculator.js';
if (fileExists(DEAL_CALC)) {
  const src = readFile(DEAL_CALC);
  const checks = [
    { pattern: /HudFmr/,                   label: 'References window.HudFmr' },
    { pattern: /dc-county-select/,         label: 'County selector (#dc-county-select) present' },
    { pattern: /getGrossRentLimit/,        label: 'Uses getGrossRentLimit()' },
    { pattern: /updateAmiLimitsFromFmr/,   label: 'updateAmiLimitsFromFmr() function present' },
    { pattern: /_amiLimits/,               label: 'Uses dynamic _amiLimits' },
  ];
  checks.forEach(function (c) {
    if (c.pattern.test(src)) {
      pass(c.label);
    } else {
      fail(c.label);
    }
  });
} else {
  fail(DEAL_CALC + ' not found');
}

// ─── 7. Python fetch script ───────────────────────────────────────────────────
console.log('\n── 7. scripts/fetch_fmr_api.py ──');

const FMR_SCRIPT = 'scripts/fetch_fmr_api.py';
if (fileExists(FMR_SCRIPT)) {
  const src = readFile(FMR_SCRIPT);
  const checks = [
    { pattern: /hud-fmr-income-limits\.json/, label: 'Outputs data/hud-fmr-income-limits.json' },
    { pattern: /build_combined/,              label: 'build_combined() function present' },
    { pattern: /calc_income_limits/,          label: 'calc_income_limits() function present' },
    { pattern: /HUD_API_TOKEN/,               label: 'Reads HUD_API_TOKEN env var' },
  ];
  checks.forEach(function (c) {
    if (c.pattern.test(src)) {
      pass(c.label);
    } else {
      fail(c.label);
    }
  });
} else {
  fail(FMR_SCRIPT + ' not found');
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n── Summary ──');
console.log('Passed:   ' + passed);
if (warnings) console.log('Warnings: ' + warnings);
console.log('Failed:   ' + failed);

if (failed === 0) {
  console.log('\n✓ All FMR smoke tests passed' + (warnings ? ' (' + warnings + ' warning(s))' : '') + '.');
  process.exit(0);
} else {
  console.error('\n✗ ' + failed + ' test(s) failed.');
  process.exit(1);
}