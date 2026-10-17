/**
 * Reading a recorded guided-path walkthrough (G3).
 *
 * G3 asks whether a person unfamiliar with housing finance can finish the
 * guided path and come out with something they trust. That is a judgement
 * about comprehension; no amount of code can derive it. Until now the audit
 * said so by hardcoding UNMEASURED — honest, but it meant a walkthrough that
 * DID happen had nowhere to land, and the finish line could never reach a
 * full count however much real work was done.
 *
 * This reads a record instead. It does not make the judgement; it checks that
 * a human made one, and reports what they said.
 *
 * ── Three things this deliberately does NOT do ──
 *
 * 1. It cannot only record success. A mechanism that can express "we walked
 *    it and it worked" but not "we walked it and I would not use this" is a
 *    success-shaped form, and this repo has spent a week removing those. A
 *    negative verdict is a valid, complete record — it reports OPEN with the
 *    reader's own blockers, which is a far more useful state than UNMEASURED.
 *
 * 2. It does not accept a walkthrough by someone who knew the tool. The
 *    `unfamiliar` field must say yes. A walkthrough by the person who built
 *    it answers a different question, and one of those has already been done
 *    (#1837) — it found structural breaks and could not speak to whether a
 *    newcomer understands the output.
 *
 * 3. It does not let an old record cover a changed path. The record names the
 *    steps it walked; if the guided path has since gained, lost or reordered
 *    a step, the record no longer describes the product and G3 returns to
 *    UNMEASURED naming the difference. A walkthrough of a different route is
 *    not evidence about this one.
 *
 * 4. It does not let one walkthrough stand for every kind of place. Phase 2
 *    (docs/FINISH-LINE.md) needs a city, a rural county and a small town,
 *    walked by three different people. Until 2026-10-14 this read only the
 *    newest record, so one city walk would have passed G3 outright.
 *
 * None of this makes the record unforgeable — someone determined to write a
 * fictional walkthrough can. It makes an ACCIDENTAL pass impossible: you
 * cannot satisfy this by leaving a template in place, by walking it yourself,
 * or by letting a stale record ride.
 */

import fs from 'node:fs';
import path from 'node:path';

export const VERDICTS = { ACT: 'would-act', NOT: 'would-not-act' };

/** Template text that must not survive into a real record. */
const PLACEHOLDERS = [
  /<[^>]*>/,                       // <your name>, <what you expected>
  /^\s*(TBD|TODO|N\/?A|\.\.\.|-+)\s*$/i,
  /what (they|you) expected/i,
  /fill (this )?in/i,
];

const MIN_NOTE_CHARS = 40;

function field(body, name) {
  const re = new RegExp(`^\\s*[-*]\\s*\\*\\*${name}:\\*\\*\\s*(.+)$`, 'im');
  const m = re.exec(body);
  return m ? m[1].trim() : null;
}

function isPlaceholder(text) {
  if (!text) return true;
  return PLACEHOLDERS.some((rx) => rx.test(text));
}

/** The per-step sections, keyed by the step number in the heading.
 *
 * Split rather than matched with a lookahead: the first version ended each
 * section with `(?=^###\s|\Z)`, and \Z is Python. JavaScript read it as a
 * literal Z, so no section ever terminated and every record — including a
 * complete one — came back with no notes and scored UNMEASURED. A parser that
 * fails closed still fails.
 */
function stepNotes(body) {
  const out = new Map();
  const parts = body.split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const m = /^(\d+)\.\s*([^\n]*)\n([\s\S]*)$/.exec(part);
    if (!m) continue;
    out.set(Number(m[1]), { heading: m[2].trim(), notes: m[3].trim() });
  }
  return out;
}

/** Every record file, newest first by filename (they are date-prefixed). */
export function recordFiles(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => /^\d{4}-\d{2}-\d{2}.*\.md$/.test(n))
    .sort()
    .reverse()
    .map((n) => path.join(dir, n));
}

/**
 * The three kinds of place Phase 2 needs walked (docs/FINISH-LINE.md, agreed
 * by the owner 2026-10-14). One walkthrough is one reader in one place; it
 * says nothing about whether a rural county's reader gets through. So G3
 * needs one complete record of each, by three different people.
 *
 * The type is written on the record, not derived: "city" against "small town"
 * is a judgement about the place, and the person who arranged the walk is the
 * one placed to make it.
 */
export const JURISDICTION_TYPES = ['city', 'rural county', 'small town'];

/**
 * Judge one record against the path as it stands today.
 * Returns { state, detail, record, type, walker, jurisdiction } — state is
 * PASS (would act), OPEN (would not act) or UNMEASURED (does not count).
 */
