#!/usr/bin/env node
/**
 * The console audit must touch the controls, and must say when it could not.
 *
 * It used to load pages and listen — `page.on('console')`, `page.on('pageerror')`
 * — and nothing else. That misses an entire class of error by construction. On
 * 2026-09-16 the live site threw "activeBase.bringToBack is not a function"
 * every time a reader changed the basemap, and this audit could not have caught
 * it at any cadence, because nobody ever changed the basemap.
 *
 * The sharper lesson is the second one. The first interaction config targeted
 * `#hnaBasemapSelect`, which matches NOTHING: the HNA's picker is built by
 * Leaflet at runtime with no id and no class. The audit reported a clean page
 * while the interaction it was added for never ran — a check that passes
 * because it did nothing, wearing the same green as a check that passed
 * because the code is fine.
 *
 * So this pins the selectors to what the pages actually build.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'audit', 'console-error-reporter.mjs'), 'utf8');

/**
 * Strip comments before checking selectors.
 *
 * The comment above the interaction config explains WHY `#hnaBasemapSelect`
 * was wrong — and the first version of the assertion below read it as the
 * selector still being in use. Fourth time today a guard has had to learn that
 * a mention is not a usage. The explanation is worth keeping; the check has to
 * read code.
 */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => (l.trimStart().startsWith('//') ? '' : l)).join('\n');
}

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('console-audit-exercises-controls');

