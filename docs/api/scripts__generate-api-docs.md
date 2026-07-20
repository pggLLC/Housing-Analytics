# `scripts/generate-api-docs.mjs`

scripts/generate-api-docs.mjs — auto-generate docs/api/ from JSDoc.

Partial closeout of #652 (auto-generate API reference for js/ and scripts/).

Design trade-off:
  - Rather than pulling in jsdoc-to-markdown (200KB+ of deps), this
    script regex-parses the subset of JSDoc we actually use across
    this repo: file-header comments, function-leading JSDoc blocks,
    @param / @returns / @typedef / @property tags.
  - Output is deterministic and grep-friendly. A full JSDoc AST
    parser would catch edge cases our codebase doesn't have — and
    would add a large devDep for a docs-only feature.

What it does:
  1. Scans js/**\/*.js and scripts/**\/*.mjs (skip vendor/, .min.js).
  2. For each file, extracts:
       - file-header comment block (the first /** ... *\/ above code)
       - each function/const declaration with a preceding JSDoc block
  3. Skips files with zero JSDoc comments — no point producing an
     empty "documentation" page.
  4. Writes one .md per documented module into docs/api/.
  5. Writes docs/api/README.md as the index, grouped by directory.

Usage:
  npm run docs:api
  node scripts/generate-api-docs.mjs --quiet

## Symbols

### `walk(dir, exts, out = [])`

Walk a directory collecting files that match the allowed extensions.

### `extract(source, relPath)`

Extract JSDoc-commented symbols from one source file.
Returns { header, symbols: [{ name, kind, jsdoc, signature }] }.

### `cleanCommentBody(body)`

Remove leading " * " from a JSDoc block body.

### `extractSignature(source, startIdx)`

Try to capture the parameter list for a function declaration.

### `firstSentence(text)`

Take the first meaningful sentence from a JSDoc header for the summary line.
