#!/usr/bin/env python3
"""
generate_policy_briefs.py — Generate AI-assisted policy briefs from alerts and housing data.

Reads data/alerts/alerts_archive.json plus key housing datasets, then produces
structured policy brief summaries written to data/policy_briefs.json.

This script generates rule-based briefs when no LLM API is configured, and
can optionally call the OpenAI chat API (GPT-4) for richer summaries when the
OPENAI_API_KEY environment variable is set.

Usage:
    python3 scripts/generate_policy_briefs.py                 # briefs + stories
    python3 scripts/generate_policy_briefs.py --stories-only  # stories only; briefs kept

Environment variables:
    OPENAI_API_KEY  — optional; enables LLM-assisted summary generation
    BRIEFS_MAX      — maximum number of briefs to generate (default: 20)

Output:
    data/policy_briefs.json — `briefs` (per-topic) and `stories` (one per
    headline, read by policy-briefs.html)
"""

from __future__ import annotations

import json
import os
import re
import sys
import textwrap
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ALERTS_FILE = REPO_ROOT / 'data' / 'alerts' / 'alerts_archive.json'
TOOL_WATCH_FILE = REPO_ROOT / 'data' / 'policy' / 'tool-watch.json'
OUT_FILE = REPO_ROOT / 'data' / 'policy_briefs.json'
BRIEFS_MAX = int(os.environ.get('BRIEFS_MAX', '20'))

# Policy topic labels
TOPIC_LABELS: dict[str, str] = {
    'affordable_housing': 'Affordable Housing',
    'rent': 'Rent & Tenants',
    'homelessness': 'Homelessness',
    'zoning': 'Zoning & Land Use',
    'market': 'Housing Market',
    'policy': 'Housing Policy',
    'construction': 'Construction & Permitting',
    'tool_watch': 'Tool Evaluations',
    'general': 'General',
}

