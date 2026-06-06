#!/usr/bin/env node
/**
 * F122 + F127 — accent-contrast check
 *
 * Forbids any rule (CSS class OR inline HTML style OR JS template string)
 * that pairs `background:var(--accent…)` with a text color OTHER than the
 * paired `var(--on-accent…)` token. The dark-mode `--accent` is bright cyan
 * #0fd4cf, and white/#fff/card text on it scores 1.7:1 — a hard WCAG fail.
 * F127 expanded the gate to also catch the CSS-class variant where
 * `color: var(--card)` is used (which works in light mode but breaks dark
 * mode because dark `--card` is similar to dark `--accent`).
 *
 * Static gates this complements:
 *   - test:pill-contrast (predefined badge classes, light + dark)
 *   - test:inline-heading-typography (h1-h4 inline overrides)
 *   - js/contrast-guard.js (runtime safety net, theme-aware)
 *
 * Pattern (any of these in same style attr / CSS rule body / JS string):
 *   background: var(--accent[…])
 *   color:      #fff | #ffffff | white | rgb(255,255,255)
 *               | var(--card[…]) | var(--text[…]) | var(--text-strong[…])
 *
 * Acceptable colors on var(--accent) background:
 *   var(--on-accent[, fallback])  ← THE canonical paired token
 *   var(--bg) or var(--bg2)       ← (rare; explicit dark background)
 *   var(--text-d) | var(--text-l) ← (contrast-guard-style explicit pairs)
 *
 * Fix: replace bad color with `color: var(--on-accent, #fff)` (CSS / inline)
 * or `color: var(--on-accent, #fff) !important` (CSS classes overriding the
 * global `a` link color via !important).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const failures = [];

// Forbidden color values when paired with var(--accent) background
const BAD_COLORS = [
  /color\s*:\s*#fff\b/i,
  /color\s*:\s*#ffffff\b/i,
  /color\s*:\s*white\b/i,
  /color\s*:\s*rgb\(\s*255\s*,\s*255\s*,\s*255/i,
  /color\s*:\s*var\(\s*--card\b/i,
  /color\s*:\s*var\(\s*--text(?!-d|-l)\b/i,
];

function isPaired(block) {
  // The block has both a DOMINANT accent background AND a forbidden color.
  // Dominant means: direct `var(--accent)` (with optional fallback) — NOT
  // `var(--accent-dim)`, NOT `var(--accent2)`, NOT color-mix() where accent
  // is <50% of the mix (those resolve close to the other input). The bare
  // `--accent` is the only case where the dark-mode bright cyan dominates.
  //
  // The negative lookahead `(?!-dim|-2|2)` rejects --accent-dim / --accent2.
  const dominantAccentBg = /background\s*[-a-z]*\s*:\s*[^;{}]*\bvar\(\s*--accent(?!-dim|-2|2)\b[^)]*\)/i;
  if (!dominantAccentBg.test(block)) return null;

  // Even when --accent appears, it might be inside a color-mix() with a
  // smaller percentage. If we see `var(--accent) N%` with N < 50 anywhere
  // in the block, the accent is the minority color and the visible
  // background is mostly the OTHER input (typically --card). The previous
  // regex used `color-mix\([^)]*\bvar\(--accent...` which can't cross
  // nested parens — for `color-mix(in oklab, var(--card) 50%, var(--accent)
  // 50%)` the `[^)]*` stopped at the first `)` from var(--card). Now we
  // just look anywhere in the block for the accent's own percentage.
  const accentPct = block.match(/var\(\s*--accent\b[^)]*\)\s*(\d+)\s*%/i);
  if (accentPct && parseInt(accentPct[1], 10) <= 50) return null;

  // Exception: if color uses --on-accent explicitly, that's the canonical fix.
  if (/color\s*:\s*var\(\s*--on-accent\b/i.test(block)) return null;

  for (const re of BAD_COLORS) {
    const m = block.match(re);
    if (m) return m[0];
  }
  return null;
}

function scanLine(file, lineNum, line) {
  // Quick path — needs both bg + a forbidden color on the same line
  if (line.includes('var(--accent') && BAD_COLORS.some(r => r.test(line))) {
    const offending = isPaired(line);
    if (offending) failures.push({ file, line: lineNum, sample: line.trim().slice(0, 180) });
  }
}

function scanFile(absPath) {
  const file = absPath.replace(ROOT + '/', '');
  const src = readFileSync(absPath, 'utf8');
  const ext = extname(absPath).toLowerCase();

  if (ext === '.html') {
    // Match inline style="..." attributes
    const STYLE_ATTR = /style\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = STYLE_ATTR.exec(src)) !== null) {
      const style = m[2] || m[3] || '';
      if (isPaired(style)) {
        const upto = src.slice(0, m.index).split('\n');
        failures.push({ file, line: upto.length, sample: 'inline: ' + style.slice(0, 160) });
      }
    }
    // Match CSS rule bodies in <style>...</style> blocks
    const STYLE_BLOCKS = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let sb;
    while ((sb = STYLE_BLOCKS.exec(src)) !== null) {
      const css = sb[1];
      const offset = sb.index;
      const RULE = /\{([^{}]*)\}/g;
      let r;
      while ((r = RULE.exec(css)) !== null) {
        if (isPaired(r[1])) {
          const upto = src.slice(0, offset + r.index).split('\n');
          failures.push({ file, line: upto.length, sample: 'css rule: ' + r[1].trim().replace(/\s+/g, ' ').slice(0, 160) });
        }
      }
    }
  } else if (ext === '.css') {
    const RULE = /\{([^{}]*)\}/g;
    let r;
    while ((r = RULE.exec(src)) !== null) {
      if (isPaired(r[1])) {
        const upto = src.slice(0, r.index).split('\n');
        failures.push({ file, line: upto.length, sample: 'css rule: ' + r[1].trim().replace(/\s+/g, ' ').slice(0, 160) });
      }
    }
  } else if (ext === '.js') {
    // Look for any template/string containing both signals — this catches
    // dynamically-generated button HTML like the OF detail panel.
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) scanLine(file, i + 1, lines[i]);
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Only recurse into a small allow-list of source dirs
      if (dir === ROOT) {
        if (['css', 'js'].includes(entry)) walk(full);
      } else {
        walk(full);
      }
    } else if (['.html', '.css', '.js'].includes(extname(entry).toLowerCase())) {
      // Skip third-party / vendored / minified JS
      if (entry.endsWith('.min.js')) continue;
      if (full.includes('/vendor/') || full.includes('/node_modules/')) continue;
      scanFile(full);
    }
  }
}

walk(ROOT);

if (!failures.length) {
  console.log('✓ No accent-contrast anti-patterns. Buttons readable in both light + dark mode.');
  process.exit(0);
}

console.error(`✗ Found ${failures.length} accent-contrast violation(s). White/card/text color on var(--accent) background = 1.7:1 in dark mode (WCAG fails 4.5:1):\n`);
for (const f of failures) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    ${f.sample}`);
}
console.error('\nFix: replace the color with `var(--on-accent, #fff)` (and add `!important` if the rule must beat the global `a { color: var(--link) !important }` rule).');
console.error('See css/site-theme.css for the --on-accent token definition.');
process.exit(1);
