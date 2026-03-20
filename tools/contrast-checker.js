#!/usr/bin/env node
/**
 * tools/contrast-checker.js
 * WCAG AA contrast checker for COHO Analytics CSS custom properties.
 *
 * Parses css/site-theme.css, resolves light-mode and dark-mode color tokens,
 * then tests every text/background pair listed in .contrast-check-config.json
 * against the WCAG 2.1 AA thresholds:
 *   - Normal text : 4.5:1
 *   - Large text  : 3.0:1 (≥ 18 pt / 24 px, or ≥ 14 pt / 18.67 px bold)
 *
 * Usage:
 *   node tools/contrast-checker.js [--config <path>] [--css <path>] [--json] [--dark]
 *
 * Exit codes:
 *   0  All pairs pass
 *   1  One or more pairs fail
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args       = process.argv.slice(2);
const JSON_OUT   = args.includes('--json');
const DARK_MODE  = args.includes('--dark');

const configIdx = args.indexOf('--config');
const cssIdx    = args.indexOf('--css');

const REPO_ROOT   = path.resolve(__dirname, '..');
const CONFIG_PATH = configIdx >= 0
  ? path.resolve(args[configIdx + 1])
  : path.join(REPO_ROOT, '.contrast-check-config.json');
const CSS_PATH    = cssIdx >= 0
  ? path.resolve(args[cssIdx + 1])
  : path.join(REPO_ROOT, 'css', 'site-theme.css');

// ---------------------------------------------------------------------------
// Color math helpers (WCAG 2.1 §1.4.3)
// ---------------------------------------------------------------------------

/**
 * Parse a CSS hex color (#rgb, #rrggbb, #rrggbbaa) → { r, g, b, a } 0-255.
 * Returns null for non-hex values.
 */
function parseHex(hex) {
  const h = hex.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) {
    const [r, g, b, a = 'f'] = h.split('').map(c => c + c);
    return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16), a: parseInt(a, 16) / 255 };
  }
  if (h.length === 6 || h.length === 8) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}

/**
 * Parse rgba(r, g, b, a) or rgb(r, g, b) → { r, g, b, a }.
 * Returns null for non-rgba values.
 */
function parseRgba(str) {
  const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
}

/** Convert sRGB 0–255 component to linear light value. */
function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Relative luminance of an { r, g, b } (0–255) object per WCAG. */
function luminance({ r, g, b }) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio of two luminance values. */
function contrastRatio(l1, l2) {
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Blend a foreground color with alpha over a white background.
 * Returns an opaque { r, g, b }.
 */
function blendOnWhite({ r, g, b, a = 1 }) {
  return {
    r: Math.round(a * r + (1 - a) * 255),
    g: Math.round(a * g + (1 - a) * 255),
    b: Math.round(a * b + (1 - a) * 255),
  };
}

/** Parse any supported color string → { r, g, b } or null. */
function parseColor(str) {
  if (!str) return null;
  const trimmed = str.trim();
  const hex = parseHex(trimmed);
  if (hex) return blendOnWhite(hex);
  const rgba = parseRgba(trimmed);
  if (rgba) return blendOnWhite(rgba);
  return null;
}

// ---------------------------------------------------------------------------
// CSS token extraction
// ---------------------------------------------------------------------------

/**
 * Extract CSS custom properties from a block of CSS text.
 * Returns a Map<string, string> of property → value.
 * Only handles simple (non-nested) var() references one level deep.
 */
function extractTokens(cssText) {
  const map = new Map();
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;}{]+);/g;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    map.set('--' + m[1], m[2].trim());
  }
  return map;
}

/**
 * Resolve a token value that may contain var() references.
 * Returns a string color value or null.
 */
function resolveToken(value, tokens, depth = 0) {
  if (depth > 5) return null;
  if (!value) return null;
  const varMatch = value.match(/^var\(([^,)]+)(?:,([^)]+))?\)$/);
  if (varMatch) {
    const refKey  = varMatch[1].trim();
    const fallback = varMatch[2] ? varMatch[2].trim() : null;
    const refVal  = tokens.get(refKey);
    if (refVal) return resolveToken(refVal, tokens, depth + 1);
    if (fallback) return resolveToken(fallback, tokens, depth + 1);
    return null;
  }
  return value;
}

/**
 * Parse site-theme.css and return two token maps:
 *   light → tokens in :root (+ html.light-mode override)
 *   dark  → tokens in @media prefers-color-scheme:dark (+ html.dark-mode)
 */
