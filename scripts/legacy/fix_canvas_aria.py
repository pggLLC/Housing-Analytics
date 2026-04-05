#!/usr/bin/env python3
"""Fix 2: Add role="img" and aria-label to all bare <canvas> elements.

Root cause: 14 of 16 canvas elements have no aria-label, no role, and no
            <title> child element.
Impact:     Screen readers announce bare "canvas" with zero description,
            violating WCAG 1.1.1 Non-text Content.
Solution:   Add role="img" and a descriptive aria-label to every canvas;
            inject a visually-hidden data summary <p> immediately after each
            canvas so keyboard/screen-reader users can access chart data.

Usage:
    python3 scripts/fix_canvas_aria.py
"""

import os
import re

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# ---------------------------------------------------------------------------
# Catalogue of every canvas element that needs accessibility attributes.
# Key = canvas id value.  Value = descriptive aria-label string.
# ---------------------------------------------------------------------------
CANVAS_LABELS = {
    # cra-expansion-analysis.html
    'scenarios-chart': (
        'Line chart: LIHTC 9% credit pricing forecast under four CRA expansion '
        'scenarios (Baseline, Moderate, Aggressive, Transformative) through Q4 2027'
    ),
    # dashboard.html
    'allocations-chart': (
        'Bar chart: top 10 states ranked by total LIHTC allocation amount'
    ),
    # construction-commodities.html
    'steel-chart': (
        'Line chart: Steel and Metal Products Producer Price Index trend over time'
    ),
    'lumber-chart': (
        'Line chart: Lumber and Wood Products Producer Price Index trend over time'
    ),
    'concrete-chart': (
        'Line chart: Concrete and Cement Producer Price Index trend over time'
    ),
    'composite-chart': (
        'Line chart: Construction Materials Input PPI composite index over time'
    ),
    # colorado-deep-dive.html
    'ami-need-chart': (
        'Bar chart: Colorado housing need versus available affordable units by AMI level'
    ),
    'concessions-chart': (
        'Line chart: Denver Metro average monthly rental concession value 2022–2025'
    ),
    'foreclosure-chart': (
        'Bar chart: Colorado foreclosure filing trends by quarter'
    ),
    'confidence-chart': (
        'Line chart: NAHB builder confidence index for Colorado housing market'
    ),
    'comparison-chart': (
        'Bar chart: Colorado housing market metrics compared with national averages'
    ),
    # regional.html
    'allocations-chart-regional': (
        'Bar chart: LIHTC allocations by state and region'
    ),
    'per-capita-chart': (
        'Bar chart: LIHTC allocation per capita by state'
    ),
    # market-analysis.html
    'pmaRadarChart': (
        'Radar chart: Primary Market Area scoring across affordability, '
        'demand, supply, and risk dimensions'
    ),
    # colorado-market.html
    'co-pricing-forecast': (
        'Line chart: Colorado LIHTC credit pricing forecast through 2027'
    ),
    'co-starts-forecast': (
        'Line chart: Colorado housing starts forecast through 2027'
    ),
    # census-dashboard.html
    'mf-share': (
        'Bar chart: multifamily housing share of total housing stock by county'
    ),
    # market-intelligence.html
    'demandChart': (
        'Line chart: housing demand index over time'
    ),
    'supplyChart': (
        'Line chart: housing supply index over time'
    ),
    'lihtcTrendChart': (
        'Line chart: LIHTC credit pricing trend over time'
    ),
}

# Visually-hidden summary paragraphs (injected after each canvas).
# If a canvas does not have a bespoke summary here, a generic one is used.
CANVAS_SUMMARIES = {
    'scenarios-chart': (
        'Chart data: Baseline scenario ends at $0.85 (Q4 2027); '
        'Moderate Expansion $0.94; Aggressive Expansion $1.01; '
        'Transformative Reform $1.11.'
    ),
    'allocations-chart': (
        'Chart data: top 10 states by LIHTC allocation are displayed in '
        'the data table immediately above this chart.'
    ),
}

_GENERIC_SUMMARY = (
    'Chart data is available in the surrounding text and data tables on this page.'
)

# Target HTML files (files known to contain bare canvas elements)
TARGET_HTML = [
    'cra-expansion-analysis.html',
    'dashboard.html',
    'construction-commodities.html',
    'colorado-deep-dive.html',
    'regional.html',
    'market-analysis.html',
    'colorado-market.html',
    'census-dashboard.html',
    'market-intelligence.html',
]

