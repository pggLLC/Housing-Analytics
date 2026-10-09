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

### `readWalkthrough(dir, guidedPath)`

Judge the newest record against the path as it stands today.
Returns { state, detail, record } — state is PASS, OPEN or UNMEASURED.
