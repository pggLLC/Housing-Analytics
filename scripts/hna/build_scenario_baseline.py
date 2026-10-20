#!/usr/bin/env python3
"""Build data/hna/scenario-baseline/<county>.json: the Scenario Builder's start.

The Scenario Builder projects population by single year of age and sex, one
year at a time, the cohort-component method the State Demography Office (SDO)
uses for Colorado's official county forecast. Its starting point is SDO's own
forecast, so with every slider at 100% the builder reproduces SDO's population
by age and its household forecast exactly, and a new SDO vintage flows through
the next time this script runs.

Each year, for each county:

  deaths   = population at the start of the year x Colorado's death rate by
             age and sex (NCHS life tables) x one scale factor, solved so the
             county's deaths equal SDO's deaths for that year;
  births   = women aged 10-49 x Colorado's birth rates by age (NCHS) x one
             scale factor, solved so births equal SDO's births;
  migration by age and sex = SDO's forecast population by age next year, less
             the survivors and newborns above. It is everything births and
             deaths do not explain, so the default path is SDO's path.

A scenario multiplies births, deaths or migration by the slider's percentage.
Households are SDO's household forecast by age of householder: each group's
rate (households / people of that age in SDO's forecast) times the scenario's
people of that age. At 100% that is SDO's forecast.

Inputs, all cached by build_hna_data.py (DOLA phase) except the last:
  data/hna/source/dola_sya_county.csv         SDO single year of age, est. + forecast
  data/hna/source/dola_components_county.csv  SDO births, deaths, net migration
  data/hna/source/dola_household_county.csv   SDO households by age of householder
  data/hna/source/colorado_vital_rates.json   NCHS Colorado rates by age
                                              (fetch_colorado_vital_rates.py)

    python3 scripts/hna/build_scenario_baseline.py

js/projections/cohort-component-model.js runs the same arithmetic in the
browser; test/scenario-baseline-reproduces-sdo.test.js checks the two agree.
"""
import csv
import io
import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'data', 'hna', 'source')
OUT_DIR = os.path.join(ROOT, 'data', 'hna', 'scenario-baseline')

BASE_YEAR = 2024
END_YEAR = 2050          # SDO's household forecast ends here
N_AGES = 101             # 0..99 and 100+
FERTILE = range(10, 50)  # ages 10-49, the NCHS birth-rate groups
# SDO age_group_id 1-4; id 0 is the total.
HH_GROUPS = [('18-24', 18, 24), ('25-44', 25, 44), ('45-64', 45, 64), ('65+', 65, 100)]
SEX_RATIO = 1.05
# Colorado's 64 county FIPS codes: the odd numbers 1-125 and Broomfield, 14.
CO_COUNTIES = sorted(set(range(1, 126, 2)) | {14})

URLS = {
    'sya': 'https://storage.googleapis.com/co-publicdata/sya-county.csv',
    'components': 'https://storage.googleapis.com/co-publicdata/components-change-county.csv',
    'households': 'https://storage.googleapis.com/co-publicdata/household-county.csv',
}


def read_sdo(name):
    with open(os.path.join(SRC, name), newline='') as f:
        lines = f.read().splitlines()
    header = next(i for i, l in enumerate(lines) if l.startswith('id,'))
    vintage = lines[0].split(',')[0].strip() if header else None
    return vintage, list(csv.DictReader(io.StringIO('\n'.join(lines[header:]))))


def step(pm, pf, qm, qf, asfr, kd, kb, deaths_pct=1.0, births_pct=1.0):
    """One year. Returns survivors-and-newborns by sex, births and deaths.

    The browser model (cohort-component-model.js _step) is this function.
    """
    sm = [0.0] * N_AGES
    sf = [0.0] * N_AGES
    deaths = 0.0
    for a in range(N_AGES):
        rm = min(1.0, qm[a] * kd * deaths_pct)
        rf = min(1.0, qf[a] * kd * deaths_pct)
        deaths += pm[a] * rm + pf[a] * rf
        to = a + 1 if a < N_AGES - 1 else a
        sm[to] += pm[a] * (1.0 - rm)
        sf[to] += pf[a] * (1.0 - rf)
    births = sum(pf[a] * asfr[a] for a in FERTILE) * kb * births_pct
    sm[0] += births * SEX_RATIO / (1.0 + SEX_RATIO)
    sf[0] += births / (1.0 + SEX_RATIO)
    return sm, sf, births, deaths