test('the audit exercises controls, not just page loads', () => {
  assert.ok(/const INTERACTIONS = \{/.test(SRC), 'the interaction config is gone');
  assert.ok(/async function exercise\(page, pageName, note\)/.test(SRC), 'the exercise step is gone');
  assert.ok(/await exercise\(page, pageConfig\.name/.test(SRC),
    'exercise() is defined but never called, so the audit is back to loading pages only');
});

test('the basemap swap — the interaction that was reported — is covered', () => {
  const at = SRC.indexOf('const INTERACTIONS');
  const cfg = SRC.slice(at, SRC.indexOf('\n};', at));
  assert.ok(/housing-needs-assessment/.test(cfg), 'the HNA is no longer exercised');
  assert.ok(/selectEach/.test(cfg), 'no select is cycled, so basemap swaps are never triggered');
});

test('the basemap selector targets what the page actually builds', () => {
  // js/hna/hna-controller.js creates the picker through L.DomUtil.create with
  // no id and no class. An id selector matches nothing and the audit passes
  // having done nothing.
  const controller = fs.readFileSync(path.join(ROOT, 'js', 'hna', 'hna-controller.js'), 'utf8');
  const buildsBare = /L\.DomUtil\.create\('select'/.test(controller);
  assert.ok(buildsBare,
    'the HNA no longer builds its basemap select through L.DomUtil.create — '
    + 're-check what selector reaches it before trusting this config');
  const code = codeOnly(SRC);
  const at = code.indexOf('const INTERACTIONS');
  const cfg = code.slice(at, code.indexOf('\n};', at));
  assert.ok(/\.leaflet-control select/.test(cfg),
    'the basemap interaction no longer targets .leaflet-control select. The HNA '
    + 'picker has no id and no class, so an id selector matches nothing and the '
    + 'audit reports a clean page without ever touching the control');
  assert.ok(!/#hnaBasemapSelect/.test(cfg),
    '#hnaBasemapSelect is back; it matches no element on any page');
});

test('an interaction that cannot run is recorded, not silently skipped', () => {
  // A control that disappears should be visible as "could not run", not as an
  // absence. Otherwise the audit quietly narrows over time.
  assert.ok(/could not run/.test(SRC),
    'a failed interaction is swallowed with no record, so coverage can shrink invisibly');
  assert.ok(/exercised,/.test(SRC),
    'the list of interactions actually performed is not reported per page');
});

test('the audit still cannot fail the build on its own', () => {
  // Unchanged behaviour, asserted so it is a decision: the reporter exits 0 and
  // the workflow decides. Errors are surfaced by filing an issue.
  assert.ok(/errors may still have been found; caller decides/.test(SRC),
    'the exit-code contract changed; check the workflow still surfaces findings');
});

/* ── the advisory wrap audit ─────────────────────────────────────────────── */

test('the wrap audit exists, is advisory, and says so', () => {
  const wrap = fs.readFileSync(path.join(ROOT, 'scripts', 'audit', 'text-wrap-audit.mjs'), 'utf8');
  assert.ok(/ADVISORY/.test(wrap), 'the advisory contract is no longer stated in the file');
  assert.ok(!/process\.exit\(1\)/.test(wrap),
    'the wrap audit can now fail the build; it was asked to be advisory, and making '
    + 'it a gate is a decision to take deliberately');
});

test('the wrap audit ignores legal break opportunities', () => {
  // Breaking "2026-04-30" or "auto-selected" after a hyphen is correct CSS.
  // Reporting those is how an advisory report fills with noise and stops being
  // read — which is the failure mode advisory checks have.
  const wrap = fs.readFileSync(path.join(ROOT, 'scripts', 'audit', 'text-wrap-audit.mjs'), 'utf8');
  assert.ok(/legal break opportunity/.test(wrap), 'the hyphen exclusion rationale is gone');
  assert.ok(/u2010-\\u2015/.test(wrap) || /\\u2010/.test(wrap),
    'the hyphen/dash exclusion is gone; hyphenated words will be reported as defects');
});

test('the wrap audit counts line boxes, not box height', () => {
  // Dividing height by line-height counts the BOX. Any leaf with extra height
  // reported two lines while showing one: that version produced 1,091
  // "findings", of which the real count was 64.
  const wrap = fs.readFileSync(path.join(ROOT, 'scripts', 'audit', 'text-wrap-audit.mjs'), 'utf8');

  // Anchored on the METHOD, not on the variable it was called with.
  //
  // This used to require the literal `selectNodeContents(node)` and failed when
  // the probe started measuring the element rather than one of its text nodes —
  // a deliberate change, because an element can hold inline children whose
  // lines a single text node does not see. The identifier was never the point;
  // counting real line boxes instead of dividing a box height was.
  assert.ok(/selectNodeContents\(/.test(wrap) && /getClientRects\(\)/.test(wrap),
    'line counting no longer measures a Range\'s client rects, so it is back to '
    + 'estimating from the box');
  assert.ok(!/\.height\s*[-/]\s*(padY|lineHeight|lh)\b/.test(wrap),
    'the height-over-line-height estimate is back: that version reported two lines '
    + 'for any leaf with extra height and produced 1,091 findings, of which 64 were real');
});

test('the wrap audit looks at the pages people are on', () => {
  // It reported zero for weeks while text wrapped in the site header on every
  // page, and one reason was that its five-page list did not include the
  // homepage — the page every visitor sees, and the one the wrap was reported
  // on. A smoke check that skips the front door is not small, it is aimed
  // wrong.
  const wrap = fs.readFileSync(path.join(ROOT, 'scripts', 'audit', 'text-wrap-audit.mjs'), 'utf8');
  const list = /const PAGES = \[([\s\S]*?)\]/.exec(wrap);
  assert.ok(list, 'the PAGES list has moved; this guard can no longer read it');
  assert.ok(/^\s*'\/'\s*,/m.test(list[1]),
    'the homepage is not in the wrap audit\'s page list');
  const count = (list[1].match(/'\//g) || []).length;
  assert.ok(count >= 8,
    `only ${count} pages are audited; the guided path plus its entry points is more than that`);
  assert.ok(/const WIDTHS = \[[^\]]*1024/.test(wrap),
    'the audit no longer tests a mid width, which is where columns get tight');
});

test('available width is the content box, not the border box', () => {
  // Measuring against the border box made a nav pill "fit in 125px" when 22px
  // of that was padding and the text needed 123px. It does not fit, it wraps
  // correctly, and it was reported as a defect on exactly that arithmetic.
  const wrap = fs.readFileSync(path.join(ROOT, 'scripts', 'audit', 'text-wrap-audit.mjs'), 'utf8');
  assert.ok(/paddingLeft/.test(wrap) && /paddingRight/.test(wrap),
    'horizontal padding is no longer subtracted, so every padded element reports '
    + 'more room than it has');
});

test('the advisory report stays out of the tracked data manifest', () => {
  // The first version wrote data/reports/text-wrap-audit.json and the manifest
  // coverage guard failed the build — correctly. An advisory check should not
  // add churn to a tracked artifact every time someone runs it.
  const wrap = fs.readFileSync(path.join(ROOT, 'scripts', 'audit', 'text-wrap-audit.mjs'), 'utf8');
  assert.ok(/'audit-report'/.test(wrap),
    'the wrap audit no longer writes to audit-report/; if it writes into data/ '
    + 'again it will break test:file-manifest on every run');
  assert.ok(!/'data', 'reports', 'text-wrap-audit\.json'/.test(wrap),
    'the wrap audit writes into the tracked data manifest again');
});

test('the wrap audit runs somewhere with a browser', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'console-error-audit.yml'), 'utf8');
  assert.ok(/text-wrap-audit\.mjs/.test(wf), 'nothing runs the wrap audit');
  assert.ok(/playwright install/.test(wf), 'that lane no longer installs a browser');
  assert.ok(/continue-on-error: true/.test(wf),
    'the wrap step can fail the workflow; it is meant to be advisory');
});

console.log(failures === 0
  ? '  console-audit-exercises-controls: PASS'
  : `  console-audit-exercises-controls: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
