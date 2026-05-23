import importlib.util
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "scripts" / "audit" / "upstream-schema-check.py"


def load_module():
    spec = importlib.util.spec_from_file_location("upstream_schema_check", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_census_urls_are_built_from_components():
    module = load_module()

    standard_url = module.build_census_acs5_url({
        "get": "NAME,B19001_001E",
        "for": "state:08",
    })
    profile_url = module.build_census_acs5_url({
        "get": "NAME,DP04_0001E",
        "for": "state:08",
    }, profile=True)

    parsed_standard = urlsplit(standard_url)
    parsed_profile = urlsplit(profile_url)

    assert parsed_standard.netloc == module._CENSUS_HOST
    assert parsed_standard.path == module._CENSUS_ACS5_PATH
    assert parse_qs(parsed_standard.query) == {
        "get": ["NAME,B19001_001E"],
        "for": ["state:08"],
    }

    assert parsed_profile.netloc == module._CENSUS_HOST
    assert parsed_profile.path == module._CENSUS_ACS5_PROFILE_PATH
    assert parse_qs(parsed_profile.query) == {
        "get": ["NAME,DP04_0001E"],
        "for": ["state:08"],
    }


def test_fred_url_is_built_from_components():
    module = load_module()

    url = module.build_fred_observations_url({
        "series_id": "UNRATE",
        "limit": "1",
        "file_type": "json",
        "api_key": "demo-key",
    })
    parsed = urlsplit(url)

    assert parsed.netloc == module._FRED_HOST
    assert parsed.path == module._FRED_OBSERVATIONS_PATH
    assert parse_qs(parsed.query) == {
        "series_id": ["UNRATE"],
        "limit": ["1"],
        "file_type": ["json"],
        "api_key": ["demo-key"],
    }


def test_problematic_literal_api_urls_are_absent_from_source():
    module = load_module()
    source = MODULE_PATH.read_text(encoding="utf-8")
    scheme = "".join(["htt", "ps"])

    census_base = f"{scheme}://{module._CENSUS_HOST}{module._CENSUS_ACS5_PATH}"
    fred_base = f"{scheme}://{module._FRED_HOST}{module._FRED_OBSERVATIONS_PATH}"

    assert census_base not in source
    assert f"{fred_base}?" not in source