def death_scale(pm, pf, qm, qf, target):
    """Scale on the death rates that gives `target` deaths (rates capped at 1)."""
    def deaths(k):
        return sum(pm[a] * min(1.0, qm[a] * k) + pf[a] * min(1.0, qf[a] * k) for a in range(N_AGES))
    lo, hi = 0.0, 20.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if deaths(mid) < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def main():
    vintage, sya_rows = read_sdo('dola_sya_county.csv')
    _, comp_rows = read_sdo('dola_components_county.csv')
    _, hh_rows = read_sdo('dola_household_county.csv')
    with open(os.path.join(SRC, 'colorado_vital_rates.json')) as f:
        vital = json.load(f)
    qm, qf = vital['deaths']['male'], vital['deaths']['female']
    asfr = [0.0] * N_AGES
    for group, rate in vital['births']['per_1000_women'].items():
        lo, hi = (int(x) for x in group.split('-'))
        for a in range(lo, hi + 1):
            asfr[a] = rate / 1000.0

    sya = {}
    names = {}
    rows_by_age = {}  # (county, year, age) -> rows; each must be exactly 1
    for r in sya_rows:
        c = int(r['countyfips'])
        if c == 0:
            continue
        y = int(r['year'])
        if BASE_YEAR <= y <= END_YEAR:
            d = sya.setdefault(c, {}).setdefault(y, ([0.0] * N_AGES, [0.0] * N_AGES))
            key = (c, y, int(r['age']))
            rows_by_age[key] = rows_by_age.get(key, 0) + 1
            a = min(int(r['age']), N_AGES - 1)
            d[0][a] += float(r['malepopulation'])
            d[1][a] += float(r['femalepopulation'])
            names[c] = r['county'].strip()
    comp = {}
    for r in comp_rows:
        c = int(r['countyfips'])
        comp.setdefault(c, {})[int(r['year'])] = r
    hh = {}
    for r in hh_rows:
        if r['household_type_id'] != '0':
            continue
        c = int(r['area_code'])
        hh.setdefault(c, {}).setdefault(int(r['year']), {})[int(r['age_group_id'])] = float(r['total_households'])

    # All 64 counties or nothing: a download missing a county would otherwise
    # leave that county's file from an earlier vintage beside the new ones.
    missing = sorted(set(CO_COUNTIES) - set(sya))
    extra = sorted(set(sya) - set(CO_COUNTIES))
    if missing or extra:
        raise SystemExit(f'SDO population file has counties {extra} it should not and lacks {missing}; nothing written')
    # A download cut short inside a year keeps that year but loses some ages,
    # which would otherwise read as nobody of those ages.
    years = list(range(BASE_YEAR, END_YEAR + 1))
    gaps = [f'08{c:03d} {y} age {a}' for c in CO_COUNTIES for y in years for a in range(N_AGES)
            if rows_by_age.get((c, y, a), 0) != 1]
    gaps += [f'08{c:03d} {y} age {a} ({n} rows)' for (c, y, a), n in rows_by_age.items() if n != 1 and a >= N_AGES]
    if gaps:
        raise SystemExit(f'SDO population file lacks or repeats {len(gaps)} county-year-age rows, e.g. {gaps[:3]}; nothing written')

    # Every county is checked and built before the first file is written, so a
    # short download of any of the three files writes nothing rather than
    # leaving some counties on the new vintage and some on the old.
    hh_ids = set(range(len(HH_GROUPS) + 1))
    worst = 0.0
    outputs = {}
    for c in sorted(sya):
        geoid = f'08{c:03d}'
        path = sya[c]
        comp_c, hh_c = comp.get(c, {}), hh.get(c, {})
        if (any(y not in path for y in years) or any(y not in comp_c for y in years[1:])
                or any(not hh_ids <= set(hh_c.get(y, {})) for y in years)):
            raise SystemExit(f'{geoid}: SDO files do not cover {BASE_YEAR}-{END_YEAR}; nothing written')
        kds, kbs, mig_m, mig_f = [], [], [], []
        sdo_births, sdo_deaths, sdo_mig = [], [], []
        for y in years[:-1]:
            pm, pf = path[y]
            nm, nf = path[y + 1]
            row = comp[c][y + 1]
            b, d = float(row['births']), float(row['deaths'])
            kd = death_scale(pm, pf, qm, qf, d)
            expected_b = sum(pf[a] * asfr[a] for a in FERTILE)
            kb = b / expected_b if expected_b > 0 else 0.0
            sm, sf, _, _ = step(pm, pf, qm, qf, asfr, kd, kb)
            kds.append(round(kd, 6))
            kbs.append(round(kb, 6))
            mig_m.append([round(nm[a] - sm[a], 2) for a in range(N_AGES)])
            mig_f.append([round(nf[a] - sf[a], 2) for a in range(N_AGES)])
            sdo_births.append(int(b))
            sdo_deaths.append(int(d))
            sdo_mig.append(int(float(row['netmig'])))

        headship, hh_total = [], []
        for y in years:
            groups = hh[c][y]
            pm, pf = path[y]
            rates = []
            for gid, (label, lo, hi) in enumerate(HH_GROUPS, start=1):
                people = sum(pm[a] + pf[a] for a in range(lo, hi + 1))
                rates.append(round(groups[gid] / people, 8) if people > 0 else 0.0)
            headship.append(rates)
            hh_total.append(int(groups[0]))

        # Re-run with the stored, rounded inputs: the default path must be SDO's.
        pm, pf = list(path[BASE_YEAR][0]), list(path[BASE_YEAR][1])
        for i, y in enumerate(years[1:]):
            sm, sf, _, _ = step(pm, pf, qm, qf, asfr, kds[i], kbs[i])
            pm = [max(0.0, sm[a] + mig_m[i][a]) for a in range(N_AGES)]
            pf = [max(0.0, sf[a] + mig_f[i][a]) for a in range(N_AGES)]
            sdo_total = sum(path[y][0]) + sum(path[y][1])
            worst = max(worst, abs(sum(pm) + sum(pf) - sdo_total))

        out = {
            'geoid': geoid,
            'name': names[c] + ' County',
            'vintage': vintage,
            'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'baseYear': BASE_YEAR,
            'endYear': END_YEAR,
            'source': {
                'sdo': URLS,
                'deaths': vital['deaths']['source'],
                'births': vital['births']['source'],
                'method': 'scripts/hna/build_scenario_baseline.py',
            },
            'rates': {
                'deathMale': qm,
                'deathFemale': qf,
                'birthByAge': [round(v, 6) for v in asfr],
                'sexRatioAtBirth': SEX_RATIO,
            },
            'base': {'male': [int(v) for v in path[BASE_YEAR][0]], 'female': [int(v) for v in path[BASE_YEAR][1]]},
            'steps': {'deathScale': kds, 'birthScale': kbs, 'migrationMale': mig_m, 'migrationFemale': mig_f},
            'households': {
                'groups': [{'label': l, 'minAge': lo, 'maxAge': hi} for l, lo, hi in HH_GROUPS],
                'ratesByYear': headship,
            },
            'sdo': {
                'years': years,
                'population': [int(round(sum(path[y][0]) + sum(path[y][1]))) for y in years],
                'households': hh_total,
                'births': sdo_births,
                'deaths': sdo_deaths,
                'netMigration': sdo_mig,
            },
        }
        outputs[geoid] = out
    # Migration is stored to the hundredth of a person, so the rebuilt path can
    # differ from SDO's by rounding alone: a few people over 26 years.
    if worst > 5:
        raise SystemExit(f'default path drifts from SDO by {worst:.1f} people in some year; expected 5 or fewer; nothing written')

    os.makedirs(OUT_DIR, exist_ok=True)
    for geoid, out in outputs.items():
        with open(os.path.join(OUT_DIR, f'{geoid}.json'), 'w') as f:
            json.dump(out, f, separators=(',', ':'))
            f.write('\n')
    print(f'wrote {len(outputs)} county files to {os.path.relpath(OUT_DIR, ROOT)} ({vintage}); '
          f'largest drift from SDO population {worst:.2f} people')


if __name__ == '__main__':
    sys.exit(main())
