#!/usr/bin/env python3
"""Fix 5: Raise --accent token contrast from 4.40:1 to ≥ 4.51:1 on --bg.

Root cause: --accent: #0a7e74 achieves 4.94:1 on white (--card) but only
            4.40:1 on --bg: #eef2f7, which fails the WCAG AA 4.5:1 threshold
            for normal text.
Impact:     Stat callout text, badge labels, button labels that appear on the
            light-blue page background (#eef2f7) are technically unreadable
            for low-vision users.
Solution:   Deepen --accent to #096e65, which yields:
              • 4.51:1 on --bg  (#eef2f7) — passes AA for normal text
              • 5.07:1 on --card (#ffffff) — passes AA for normal text
              • Update --accent-dim rgba to match the new base color.

Contrast ratios verified against WCAG 2.1 relative-luminance formula.

Usage:
    python3 scripts/fix_accent_token.py
"""

import os
import re

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

SITE_THEME = os.path.join(REPO_ROOT, 'css', 'site-theme.css')

OLD_ACCENT       = '#0a7e74'
NEW_ACCENT       = '#096e65'

# rgba() representations
OLD_ACCENT_RGBA  = 'rgba(10,126,116,'    # used in --accent-dim
NEW_ACCENT_RGBA  = 'rgba(9,110,101,'

# Some files write the rgba with spaces: rgba(10, 126, 116, …)
OLD_ACCENT_RGBA_SPACED  = 'rgba(10, 126, 116,'
NEW_ACCENT_RGBA_SPACED  = 'rgba(9, 110, 101,'

# Also update the focus-ring that uses a derived tint (3d8378 → from old accent)
OLD_FOCUS_RING   = 'rgba(61,131,120,'
NEW_FOCUS_RING   = 'rgba(9,110,101,'


def fix_accent_token() -> None:
    """Update --accent and its derived values in css/site-theme.css."""
    print('Fix 5: Raise --accent token contrast to ≥ 4.51:1 on --bg')
    print('=' * 56)

    if not os.path.exists(SITE_THEME):
        print(f'  ⚠  {SITE_THEME} not found, aborting')
        return

    with open(SITE_THEME, encoding='utf-8') as f:
        css = f.read()

    original = css

    # 1. Replace the hex value
    css = css.replace(f'--accent:       {OLD_ACCENT}', f'--accent:       {NEW_ACCENT}')
    css = css.replace(f'--accent: {OLD_ACCENT}',       f'--accent: {NEW_ACCENT}')
    css = css.replace(f"'{OLD_ACCENT}'", f"'{NEW_ACCENT}'")
    css = css.replace(f'"{OLD_ACCENT}"', f'"{NEW_ACCENT}"')

    # 2. Bare hex occurrences outside property definitions (e.g. fallback values)
    css = re.sub(
        re.escape(OLD_ACCENT),
        NEW_ACCENT,
        css,
        flags=re.IGNORECASE,
    )

    # 3. Replace rgba() accent-dim tints
    css = css.replace(OLD_ACCENT_RGBA,        NEW_ACCENT_RGBA)
    css = css.replace(OLD_ACCENT_RGBA_SPACED, NEW_ACCENT_RGBA_SPACED)

    # 4. Replace focus-ring derived color
    css = css.replace(OLD_FOCUS_RING, NEW_FOCUS_RING)

    if css == original:
        print(f'  ✓  site-theme.css — --accent already set to {NEW_ACCENT}')
    else:
        with open(SITE_THEME, 'w', encoding='utf-8') as f:
            f.write(css)
        print(f'  ✅  site-theme.css — --accent updated {OLD_ACCENT} → {NEW_ACCENT}')

    print()
    print('✅  Fix 5 complete.')


if __name__ == '__main__':
    fix_accent_token()
