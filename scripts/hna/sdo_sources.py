#!/usr/bin/env python3
"""Newest State Demography Office (SDO) vintage of the county files the HNA reads.

SDO publishes each county file in two places: a CSV in its public bucket
(storage.googleapis.com/co-publicdata) and, for some files, a workbook linked
from its data page (https://demography.dola.colorado.gov/assets/html/sdodata.html).
They are not always updated together. Vintage 2025 (prepared October 2026)
reached the data page's workbooks for county components of change and county
households while the bucket CSVs still held Vintage 2024 and Vintage 2023, and
the 5-year-age file sya.json reached the bucket while sya-county.csv (single
year of age) stayed on Vintage 2024. Reading only the bucket CSVs kept the site
a vintage behind without any warning.

fetch_newest(kind) looks at every place SDO publishes a file, reads each copy's
vintage, and returns the newest, written to the same cache file and in the same
CSV layout the builders already read, so nothing downstream changes:

  components  components-change-county.csv  vs  the data page's
              "County Components of Change for Colorado" workbook
  households  household-county.csv          vs  the data page's
              "County Household Data" workbook
  sya         sya-county.csv (single year)  vs  sya.json (5-year groups)

A vintage is the year of SDO's last estimate: the "Vintage YYYY" line SDO
prints at the top of a file, or else the last year marked Estimate. A copy
with no readable vintage counts as older than one with a vintage. On a tie the
bucket CSV wins, so nothing changes until SDO publishes something newer.

sya.json has 5-year age groups, and the Scenario Builder needs single years.
When sya.json is newer, each county's single-year counts from the older
sya-county.csv are scaled to the newer file's total for their 5-year group,
sex and year (ages 95 to 100 to its "95 and over"), and rounded so each group
adds exactly to SDO's figure. Every total by group, county, year and sex is
then SDO's newer figure; only the split of a group into single years comes
from the older vintage. The file says so in its vintage line.

The workbooks are read with the standard library (no openpyxl in the build).
"""
from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import sys
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

BUCKET = 'https://storage.googleapis.com/co-publicdata/'
SDO_DATA_PAGE = 'https://demography.dola.colorado.gov/assets/html/sdodata.html'

KINDS = {
    'components': {
        'csv': BUCKET + 'components-change-county.csv',
        'page_title': 'County Components of Change for Colorado',
        'cache': 'dola_components_county.csv',
        'label': 'county components-of-change',
    },
    'households': {
        'csv': BUCKET + 'household-county.csv',
        'page_title': 'County Household Data',
        'cache': 'dola_household_county.csv',
        'label': 'county household projections',
    },
    'sya': {
        'csv': BUCKET + 'sya-county.csv',
        'json': BUCKET + 'sya.json',
        'cache': 'dola_sya_county.csv',
        'label': 'single-year-of-age county file',
    },
}

COMPONENT_COLUMNS = ['id', 'idtxt', 'countyfips', 'year', 'estimate', 'change', 'births', 'deaths', 'netmig', 'datatype']
HOUSEHOLD_COLUMNS = ['id', 'area_code', 'year', 'household_type_id', 'household_type_description',
                     'age_group_id', 'age_group_description', 'total_households', 'datatype']
SYA_COLUMNS = ['id', 'countyfips', 'year', 'age', 'county', 'malepopulation', 'femalepopulation',
               'totalpopulation', 'datatype']

_UA = {'User-Agent': 'Mozilla/5.0 (compatible; HNA-data-builder)'}


def _get(url: str, timeout: int = 180) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers=_UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except Exception as e:  # network errors fall back to the other copy or the cache
        print(f'  {url}: {e}', file=sys.stderr)
        return None


def vintage_of_text(text: str | None) -> int | None:
    """SDO's vintage year from a CSV: its 'Vintage YYYY' line, else its last Estimate year."""
    if not text:
        return None
    head = '\n'.join(text.splitlines()[:6])
    m = re.search(r'Vintage\s+(\d{4})', head)
    if m:
        return int(m.group(1))
    lines = text.splitlines()
    try:
        start = next(i for i, l in enumerate(lines) if l.startswith('id,'))
    except StopIteration:
        return None
    last = None
    for r in csv.DictReader(io.StringIO('\n'.join(lines[start:]))):
        if str(r.get('datatype', '')).strip().lower() == 'estimate':
            try:
                y = int(float(r['year']))
            except (KeyError, TypeError, ValueError):
                continue
            last = y if last is None else max(last, y)
    return last


