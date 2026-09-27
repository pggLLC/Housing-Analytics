'use strict';

// The ½-mile TOD panel on market-analysis.html quotes CHFA QAP transit points.
// Those figures must agree with the QAP text the repo actually holds
// (data/audit/chfa-qap-watch.json), not with whatever the copy said last. The
// 2027–28 Third Draft is a redline of the adopted plan, so the criterion reads
// "b. Three Five points …": the struck word is the adopted figure and the
// inserted word is the proposed one. Reword the copy freely — change a number
// on one side only and this fails. (#1937 Phase 0)

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// ── 1. What the QAP text says ─────────────────────────────────────────────
const watch = JSON.parse(read('data/audit/chfa-qap-watch.json'));
const qapDoc = (watch.documents || []).find((d) => /QAP/i.test(d.title || '') && !/summary|presentation/i.test(d.title || ''));
assert.ok(qapDoc && qapDoc.text, 'chfa-qap-watch.json holds no QAP plan text to check against');
const qapText = qapDoc.text.replace(/\s+/g, ' ');

const todMatch = qapText.match(/b\.\s+([A-Za-z]+)(?:\s+([A-Za-z]+))?\s+points may be earned for proposed projects located at an existing or planned (?:TOC or )?TOD site/);
assert.ok(todMatch, 'TOD Project Location criterion not found in the QAP text — the scan found nothing to check');
const w1 = WORDS[todMatch[1].toLowerCase()];
const w2 = todMatch[2] ? WORDS[todMatch[2].toLowerCase()] : undefined;
assert.ok(Number.isInteger(w1), 'TOD points word not recognised: ' + todMatch[1]);
// Redline ("Three Five") → adopted, proposed. A single word means the plan
// was adopted as written and there is no separate proposal.
const qapAdopted = w1;
const qapDraft = Number.isInteger(w2) ? w2 : w1;

