#!/usr/bin/env python3
"""Map the tax-credit applications CHFA did not fund, so the Market analysis peer set is not winners-only.

Reads data/jurisdiction-briefs/_lihtc-applications.json (CHFA Applicant Reports, 2023 on) and keeps
every application whose outcome is not_awarded: its round's award report is published and the same
name and city is on no CHFA award report for that credit within two years. A property is counted once,
at its latest application, and only when it never won later: an application is dropped when the same
property (same name and city, or same street address and city) applied again later with any other
outcome (awarded, pending, in review, unresolved), applied again later and was again not funded (the
later one is kept), or is in the funded reference set (data/market/reference-projects.json). Each printed street
address is sent to the U.S. Census Bureau Geocoder (batch, Public_AR_Current benchmark). Only exact
and non-exact address matches are kept; an address the geocoder cannot match (often "TBD" or an
intersection) is listed with no point, never placed at a town centre.

  python3 scripts/market/geocode_unfunded_applications.py
  python3 scripts/market/geocode_unfunded_applications.py --refilter   # reapply the rule to the
      # existing output, keeping its geocodes and scores (no network)

Writes data/market/unfunded-application-points.json. Needs network access to
geocoding.geo.census.gov; rerun when _lihtc-applications.json changes, then run
scripts/market/build_reference_projects.mjs to score the points.
"""
import csv
import re
import io
import json
import os
import sys
import unicodedata
import urllib.request
import uuid
from datetime import date

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REFS = os.path.join(ROOT, 'data', 'market', 'reference-projects.json')
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


def _norm(s):
    # Fold accents first (Cañon -> Canon) so accented and plain spellings match.
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode('ascii')
    s = s.lower().replace('street', 'st').replace('avenue', 'ave')
    return re.sub(r'[^a-z0-9]', '', s)


def property_keys(a):
    """Same property = same name and city, or same printed street address and city."""
    city = _norm(a.get('city'))
    keys = {('name', _norm(a.get('name')), city)}
    if a.get('address'):
        keys.add(('address', _norm(a['address']), city))
    return keys


def order(a):
    """When in the cycle an application was made: year, then Round One before Round Two."""
    r = a.get('round_label') or ''
    return (a.get('year') or 0, 1 if 'Round One' in r else 2 if 'Round Two' in r else 3)


def why_dropped(a, apps, refs):
    """Why a not_awarded application leaves the cohort, or None when it stays."""
    k = property_keys(a)
    for b in apps:
        if b is a or order(b) < order(a) or not (property_keys(b) & k):
            continue
        if b.get('outcome') != 'not_awarded':
            return f"applied again in {b['year']}: {b.get('outcome')}"
        if order(b) > order(a):
            return f"applied again in {b['year']} and was again not funded; the later one is kept"
    for r in refs:
        if property_keys(r) & k:
            return f"in the funded reference set ({r.get('year_alloc')})"
    return None


def load(path):
    with open(path) as f:
        return json.load(f)


def write(meta, points, unmapped, dropped):
    with open(OUT, 'w') as f:
        json.dump({'meta': meta, 'points': points, 'unmapped': unmapped, 'dropped': dropped}, f, indent=1)
        f.write('\n')


def cohort(apps, refs):
    picked, dropped = [], []
    for i, a in enumerate(apps):
        if a.get('outcome') != 'not_awarded':
            continue
        why = why_dropped(a, apps, refs)
        if why:
            dropped.append({'name': a['name'], 'city': a.get('city'), 'year': a['year'],
                            'credit_type': a.get('credit_type'), 'why_dropped': why})
        else:
            picked.append((i, a))
    return picked, dropped


def refilter():
    """Reapply the cohort rule to the existing output; geocodes and scores are kept."""
    src = load(SRC)
    picked, dropped = cohort(src['applications'], load(REFS)['projects'])
    keep = {(a['name'], a.get('city'), a['year'], a.get('round_label')) for _, a in picked}
    old = load(OUT)
    tag = lambda p: (p['name'], p.get('city'), p['year'], p.get('round_label'))
    points = [p for p in old['points'] if tag(p) in keep]
    unmapped = [p for p in old['unmapped'] if tag(p) in keep]
    meta = dict(old['meta'], cohort_rule=COHORT_RULE, applications=len(picked), mapped=len(points),
                unmapped=len(unmapped), dropped=len(dropped), refiltered=date.today().isoformat())
    write(meta, points, unmapped, dropped)
    print(f'kept {len(picked)} (mapped {len(points)}, unmapped {len(unmapped)}), dropped {len(dropped)}')


COHORT_RULE = ('One row per property, at its latest application; dropped when the same name and city or the same '
               'street address and city applied again later (any outcome) or is in the funded reference set.')


def main():
    if '--refilter' in sys.argv:
        refilter()
        return
    src = load(SRC)
    apps = src['applications']
    picked, dropped = cohort(apps, load(REFS)['projects'])
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
        'cohort_rule': COHORT_RULE,
        'applications': len(picked), 'mapped': len(points), 'unmapped': len(unmapped), 'dropped': len(dropped),
    }
    write(meta, points, unmapped, dropped)
    print(f'unfunded applications: {len(picked)}, mapped {len(points)}, unmapped {len(unmapped)} -> {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
