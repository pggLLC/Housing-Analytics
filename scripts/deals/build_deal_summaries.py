#!/usr/bin/env python3
"""Copy hand-researched deal records into data/deals/ and write data/deals/index.json.

Each record is one CHFA housing tax credit award, researched from public sources
(CHFA award reports, state funding lists, city and county records, local news), in the
shape deal-summary.html reads. Records are written by hand; this script only checks them
and builds the index, so a malformed record fails here instead of on the page.

    python3 scripts/deals/build_deal_summaries.py RESEARCH_DIR

The index's `match` block is how js/agency-funding.js links an award row on
where-housing-money-goes.html to its summary: same agency, same ledger year, and a name
that equals or starts the ledger's name (the ledger cuts some long names short).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'data' / 'deals'

# Which ledger award each summary covers (data/policy/funding-awards/ledger.json).
MATCH = {
    'ascent-at-salt-flats-grand-junction': {'agency': 'CHFA', 'year': 2025, 'names': ['Ascent at Salt Flats']},
    'fairbrooke-heights-fort-collins': {'agency': 'CHFA', 'year': 2026, 'names': ['Fairbrooke Heights (scattered site)']},
    'greenbriar-apartments-fort-collins': {'agency': 'CHFA', 'year': 2026, 'names': ['Greenbriar Apartments (scattered site)']},
    'flocrit-decatur-place-denver': {'agency': 'CHFA', 'year': 2026, 'names': ['FloCrit at Decatur Place']},
    'gregory-highlands-ranch': {'agency': 'CHFA', 'year': 2026, 'names': ['Gregory']},
    'mountain-view-plaza-longmont': {'agency': 'CHFA', 'year': 2026, 'names': ['Mountain View Plaza (scattered site)']},
    'parkside-apartments-longmont': {'agency': 'CHFA', 'year': 2026, 'names': ['Parkside Apartments (scattered site)']},
    'reserve-at-south-creek-englewood': {'agency': 'CHFA', 'year': 2026, 'names': ['Reserve at South Creek']},
    'lumberyard-apartments-aspen': {'agency': 'CHFA', 'year': 2026, 'names': ['Lumberyard Apartments']},
    # 2026 Round One (federal 9%); names as the ledger prints them.
    '123-manitou-manitou-springs': {'agency': 'CHFA', 'year': 2026, 'names': ['123 Manitou']},
    'crossroads-at-divide-divide': {'agency': 'CHFA', 'year': 2026, 'names': ['Crossroads at Divide']},
    'barth-hotel-denver': {'agency': 'CHFA', 'year': 2026, 'names': ['Barth Hotel']},
    'commons-at-mosaic-denver': {'agency': 'CHFA', 'year': 2026, 'names': ['SH Commons at Mosaic', 'Commons at Mosaic']},
    'montbello-townhomes-denver': {'agency': 'CHFA', 'year': 2026, 'names': ['Montbello Townhomes']},
    'grove-at-pinewood-aurora': {'agency': 'CHFA', 'year': 2026, 'names': ['Grove at Pinewood']},
    'metro-center-apartments-aurora': {'agency': 'CHFA', 'year': 2026, 'names': ['Metro Center Apartments']},
    'willoughby-corner-phase-2-lafayette': {'agency': 'CHFA', 'year': 2026, 'names': ['Willoughby Corner Phase 2']},
    'cedar-creek-commons-montrose': {'agency': 'CHFA', 'year': 2026, 'names': ['Cedar Creek Commons']},
    'crawford-commons-clifton': {'agency': 'CHFA', 'year': 2026, 'names': ['Crawford Commons']},
    'gardenwalk-of-canon-city': {'agency': 'CHFA', 'year': 2026, 'names': ['GardenWalk of Cañon City']},
    'silver-key-apartments-colorado-springs': {'agency': 'CHFA', 'year': 2026, 'names': ['Silver Key Apartments at North Weber']},
    'ute-mountain-homes-i-towaoc': {'agency': 'CHFA', 'year': 2026, 'names': ['Ute Mountain Homes I']},
    'wildflower-flats-fort-lupton': {'agency': 'CHFA', 'year': 2026, 'names': ['Wildflower Flats']},
    '101-main-frisco': {'agency': 'CHFA', 'year': 2025, 'names': ['101 Main']},
    'arapahoe-psh-aurora': {'agency': 'CHFA', 'year': 2025, 'names': ['Arapahoe PSH']},
    'blossom-commons-westminster': {'agency': 'CHFA', 'year': 2025, 'names': ['Blossom Commons']},
    'kite-route-crossing-superior': {'agency': 'CHFA', 'year': 2025, 'names': ['Kite Route Crossing']},
    'marq-trinidad': {'agency': 'CHFA', 'year': 2025, 'names': ['Marq']},
    'park-avenue-apartments-denver': {'agency': 'CHFA', 'year': 2025, 'names': ['Park Avenue Apartments']},
    'ravenfield-brighton': {'agency': 'CHFA', 'year': 2025, 'names': ['Ravenfield']},
    'rita-bass-apartments-denver': {'agency': 'CHFA', 'year': 2025, 'names': ['Rita Bass Apartments']},
    'switchgrass-crossing-fort-collins': {'agency': 'CHFA', 'year': 2025, 'names': ['Switchgrass Crossing']},
    'tapestry-denver': {'agency': 'CHFA', 'year': 2025, 'names': ['Tapestry LIHTC']},
    'ives-ii-wheat-ridge': {'agency': 'CHFA', 'year': 2025, 'names': ['Ives II', 'Tax Credit Paired with 4% Ives II', 'Ives II 4']},
    'tierra-azul-alamosa': {'agency': 'CHFA', 'year': 2025, 'names': ['Tierra Azul']},
    'elmwood-north-denver': {'agency': 'CHFA', 'year': 2025, 'names': ['Elmwood North']},
    'park-place-apartments-denver': {'agency': 'CHFA', 'year': 2025, 'names': ['Park Place Apartments']},
    'st-louis-landing-building-c-fraser': {'agency': 'CHFA', 'year': 2025, 'names': ['St. Louis Landing Building C']},
    '1001-lincoln-street-denver': {'agency': 'CHFA', 'year': 2025, 'names': ['1001 Lincoln Street']},
    '1139-delaware-street-denver': {'agency': 'CHFA', 'year': 2025, 'names': ['1139 Delaware Street']},
    'atwood-commons-longmont': {'agency': 'CHFA', 'year': 2025, 'names': ['Atwood Commons']},
    'sugar-commons-sterling': {'agency': 'CHFA', 'year': 2025, 'names': ['Sugar Commons']},
    'central-park-station-phase-i-denver': {'agency': 'CHFA', 'year': 2025, 'names': ['Central Park Station Phase I']},
    'cole-train-denver': {'agency': 'CHFA', 'year': 2025, 'names': ['Cole Train']},
    'crossbar-commons-aurora': {'agency': 'CHFA', 'year': 2025, 'names': ['Crossbar Commons']},
    'university-building-lofts-denver': {'agency': 'CHFA', 'year': 2025, 'names': ['University Building Lofts']},
    'village-on-eastbrook-fort-collins': {'agency': 'CHFA', 'year': 2025, 'names': ['Village on Eastbrook']},
    '34th-street-boulder': {'agency': 'CHFA', 'year': 2025, 'names': ['34th Street']},
    '4965-washington-street-denver': {'agency': 'CHFA', 'year': 2025, 'names': ['4965 Washington Street']},
    'bradley-ridge-colorado-springs': {'agency': 'CHFA', 'year': 2025, 'names': ['Bradley Ridge']},
    'dawson-square-denver': {'agency': 'CHFA', 'year': 2025, 'names': ['Dawson Square']},
    'eagle-villas-eagle': {'agency': 'CHFA', 'year': 2025, 'names': ['Eagle Villas']},
    'flats-at-sand-creek-colorado-springs': {'agency': 'CHFA', 'year': 2025, 'names': ['Flats at Sand Creek']},
    'green-valley-vistas-denver': {'agency': 'CHFA', 'year': 2025, 'names': ['Green Valley Vistas']},
    'link-and-pin-denver': {'agency': 'CHFA', 'year': 2025, 'names': ['Link and Pin']},
    'montview-heights-aurora': {'agency': 'CHFA', 'year': 2025, 'names': ['Montview Heights']},
    'ponderosa-pines-parker': {'agency': 'CHFA', 'year': 2025, 'names': ['Ponderosa Pines']},
    'squire-village-northglenn': {'agency': 'CHFA', 'year': 2025, 'names': ['Squire Village']},
    'tiffany-square-lakewood': {'agency': 'CHFA', 'year': 2025, 'names': ['Tiffany Square']},
    'townview-phase-i-denver': {'agency': 'CHFA', 'year': 2025, 'names': ['Townview Phase I']},
    'windtrail-park-fort-collins': {'agency': 'CHFA', 'year': 2025, 'names': ['Windtrail Park']},
    'annex-boulder': {'agency': 'CHFA', 'year': 2024, 'names': ['Annex']},
    'aster-place-battlement-mesa': {'agency': 'CHFA', 'year': 2024, 'names': ['Aster Place']},
    'beeler-park-flats-denver': {'agency': 'CHFA', 'year': 2024, 'names': ['Beeler Park Flats']},
    'current-grand-junction': {'agency': 'CHFA', 'year': 2024, 'names': ['Current']},
    'grove-at-cottonwood-broomfield': {'agency': 'CHFA', 'year': 2024, 'names': ['Grove at Cottonwood']},
    'iliff-senior-apartments-denver': {'agency': 'CHFA', 'year': 2024, 'names': ['Iliff Senior Apartments']},
    'kappa-tower-iii-denver': {'agency': 'CHFA', 'year': 2024, 'names': ['Kappa Tower III']},
    'montview-flats-littleton': {'agency': 'CHFA', 'year': 2024, 'names': ['Montview Flats']},
    'range-view-saguache': {'agency': 'CHFA', 'year': 2024, 'names': ['Range View']},
    'residences-at-delta-ii-delta': {'agency': 'CHFA', 'year': 2024, 'names': ['Residences at Delta II']},
    'sanctuary-on-potomac-aurora': {'agency': 'CHFA', 'year': 2024, 'names': ['Sanctuary on Potomac']},
    'sunrise-at-shiloh-mesa-colorado-springs': {'agency': 'CHFA', 'year': 2024, 'names': ['Sunrise at Shiloh Mesa']},
    'vina-senior-residences-denver': {'agency': 'CHFA', 'year': 2024, 'names': ['Viña Senior Residences', 'Vina Senior Residences']},
    '4340-south-monaco-denver': {'agency': 'CHFA', 'year': 2024, 'names': ['4340 South Monaco']},
    'compass-pointe-pueblo': {'agency': 'CHFA', 'year': 2024, 'names': ['Compass Pointe']},
    'creekside-flats-denver': {'agency': 'CHFA', 'year': 2024, 'names': ['Creekside Flats']},
    'glenwood-gardens-glenwood-springs': {'agency': 'CHFA', 'year': 2024, 'names': ['Glenwood Gardens']},
    'grove-in-bloom-fort-collins': {'agency': 'CHFA', 'year': 2024, 'names': ['Grove in Bloom']},
    'jet-wing-flats-colorado-springs': {'agency': 'CHFA', 'year': 2024, 'names': ['Jet Wing Flats']},
    'maiker-uplands-westminster': {'agency': 'CHFA', 'year': 2024, 'names': ['Maiker Uplands']},
    'stables-aurora': {'agency': 'CHFA', 'year': 2024, 'names': ['Stables']},
    'summit-at-granby-apartments-granby': {'agency': 'CHFA', 'year': 2024, 'names': ['Summit at Granby Apartments']},
    'tiara-apartments-aurora': {'agency': 'CHFA', 'year': 2024, 'names': ['Tiara Apartments']},
    'harvest-hill-broomfield': {'agency': 'CHFA', 'year': 2024, 'names': ['Harvest Hill']},
    'loretto-heights-family-apartments-denver': {'agency': 'CHFA', 'year': 2024, 'names': ['Loretto Heights Family Apartments']},
    'marshall-pointe-apartments-arvada': {'agency': 'CHFA', 'year': 2024, 'names': ['Marshall Pointe Apartments']},
    'weatherstone-apartments-aurora': {'agency': 'CHFA', 'year': 2024, 'names': ['Weatherstone Apartments']},
}

REQUIRED = ['slug', 'name', 'city', 'award', 'researched_on', 'headline', 'status', 'key_numbers', 'sources']
# Text that never goes on the public site: staff contact details, and the owner's own deals.
FORBIDDEN = [
    (re.compile(r'[\w.+-]+@[\w-]+\.[\w.]+'), 'an email address'),
    (re.compile(r'\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b'), 'a phone number'),
    (re.compile(r'indibuild', re.I), 'a developer brand that stays off the public site'),
    (re.compile(r'fruita', re.I), 'a Fruita project'),
    # Summaries read as reference pages, not research notes.
    (re.compile(r'\b((?<!Phase )I (found|could|did|read|checked)|my (calculation|inference|reading))\b'), 'first-person research wording'),
]
CITED = ['key_numbers', 'facts', 'money', 'parties', 'background', 'timeline', 'pictures', 'discrepancies']


def problems(rec):
    out = []
    for k in REQUIRED:
        if not rec.get(k):
            out.append('missing ' + k)
    if rec.get('slug') not in MATCH:
        out.append('slug has no MATCH entry')
    if len(rec.get('key_numbers') or []) > 4:
        out.append('more than 4 key numbers')
    ids = [s.get('id') for s in rec.get('sources') or []]
    if len(ids) != len(set(ids)):
        out.append('duplicate source ids')
    for s in rec.get('sources') or []:
        if not re.match(r'^https?://', s.get('url') or ''):
            out.append('source %s has no http(s) url' % s.get('id'))
    known = set(ids)
    groups = [rec.get('status') or {}] + [x for k in CITED for x in (rec.get(k) or [])]
    for item in groups:
        if not isinstance(item, dict):
            out.append('item is not an object with src: %s' % json.dumps(item)[:80])
            continue
        src = item.get('src') or []
        if not src:
            out.append('uncited item: %s' % json.dumps(item)[:80])
        for sid in src:
            if sid not in known:
                out.append('unknown source id %s' % sid)
    if rec.get('mix_src'):
        for sid in rec['mix_src']:
            if sid not in known:
                out.append('unknown source id %s' % sid)
    text = json.dumps(rec, ensure_ascii=False)
    for rx, label in FORBIDDEN:
        if rx.search(text):
            out.append('contains ' + label)
    return out


def units_of(rec):
    for row in (rec.get('income_mix') or []), (rec.get('bedroom_mix') or []):
        if row:
            return sum(int(r.get('units') or 0) for r in row)
    return None


def main(research_dir):
    src_dir = Path(research_dir)
    OUT.mkdir(parents=True, exist_ok=True)
    index, failed = [], False
    for slug in sorted(MATCH):
        path = src_dir / (slug + '.json')
        if not path.exists():
            print('skip %s: no research record yet' % slug)
            continue
        rec = json.loads(path.read_text(encoding='utf-8'))
        bad = problems(rec)
        if bad:
            failed = True
            print('FAIL %s: %s' % (slug, '; '.join(bad)))
            continue
        (OUT / (slug + '.json')).write_text(json.dumps(rec, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
        index.append({
            'slug': slug, 'name': rec['name'], 'city': rec['city'], 'county': rec.get('county'),
            'award': rec['award'], 'year': MATCH[slug]['year'], 'units': rec.get('units') or units_of(rec),
            'researched_on': rec['researched_on'], 'match': MATCH[slug],
        })
    (OUT / 'index.json').write_text(json.dumps({
        'meta': {
            'title': 'Deal summaries',
            'generator': 'scripts/deals/build_deal_summaries.py',
            'method': 'One hand-researched record per CHFA award, from public sources only; every figure cites a source listed in the record.',
            'count': len(index),
        },
        'deals': index,
    }, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    print('wrote %d summaries' % len(index))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else str(OUT)))
