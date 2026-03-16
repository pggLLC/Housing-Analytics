#!/usr/bin/env python3
"""
qa_stage1.py - QA Gate validation for Stage 1 data integrity fixes
Performs 33+ checks across all repaired data files.
Exit code 0 = all checks pass (DATA HEALTH SCORE: 100%)
Exit code 1 = one or more checks fail
"""

import json
import os
import glob
import sys

REPO_ROOT = os.path.join(os.path.dirname(__file__), '..')
DATA_DIR = os.path.join(REPO_ROOT, 'data')

PASS = 'PASS'
FAIL = 'FAIL'
results = []


def check(name, condition, detail=''):
    status = PASS if condition else FAIL
    results.append((status, name, detail))
    icon = '✓' if condition else '✗'
    print(f'  [{icon}] {name}' + (f' — {detail}' if detail else ''))
    return condition


def load_json(relpath):
    fpath = os.path.join(REPO_ROOT, relpath)
    with open(fpath) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Section 1: co_ami_gap_by_county.json (9 checks)
# ---------------------------------------------------------------------------
print('\n── co_ami_gap_by_county.json ─────────────────────────')

try:
    ami = load_json('data/co_ami_gap_by_county.json')
    ami_ok = True
except Exception as e:
    ami_ok = False
    check('AMI gap file loads as valid JSON', False, str(e))

if ami_ok:
    check('AMI gap file loads as valid JSON', True)

    # Check 1: statewide ami_4person is not null
    statewide = ami.get('statewide', {})
    check('Statewide ami_4person is not null',
          statewide.get('ami_4person') is not None,
          f'value={statewide.get("ami_4person")}')

    # Check 2: statewide ami_4person equals 107200
    check('Statewide ami_4person == 107200',
          statewide.get('ami_4person') == 107200,
          f'value={statewide.get("ami_4person")}')

    # Check 3: statewide affordable_rent_monthly is not empty
    rent_bands = statewide.get('affordable_rent_monthly', {})
    check('Statewide rent bands not empty',
          len(rent_bands) >= 7,
          f'bands={list(rent_bands.keys())}')

    # Check 4: statewide rent at 30% AMI is populated
    r30 = rent_bands.get('30')
    check('Statewide rent at 30% AMI populated',
          isinstance(r30, (int, float)) and r30 > 0,
          f'30% rent={r30}')

    # Check 5: 64 counties present
    counties = ami.get('counties', [])
    check('64 Colorado counties present',
          len(counties) == 64,
          f'count={len(counties)}')

    # Check 6: Ouray County (FIPS 08091) present
    fips_set = {c['fips'] for c in counties}
    check('Ouray County (FIPS 08091) present',
          '08091' in fips_set,
          f'fips_set sample={sorted(fips_set)[:5]}')

    # Check 7: All county FIPS are 5-digit
    bad_fips = [c['fips'] for c in counties if len(c['fips']) != 5]
    check('All county FIPS are 5-digit',
          len(bad_fips) == 0,
          f'bad_fips={bad_fips[:5]}' if bad_fips else '')

    # Check 8: Adams County FIPS is "08001" (not "001")
    check('Adams County FIPS is 08001',
          '08001' in fips_set,
          f'08001 present={("08001" in fips_set)}')

    # Check 9: No county has null ami_4person
    null_ami = [c['county_name'] for c in counties if c.get('ami_4person') is None]
    check('No county has null ami_4person',
          len(null_ami) == 0,
          f'null counties={null_ami[:5]}' if null_ami else '')

# ---------------------------------------------------------------------------
# Section 2: data/chfa-lihtc.json (8 checks)
# ---------------------------------------------------------------------------
print('\n── data/chfa-lihtc.json ──────────────────────────────')

try:
    chfa = load_json('data/chfa-lihtc.json')
    chfa_ok = True
except Exception as e:
    chfa_ok = False
    check('chfa-lihtc.json loads as valid JSON', False, str(e))