_SR_ONLY_CLASS = 'sr-only'
_SR_ONLY_STYLE = (
    'position:absolute;width:1px;height:1px;padding:0;margin:-1px;'
    'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0'
)


def _build_canvas_replacement(canvas_id: str, existing_attrs: str) -> str:
    """Return a replacement canvas tag with role + aria-label injected."""
    label = CANVAS_LABELS.get(canvas_id, f'Interactive chart: {canvas_id}')

    # Remove any stale aria-label / role attributes so we can re-add them
    attrs = re.sub(r'\s*aria-label\s*=\s*"[^"]*"', '', existing_attrs)
    attrs = re.sub(r"\s*aria-label\s*=\s*'[^']*'", '', attrs)
    attrs = re.sub(r'\s*role\s*=\s*"[^"]*"', '', attrs)
    attrs = re.sub(r"\s*role\s*=\s*'[^']*'", '', attrs)
    attrs = attrs.strip()

    new_tag = f'<canvas{(" " + attrs) if attrs else ""} role="img" aria-label="{label}">'
    return new_tag


def _build_summary_paragraph(canvas_id: str) -> str:
    """Return a visually-hidden <p> summarising the chart data."""
    summary = CANVAS_SUMMARIES.get(canvas_id, _GENERIC_SUMMARY)
    return (
        f'<p class="{_SR_ONLY_CLASS}" style="{_SR_ONLY_STYLE}">'
        f'{summary}'
        f'</p>'
    )


def fix_file(path: str) -> bool:
    """Apply aria fixes to a single HTML file. Returns True if the file changed."""
    with open(path, encoding='utf-8') as f:
        html = f.read()

    original = html

    # Match every <canvas ...> tag (self-closing or not)
    canvas_pattern = re.compile(
        r'<canvas([^>]*)>',
        re.DOTALL | re.IGNORECASE,
    )

    def replace_canvas(m: re.Match) -> str:  # type: ignore[type-arg]
        attrs_raw = m.group(1)

        # Extract canvas id
        id_match = re.search(r'id\s*=\s*["\']([^"\']+)["\']', attrs_raw, re.IGNORECASE)
        canvas_id = id_match.group(1) if id_match else ''

        # Skip canvases that already have role="img" (idempotency)
        if re.search(r'role\s*=\s*["\']img["\']', attrs_raw, re.IGNORECASE):
            return m.group(0)

        return _build_canvas_replacement(canvas_id, attrs_raw)

    html = canvas_pattern.sub(replace_canvas, html)

    # Inject visually-hidden summary <p> after </canvas> where missing
    close_pattern = re.compile(
        r'(<canvas[^>]+>)(</canvas>)',
        re.DOTALL | re.IGNORECASE,
    )

    def inject_summary(m: re.Match) -> str:  # type: ignore[type-arg]
        opening_tag = m.group(1)
        closing_tag = m.group(2)
        # Peek at text immediately following the closing </canvas> tag
        remaining = m.string[m.end():]

        # Idempotency: skip if an sr-only paragraph already follows this canvas
        if re.match(r'\s*<p\s[^>]*class=["\'][^"\']*sr-only', remaining, re.IGNORECASE):
            return m.group(0)

        id_match = re.search(r'id\s*=\s*["\']([^"\']+)["\']', opening_tag, re.IGNORECASE)
        canvas_id = id_match.group(1) if id_match else ''

        summary_p = _build_summary_paragraph(canvas_id)
        return opening_tag + closing_tag + summary_p

    html = close_pattern.sub(inject_summary, html)

    if html == original:
        return False

    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    return True


def fix_canvas_aria() -> None:
    """Entry point: apply canvas accessibility fixes to all target HTML files."""
    print('Fix 2: aria-label + role="img" on bare <canvas> elements')
    print('=' * 56)

    total_changed = 0
    for filename in TARGET_HTML:
        path = os.path.join(REPO_ROOT, filename)
        if not os.path.exists(path):
            print(f'  ⚠  {filename} not found, skipping')
            continue

        changed = fix_file(path)
        if changed:
            print(f'  ✅  {filename} — canvas aria attributes added')
            total_changed += 1
        else:
            print(f'  ✓  {filename} — already compliant')

    print()
    if total_changed:
        print(f'✅  Fix 2 complete — {total_changed} file(s) updated.')
    else:
        print('✓  Fix 2 complete — all canvas elements already have aria attributes.')


if __name__ == '__main__':
    fix_canvas_aria()