const sectionMatch = qapText.match(/Projects in non-metro counties[^.]*?\(must meet requirements of Section (5\.B\.\d+\.[a-z])/);
assert.ok(sectionMatch, 'non-metro county priority not found in the QAP text');
const qapRuralSection = '§' + sectionMatch[1];

// ── 2. What the code says ─────────────────────────────────────────────────
const maSrc = read('js/market-analysis.js');
const constBlock = maSrc.match(/var QAP_TOD = \{([\s\S]*?)\};/);
assert.ok(constBlock, 'QAP_TOD constant missing from js/market-analysis.js');
const field = (name) => {
  const m = constBlock[1].match(new RegExp(name + ':\\s*([^,\\n]+)'));
  assert.ok(m, 'QAP_TOD.' + name + ' missing');
  return m[1].trim().replace(/^'|'$/g, '');
};
const codeAdopted = Number(field('adoptedPoints'));
const codeDraft = Number(field('draftPoints'));
const codeRural = field('ruralSection');

assert.equal(codeAdopted, qapAdopted, `QAP_TOD.adoptedPoints (${codeAdopted}) disagrees with the QAP text (${qapAdopted})`);
assert.equal(codeDraft, qapDraft, `QAP_TOD.draftPoints (${codeDraft}) disagrees with the QAP text (${qapDraft})`);
assert.equal(codeRural, qapRuralSection, `QAP_TOD.ruralSection (${codeRural}) disagrees with the QAP text (${qapRuralSection})`);

// The panel builds its copy from QAP_TOD; no literal points figure may bypass it.
assert.doesNotMatch(maSrc, /['"][^'"\n]*\b\d+ CHFA (?:QAP )?(?:pts|points)\b/,
  'js/market-analysis.js hardcodes a CHFA points figure instead of reading QAP_TOD');

// Static copy that cannot read the constant must quote the same figures:
// every "N pts" / "N QAP points" / "proposes N" in it must be the adopted or
// proposed figure, and each figure must appear at least once.
function checkCopy(label, text) {
  const nums = [];
  for (const m of text.matchAll(/\b(\d+)\s+(?:CHFA\s+)?(?:QAP\s+)?(?:pts|points)\b|\(?(\d+)\s+proposed\)?|proposes\s+(\d+)/g)) {
    nums.push(Number(m[1] || m[2] || m[3]));
  }
  assert.ok(nums.length > 0, `${label}: no points figure found — the scan found nothing to check`);
  for (const n of nums) {
    assert.ok(n === qapAdopted || n === qapDraft, `${label} quotes ${n} points; the QAP text says ${qapAdopted} (adopted) / ${qapDraft} (proposed)`);
  }
  assert.ok(nums.includes(qapAdopted), `${label} does not show the adopted figure (${qapAdopted})`);
  assert.ok(nums.includes(qapDraft), `${label} does not show the proposed figure (${qapDraft})`);
}
const html = read('market-analysis.html');
const todCard = html.slice(html.indexOf('id="pmaTodPanel"'), html.indexOf('id="pmaTodContent"'));
assert.ok(todCard.length > 0, 'TOD panel not found in market-analysis.html');
checkCopy('market-analysis.html TOD panel', todCard);
const glossarySrc = read('js/components/inline-glossary.js');
const todGloss = (glossarySrc.match(/'TOD':\s*'([^']*)'/) || [])[1];
assert.ok(todGloss, 'TOD entry missing from inline glossary');
checkCopy('inline glossary TOD entry', todGloss);

// ── 3. The fallback stop search actually searches ─────────────────────────
// The TOD panel fallback once called getNearestByType('transit_stop', lat,
// lon, r) — type first, against a (lat, lon, type) signature — so it always
// returned null and counted 0. No caller may pass a string first again.
const jsFiles = [];
(function walk(dir) {
  for (const ent of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== 'vendor') walk(rel); } else if (ent.name.endsWith('.js')) jsFiles.push(rel);
  }
})('js');
assert.ok(jsFiles.length > 50, 'js/ scan found too few files to be meaningful');
for (const f of jsFiles) {
  assert.doesNotMatch(read(f), /\.(?:getNearestByType|getWithinRadius)\(\s*['"]/, `${f} passes the amenity type first`);
}
assert.match(maSrc, /\.getWithinRadius\(lat, lon, 'transit_stop', halfMile\)/, 'TOD fallback does not use getWithinRadius');
// The first source must be the unscoped statewide stop cache, not the map
// layer, which _scopeToSite trims to the previous analysis site.
const todFn = (maSrc.match(/function _highlightTodTransit[\s\S]*?\n  \}\n/) || [])[0];
assert.ok(todFn, '_highlightTodTransit not found');
assert.match(todFn, /_rawLayerData\['transitStops'\]/, 'TOD check does not read the statewide stop cache');
assert.doesNotMatch(todFn, /_mapLayers\['transitStops'\]/, 'TOD check reads the site-scoped map layer');

const sandbox = { window: {}, console: { log() {}, warn() {} } };
vm.createContext(sandbox);
vm.runInContext(read('js/data-connectors/osm-amenities.js'), sandbox);
const A = sandbox.window.OsmAmenities;
assert.equal(A.getWithinRadius(39.74, -104.99, 'transit_stop', 0.5), null, 'unloaded data must return null, not an empty list');
A.loadAmenities([
  { type: 'transit_stop', name: 'Near', lat: 39.7400, lon: -104.9900 },
  { type: 'transit_stop', name: 'Mid', lat: 39.7440, lon: -104.9900 },
  { type: 'transit_stop', name: 'Far', lat: 39.8000, lon: -104.9900 },
  { type: 'grocery', name: 'Shop', lat: 39.7401, lon: -104.9900 }
]);
const hits = A.getWithinRadius(39.7401, -104.9900, 'transit_stop', 0.5);
assert.deepEqual(Array.from(hits, (h) => h.name), ['Near', 'Mid'], 'expected the two stops inside ½ mile, nearest first');
assert.deepEqual(Array.from(A.getWithinRadius(40.5, -106.0, 'transit_stop', 0.5)), [], 'a real search with no hits returns an empty list');
assert.equal(A.getNearestByType(39.7401, -104.99, 'transit_stop').name, 'Near');

console.log(`qap-tod-points: QAP ${qapAdopted}→${qapDraft} pts, rural ${qapRuralSection}; ${jsFiles.length} js files scanned — OK`);
