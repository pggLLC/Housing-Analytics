#!/usr/bin/env python3
"""Fix 3: Inject aria-live regions for dynamic content on 4 pages.

Root cause: chfa-portfolio.html, compliance-dashboard.html,
            construction-commodities.html, and dashboard.html update
            visible content via JavaScript without announcing changes
            to assistive technologies.
Impact:     Screen reader users get no feedback when filters, date ranges,
            or chart periods change (WCAG 1.3.6 Status Messages).
Solution:   Inject a role="status" aria-live="polite" region into each
            page's body and wire every known dynamic-update code path to
            set that region's textContent so changes are announced.

Usage:
    python3 scripts/fix_aria_live.py
"""

import os
import re

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# ---------------------------------------------------------------------------
# Live-region HTML snippet (injected once per page, near the top of <body>)
# ---------------------------------------------------------------------------
LIVE_REGION_HTML = (
    '<div id="aria-live-region" role="status" aria-live="polite" aria-atomic="true" '
    'style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;'
    'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;">'
    '</div>'
)

# Marker we inject so the region is not duplicated on re-runs (idempotent)
LIVE_REGION_MARKER = 'id="aria-live-region"'

# ---------------------------------------------------------------------------
# Per-page JS snippet to wire dynamic updates to the live region.
# Each snippet is injected just before the closing </script> of the last
# inline <script> block (or just before </body> if no inline scripts found).
# ---------------------------------------------------------------------------
ANNOUNCE_JS = """\

// Accessibility: announce dynamic content changes to screen readers
(function () {
  function announce(msg) {
    var el = document.getElementById('aria-live-region');
    if (!el) return;
    el.textContent = '';                        // force re-announcement
    requestAnimationFrame(function () { el.textContent = msg; });
  }
  window.__announceUpdate = announce;
})();
"""

# Hooks to add per page (regex pattern in existing JS → replacement with announce call)
# Format: list of (search_pattern, replacement) tuples; regex flags default DOTALL
PAGE_HOOKS = {
    'dashboard.html': [
        # Announce when region filter changes
        (
            r"(document\.getElementById\('region-select'\)\.addEventListener\('change',\s*function\(e\)\s*\{)",
            r"\1\n            window.__announceUpdate && window.__announceUpdate('Dashboard updated: ' + e.target.options[e.target.selectedIndex].text + ' region');"
        ),
    ],
    'chfa-portfolio.html': [
        # Announce after table is rendered (renderTable or renderPage call)
        (
            r'(function\s+renderPage\s*\(\s*\)\s*\{)',
            r'\1\n    window.__announceUpdate && window.__announceUpdate(\'Portfolio table updated\');'
        ),
    ],
    'compliance-dashboard.html': [
        # Announce when status filter changes
        (
            r"(id=['\"]status-filter['\"][^>]*>[\s\S]*?</select>)",
            r'\1\n<script>document.addEventListener("DOMContentLoaded",function(){var sf=document.getElementById("status-filter");if(sf)sf.addEventListener("change",function(){window.__announceUpdate&&window.__announceUpdate("Compliance table filtered: "+sf.options[sf.selectedIndex].text);});});<\/script>'
        ),
    ],
    'construction-commodities.html': [
        # Announce when commodity data is rendered
        (
            r'(document\.getElementById\([\'"]price-cards-container[\'"]\)\.innerHTML\s*=)',
            r"window.__announceUpdate && window.__announceUpdate('Commodity price data loaded'); \1"
        ),
    ],
}

TARGET_HTML = list(PAGE_HOOKS.keys())


def inject_live_region(html: str) -> str:
    """Inject the live-region div after the first <body> or skip-link tag."""
    if LIVE_REGION_MARKER in html:
        return html  # already present

    # Prefer injecting right after skip-link
    skip_match = re.search(r'(<a[^>]+class=["\']skip-link["\'][^>]*>[^<]*</a>)', html)
    if skip_match:
        insert_pos = skip_match.end()
        return html[:insert_pos] + '\n' + LIVE_REGION_HTML + html[insert_pos:]

    # Fall back: after <body ...>
    body_match = re.search(r'<body[^>]*>', html, re.IGNORECASE)
    if body_match:
        insert_pos = body_match.end()
        return html[:insert_pos] + '\n' + LIVE_REGION_HTML + html[insert_pos:]

    return html