export function judgeRecord(file, guidedPath) {
  const body = fs.readFileSync(file, 'utf8');
  const rel = path.relative(process.cwd(), file);

  const walker = field(body, 'Walker');
  const unfamiliar = (field(body, 'Unfamiliar with the tool') || '').toLowerCase();
  const jurisdiction = field(body, 'Jurisdiction');
  const type = (field(body, 'Jurisdiction type') || '').toLowerCase();
  const verdict = (field(body, 'Verdict') || '').toLowerCase();
  const out = (state, detail) => ({ state, detail, record: rel, type, walker, jurisdiction });

  const missing = [];
  if (isPlaceholder(walker)) missing.push('Walker');
  if (isPlaceholder(jurisdiction)) missing.push('Jurisdiction');
  if (!JURISDICTION_TYPES.includes(type)) {
    missing.push(`Jurisdiction type (${JURISDICTION_TYPES.join(', ')})`);
  }
  if (!['yes', 'no'].includes(unfamiliar)) missing.push('Unfamiliar with the tool (yes/no)');
  if (![VERDICTS.ACT, VERDICTS.NOT].includes(verdict)) {
    missing.push(`Verdict (${VERDICTS.ACT} or ${VERDICTS.NOT})`);
  }
  if (missing.length) {
    return out('UNMEASURED', `${rel} is incomplete — missing or unfilled: ${missing.join(', ')}`);
  }

  if (unfamiliar !== 'yes') {
    return out('UNMEASURED', `${rel} records a walkthrough by someone already familiar with the tool, `
      + 'which answers a different question. G3 needs a first-time reader');
  }

  // The record must describe the path that ships today.
  const notes = stepNotes(body);
  const walked = [...notes.keys()].sort((a, b) => a - b);
  const expected = guidedPath.map((s) => s.step).sort((a, b) => a - b);
  if (walked.join(',') !== expected.join(',')) {
    return out('UNMEASURED', `${rel} covers steps ${walked.join(',') || '(none)'} but the guided path is now `
      + `${expected.join(',')} — the path changed since the walkthrough, so the record no `
      + 'longer describes the product. Walk it again');
  }
  const thin = guidedPath
    .filter((s) => {
      const n = notes.get(s.step);
      return !n || n.notes.length < MIN_NOTE_CHARS || isPlaceholder(n.notes);
    })
    .map((s) => `${s.step} (${s.name})`);
  if (thin.length) {
    return out('UNMEASURED', `${rel} has no real notes for step(s) ${thin.join(', ')}`);
  }

  if (verdict === VERDICTS.NOT) {
    return out('OPEN', `${walker} walked all ${guidedPath.length} steps for ${jurisdiction} (${type}) `
      + `and would NOT act on the result — see ${rel}`);
  }
  return out('PASS', `${walker}, unfamiliar with the tool, completed all ${guidedPath.length} steps `
    + `for ${jurisdiction} (${type}) and would act on the result — ${rel}`);
}

/**
 * Judge every record and decide G3 across them.
 *
 * Per jurisdiction type, the NEWEST record that counts decides: a later walk
 * after fixes supersedes an earlier would-not-act. Records that do not count
 * (incomplete, familiar walker, old path) are named, never silently skipped.
 *
 *   OPEN        a type's newest counting record says would-not-act
 *   PASS        every type has a would-act record, by three different people
 *   UNMEASURED  anything short of that — say which types are still needed
 *
 * Returns { state, detail, record }.
 */
export function readWalkthrough(dir, guidedPath) {
  const files = recordFiles(dir);
  const need = JURISDICTION_TYPES.join(', ');
  if (!files.length) {
    return {
      state: 'UNMEASURED',
      detail: `no walkthrough recorded — needs three people, unfamiliar with the tool, each `
        + `completing all ${guidedPath.length || 'of the'} steps for one of: ${need}. `
        + `Copy ${path.relative(process.cwd(), path.join(dir, 'TEMPLATE.md'))} and fill it in`,
      record: null,
    };
  }

  const judged = files.map((f) => judgeRecord(f, guidedPath));   // newest first
  const ignored = judged.filter((j) => j.state === 'UNMEASURED');
  const byType = new Map();
  for (const j of judged) {
    if (j.state !== 'UNMEASURED' && !byType.has(j.type)) byType.set(j.type, j);
  }
  const counted = JURISDICTION_TYPES.map((t) => byType.get(t)).filter(Boolean);
  const record = judged.map((j) => j.record).join(', ');
  const notCounted = ignored.length
    ? `. Not counted: ${ignored.map((j) => j.detail).join('; ')}`
    : '';

  const negative = counted.filter((j) => j.state === 'OPEN');
  if (negative.length) {
    return { state: 'OPEN', detail: negative.map((j) => j.detail).join('; ') + notCounted, record };
  }

  const stillNeeded = JURISDICTION_TYPES.filter((t) => !byType.has(t));
  if (stillNeeded.length) {
    const done = counted.length
      ? `${counted.length} of ${JURISDICTION_TYPES.length} walked (${counted.map((j) => `${j.type}: ${j.jurisdiction}`).join(', ')})`
      : `0 of ${JURISDICTION_TYPES.length} walked`;
    return {
      state: 'UNMEASURED',
      detail: `${done}; still needed: ${stillNeeded.join(', ')}${notCounted}`,
      record,
    };
  }

  const walkers = new Set(counted.map((j) => j.walker.toLowerCase()));
  if (walkers.size < JURISDICTION_TYPES.length) {
    return {
      state: 'UNMEASURED',
      detail: `all ${JURISDICTION_TYPES.length} types are walked, but by ${walkers.size} `
        + `${walkers.size === 1 ? 'person' : 'people'}; G3 needs ${JURISDICTION_TYPES.length} `
        + `different first-time readers${notCounted}`,
      record,
    };
  }

  return {
    state: 'PASS',
    detail: `${counted.length} unfamiliar readers completed all ${guidedPath.length} steps and would act `
      + `on the result — ${counted.map((j) => `${j.walker} (${j.type}: ${j.jurisdiction})`).join(', ')}${notCounted}`,
    record,
  };
}
