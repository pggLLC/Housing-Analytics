#!/usr/bin/env python3
"""Realtor.com listings builder: Colorado only, blanks stay null, a bad month keeps the committed file."""

from __future__ import annotations

import importlib.util
import io
import json
import tempfile
from contextlib import redirect_stderr
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = ROOT / "scripts" / "build_realtor_inventory_co.py"
COMMITTED = ROOT / "data" / "market" / "realtor_inventory_co.json"


def load_module():
    spec = importlib.util.spec_from_file_location("build_realtor_inventory_co", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


COUNTY_HEAD = ("month_date_yyyymm,county_fips,county_name,median_listing_price,median_listing_price_yy,"
               "active_listing_count,active_listing_count_yy,median_days_on_market,median_days_on_market_yy,"
               "new_listing_count,pending_listing_count,median_listing_price_per_square_foot,"
               "price_reduced_share,price_reduced_share_yy,quality_flag")
ZIP_HEAD = COUNTY_HEAD.replace("county_fips,county_name", "postal_code,zip_name")


def county_csv(n: int, blank_dom_for: str | None = None) -> str:
    # The first n of Colorado's real counties, named as Realtor.com names them ("chaffee, co").
    canon = sorted(json.loads((ROOT / "data" / "co-county-boundaries.json").read_text())["features"],
                   key=lambda f: f["properties"]["GEOID"])
    rows = [COUNTY_HEAD]
    for i, f in enumerate(canon[:n]):
        fips, name = f["properties"]["GEOID"], f["properties"]["NAME"].lower()
        dom = "" if blank_dom_for in (fips, "all") else "90.0"
        rows.append(f'202609,{fips},"{name}, co",500000.0,-0.02,120,0.25,{dom},0.1,10,8,300.0,0.2,0.05,{i % 2}')
    rows.append('202609,49037,"san juan, ut",452250.0,0.0095,30,-0.3,124.0,0.68,6,11,227.0,0.09,0.02,0')
    return "\n".join(rows) + "\n"


def zip_csv(n: int = 400) -> str:
    rows = [ZIP_HEAD, '202609,80012,"aurora, co",290750.0,-0.1,188,0.02,58.0,-0.11,52,40,222.0,0.33,0.06,1']
    rows += [f'202609,{81000 + i},"town {i}, co",300000.0,0.0,20,0.0,60.0,0.0,5,4,200.0,0.1,0.0,0' for i in range(n - 1)]
    rows.append('202609,84101,"salt lake city, ut",400000.0,0.0,100,0.0,40.0,0.0,20,10,250.0,0.1,0.0,0')
    return "\n".join(rows) + "\n"


def run(module, county_text: str, out: Path, zip_text: str | None = None) -> int:
    with tempfile.TemporaryDirectory() as tmp:
        c, z = Path(tmp, "c.csv"), Path(tmp, "z.csv")
        c.write_text(county_text)
        z.write_text(zip_csv() if zip_text is None else zip_text)
        module.OUT = out
        module.REPO_ROOT = out.parent
        import sys
        argv = sys.argv
        sys.argv = ["x", "--county", str(c), "--zip", str(z)]
        try:
            with redirect_stderr(io.StringIO()):
                return module.main()
        finally:
            sys.argv = argv


def test_parse_keeps_colorado_and_nulls_blanks():
    m = load_module()
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp, "realtor.json")
        assert run(m, county_csv(64, blank_dom_for="08003"), out) == 0
        d = json.loads(out.read_text())
        assert d["meta"]["month"] == "2026-09"
        assert len(d["counties"]) == 64 and "49037" not in d["counties"]
        assert len(d["zips"]) == 400 and "80012" in d["zips"] and "84101" not in d["zips"]
        assert d["counties"]["08003"]["median_days_on_market"] is None, "a blank cell must stay null, never zero"
        c = d["counties"]["08001"]
        assert c["active_listings"] == 120 and c["active_listings_yy_pct"] == 25.0
        assert c["price_reduced_share_pct"] == 20.0 and c["price_reduced_share_yy_pts"] == 5.0
        assert d["counties"]["08003"]["quality_flag"] == 1 and c["quality_flag"] == 0


def test_bad_month_keeps_committed_file():
    m = load_module()
    bad = {
        "a county missing": (county_csv(63), None),
        "an unknown county in place of Broomfield": (county_csv(64).replace("202609,08014,", "202609,08127,"), None),
        "a county under another name": (county_csv(64).replace('"broomfield, co"', '"brumfield, co"'), None),
        "an empty ZIP file": (county_csv(64), ZIP_HEAD + "\n"),
        "a month that is not a calendar month": (county_csv(64).replace("202609,", "202613,"),
                                                 zip_csv().replace("202609,", "202613,")),
        "a ZIP file from another month": (county_csv(64), zip_csv().replace("202609,", "202608,")),
        "a renamed metric column": (county_csv(64).replace("median_days_on_market,", "days_on_market,", 1), None),
        "a blank metric column": (county_csv(64, blank_dom_for="all"), None),
    }
    for name, (county_text, zip_text) in bad.items():
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp, "realtor.json")
            out.write_text("kept\n")
            assert run(m, county_text, out, zip_text) == 1, name
            assert out.read_text() == "kept\n", f"{name} must not overwrite the committed file"


def test_older_month_keeps_committed_file():
    m = load_module()
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp, "realtor.json")
        newer = json.dumps({"meta": {"month": "2026-10"}})
        out.write_text(newer)
        assert run(m, county_csv(64), out) == 1, "September must not replace a committed October"
        assert out.read_text() == newer
        out.write_text(json.dumps({"meta": {"month": "2026-09"}}))
        assert run(m, county_csv(64), out) == 0, "a re-run of the same month is fine"


def test_committed_file_shape():
    d = json.loads(COMMITTED.read_text())
    m = load_module()
    keys = [k for k, _, _ in m.FIELDS] + ["name", "quality_flag"]
    assert len(d["counties"]) == m.CO_COUNTIES, "a statewide file carries all 64 counties"
    assert len(d["zips"]) >= m.MIN_ZIPS
    for geo in ("counties", "zips"):
        for code, row in d[geo].items():
            assert sorted(row) == sorted(keys), f"{geo} {code} fields"
            for k in keys[:-2]:
                assert row[k] is None or isinstance(row[k], (int, float)), f"{geo} {code} {k}"
    assert all(code.startswith("08") for code in d["counties"])


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
