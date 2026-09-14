#!/usr/bin/env node
/**
 * public-config-no-secrets — nothing served to the browser may carry a secret.
 *
 * .github/workflows/deploy.yml generates js/config.js at deploy time and it is
 * served to every visitor at the site path /js/config.js. From
 * 2026-02-26 to 2026-09-14 that step interpolated secrets.CENSUS_API_KEY and
 * secrets.FRED_API_KEY straight into it, publishing both for six months.
 *
 * It was invisible to review: the repo copy of js/config.js has empty strings,
 * so `git log` and a local checkout both look clean. Only the deployed artifact
 * carried the values. That is why this asserts the GENERATOR, not the file.
 *
 * Neither key was needed. Census answers every endpoint this site calls without
 * one, and FRED cannot be called from a browser at all (CORS) -- its data comes
 * from data/fred-data.json, built server-side. The ~18 workflows that use those
 * secrets on the runner are unaffected and must stay that way.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEPLOY = path.join(ROOT, '.github', 'workflows', 'deploy.yml');
const CONFIG = path.join(ROOT, 'js', 'config.js');

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };

console.log('\npublic-config-no-secrets');

/* ── 1. the generator step must not interpolate any secret ─────────────── */

const deploySrc = fs.readFileSync(DEPLOY, 'utf8');
// Strip comments so the note explaining what this replaced does not trip it.
const deployCode = deploySrc.replace(/^\s*#.*$/gm, '');

const secretRefs = [...deployCode.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
if (secretRefs.length) {
  fail(`deploy.yml interpolates secret(s) ${[...new Set(secretRefs)].join(', ')}. This workflow `
     + `publishes the site; a secret referenced here can reach js/config.js, which every visitor `
     + `downloads. Server-side secrets belong in the workflows that fetch data, not in the deploy.`);
}

// Narrower, harder assertion: whatever the generator writes must not name a key.
const heredoc = deployCode.match(/cat > js\/config\.js\s*<<-?\s*'?EOF'?([\s\S]*?)\n\s*EOF\s*$/m);
if (!heredoc) {
  fail('could not locate the js/config.js generator heredoc in deploy.yml — this guard would '
     + 'pass vacuously if the step were renamed or restructured');
} else {
  const body = heredoc[1];
  for (const name of body.match(/[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|WEBHOOK)[A-Z0-9_]*/g) || []) {
    fail(`the generated js/config.js declares "${name}" — public config must carry no credential `
       + `field at all, not even an empty one, so nothing can later be wired into it`);
  }
}

/* ── 2. the committed config must not carry populated credentials ──────── */

const cfg = fs.readFileSync(CONFIG, 'utf8');
for (const m of cfg.matchAll(/([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*:\s*"([^"]*)"/g)) {
  const [, name, value] = m;
  if (value.trim() !== '' && value !== 'test') {
    fail(`js/config.js sets ${name} to a non-empty literal. This file is served publicly; user-supplied `
       + `keys belong in the localStorage override (coho_api_*), which never leaves the browser.`);
  }
}

/* ── 3. nothing may tell a user to put a key in the public file ────────── */

const advice = [];
for (const rel of ['js', 'scripts']) {
  const base = path.join(ROOT, rel);
  const stack = [base];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'vendor' || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      if (!/\.(js|mjs|cjs)$/.test(e.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      // "set <KEY> in js/config.js" style instructions, in any wording
      const re = /(set|add|put|configure)[^.;\n]{0,60}(API_KEY|api key)[^.;\n]{0,60}(in|to)\s+js\/config\.js/gi;
      if (re.test(src)) advice.push(path.relative(ROOT, p));
    }
  }
}
for (const f of advice) {
  fail(`${f} instructs setting an API key in js/config.js — that file is published, so following `
     + `the instruction leaks the key. Point at the Data Quality Dashboard localStorage override instead.`);
}

if (failures) {
  console.error(`\npublic-config-no-secrets: FAIL (${failures})`);
  process.exit(1);
}
console.log('  ✓ deploy.yml interpolates no secrets into the published config');
console.log('  ✓ the generated config declares no credential fields');
console.log('  ✓ js/config.js carries no populated credential literals');
console.log('  ✓ nothing instructs putting a key in the public config');
console.log('public-config-no-secrets: PASS');
