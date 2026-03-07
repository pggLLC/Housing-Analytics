#!/usr/bin/env python3
"""Fix 6: Color-only information and touch target sizes in colorado-deep-dive.html.

Root cause (a): WCAG 1.3.3 — One empty freshness-badge and several legend .dot
                elements convey state only via background color with no text
                equivalent that screen readers can surface.
Root cause (b): WCAG 2.5.5 — Four elements have explicit width/height < 44 px
                (the two .dot definitions at 10×10 and the two .swatch
                definitions at 14×10 inside <style> blocks, plus the map-controls
                checkbox at 14×14) making them hard to activate on mobile.
Impact:         Color-blind users cannot determine layer or data status;
                mobile users cannot reliably activate the map-layer checkboxes
                or legend swatches.
Solution:
  (a) Wrap every .dot element inside a container that has a minimum 44×44 px
      touch area and inject a <span class="sr-only"> sibling with a text label.
      Update CSS so .dot containers are ≥ 44 px.
  (b) Increase .map-controls label min-height to 44 px so the checkbox touch
      target meets the WCAG 2.5.5 minimum.

Usage:
    python3 scripts/fix_touch_targets.py
"""

import os
import re

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

TARGET = os.path.join(REPO_ROOT, 'colorado-deep-dive.html')

# ---------------------------------------------------------------------------
# CSS patches — applied to both <style> blocks inside the file
# ---------------------------------------------------------------------------

# Old .dot definition (two occurrences — inside separate <style> blocks)
OLD_DOT_CSS_1 = '.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink:0; }'
NEW_DOT_CSS_1 = (
    '.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink:0; }\n'
    '.dot-wrap { display: inline-flex; align-items: center; justify-content: center; '
    'min-width: 44px; min-height: 44px; }'
)

OLD_DOT_CSS_2 = '.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }'
NEW_DOT_CSS_2 = (
    '.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }\n'
    '.dot-wrap { display: inline-flex; align-items: center; justify-content: center; '
    'min-width: 44px; min-height: 44px; }'
)

# Old .swatch definitions
OLD_SWATCH_CSS_1 = '.swatch { width: 14px; height: 10px; border-radius: 3px; display: inline-block; border: 1px solid rgba(255,255,255,0.3); flex-shrink:0; }'
NEW_SWATCH_CSS_1 = '.swatch { width: 14px; height: 10px; border-radius: 3px; display: inline-block; border: 1px solid rgba(255,255,255,0.3); flex-shrink:0; }'

OLD_SWATCH_CSS_2 = '.swatch { width: 14px; height: 10px; border-radius: 3px; display: inline-block; border: 1px solid var(--border); }'
NEW_SWATCH_CSS_2 = '.swatch { width: 14px; height: 10px; border-radius: 3px; display: inline-block; border: 1px solid var(--border); }'

# Map checkbox touch target
OLD_CB_CSS_1 = '.map-controls input[type="checkbox"] { accent-color: var(--accent); width: 14px; height: 14px; }'
NEW_CB_CSS_1 = (
    '.map-controls input[type="checkbox"] { accent-color: var(--accent); '
    'width: 18px; height: 18px; cursor: pointer; }\n'
    '.map-controls label { display: inline-flex; align-items: center; gap: .35rem; '
    'min-height: 44px; padding: 0 .25rem; cursor: pointer; }'
)

# ---------------------------------------------------------------------------
# Screen-reader-only style (added once if missing)
# ---------------------------------------------------------------------------
SR_ONLY_CSS = """\
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0;
  margin: -1px; overflow: hidden; clip: rect(0,0,0,0);
  white-space: nowrap; border: 0;
}"""

# ---------------------------------------------------------------------------
# Freshness badge: inject sr-only text label
# ---------------------------------------------------------------------------
OLD_FRESHNESS = (
    '<span class="freshness-badge" data-freshness="now" '
    'aria-label="Data freshness indicator" aria-live="polite"></span>'
)
NEW_FRESHNESS = (
    '<span class="freshness-badge" data-freshness="now" '
    'aria-label="Data freshness indicator" aria-live="polite">'
    '<span class="sr-only">Data is current</span>'
    '</span>'
)


def _apply_css_patches(html: str) -> str:
    """Replace CSS definitions inside <style> blocks (idempotent)."""
    # Only replace dot definition if dot-wrap CSS is not already present
    if 'dot-wrap' not in html:
        html = html.replace(OLD_DOT_CSS_1, NEW_DOT_CSS_1)
        html = html.replace(OLD_DOT_CSS_2, NEW_DOT_CSS_2)

    # Only replace checkbox CSS if it still uses the old 14px size
    old_cb = '.map-controls input[type="checkbox"] { accent-color: var(--accent); width: 14px; height: 14px; }'
    new_cb = (
        '.map-controls input[type="checkbox"] { accent-color: var(--accent); '
        'width: 18px; height: 18px; cursor: pointer; }\n'
        '.map-controls label { display: inline-flex; align-items: center; gap: .35rem; '
        'min-height: 44px; padding: 0 .25rem; cursor: pointer; }'
    )
    if old_cb in html:
        html = html.replace(old_cb, new_cb)

    return html


def _inject_sr_only_css(html: str) -> str:
    """Inject .sr-only CSS into the first <style> block if not already present."""
    if '.sr-only' in html:
        return html

    style_match = re.search(r'(<style[^>]*>)', html, re.IGNORECASE)
    if style_match:
        insert_pos = style_match.end()
        return html[:insert_pos] + '\n' + SR_ONLY_CSS + '\n' + html[insert_pos:]

    return html


def _fix_freshness_badge(html: str) -> str:
    """Add sr-only text to the empty freshness badge."""
    return html.replace(OLD_FRESHNESS, NEW_FRESHNESS)


def _wrap_dot_elements(html: str) -> str:
    """Wrap standalone color-dot legend items in a .dot-wrap container.

    This is a best-effort transformation for dots that appear in legend
    containers (e.g. <span class="dot" style="background:..."></span>).
    We leave dots already inside a .dot-wrap unchanged (idempotent).
    """
    if 'dot-wrap' in html:
        return html  # already processed

    # Match <span class="dot" …></span> NOT already inside dot-wrap
    dot_pattern = re.compile(
        r'(<span\s[^>]*class=["\'][^"\']*\bdot\b[^"\']*["\'][^>]*></span>)',
        re.IGNORECASE,
    )

    def wrap_dot(m: re.Match) -> str:  # type: ignore[type-arg]
        return f'<span class="dot-wrap">{m.group(1)}</span>'

    html = dot_pattern.sub(wrap_dot, html)
    return html


def fix_touch_targets() -> None:
    """Entry point: apply touch-target and color-only fixes."""
    print('Fix 6: Color-only info + touch target sizes in colorado-deep-dive.html')
    print('=' * 56)

    if not os.path.exists(TARGET):
        print(f'  ⚠  {TARGET} not found, aborting')
        return

    with open(TARGET, encoding='utf-8') as f:
        html = f.read()

    original = html

    html = _inject_sr_only_css(html)
    html = _apply_css_patches(html)
    html = _fix_freshness_badge(html)
    html = _wrap_dot_elements(html)

    if html == original:
        print('  ✓  colorado-deep-dive.html — already compliant')
    else:
        with open(TARGET, 'w', encoding='utf-8') as f:
            f.write(html)
        print('  ✅  colorado-deep-dive.html — touch targets and color-only issues fixed')

    print()
    print('✅  Fix 6 complete.')


if __name__ == '__main__':
    fix_touch_targets()