function loadTokenMaps(cssText) {
  // Flatten to a single merged pass for light mode (:root + html.light-mode)
  // and a second pass for dark.

  // Step 1: collect :root block
  const rootMatch = cssText.match(/:root\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/);
  const lightBase = rootMatch ? extractTokens(rootMatch[1]) : new Map();

  // Step 2: collect @media prefers-color-scheme: dark block (first occurrence)
  const darkMediaMatch = cssText.match(
    /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{([\s\S]*?)^\}/m
  );
  const darkBase = darkMediaMatch ? extractTokens(darkMediaMatch[1]) : new Map();

  // Step 3: html.light-mode override
  const lightModeMatch = cssText.match(/html\.light-mode\s*\{([^}]*)\}/);
  const lightOverride  = lightModeMatch ? extractTokens(lightModeMatch[1]) : new Map();

  // Step 4: html.dark-mode override
  const darkModeMatch = cssText.match(/html\.dark-mode\s*\{([\s\S]*?)\}/);
  const darkOverride  = darkModeMatch ? extractTokens(darkModeMatch[1]) : new Map();

  // Merge: dark overrides extend the light base, then dark-specific override
  const lightMap = new Map([...lightBase, ...lightOverride]);
  const darkMap  = new Map([...lightBase, ...darkBase, ...darkOverride]);

  return { lightMap, darkMap };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // Load config
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Config file not found: ${CONFIG_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(CSS_PATH)) {
    console.error(`CSS file not found: ${CSS_PATH}`);
    process.exit(1);
  }

  const config  = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const cssText = fs.readFileSync(CSS_PATH, 'utf8');

  const { lightMap, darkMap } = loadTokenMaps(cssText);
  const tokens = DARK_MODE ? darkMap : lightMap;
  const modeName = DARK_MODE ? 'dark' : 'light';

  const results = [];
  let anyFail = false;

  for (const pair of config.pairs) {
    // pair.fg / pair.bg are token names like "--muted"; look them up first.
    const fgRaw = resolveToken(tokens.get(pair.fg) || pair.fg, tokens);
    const bgRaw = resolveToken(tokens.get(pair.bg) || pair.bg, tokens);

    const fgColor = parseColor(fgRaw);
    const bgColor = parseColor(bgRaw);

    if (!fgColor || !bgColor) {
      results.push({
        label:    pair.label,
        fg:       pair.fg,
        bg:       pair.bg,
        fgRaw,
        bgRaw,
        ratio:    null,
        required: pair.large ? config.thresholds.large : config.thresholds.normal,
        large:    pair.large || false,
        pass:     false,
        error:    'Could not resolve color(s)',
      });
      anyFail = true;
      continue;
    }

    const lFg    = luminance(fgColor);
    const lBg    = luminance(bgColor);
    const ratio  = contrastRatio(lFg, lBg);
    const needed = pair.large ? config.thresholds.large : config.thresholds.normal;
    const pass   = ratio >= needed;

    if (!pass) anyFail = true;

    results.push({
      label:    pair.label,
      fg:       pair.fg,
      bg:       pair.bg,
      fgRaw,
      bgRaw,
      ratio:    Math.round(ratio * 100) / 100,
      required: needed,
      large:    pair.large || false,
      pass,
    });
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ mode: modeName, results }, null, 2));
  } else {
    console.log(`\nWCAG AA Contrast Check — ${modeName} mode`);
    console.log('═'.repeat(60));
    for (const r of results) {
      const icon  = r.pass ? '✅' : '❌';
      const ratio = r.ratio !== null ? `${r.ratio}:1` : 'N/A';
      console.log(`${icon} ${r.label}`);
      console.log(`   fg=${r.fg} (${r.fgRaw || 'unresolved'})  bg=${r.bg} (${r.bgRaw || 'unresolved'})`);
      console.log(`   Ratio ${ratio}  Required ${r.required}:1${r.large ? ' (large text)' : ''}`);
      if (r.error) console.log(`   ⚠ ${r.error}`);
    }
    console.log('─'.repeat(60));
    const passed = results.filter(r => r.pass).length;
    console.log(`Result: ${passed}/${results.length} pairs pass WCAG AA in ${modeName} mode\n`);
  }

  process.exit(anyFail ? 1 : 0);
}

main();
