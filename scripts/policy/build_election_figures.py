#!/usr/bin/env python3
"""Build the 2026 election figures for the midterms Housing News brief.

Every number is read from the repository's own sourced records:

* local measure counts: the latest dated history note on each tracked row in
  data/policy/ballot-2026/counties/*.json ("Yes N (p%), No N (p%)"), which
  links the county's results page;
* money at stake: the same rows' measure.fiscal.amount_cap (ballot text);
* places: data/co-place-centroids.json (2024 Census Gazetteer) and county
  outlines from data/co-county-boundaries.json;
* roll calls: data/policy/housing-roll-calls.json.

Writes SVG files to assets/briefs/election-2026/. With --check it rebuilds in
memory and fails if a committed file differs, so a count change in the data
cannot leave a stale picture behind.

Usage:
  python3 scripts/policy/build_election_figures.py
  python3 scripts/policy/build_election_figures.py --check
"""

import glob
import json
import os
import re
import sys
from html import escape

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'briefs', 'election-2026')

# Short labels for the tracked rows. Anything not listed here is skipped, so a
# new row has to be named on purpose before it appears in a figure.
LABELS = {
    '2026-11-03-0813845-2C': ('Cherry Hills Village 2C', 'Local-only zoning in charter', 'land'),
    'ballot-2026-0812387-q300': ('Castle Pines 300', 'Vote required to annex 20+ acres', 'land'),
    'ballot-2026-0812387-q301': ('Castle Pines 301', 'Refer recent annexations to voters', 'land'),
    'ballot-2026-08111-lodging-tax-expansion': ('San Juan County 1A', 'Lodging tax; 45% to housing and child care', 'money'),
    'ballot-2026-0852570-2a': ('Mt. Crested Butte 2A', 'Short-term rental tax for housing', 'money'),
    '2026-11-03-08014-1A': ('Broomfield 1A', 'Lodging tax for the Housing Authority', 'money'),
    # No share of Lakewood's revenue is set aside for homelessness (see the row's
    # limitations), so it is left off the housing-money chart.
    'ballot-2026-0843000-2g': ('Lakewood 2G', 'Sales tax, public safety incl. homelessness', 'no_earmark'),
    'ballot-2026-0867280-5-h-llc-r-2-zoning': ('Salida 5-H R-2', 'Rezoning a property to R-2', 'land'),
}
# Where a county-wide measure's dot goes: the county seat's Gazetteer point.
COUNTY_POINT = {'08014': '0809280', '08111': '0870580'}

COUNT_RE = re.compile(r'Yes ([\d,]+) \(([\d.]+)%\), No ([\d,]+) \(([\d.]+)%\)')
MONEY_RE = re.compile(r'\$([\d,]+(?:\.\d+)?)')

COLORS = {'passed': '#1f5f99', 'failed': '#b3541e', 'open': '#6b6b6b'}
STATUS_TEXT = {'passed': 'Passed', 'failed': 'Failed', 'open': 'Too close to call'}
INK = '#1d2329'
MUTED = '#55606b'
FONT = "font-family=\"system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif\""


def status_text(r, short=False):
    t = STATUS_TEXT[r['status']]
    if short and r['status'] == 'open':
        t = 'Too close'
    return t + (' (partial count)' if r.get('partial') else '')


def load(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as fh:
        return json.load(fh)


def measures():
    rows = []
    for path in sorted(glob.glob(os.path.join(ROOT, 'data/policy/ballot-2026/counties/*.json'))):
        with open(path, encoding='utf-8') as fh:
            doc = json.load(fh)
        for e in doc.get('entries', []):
            if e['id'] not in LABELS or not e.get('history'):
                continue
            last = e['history'][-1]
            m = COUNT_RE.search(last['note'])
            if not m:
                raise SystemExit('no count in latest history note for ' + e['id'])
            status = e['status'] if e['status'] in ('passed', 'failed') else 'open'
            cap = (e['measure'].get('fiscal') or {}).get('amount_cap') or ''
            money = MONEY_RE.search(cap)
            name, what, kind = LABELS[e['id']]
            rows.append({
                'id': e['id'], 'name': name, 'what': what, 'kind': kind, 'status': status,
                'geoid': e['jurisdiction']['geoid'],
                'yes': int(m.group(1).replace(',', '')), 'yes_pct': float(m.group(2)),
                'no': int(m.group(3).replace(',', '')), 'no_pct': float(m.group(4)),
                'partial': 'Partial count' in last['note'],
                'checked': last['checked'], 'source': last['source']['url'] if last.get('source') else None,
                'money': float(money.group(1).replace(',', '')) if money else None,
            })
    missing = set(LABELS) - {r['id'] for r in rows}
    if missing:
        raise SystemExit('tracked rows missing from ballot data: ' + ', '.join(sorted(missing)))
    return rows


def svg(width, height, body, title, desc):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" role="img" '
        'aria-labelledby="t d" %s>\n<title id="t">%s</title>\n<desc id="d">%s</desc>\n'
        '<rect width="100%%" height="100%%" fill="#ffffff"/>\n%s</svg>\n'
        % (width, height, width, height, FONT, escape(title), escape(desc), body)
    )


