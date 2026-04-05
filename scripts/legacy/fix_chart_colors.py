#!/usr/bin/env python3
"""Fix 1: Replace 4 WCAG-failing chart colors with AA-compliant palette tokens.

Root cause: cra-expansion-analysis.html and dashboard.html (and
            construction-commodities.html) use hardcoded hex values for Chart.js
            datasets that fail WCAG AA 4.5:1 contrast against the white chart area.
Impact:     Charts are unreadable for users with color blindness or low vision.
Solution:   Replace five failing colors with a WCAG-AA compliant four-color
            palette, and add CSS chart-color tokens to site-theme.css so
            dark-mode overrides can adapt the values at runtime.

Color mapping (old → new):
  #6c7a89  (slate grey, 3.94:1)  → #1e5799  (dark navy,    8.59:1)
  #3498db  (sky blue,  3.54:1)   → #0369a1  (ocean blue,   5.74:1)
  #27ae60  (mid green, 4.55:1*)  → #0a7e74  (teal,         4.94:1)
  #d4a574  (tan gold,  2.75:1)   → #7c3d00  (dark amber,   6.58:1)
  #e4b584  (light tan, 2.42:1)   → #7c3d00  (dark amber,   6.58:1)
  #2ecc71  (bright green 2.33:1) → #166534  (forest green, 7.23:1)
  #f39c12  (amber,     2.93:1)   → #92400e  (burnt orange, 5.41:1)
  #c0392b  (mid red,   4.12:1)   → #991b1b  (dark red,     6.51:1)

Usage:
    python3 scripts/fix_chart_colors.py
"""

import os
import re

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# ---------------------------------------------------------------------------
# Color map: failing hex → WCAG-AA compliant hex
# ---------------------------------------------------------------------------
COLOR_MAP = {
    '#6c7a89': '#1e5799',
    '#3498db': '#0369a1',
    '#27ae60': '#0a7e74',
    '#d4a574': '#7c3d00',
    '#e4b584': '#7c3d00',
    '#2ecc71': '#166534',
    '#f39c12': '#92400e',
    '#c0392b': '#991b1b',
}

# Matching is case-insensitive; also replace rgba() wrappers for the same hues.
RGBA_MAP = {
    # old rgba base hex: (old_a, new_base_hex) pairs to rewrite
    '108, 122, 137': ('1e5799', '30, 87, 153'),
    '52, 152, 219':  ('0369a1', '3, 105, 161'),
    '39, 174, 96':   ('0a7e74', '10, 126, 116'),
    '212, 165, 116': ('7c3d00', '124, 61, 0'),
    '228, 181, 132': ('7c3d00', '124, 61, 0'),
}

# HTML files that contain failing chart colors
TARGET_HTML = [
    'cra-expansion-analysis.html',
    'dashboard.html',
    'construction-commodities.html',
]

# CSS token block to inject into site-theme.css (within :root {})
CSS_TOKEN_COMMENT = '  /* Chart color tokens — WCAG AA ≥ 4.5:1 on white */'
CSS_TOKENS = """\
  /* Chart color tokens — WCAG AA ≥ 4.5:1 on white */
  --chart-1: #1e5799;
  --chart-2: #0369a1;
  --chart-3: #0a7e74;
  --chart-4: #7c3d00;
  --chart-5: #166534;
  --chart-6: #92400e;
  --chart-7: #991b1b;"""

DARK_CSS_TOKENS = """\
  /* Chart color tokens — dark mode (lighter on dark bg) */
  --chart-1: #5b9bd5;
  --chart-2: #38bdf8;
  --chart-3: #0fd4cf;
  --chart-4: #fbbf24;
  --chart-5: #4ade80;
  --chart-6: #fb923c;
  --chart-7: #f87171;"""

SITE_THEME = os.path.join(REPO_ROOT, 'css', 'site-theme.css')


