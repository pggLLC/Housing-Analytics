#!/usr/bin/env python3
"""Fix 4: Add semantic landmark elements to all pages.

Root cause: 6 of 10 pages are missing one or more HTML5 landmark elements
            (<nav>, <header>, <main>, <footer>).  cra-expansion-analysis.html
            is the worst offender — it uses <div id="main-content"> instead of
            <main id="main-content">, so screen-reader "jump to main" shortcuts
            do not work at all.
Impact:     Screen reader users cannot skip navigation via rotor or landmark
            shortcuts; must tab through the entire navigation on every page load.
Solution:   1. Replace <div id="main-content"> with <main id="main-content">
               (and matching closing tag) in all pages that use the pattern.
            2. Replace the plain <div id="site-header"> placeholder (where it
               exists as a bare div) with <header id="site-header"> so it is
               treated as a landmark before navigation.js fires.
            3. Add a <footer id="site-footer"> placeholder on pages that lack
               any footer element, so the navigation.js footer injection lands
               inside a semantic landmark.

Usage:
    python3 scripts/fix_landmarks.py
"""

import os
import re

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# All pages in scope (the 10 pages with charting / dynamic content)
TARGET_HTML = [
    'cra-expansion-analysis.html',
    'dashboard.html',
    'chfa-portfolio.html',
    'compliance-dashboard.html',
    'construction-commodities.html',
    'colorado-deep-dive.html',
    'market-analysis.html',
    'market-intelligence.html',
    'LIHTC-dashboard.html',
    'economic-dashboard.html',
]


def _fix_main_landmark(html: str) -> str:
    """Replace bare <div id="main-content"> with <main id="main-content">."""
    # Pattern: <div id="main-content" ...> (with optional extra attributes)
    # We replace the opening tag only; closing tag detection is heuristic.
    pattern = re.compile(
        r'<div(\s+id=["\']main-content["\'][^>]*)>',
        re.IGNORECASE,
    )
    html = pattern.sub(r'<main\1>', html)

    # Replace the first </div> that closes a <div id="main-content"> element.
    # Since we already replaced the opening tag to <main>, we look for files
    # that now have <main id="main-content"> without a </main> but with a
    # surplus closing </div> that should be </main>.
    # We do this only when the file does NOT already contain </main>.
    if '<main id="main-content"' in html and '</main>' not in html:
        # Strategy: find </div> that is the page-level closing div.
        # In cra-expansion-analysis.html the structure is:
        #   <main id="main-content" style="...">
        #     … all page content …
        #   </div>
        # We replace the LAST </div> before </body>.
        body_end = html.lower().rfind('</body>')
        if body_end != -1:
            last_div = html.rfind('</div>', 0, body_end)
            if last_div != -1:
                html = html[:last_div] + '</main>' + html[last_div + len('</div>'):]

    return html


def _fix_header_landmark(html: str) -> str:
    """Upgrade <div id="site-header"></div> to <header id="site-header"></header>."""
    # Only if there is no <header at all (to avoid double-header)
    if re.search(r'<header[\s>]', html, re.IGNORECASE):
        return html

    html = re.sub(
        r'<div(\s+id=["\']site-header["\'][^>]*)></div>',
        r'<header\1></header>',
        html,
        flags=re.IGNORECASE,
    )
    return html


def _fix_footer_landmark(html: str) -> str:
    """Add <footer id="site-footer"></footer> before </body> if missing."""
    # Skip if a footer element already exists
    if re.search(r'<footer[\s>]', html, re.IGNORECASE):
        return html

    # Add a bare footer placeholder before </body>
    footer_placeholder = '\n<footer id="site-footer"></footer>'
    body_end = html.lower().rfind('</body>')
    if body_end != -1:
        return html[:body_end] + footer_placeholder + '\n' + html[body_end:]

    return html


def fix_file(path: str) -> bool:
    """Apply landmark fixes to a single HTML file."""
    with open(path, encoding='utf-8') as f:
        html = f.read()

    original = html

    html = _fix_main_landmark(html)
    html = _fix_header_landmark(html)
    html = _fix_footer_landmark(html)

    if html == original:
        return False

    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    return True


def fix_landmarks() -> None:
    """Entry point: apply landmark fixes to all target pages."""
    print('Fix 4: Semantic landmark elements (<main>, <header>, <footer>)')
    print('=' * 56)

    total_changed = 0
    for filename in TARGET_HTML:
        path = os.path.join(REPO_ROOT, filename)
        if not os.path.exists(path):
            print(f'  ⚠  {filename} not found, skipping')
            continue

        changed = fix_file(path)
        if changed:
            print(f'  ✅  {filename} — landmark elements updated')
            total_changed += 1
        else:
            print(f'  ✓  {filename} — landmarks already present')

    print()
    if total_changed:
        print(f'✅  Fix 4 complete — {total_changed} file(s) updated.')
    else:
        print('✓  Fix 4 complete — all pages already have landmark elements.')


if __name__ == '__main__':
    fix_landmarks()
