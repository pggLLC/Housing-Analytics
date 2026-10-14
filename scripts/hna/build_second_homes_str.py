#!/usr/bin/env python3
"""Join second homes, short-term rentals, lodging taxes for housing and
workforce housing programs into one record per HNA geography.

Inputs (all committed, nothing fetched here):
  data/hna/vacancy-status.json            ACS B25004 seasonal/recreational/occasional vacant units
  data/hna/housing-units-b25001.json      ACS B25001 total housing units (same release)
  data/benchmarks/str-license-counts.json licensed short-term rentals from official registries
  data/policy/local-housing-funds.json    lodging_or_str_tax records (quoted, verified)
  data/policy/ballot-2026/**.json         lodging / short-term rental tax measures on the 2026 ballot
  data/resort-workforce-housing-programs.json  verified workforce housing programs
  data/hna/geo-config.json                names and containing counties

Output: data/hna/second-homes-str.json

Absence stays absent. A geography with no registry count gets
`str_licenses: null` and a reason, never 0; a share that cannot be computed is
null with a reason.

    python3 scripts/hna/build_second_homes_str.py           # write
    python3 scripts/hna/build_second_homes_str.py --check   # exit 1 if stale
"""

from __future__ import annotations

import glob
import json
import math
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "data", "hna", "second-homes-str.json")

LODGING_RE = re.compile(r"lodging|lodger|short[- ]term rental|accommodation", re.I)


def load(rel: str):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return json.load(fh)


def share_moe(x: int, mx: int, y: int, my: int) -> float:
    """ACS proportion MOE; falls back to the ratio formula when the radicand is negative."""
    p = x / y
    rad = mx ** 2 - (p ** 2) * (my ** 2)
    if rad < 0:
        rad = mx ** 2 + (p ** 2) * (my ** 2)
    return math.sqrt(rad) / y


def reliability(units: int, moe: int) -> str:
    if units <= 0:
        return "zero_estimate"
    cv = (moe / 1.645) / units
    if cv <= 0.15:
        return "reliable"
    if cv <= 0.30:
        return "use_with_caution"
    return "unreliable"


def seasonal_block(vac: dict | None, hu: dict | None) -> tuple[dict | None, str | None]:
    if not vac:
        return None, "No ACS B25004 vacancy record for this geography."
    units = vac.get("seasonal_recreational_occasional")
    moe = (vac.get("moe") or {}).get("seasonal_recreational_occasional")
    if units is None or moe is None:
        return None, "ACS B25004 seasonal count missing for this geography."
    total = hu.get("housing_units") if hu else None
    total_moe = hu.get("moe") if hu else None
    block = {
        "units": units,
        "moe": moe,
        "housing_units": total,
        "housing_units_moe": total_moe,
        "share_of_housing_units": None,
        "share_moe": None,
        "share_of_vacant": vac.get("seasonal_share_of_vacant"),
        "reliability": reliability(units, moe),
    }
    reason = None
    if not total or total <= 0 or total_moe is None:
        reason = "ACS B25001 total housing units unavailable, so no share is computed."
    else:
        block["share_of_housing_units"] = round(units / total, 4)
        block["share_moe"] = round(share_moe(units, moe, total, total_moe), 4)
    return block, reason


def lodging_records(funds: dict) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for e in funds["entries"]:
        if e.get("tool") != "lodging_or_str_tax":
            continue
        out.setdefault(e["geoid"], []).append({
            "id": e["id"],
            "geoid": e["geoid"],
            "jurisdiction": e["jurisdiction"],
            "status": e["status"],
            "rate_text": e.get("rate_text") or None,
            "uses": e.get("uses") or None,
            "summary": e["summary"],
            "source_label": (e.get("source") or {}).get("label"),
            "source_url": (e.get("source") or {}).get("url"),
            "checked": (e.get("verification") or {}).get("checked"),
            "verification_level": (e.get("verification") or {}).get("level"),
        })
    return out


def ballot_records() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "policy", "ballot-2026", "**", "*.json"), recursive=True)):
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        for m in doc.get("entries", []) if isinstance(doc, dict) else []:
            meas = m.get("measure") or {}
            text = " ".join(str(x or "") for x in (
                meas.get("official_title"), m.get("neutral_title"), m.get("detail"),
                (meas.get("fiscal") or {}).get("mechanism")))
            if not LODGING_RE.search(text):
                continue
            jur = m.get("jurisdiction") or {}
            srcs = m.get("sources") or {}
            url = next((s.get("url") for s in srcs.values() if isinstance(s, dict) and s.get("url")), None)
            out.setdefault(jur.get("geoid"), []).append({
                "id": m["id"],
                "geoid": jur.get("geoid"),
                "jurisdiction": jur.get("name"),
                "measure_number": meas.get("number"),
                "title": m.get("neutral_title"),
                "detail": m.get("detail") or None,
                "status": m.get("status"),
                "election_date": (m.get("election") or {}).get("date"),
                "source_url": url,
            })
    return out


def program_index(resort: dict) -> list[dict]:
    """Authorities with at least one sourced program, as references."""
    out = []
    for a in resort.get("authorities", []):
        verified = [p for p in a.get("key_programs", []) if p.get("source_url") and p.get("evidence")]
        if not verified:
            continue
        out.append({"authority_id": a["id"], "name": a["name"], "url": a.get("url"),
                    "programs": [p["name"] for p in verified],
                    "_places": a.get("place_geoids", []), "_county": a.get("county_fips"),
                    "_scope": a.get("scope")})
    return out