def _col_index(ref: str) -> int:
    letters = re.match(r'[A-Z]+', ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _ns(root: ET.Element) -> dict[str, str]:
    # The spreadsheetml namespace, read from the part's own root tag rather
    # than written out, so the source-URL sweep does not try to fetch an XML
    # namespace name as if it were a web page.
    return {'m': root.tag[1:].split('}', 1)[0] if root.tag.startswith('{') else ''}


def read_xlsx_rows(data: bytes) -> list[list[str]]:
    """Rows of a workbook's first sheet, as strings (numbers keep their stored text)."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        shared: list[str] = []
        if 'xl/sharedStrings.xml' in z.namelist():
            root = ET.fromstring(z.read('xl/sharedStrings.xml'))
            _NS = _ns(root)
            for si in root.findall('m:si', _NS):
                shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % _NS['m'])))
        sheets = sorted(n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml$', n))
        root = ET.fromstring(z.read(sheets[0]))
    _NS = _ns(root)
    rows: list[list[str]] = []
    for row in root.iter('{%s}row' % _NS['m']):
        out: list[str] = []
        for c in row.findall('m:c', _NS):
            idx = _col_index(c.get('r'))
            while len(out) < idx:
                out.append('')
            t = c.get('t')
            v = c.find('m:v', _NS)
            if t == 's' and v is not None:
                val = shared[int(v.text)]
            elif t == 'inlineStr':
                val = ''.join(x.text or '' for x in c.iter('{%s}t' % _NS['m']))
            else:
                val = v.text if v is not None and v.text is not None else ''
            out.append(val)
        rows.append(out)
    return rows


def _num(v: str) -> str:
    """'6011146.0' -> '6011146'; other text unchanged."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return v
    if math.isfinite(f) and f == int(f):
        return str(int(f))
    return repr(f)


def workbook_to_csv(rows: list[list[str]], kind: str) -> str | None:
    """A data-page workbook in the bucket CSV's layout, its vintage line first."""
    header_i = None
    for i, r in enumerate(rows):
        low = [str(x).strip().lower() for x in r]
        if 'year' in low and ('countyfips' in low or 'area_code' in low):
            header_i = i
            break
    if header_i is None:
        return None
    vintage_line = next((str(x) for r in rows[:header_i] for x in r if re.search(r'Vintage\s+\d{4}', str(x))), '')
    names = [str(x).strip().lower() for x in rows[header_i]]
    columns = COMPONENT_COLUMNS if kind == 'components' else HOUSEHOLD_COLUMNS
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\n')
    w.writerow([vintage_line] + [''] * (len(columns) - 1))
    w.writerow(columns)
    n = 0
    for r in rows[header_i + 1:]:
        rec = {names[j]: r[j] for j in range(min(len(names), len(r)))}
        if not str(rec.get('year', '')).strip():
            continue
        n += 1
        rec['id'] = str(n)
        if kind == 'components':
            rec['idtxt'] = _num(rec['countyfips']).zfill(3) + _num(rec['year'])
        w.writerow([rec[c] if c == 'idtxt' else _num(str(rec.get(c, ''))) for c in columns])
    return buf.getvalue() if n else None


def page_workbook_url(title: str, page_html: str | None) -> str | None:
    """The data page's download link whose title starts with `title`."""
    if not page_html:
        return None
    for m in re.finditer(r"<a\s+href=['\"]([^'\"]+)['\"][^>]*?title=['\"]([^'\"]+)['\"]", page_html):
        href, t = m.group(1), m.group(2).strip()
        if t.startswith(title):
            return href.replace('&amp;', '&')
    return None


def _five_year_group(age: int) -> str:
    if age >= 95:
        return '95 and over'
    lo = age // 5 * 5
    return f'{lo} to {lo + 4}'


def sya_from_groups(single_csv: str, groups: list[dict], vintage: int) -> str | None:
    """Single-year file rescaled to the 5-year-group file's totals (see module doc)."""
    lines = single_csv.splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith('id,'))
    single = list(csv.DictReader(io.StringIO('\n'.join(lines[start:]))))
    target: dict[tuple, dict] = {}
    for g in groups:
        target[(int(g['countyfips']), int(g['year']), g['age'])] = {
            'm': int(float(g['malepopulation'])), 'f': int(float(g['femalepopulation'])),
            'datatype': g['datatype'],
        }
    cells: dict[tuple, list[dict]] = {}
    for r in single:
        key = (int(r['countyfips']), int(r['year']), _five_year_group(int(r['age'])))
        cells.setdefault(key, []).append(r)
    county_targets = {k[0] for k in target}
    if {k[0] for k in cells} - {0} - county_targets:
        print('  sya.json lacks counties the single-year file has; not used', file=sys.stderr)
        return None
    out_rows = []
    for key, rows in cells.items():
        c, y, grp = key
        if c == 0:
            continue  # the statewide rows are rebuilt as the sum of the counties below
        t = target.get(key)
        if t is None:
            print(f'  sya.json has no {grp} for county {c} in {y}; not used', file=sys.stderr)
            return None
        for sex, col in (('m', 'malepopulation'), ('f', 'femalepopulation')):
            old = [float(r[col]) for r in rows]
            total_old = sum(old)
            want = t[sex]
            if total_old > 0:
                raw = [v * want / total_old for v in old]
            else:
                raw = [want / len(rows)] * len(rows)
            base = [math.floor(v) for v in raw]
            short = want - sum(base)
            order = sorted(range(len(raw)), key=lambda i: raw[i] - base[i], reverse=True)
            for i in order[:short]:
                base[i] += 1
            for r, v in zip(rows, base):
                r['_' + sex] = v
        for r in rows:
            out_rows.append((c, y, int(r['age']), r['county'], r['_m'], r['_f'], t['datatype']))
    state: dict[tuple, list] = {}
    for c, y, a, _, m, f, dt in out_rows:
        s = state.setdefault((y, a), [0, 0, dt])
        s[0] += m
        s[1] += f
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\n')
    # Shown on the Scenario Builder, so plain words; the split itself is
    # described under the page's sources (single-year shares from SDO's
    # previous single-year file, Vintage {vintage_of_text(single_csv)}).
    note = f'Vintage {vintage}, 5-year age groups split into single years'
    w.writerow([note] + [''] * (len(SYA_COLUMNS) - 1))
    w.writerow(SYA_COLUMNS)
    n = 0
    for (y, a), (m, f, dt) in sorted(state.items()):
        n += 1
        w.writerow([n, 0, y, a, 'Colorado', m, f, m + f, dt])
    for c, y, a, name, m, f, dt in sorted(out_rows):
        n += 1
        w.writerow([n, c, y, a, name, m, f, m + f, dt])
    return buf.getvalue()


