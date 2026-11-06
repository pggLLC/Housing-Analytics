# `scripts/sync-glossary.mjs`

One glossary: data/glossary.json holds every term's definitions, and the
other places that show a definition are written from it.

  - `definition`: the header glossary pop-up (js/glossary.js reads the JSON).
  - `short`: the inline tooltip (the TERMS list in
    js/components/inline-glossary.js, written here so the tooltips need no
    fetch) and the one-line summary of any info callout
    (data/core/educational-content.json entry with a `glossary` key). The
    callouts keep their own notes for elected officials, developers and
    lenders; only the summary comes from here.
  - `inline_key`: the tooltip's key when it differs from `term`.
  - `autolink: false`: listed in the pop-up and used for tooltips, but not
    auto-wrapped on every page by js/glossary.js.

  node scripts/sync-glossary.mjs           # rewrite the copies
  node scripts/sync-glossary.mjs --check   # exit 1 if a copy differs

test/glossary-sync.test.mjs runs the check.

## Symbols

### `termsBlock(glossary)`

The TERMS object literal body, one line per term with a short definition.

### `writeCallouts(text, glossary)`

Each callout entry linked to a glossary term gets that term's short text.
