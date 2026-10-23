"""Deal summaries (data/deals/) stay well-formed, cited and free of contact details."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEALS = ROOT / 'data' / 'deals'
spec = importlib.util.spec_from_file_location('build_deal_summaries', ROOT / 'scripts' / 'deals' / 'build_deal_summaries.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def test_index_lists_every_record_and_nothing_else():
    index = json.loads((DEALS / 'index.json').read_text(encoding='utf-8'))
    slugs = {d['slug'] for d in index['deals']}
    files = {p.stem for p in DEALS.glob('*.json') if p.name != 'index.json'}
    assert slugs == files
    assert index['meta']['count'] == len(slugs)


def test_every_record_passes_the_build_checks():
    for path in DEALS.glob('*.json'):
        if path.name == 'index.json':
            continue
        rec = json.loads(path.read_text(encoding='utf-8'))
        assert rec['slug'] == path.stem
        assert mod.problems(rec) == [], path.name


def test_checks_catch_contacts_and_uncited_figures():
    rec = json.loads(next(p for p in DEALS.glob('*.json') if p.name != 'index.json').read_text(encoding='utf-8'))
    rec['facts'] = (rec.get('facts') or []) + [{'item': 'Contact', 'value': 'someone@example.org', 'src': []}]
    found = ' '.join(mod.problems(rec))
    assert 'email' in found and 'uncited' in found


def test_developer_name_only_as_chfa_prints_it_and_only_in_one_record():
    rec = json.loads((DEALS / 'fruita-mews-fruita.json').read_text(encoding='utf-8'))
    assert mod.problems(rec) == []
    loose = dict(rec, headline=rec['headline'] + ' Indibuild LLC')
    assert 'contains a developer brand that stays off the public site' in mod.problems(loose)
    for extra in ({'role': 'Investor', 'name': 'Indibuild LLC', 'src': ['chfa-2022-r1-award']}, dict(rec['parties'][0])):
        repeated = dict(rec, parties=rec['parties'] + [extra])
        assert 'contains a developer brand that stays off the public site' in mod.problems(repeated)
    other = json.loads((DEALS / 'ives-wheat-ridge.json').read_text(encoding='utf-8'))
    other['parties'] = other['parties'] + [{'role': 'Owner', 'name': 'Indibuild LLC', 'src': ['chfa-2022-r1-award']}]
    found = mod.problems(other)
    assert 'contains a developer brand that stays off the public site' in found


def test_public_guard_lets_only_the_two_chfa_rows_through(tmp_path):
    import shutil
    import subprocess
    raw = (DEALS / 'fruita-mews-fruita.json').read_text(encoding='utf-8')
    rec = json.loads(raw)
    guard = ROOT / 'scripts' / 'audit' / 'public-artifact-guard.mjs'

    def guard_passes(text):
        dist = tmp_path / 'dist'
        shutil.rmtree(dist, ignore_errors=True)
        (dist / 'data' / 'deals').mkdir(parents=True)
        (dist / 'data' / 'deals' / 'fruita-mews-fruita.json').write_text(text, encoding='utf-8')
        return subprocess.run(['node', str(guard), str(dist)], capture_output=True).returncode == 0

    assert guard_passes(raw)
    shadowed = raw.replace('{\n "slug"', '{\n "headline": "Indibuild LLC",\n "slug"', 1)
    assert shadowed != raw and not guard_passes(shadowed)
    extra = dict(rec, parties=rec['parties'] + [{'role': 'Investor', 'name': 'Indibuild LLC'}])
    assert not guard_passes(json.dumps(extra, indent=1))
    repeated = dict(rec, parties=rec['parties'] + [dict(rec['parties'][0])])
    assert not guard_passes(json.dumps(repeated, indent=1))
    escaped = json.dumps(extra, indent=1).replace('"name": "Indibuild LLC"\n  }\n ]', '"name": "Indi\\u0062uild LLC"\n  }\n ]')
    assert '\\u0062' in escaped and not guard_passes(escaped)
    # an escaped allowed row plus a shadowed literal elsewhere (the two tricks together)
    combo = raw.replace('"name": "Indibuild LLC"', '"name": "Indi\\u0062uild LLC"', 1)
    combo = combo.replace('{\n "slug"', '{\n "name": "Indibuild LLC",\n "slug"', 1)
    assert combo.count('Indi\\u0062uild') == 1 and not guard_passes(combo)
    # canonical file, but a zero-width space hides a mention in the headline
    hidden = dict(rec, headline=rec['headline'] + ' Indi\u200bbuild LLC')
    assert not guard_passes(json.dumps(hidden, indent=1, ensure_ascii=False) + '\n')
    # same with a control character, which canonical JSON writes as an escape
    hidden = dict(rec, headline=rec['headline'] + ' Indi\bbuild LLC')
    assert not guard_passes(json.dumps(hidden, indent=1, ensure_ascii=False) + '\n')
    # and with the two allowed rows gone, so the raw text has no plain mention at all
    bare = dict(hidden, parties=[])
    assert not guard_passes(json.dumps(bare, indent=1, ensure_ascii=False) + '\n')
    assert 'contains a developer brand that stays off the public site' in mod.problems(bare)
