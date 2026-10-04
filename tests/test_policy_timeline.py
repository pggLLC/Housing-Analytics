"""Curated policy timeline: policy-schema shape, sources, dates and references."""
import json
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

import pytest
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / 'schemas/policy-timeline.schema.json').read_text())
DATA = json.loads((ROOT / 'data/policy/policy-timeline.json').read_text())


def test_timeline_schema_and_sources():
    Draft202012Validator.check_schema(SCHEMA)
    Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(DATA)
    events = DATA['events']
    assert len(events) > 0
    assert len({e['id'] for e in events}) == len(events)
    assert [e['date'] for e in events] == sorted(e['date'] for e in events)
    legislation = json.loads((ROOT / DATA['meta']['legislation_file']).read_text())
    entries = {e['id']: e for e in legislation['entries']}
    for event in events:
        host = urlparse(event['source_url']).hostname
        assert host.endswith('.gov') or host.endswith('.who.int'), host
        if event['date'] < date.today().isoformat():
            assert event['status'] == 'historical', event['id']
        if event['verified']:
            assert date.fromisoformat(event['verified']) <= date.today()
        for reference in event.get('legislation_ids', []):
            assert reference in entries
    # The timeline references the maintained records rather than creating a
    # competing current-status registry for AHCIA and ROAD.
    by_id = {e['id']: e for e in events}
    assert 'ahcia-2025-hr2725' in by_id['ahcia-introduced']['legislation_ids']
    assert set(by_id['ahcia-partial-enactment']['legislation_ids']) == {
        'obbba-lihtc-ceiling-12pct', 'obbba-lihtc-bond-25pct-test'}
    road = by_id['road-act']
    assert road['date'] == entries[road['legislation_ids'][0]]['effective_date']


@pytest.mark.parametrize('field,value', [('source_url', ''), ('verified', '2026-02-30'), ('status', 'current')])
def test_timeline_schema_rejects_invalid_records(field, value):
    item = dict(DATA['events'][0], **{field: value})
    doc = dict(DATA, events=[item])
    assert list(Draft202012Validator(SCHEMA, format_checker=FormatChecker()).iter_errors(doc))


def test_unverified_requires_note():
    item = dict(DATA['events'][0], verified=None)
    assert list(Draft202012Validator(SCHEMA).iter_errors(dict(DATA, events=[item])))
