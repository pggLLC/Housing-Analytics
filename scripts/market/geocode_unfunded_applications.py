#!/usr/bin/env python3
"""Map the tax-credit applications CHFA did not fund, so the Market analysis peer set is not winners-only.

Reads data/jurisdiction-briefs/_lihtc-applications.json (CHFA Applicant Reports, 2023 on) and keeps
every application whose outcome is not_awarded: its round's award report is published and the same
name and city is on no CHFA award report for that credit within two years. Each printed street
address is sent to the U.S. Census Bureau Geocoder (batch, Public_AR_Current benchmark). Only exact
and non-exact address matches are kept; an address the geocoder cannot match (often "TBD" or an
intersection) is listed with no point, never placed at a town centre.

  python3 scripts/market/geocode_unfunded_applications.py

Writes data/market/unfunded-application-points.json. Needs network access to
geocoding.geo.census.gov; rerun when _lihtc-applications.json changes, then run
scripts/market/build_reference_projects.mjs to score the points.
"""
import csv
import io
import json
import os
import sys
import urllib.request
import uuid
from datetime import date

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_lihtc-applications.json')
OUT = os.path.join(ROOT, 'data', 'market', 'unfunded-application-points.json')
GEOCODER = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch'
BENCHMARK = 'Public_AR_Current'


def batch_geocode(rows):
    """rows: [(id, street, city)] -> {id: (match_type, matched_address, lat, lon) or None}."""
    buf = io.StringIO()
    w = csv.writer(buf)
    for rid, street, city in rows:
        w.writerow([rid, street, city, 'CO', ''])
    boundary = uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="benchmark"\r\n\r\n{BENCHMARK}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="addressFile"; filename="a.csv"\r\n'
            f'Content-Type: text/csv\r\n\r\n{buf.getvalue()}\r\n--{boundary}--\r\n').encode()
    req = urllib.request.Request(GEOCODER, data=body, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(req, timeout=300) as r:
        text = r.read().decode('utf-8', 'replace')
    out = {}
    for rec in csv.reader(io.StringIO(text)):
        if len(rec) < 3:
            continue
        rid = rec[0]
        if rec[2] == 'Match' and len(rec) >= 6 and rec[5]:
            lon, lat = (float(v) for v in rec[5].split(','))
            out[rid] = (rec[3], rec[4], round(lat, 6), round(lon, 6))
        else:
            out[rid] = None
    return out


def main():
    src = json.load(open(SRC))
    apps = src['applications']
    picked = [(i, a) for i, a in enumerate(apps) if a.get('outcome') == 'not_awarded']
    rows = [(str(i), a['address'], a.get('city') or '') for i, a in picked if a.get('address')]
    hits = batch_geocode(rows) if rows else {}
    points, unmapped = [], []
    for i, a in picked:
        rec = {
            'name': a['name'], 'address': a.get('address'), 'city': a.get('city'),
            'county_fips': a.get('county_fips'), 'year': a['year'], 'round_label': a.get('round_label'),
            'credit_type': a.get('credit_type'), 'total_units': a.get('total_units'),
            'restricted_units': a.get('restricted_units'), 'outcome': a['outcome'],
            'source_url': a.get('source_url'),
        }
        h = hits.get(str(i)) if a.get('address') else None
        if h:
            rec.update({'lat': h[2], 'lon': h[3], 'match': h[0], 'matched_address': h[1]})
            points.append(rec)
        else:
            rec['why_unmapped'] = 'no street address printed' if not a.get('address') else 'the Census geocoder found no match for the printed address'
            unmapped.append(rec)
    meta = {
        'title': 'Tax-credit applications CHFA did not fund, mapped by their printed address',
        'source': 'data/jurisdiction-briefs/_lihtc-applications.json (CHFA Applicant Reports)',
        'source_generated': src.get('meta', {}).get('generated_at'),
        'outcome_rule': src.get('meta', {}).get('method'),
        'geocoder': f'U.S. Census Bureau Geocoder, address batch, {BENCHMARK} ({GEOCODER})',
        'kept': 'Address matches only (exact or non-exact). An unmatched address gets no point.',
        'generated': date.today().isoformat(),
        'applications': len(picked), 'mapped': len(points), 'unmapped': len(unmapped),
    }
    json.dump({'meta': meta, 'points': points, 'unmapped': unmapped}, open(OUT, 'w'), indent=1)
    open(OUT, 'a').write('\n')
    print(f'unfunded applications: {len(picked)}, mapped {len(points)}, unmapped {len(unmapped)} -> {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    sys.exit(main())