def _candidates(kind: str, page_html: str | None) -> list[tuple[str, str, int | None]]:
    """[(source url, csv text, vintage)] for every copy of `kind` SDO publishes."""
    spec = KINDS[kind]
    out = []
    raw = _get(spec['csv'])
    bucket_text = raw.decode('utf-8', errors='replace') if raw else None
    if bucket_text:
        out.append((spec['csv'], bucket_text, vintage_of_text(bucket_text)))
    if kind in ('components', 'households'):
        url = page_workbook_url(spec['page_title'], page_html)
        data = _get(url) if url else None
        if data and data[:2] == b'PK':
            try:
                text = workbook_to_csv(read_xlsx_rows(data), kind)
            except Exception as e:
                print(f'  could not read the data page workbook for {kind}: {e}', file=sys.stderr)
                text = None
            if text:
                out.append((url, text, vintage_of_text(text)))
    elif kind == 'sya' and bucket_text:
        raw = _get(spec['json'])
        try:
            groups = json.loads(raw) if raw else None
        except ValueError:
            groups = None
        if groups:
            est = [int(g['year']) for g in groups if str(g.get('datatype')).lower() == 'estimate']
            v = max(est) if est else None
            old_v = vintage_of_text(bucket_text)
            if v is not None and (old_v is None or v > old_v):
                text = sya_from_groups(bucket_text, groups, v)
                if text:
                    out.append((spec['json'], text, v))
    return out


SIDECAR = 'sdo_sources.json'


def record_source(cache_dir: str, kind: str, url: str | None, vintage: int | None) -> None:
    """Note in <cache_dir>/sdo_sources.json where the cached copy of `kind` came from."""
    path = os.path.join(cache_dir, SIDECAR)
    try:
        with open(path, encoding='utf-8') as f:
            rec = json.load(f)
    except (OSError, ValueError):
        rec = {}
    rec[kind] = {'url': url, 'vintage': vintage, 'cache': KINDS[kind]['cache']}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(rec, f, indent=2, sort_keys=True)
        f.write('\n')


def recorded_sources(cache_dir: str) -> dict:
    try:
        with open(os.path.join(cache_dir, SIDECAR), encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def fetch_newest(kind: str, cache_dir: str, page_html: str | None = None) -> tuple[str | None, str | None, int | None]:
    """(csv text, source url, vintage) of the newest copy; also written to the cache file.

    Falls back to the cache file when no copy can be downloaded.
    """
    spec = KINDS[kind]
    cache = os.path.join(cache_dir, spec['cache'])
    if page_html is None and kind in ('components', 'households'):
        raw = _get(SDO_DATA_PAGE, timeout=60)
        page_html = raw.decode('utf-8', errors='replace') if raw else None
    cands = _candidates(kind, page_html)
    if cands:
        # Newest vintage; a tie keeps the bucket CSV, which is listed first.
        best = max(enumerate(cands), key=lambda ic: ((ic[1][2] or 0), -ic[0]))[1]
        url, text, v = best
        others = ', '.join(f'{u.rsplit("/", 1)[-1][:40]} = {vv}' for u, _, vv in cands)
        print(f'  SDO {spec["label"]}: using Vintage {v} from {url} ({others})')
        os.makedirs(cache_dir, exist_ok=True)
        with open(cache, 'w', encoding='utf-8') as f:
            f.write(text)
        record_source(cache_dir, kind, url, v)
        return text, url, v
    if os.path.exists(cache):
        with open(cache, encoding='utf-8') as f:
            text = f.read()
        print(f'  SDO {spec["label"]}: no copy downloaded; using the cached file {cache}', file=sys.stderr)
        return text, None, vintage_of_text(text)
    return None, None, None


def main(argv: list[str]) -> int:
    """Refresh the three cached SDO files and print what each source holds."""
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    cache_dir = os.path.join(root, 'data', 'hna', 'source')
    raw = _get(SDO_DATA_PAGE, timeout=60)
    page = raw.decode('utf-8', errors='replace') if raw else None
    report = {}
    for kind in KINDS:
        _, url, v = fetch_newest(kind, cache_dir, page)
        report[kind] = {'vintage': v, 'source': url}
    print(json.dumps(report, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