def text(x, y, s, size=13, weight=400, fill=INK, anchor='start'):
    return '<text x="%.1f" y="%.1f" font-size="%d" font-weight="%d" fill="%s" text-anchor="%s">%s</text>\n' % (
        x, y, size, weight, fill, anchor, escape(s))


def wrap(s, limit=64):
    out, cur = [], ''
    for word in s.split(' '):
        if cur and len(cur) + 1 + len(word) > limit:
            out.append(cur)
            cur = word
        else:
            cur = (cur + ' ' + word).strip()
    return out + [cur] if cur else out


def note_lines(y, s, size=11):
    """Small grey text, wrapped to the figure width. Returns (svg, next y)."""
    body = ''
    for i, line in enumerate(wrap(s)):
        body += text(16, y + i * 15, line, size, 400, MUTED)
    return body, y + 15 * len(wrap(s))


def footer(y, width, line):
    return note_lines(y, line)[0]


def footer_height(line):
    return 15 * len(wrap(line))


def as_of(rows):
    return max(r['checked'] for r in rows)


# ── Figure 1: map ────────────────────────────────────────────────────────
def map_figure(rows):
    counties = load('data/co-county-boundaries.json')['features']
    places = load('data/co-place-centroids.json')['byGeoid']
    W, mx, top = 420, 16, 56
    lon0, lon1, lat0, lat1 = -109.06, -102.04, 36.99, 41.0
    kx = (W - 2 * mx) / (lon1 - lon0)
    ky = kx / 0.777  # cos(39°): keeps the state's shape
    H_map = (lat1 - lat0) * ky

    def px(lon, lat):
        return mx + (lon - lon0) * kx, top + (lat1 - lat) * ky

    paths = []
    for f in counties:
        g = f['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        d = ''
        for poly in polys:
            ring = poly[0]
            pts = [px(lon, lat) for lon, lat in ring]
            d += 'M' + ' L'.join('%.1f %.1f' % p for p in pts) + ' Z '
        paths.append('<path d="%s" fill="#eef1f4" stroke="#b9c2cb" stroke-width="0.6"/>' % d.strip())

    order = sorted(rows, key=lambda r: (-places[COUNTY_POINT.get(r['geoid'], r['geoid'])]['lat']))
    dots, keys = [], []
    # Front Range dots sit within a few pixels of each other, so each dot
    # carries a number and the key below names it.
    for i, r in enumerate(order, 1):
        p = places[COUNTY_POINT.get(r['geoid'], r['geoid'])]
        x, y = px(p['lng'], p['lat'])
        r['_n'] = i
        dots.append((x, y, i, r))
    # Nudge dots that would overlap so every number stays readable.
    placed = []
    for x, y, i, r in dots:
        nx, ny = x, y
        for (ox, oy) in placed:
            if abs(nx - ox) < 15 and abs(ny - oy) < 15:
                nx = ox + 16
        placed.append((nx, ny))
        r['_xy'] = (x, y, nx, ny)

    body = text(16, 24, 'Local housing measures, Nov. 3, 2026', 16, 700)
    body += text(16, 44, 'Unofficial results as of ' + as_of(rows) + '. Counts may change until certified.', 12, 400, MUTED)
    body += ''.join(paths) + '\n'
    for r in order:
        x, y, nx, ny = r['_xy']
        if (nx, ny) != (x, y):
            body += '<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="1"/>\n' % (x, y, nx, ny, INK)
            body += '<circle cx="%.1f" cy="%.1f" r="2" fill="%s"/>\n' % (x, y, INK)
        body += '<circle cx="%.1f" cy="%.1f" r="8" fill="%s" stroke="#ffffff" stroke-width="1.5"/>\n' % (nx, ny, COLORS[r['status']])
        body += text(nx, ny + 4, str(r['_n']), 11, 700, '#ffffff', 'middle')
    y = top + H_map + 22
    # Legend
    lx = 16
    for k in ('passed', 'failed', 'open'):
        body += '<circle cx="%.1f" cy="%.1f" r="6" fill="%s"/>\n' % (lx + 6, y - 4, COLORS[k])
        body += text(lx + 16, y, STATUS_TEXT[k], 12)
        lx += 16 + 8 * len(STATUS_TEXT[k]) + 18
    y += 22
    for r in order:
        pct = '%.1f%% yes' % r['yes_pct']
        body += '<circle cx="24" cy="%.1f" r="8" fill="%s"/>\n' % (y - 4, COLORS[r['status']])
        body += text(24, y, str(r['_n']), 11, 700, '#ffffff', 'middle')
        body += text(40, y, r['name'] + ' · ' + status_text(r) + ', ' + pct, 13, 600)
        body += text(40, y + 16, r['what'], 12, 400, MUTED)
        y += 38
    src = 'Source: county results pages (SOS Clarity ENR), read ' + as_of(rows) + '; place points from the 2024 Census Gazetteer.'
    body += footer(y, W, src)
    H = y + footer_height(src)
    desc = 'Map of Colorado with the eight local housing measures tracked by COHO Analytics. ' + '; '.join(
        '%d %s, %s, %s, %.1f%% yes' % (r['_n'], r['name'], r['what'], status_text(r).lower(), r['yes_pct']) for r in order
    ) + '. Unofficial results as of ' + as_of(rows) + '.'
    return svg(W, int(H), body, 'Local housing measures, Nov. 3, 2026 (unofficial)', desc), order


# ── Figure 2: yes share ──────────────────────────────────────────────────
def yes_figure(rows):
    W = 420
    bar_x, bar_w = 16, 260
    groups = [(('money', 'no_earmark'), 'Tax measures'), (('land',), 'Land use and growth')]
    body = text(16, 24, 'Yes share on each local measure', 16, 700)
    body += text(16, 44, 'Unofficial, as of ' + as_of(rows) + '. All need a simple majority.', 12, 400, MUTED)
    y = 70
    for key, title in groups:
        body += text(16, y, title, 13, 700)
        y += 10
        for r in sorted([r for r in rows if r['kind'] in key], key=lambda r: -r['yes_pct']):
            y += 18
            suffix = ' (partial count)' if r.get('partial') else (' (no share set aside for housing)' if r['kind'] == 'no_earmark' else '')
            body += text(16, y, r['name'] + suffix, 12, 600)
            y += 6
            w = bar_w * r['yes_pct'] / 100
            body += '<rect x="%d" y="%.1f" width="%d" height="14" fill="#e7ebef"/>\n' % (bar_x, y, bar_w)
            body += '<rect x="%d" y="%.1f" width="%.1f" height="14" fill="%s"/>\n' % (bar_x, y, w, COLORS[r['status']])
            body += '<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="1.5" stroke-dasharray="3 2"/>\n' % (
                bar_x + bar_w / 2, y - 3, bar_x + bar_w / 2, y + 17, INK)
            body += text(bar_x + bar_w + 8, y + 12, '%.1f%%' % r['yes_pct'], 12, 700)
            body += text(bar_x + bar_w + 56, y + 12, status_text(r, True).replace(' (partial count)', ''), 11, 400, MUTED)
            y += 16
        y += 18
    body += text(16, y - 4, 'Dashed line: 50%, the share needed to pass.', 11, 400, MUTED)
    y += 10
    src = 'Source: county results pages (SOS Clarity ENR), read ' + as_of(rows) + '.'
    body += footer(y, W, src)
    y += footer_height(src) - 14
    desc = 'Bar chart of the yes share on eight Colorado local measures. ' + '; '.join(
        '%s %.1f%% yes, %s' % (r['name'], r['yes_pct'], status_text(r).lower()) for r in rows) + '.'
    return svg(W, int(y + 14), body, 'Yes share on each local housing measure (unofficial)', desc)


# ── Figure 3: money at stake ─────────────────────────────────────────────
def money_figure(rows):
    W = 420
    items = sorted([r for r in rows if r['money'] and r['kind'] == 'money'], key=lambda r: -r['money'])
    top = max(r['money'] for r in items)
    bar_w = 230
    body = text(16, 24, 'Housing money at stake in the first full year', 16, 700)
    body += text(16, 44, 'Revenue cap in each ballot question. Unofficial, as of ' + as_of(rows) + '.', 12, 400, MUTED)
    y = 62
    for r in items:
        y += 18
        body += text(16, y, r['name'], 12, 600)
        y += 6
        w = max(2, bar_w * r['money'] / top)
        body += '<rect x="16" y="%.1f" width="%.1f" height="14" fill="%s"/>\n' % (y, w, COLORS[r['status']])
        amt = 'up to $%.1f million' % (r['money'] / 1e6) if r['money'] >= 1e6 else '$%s' % format(int(r['money']), ',')
        body += text(16 + w + 8, y + 12, amt + ' · ' + (STATUS_TEXT[r['status']] if r['status'] != 'open' else 'Too close'), 12, 700)
        y += 16
    y += 22
    part, y = note_lines(y, 'Caps are ceilings, not forecasts. San Juan: the full tax increase; 45% of it goes to workforce housing and child care. Lakewood 2G (failed) is not shown: it set no share aside for housing or homelessness.')
    body += part
    y += 6
    src = 'Source: ballot text in the site’s ballot records; county results pages, read ' + as_of(rows) + '.'
    body += footer(y, W, src)
    y += footer_height(src) - 14
    desc = 'Bar chart of the first-year revenue cap in each local housing money measure. ' + '; '.join(
        '%s up to $%s, %s' % (r['name'], format(int(r['money']), ','), STATUS_TEXT[r['status']].lower()) for r in items) + '.'
    return svg(W, int(y + 14), body, 'Housing money at stake in local measures (unofficial)', desc)


# ── Figure 4: roll calls ─────────────────────────────────────────────────
def roll_figure():
    doc = load('data/policy/housing-roll-calls.json')
    W, bar_w = 420, 300
    body = text(16, 24, 'How recent housing bills passed', 16, 700)
    body += text(16, 44, 'Yes and no votes on final passage.', 12, 400, MUTED)
    y = 62
    for rc in doc['roll_calls']:
        total = rc['yes'] + rc['no']
        y += 20
        body += text(16, y, rc['body'] + ' – ' + rc['measure'].split(',')[0] + ' (' + rc['date'] + ')', 12, 600)
        y += 6
        yw = bar_w * rc['yes'] / total
        body += '<rect x="16" y="%.1f" width="%.1f" height="16" fill="%s"/>\n' % (y, yw, COLORS['passed'])
        body += '<rect x="%.1f" y="%.1f" width="%.1f" height="16" fill="%s"/>\n' % (16 + yw, y, bar_w - yw, COLORS['failed'])
        body += text(16 + bar_w + 8, y + 13, '%d–%d' % (rc['yes'], rc['no']), 13, 700)
        y += 16
        note = None
        if rc.get('by_party'):
            bp = rc['by_party']
            note = 'Democrats %d–%d, Republicans %d–%d. Colorado: %d of %d yes (no: %s).' % (
                bp['Democratic']['yes'], bp['Democratic']['no'], bp['Republican']['yes'], bp['Republican']['no'],
                len(rc['colorado']['yes']), len(rc['colorado']['yes']) + len(rc['colorado']['no']), ', '.join(rc['colorado']['no']))
        elif rc.get('democrats_voting_no'):
            note = '%d Democrats voted no. Two switched votes and it fails.' % rc['democrats_voting_no']
        if note:
            part, y2 = note_lines(y + 16, note)
            body += part
            y = y2 - 15
    y += 22
    body += '<rect x="16" y="%.1f" width="12" height="12" fill="%s"/>\n' % (y - 10, COLORS['passed'])
    body += text(34, y, 'Yes', 12)
    body += '<rect x="74" y="%.1f" width="12" height="12" fill="%s"/>\n' % (y - 10, COLORS['failed'])
    body += text(92, y, 'No', 12)
    y += 20
    src = 'Sources: House Clerk roll call 224 (2026); Washington Times, June 22, 2026; Colorado Newsline, May 7, 2024. Read ' + doc['meta']['as_of'] + '.'
    body += footer(y, W, src)
    y += footer_height(src) - 14
    desc = 'Bar chart of four housing roll calls. ' + '; '.join(
        '%s, %s, %s: %d yes, %d no' % (rc['body'], rc['measure'], rc['date'], rc['yes'], rc['no']) for rc in doc['roll_calls']) + '.'
    return svg(W, int(y + 14), body, 'How recent housing bills passed', desc)


def build():
    rows = measures()
    map_svg, _ = map_figure(rows)
    return {
        'local-measures-map.svg': map_svg,
        'local-measures-yes-share.svg': yes_figure(rows),
        'local-measures-money.svg': money_figure(rows),
        'housing-roll-calls.svg': roll_figure(),
    }


def main():
    check = '--check' in sys.argv[1:]
    files = build()
    stale = []
    for name, content in files.items():
        path = os.path.join(OUT, name)
        if check:
            try:
                with open(path, encoding='utf-8') as fh:
                    if fh.read() != content:
                        stale.append(name)
            except FileNotFoundError:
                stale.append(name)
        else:
            os.makedirs(OUT, exist_ok=True)
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(content)
    if check:
        if stale:
            print('election figures are stale: ' + ', '.join(stale) + '. Run python3 scripts/policy/build_election_figures.py')
            sys.exit(1)
        print('election figures: OK (%d files)' % len(files))
    else:
        print('wrote %d files to %s' % (len(files), os.path.relpath(OUT, ROOT)))


if __name__ == '__main__':
    main()
