#!/usr/bin/env python3
"""Check machine-read data-source liveness and parser shape.

Writes data/reports/data-source-health.json. This is intentionally separate
from citation URL checks: every row here is a pipeline data dependency and must
return a parseable payload, not merely a reference page.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = ROOT / 'data' / 'source-registry.json'
REPORT_PATH = ROOT / 'data' / 'reports' / 'data-source-health.json'
UA = 'COHO-DataSourceHealth/1.0 (+https://github.com/pggLLC/Housing-Analytics)'
TIMEOUT = 25


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime) -> str:
    return dt.isoformat().replace('+00:00', 'Z')


def fetch(url: str) -> tuple[int | None, str, bytes, str | None]:
    req = Request(url, headers={'User-Agent': UA, 'Accept': '*/*'})
    try:
        with urlopen(req, timeout=TIMEOUT) as resp:
            return int(resp.status), resp.geturl(), resp.read(), None
    except HTTPError as exc:
        try:
            body = exc.read()
        except Exception:
            body = b''
        return int(exc.code), exc.geturl() or url, body, f'http_{exc.code}'
    except URLError as exc:
        return None, url, b'', f'url_error:{exc.reason}'
    except Exception as exc:  # noqa: BLE001
        return None, url, b'', f'{type(exc).__name__}:{exc}'


def bannered_csv_header(text: str) -> list[str]:
    for line in text.splitlines()[:30]:
        row = next(csv.reader([line])) if line else []
        lowered = [c.strip().lower() for c in row]
        if 'year' in lowered and ('countyfips' in lowered or 'area_fips' in lowered or 'placefips' in lowered):
            return lowered
    return []


def ordinary_csv_header(text: str) -> list[str]:
    try:
        return [c.strip().lower() for c in next(csv.reader(io.StringIO(text)))]
    except Exception:
        return []


def validate_payload(entry: dict, body: bytes) -> tuple[bool, str]:
    kind = entry.get('kind')
    parser = entry.get('parser') or {}
    if kind == 'xlsx':
        if not body.startswith(b'PK'):
            return False, 'xlsx did not start with ZIP/OOXML magic bytes'
        try:
            with zipfile.ZipFile(io.BytesIO(body)) as zf:
                names = set(zf.namelist())
                if not {'xl/workbook.xml', '[Content_Types].xml'}.issubset(names):
                    return False, 'xlsx missing workbook/content-types entries'
                text_parts = []
                for name in names:
                    if name == 'xl/sharedStrings.xml' or name.startswith('xl/worksheets/'):
                        text_parts.append(zf.read(name).decode('utf-8', errors='replace'))
        except Exception as exc:  # noqa: BLE001
            return False, f'xlsx zip parse failed: {exc}'
        haystack = '\n'.join(text_parts).lower()
        required = [str(v).lower() for v in parser.get('required_values', [])]
        missing = [v for v in required if v not in haystack]
        if missing:
            return False, f'missing workbook values: {missing}'
        return True, 'xlsx workbook structure ok'
    if kind in ('csv', 'bannered_csv'):
        text = body.decode('utf-8-sig', errors='replace')
        header = bannered_csv_header(text) if kind == 'bannered_csv' else ordinary_csv_header(text)
        required = [c.lower() for c in parser.get('required_columns', [])]
        missing = [c for c in required if c not in header]
        if missing:
            return False, f'missing CSV columns: {missing}; header={header[:20]}'
        return True, f'csv header ok ({len(header)} columns)'
    if kind == 'json_array':
        try:
            data = json.loads(body.decode('utf-8', errors='replace'))
        except Exception as exc:  # noqa: BLE001
            return False, f'json parse failed: {exc}'
        if not isinstance(data, list) or not data:
            return False, 'expected non-empty JSON array'
        header = [str(v) for v in data[0]] if isinstance(data[0], list) else []
        missing = [v for v in parser.get('required_values', []) if v not in header]
        if missing:
            return False, f'missing JSON array header values: {missing}'
        return True, 'json array shape ok'
    if kind == 'json_object':
        try:
            data = json.loads(body.decode('utf-8', errors='replace'))
        except Exception as exc:  # noqa: BLE001
            return False, f'json parse failed: {exc}'
        if not isinstance(data, dict):
            return False, 'expected JSON object'
        missing = [k for k in parser.get('required_keys', []) if k not in data]
        if missing:
            return False, f'missing JSON keys: {missing}'
        return True, 'json object shape ok'
    if kind == 'text':
        text = body[:200000].decode('utf-8', errors='replace')
        needle = parser.get('contains')
        if needle and needle.lower() not in text.lower():
            return False, f'text did not contain {needle!r}'
        return True, 'text shape ok'
    return False, f'unknown kind {kind!r}'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--registry', default=str(REGISTRY_PATH))
    ap.add_argument('--out', default=str(REPORT_PATH))
    ap.add_argument('--fail-on-error', action='store_true')
    args = ap.parse_args()

    registry_path = Path(args.registry)
    registry = json.loads(registry_path.read_text())
    now = utc_now()
    records = []
    counts = {'ok': 0, 'blocked': 0, 'dead': 0, 'parse_error': 0, 'stale': 0, 'error': 0}

    for entry in registry.get('sources', []):
        status_code, final_url, body, fetch_error = fetch(entry['url'])
        if status_code is not None and 200 <= status_code < 300 and not fetch_error:
            parse_ok, parse_note = validate_payload(entry, body)
            status = 'ok' if parse_ok else 'parse_error'
        elif status_code in (401, 403, 429):
            parse_ok, parse_note = False, f'blocked/protected HTTP {status_code}'
            status = 'blocked'
        elif status_code is not None:
            parse_ok, parse_note = False, fetch_error or f'HTTP {status_code}'
            status = 'dead'
        else:
            parse_ok, parse_note = False, fetch_error or 'network error'
            status = 'error'

        last_ok_raw = entry.get('last_ok')
        stale = False
        if last_ok_raw:
            try:
                last_ok = datetime.fromisoformat(last_ok_raw.replace('Z', '+00:00'))
                age_days = (now - last_ok).days
                cadence = int(entry.get('expected_cadence_days') or 0)
                stale = bool(cadence and age_days > cadence)
            except Exception:
                age_days = None
                stale = True
        else:
            age_days = None
            stale = True
        if stale and status == 'ok':
            status = 'stale'

        counts[status] = counts.get(status, 0) + 1
        records.append({
            'id': entry.get('id'),
            'source': entry.get('source'),
            'dataset': entry.get('dataset'),
            'url': entry.get('url'),
            'final_url': final_url,
            'status': status,
            'http_status': status_code,
            'parser_ok': parse_ok,
            'parser_note': parse_note,
            'expected_cadence_days': entry.get('expected_cadence_days'),
            'last_ok': entry.get('last_ok'),
            'age_days': age_days,
            'checked_at': iso(now),
        })

    report = {
        'generated_at': iso(now),
        'registry': str(registry_path.relative_to(ROOT)) if registry_path.is_relative_to(ROOT) else str(registry_path),
        'summary': {'total': len(records), **counts},
        'records': records,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + '\n')

    print('data-source-health\t' + '\t'.join(f'{k}={v}' for k, v in report['summary'].items()))
    failures = [r for r in records if r['status'] in {'dead', 'parse_error', 'stale', 'error'}]
    for row in failures[:20]:
        print(f"  {row['status']}: {row['id']} {row['http_status']} {row['parser_note']}", file=sys.stderr)
    if args.fail_on_error and failures:
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
