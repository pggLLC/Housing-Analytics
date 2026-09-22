// Step 6 of the Pipeline page carries two financing tracks — LIHTC rental and
// affordable ownership — and, for each, the obligations that follow closing.
// This test keeps the two tracks structurally equal so neither can quietly
// become "the default" again: same level count, same obligation count, and
// the same five obligation fields, in both content.json and the renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/pipeline/content.json'), 'utf8'));
const renderer = fs.readFileSync(path.join(ROOT, 'js/pipeline.js'), 'utf8');

const step6 = content.steps.find((s) => s.n === 6);
assert.ok(step6, 'content.json has a step 6');

// Both tracks present, both with five readiness levels numbered 1..5.
const lihtcLevels = step6.readiness_levels;
const ownLevels = step6.ownership_track && step6.ownership_track.readiness_levels;
assert.ok(Array.isArray(lihtcLevels) && lihtcLevels.length === 5, 'LIHTC track has five readiness levels');
assert.ok(Array.isArray(ownLevels) && ownLevels.length === 5, 'ownership track has five readiness levels');
for (const levels of [lihtcLevels, ownLevels]) {
  assert.deepEqual(levels.map((l) => l.level), [1, 2, 3, 4, 5], 'levels are numbered 1..5 in order');
  for (const l of levels) {
    assert.ok(l.name && l.definition, `level ${l.level} has a name and a definition`);
  }
}
assert.ok(step6.readiness_label && /LIHTC/.test(step6.readiness_label),
  'the LIHTC level list is labelled as the LIHTC track, not as the unmarked default');
assert.ok(step6.ownership_track.title && step6.ownership_track.what_this_means,
  'the ownership track has a title and an explanation');
assert.ok(Array.isArray(step6.ownership_track.watch_outs) && step6.ownership_track.watch_outs.length >= 2,
  'the ownership track names its own watch-outs');

// After-closing obligations: one block per track, same count, same fields.
const ac = step6.after_closing;
assert.ok(ac && Array.isArray(ac.tracks) && ac.tracks.length === 2, 'after_closing lists exactly two tracks');
const FIELDS = ['what', 'when', 'who_reports', 'to_whom', 'if_missed'];
const trackNames = ac.tracks.map((t) => t.track);
assert.ok(trackNames.some((t) => /LIHTC/i.test(t)) && trackNames.some((t) => /ownership/i.test(t)),
  `after_closing covers both LIHTC and ownership (saw: ${trackNames.join(', ')})`);
const counts = ac.tracks.map((t) => t.obligations.length);
assert.equal(counts[0], counts[1], `both tracks carry the same number of obligations (saw ${counts.join(' vs ')})`);
assert.ok(counts[0] >= 4, 'each track carries at least four obligations');
for (const t of ac.tracks) {
  for (const o of t.obligations) {
    for (const f of FIELDS) {
      assert.ok(typeof o[f] === 'string' && o[f].trim().length > 0,
        `${t.track}: obligation "${(o.what || '').slice(0, 40)}…" has a non-empty "${f}"`);
    }
  }
}

// The page's own step count is unchanged: the tracks live inside step 6.
assert.equal(content.steps.length, 8, 'the Pipeline still has eight steps — the tracks did not add a ninth');

// Renderer wiring: both tracks and the after-closing block are rendered from
// data, and the LIHTC label is data-driven rather than hardcoded.
assert.ok(renderer.includes('s.ownership_track'), 'pipeline.js renders ownership_track');
assert.ok(renderer.includes('s.after_closing'), 'pipeline.js renders after_closing');
assert.ok(renderer.includes('s.readiness_label ||'), 'pipeline.js takes the LIHTC level label from content.json');
for (const f of FIELDS.slice(1)) {
  assert.ok(renderer.includes('o.' + f), `pipeline.js renders the "${f}" field of each obligation`);
}

console.log('pipeline-financing-tracks: PASS — both tracks carry five levels and matching after-closing obligations');
