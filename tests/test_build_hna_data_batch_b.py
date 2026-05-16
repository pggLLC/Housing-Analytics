"""tests/test_build_hna_data_batch_b.py

Regression for 2026-05-16: build_hna_data.fetch_acs_profile() was
extended to fetch batch B (income brackets + year built + bedroom
mix codes) in addition to batch A, so that chartIncomeDistribution
/ chartHousingAge / chartBedroomMix paint from the cached summary
even when the live Census API is unreachable (CI, offline, network
blip).

What this asserts (source-grep style — no live network call):
  - Batch A keeps every historical mandatory variable.
  - Batch B adds the 25 new DP03 / DP04 codes the HNA renderers
    consume.
  - The fetch_acs_profile() function actually calls _fetch_batch
    twice and merges, so a partial-data scenario (B fails, A
    succeeds) still produces a usable summary.

Run: pytest tests/test_build_hna_data_batch_b.py -v
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/hna/build_hna_data.py"

# Income brackets — DP03_0052E (<$10k) … DP03_0060E ($200k+).
INCOME_CODES = [f"DP03_{n:04d}E" for n in range(52, 61)]
# Year structure built — DP04_0017E (2020+) … DP04_0026E (pre-1940).
YEAR_BUILT_CODES = [f"DP04_{n:04d}E" for n in range(17, 27)]
# Bedroom mix — DP04_0039E (no BR) … DP04_0044E (5+ BR).
BEDROOM_CODES = [f"DP04_{n:04d}E" for n in range(39, 45)]


def _source() -> str:
    return SCRIPT.read_text(encoding="utf-8")


def test_vars_a_keeps_historical_mandatory_codes():
    """Batch A must still carry the codes the existing dashboards
    depend on (DP04_0001E total housing, DP04_0089E median home value,
    DP04_0134E median rent, the GRAPI bins, etc.)."""
    src = _source()
    for code in (
        "DP05_0001E",
        "DP03_0062E",
        "DP04_0001E",
        "DP04_0046PE",
        "DP04_0047PE",
        "DP04_0089E",
        "DP04_0134E",
        "DP04_0137PE",
        "DP04_0142PE",
    ):
        assert f"'{code}'" in src, f"vars_a must still include {code}"


def test_vars_b_adds_income_brackets():
    src = _source()
    for code in INCOME_CODES:
        assert f"'{code}'" in src, f"vars_b must include income code {code}"


def test_vars_b_adds_year_built_codes():
    src = _source()
    for code in YEAR_BUILT_CODES:
        assert f"'{code}'" in src, f"vars_b must include year-built code {code}"


def test_vars_b_adds_bedroom_mix_codes():
    src = _source()
    for code in BEDROOM_CODES:
        assert f"'{code}'" in src, f"vars_b must include bedroom-mix code {code}"


def test_fetch_acs_profile_runs_both_batches_and_merges():
    """The function must run _fetch_batch twice (once per vars_*) and
    fall through cleanly if batch B fails — otherwise the supplement
    would silently drop the historical fields."""
    src = _source()
    assert "_fetch_batch(vars_a)" in src, \
        "fetch_acs_profile must call _fetch_batch with vars_a"
    assert "_fetch_batch(vars_b)" in src, \
        "fetch_acs_profile must call _fetch_batch with vars_b"
    # When B fails, A's data should still be returned (i.e. there's a
    # 'b is None' branch that doesn't abort the whole function).
    assert "if b is not None:" in src, \
        "must keep batch-A data when batch-B fetch fails"


def test_each_batch_stays_within_census_api_50_var_cap():
    """Census /profile endpoint refuses requests with >50 variables.
    Count the unique 'DP\\d\\d_\\d{4}P?E' identifiers inside each
    vars_* list block to make sure neither batch exceeds the cap."""
    import re
    src = _source()

    def _block(label: str) -> str:
        # Capture from 'label = [' to the matching closing ']'.
        m = re.search(label + r"\s*=\s*\[(.*?)\n    \]", src, re.DOTALL)
        assert m, f"could not locate {label} block in source"
        return m.group(1)

    def _codes(block: str) -> set[str]:
        return set(re.findall(r"'(DP0\d_\d{4}P?E)'", block))

    a = _codes(_block("vars_a"))
    b = _codes(_block("vars_b"))
    # +1 for NAME; Census counts NAME against the cap.
    assert len(a) + 1 <= 50, f"batch A has {len(a) + 1} vars (cap 50)"
    assert len(b) + 1 <= 50, f"batch B has {len(b) + 1} vars (cap 50)"


def test_batch_b_codes_match_renderer_expectations():
    """Sanity: each code in the new batch is what the corresponding
    renderer reads from `profile` at runtime."""
    src = _source()
    # Renderer probes (assert the new codes the HNA renderers actually use):
    # - chartIncomeDistribution → DP03_0052E..0060E
    # - chartHousingAge         → DP04_0017E..0026E
    # - chartBedroomMix         → DP04_0039E..0044E
    expected = set(INCOME_CODES + YEAR_BUILT_CODES + BEDROOM_CODES)
    missing = [c for c in expected if f"'{c}'" not in src]
    assert not missing, f"missing from build_hna_data.py: {missing}"