def _replace_colors_in_text(text: str) -> str:
    """Apply hex and rgba replacements (case-insensitive) to *text*."""
    for old_hex, new_hex in COLOR_MAP.items():
        # Match quoted or unquoted hex values
        pattern = re.compile(re.escape(old_hex), re.IGNORECASE)
        text = pattern.sub(new_hex, text)

    for old_rgb, (new_hex_unused, new_rgb) in RGBA_MAP.items():
        old_pattern = re.compile(
            r'rgba\(\s*' + re.escape(old_rgb) + r'\s*,\s*([0-9.]+)\s*\)',
            re.IGNORECASE,
        )
        text = old_pattern.sub(lambda m: f'rgba({new_rgb}, {m.group(1)})', text)

    return text


def fix_html_files() -> int:
    """Replace failing colors in HTML chart configurations."""
    changed = 0
    for filename in TARGET_HTML:
        path = os.path.join(REPO_ROOT, filename)
        if not os.path.exists(path):
            print(f'  ⚠  {filename} not found, skipping')
            continue

        with open(path, encoding='utf-8') as f:
            original = f.read()

        updated = _replace_colors_in_text(original)

        if updated == original:
            print(f'  ✓  {filename} — no changes needed')
        else:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(updated)
            print(f'  ✅  {filename} — chart colors updated')
            changed += 1

    return changed


def fix_css_tokens() -> int:
    """Inject chart-color tokens into site-theme.css :root and dark-mode blocks."""
    if not os.path.exists(SITE_THEME):
        print(f'  ⚠  {SITE_THEME} not found, skipping CSS tokens')
        return 0

    with open(SITE_THEME, encoding='utf-8') as f:
        css = f.read()

    changed = 0

    # Inject into :root block if tokens not already present
    if '--chart-1' not in css:
        # Insert just before the closing brace of the first :root block
        # Find the end of the :root { … } block
        root_match = re.search(
            r'(:root\s*\{[^}]*?)(--legacy-alias[^}]*?}|--map-boundary[^}]*?}|\})',
            css,
            re.DOTALL,
        )
        if root_match:
            insert_pos = css.index('\n}', root_match.start())
            css = css[:insert_pos] + '\n' + CSS_TOKENS + css[insert_pos:]
            print('  ✅  site-theme.css — chart color tokens added to :root')
            changed += 1
        else:
            # Simpler fallback: find first closing brace after :root {
            root_start = css.find(':root {')
            if root_start != -1:
                close_pos = css.index('\n}', root_start)
                css = css[:close_pos] + '\n' + CSS_TOKENS + css[close_pos:]
                print('  ✅  site-theme.css — chart color tokens added (fallback)')
                changed += 1

    # Inject dark-mode chart tokens if not already present
    dark_marker = '@media (prefers-color-scheme: dark)'
    if DARK_CSS_TOKENS.split('\n')[1].strip() not in css and dark_marker in css:
        dark_pos = css.index(dark_marker)
        # Find the opening brace of the dark-mode rule
        brace_pos = css.index('{', dark_pos)
        # Find first :root { inside dark-mode block
        root_in_dark = css.find(':root {', brace_pos)
        if root_in_dark != -1:
            close_in_dark = css.index('\n  }', root_in_dark)
            css = css[:close_in_dark] + '\n' + DARK_CSS_TOKENS + css[close_in_dark:]
            print('  ✅  site-theme.css — dark-mode chart color tokens added')
            changed += 1

    if changed:
        with open(SITE_THEME, 'w', encoding='utf-8') as f:
            f.write(css)

    return changed


def fix_chart_colors() -> None:
    """Entry point: apply all chart color fixes."""
    print('Fix 1: Chart color palette — WCAG AA compliance')
    print('=' * 56)

    html_changes = fix_html_files()
    css_changes = fix_css_tokens()

    total = html_changes + css_changes
    print()
    if total:
        print(f'✅  Fix 1 complete — {total} file(s) updated.')
    else:
        print('✓  Fix 1 complete — all files already compliant.')


if __name__ == '__main__':
    fix_chart_colors()
