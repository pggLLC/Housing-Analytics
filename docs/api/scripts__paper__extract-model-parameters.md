# `scripts/paper/extract-model-parameters.mjs`

Extract every published constant and weight from the code that uses it.

A methods paper is only peer-reviewable if the formulas it prints are the
formulas that run. Transcribing them by hand guarantees the opposite, and
this repository has already demonstrated it: working-paper.html §6.3
described the ownership affordability model as "20% down, 6.5%, 0.65% tax,
0.85% insurance, 43% back-end DTI". The registry holds SEVEN models, the
default is 30% front-end rather than 43% back-end, and js/config/
financial-constants.js carries a third set again (5% down, 7.0%, $2,400 flat
insurance). Three descriptions of one model, none of them agreeing.

So the methods paper prints what this reads out of the source, and
test/paper-methods-fresh.test.js fails when the source moves.

Every constant here is parsed from the file that DEFINES it. Where a value
cannot be parsed it is null with the reason — a methods paper that silently
substitutes a plausible default for an unreadable constant is worse than one
that admits it could not read it.

  node scripts/paper/extract-model-parameters.mjs            # write JSON
  node scripts/paper/extract-model-parameters.mjs --stdout

## Symbols

### `constant(src, name, { file })`

Pull `NAME = <number>` out of Python or JS source.

Deliberately anchored to an assignment rather than matching the number
anywhere in the file: several of these constants also appear inside comments
explaining why they were changed, and a comment is not what executes.

### `dictOfNumbers(src, name, { file })`

Pull a whole `NAME = { "k": v, ... }` dict out of Python source.

### `sumsToOne(dict)`

A set of weights that is claimed to partition 1.0 must actually do so.
