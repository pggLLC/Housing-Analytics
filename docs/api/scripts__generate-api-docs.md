# `scripts/generate-api-docs.mjs`

## Symbols

### `walk(dir, exts, out = [])`

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
/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const OUT_DIR   = path.join(ROOT, 'docs', 'api');

const SCAN_ROOTS = [
  { dir: 'js',      exts: ['.js']        },
  { dir: 'scripts', exts: ['.mjs', '.js'] },
];
const SKIP_PATTERNS = [
  /\.min\.js$/i,
  /\/vendor\//i,
  /\/node_modules\//i,
  /\/\.git\//i,
  /-placeholder\.\w+$/i,
  /\.template$/i,
];

function parseArgs() {
  const args = process.argv.slice(2);
  return { quiet: args.includes('--quiet') };
}

/** Walk a directory collecting files that match the allowed extensions.

### `extract(source, relPath)`

Extract JSDoc-commented symbols from one source file.
Returns { header, symbols: [{ name, kind, jsdoc, signature }] }.

### `cleanCommentBody(body)`

... */ block in the file, before any
  // non-comment, non-strict-pragma code.
  const headerMatch = source.match(/^\s*(?:\/\/[^\n]*\n|\s)*\/\*\*([\s\S]*?)\*\//);
  const header      = headerMatch ? cleanCommentBody(headerMatch[1]) : null;
  const afterHeader = headerMatch ? source.slice(headerMatch.index + headerMatch[0].length) : source;

  // Per-symbol JSDoc: a /** ... */ block directly preceding one of:
  //   function name(
  //   async function name(
  //   const|let|var name =
  //   class name
  // Scan from after the file header so the header doesn't get captured
  // as the first symbol's JSDoc. We require ≤4 whitespace/indent chars
  // between the closing */ and the declaration keyword so distant
  // floating JSDocs aren't mis-attributed to later code.
  const symbolRx = /\/\*\*([\s\S]*?)\*\/\s{0,4}(?:export\s+)?(async\s+)?(function|const|let|var|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  const symbols  = [];
  let m;
  while ((m = symbolRx.exec(afterHeader)) !== null) {
    const body      = cleanCommentBody(m[1]);
    const kind      = m[3];
    const name      = m[4];
    // Find the declaration position in the original source for signature capture
    const declPos   = (headerMatch ? headerMatch.index + headerMatch[0].length : 0)
                      + m.index + m[0].length - name.length;
    const signature = extractSignature(source, declPos);
    symbols.push({ name, kind, jsdoc: body, signature });
  }

  return { header, symbols };
}

/** Remove leading " * " from a JSDoc block body.

### `extractSignature(source, startIdx)`

Try to capture the parameter list for a function declaration.

### `firstSentence(text)`

Take the first meaningful sentence from a JSDoc header for the summary line.
