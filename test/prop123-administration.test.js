#!/usr/bin/env node
// test/prop123-administration.test.js
//
// Proposition 123's State Affordable Housing Fund is split between two
// agencies (cdola.colorado.gov/prop123, checked 2026-09-25):
//
//   - 60% is overseen by OEDIT and managed by CHFA: the Affordable Housing
//     Financing Fund — land banking, equity, concessionary debt (including
//     LIHTC gap finance).
//   - 40% goes to DOLA: the Affordable Housing Support Fund — homeownership,
//     homelessness, local planning capacity. DOLA also takes the local
//     commitment filings.
//
// The site said "administered by DOLA" in four places, credited DOLA with
// land banking and gap financing, and linked two DOLA addresses that no
// longer serve the program: /proposition-123 now redirects to the OEDIT fund's
// site, and /prop-123 is a 404. Both were allow-listed in the URL sweeps as
// "bot-blocked", which is how the 404 went unnoticed.
//
// The split is a claim that must be true, so it is pinned. Every description
// of who runs Prop 123 must agree with it — not with a particular sentence.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const DEAD_URLS = [
  'cdola.colorado.gov/proposition-123', // 301 → coloradoaffordablehousingfinancingfund.com (OEDIT side only)
  'cdola.colorado.gov/prop-123',        // 404
];
const HUB = 'https://cdola.colorado.gov/prop123';
const OEDIT_FUND_HOST = 'coloradoaffordablehousingfinancingfund.com';

// Compare hosts exactly: a substring test would accept any URL that merely
// contains the host name somewhere (CodeQL js/incomplete-url-substring-sanitization).
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return null; } };

// A description of the whole program must name both agencies with their shares.
function assertSplit(text, where) {
  assert.match(text, /60%[^.]*OEDIT|OEDIT[^.]*60%/, `${where}: must say OEDIT oversees 60%`);
  assert.match(text, /CHFA/, `${where}: must say CHFA manages OEDIT's share`);
  assert.match(text, /40%[^.]*DOLA|DOLA[^.]*40%/, `${where}: must say DOLA receives 40%`);
}

// ── 1. Every whole-program description carries the split ─────────────
const soft = JSON.parse(read('data/policy/soft-funding-status.json')).programs;
const cal = JSON.parse(read('data/chfa-qap-calendar.json'));
const dealCalc = read('js/deal-calculator.js');

const descriptions = [
  ['soft-funding-status PROP123-AHTF', soft['PROP123-AHTF'].description],
  ['chfa-qap-calendar rolling Prop 123', (cal.rolling_programs.find((p) => p.category === 'prop123') || {}).description],
  ['chfa-qap-calendar metadata note', cal.metadata.notes.find((n) => /Prop 123/.test(n))],
  ['deal-calculator soft-funding reference', (dealCalc.match(/k: 'prop123'[\s\S]*?desc: '([^']*)'/) || [])[1]],
];
for (const [where, text] of descriptions) {
  assert.ok(text, `${where}: description not found`);
  assertSplit(text, where);
}

// ── 2. Program entries name the agency that actually runs them ───────
assert.match(soft['PROP123-AHTF'].adminEntity, /OEDIT/, 'PROP123-AHTF adminEntity must name OEDIT');
assert.match(soft['PROP123-AHTF'].adminEntity, /DOLA/, 'PROP123-AHTF adminEntity must name DOLA');
// Land banking is an OEDIT/CHFA program, not a DOLA one.
assert.match(soft['PROP123-LBTF'].adminEntity, /OEDIT/, 'land banking is administered by OEDIT/CHFA');
assert.doesNotMatch(soft['PROP123-LBTF'].adminEntity, /DOLA/, 'land banking is not a DOLA program');
assert.equal(hostOf(soft['PROP123-LBTF'].contactUrl), OEDIT_FUND_HOST, 'land banking contact must be the OEDIT fund site');
const landValue = read('land-value.html');
const landLink = landValue.match(/<a href="([^"]+)"[^>]*>([^<]*Land Banking[^<]*)<\/a>/);
assert.ok(landLink, 'land-value.html must link the Prop 123 land-banking program');
assert.equal(hostOf(landLink[1]), OEDIT_FUND_HOST, 'the land-banking link must go to the OEDIT fund site');
assert.doesNotMatch(landLink[2], /DOLA/, 'the land-banking link must not be labelled DOLA');

// ── 3. No line says Prop 123 is administered by DOLA alone ───────────
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter((f) => /\.(html|js|mjs|json|md|py)$/.test(f))
  .filter((f) => !/^(node_modules|js\/vendor|data\/reports)\//.test(f))
  .filter((f) => !['data/_manifest.json', 'data/manifest.json', 'data/url-health.json'].includes(f))
  .filter((f) => f !== 'test/prop123-administration.test.js');
assert.ok(tracked.length > 500, `scan must cover the repo, found ${tracked.length} files`);

let prop123Mentions = 0;
const soloDola = [];
const deadLinks = [];
for (const f of tracked) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const url of DEAD_URLS) {
    if (src.includes(url)) deadLinks.push(`${f}: ${url}`);
  }
  // By line, not by sentence: in a JSON field or an HTML line the claim is
  // often its own sentence ("…affordable housing. Administered by DOLA."),
  // which a sentence split would separate from the words "Prop 123".
  for (const line of src.split('\n')) {
    if (!/\bProp(osition)?\.? ?123\b/i.test(line)) continue;
    prop123Mentions++;
    if (/administered by DOLA\b/i.test(line) && !/OEDIT/.test(line)) soloDola.push(`${f}: ${line.trim().slice(0, 160)}`);
  }
}
assert.ok(prop123Mentions > 50, `scan must find Prop 123 mentions to check, found ${prop123Mentions}`);
assert.deepEqual(soloDola, [], 'Prop 123 is not administered by DOLA alone (60% OEDIT/CHFA, 40% DOLA):\n' + soloDola.join('\n'));
assert.deepEqual(deadLinks, [], `use ${HUB} (or commitment-filings / the OEDIT fund site):\n` + deadLinks.join('\n'));

// ── 4. The URL sweeps may not allow-list the dead addresses ──────────
// An allow-list entry is what hid the 404: a sweep that skips a URL can never
// report it. (Covered by the scan above too; named here for the reason.)
for (const sweep of ['scripts/audit/source-url-sweep.mjs', 'scripts/audit/url-health-sweep.mjs']) {
  // The allow-list entries, as exact strings.
  const entries = [...read(sweep).matchAll(/^\s*["'](https?:\/\/[^"']+)["'],/gm)].map((m) => m[1]);
  // Exact membership. (Array#includes is exact too, but CodeQL reads it as a
  // string substring test on a URL; Set#has says what it means.)
  assert.ok(new Set(entries).has(HUB), `${sweep}: expected the live hub in its list (non-vacuity)`);
  for (const url of DEAD_URLS) {
    const dead = entries.filter((e) => hostOf(e) + new URL(e).pathname.replace(/\/$/, '') === url);
    assert.deepEqual(dead, [], `${sweep} must not allow-list ${url}`);
  }
}

console.log(`prop123-administration: ${descriptions.length} descriptions carry the 60/40 split; ` +
  `${prop123Mentions} Prop 123 mentions in ${tracked.length} files scanned; no dead links — OK`);
