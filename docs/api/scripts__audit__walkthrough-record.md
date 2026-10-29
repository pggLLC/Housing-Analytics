# `scripts/audit/walkthrough-record.mjs`

Reading a recorded guided-path walkthrough (G3).

G3 asks whether a person unfamiliar with housing finance can finish the
guided path and come out with something they trust. That is a judgement
about comprehension; no amount of code can derive it. Until now the audit
said so by hardcoding UNMEASURED — honest, but it meant a walkthrough that
DID happen had nowhere to land, and the finish line could never reach a
full count however much real work was done.

This reads a record instead. It does not make the judgement; it checks that
a human made one, and reports what they said.

── Three things this deliberately does NOT do ──

1. It cannot only record success. A mechanism that can express "we walked
   it and it worked" but not "we walked it and I would not use this" is a
   success-shaped form, and this repo has spent a week removing those. A
   negative verdict is a valid, complete record — it reports OPEN with the
   reader's own blockers, which is a far more useful state than UNMEASURED.

2. It does not accept a walkthrough by someone who knew the tool. The
   `unfamiliar` field must say yes. A walkthrough by the person who built
   it answers a different question, and one of those has already been done
   (#1837) — it found structural breaks and could not speak to whether a
   newcomer understands the output.

3. It does not let an old record cover a changed path. The record names the
   steps it walked; if the guided path has since gained, lost or reordered
   a step, the record no longer describes the product and G3 returns to
   UNMEASURED naming the difference. A walkthrough of a different route is
   not evidence about this one.

4. It does not let one walkthrough stand for every kind of place. Phase 2
   (docs/FINISH-LINE.md) needs a city, a rural county and a small town,
   walked by three different people. Until 2026-10-14 this read only the
   newest record, so one city walk would have passed G3 outright.

None of this makes the record unforgeable — someone determined to write a
fictional walkthrough can. It makes an ACCIDENTAL pass impossible: you
cannot satisfy this by leaving a template in place, by walking it yourself,
or by letting a stale record ride.

## Symbols

### `PLACEHOLDERS`

Template text that must not survive into a real record.

### `stepNotes(body)`

The per-step sections, keyed by the step number in the heading.

Split rather than matched with a lookahead: the first version ended each
section with `(?=^###\s|\Z)`, and \Z is Python. JavaScript read it as a
literal Z, so no section ever terminated and every record — including a
complete one — came back with no notes and scored UNMEASURED. A parser that
fails closed still fails.

### `recordFiles(dir)`

Every record file, newest first by filename (they are date-prefixed).

### `JURISDICTION_TYPES`

The three kinds of place Phase 2 needs walked (docs/FINISH-LINE.md, agreed
by the owner 2026-10-14). One walkthrough is one reader in one place; it
says nothing about whether a rural county's reader gets through. So G3
needs one complete record of each, by three different people.

The type is written on the record, not derived: "city" against "small town"
is a judgement about the place, and the person who arranged the walk is the
one placed to make it.

### `judgeRecord(file, guidedPath)`

Judge one record against the path as it stands today.
Returns { state, detail, record, type, walker, jurisdiction } — state is
PASS (would act), OPEN (would not act) or UNMEASURED (does not count).

### `readWalkthrough(dir, guidedPath)`

Judge every record and decide G3 across them.

Per jurisdiction type, the NEWEST record that counts decides: a later walk
after fixes supersedes an earlier would-not-act. Records that do not count
(incomplete, familiar walker, old path) are named, never silently skipped.

  OPEN        a type's newest counting record says would-not-act
  PASS        every type has a would-act record, by three different people
  UNMEASURED  anything short of that — say which types are still needed

Returns { state, detail, record }.
