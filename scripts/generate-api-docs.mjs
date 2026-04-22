#!/usr/bin/env node
/**
 * scripts/generate-api-docs.mjs — auto-generate docs/api/ from JSDoc.
 *
 * Partial closeout of #652 (auto-generate API reference for js/ and scripts/).
 *
 * Design trade-off:
 *   - Rather than pulling in jsdoc-to-markdown (200KB+ of deps), this
 *     script regex-parses the subset of JSDoc we actually use across
 *     this repo: file-header comments, function-leading JSDoc blocks,
 *     @param / @returns / @typedef / @property tags.
 *   - Output is deterministic and grep-friendly. A full JSDoc AST
 *     parser would catch edge cases our codebase doesn't have — and
 *     would add a large devDep for a docs-only feature.
 *
 * What it does:
 *   1. Scans js/**\/*.js and scripts/**\/*.mjs (skip vendor/, .min.js).
 *   2. For each file, extracts:
 *        - file-header comment block (the first /** ... *\/ above code)
 *        - each function/const declaration with a preceding JSDoc block
 *   3. Skips files with zero JSDoc comments — no point producing an
 *      empty "documentation" page.
 *   4. Writes one .md per documented module into docs/api/.
 *   5. Writes docs/api/README.md as the index, grouped by directory.
 *
 * Usage:
 *   npm run docs:api
 *   node scripts/generate-api-docs.mjs --quiet
 */

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

/** Walk a directory collecting files that match the allowed extensions. */
async function walk(dir, exts, out = []) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel  = path.relative(ROOT, full);
    if (SKIP_PATTERNS.some(rx => rx.test(rel))) continue;
    if (e.isDirectory()) { await walk(full, exts, out); continue; }
    if (exts.includes(path.extname(e.name))) out.push(full);
  }
  return out;
}

/**
 * Extract JSDoc-commented symbols from one source file.
 * Returns { header, symbols: [{ name, kind, jsdoc, signature }] }.
 */
function extract(source, relPath) {
  // File-header comment: first /** ... */ block in the file, before any
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

/** Remove leading " * " from a JSDoc block body. */
function cleanCommentBody(body) {
  return body
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*\*\s?/, ''))
    .join('\n')
    .trim();
}

/** Try to capture the parameter list for a function declaration. */
function extractSignature(source, startIdx) {
  const rest = source.slice(startIdx, startIdx + 300);
  const m = rest.match(/^[A-Za-z_$][A-Za-z0-9_$]*\s*\(([^)]*)\)/);
  if (!m) return null;
  return '(' + m[1].replace(/\s+/g, ' ').trim() + ')';
}

/** Take the first meaningful sentence from a JSDoc header for the summary line. */
function firstSentence(text) {
  if (!text) return '';
  const cleaned = text.replace(/@\w+[\s\S]*$/, '').trim();
  const m = cleaned.match(/^(.+?[.\n])/);
  return (m ? m[1] : cleaned).trim();
}

function mdEscape(s) { return String(s).replace(/\|/g, '\\|'); }

function renderModuleMd(relPath, extracted) {
  const lines = [];
  lines.push(`# \`${relPath}\``);
  lines.push('');
  if (extracted.header) {
    lines.push(extracted.header);
    lines.push('');
  }
  if (extracted.symbols.length === 0) {
    lines.push('_No documented symbols — module has a file-header comment only._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('## Symbols');
  lines.push('');
  for (const sym of extracted.symbols) {
    const sig = sym.signature ? `\`${sym.name}${sym.signature}\`` : `\`${sym.name}\``;
    lines.push(`### ${sig}`);
    lines.push('');
    if (sym.jsdoc) {
      lines.push(sym.jsdoc);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function renderIndex(modulesByDir) {
  const lines = [];
  lines.push('# API reference');
  lines.push('');
  lines.push(`_Auto-generated from JSDoc — ${new Date().toISOString().slice(0, 10)}. Regenerated weekly by \`.github/workflows/docs-sync.yml\` and on every \`npm run docs:api\`._`);
  lines.push('');
  lines.push('Only modules with at least one JSDoc-commented symbol are indexed. To get a module on this page, add a `/** ... */` comment on any exported function, constant, or class.');
  lines.push('');

  const dirs = Object.keys(modulesByDir).sort();
  for (const dir of dirs) {
    lines.push(`## \`${dir}/\``);
    lines.push('');
    lines.push('| Module | Summary | Symbols |');
    lines.push('|---|---|---:|');
    const mods = modulesByDir[dir].sort((a, b) => a.rel.localeCompare(b.rel));
    for (const m of mods) {
      const summary = mdEscape(firstSentence(m.extracted.header) || '_no header_');
      const link    = path.basename(m.outFile);
      lines.push(`| [\`${path.basename(m.rel)}\`](./${link}) | ${summary} | ${m.extracted.symbols.length} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const { quiet } = parseArgs();

  // Gather files
  const files = [];
  for (const { dir, exts } of SCAN_ROOTS) {
    files.push(...await walk(path.join(ROOT, dir), exts));
  }

  if (!quiet) console.log(`[docs:api] scanning ${files.length} source file(s)`);

  // Clean existing docs/api/ so deleted modules don't leave stale pages.
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const modules = [];
  for (const full of files) {
    const rel     = path.relative(ROOT, full);
    const source  = await fs.readFile(full, 'utf8');
    const extracted = extract(source, rel);
    const hasDocs = !!extracted.header || extracted.symbols.length > 0;
    if (!hasDocs) continue;
    // Emit one md per module; flatten the directory into the filename so
    // docs/api/ stays flat and easy to link to.
    const outName = rel.replace(/\//g, '__').replace(/\.(js|mjs)$/, '.md');
    const outFile = path.join(OUT_DIR, outName);
    await fs.writeFile(outFile, renderModuleMd(rel, extracted));
    modules.push({ rel, outFile, extracted });
  }

  // Group by the file's PARENT directory, not a naive 2-segment slice
  // (a 2-segment slice treats top-level `js/foo.js` as its own group).
  const byDir = {};
  for (const m of modules) {
    const parent = path.dirname(m.rel);
    (byDir[parent] ||= []).push(m);
  }

  await fs.writeFile(path.join(OUT_DIR, 'README.md'), renderIndex(byDir));

  if (!quiet) {
    const total = modules.length;
    const totalSymbols = modules.reduce((s, m) => s + m.extracted.symbols.length, 0);
    console.log(`[docs:api] wrote ${total} module page(s) + index`);
    console.log(`[docs:api] total documented symbols: ${totalSymbols}`);
    console.log(`[docs:api] output: ${path.relative(ROOT, OUT_DIR)}`);
  }
}

main().catch(err => {
  console.error('generate-api-docs crashed:', err);
  process.exit(1);
});
