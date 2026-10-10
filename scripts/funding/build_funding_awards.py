#!/usr/bin/env python3
"""
scripts/funding/build_funding_awards.py — the public housing-subsidy award ledger.

Finds every award report CHFA publishes for the Housing Tax Credit (9%, 4%,
state, TOC and middle-income credits) and every selection list the Prop 123
Affordable Housing Financing Fund (OEDIT, administered by CHFA) publishes,
reads each PDF with `pdftotext -layout`, and writes one row per award to
data/policy/funding-awards/ledger.json.

Neither agency publishes these lists as data, so the parser works from the
column headings each PDF prints rather than from per-year layouts: it maps
every value on a row to the heading above it, then checks the parsed rows
against the TOTAL line the PDF prints. A document whose rows do not add up to
its own totals is recorded as `mismatch`, its rows are kept out of the ledger,
and the weekly workflow opens an issue for it. Nothing is guessed: a value
that is not printed is null, with the reason on the row.

Usage:
  python3 scripts/funding/build_funding_awards.py              # fetch, parse, write
  python3 scripts/funding/build_funding_awards.py --cache DIR  # reuse/keep PDFs in DIR
  python3 scripts/funding/build_funding_awards.py --check      # parse, write nothing

Requires poppler-utils (pdftotext).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(ROOT, 'data', 'policy', 'funding-awards')
LEDGER = os.path.join(OUT_DIR, 'ledger.json')
DOCUMENTS = os.path.join(OUT_DIR, 'documents.json')
# A person's sign-off on a document the parser could not reconcile, pinned to
# the file's sha256 so a re-published PDF is checked again.
OVERRIDES = os.path.join(OUT_DIR, 'reviewed-documents.json')
# Text the public build refuses (scripts/audit/public-artifact-guard.mjs). The
# list lives in one place, so read it from there rather than copy it.
SENSITIVE_SRC = os.path.join(ROOT, 'scripts', 'lib', 'public-sensitive-patterns.mjs')


def read_json(path: str):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def sensitive_patterns() -> list[re.Pattern]:
    with open(SENSITIVE_SRC, encoding='utf-8') as fh:
        src = fh.read()
    found = re.findall(r'regex:\s*/((?:\\/|[^/])+)/([a-z]*)', src)
    if not found:
        raise RuntimeError(f'no patterns read from {SENSITIVE_SRC}')
    return [re.compile(body, re.I if 'i' in flags else 0) for body, flags in found]
GEO_CONFIG = os.path.join(ROOT, 'data', 'hna', 'geo-config.json')
LIHTC_FEED = os.path.join(ROOT, 'data', 'chfa-lihtc.json')

UA = 'Mozilla/5.0 (compatible; cohoanalytics-funding-awards/1.0; +https://cohoanalytics.com)'

SOURCES = [
    {
        'agency': 'CHFA',
        'program_family': 'housing-tax-credit',
        'index_url': 'https://www.chfainfo.com/rental-housing/housing-credit/awards',
        # Award reports only: applicant, LOI and status reports list requests, not awards.
        'link_pattern': re.compile(r'/getattachment/[^"\s]*award[^"\s]*\.pdf', re.I),
    },
    {
        'agency': 'OEDIT / CHFA (Prop 123 AHFF)',
        'program_family': 'prop123-ahff',
        'index_url': 'https://coloradoaffordablehousingfinancingfund.com/about/selected-applicants/',
        'link_pattern': re.compile(r'https?://[^"\s]*\.pdf', re.I),
        'exclude': re.compile(r'annual[-_ ]?report', re.I),
    },
]

MONEY = re.compile(r'^\(?\$[\d,]+(?:\.\d+)?\)?$')
INT = re.compile(r'^\d{1,3}(?:,\d{3})*$|^\d+$')
STOP_LINE = re.compile(
    r'^\s*(?:\*|n=new|a/r=|\*\*|page \d|as of|public award report|based on year|\d{1,2}/\d{1,2}/\d{2,4}\b)', re.I)
SECTION_LINE = re.compile(r'^\s*(?:\d+%\s+)?(?:traunch|tranche|non-?competitive\b|round\s+\d+\s*,)', re.I)
TOTAL_LINE = re.compile(r'\b(?:grand\s+total|totals?|average)\b\s*:?', re.I)


# ── fetching ─────────────────────────────────────────────────────────────────

def http_get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()


def discover(source: dict) -> list[dict]:
    page = http_get(source['index_url']).decode('utf-8', 'replace')
    found, seen = [], set()
    for m in source['link_pattern'].finditer(page):
        href = html.unescape(m.group(0))
        url = urllib.parse.urljoin(source['index_url'], href)
        name = os.path.basename(urllib.parse.urlparse(url).path)
        if name.lower() in seen or (source.get('exclude') and source['exclude'].search(name)):
            continue
        seen.add(name.lower())
        found.append({'url': url, 'file': name, 'agency': source['agency'],
                      'program_family': source['program_family']})
    return found


def pdf_text(path: str) -> str:
    text = subprocess.run(['pdftotext', '-layout', path, '-'], check=True,
                          capture_output=True).stdout.decode('utf-8', 'replace')
    return re.sub('[\u2010\u2011\u2012\u2013\u2014]', '-', text)


# ── layout parsing ───────────────────────────────────────────────────────────

def tokens(line: str) -> list[dict]:
    """Words of a layout line with their character positions. "$   2,500,000"
    becomes one money token "$2,500,000" without moving any column."""
    line = re.sub(r'\$(\s+)(?=\d)', lambda m: m.group(1) + '$', line)
    return [{'start': m.start(), 'end': m.end(), 'text': m.group(0),
             'money': bool(MONEY.match(m.group(0)))}
            for m in re.finditer(r'\S+', line)]


def money_value(t: str) -> int | None:
    t = t.strip('()$').replace(',', '')
    try:
        return int(round(float(t)))
    except ValueError:
        return None


def int_value(t: str) -> int | None:
    t = t.strip().replace(',', '')
    return int(t) if t.isdigit() else None


def is_anchor(line: str) -> bool:
    return any(t['money'] for t in tokens(line)) and not is_total(line) and not STOP_LINE.match(line)


def is_total(line: str) -> bool:
    """A TOTAL line, or a row of nothing but numbers under the data (some
    reports print their totals without the word)."""
    toks = tokens(line)
    if not any(t['money'] for t in toks):
        return False
    first_money = next(t['start'] for t in toks if t['money'])
    # "Total" must come before the amounts: a sponsor called "Total Concept" is data
    return bool(TOTAL_LINE.search(line[:first_money])) or all(t['money'] or INT.match(t['text']) for t in toks)


def find_columns(lines: list[str], anchors: list[int]) -> list[tuple[int, int]]:
    """Columns are the character ranges the data rows occupy. A position counts
    when two or more rows use it (one long name running into the next column
    does not close a gutter), or when any money value sits on it."""
    width = max(len(lines[a]) for a in anchors) + 1
    count = [0] * width
    money = [False] * width
    # a right-aligned count one space before a text column ("104   103 National
    # Service"): where rows agree on that edge, it is a gutter
    edge = [0] * width
    for a in anchors:
        seen = [False] * width
        toks = tokens(lines[a])
        for t, nxt in zip(toks, toks[1:]):
            if INT.match(t['text']) and nxt['start'] == t['end'] + 1 and re.match(r'[A-Za-z(]', nxt['text']):
                edge[t['end']] += 1
        for t in toks:
            for p in range(t['start'], t['end']):
                seen[p] = True
                if t['money']:
                    money[p] = True
        for p in range(width):
            count[p] += seen[p]
    need = max(2, -(-len(anchors) // 5)) if len(anchors) >= 4 else 1
    used = [count[p] >= need or money[p] for p in range(width)]
    need_edge = max(2, -(-len(anchors) // 2))
    used = [u and edge[p] < need_edge for p, u in enumerate(used)]
    cols, start = [], None
    for p in range(width + 1):
        on = p < width and used[p]
        if on and start is None:
            start = p
        elif not on and start is not None:
            cols.append((start, p))
            start = None
    # a single space is a word break, not a gutter, unless the rows agree it is an edge
    merged: list[list[int]] = []
    for s, e in cols:
        if merged and s - merged[-1][1] <= 1 and edge[merged[-1][1]] < need_edge:
            merged[-1][1] = e
        else:
            merged.append([s, e])
    return [(s, e) for s, e in merged]


def split_by_headings(cols: list[tuple[int, int]], lines: list[str], heads: list[int]) -> list[tuple[int, int]]:
    """Wrapped cells and right-aligned numbers can close the gutter between two
    data columns. The heading line with the most cells shows where they are:
    a data column that sits under two or more heading cells is cut between them."""
    if not heads:
        return cols
    groups_by_line = []
    for h in heads:
        groups: list[list[int]] = []
        for t in tokens(lines[h]):
            if groups and t['start'] - groups[-1][1] <= 1:
                groups[-1][1] = t['end']
            else:
                groups.append([t['start'], t['end']])
        groups_by_line.append(groups)
    groups = max(groups_by_line, key=len)
    out = []
    for s, e in cols:
        inside = [g for g in groups if min(g[1], e) - max(g[0], s) > 0]
        if len(inside) < 2:
            out.append((s, e))
            continue
        # text is left-aligned under its heading, so cut just before the next heading
        cuts = [max((inside[i][1] + inside[i + 1][0]) // 2, inside[i + 1][0] - 2) for i in range(len(inside) - 1)]
        edges = [s] + cuts + [e]
        out.extend((edges[i], edges[i + 1]) for i in range(len(edges) - 1))
    return out


def column_of(tok: dict, cols: list[tuple[int, int]]) -> int:
    """The column a word belongs to: the one it overlaps most, else the nearest.
    Boundaries sit at the middle of each gutter."""
    best, best_key = 0, None
    for i, (s, e) in enumerate(cols):
        overlap = min(tok['end'], e) - max(tok['start'], s)
        centre = (tok['start'] + tok['end']) / 2
        key = (0, -overlap) if overlap > 0 else (1, min(abs(centre - s), abs(centre - e)))
        if best_key is None or key < best_key:
            best, best_key = i, key
    return best


HEADER_WORD = re.compile(
    r'\b(name|project|sponsor|borrower|location|city|county|address|units?|funds|credit|awarded|'
    r'requested|amount|type|target|program|purpose|option|election|estimated|projected|proposition|'
    r'federal|state|toc|total|ami|li|tc|bond|issuer|zip|ownership|owner|contact|phone|email|use)\b', re.I)
TITLE_LINE = re.compile(
    r'financing fund|selections\b|awards?\s*$|award report|award list|finance authority|'
    r'status report|round\s+(?:one|two|\d)\b', re.I)


def header_lines(lines: list[str], first_anchor: int) -> list[int]:
    """The heading block above the first data row: lines that read like column
    headings, stopping at the title or at two blank lines. A wrapped cell of
    the first row sits in the same block but carries no heading word."""
    out, blanks, i = [], 0, first_anchor - 1
    while i >= 0 and first_anchor - i <= 9:
        ln = lines[i]
        if not ln.strip():
            blanks += 1
            if blanks >= 2 and out:
                break
        else:
            blanks = 0
            if SECTION_LINE.match(ln):
                i -= 1
                continue
            if TITLE_LINE.search(ln):
                break
            if HEADER_WORD.search(ln) and not SECTION_LINE.match(ln):
                out.append(i)
        i -= 1
    return sorted(out)


MONEY_KEYS = [
    # (field, token test, priority) — lower priority wins inside one heading
    ('toc_credit', lambda w: w == 'toc', 0),
    ('mihtc_credit', lambda w: w in ('mihtc', 'middle'), 0),
    ('state_credit', lambda w: w == 'state', 1),
    ('federal_credit', lambda w: w in ('federal', '9%', '4%'), 1),
    ('bond_amount', lambda w: w in ('bond', 'pab'), 2),
    ('amount_requested', lambda w: w.startswith('request'), 3),
    ('amount_awarded', lambda w: w.startswith('award') or w == 'funds', 4),
]


def money_headings(lines: list[str], heads: list[int]) -> list[str]:
    """The money headings in left-to-right order. Words naming the same column
    sit within a few characters of each other across heading lines; they are
    clustered and the most specific word names the column. "PAB Issuer" is a
    text column, so pab/bond only count when "amount" follows them."""
    hits = []
    for h in heads:
        toks = tokens(lines[h])
        for j, t in enumerate(toks):
            w = t['text'].lower().strip('*():,')
            for field, test, prio in MONEY_KEYS:
                if test(w):
                    if field == 'bond_amount' and not any(
                            x['text'].lower().startswith('amount') for x in toks[j + 1:j + 3]):
                        break
                    hits.append({'x': (t['start'] + t['end']) / 2, 'field': field, 'prio': prio})
                    break
    hits.sort(key=lambda h: h['x'])
    clusters: list[list[dict]] = []
    for h in hits:
        # two different specific words (State, TOC) are two columns however close
        specific_clash = h['prio'] <= 1 and any(c['prio'] <= 1 and c['field'] != h['field'] for c in clusters[-1]) if clusters else False
        if clusters and h['x'] - clusters[-1][-1]['x'] <= 9 and not specific_clash:
            clusters[-1].append(h)
        else:
            clusters.append([h])
    return [(sum(h['x'] for h in c) / len(c), min(c, key=lambda h: h['prio'])['field']) for c in clusters]


def parse_document(text: str, wrap: str = 'below') -> dict:
    title_lines: list[str] = []
    rows: list[dict] = []
    totals: list[dict] = []
    labels: list[str] | None = None
    ref_money: list[tuple[float, str]] = []
    for page in text.split('\f'):
        lines = page.split('\n')
        anchors = [i for i, ln in enumerate(lines) if is_anchor(ln)]
        if not anchors:
            continue
        heads = header_lines(lines, anchors[0])
        cols = split_by_headings(find_columns(lines, anchors), lines, heads)
        page_labels = [''] * len(cols)
        head_toks = [t for h in heads for t in tokens(lines[h])]
        overlaps = lambda a, b: 2 * (min(a['end'], b['end']) - max(a['start'], b['start'])) >= a['end'] - a['start']
        on_col = lambda t: any(min(t['end'], e) - max(t['start'], s) > 0 for s, e in cols)
        for h in heads:
            line_toks = tokens(lines[h])
            for j, t in enumerate(line_toks):
                ci = column_of(t, cols)
                nxt = line_toks[j + 1] if j + 1 < len(line_toks) else None
                if not on_col(t) and nxt and nxt['start'] == t['end'] + 1 and on_col(nxt):
                    # the first word of a heading phrase ("LI Units") goes with the rest of it
                    ci = column_of(nxt, cols)
                elif not on_col(t):
                    # a heading word in a gutter ("Total / TC Units") belongs with
                    # the heading word stacked over or under it, when at least half of it is
                    stacked = [u for u in head_toks if u is not t and overlaps(t, u) and on_col(u)]
                    if stacked:
                        ci = column_of(stacked[0], cols)
                    elif ci + 1 < len(cols):
                        # exactly mid-gutter, it heads the right-aligned numbers to its right
                        centre = (t['start'] + t['end']) / 2
                        if centre - cols[ci][1] == cols[ci + 1][0] - centre:
                            ci += 1
                page_labels[ci] = (page_labels[ci] + ' ' + t['text']).strip()
        if labels is None:
            title_lines = [ln.strip() for ln in lines[:heads[0] if heads else anchors[0]] if ln.strip()][:4]
        # a page without its own headings reuses the first page's labels by position
        if sum(1 for l in page_labels if l) < 3 and labels is not None:
            page_labels = labels[:len(cols)] + [''] * max(0, len(cols) - len(labels))
        labels = labels or page_labels
        # money columns named by order when the headings name exactly as many
        money_cols = sorted({column_of(t, cols) for a in anchors for t in tokens(lines[a]) if t['money']})
        keys = money_headings(lines, heads)
        centre = lambda ci: (cols[ci][0] + cols[ci][1]) / 2
        if keys and len(keys) == len(money_cols):
            money_fields = {ci: k[1] for ci, k in zip(money_cols, keys)}
            ref_money = [(centre(ci), k[1]) for ci, k in zip(money_cols, keys)]
        elif ref_money:
            # a page with fewer amounts than an earlier page that lined up: each
            # amount takes the field of the nearest amount column on that page
            money_fields = {ci: min(ref_money, key=lambda k: abs(k[0] - centre(ci)))[1] for ci in money_cols}
        else:
            money_fields = {}
        skip = set(heads)
        records: dict[int, list[tuple[int, str]]] = {a: [] for a in anchors}
        for i, ln in enumerate(lines):
            if not ln.strip() or i in skip:
                continue
            if i in records:
                records[i].append((0, ln))
                continue
            footnote_total = STOP_LINE.match(ln) and any(t['money'] for t in tokens(ln))
            if is_total(ln) or footnote_total:
                totals.append({'line': ln.strip(), 'tokens': tokens(ln), 'cols': cols, 'labels': page_labels,
                               'money_fields': money_fields,
                               'rows_before': len(rows) + sum(1 for a in anchors if a < i)})
                continue
            # an abbreviation key ("N=New Construction, A/R=Acquisition/Rehab")
            if len(re.findall(r'\b[A-Z][A-Za-z/]{0,3}=\w', ln)) >= 2:
                continue
            if TOTAL_LINE.match(ln.strip()) or STOP_LINE.match(ln) or SECTION_LINE.match(ln) or i < anchors[0] - 3:
                continue
            # a wrapped cell belongs to the nearest data row. A line exactly between
            # two rows goes to the row below or above depending on which way this
            # document wraps its cells (build() tries both and keeps the better)
            near = min(anchors, key=lambda a: (abs(a - i), (0 if a > i else 1) if wrap == 'below' else (0 if a < i else 1)))
            if abs(near - i) <= 3:
                records[near].append((i - near, ln))
        for a in anchors:
            cells: dict[int, list[str]] = {}
            moneys: dict[int, int] = {}
            for _off, ln in sorted(records[a], key=lambda x: x[0]):
                for t in tokens(ln):
                    ci = column_of(t, cols)
                    if t['money']:
                        v = money_value(t['text'])
                        if v is not None:
                            moneys[ci] = moneys.get(ci, 0) + v
                    else:
                        cells.setdefault(ci, []).append(t['text'])
            rows.append({'cells': cells, 'moneys': moneys, 'labels': page_labels, 'money_fields': money_fields})
    return {'title': title_lines, 'labels': labels or [], 'rows': rows, 'totals': totals}


FIELD_RULES = [
    # (field, test on the lower-cased column label); first match wins
    ('ignore', lambda l: any(k in l for k in ('contact', 'phone', 'email', 'first', 'zip', 'jobs', 'last name'))),
    ('county_city', lambda l: 'county-city' in l),
    ('award_year', lambda l: 'year' in l),
    ('sponsor', lambda l: any(k in l for k in ('sponsor', 'borrower', 'owner', 'ownership'))),
    ('address', lambda l: 'address' in l),
    ('county', lambda l: l.strip() == 'county'),
    ('location', lambda l: 'city' in l or 'location' in l),
    ('name', lambda l: 'name' in l),
    ('detail', lambda l: any(k in l for k in ('program', 'option', 'election', 'purpose', 'use of funds', 'type of housing'))),
    ('type', lambda l: 'type' in l or 'target' in l),
]

MONEY_RULES = [
    ('toc_credit', lambda l: 'toc' in l),
    ('mihtc_credit', lambda l: 'mihtc' in l or 'middle' in l),
    ('state_credit', lambda l: 'state' in l),
    ('bond_amount', lambda l: 'bond' in l),
    ('federal_credit', lambda l: 'federal' in l or '9%' in l or '4%' in l or 'credit' in l),
    ('amount_requested', lambda l: 'request' in l and 'award' not in l),
    ('amount_awarded', lambda l: True),
]

UNIT_RULES = [
    ('restricted_units', lambda l: re.search(r'\b(li|tc|income|affordable|mihtc)\b', l) is not None),
    # "Estimated Unit Count" wraps so "Unit" can join the heading beside it
    ('total_units', lambda l: 'unit' in l or re.search(r'\bcount\b', l) is not None),
]


def label_field(label: str, money: bool) -> str | None:
    l = label.lower()
    if money:
        # a heading over both "requested" and "awarded" columns names the later one
        for f, test in MONEY_RULES:
            if test(l):
                return f
    for f, test in UNIT_RULES:
        if test(l):
            return f
    for f, test in FIELD_RULES:
        if test(l):
            return f
    return None


def to_records(parsed: dict) -> list[dict]:
    out = []
    for r in parsed['rows']:
        rec: dict = {}
        cells = {ci: list(parts) for ci, parts in r['cells'].items()}
        is_units = lambda ci: ci < len(r['labels']) and label_field(r['labels'][ci], False) in ('total_units', 'restricted_units')
        for ci in list(cells) + [ci for ci in range(len(r['labels'])) if ci not in cells]:
            # a row printed a few characters right of the others pushes its count
            # into the text column beside it ("68 City and County of Denver")
            right = cells.get(ci + 1)
            if is_units(ci) and not cells.get(ci) and right and not is_units(ci + 1) \
                    and label_field(r['labels'][ci + 1], False) not in ('address', 'ignore'):
                n = next((w for w in right if INT.match(w) and (int_value(w) or 0) < 5000), None)
                if n is not None:
                    right.remove(n)
                    cells[ci] = [n]
        for ci, parts in cells.items():
            label = r['labels'][ci] if ci < len(r['labels']) else ''
            text = ' '.join(parts).strip()
            field = label_field(label, False)
            if field in ('total_units', 'restricted_units') and re.search(r'[A-Za-z]', text):
                # a heading run together with its neighbour ("Units* Owner Name"):
                # words in a units column belong to the other heading
                l = label.lower()
                field = next((f for f, test in FIELD_RULES if test(l)), None)
                text = re.sub(r'^\d[\d,]*\s+', '', text)
            if field in ('total_units', 'restricted_units'):
                nums = [int_value(t) for t in re.findall(r'\d[\d,]*', text)]
                # a Colorado zip code (80xxx/81xxx) run into a units column is not a unit count
                nums = [n for n in nums if n is not None and n < 5000]
                # the leftmost units column of each kind wins; a parent row's
                # sub-rows (scattered sites) are summed within the column
                if nums and field not in rec:
                    rec[field] = sum(nums)
                continue
            if field and field != 'ignore':
                rec[field] = (rec.get(field, '') + ' ' + text).strip()
        for ci, v in r['moneys'].items():
            label = r['labels'][ci] if ci < len(r['labels']) else ''
            field = r['money_fields'].get(ci) or label_field(label, True)
            rec[field] = rec.get(field, 0) + v
        out.append(rec)
    return out


def reconcile(parsed: dict, records: list[dict]) -> dict:
    """Compare each money column's parsed sum with the PDF's own total line."""
    grand = [t for t in parsed['totals'] if re.search(r'grand\s+total', t['line'], re.I)]
    plain = [t for t in parsed['totals'] if not re.search(r'average|grand', t['line'], re.I)]
    use = grand or plain
    if not use:
        return {'status': 'no_total_line', 'checks': [], 'rows_checked': 0}
    # a total covers the rows printed above it; rows printed after the last
    # total (a separate 4% section, say) are not checked by it
    covered = max(t['rows_before'] for t in use)
    expected: dict[str, int] = {}
    for t in use:
        for tok in t['tokens']:
            if not tok['money']:
                continue
            ci = column_of(tok, t['cols'])
            field = (t['money_fields'] or {}).get(ci) or label_field(t['labels'][ci] if ci < len(t['labels']) else '', True)
            expected[field] = expected.get(field, 0) + (money_value(tok['text']) or 0)
    # unit totals printed on the same line ("Total $ 27,339,500   619")
    unit_expected: dict[str, int] = {}
    for t in use:
        seen: set[str] = set()
        for tok in t['tokens']:
            if tok['money']:
                continue
            ci = column_of(tok, t['cols'])
            field = label_field(t['labels'][ci] if ci < len(t['labels']) else '', False)
            n = int_value(tok['text'])
            # the leftmost units column of each kind is the one to_records keeps
            if field in ('total_units', 'restricted_units') and n is not None and field not in seen:
                seen.add(field)
                unit_expected[field] = unit_expected.get(field, 0) + n
    checks = []
    for field, want in sorted(unit_expected.items()):
        got = sum(r.get(field, 0) or 0 for r in records[:covered])
        checks.append({'field': field, 'pdf_total': want, 'parsed_total': got, 'ok': got == want})
    for field, want in sorted(expected.items()):
        got = sum(r.get(field, 0) or 0 for r in records[:covered])
        # the PDFs sum unrounded cents, so allow a dollar of rounding per row
        checks.append({'field': field, 'pdf_total': want, 'parsed_total': got,
                       'ok': abs(got - want) <= max(1, len(records))})
    m = re.search(r'TOTAL SELECTIONS:\s*(\d+)', ' '.join(t['line'] for t in parsed['totals']), re.I)
    if m:
        checks.append({'field': 'row_count', 'pdf_total': int(m.group(1)), 'parsed_total': len(records),
                       'ok': int(m.group(1)) == len(records)})
    return {'status': 'ok' if all(c['ok'] for c in checks) else 'mismatch', 'checks': checks,
            'rows_checked': covered}


# ── classification ───────────────────────────────────────────────────────────

def doc_meta(doc: dict, title: list[str]) -> dict:
    name = doc['file']
    t = ' '.join(title) + ' ' + name
    m = re.search(r'(20\d\d)', name) or re.search(r'(20\d\d)', t)
    meta = {'year': int(m.group(1)) if m else None}
    if doc['program_family'] == 'housing-tax-credit':
        rnd = re.search(r'round[\s-]*(one|two|1|2)', t, re.I)
        meta['round'] = {'one': 1, 'two': 2}.get(rnd.group(1).lower(), int(rnd.group(1)) if rnd and rnd.group(1).isdigit() else None) if rnd else None
        if re.search(r'mihtc|middle', t, re.I):
            meta['program'] = 'MIHTC'
        elif re.search(r'\b4\s*%|4-and|4-state|federal-4|4% federal', t, re.I) and not re.search(r'9\s*%', t):
            meta['program'] = 'LIHTC 4% + state'
        else:
            meta['program'] = 'LIHTC 9% + state'
        # the fiscal year is the award year for tax credits
    else:
        fy = re.search(r'FY\s*(\d\d)[-–](\d\d)', t)
        meta['fiscal_year'] = f'FY{fy.group(1)}-{fy.group(2)}' if fy else None
        meta['year'] = 2000 + int(fy.group(1)) if fy else meta['year']
        if re.search(r'land\s*banking', t, re.I):
            meta['program'] = 'Prop 123 Land Banking'
        elif re.search(r'equity', t, re.I):
            meta['program'] = 'Prop 123 Equity'
        elif re.search(r'modular', t, re.I):
            meta['program'] = 'Prop 123 Modular Finance'
        else:
            meta['program'] = 'Prop 123 Concessionary Debt'
        meta['round'] = None
    return meta


def norm(s: str) -> str:
    s = s.lower().replace('ñ', 'n')
    s = re.sub(r'\((?:town|city|cdp)\)|\b(city|town|county|of|the|and)\b', ' ', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def load_geo() -> tuple[dict, dict]:
    geo = read_json(GEO_CONFIG)
    counties = {norm(c['label']): c['geoid'] for c in geo['counties']}
    places: dict[str, set] = {}
    for p in geo['places'] + geo['cdps']:
        places.setdefault(norm(p['label']), set()).add(p['containingCounty'])
    # cities the LIHTC feed has placed in a county (covers unincorporated names)
    try:
        feed = read_json(LIHTC_FEED)['features']
        tally: dict[str, dict] = {}
        for f in feed:
            pr = f.get('properties') or {}
            if pr.get('PROJ_CTY') and pr.get('CNTY_FIPS'):
                t = tally.setdefault(norm(pr['PROJ_CTY']), {})
                t[pr['CNTY_FIPS']] = t.get(pr['CNTY_FIPS'], 0) + 1
        for city, t in tally.items():
            if city not in places:
                places[city] = {max(t, key=t.get)}
    except (OSError, KeyError, ValueError):
        pass  # no feed: places come from geo-config alone, and fewer rows are placed
    return counties, places


def lihtc_names() -> dict:
    out: dict[str, str] = {}
    try:
        for f in read_json(LIHTC_FEED)['features']:
            pr = f.get('properties') or {}
            for k in ('PROJECT', 'ReportedName'):
                if pr.get(k) and pr.get('CNTY_FIPS'):
                    out.setdefault(norm(pr[k]), pr['CNTY_FIPS'])
    except (OSError, KeyError, ValueError):
        pass  # no feed: project names cannot place rows, so locations are used instead
    return out


def assign_county(rec: dict, counties: dict, places: dict, names: dict) -> None:
    rec['county_fips'] = None
    if rec.get('county'):
        f = counties.get(norm(rec['county']))
        if f:
            rec['county_fips'], rec['county_method'] = f, 'county column'
            return
    loc = rec.get('location') or ''
    if rec.get('county_city'):
        cty, _, city = rec['county_city'].partition(' - ')
        f = counties.get(norm(cty.replace('Chafee', 'Chaffee')))
        if f:
            rec['county_fips'], rec['county_method'] = f, 'county column'
            return
        loc = city
    if rec.get('name') and norm(rec['name']) in names:
        rec['county_fips'], rec['county_method'] = names[norm(rec['name'])], 'LIHTC feed project name'
        return
    # several towns in one cell ("Trinidad, Walsenburg, Fort Garland"): one
    # county only if every town is in it, else the award spans counties
    parts = [norm(p) for p in re.split(r',|;| and ', loc) if p.strip()]
    if len(parts) > 1:
        found = set()
        for part in parts:
            h = places.get(part)
            if not h or len(h) != 1:
                found = None
                break
            found |= set(h)
        if found and len(found) == 1:
            rec['county_fips'], rec['county_method'] = next(iter(found)), 'every listed place is in one county'
            return
        if found:
            rec['county_unavailable_reason'] = f'"{loc}" spans {len(found)} counties'
            return
    key = norm(loc)
    if key in counties and 'county' in loc.lower():
        rec['county_fips'], rec['county_method'] = counties[key], 'location names a county'
        return
    hits = places.get(key)
    if hits and len(hits) == 1:
        rec['county_fips'], rec['county_method'] = next(iter(hits)), 'location matched to a place'
        return
    if key in counties:
        rec['county_fips'], rec['county_method'] = counties[key], 'location names a county'
        return
    # a wrapped neighbouring cell can prefix the city ("Dr. Pagosa Springs"):
    # try the location's trailing words, longest first
    words = key.split()
    for n in range(len(words) - 1, 0, -1):
        tail = ' '.join(words[-n:])
        hits_tail = places.get(tail)
        if hits_tail and len(hits_tail) == 1:
            rec['county_fips'], rec['county_method'] = next(iter(hits_tail)), 'end of location matched to a place'
            return
    rec['county_unavailable_reason'] = (
        f'"{loc}" matches places in more than one county' if hits else
        f'"{loc}" is not a Colorado place or county this site knows' if loc else 'no location printed')


# ── main ─────────────────────────────────────────────────────────────────────

AMOUNT_FIELDS = ('federal_credit', 'state_credit', 'toc_credit', 'mihtc_credit',
                 'amount_awarded', 'amount_requested', 'bond_amount')


# units_withheld: every dollar column adds up to the PDF's totals but a units
# column does not; the awards stand and that document's unit counts are null
USABLE = ('ok', 'no_total_line', 'accepted_by_review', 'units_withheld')
UNIT_FIELDS = ('total_units', 'restricted_units')
# The analysis window. CHFA's 2015 reports are parsed and listed in
# documents.json, but two versions of the 2015 4% report disagree with each
# other, so the ledger starts the year after.
FIRST_YEAR = 2016


def build(docs: list[dict], cache: str) -> tuple[list[dict], list[dict]]:
    global SENSITIVE
    SENSITIVE = sensitive_patterns()
    counties, places = load_geo()
    try:
        overrides = read_json(OVERRIDES).get('documents', {})
    except (OSError, ValueError):
        overrides = {}
    names = lihtc_names()
    ledger, statuses = [], []
    for doc in docs:
        path = os.path.join(cache, doc['file'])
        status = {'file': doc['file'], 'url': doc['url'], 'agency': doc['agency'],
                  'program_family': doc['program_family']}
        try:
            if not os.path.exists(path):
                with open(path, 'wb') as fh:
                    fh.write(http_get(doc['url']))
            with open(path, 'rb') as fh:
                raw = fh.read()
            status['sha256'] = hashlib.sha256(raw).hexdigest()
            text = pdf_text(path)
            # cells wrap up in some reports and down in others: keep the reading
            # whose rows resolve to more Colorado counties
            best = None
            for wrap in ('below', 'above'):
                cand = parse_document(text, wrap)
                recs = to_records(cand)
                score = 0
                for r in recs:
                    probe = dict(r)
                    assign_county(probe, counties, places, names)
                    score += probe['county_fips'] is not None
                    loc = norm(r.get('location') or '')
                    score += bool(loc) and (loc in places or loc in counties)
                if best is None or score > best[0]:
                    best = (score, cand)
            parsed = best[1]
        except Exception as exc:  # network, not-a-PDF, poppler failure
            status.update(status='error', error=f'{exc.__class__.__name__}: {exc}')
            statuses.append(status)
            continue
        meta = doc_meta(doc, parsed['title'])
        records = to_records(parsed)
        rec_check = reconcile(parsed, records)
        status.update(meta, title=' | '.join(parsed['title']), rows=len(records), **rec_check)
        unnamed = sum(1 for r in records if not (r.get('name') or r.get('sponsor')))
        failed = [c['field'] for c in status.get('checks', []) if not c['ok']]
        if status['status'] == 'mismatch' and failed and all(f in UNIT_FIELDS for f in failed):
            status['status'], status['units_withheld'] = 'units_withheld', failed
        if not records:
            status['status'] = 'no_rows'
        elif unnamed:
            status['status'], status['unnamed_rows'] = 'unnamed_rows', unnamed
        review = overrides.get(doc['file'])
        if status['status'] not in USABLE and review and review.get('sha256') == status.get('sha256'):
            # a person checked this exact file and recorded why its rows stand
            status['parser_status'], status['status'] = status['status'], 'accepted_by_review'
            status['review'] = {k: review.get(k) for k in ('reason', 'reviewed_by', 'reviewed_at')}
        statuses.append(status)
        if status['status'] not in USABLE:
            continue
        for idx, r in enumerate(records):
            assign_county(r, counties, places, names)
            if meta['program'] == 'Prop 123 Modular Finance':
                # factory and working-capital finance: no housing site to place
                r['county_fips'], r['county_method'] = None, None
                r['county_unavailable_reason'] = 'modular factory financing, not a housing site'
            year = int_value(r.get('award_year') or '') if r.get('award_year') else None
            year = year if year and 1985 < year < 2100 else meta['year']
            if year is None or year < FIRST_YEAR:
                continue
            row = {
                'agency': doc['agency'], 'program': meta['program'], 'year': year,
                'round': meta.get('round'), 'fiscal_year': meta.get('fiscal_year'),
                'name': r.get('name'), 'sponsor': r.get('sponsor'),
                'location': (r.get('location') or (r.get('county_city') or '').partition(' - ')[2] or None),
                'county_fips': r['county_fips'],
                'total_units': r.get('total_units'), 'restricted_units': r.get('restricted_units'),
                'detail': r.get('detail'),
                'source_file': doc['file'], 'source_url': doc['url'],
                'reconciled': status['status'] in ('ok', 'units_withheld') and idx < status.get('rows_checked', 0),
            }
            for f in AMOUNT_FIELDS:
                row[f] = r.get(f)
            if doc['program_family'] == 'housing-tax-credit':
                # a tax-credit report's one unnamed amount ("Credit Amount Requested",
                # "Credit Amount Awarded") is the federal credit
                for f in ('amount_awarded', 'amount_requested'):
                    if row[f] is not None and row['federal_credit'] is None and meta['program'] != 'MIHTC':
                        row['federal_credit'] = row[f]
                    if row[f] is not None and row['mihtc_credit'] is None and meta['program'] == 'MIHTC':
                        row['mihtc_credit'] = row[f]
                    row[f] = None
            if meta['program'].startswith('LIHTC') or meta['program'] == 'MIHTC':
                row['federal_credit_type'] = ('4%' if '4%' in meta['program'] else
                                              'MIHTC' if meta['program'] == 'MIHTC' else '9%')
            for f in status.get('units_withheld', []):
                row[f] = None
                row[f + '_unavailable_reason'] = "this document's units column does not add up to the total it prints"
            tu, ru = row['total_units'], row['restricted_units']
            if ru is not None and ((tu is not None and ru > tu) or (tu is None and ru > 1000)):
                # more restricted units than units: two columns ran together
                row['restricted_units'] = None
                row['restricted_units_unavailable_reason'] = f'parsed value {ru} exceeds the unit count; columns ran together'
            if r.get('county_method'):
                row['county_method'] = r['county_method']
            if r.get('county_unavailable_reason'):
                row['county_unavailable_reason'] = r['county_unavailable_reason']
            for field in ('name', 'sponsor', 'location', 'detail'):
                if row.get(field) and any(p.search(row[field]) for p in SENSITIVE):
                    # the award stands; only the text is kept off the public site
                    row[field] = None
                    row[f'{field}_unavailable_reason'] = 'withheld: matches text the public build excludes'
            ledger.append(row)
    return ledger, statuses


ISSUE_LABEL = 'funding-awards'


def github(method: str, path: str, body: dict | None = None):
    token, repo = os.environ.get('GITHUB_TOKEN'), os.environ.get('GITHUB_REPOSITORY')
    if not token or not repo:
        raise RuntimeError('GITHUB_TOKEN and GITHUB_REPOSITORY are required to open issues')
    req = urllib.request.Request(
        f'https://api.github.com/repos/{repo}/{path}', method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
                 'User-Agent': UA, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read() or b'null')


def issue_body(s: dict) -> str:
    units_only = s['status'] == 'units_withheld'
    lead = (f"The weekly award parser could not read the unit counts in **{s['file']}**." if units_only
            else f"The weekly award parser could not use **{s['file']}**.")
    lines = [lead, '',
             f"- Source: {s['url']}", f"- Agency: {s['agency']}", f"- Parser status: `{s['status']}`"]
    if s.get('error'):
        lines.append(f"- Error: `{s['error']}`")
    for c in s.get('checks', []):
        if not c['ok']:
            lines.append(f"- `{c['field']}`: the PDF's total is {c['pdf_total']:,}, the parsed rows add up to {c['parsed_total']:,}")
    if s.get('unnamed_rows'):
        lines.append(f"- {s['unnamed_rows']} rows carry an amount but no project or sponsor name")
    kept = ("Its awards and dollars are in `data/policy/funding-awards/ledger.json`, but their unit counts are "
            "null until this is resolved. Either:" if units_only else
            'Its rows are left out of `data/policy/funding-awards/ledger.json` until this is resolved. Either:')
    lines += ['', kept,
              '1. fix the parser in `scripts/funding/build_funding_awards.py` so the rows add up to the total, or',
              ("2. check the rows by hand and add the file to `data/policy/funding-awards/reviewed-documents.json` "
               + "with its sha256, the reason and who reviewed it."), '',
              f"sha256: `{s.get('sha256', 'not downloaded')}`"]
    return '\n'.join(lines)


def open_issues(statuses: list[dict], discovery: list[dict], dry_run: bool, missing: list[str] = ()) -> None:
    wanted = [(f"Award PDF needs a person: {s['file']}", issue_body(s))
              for s in statuses if s['status'] not in USABLE or s['status'] == 'units_withheld']
    wanted += [(f"Award list page unreachable: {d['index_url']}",
                f"The weekly award parser could not read {d['index_url']}: `{d.get('error')}`")
               for d in discovery if d['status'] != 'ok']
    wanted += [(f"Award PDF no longer listed: {f}",
                f"**{f}** was in `data/policy/funding-awards/documents.json` but the list pages no longer "
                "link it. The ledger was left as it is so its awards are not silently dropped. If the agency "
                "renamed or moved the file, add the new name to the parser's sources; if it was withdrawn on "
                "purpose, remove its entry from documents.json by hand.")
               for f in missing]
    if not wanted:
        print('No issues to open.')
        return
    existing = set()
    if not dry_run:
        for issue in github('GET', f'issues?state=open&labels={ISSUE_LABEL}&per_page=100') or []:
            existing.add(issue['title'])
    for title, body in wanted:
        if title in existing:
            print(f'open already: {title}')
        elif dry_run:
            print(f'would open: {title}')
        else:
            github('POST', 'issues', {'title': title, 'body': body, 'labels': [ISSUE_LABEL]})
            print(f'opened: {title}')


def missing_documents(prior_path: str, docs: list[dict]) -> list[str]:
    """Documents recorded last time that no list page links now. Writing the
    ledger without them would drop their awards without anyone deciding to."""
    if not os.path.exists(prior_path):
        return []
    try:
        prior = [d['file'] for d in read_json(prior_path).get('documents', [])]
    except ValueError:
        return []
    found = {d['file'] for d in docs}
    return sorted(f for f in prior if f not in found)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--cache', help='directory to keep downloaded PDFs (default: a temp dir)')
    ap.add_argument('--check', action='store_true', help='parse and report; write nothing')
    ap.add_argument('--open-issues', action='store_true',
                    help='open a GitHub issue for each document the parser could not use')
    ap.add_argument('--dry-run', action='store_true', help='with --open-issues, print instead of opening')
    args = ap.parse_args()
    cache = args.cache or tempfile.mkdtemp(prefix='funding-awards-')
    os.makedirs(cache, exist_ok=True)

    docs, discovery = [], []
    for src in SOURCES:
        try:
            found = discover(src)
            discovery.append({'index_url': src['index_url'], 'documents': len(found), 'status': 'ok'})
            docs.extend(found)
        except Exception as exc:
            discovery.append({'index_url': src['index_url'], 'status': 'error',
                              'error': f'{exc.__class__.__name__}: {exc}'})
    if not docs:
        print('No award documents discovered; leaving the ledger as it is.', file=sys.stderr)
        print(json.dumps(discovery, indent=2))
        return 1

    ledger, statuses = build(docs, cache)
    ledger.sort(key=lambda r: (r['year'] or 0, r['agency'], r['program'], r['name'] or ''))
    statuses.sort(key=lambda s: (s['agency'], s.get('year') or 0, s['file']))
    for s in statuses:
        print(f"{s['status']:<14} {s.get('rows', 0):>3} rows  {s['file']}")
    bad = [s for s in statuses if s['status'] not in USABLE]
    print(f'{len(ledger)} awards from {len(statuses) - len(bad)} documents; {len(bad)} documents need a person')
    missing = missing_documents(DOCUMENTS, docs)
    if args.open_issues:
        open_issues(statuses, discovery, args.dry_run, missing)
    if args.check:
        return 0
    if any(d['status'] != 'ok' for d in discovery):
        # Writing now would drop every award from the unreachable list page
        # and make its agency look unfunded. Keep the last good ledger; the
        # issue opened above is the alert.
        print('An award list page was unreachable; leaving the ledger as it is.', file=sys.stderr)
        return 0
    if missing:
        print(f"{len(missing)} previously recorded documents are no longer listed ({', '.join(missing)}); "
              'leaving the ledger as it is.', file=sys.stderr)
        return 0

    now = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    os.makedirs(OUT_DIR, exist_ok=True)
    prior = {}
    if os.path.exists(LEDGER):
        try:
            prior = read_json(LEDGER)
        except ValueError:
            prior = {}
    if prior.get('awards') == ledger:
        now = prior.get('meta', {}).get('generated_at', now)
    meta = {
        'generated_at': now,
        'generator': 'scripts/funding/build_funding_awards.py',
        'sources': [s['index_url'] for s in SOURCES],
        'method': ('Each award PDF is read with pdftotext -layout; every value is mapped to the column '
                   'heading printed above it, and the parsed rows are checked against the TOTAL line the '
                   'PDF prints, dollars and unit counts alike. Only documents whose rows add up to their totals '
                   '(status ok), or that print no total (status no_total_line), contribute rows; a document '
                   'whose dollars add up but whose units column does not (status units_withheld) contributes '
                   'its awards with those unit counts null.'),
        'amount_note': ('federal_credit, state_credit, toc_credit and mihtc_credit are the ANNUAL credit '
                        'amounts CHFA prints, not the 10-year total. amount_awarded and amount_requested are '
                        'Prop 123 dollars; preliminary selection lists print only the amount requested.'),
        'county_note': ('county_fips comes from a County column when the PDF prints one, then from the CHFA '
                        'LIHTC feed by project name, then from the location matched to a Colorado place. '
                        'A location in more than one county is left null with the reason.'),
        'award_count': len(ledger),
        'document_count': len(statuses),
    }
    with open(LEDGER, 'w') as fh:
        json.dump({'meta': meta, 'awards': ledger}, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    with open(DOCUMENTS, 'w') as fh:
        json.dump({'meta': {'generated_at': meta['generated_at'], 'discovery': discovery},
                   'documents': statuses}, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
