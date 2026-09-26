#!/usr/bin/env node
/**
 * required-fetch-preserves-data — a failed fetch must never publish emptiness.
 *
 * scripts/fetch_nhpd.py had neither an empty-guard nor a nonzero exit. When the
 * NHPD request failed — routine, the source is registration-gated — it broke
 * out of its loop, wrote a GeoJSON with zero features OVER the last good file,
 * and returned 0. The workflow went green while destroying data.
 *
 * "Zero affordable housing properties in Colorado" is not a finding. It is a
 * failed request, and publishing it as current data is worse than publishing
 * nothing.
 *
 * This runs the script for real with the network forced to fail, because a
 * source grep cannot tell whether a guard is reached. An earlier version of
 * this check "passed" against a script that crashed on a Python 3.10-only type
 * annotation: exit 1 and an untouched file looked exactly like the guard
 * working.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);

console.log('\nrequired-fetch-preserves-data');

const CASES = [
  {
    script: 'scripts/fetch_nhpd.py',
    output: 'data/market/nhpd_co.geojson',
    countFeatures: (txt) => (JSON.parse(txt).features || []).length,
  },
  {
    // CDOT is the primary source; without it the statewide file must stand.
    script: 'scripts/market/build_transit_stops_co.py',
    output: 'data/amenities/transit_stops_statewide_co.geojson',
    countFeatures: (txt) => (JSON.parse(txt).features || []).length,
  },
];

for (const c of CASES) {
  const scriptPath = path.join(ROOT, c.script);
  const outPath = path.join(ROOT, c.output);
  if (!fs.existsSync(scriptPath)) { fail(`${c.script} is missing`); continue; }
  if (!fs.existsSync(outPath)) { fail(`${c.output} is missing — nothing to protect`); continue; }

  const before = fs.readFileSync(outPath, 'utf8');
  const beforeCount = c.countFeatures(before);
  if (beforeCount === 0) {
    fail(`${c.output} already holds zero features — this guard cannot prove preservation against `
       + `an already-empty file, and an empty committed file is itself the defect`);
    continue;
  }

  // TWO failure modes, because they exercise different guards. Forcing the
  // network to fail always trips the first-request guard, so it cannot tell
  // whether the empty-result guard still exists — the two are independent
  // defences and a single scenario leaves one of them untested.
  //
  //   'unreachable'  the source refuses the connection (the registration gate)
  //   'empty'        the source answers 200 with zero records
  const MODES = {
    unreachable: `
def boom(*a, **k): raise OSError('simulated source failure')
urllib.request.urlopen = boom
`,
    empty: `
import io, json
class _Resp(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False
def _ok(*a, **k):
    return _Resp(json.dumps({'results': [], 'count': 0, 'next': None}).encode())
urllib.request.urlopen = _ok
`,
  };

  for (const [mode, stub] of Object.entries(MODES)) {
  const harness = `
import sys, runpy, urllib.request
${stub}
sys.argv = ['${path.basename(c.script)}']
try:
    runpy.run_path(${JSON.stringify(scriptPath)}, run_name='__main__')
except SystemExit as e:
    sys.stderr.write('EXIT_CODE=%s\\n' % e.code)
    raise
`;
  const tmp = path.join(os.tmpdir(), `fetchguard-${Date.now()}.py`);
  fs.writeFileSync(tmp, harness);

  let exited = 0, out = '';
  try {
    out = execFileSync('python3', [tmp], { cwd: ROOT, stdio: 'pipe' }).toString();
  } catch (err) {
    exited = err.status;
    out = ((err.stdout || '') + (err.stderr || '')).toString();
  } finally {
    fs.unlinkSync(tmp);
  }

  const after = fs.readFileSync(outPath, 'utf8');
  const afterCount = c.countFeatures(after);

  // Restore immediately if anything did get written, so a failing guard cannot
  // itself destroy the data it is protecting.
  if (after !== before) fs.writeFileSync(outPath, before);

  if (afterCount < beforeCount) {
    fail(`${c.script} [${mode}] overwrote ${c.output}: ${beforeCount} → ${afterCount} `
       + `features. A failed request must not replace good data with emptiness.`);
  } else if (exited === 0) {
    fail(`${c.script} [${mode}] exited 0 having retrieved nothing. The workflow would go green having `
       + `retrieved nothing — the alert.js defect (#1619) in a different place.`);
  } else if (/SyntaxError|TypeError: unsupported operand|ModuleNotFoundError/.test(out)) {
    fail(`${c.script} did not run — it failed to load (${out.split('\n').filter(Boolean).pop()}). `
       + `Exit 1 and an untouched file look like the guard working, but nothing was exercised.`);
  } else if (!/refus|not overwrit|0 features|no usable response/i.test(out)) {
    fail(`${c.script} exited ${exited} but said nothing about refusing to overwrite; the message `
       + `must name what it declined to do. Got: ${JSON.stringify(out.trim().slice(0, 120))}`);
  } else {
    ok(`${path.basename(c.script)} [${mode}]: exit ${exited}, ${beforeCount} features preserved, refusal stated`);
  }
  }
}

if (failures) { console.error(`\nrequired-fetch-preserves-data: FAIL (${failures})`); process.exit(1); }
console.log('required-fetch-preserves-data: PASS');
