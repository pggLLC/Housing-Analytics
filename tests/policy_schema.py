"""H2 structural and cross-record validators, shared by live-data and mutation tests.

JSON Schema handles shapes/enums; these checks handle geography, evidence,
independent roster completeness, and time. No network or inferred verification.
"""

import json
import re
from datetime import date
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_TEXT = re.compile(
    r'\b(?:endors\w*|recommend\w*|best|friendly)\b|\b(?:pro|anti)[-‐‑–—]', re.I
)
FORBIDDEN_KEYS = re.compile(
    r'score|rank|endorse|stance|party.*(?:infer|lean|position)|(?:infer|lean).*party', re.I
)
NUMBER_WORDS = dict(zip(
    'zero one two three four five six seven eight nine ten eleven twelve thirteen '
    'fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty '
    'fifty sixty seventy eighty ninety'.split(),
    list(range(20)) + list(range(20, 100, 10)),
))
SCALES = {'hundred': 100, 'thousand': 1000, 'million': 10**6, 'billion': 10**9}
WORD_PART = '|'.join([*NUMBER_WORDS, *SCALES])
WORD_NUMBER = re.compile(
    r'\b(?:' + '|'.join(NUMBER_WORDS) + r')'
    r'(?:(?:\s+(?:and\s+)?|-)(?:' + WORD_PART + r'))*\b', re.I
)
NUM = r'[-+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)'
FIGURES = {
    'dollars': re.compile(r'\$\s*(' + NUM + r')\s*(billion|million|thousand|[bmk]\b)?', re.I),
    'written_dollars': re.compile(
        r'(' + NUM + r')\s*(billion|million|thousand|[bmk]\b)?[\s-]*'
        r'(?:(?:U\.?S\.?\s+)?dollars?\b|USD\b)', re.I
    ),
    'percent': re.compile(r'(' + NUM + r')\s*(?:%|percent\b)', re.I),
    'mills': re.compile(r'(' + NUM + r')[\s-]*mills?\b', re.I),
    'term': re.compile(r'(' + NUM + r')[\s-]*(years?|months?|days?|terms?)\b', re.I),
    # Explicit end years are term figures too (e.g. "through 2040").
    'year': re.compile(r'\b((?:19|20|21)\d{2})\b'),
}


def load(path):
    return json.loads(path.read_text())


@lru_cache(maxsize=None)
def validator(name):
    schema = load(ROOT / 'schemas' / f'{name}.schema.json')
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def structure(doc, name):
    errors = sorted(validator(name).iter_errors(doc), key=lambda e: str(e.path))
    assert not errors, '\n'.join(f'{list(e.path)}: {e.message}' for e in errors)


def figures(text):
    """Typed values, not substrings: $1M != $11M and 5% != 5 mills.

    Normalize common equivalent spellings without rounding away cents. A
    quoted source still requires human review; numeric agreement is not a
    claim that the quote's context or the URL's contents have been verified.
    """
    def word_value(match):
        total, group = 0, 0
        for word in re.split(r'[\s-]+', match[0].lower()):
            if word in NUMBER_WORDS:
                group += NUMBER_WORDS[word]
            elif word == 'hundred':
                group *= 100
            elif word in SCALES:
                total += group * SCALES[word]
                group = 0
        return str(total + group)

    text = WORD_NUMBER.sub(word_value, text)
    text = re.sub(r'[-−]\s*\$', '$-', text)
    text = re.sub(
        r'\$\s*(' + NUM + r')\s*(?:–|—|\bto\b|-)\s*(' + NUM +
        r')\s*(billion|million|thousand|[bmk]\b)?',
        lambda m: f'${m[1]} {m[3] or ""} ${m[2]} {m[3] or ""}', text, flags=re.I,
    )
    # Both endpoints of unit ranges must be backed.
    text = re.sub(
        r'(' + NUM + r')\s*(?:–|—|\bto\b|-)\s*(' + NUM +
        r')\s*(%|percent\b|mills?\b|years?\b|months?\b|days?\b|terms?\b)',
        r'\1 \3 \2 \3', text, flags=re.I,
    )
    found, occupied = set(), []
    for kind, pattern in FIGURES.items():
        for match in pattern.finditer(text):
            if kind == 'year' and any(start <= match.start() < end for start, end in occupied):
                continue
            value = Decimal(match[1].replace(',', ''))
            unit = kind
            if kind in ('dollars', 'written_dollars'):
                unit = 'dollars'
                scale = (match[2] or '').lower()
                value *= {'billion': 10**9, 'b': 10**9, 'million': 10**6,
                          'm': 10**6, 'thousand': 1000, 'k': 1000}.get(scale, 1)
            elif kind == 'term':
                unit = match[2].lower().rstrip('s')
            found.add((unit, value))
            occupied.append(match.span())
    return found


