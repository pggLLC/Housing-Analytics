/**
 * test/wcag-pill-contrast.test.js — F181
 * =============================================================
 * Static-analysis WCAG AA contrast check for the highlight-style
 * pill/badge/selection rules in css/site-theme.css.
 *
 * Why this exists: contrast bugs have oscillated between modes
 * for months (F19 → F53 → F76 → F84/85 → F101 → F106 → F115).
 * Each fix solved one mode at a cost of the other because the CI
 * gate only render-tested one mode. This test mathematically
 * asserts every documented pill class hits ≥4.5:1 (WCAG AA for
 * normal text) in *both* the light :root and the .dark-mode
 * token scope.
 *
 * Approach (no headless browser required):
 *   1. Parse css/site-theme.css for token values inside :root and
 *      inside .dark-mode (the only two places that matter — every
 *      other rule resolves via var()).
 *   2. For each pill rule listed in PILLS_TO_CHECK, look up the
 *      backing tokens, composite the rgba(*, alpha) "-dim" bg onto
 *      the body background of that mode, and compute WCAG contrast
 *      against the foreground color.
 *   3. Fail if any combo < 4.5:1.
 *
 * Run:
 *   node test/wcag-pill-contrast.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CSS_PATH = path.join(__dirname, '..', 'css', 'site-theme.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

// ───────────────────────────────────────────────────────────────
// Token extraction
// ───────────────────────────────────────────────────────────────
//
// site-theme.css declares the light-mode tokens twice (once in
// :root for default + once in html:not(.dark-mode) for explicit
// scoping) and the dark-mode tokens twice (once in @media
// prefers-color-scheme: dark + once in html.dark-mode). For the
// purpose of contrast checking we only need ONE source per mode.
// We pick the .dark-mode block (html.dark-mode { ... }) for dark
// and :root { ... } for light because those are the canonical
// definitions that always apply regardless of OS preference.

function extractTokensFromBlock(blockText) {
  const tokens = {};
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(blockText)) !== null) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

function findBlock(selector) {
  // Find a CSS rule that starts with `selector {` (or `selector ,`
  // joined) and capture everything up to the matching closing brace.
  // We use a simple brace counter since site-theme.css doesn't nest.
  const ix = css.indexOf(selector);
  if (ix === -1) throw new Error('Selector not found: ' + selector);
  const braceStart = css.indexOf('{', ix);
  if (braceStart === -1) throw new Error('No `{` after selector: ' + selector);
  let depth = 1;
  let i = braceStart + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    if (depth === 0) return css.slice(braceStart + 1, i);
    i++;
  }
  throw new Error('Unmatched brace for selector: ' + selector);
}

// Match the rule-OPENING selector exactly (with the trailing space-brace)
// so we don't catch e.g. `html.dark-mode body, html.dark-mode html`.
const lightTokens = extractTokensFromBlock(findBlock(':root {'));
const darkTokens  = extractTokensFromBlock(findBlock('html.dark-mode {'));

// ───────────────────────────────────────────────────────────────
// Color math (WCAG relative luminance + contrast ratio)
// ───────────────────────────────────────────────────────────────

function parseColor(s) {
  if (!s) return null;
  s = String(s).trim();

  // #RGB / #RRGGBB
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    const hex = m[1];
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }
  }

  // rgb / rgba
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(s);
  if (m) {
    return {
      r: parseFloat(m[1]),
      g: parseFloat(m[2]),
      b: parseFloat(m[3]),
      a: m[4] != null ? parseFloat(m[4]) : 1,
    };
  }

  // CSS named (just a small set we'd hit)
  const NAMED = { white: '#ffffff', black: '#000000', transparent: 'rgba(0,0,0,0)' };
  if (NAMED[s.toLowerCase()]) return parseColor(NAMED[s.toLowerCase()]);

  return null;
}

function compositeOver(fg, bg) {
  // Composite RGBA fg over RGB bg (per CSS spec, opaque result).
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

function relLum(c) {
  // Per WCAG 2.x: gamma-decode then weighted sum.
  function f(v) {
    v = v / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contrast(fg, bg) {
  // fg should be opaque against bg (composite first if rgba)
  const L1 = relLum(fg);
  const L2 = relLum(bg);
  const a = Math.max(L1, L2) + 0.05;
  const b = Math.min(L1, L2) + 0.05;
  return a / b;
}

// ───────────────────────────────────────────────────────────────
// Pills to check
// ───────────────────────────────────────────────────────────────
//
// Each entry describes one rule + the surface it paints onto.
// The .pill convention is:
//   background: var(--X-dim)   (semi-transparent)
//   color:      var(--X)       (full saturation)
//   parent:     a card / body
// So we composite var(--X-dim) over the body background to get
// the effective opaque bg, then contrast against var(--X) text.

const PILLS = [
  { name: '.pill.accent',           bgVar: 'accent-dim', textVar: 'accent' },
  { name: '.pill.good',             bgVar: 'good-dim',   textVar: 'good' },
  { name: '.pill.warn',             bgVar: 'warn-dim',   textVar: 'warn' },
  { name: '.pill.bad',              bgVar: 'bad-dim',    textVar: 'bad' },
];

// ───────────────────────────────────────────────────────────────
// Run
// ───────────────────────────────────────────────────────────────

function evaluate(mode, tokens) {
  const bodyBgRaw = tokens['card'] || tokens['bg'] || (mode === 'light' ? '#ffffff' : '#0f1620');
  const bodyBg = parseColor(bodyBgRaw);
  if (!bodyBg) throw new Error(`Cannot parse body bg ${bodyBgRaw} for ${mode}`);

  const results = [];
  for (const p of PILLS) {
    const bgRaw   = tokens[p.bgVar];
    const textRaw = tokens[p.textVar];
    if (!bgRaw)   throw new Error(`Missing token --${p.bgVar} in ${mode}`);
    if (!textRaw) throw new Error(`Missing token --${p.textVar} in ${mode}`);
    const bgRgba    = parseColor(bgRaw);
    const text      = parseColor(textRaw);
    if (!bgRgba || !text) throw new Error(`Cannot parse ${p.name} colors in ${mode}: bg=${bgRaw} text=${textRaw}`);
    const bgOpaque  = compositeOver(bgRgba, bodyBg);
    const ratio     = contrast(text, bgOpaque);
    results.push({ pill: p.name, mode, bgRaw, textRaw, ratio: Math.round(ratio * 100) / 100 });
  }
  return results;
}

const AA = 4.5;     // WCAG AA for normal text
const AA_LARGE = 3; // WCAG AA for large/bold text

const all = [
  ...evaluate('light', lightTokens),
  ...evaluate('dark',  darkTokens),
];

let failures = 0;
console.log('\n────────────────────────────────────────────────────────────');
console.log('F181 — WCAG AA contrast assertions for highlight pills');
console.log('────────────────────────────────────────────────────────────');
all.forEach(r => {
  const pass = r.ratio >= AA;
  if (!pass) failures++;
  const marker = pass ? '✓' : '✗';
  console.log(`  ${marker} ${r.pill.padEnd(16)} · ${r.mode.padEnd(5)} · ${String(r.ratio).padStart(5)}:1 · ${r.textRaw} on ${r.bgRaw}`);
});
console.log('────────────────────────────────────────────────────────────');
console.log(`Result: ${all.length - failures} passed, ${failures} failed (AA threshold: ${AA}:1)`);
console.log('────────────────────────────────────────────────────────────\n');

if (failures > 0) {
  process.exit(1);
}