# Datasets that may be referenced in briefs
RELATED_DATA_MAP: dict[str, str] = {
    'affordable_housing': 'data/market/hud_lihtc_co.geojson',
    'rent': 'data/market/acs_tract_metrics_co.json',
    'market': 'data/market/acs_tract_metrics_co.json',
    'zoning': 'data/policy/prop123_jurisdictions.json',
    'policy': 'data/policy/prop123_jurisdictions.json',
    'construction': 'data/market/hud_lihtc_co.geojson',
    'tool_watch': 'data/policy/tool-watch.json',
    'homelessness': 'data/market/acs_tract_metrics_co.json',
    'general': 'data/market/acs_tract_metrics_co.json',
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def load_json_safe(path: Path) -> dict | list | None:
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def group_alerts_by_topic(alerts: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {}
    for alert in alerts:
        topic = alert.get('topic', 'general')
        groups.setdefault(topic, []).append(alert)
    return groups


def tool_watch_alerts() -> list[dict]:
    """Convert curated tool-watch entries into brief-source alert records."""
    data = load_json_safe(TOOL_WATCH_FILE)
    if not isinstance(data, dict):
        return []
    entries = data.get('entries') or []
    meta = data.get('meta') or {}
    alerts: list[dict] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        title = entry.get('title') or entry.get('tool_name') or ''
        source_url = entry.get('source_url') or ''
        if not title or not source_url:
            continue
        vendor = entry.get('vendor') or 'Tool source'
        alerts.append({
            'topic': 'tool_watch',
            'title': title,
            'source': vendor,
            'url': source_url,
            'date': entry.get('last_verified') or meta.get('last_verified') or meta.get('as_of') or '',
            'region': 'National tool evaluation',
            'tool_name': entry.get('tool_name') or title,
            'vendor': vendor,
            'category': entry.get('category') or '',
            'status': entry.get('status') or '',
            'capability_summary': entry.get('capability_summary') or '',
            'relevance_to_coho': entry.get('relevance_to_coho') or '',
            'source_note': entry.get('source_note') or '',
        })
    return alerts


def build_rule_based_brief(topic: str, alerts: list[dict]) -> dict:
    """Generate a structured brief without LLM based on alert aggregation."""
    label = TOPIC_LABELS.get(topic, topic.replace('_', ' ').title())
    recent = sorted(alerts, key=lambda a: a.get('date') or '', reverse=True)[:5]

    titles = [a.get('title', '') for a in recent if a.get('title')]
    regions = list({a.get('region', 'Colorado') for a in recent if a.get('region')})
    sources = list({a.get('source', '') for a in recent if a.get('source')})[:5]

    summary_parts = [
        f"Recent news coverage on {label.lower()} in Colorado covers {len(alerts)} item(s).",
    ]
    if titles:
        summary_parts.append(f"Notable headlines include: {'; '.join(titles[:3])}.")
    if regions:
        summary_parts.append(f"Coverage spans: {', '.join(regions[:4])}.")

    # Build articles list with title, source, link, date for each alert
    articles = []
    for a in sorted(alerts, key=lambda x: x.get('date') or '', reverse=True):
        art = {'title': a.get('title', ''), 'source': a.get('source', '')}
        if a.get('url') or a.get('link'):
            art['link'] = a.get('url') or a['link']
        if a.get('date'):
            art['date'] = a['date'][:10]
        if art['title']:
            articles.append(art)

    return {
        'title': f'{label} Policy Brief — {datetime.now(timezone.utc).strftime("%B %Y")}',
        'policy_topic': label,
        'summary': ' '.join(summary_parts),
        'related_data': RELATED_DATA_MAP.get(topic, ''),
        'sources': sources,
        'articles': articles,
        'alert_count': len(alerts),
        'regions': regions,
        'generated': utc_now(),
    }


def build_tool_watch_brief(alerts: list[dict]) -> dict:
    """Generate the recurring affordable-housing tool-evaluation brief."""
    recent = sorted(alerts, key=lambda a: a.get('date') or '', reverse=True)
    vendors = sorted({a.get('vendor') for a in recent if a.get('vendor')})
    tools = [a.get('tool_name') or a.get('title') for a in recent if a.get('tool_name') or a.get('title')]
    categories = sorted({str(a.get('category') or '').replace('_', ' ') for a in recent if a.get('category')})
    articles = []
    for a in recent:
        title = a.get('title') or a.get('tool_name') or ''
        if not title:
            continue
        art = {
            'title': title,
            'source': a.get('source') or a.get('vendor') or '',
            'link': a.get('url') or a.get('link') or '',
            'date': (a.get('date') or '')[:10],
        }
        if art['link']:
            articles.append(art)

    return {
        'title': f'Affordable Housing Tool Evaluations — {datetime.now(timezone.utc).strftime("%B %Y")}',
        'policy_topic': 'Tool Evaluations',
        'is_tool_evaluation': True,
        'summary': (
            f'The current tool watch tracks {len(recent)} affordable-housing analysis tool(s) '
            f'across {", ".join(vendors) if vendors else "verified public and vendor sources"}. '
            'Use these entries as evaluation prompts for COHO feature parity, source transparency, '
            'and underwriting workflow fit; they are not policy updates or endorsements.'
        ),
        'implications': (
            f'Current comparison areas include {", ".join(categories[:5]) if categories else "rent limits, income limits, and QCT/DDA screening"}. '
            f'Priority tools to re-check this cycle: {", ".join(tools[:4])}. '
            'Before changing COHO behavior, verify each cited source directly and document any bot-blocked vendor pages.'
        ),
        'related_data': RELATED_DATA_MAP.get('tool_watch', ''),
        'sources': vendors[:5],
        'articles': articles,
        'alert_count': len(recent),
        'regions': ['National tool evaluation'],
        'generated': utc_now(),
    }


# ── News stories: one record per headline ─────────────────────────────────
#
# Housing News (policy-briefs.html) lists headlines, not topic briefs. Each
# alert becomes one story; the same headline from several outlets becomes one
# story with the other outlets under `also`. Tags are decided here, once, so the
# page does not carry its own copy of the rules.
#
# Places come from data/hna/geo-config.json (all 546 geographies) and regions
# from the county map in scripts/hna/build_ranking_index.py, so a headline about
# Sterling is tagged with the same place and region the rest of the site uses.

GEO_CONFIG_FILE = REPO_ROOT / 'data' / 'hna' / 'geo-config.json'
RANKING_BUILDER = REPO_ROOT / 'scripts' / 'hna' / 'build_ranking_index.py'

OTHER_STATE_RE = re.compile(
    r'\b(ohio|minnesota|virginia|illinois|texas|florida|california|new york|massachusetts|'
    r'pennsylvania|michigan|north carolina|south carolina|georgia\b|tennessee|missouri|wisconsin|'
    r'indiana|maryland|washington state|oregon|nevada|arizona|utah|new mexico|kansas|nebraska|iowa|'
    r'oklahoma|arkansas|louisiana|kentucky|alabama|mississippi|west virginia|connecticut|new jersey|'
    r'maine|vermont|new hampshire|rhode island|delaware|north dakota|south dakota|montana|wyoming|'
    r'idaho|hawaii|alaska|richmond, va|atlanta|chicago|houston|los angeles|san diego|pasadena|'
    r'seattle|portland|burbank|felton|tulsa|indianapolis|trumann|newport|reese apartments|'
    r'streets\.mn|richland source|citybiz|ohfa|wheda|cinnaire|streetsblog)\b', re.I)
COLORADO_RE = re.compile(
    r'\b(colorado|colo\.|chfa|dola|cdola|gov\.colorado|cdle|front range|western slope|'
    r'san luis valley|eastern plains|prop(?:osition)?\s*123)\b', re.I)
FEDERAL_RE = re.compile(
    r'\b(federal|u\.s\. congress|congressional|u\.s\. senate|house bill|hud\b|fhfa|fha\b|\birs\b|'
    r'treasury|ahcia|nlihc|nahb|nmhc|nar\b|white house|supreme court|gao\b|cbo\b)\b', re.I)

PROGRAMS: list[tuple[str, re.Pattern]] = [
    ('LIHTC', re.compile(r'\bLIHTC\b|low.income housing tax credit|\btax credits?\b|\bMIHTC\b|\bQAP\b', re.I)),
    ('CHFA', re.compile(r'\bCHFA\b|Colorado Housing and Finance Authority', re.I)),
    ('Prop 123', re.compile(r'\bProp(?:osition)?\s*123\b', re.I)),
    ('Division of Housing', re.compile(r'\bC?DOH\b|Division of Housing|\bDOLA\b|Department of Local Affairs', re.I)),
    ('HUD', re.compile(r'\bHUD\b|Department of Housing and Urban Development', re.I)),
    ('Section 8', re.compile(r'\bSection 8\b|Housing Choice Voucher', re.I)),
]

# Colorado place names that are also everyday words or common elsewhere. They
# are tagged when written as "<name>, Colo…" / "<name>, CO", or when the
# headline already has Colorado context (see find_places); on their own they
# are more often something else ("Golden rule", "Center for…"). Aurora and
# Lakewood are deliberately NOT here: they are among Colorado's largest cities
# and the page has always counted them; "Aurora, Illinois" is still caught by
# OTHER_STATE_RE first.
AMBIGUOUS_PLACE_NAMES = {
    'Alpine', 'Avon', 'Bennett', 'Bonanza', 'Boone', 'Brandon', 'Brush', 'Cathedral',
    'Catherine', 'Center', 'Cope', 'Crawford', 'Crook', 'Crowley', 'Delta', 'Derby', 'Divide', 'Empire',
    'Englewood', 'Erie', 'Evans', 'Evergreen', 'Fairmount', 'Federal Heights', 'Florence',
    'Fountain', 'Frederick', 'Garden City', 'Genoa', 'Glendale', 'Golden', 'Granada', 'Grover',
    'Hasty', 'Hayden', 'Holly', 'Howard', 'Hudson', 'Hugo', 'Joes', 'Kim', 'Kirk', 'Lakeside',
    'Lewis', 'Lincoln Park', 'Lynn', 'Marble', 'Marvel', 'Meridian', 'Midland',
    'Monument', 'Mountain View', 'Norwood', 'Orchard', 'Otis', 'Ovid', 'Paoli', 'Parker', 'Peoria',
    'Pierce', 'Portland', 'Romeo', 'Sheridan', 'Somerset', 'Springfield', 'Sunshine', 'Superior',
    'Vernon', 'Victor', 'Ward', 'Weston', 'Westminster', 'Windsor', 'Wellington', 'Williamsburg',
    'Lafayette', 'Louisville', 'Brighton', 'Eaton', 'Kiowa', 'Laporte', 'Redlands', 'Derby',
    'Eagle', 'Garfield', 'Elbert', 'Pitkin', 'Moffat', 'Montezuma', 'Conejos', 'Arapahoe',
    'Kit Carson', 'Stonegate', 'Security-Widefield', 'Dinosaur', 'Silt', 'Loma', 'Rye',
}
# Counties whose name is unique to Colorado, so "<name> County" alone places a
# story in Colorado.
DISTINCT_COUNTY_NAMES = {
    'Larimer', 'Arapahoe', 'Pitkin', 'Routt', 'La Plata', 'Archuleta', 'Alamosa', 'Saguache',
    'Huerfano', 'Rio Blanco', 'Gilpin', 'Chaffee', 'Ouray', 'Broomfield', 'Costilla', 'Conejos',
    'Montezuma', 'Las Animas', 'Weld', 'Moffat', 'Prowers', 'Otero', 'Kit Carson', 'Hinsdale',
    'Eagle', 'Summit', 'Mesa', 'Gunnison', 'El Paso',
}


def _base_place_name(label: str) -> str:
    name = re.sub(r'\s*\((city|town|CDP|city and county|consolidated city)\)\s*$', '', label, flags=re.I)
    return name.strip()


def load_geographies(geo_config: dict | None = None, county_region: dict | None = None) -> dict:
    """Name → geography lookup for place tagging.

    Returns {'places': {name: geo}, 'counties': {name: geo}} where geo is
    {geoid, name, type, county, region}. A place name shared by two
    geographies is dropped: a headline cannot tell them apart.
    """
    if geo_config is None:
        geo_config = load_json_safe(GEO_CONFIG_FILE) or {}
    if county_region is None:
        county_region = _county_region()
    counties: dict[str, dict] = {}
    for c in geo_config.get('counties') or []:
        name = re.sub(r'\s+County$', '', c.get('label', '')).strip()
        if name:
            counties[name] = {'geoid': c['geoid'], 'name': c['label'], 'type': 'county',
                              'county': c['geoid'], 'region': county_region.get(c['geoid'])}
    places: dict[str, dict] = {}
    dupes: set[str] = set()
    for kind in ('places', 'cdps'):
        for p in geo_config.get(kind) or []:
            name = _base_place_name(p.get('label', ''))
            if not name or '(' in name:
                continue
            if name in places:
                dupes.add(name)
                continue
            county = p.get('containingCounty') or ''
            places[name] = {'geoid': p['geoid'], 'name': name, 'type': 'place' if kind == 'places' else 'cdp',
                            'county': county, 'region': county_region.get(county)}
    for name in dupes:
        places.pop(name, None)
    return {'places': places, 'counties': counties}


def _county_region() -> dict:
    """County FIPS → region, read from the ranking-index builder (one source)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('build_ranking_index', RANKING_BUILDER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return dict(mod.COUNTY_REGION)


_PLACE_PATTERN_CACHE: dict[int, re.Pattern] = {}


def _place_pattern(geos: dict) -> re.Pattern:
    key = id(geos)
    if key not in _PLACE_PATTERN_CACHE:
        names = [re.escape(n) + r'\s+County' for n in geos['counties']] + [re.escape(n) for n in geos['places']]
        names.sort(key=len, reverse=True)
        # Case-sensitive on purpose: "Golden" the town, not "golden" the adjective.
        _PLACE_PATTERN_CACHE[key] = re.compile(r'(?<![\w-])(' + '|'.join(names) + r')(?![\w-])')
    return _PLACE_PATTERN_CACHE[key]


# Words that turn a place name into the name of something else.
NAME_CONTINUATION_RE = re.compile(
    r'\s+(Commons|Apartments|Apts|Village|Villas|Place|Street|St\b|Road|Rd\b|Avenue|Ave\b|'
    r'Boulevard|Blvd|Drive|Heights|Plaza|Square|Center|Centre|Court|Lofts|Flats|Station|Crossing|'
    r'Gardens|Pointe?|Terrace|Ridge|Group|Foundation|Capital|Partners|Companies|Company|LLC|Inc|'
    r'Corp|Rule|Opportunity|Age)\b')


def find_places(title: str, geos: dict, source: str = '') -> tuple[list[dict], bool]:
    """Colorado geographies named in a headline.

    Returns (geographies, distinct) where distinct is True when at least one
    of them could only be in Colorado, so the headline is Colorado news even
    without the word "Colorado".
    """
    found: list[dict] = []
    distinct = False
    colorado_context = bool(COLORADO_RE.search(title) or COLORADO_SOURCE_RE.search(source or ''))
    for m in _place_pattern(geos).finditer(title):
        text = m.group(1)
        after = title[m.end():m.end() + 12]
        tagged_colorado = bool(re.match(r',\s*(Colo\b|Colorado\b|CO\b)', after))
        if text.endswith('County'):
            name = re.sub(r'\s+County$', '', text)
            geo = geos['counties'].get(name)
            if not geo:
                continue
            if name in DISTINCT_COUNTY_NAMES or tagged_colorado:
                distinct = True
            elif not colorado_context:
                continue
        else:
            geo = geos['places'].get(text)
            if not geo:
                continue
            if text in AMBIGUOUS_PLACE_NAMES and not tagged_colorado:
                # With Colorado context, take it, unless the next word makes
                # it part of a property or company name ("Crawford Commons").
                if not colorado_context or NAME_CONTINUATION_RE.match(title[m.end():]):
                    continue
            else:
                distinct = True
        if all(g['geoid'] != geo['geoid'] for g in found):
            found.append(geo)
    return found, distinct


def split_title(raw_title: str, source: str) -> tuple[str, str]:
    """Google News titles end in " - Publisher"; return (headline, publisher)."""
    t = (raw_title or '').strip()
    src = (source or '').strip()
    if src:
        for sep in (' - ', ' – ', ' — '):
            suffix = sep + src
            if len(t) > len(suffix) and t.endswith(suffix):
                return t[:-len(suffix)].strip(), src
    m = re.match(r'^(.+?)\s+[-–—]\s+([^-–—]{2,80})$', t)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return t, src


def norm_title(t: str) -> str:
    t = re.sub(r'[‐-―-]', ' ', (t or '').lower())
    t = re.sub(r'[^a-z0-9 ]', '', t)
    return re.sub(r'\s+', ' ', t).strip()


def story_scope(title: str, source: str, distinct_place: bool) -> str | None:
    """'colorado', 'federal', or None (another state's news, or not housing policy)."""
    hay = f'{title} {source}'
    if OTHER_STATE_RE.search(hay):
        return None
    if distinct_place or COLORADO_RE.search(hay):
        return 'colorado'
    # A Colorado outlet ("Sterling Journal-Advocate", "The Durango Herald").
    if COLORADO_SOURCE_RE.search(source or ''):
        return 'colorado'
    if FEDERAL_RE.search(hay):
        return 'federal'
    return None


# Colorado outlets. A story from one of these is Colorado context: it counts
# as Colorado news, and an everyday-word place name in it ("Golden's condos",
# "Parker") is taken as the Colorado place.
COLORADO_SOURCE_RE = re.compile(
    r'\b(Denver|Aurora|Boulder|Pueblo|Greeley|Longmont|Loveland|Durango|Aspen|Vail|Summit Daily|'
    r'Steamboat|Telluride|Sterling|Grand Junction|Glenwood|Fort Collins|Colorado Springs|'
    r'Craig|Cortez|Montrose|Alamosa|Canon City|Cañon City|Trinidad|Estes Park|Denverite|'
    r'Coloradoan|Westword|BusinessDen|Post Independent|Sky-Hi|9news|KOAA|KRDO|KKTV|KDVR|KUSA|'
    r'Denver7|KJCT|KREX|KUNC|Rocky Mountain PBS|CPR News|Golden Transcript|Parker Chronicle|'
    r'Castle Rock News-Press|Littleton Independent|Englewood Herald|Lone Tree Voice|'
    r'Highlands Ranch Herald|Arvada Press|Lakewood Sentinel|Canyon Courier|Elbert County News|'
    r'North Forty News|Daily Sentinel|Chieftain|Reporter-Herald|Times-Call|Daily Camera|'
    r'Crested Butte News|Mountain Mail|WesternSlopeNow|Yellow Scene|Larimer County|'
    r'Douglas County|Jefferson County|Adams County|El Paso County|Weld County)\b')


def build_stories(alerts: list[dict], geos: dict | None = None) -> tuple[list[dict], dict]:
    """Every in-scope alert as a story, newest first, same headlines merged.

    Returns (stories, counts) where counts explains what was left out.
    """
    if geos is None:
        geos = load_geographies()
    raw: list[dict] = []
    counts = {'alerts': 0, 'out_of_scope': 0, 'merged': 0}
    for a in alerts:
        if a.get('topic') == 'tool_watch':
            continue
        counts['alerts'] += 1
        title, source = split_title(a.get('title', ''), a.get('source', ''))
        if not title:
            continue
        places, distinct = find_places(title, geos, source)
        scope = story_scope(title, source, distinct)
        if scope is None:
            counts['out_of_scope'] += 1
            continue
        regions: list[str] = []
        for g in places:
            if g.get('region') and g['region'] not in regions:
                regions.append(g['region'])
        raw.append({
            'title': title,
            'source': source or 'Unknown publisher',
            'link': a.get('url') or a.get('link') or '',
            'date': (a.get('date') or '')[:10],
            'scope': scope,
            'programs': [name for name, rx in PROGRAMS if rx.search(title)],
            'places': [{'geoid': g['geoid'], 'name': g['name'], 'type': g['type']} for g in places],
            'regions': regions,
            'also': [],
        })
    raw.sort(key=lambda s: s['date'], reverse=True)
    by_key: dict[str, dict] = {}
    stories: list[dict] = []
    for s in raw:
        key = norm_title(s['title'])
        seen = by_key.get(key)
        if seen:
            counts['merged'] += 1
            if s['source'] != seen['source'] and all(x['source'] != s['source'] for x in seen['also']):
                seen['also'].append({'source': s['source'], 'link': s['link'], 'date': s['date']})
            continue
        by_key[key] = s
        stories.append(s)
    return stories, counts


def generate_llm_brief(topic: str, alerts: list[dict], api_key: str) -> dict | None:
    """Attempt to generate a richer brief using the OpenAI API."""
    label = TOPIC_LABELS.get(topic, topic.replace('_', ' ').title())
    recent = sorted(alerts, key=lambda a: a.get('date') or '', reverse=True)[:10]
    headlines = '\n'.join(
        f"- {a.get('date','')[:10]} | {a.get('source','')}: {a.get('title','')}"
        for a in recent if a.get('title')
    )

    prompt = textwrap.dedent(f"""
        You are a housing policy analyst. Based on the following recent news headlines about
        {label} in Colorado, write a concise policy brief with these fields:
        - title (one sentence)
        - summary (2-3 sentences)
        - implications (2-3 sentences, actionable)

        Recent headlines:
        {headlines}

        Respond in JSON with keys: title, summary, implications
    """).strip()

    payload = json.dumps({
        'model': 'gpt-4o-mini',
        'messages': [{'role': 'user', 'content': prompt}],
        'max_tokens': 400,
        'temperature': 0.3,
    }).encode()

    req = urllib.request.Request(
        'https://api.openai.com/v1/chat/completions',
        data=payload,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        content = result['choices'][0]['message']['content']
        # Parse JSON from LLM response — strip markdown code fences if present.
        # GPT models often wrap output in ```json ... ``` blocks.
        stripped = content.strip()
        lines = stripped.splitlines()
        if lines and lines[0].rstrip() in ('```', '```json'):
            # Remove opening fence line; remove trailing closing fence line if present
            inner = lines[1:]
            if inner and inner[-1].strip() == '```':
                inner = inner[:-1]
            stripped = '\n'.join(inner).strip()
        llm_data = json.loads(stripped)
        sources = list({a.get('source', '') for a in recent if a.get('source')})[:5]
        regions = list({a.get('region', 'Colorado') for a in recent if a.get('region')})
        articles = []
        for a in sorted(alerts, key=lambda x: x.get('date') or '', reverse=True):
            art = {'title': a.get('title', ''), 'source': a.get('source', '')}
            if a.get('url') or a.get('link'):
                art['link'] = a.get('url') or a['link']
            if a.get('date'):
                art['date'] = a['date'][:10]
            if art['title']:
                articles.append(art)
        return {
            'title': llm_data.get('title', ''),
            'policy_topic': label,
            'summary': llm_data.get('summary', ''),
            'implications': llm_data.get('implications', ''),
            'related_data': RELATED_DATA_MAP.get(topic, ''),
            'sources': sources,
            'articles': articles,
            'alert_count': len(alerts),
            'regions': regions,
            'generated': utc_now(),
        }
    except Exception as exc:
        print(f'  ⚠ LLM brief generation failed for {topic}: {exc}', file=sys.stderr)
        return None


def stories_meta(counts: dict) -> dict:
    return {
        'generated': utc_now(),
        'source_alerts': counts['alerts'],
        'out_of_scope': counts['out_of_scope'],
        'merged_duplicates': counts['merged'],
        'method': (
            'One story per headline, newest first. Other-state news is left out. Places are '
            'matched against the 546 geographies in data/hna/geo-config.json; regions follow '
            'the county map in scripts/hna/build_ranking_index.py.'
        ),
    }


def load_alerts() -> list[dict]:
    alerts_data = load_json_safe(ALERTS_FILE)
    if isinstance(alerts_data, dict):
        return list(alerts_data.get('alerts', []))
    if isinstance(alerts_data, list):
        return list(alerts_data)
    return []


def refresh_stories_only() -> int:
    """Rebuild `stories` in the existing output without touching the briefs.

    The weekly workflows write the briefs with an LLM key this repo does not
    have locally; regenerating them here would replace those summaries with
    rule-based ones. This mode leaves them alone.
    """
    existing = load_json_safe(OUT_FILE)
    if not isinstance(existing, dict) or not isinstance(existing.get('briefs'), list):
        print(f'✗ {OUT_FILE} has no briefs to keep; run without --stories-only', file=sys.stderr)
        return 1
    stories, counts = build_stories(load_alerts())
    existing['stories'] = stories
    existing['stories_meta'] = stories_meta(counts)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(existing, f, indent=2)
    print(f'✓ Wrote {len(stories)} stories to {OUT_FILE} (briefs unchanged)')
    return 0


def main() -> int:
    if '--stories-only' in sys.argv[1:]:
        return refresh_stories_only()
    api_key = os.environ.get('OPENAI_API_KEY', '').strip()

    alerts = load_alerts()

    if not alerts:
        print('ℹ No alerts found. Run fetch_google_alerts.py first.', file=sys.stderr)

    tool_alerts = tool_watch_alerts()
    if tool_alerts:
        alerts.extend(tool_alerts)

    print(f'Generating policy briefs from {len(alerts)} alert(s)…')
    groups = group_alerts_by_topic(alerts)

    # Sort topics by alert count (most active topics first)
    sorted_topics = sorted(groups.items(), key=lambda kv: len(kv[1]), reverse=True)

    briefs = []
    llm_used = False
    for topic, topic_alerts in sorted_topics[:BRIEFS_MAX]:
        print(f'  Topic: {topic} ({len(topic_alerts)} alerts)')
        brief = None
        if topic == 'tool_watch':
            brief = build_tool_watch_brief(topic_alerts)
        elif api_key:
            brief = generate_llm_brief(topic, topic_alerts, api_key)
            if brief is not None:
                llm_used = True
        if brief is None:
            brief = build_rule_based_brief(topic, topic_alerts)
        briefs.append(brief)

    if api_key:
        print(f'  OPENAI_API_KEY present; LLM mode: {"active" if llm_used else "fell back to rule-based"}')
    else:
        print('  OPENAI_API_KEY not set — using rule-based mode')

    stories, story_counts = build_stories(alerts)
    print(f'  Stories: {len(stories)} ({story_counts["merged"]} duplicate headline(s) merged, '
          f'{story_counts["out_of_scope"]} out of scope)')

    output = {
        'meta': {
            'generated': utc_now(),
            'brief_count': len(briefs),
            'source_alerts': len(alerts),
            'methodology': (
                'Policy briefs generated using GPT-4o-mini (LLM-assisted mode).'
                if llm_used else
                'Policy briefs generated using rule-based headline aggregation. '
                'Set OPENAI_API_KEY to enable LLM-assisted summaries.'
            ),
        },
        'briefs': briefs,
        'stories': stories,
        'stories_meta': stories_meta(story_counts),
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)

    print(f'✓ Wrote {len(briefs)} brief(s) to {OUT_FILE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