def neutral(record, quoted):
    for field in ('neutral_title', 'neutral_summary', 'detail'):
        text = record.get(field, '')
        assert not FORBIDDEN_TEXT.search(text), f'{field}: forbidden neutral wording'
        missing = figures(text) - figures(quoted)
        assert not missing, f'{field}: figures absent from evidence/quote: {missing}'


def audit_tree(value, today):
    """Check nested keys, including histories, without scanning source quotes."""
    if isinstance(value, dict):
        for key, child in value.items():
            assert not FORBIDDEN_KEYS.search(key), f'forbidden field: {key}'
            if key in ('checked', 'roster_checked') and child is not None:
                assert date.fromisoformat(child) <= today, f'{key} is after today'
            audit_tree(child, today)
    elif isinstance(value, list):
        for child in value:
            audit_tree(child, today)


def current(record, election_date, today):
    # On day 45 a record must be archived. Day 44 is still current.
    assert record['archived'] or (today - date.fromisoformat(election_date)).days < 45, \
        'unarchived record is 45 or more days past its election'


def validate_ballots(files, geo, today=None):
    today = today or date.today()
    counties = {c['geoid']: c['label'] for c in geo['counties']}
    assert len(counties) == len(geo['counties']) == 64, 'expected 64 unique counties'
    places = {p['geoid']: p for p in geo['places']}
    assert len(places) == len(geo['places']) > 0, 'municipality scan is empty/duplicated'
    expected = {'statewide.json': {'08': ('state', 'Colorado')}}
    for geoid, name in counties.items():
        expected[f'counties/{geoid}.json'] = {geoid: ('county', name)}
    for geoid, place in places.items():
        assert re.fullmatch(r'08\d{5}', geoid), 'municipal GEOID must be a 7-digit string'
        assert place['containingCounty'] in counties, 'municipality has unknown county'
        expected[f"counties/{place['containingCounty']}.json"][geoid] = ('municipal', place['label'])
    assert set(files) == set(expected), 'missing/extra ballot file'
    seen_geoids, seen_ids = set(), set()
    row_count = 0
    for path, doc in files.items():
        structure(doc, 'ballot-2026')
        audit_tree(doc, today)
        rows = doc['coverage']
        row_count += len(rows)
        ids = [r['geoid'] for r in rows]
        assert len(ids) == len(set(ids)), f'{path}: duplicate coverage GEOID'
        assert not seen_geoids.intersection(ids), 'GEOID occurs in multiple files'
        seen_geoids.update(ids)
        assert set(ids) == set(expected[path]), f'{path}: missing/extra/misplaced GEOID'
        entries = {e['id']: e for e in doc['entries']}
        assert len(entries) == len(doc['entries']), f'{path}: duplicate entry id'
        assert not seen_ids.intersection(entries), 'entry id occurs in multiple files'
        seen_ids.update(entries)
        linked = []
        for row in rows:
            assert (row['level'], row['name']) == expected[path][row['geoid']], 'coverage identity mismatch'
            state = row['coverage_state']
            if state == 'not_researched':
                assert row['reviewed_source'] is None and row['checked'] is None, 'unresearched row claims a review'
            else:
                assert row['reviewed_source'] and row['checked'], 'reviewed row needs reviewed_source + checked'
            assert len(row['entry_ids']) == len(set(row['entry_ids'])), 'duplicate entry reference'
            assert bool(row['entry_ids']) == (state == 'verified_measure_found'), 'coverage state disagrees with entries'
            for eid in row['entry_ids']:
                assert eid in entries, 'entry_id must resolve in the same file'
                assert entries[eid]['jurisdiction'] == {k: row[k] for k in ('geoid', 'level', 'name')}, \
                    'entry jurisdiction disagrees with its coverage row'
                linked.append(eid)
        assert len(linked) == len(entries) and set(linked) == set(entries), 'orphan/multiply-linked entry'
        for entry in entries.values():
            if entry['status'] in ('certified', 'on_ballot'):
                assert entry['sources']['certification'] or entry['sources']['ballot_notice'], \
                    'certified/on_ballot entry needs certification or ballot_notice URL'
            if entry['status'] in ('passed', 'failed'):
                assert entry['result'] and entry['result']['outcome'] == entry['status'], \
                    'terminal status needs an agreeing election result'
            quotes = ' '.join(ev['quote'] for ev in entry['evidence'])
            neutral(entry, quotes)
            current(entry, entry['election']['date'], today)
    assert row_count == 1 + 64 + len(geo['places']), 'state + counties + municipalities count mismatch'
    assert seen_geoids == {'08', *counties, *places}, 'missing/extra coverage GEOID'