def programs_for(index: list[dict], geoid: str, level: str, county: str | None) -> list[dict]:
    """Same rule as js/components/resort-wfh.js: a town's own authority, or a
    county-wide one covering its county; a county gets every authority in it."""
    hits = []
    for a in index:
        if level == "county":
            ok = a["_county"] == geoid
        else:
            ok = geoid in a["_places"] or (a["_scope"] == "county" and a["_county"] == county)
        if ok:
            hits.append({k: v for k, v in a.items() if not k.startswith("_")})
    return hits


def build() -> dict:
    vacancy = load("data/hna/vacancy-status.json")
    units = load("data/hna/housing-units-b25001.json")
    strs = load("data/benchmarks/str-license-counts.json")
    funds = load("data/policy/local-housing-funds.json")
    resort = load("data/resort-workforce-housing-programs.json")
    geo = load("data/hna/geo-config.json")

    geos: list[tuple[str, str, str, str | None]] = []
    for c in geo["counties"]:
        geos.append((c["geoid"], c["label"], "county", None))
    for p in geo["places"]:
        geos.append((p["geoid"], p["label"], "place", p.get("containingCounty")))
    for p in geo["cdps"]:
        geos.append((p["geoid"], p["label"], "cdp", p.get("containingCounty")))

    str_by = {e["geoid"]: e for e in strs["entries"]}
    lodging = lodging_records(funds)
    ballots = ballot_records()
    progs = program_index(resort)
    county_of = {g: c for g, _n, _l, c in geos if c}

    records: dict[str, dict] = {}
    for geoid, label, level, county in sorted(geos):
        vac = vacancy["geographies"].get(geoid)
        seasonal, seasonal_reason = seasonal_block(vac, units["geographies"].get(geoid))
        lic = str_by.get(geoid)
        rec = {
            "geoid": geoid,
            "name": label,
            "level": level,
            "county_geoid": county,
            "seasonal_homes": seasonal,
            "seasonal_homes_unavailable_reason": seasonal_reason,
            "str_licenses": None if not lic else {
                "units": lic["licensed_str_units"],
                "as_of": lic["as_of"],
                "scope": lic.get("scope") or lic.get("geography_level"),
                "source_url": lic["source_url"],
                "source_note": lic["source_note"],
            },
            "lodging_taxes": lodging.get(geoid, []),
            "county_lodging_taxes": lodging.get(county, []) if county else [],
            "ballot_measures": ballots.get(geoid, []),
            "county_ballot_measures": ballots.get(county, []) if county else [],
            "workforce_programs": programs_for(progs, geoid, level, county),
        }
        if level == "county":
            inner = sorted(g for g, c in county_of.items() if c == geoid)
            rec["places_with_lodging_taxes"] = [r for g in inner for r in lodging.get(g, [])]
            rec["places_with_ballot_measures"] = [r for g in inner for r in ballots.get(g, [])]
        # Empty lists carry no information; leave them out to keep the file small.
        records[geoid] = {k: v for k, v in rec.items() if v != []}

    return {
        "meta": {
            "schema": "second-homes-str/v1",
            "built_by": "scripts/hna/build_second_homes_str.py",
            "acs_release": units["meta"].get("release"),
            "sources": {
                "seasonal_homes": "ACS B25004_006 (vacant: seasonal, recreational or occasional use) via data/hna/vacancy-status.json",
                "housing_units": "ACS B25001 via data/hna/housing-units-b25001.json",
                "str_licenses": "data/benchmarks/str-license-counts.json (official registry counts only)",
                "lodging_taxes": "data/policy/local-housing-funds.json, tool lodging_or_str_tax",
                "ballot_measures": "data/policy/ballot-2026",
                "workforce_programs": "data/resort-workforce-housing-programs.json (programs with a source quote only)",
            },
            "method": (
                "Seasonal homes are ACS vacant units held for seasonal, recreational or occasional use; "
                "the Census counts a second home here when nobody lives in it most of the year. Share is that "
                "count divided by all housing units, with the ACS proportion margin of error. Reliability is the "
                "count's coefficient of variation: up to 15% reliable, up to 30% use with caution, above that unreliable. "
                "Short-term rental license counts are a different universe and date from ACS and are not added to it."
            ),
            "unavailable_reasons": {
                "str_licenses": "No official short-term rental license count has been found for this jurisdiction yet. "
                                "This is not a count of zero.",
            },
            "geography_count": len(records),
            "str_license_count_geographies": sum(1 for r in records.values() if r["str_licenses"]),
        },
        "geographies": records,
    }


def serialize(doc: dict) -> str:
    """Meta pretty-printed, then one geography per line: small to fetch, readable in a diff."""
    meta = json.dumps(doc["meta"], indent=2, ensure_ascii=False)
    rows = ",\n".join(
        f"    {json.dumps(k)}: {json.dumps(v, ensure_ascii=False, separators=(',', ':'))}"
        for k, v in doc["geographies"].items())
    return '{\n  "meta": ' + meta.replace("\n", "\n  ") + ',\n  "geographies": {\n' + rows + "\n  }\n}\n"


def main() -> int:
    text = serialize(build())
    if "--check" in sys.argv:
        with open(OUT, encoding="utf-8") as fh:
            if fh.read() != text:
                print("data/hna/second-homes-str.json is stale; run python3 scripts/hna/build_second_homes_str.py", file=sys.stderr)
                return 1
        print("second-homes-str.json is current")
        return 0
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"Wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