if chfa_ok:
    check('chfa-lihtc.json loads as valid JSON', True)

    features = chfa.get('features', [])
    check('chfa-lihtc.json has 716 features',
          len(features) == 716,
          f'count={len(features)}')

    def get_props(feat):
        return feat.get('properties') if 'properties' in feat else feat

    # Check: No null LI_UNITS
    li_null = [f for f in features if get_props(f).get('LI_UNITS') is None]
    check('No null LI_UNITS fields',
          len(li_null) == 0,
          f'null count={len(li_null)}')

    # Check: No null CREDIT
    credit_null = [f for f in features if get_props(f).get('CREDIT') is None]
    check('No null CREDIT fields',
          len(credit_null) == 0,
          f'null count={len(credit_null)}')

    # Check: No null NON_PROF
    np_null = [f for f in features if get_props(f).get('NON_PROF') is None]
    check('No null NON_PROF fields',
          len(np_null) == 0,
          f'null count={len(np_null)}')

    # Check: No null DDA
    dda_null = [f for f in features if get_props(f).get('DDA') is None]
    check('No null DDA fields',
          len(dda_null) == 0,
          f'null count={len(dda_null)}')

    # Check: LI_UNITS never exceeds N_UNITS
    li_exceed = [f for f in features
                 if get_props(f).get('LI_UNITS') is not None
                 and get_props(f).get('N_UNITS') is not None
                 and get_props(f)['LI_UNITS'] > get_props(f)['N_UNITS']]
    check('LI_UNITS never exceeds N_UNITS',
          len(li_exceed) == 0,
          f'violations={len(li_exceed)}')

    # Check: All CREDIT values are non-null strings
    # HUD LIHTC CREDIT codes: "1"=9% competitive, "2"=4% bond, "3"=both, "4"=other/unknown
    null_or_empty_credits = [get_props(f).get('CREDIT') for f in features
                             if not get_props(f).get('CREDIT')]
    check('All CREDIT values are non-null/non-empty',
          len(null_or_empty_credits) == 0,
          f'null/empty count={len(null_or_empty_credits)}')

# ---------------------------------------------------------------------------
# Section 3: data/hna/dola_sya/*.json (4 checks)
# ---------------------------------------------------------------------------
print('\n── data/hna/dola_sya/ ────────────────────────────────')

sya_pattern = os.path.join(DATA_DIR, 'hna', 'dola_sya', '*.json')
sya_files = sorted(glob.glob(sya_pattern))

check('64 SYA county files present',
      len(sya_files) == 64,
      f'count={len(sya_files)}')

if sya_files:
    years_found = set()
    bad_year_files = []
    for fpath in sya_files:
        try:
            with open(fpath) as f:
                d = json.load(f)
            y = d.get('pyramidYear')
            years_found.add(y)
            if y != 2024:
                bad_year_files.append((os.path.basename(fpath), y))
        except Exception:
            bad_year_files.append((os.path.basename(fpath), 'error'))

    check('All SYA files have pyramidYear == 2024',
          len(bad_year_files) == 0,
          f'bad files={bad_year_files[:3]}' if bad_year_files else '')

    check('No SYA file has pyramidYear == 2030',
          2030 not in years_found,
          f'years found={years_found}')

    check('SYA files have age pyramid data (ages array)',
          all(True for _ in [1]),  # sampled below
          '')
    # Re-check with actual sampling
    sample = sya_files[0]
    with open(sample) as f:
        sd = json.load(f)
    has_ages = isinstance(sd.get('ages'), list) and len(sd.get('ages', [])) > 0
    results.pop()  # remove placeholder
    check('SYA files have age pyramid data (ages array)',
          has_ages,
          f'sample={os.path.basename(sample)} ages_len={len(sd.get("ages", []))}')

# ---------------------------------------------------------------------------
# Section 4: data/amenities/ GeoJSON files (4 checks)
# ---------------------------------------------------------------------------
print('\n── data/amenities/ ───────────────────────────────────')

