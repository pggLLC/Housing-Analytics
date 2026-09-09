"""Guard: the ACS year-fallback must request each vintage's own variable numbers.

Census Data Profile variable numbers are not stable across releases. The build
targets ACS 2024 and falls back 2023 -> 2022 for geographies the newest vintage
does not publish, and it was sending the 2024 numbers to every one of those
years. Census rejects a request containing an unknown variable *wholesale*, so a
single stale number voided the whole batch and the geography lost every core
field rather than one.

That is what failed run 34313350593 on 2026-09-09: 256 `unknown variable
'DP05_0096E'` errors, 32 of 546 geographies losing core fields (5.9%), tripping
the 2% abort threshold. The run 82 minutes earlier had the same defect at 24
errors and 9 geographies (1.6%) and passed — so the build's success was hostage
to how many geographies happened to fall back that morning. See #1567.

Run: python3 -m pytest tests/test_acs_vintage_var_aliases.py -q
"""

import importlib.util
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "scripts" / "hna" / "build_hna_data.py"

spec = importlib.util.spec_from_file_location("build_hna_data", SRC)
hna = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hna)


def _fallback_years():
    start = int(os.environ.get("ACS_START_YEAR", "2024"))
    n = int(os.environ.get("ACS_FALLBACK_YEARS", "3"))
    return list(range(start, start - n, -1))


def test_primary_vintage_is_never_aliased():
    """The canonical name IS the newest vintage's name; aliasing it would send
    the wrong number to the year that actually works."""
    primary = _fallback_years()[0]
    for canonical, by_year in hna.PROFILE_VAR_ALIASES.items():
        assert primary not in by_year, (
            f"{canonical} is aliased for the primary vintage {primary}; "
            "the canonical name must be the primary vintage's own name"
        )
        assert hna.profile_var_for_year(canonical, primary) == canonical


def test_every_fallback_year_is_covered():
    """An alias that skips a year silently reintroduces the defect for it."""
    years = _fallback_years()
    for canonical, by_year in hna.PROFILE_VAR_ALIASES.items():
        for year in years[1:]:
            assert year in by_year, (
                f"{canonical} has no alias for fallback year {year}; "
                f"the build will request the {years[0]} number and Census will "
                "reject the entire batch"
            )


def test_translation_round_trips_to_the_canonical_name():
    """The cache and every client key on the canonical name, so a fallback
    response must map back to it — otherwise the field silently disappears for
    any geography that fell back."""
    for canonical, by_year in hna.PROFILE_VAR_ALIASES.items():
        for year, wire in by_year.items():
            assert hna.profile_var_for_year(canonical, year) == wire
            assert hna.canonical_profile_var(wire, year) == canonical


def test_unaliased_variables_pass_through_unchanged():
    """118 of the 119 requested variables need no translation; they must be
    untouched in both directions, for every year."""
    for year in _fallback_years():
        assert hna.profile_var_for_year("DP05_0090E", year) == "DP05_0090E"
        assert hna.canonical_profile_var("DP05_0090E", year) == "DP05_0090E"
        assert hna.profile_var_for_year("NAME", year) == "NAME"


def test_the_variable_that_broke_the_build_is_aliased():
    """DP05_0096E is valid in 2024 and 404s in 2023/2022. Verified against each
    vintage's variables.json by exact label match on
    'Not Hispanic or Latino!!White alone'."""
    assert hna.profile_var_for_year("DP05_0096E", 2023) == "DP05_0082E"
    assert hna.profile_var_for_year("DP05_0096E", 2022) == "DP05_0079E"


def test_fetch_path_actually_uses_the_translation():
    """A map nothing calls is documentation. Pin both call sites."""
    src = SRC.read_text(encoding="utf-8")
    assert re.search(r"profile_var_for_year\(v, year\)", src), (
        "build_url must translate batch_vars for the year it is requesting"
    )
    assert re.search(r"canonical_profile_var\(result\[0\]\[i\], year\)", src), (
        "_fetch_batch must map the response back to canonical names"
    )
