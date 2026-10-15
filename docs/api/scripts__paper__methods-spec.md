# `scripts/paper/methods-spec.mjs`

Keep the prose of methods.html tied to the code it specifies.

methods.html already cannot misquote a constant: every weight and threshold
it prints is read out of source by extract-model-parameters.mjs, and CI
fails when one moves. What that does not catch is a change of SHAPE. On
2026-09-17 (#1733) gap pressure became the larger of a resident reading and
a new workforce reading, and two days later (#1771) the 20-year figure took
the same maximum. Every weight stayed where it was, so nothing failed, and
§06 went on printing a formula with no workforce term while the workforce
reading drove the gap score of 265 of 546 jurisdictions.

So each section of methods.html names the code it describes, and this
records a fingerprint of that code as of the last time someone read the two
side by side. When the code changes, the fingerprint no longer matches and
test/methods-spec-sources.test.mjs fails, naming the section to re-read.
After re-reading it (and fixing the page if it is now wrong):

  node scripts/paper/methods-spec.mjs --record m-score   # one section
  node scripts/paper/methods-spec.mjs --check            # what the test runs

--record takes a section id, never "all": re-blessing every section at once
is how a review step turns into a rubber stamp.

A fingerprint ignores blank lines and comment-only lines, so rewording a
comment does not demand a review. Anything that executes does.

Code is named by function (`def name` in Python, `function name` in JS) or,
where the relevant logic sits inside a long function, by a region between
`methods-spec:begin <name>` and `methods-spec:end <name>` comments.

## Symbols

### `extract(src, file, { function: fn, region })`

The lines of one function or marked region, or null with a reason.

### `REVIEWED_RE`

The byline date: the OLDEST section review, since that is what holds for every section.

### `evaluate(registry = loadRegistry()`

Every source in the registry with its current fingerprint (or error).
