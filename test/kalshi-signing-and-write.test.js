'use strict';

/**
 * Guards for the Kalshi integration, which failed three different ways in
 * sequence while the workflow reported success every time:
 *   1. KALSHI_API_SECRET was never set — the script warned and kept the seed.
 *   2. The PEM was pasted without line breaks — OpenSSL replied
 *      "error:1E08010C:DECODER routines::unsupported", which names no cause.
 *   3. The base URL was retired — trading-api.kalshi.com answers every request
 *      with HTTP 401 and "API has been moved", which reads as a bad credential.
 * Along the way an all-failed run overwrote four committed items with zero.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts/kalshi/fetch_kalshi_prediction_markets.js'), 'utf8');

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

function loadNormalizePem() {
  const fn = /function normalizePem[\s\S]*?\n}\n/.exec(SRC);
  assert.ok(fn, 'normalizePem must exist');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fn[0] + ';this.normalizePem = normalizePem;', ctx);
  return ctx.normalizePem;
}

function makeKey(pkcs8) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kal-'));
  const p1 = path.join(dir, 'k.pem');
  execFileSync('openssl', ['genrsa', '-out', p1, '2048'], { stdio: 'ignore' });
  if (!pkcs8) return { dir, pem: fs.readFileSync(p1, 'utf8') };
  const p8 = path.join(dir, 'k8.pem');
  execFileSync('openssl', ['pkcs8', '-topk8', '-nocrypt', '-in', p1, '-out', p8], { stdio: 'ignore' });
  return { dir, pem: fs.readFileSync(p8, 'utf8') };
}

const signs = (key) => {
  const s = crypto.createSign('RSA-SHA256');
  s.update('message');
  s.sign(key, 'base64');
  return true;
};

console.log('kalshi-signing-and-write');

run('a PEM flattened onto one line is repaired — PKCS#1 and PKCS#8', () => {
  const normalizePem = loadNormalizePem();
  for (const pkcs8 of [false, true]) {
    const { dir, pem } = makeKey(pkcs8);
    const flat = pem.replace(/\n/g, '');
    // Establish the bug first, so this cannot pass vacuously.
    assert.throws(() => signs(flat), /DECODER|unsupported|asn1|PEM/i,
      'a flattened PEM must genuinely fail before the repair');
    assert.equal(signs(normalizePem(flat)), true,
      (pkcs8 ? 'PKCS#8' : 'PKCS#1') + ' flattened key must sign after repair');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

run('a well-formed multi-line PEM is left alone', () => {
  const normalizePem = loadNormalizePem();
  const { dir, pem } = makeKey(true);
  assert.equal(normalizePem(pem), null, 'no rewrite is attempted on a valid PEM');
  fs.rmSync(dir, { recursive: true, force: true });
});

run('empty or unusable input yields null rather than a broken PEM', () => {
  const normalizePem = loadNormalizePem();
  for (const bad of ['', '   ', null, undefined, '-----BEGIN PRIVATE KEY----------END PRIVATE KEY-----']) {
    assert.equal(normalizePem(bad), null, JSON.stringify(bad) + ' must yield null');
  }
});

run('the retired Kalshi host is not the default', () => {
  assert.doesNotMatch(SRC, /\|\|\s*'https:\/\/trading-api\.kalshi\.com'/,
    'trading-api.kalshi.com answers every request with HTTP 401 "API has been moved"');
  assert.match(SRC, /api\.elections\.kalshi\.com/, 'the current host must be the default');
});

run('an all-failed run refuses to overwrite committed data', () => {
  assert.match(SRC, /failures\.length === MARKET_CONFIG\.length/,
    'total failure must be distinguished from a legitimately empty result');
  const guard = /if \(!items\.length && failures\.length === MARKET_CONFIG\.length\)[\s\S]{0,420}?\n  \}/.exec(SRC);
  assert.ok(guard, 'the guard block must exist');
  assert.match(guard[0], /process\.exitCode = 1/, 'and it must exit non-zero');
  assert.match(guard[0], /return;/, 'and return before writing the file');
  // The write must come after the guard, never before it.
  assert.ok(SRC.indexOf('failures.length === MARKET_CONFIG.length') <
            SRC.lastIndexOf('fs.writeFileSync(OUTPUT_FILE'),
    'the guard must precede the output write');
});

run('a signing failure explains the line-break cause', () => {
  assert.match(SRC, /re-paste KALSHI_API_SECRET with its/,
    'the error must name the cause rather than surfacing raw OpenSSL text');
});

if (failures) { console.error('kalshi-signing-and-write: FAIL'); process.exitCode = 1; }
else console.log('kalshi-signing-and-write: PASS');