def validate_candidates(doc, today=None):
    today = today or date.today()
    structure(doc, 'candidate-platforms-2026')
    audit_tree(doc, today)
    races = {r['office']: r for r in doc['races']}
    assert len(races) == len(doc['races']), 'duplicate race'
    assert all(c['office'] in races for c in doc['candidates']), 'candidate has no race'
    for office, race in races.items():
        roster = [(c['candidate'], c['party']) for c in race['certified_candidates']]
        assert len(roster) == len(set(roster)), 'duplicate certified candidate'
        records = [c for c in doc['candidates'] if c['office'] == office]
        # Reported supplements never substitute for a campaign coverage record.
        campaign = [c for c in records if (c['verification'] or {}).get('level') != 'reported']
        identities = [(c['candidate'], c['party']) for c in campaign]
        assert len(identities) == len(set(identities)), 'duplicate campaign coverage record'
        if roster or records or race['coverage_state'] == 'complete':
            source = urlparse(race['candidates_source'] or '')
            assert source.scheme == 'https' and source.hostname in {
                'www.coloradosos.gov', 'coloradosos.gov', 'www.sos.state.co.us', 'sos.state.co.us'
            } and source.path.startswith('/pubs/elections/'), 'roster needs a Secretary of State candidate-list URL'
            assert race['roster_checked'], 'roster needs its independent checked date'
        if records:
            assert roster, 'candidate records need a nonempty authoritative roster'
            assert set(identities) == set(roster), 'campaign records must cover every certified candidate (and only them)'
        else:
            assert race['coverage_state'] == 'not_researched', 'empty race cannot be complete'
        if race['coverage_state'] == 'complete':
            assert all(c['coverage_state'] != 'not_researched' for c in campaign), 'complete race has unchecked candidates'
        for candidate in records:
            assert (candidate['candidate'], candidate['party']) in roster, 'candidate/ballot party label absent from roster'
            state = candidate['coverage_state']
            source = candidate['campaign_source']
            verification = candidate['verification']
            reported = verification and verification['level'] == 'reported'
            if reported:
                assert source['url'] and source['retrieved'] and candidate['quote'], 'report needs source + quote'
                assert state in ('not_researched', 'campaign_source_unavailable'), 'reported material cannot establish campaign coverage'
                assert not candidate['proposed_appointments'], 'reported material cannot establish campaign appointments'
            elif state in ('not_researched', 'campaign_source_unavailable'):
                assert verification is None, 'unverified campaign needs null verification'
                assert not candidate['neutral_summary'] and not candidate['quote'] and not candidate['topics'], \
                    'unchecked/unavailable campaign cannot carry platform claims'
                assert not candidate['proposed_appointments'], 'unverified campaign cannot carry appointments'
            else:
                assert verification and verification['level'] == 'primary', 'reviewed campaign requires primary verification'
                assert source['url'] and source['retrieved'], 'reviewed campaign needs source URL + retrieved date'
                if state == 'verified_platform_found':
                    assert candidate['topics'] and candidate['neutral_summary'].strip() and candidate['quote'].strip(), \
                        'verified platform needs topics, summary and quote'
                else:
                    assert not candidate['topics'] and not candidate['neutral_summary'] and not candidate['quote'], \
                        'no housing position found cannot carry platform claims'
            assert len(candidate['topics']) == len(set(candidate['topics'])), 'duplicate topic'
            assert len(candidate['quote'].split()) <= 40, 'campaign/report quote exceeds 40 words'
            neutral(candidate, candidate['quote'])
            current(candidate, race['election_date'], today)


def validate_watch(doc, today=None):
    today = today or date.today()
    structure(doc, 'policy-watch')
    audit_tree(doc, today)
    for entry in doc['entries']:
        if entry['section'] == 'people':
            assert entry['verification']['level'] == 'primary', 'housing role needs an official primary source'
            neutral(entry, ' '.join(e['quote'] for e in entry['evidence']))