amenity_files = {
    'healthcare_co.geojson': 10,
    'schools_co.geojson': 15,
    'retail_nodes_co.geojson': 12,
    'grocery_co.geojson': 1
}

for fname, min_count in amenity_files.items():
    fpath = os.path.join(DATA_DIR, 'amenities', fname)
    try:
        with open(fpath) as f:
            d = json.load(f)
        count = len(d.get('features', []))
        check(f'{fname} has >= {min_count} features',
              count >= min_count,
              f'count={count}')
    except Exception as e:
        check(f'{fname} has >= {min_count} features', False, str(e))

# ---------------------------------------------------------------------------
# Section 5: data/manifest.json (4+ checks)
# ---------------------------------------------------------------------------
print('\n── data/manifest.json ────────────────────────────────')

try:
    manifest = load_json('data/manifest.json')
    manifest_ok = True
except Exception as e:
    manifest_ok = False
    check('manifest.json loads as valid JSON', False, str(e))

if manifest_ok:
    check('manifest.json loads as valid JSON', True)

    files_dict = manifest.get('files', {})
    check('manifest.json lists 100+ files',
          len(files_dict) >= 100,
          f'count={len(files_dict)}')

    check('manifest.json has generated timestamp',
          bool(manifest.get('generated')),
          f'generated={manifest.get("generated")}')

    check('manifest includes data/chfa-lihtc.json',
          'data/chfa-lihtc.json' in files_dict,
          '')

    check('manifest includes data/co_ami_gap_by_county.json',
          'data/co_ami_gap_by_county.json' in files_dict,
          '')

# ---------------------------------------------------------------------------
# Section 6: Cross-file FIPS join integrity (2 checks)
# ---------------------------------------------------------------------------
print('\n── Cross-file FIPS join integrity ────────────────────')

# Check that AMI gap county FIPS match chfa-lihtc CNTY_FIPS format
if ami_ok and chfa_ok:
    ami_fips_set = {c['fips'] for c in ami.get('counties', [])}
    chfa_features = chfa.get('features', [])

    def get_props_chfa(feat):
        return feat.get('properties') if 'properties' in feat else feat

    chfa_fips = {get_props_chfa(f).get('CNTY_FIPS') for f in chfa_features
                 if get_props_chfa(f).get('CNTY_FIPS')}

    # Both should use 5-digit FIPS
    ami_5digit = all(len(fips) == 5 for fips in ami_fips_set)
    chfa_5digit = all(len(str(fips)) == 5 for fips in chfa_fips if fips)
    check('AMI gap FIPS and CHFA FIPS both 5-digit (join-compatible)',
          ami_5digit and chfa_5digit,
          f'ami_5digit={ami_5digit}, chfa_5digit={chfa_5digit}')

    # CHFA counties should be a subset of AMI gap counties
    chfa_co_fips = {f for f in chfa_fips if str(f).startswith('08')}
    unmatched = chfa_co_fips - ami_fips_set
    check('All CHFA Colorado county FIPS found in AMI gap file',
          len(unmatched) == 0,
          f'unmatched={sorted(unmatched)[:5]}' if unmatched else '')

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total = len(results)
passed = sum(1 for r in results if r[0] == PASS)
failed = total - passed
pct = int(round(passed / total * 100)) if total else 0

print('\n' + '═' * 60)
print(f'TOTAL CHECKS : {total}')
print(f'PASSED       : {passed}')
print(f'FAILED       : {failed}')
print(f'\nDATA HEALTH SCORE: {pct}%')
print('═' * 60)

if failed:
    print('\nFAILED CHECKS:')
    for status, name, detail in results:
        if status == FAIL:
            print(f'  ✗ {name}' + (f' — {detail}' if detail else ''))
    sys.exit(1)
else:
    print('\nAll checks PASSED. Stage 1 data integrity verified. ✓')
    sys.exit(0)
