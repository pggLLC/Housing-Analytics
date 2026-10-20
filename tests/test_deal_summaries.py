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