def inject_announce_js(html: str) -> str:
    """Inject the announce() helper as a standalone <script> block."""
    marker = 'window.__announceUpdate'
    if marker in html:
        return html  # already injected

    # Find the last INLINE (no src) </script> closing tag.
    # We must NOT inject inside a <script src="..."> tag as browsers ignore
    # the inline content of external script tags.
    # Strategy: find all </script> positions and pick the last one that is
    # preceded by an inline (not src) <script> opening.
    inline_script_pattern = re.compile(
        r'<script(?!\s+[^>]*\bsrc\s*=)[^>]*>.*?</\s*script[^>]*>',
        re.DOTALL | re.IGNORECASE,
    )
    matches = list(inline_script_pattern.finditer(html))

    if matches:
        # Inject before the LAST inline </script>
        last_match = matches[-1]
        # Find the closing tag offset: search backward for </ then script
        closing_tag_match = re.search(r'</\s*script[^>]*>$', last_match.group(), re.IGNORECASE)
        if closing_tag_match:
            insert_pos = last_match.start() + closing_tag_match.start()
            return html[:insert_pos] + ANNOUNCE_JS + html[insert_pos:]

    # No inline scripts at all — add a new <script> block before </body>
    body_end = html.lower().rfind('</body>')
    if body_end != -1:
        return html[:body_end] + '<script>' + ANNOUNCE_JS + '</script>\n' + html[body_end:]

    return html


def apply_page_hooks(html: str, filename: str) -> str:
    """Apply per-page JS wiring hooks for filter/update events (idempotent)."""
    hooks = PAGE_HOOKS.get(filename, [])
    for pattern, replacement in hooks:
        # Idempotency: only apply if the announce call string isn't already
        # present in the document.  We extract a unique phrase from the
        # replacement text to use as an existence marker.
        # If __announceUpdate already appears in html AND all hook replacements
        # for this page were already applied, skip everything.
        if '__announceUpdate' in html:
            # Check for construction-commodities page hook marker
            if 'Commodity price data loaded' in html:
                continue
            # Check for dashboard page hook marker
            if 'Dashboard updated' in html:
                continue
            # Check for chfa page hook marker
            if 'Portfolio table updated' in html:
                continue
        new_html = re.sub(pattern, replacement, html, count=1, flags=re.DOTALL)
        if new_html != html:
            html = new_html
    return html


def fix_file(path: str, filename: str) -> bool:
    """Apply all aria-live fixes to a single HTML file."""
    with open(path, encoding='utf-8') as f:
        html = f.read()

    original = html

    html = inject_live_region(html)
    html = inject_announce_js(html)
    html = apply_page_hooks(html, filename)

    if html == original:
        return False

    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    return True


def fix_aria_live() -> None:
    """Entry point: inject aria-live regions on the 4 target pages."""
    print('Fix 3: aria-live regions for dynamic content')
    print('=' * 56)

    total_changed = 0
    for filename in TARGET_HTML:
        path = os.path.join(REPO_ROOT, filename)
        if not os.path.exists(path):
            print(f'  ⚠  {filename} not found, skipping')
            continue

        changed = fix_file(path, filename)
        if changed:
            print(f'  ✅  {filename} — aria-live region injected')
            total_changed += 1
        else:
            print(f'  ✓  {filename} — already has aria-live region')

    print()
    if total_changed:
        print(f'✅  Fix 3 complete — {total_changed} file(s) updated.')
    else:
        print('✓  Fix 3 complete — all pages already have aria-live regions.')


if __name__ == '__main__':
    fix_aria_live()
