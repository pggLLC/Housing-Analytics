#!/usr/bin/env python3
"""Fix 6: Update baseYear from 2021 to 2024 in all 64 projection files.

Root cause: All 64 projection files use baseYear: 2021 (5 years stale).
Impact:     "Units needed today" KPI inflated by 5 years of already-built units.
Solution:   Advance baseYear to 2024, recalculate base scalars and incremental
            needs from the 2024 array position.
"""

import json
import os
import glob

PROJ_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'hna', 'projections')

OLD_BASE_YEAR = 2021
NEW_BASE_YEAR = 2024


def get_year_index(years: list, year: int) -> int:
    """Return the index of year in the years list, or -1 if not found."""
    try:
        return years.index(year)
    except ValueError:
        return -1


def recalculate_base(proj: dict, new_idx: int) -> dict:
    """Recalculate the base object using values at new_idx."""
    base = dict(proj.get('base', {}))
    population_dola = proj.get('population_dola', [])

    if population_dola and new_idx < len(population_dola):
        new_pop = population_dola[new_idx]
        old_headship = base.get('headship_rate', 0.35)
        old_vacancy = base.get('vacancy_rate', 6.0)

        new_households = new_pop * old_headship
        # units_needed = households / (1 - vacancy_rate/100)
        new_housing_units = new_households / (1 - old_vacancy / 100.0)

        base['population'] = round(new_pop, 4)
        base['households'] = round(new_households, 4)
        base['housing_units'] = round(new_housing_units, 4)
        # headship_rate and vacancy_rate are structural assumptions; keep unchanged

    return base


def recalculate_incremental(units_needed: list, base_idx: int) -> list:
    """Recalculate incremental units needed relative to the new base year index."""
    if not units_needed or base_idx >= len(units_needed):
        return units_needed
    base_units = units_needed[base_idx]
    return [round(u - base_units, 6) for u in units_needed]


def fix_projection_file(filepath: str) -> bool:
    with open(filepath) as f:
        proj = json.load(f)

    current_base_year = proj.get('baseYear')
    if current_base_year != OLD_BASE_YEAR:
        if current_base_year == NEW_BASE_YEAR:
            return False  # already up to date
        print(f'  WARNING: {os.path.basename(filepath)} has unexpected baseYear={current_base_year}')
        return False

    years = proj.get('years', [])
    new_idx = get_year_index(years, NEW_BASE_YEAR)

    if new_idx < 0:
        print(f'  WARNING: {os.path.basename(filepath)} does not have year {NEW_BASE_YEAR} in array')
        return False

    # Update baseYear
    proj['baseYear'] = NEW_BASE_YEAR

    # Recalculate base scalars
    proj['base'] = recalculate_base(proj, new_idx)

    # Recalculate incremental units needed
    housing_need = proj.get('housing_need', {})
    units_needed = housing_need.get('units_needed_dola', [])
    if units_needed:
        housing_need['incremental_units_needed_dola'] = recalculate_incremental(
            units_needed, new_idx
        )
    proj['housing_need'] = housing_need

    with open(filepath, 'w') as f:
        json.dump(proj, f, indent=2, separators=(',', ': '))
        f.write('\n')

    return True


def fix_projection_baseyear(proj_dir: str = PROJ_DIR) -> None:
    files = sorted(glob.glob(os.path.join(proj_dir, '*.json')))
    updated = 0
    skipped = 0

    for filepath in files:
        result = fix_projection_file(filepath)
        if result:
            updated += 1
        else:
            skipped += 1

    print(f'fix_projection_baseyear: updated {updated} files, skipped {skipped} files')


if __name__ == '__main__':
    fix_projection_baseyear()
