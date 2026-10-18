#!/usr/bin/env python3
"""Build data/hna/acs-reliability.json: the margin of error behind each ACS
headline figure the HNA pages show, and how reliable that makes it.

The summaries in data/hna/summary/ store ACS estimates without their margins
of error, and do not reliably record which ACS series (1-year or 5-year) each
one came from: build_hna_data.py tries acs1 first and falls back to acs5, and
the _acsSeries stamp is written by a later backfill, not by the fetch. So this
builder fetches both series for the summaries' vintage and, for each figure,
uses the series whose published estimate equals the stored one. A figure that
matches neither gets no margin and a stated reason, never a guessed one.

The rule (Census Bureau, Understanding and Using American Community Survey
Data, 2020, ch. 7-8): CV = (MOE / 1.645) / estimate, from the 90% margin.
Tiers follow the Washington OFM ACS user guide convention: CV <= 15% good,
15-30% fair, > 30% use with caution. The Census handbook itself says there are
no hard-and-fast rules, so the tier is a reading aid, not a test.

Usage:
  CENSUS_API_KEY=... python3 scripts/hna/build_acs_reliability.py
  CENSUS_API_KEY=... python3 scripts/hna/build_acs_reliability.py --dry
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUMMARY_DIR = ROOT / "data" / "hna" / "summary"
OUT = ROOT / "data" / "hna" / "acs-reliability.json"

# Headline figures on the HNA page (js/hna/hna-renderers.js stat cards and the
# tenure / housing-gap inputs). Each key is the summary key; the margin is the
# same name with E -> M (PE -> PM), which is how the Census API names it.
PROFILE_VARS = {
    "DP05_0001E": "Population",
    "DP03_0062E": "Median household income",
    "DP04_0089E": "Median home value (owner-occupied)",
    "DP04_0134E": "Median gross rent",
    "DP04_0001E": "Housing units",
    "DP04_0046E": "Owner-occupied households",
    "DP04_0047E": "Renter-occupied households",
    "DP04_0046PE": "Owner-occupied share (%)",
    "DP04_0047PE": "Renter-occupied share (%)",
    "DP04_0141PE": "Renters paying 30-34.9% of income (%)",
    "DP04_0142PE": "Renters paying 35%+ of income (%)",
}
SUBJECT_VARS = {
    "S0801_C01_046E": "Mean travel time to work (minutes)",
}
# The home value a page shows where no Zillow index covers the place is the
# cascade's raw ACS floor, acsProfile.median_home_value with source acs_raw.
# It is a copy of DP04_0089E taken when data/hna/home-value-cascade.json was
# last built, so after an ACS refresh it can be another vintage than the
# stored DP04_0089E (Crisman CDP on 2026-10-17: 924,500 shown, 846,600
# stored). It gets its own entry, matched like any stored figure. A Zillow or
# county-adjusted value is not an ACS estimate and gets none.
SHOWN = {
    "median_home_value": {
        "label": "Median home value shown, where it is the raw ACS figure",
        "var": "DP04_0089E",
    },
}
# Figures the page computes from two published ones. Sums use the Census
# approximation MOE = sqrt(sum of squared component MOEs) (handbook ch. 8).
DERIVED = {
    "rent_burden_30plus": {
        "label": "Renters paying 30%+ of income (%)",
        "sum_of": ["DP04_0141PE", "DP04_0142PE"],
    },
}

SERIES = ("acs1", "acs5")
Z90 = 1.645
TIERS = (
    (0.15, "good"),
    (0.30, "fair"),
)
CAUTION = "use_with_caution"
# Census special values. -555555555 marks an estimate controlled to an
# independent total, so it has no sampling error; the rest mean "not
# available", and must never be read as a margin.
CONTROLLED = -555555555
# What census_get returns for HTTP 404: the API has no such dataset, as for
# the 2020 ACS 1-year, which the Census Bureau did not release (pandemic data
# collection), or a year not yet published. That is not a failed request.
NOT_PUBLISHED = "not published"


def moe_name(var: str) -> str:
    if var.endswith("PE"):
        return var[:-2] + "PM"
    return var[:-1] + "M"


def to_number(value):
    """A finite number, or None. None, '', and Census sentinels are None."""
    if value is None or isinstance(value, bool):
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(n):
        return None
    if n <= -100000000:  # Census annotation codes (-666666666 etc.)
        return None
    return n


def tier_for(estimate, moe):
    """(cv, tier, reason). cv is None when it cannot be computed."""
    if moe is None or estimate is None:
        return None, None, "no margin of error"
    if moe == 0:
        return 0.0, "good", None
    if estimate == 0:
        return None, "zero_in_sample", (
            "estimate is 0 in the sample; the margin says how many there could be"
        )
    if estimate < 0:
        return None, None, "negative estimate"
    cv = (moe / Z90) / estimate
    for limit, name in TIERS:
        if cv <= limit:
            return round(cv, 4), name, None
    return round(cv, 4), CAUTION, None


def tolerance(var: str) -> float:
    # Percentages are published to one decimal; counts, dollars and minutes
    # to the unit (travel time to one decimal).
    return 0.051 if var.endswith("PE") or var.startswith("S0801") else 0.51


def census_get(url: str, key: str = ""):
    """Rows from the Census API, [] when it has no geography to report (HTTP
    204, as ACS 1-year does for a level with none over 65,000 people),
    NOT_PUBLISHED when the dataset does not exist (HTTP 404), or None when the
    request failed. url never carries the key, so it is safe to log; the key
    is added only to the request itself."""
    full = url + ("&key=" + urllib.parse.quote(key) if key else "")
    req = urllib.request.Request(full, headers={"User-Agent": "coho-acs-reliability"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            status = r.status
            body = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"  not published (HTTP 404): {url}", file=sys.stderr)
            return NOT_PUBLISHED
        print(f"  HTTP {e.code} for {url}", file=sys.stderr)
        return None
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"  network error ({type(e).__name__}) for {url}", file=sys.stderr)
        return None
    if status == 204 or not body.strip():
        return []
    try:
        rows = json.loads(body)
    except json.JSONDecodeError:
        print(f"  non-JSON response for {url}", file=sys.stderr)
        return None
    if not isinstance(rows, list):
        return None
    return rows


def fetch_level(year, series, table, variables, level, key, getter=census_get):
    """{geoid: {var: value}} for one series, table and geography level, or
    None when the Census Bureau publishes no such dataset."""
    gets = []
    for v in variables:
        gets += [v, moe_name(v)]
    base = f"https://api.census.gov/data/{year}/acs/{series}"
    if table == "subject":
        base += "/subject"
    elif table == "profile":
        base += "/profile"
    geo = {"state": "for=state:08", "county": "for=county:*&in=state:08",
           "place": "for=place:*&in=state:08"}[level]
    url = f"{base}?get={','.join(gets)}&{geo}"
    rows = getter(url, key)
    if rows == NOT_PUBLISHED:
        return None
    if rows is None:
        # One failed request would leave every figure at that level without a
        # margin, and the commit would replace good margins with nulls.
        raise SystemExit(f"{table} {series} {level} request failed; writing nothing")
    if len(rows) < 2:
        return {}
    head = rows[0]
    out = {}
    for row in rows[1:]:
        rec = dict(zip(head, row))
        if level == "state":
            gid = "08"
        elif level == "county":
            gid = "08" + rec.get("county", "")
        else:
            gid = "08" + rec.get("place", "")
        out[gid] = rec
    return out


def level_of(geoid: str) -> str:
    return {2: "state", 5: "county", 7: "place"}.get(len(geoid), "")


def fallback_years(start):
    """The years build_hna_data.py tries, newest first: ACS_START_YEAR and
    ACS_FALLBACK_YEARS - 1 years before it (same env defaults as that file).
    Its profile fetch does not stamp the year it settled on, so any of these
    can be the true vintage of a stored figure."""
    n = int(os.environ.get("ACS_FALLBACK_YEARS", "3"))
    return [start - i for i in range(max(n, 1))]


def match_source(stored, var, cands, geoid, prefer=None, stamped=None):
    """Pick the (year, series) whose published estimate equals the stored one.

    cands = {(year, series): {geoid: rec}}. On a tie (common for a rounded
    share, or a value unchanged between vintages) take the source population
    matched, since one fetch carries both; then the stamped year; then the
    wider margin, so a tie can only make a figure look less reliable.
    """
    hits = []
    for src, by_geo in cands.items():
        rec = by_geo.get(geoid)
        if not rec:
            continue
        pub = to_number(rec.get(var))
        if pub is not None and abs(pub - stored) <= tolerance(var):
            hits.append(src)
    if not hits:
        return None
    if len(hits) == 1:
        return hits[0]
    if prefer in hits:
        return prefer
    at_stamp = [h for h in hits if h[0] == stamped]
    if len(at_stamp) == 1:
        return at_stamp[0]
    pool = at_stamp or hits

    def width(src):
        m = to_number(cands[src][geoid].get(moe_name(var)))
        return -1 if m is None else m
    return max(pool, key=width)


def stored_year(block):
    """The block's own _acsYear stamp, or None. It says which year to try
    first, not which year the figure came from: that is what matching finds."""
    y = (block or {}).get("_acsYear")
    if y is not None and str(y).isdigit() and len(str(y)) == 4:
        return int(y)
    return None


def published_entry(estimate, raw_m, series, y):
    """{e, m, s, y, cv, t[, why]} for a published estimate and its raw margin."""
    try:
        controlled = raw_m is not None and int(float(raw_m)) == CONTROLLED
    except (TypeError, ValueError):
        controlled = False
    moe = 0.0 if controlled else to_number(raw_m)
    cv, tier, why = tier_for(estimate, moe)
    entry = {"e": estimate, "m": moe, "s": series, "y": y, "cv": cv, "t": tier}
    if controlled:
        entry["why"] = "controlled to an independent total; no sampling error"
    elif why:
        entry["why"] = why
    return entry


def five_year_twin(var, cands, geoid, y):
    """The ACS 5-year estimate ending in the same year as a 1-year figure, with
    its margin: the series every smaller geography has, so a page can show how
    far the 1-year figure is from it. None when the 5-year has no estimate."""
    rec = cands.get((y, "acs5"), {}).get(geoid)
    estimate = to_number((rec or {}).get(var))
    if estimate is None:
        return None
    return published_entry(estimate, rec.get(moe_name(var)), "acs5", y)


def matched_entry(stored, var, cands, geoid, prefer, stamped):
    """A stored figure's entry: the margin of the published estimate it equals,
    or no margin and the reason. A 1-year figure also carries its 5-year twin
    (five)."""
    src = match_source(stored, var, cands, geoid, prefer, stamped)
    if src is None:
        tried = sorted({y for y, _ in cands}, reverse=True)
        return {"e": stored, "m": None, "s": None, "cv": None, "t": None,
                "why": ("stored value matches no published ACS 1-year or "
                        f"5-year estimate for {', '.join(map(str, tried))}")}
    y, series = src
    entry = published_entry(stored, cands[src][geoid].get(moe_name(var)), series, y)
    if series == "acs1":
        five = five_year_twin(var, cands, geoid, y)
        if five is not None:
            entry["five"] = five
    return entry


def build_record(geoid, summary, published, year):
    """One geography's figures. published[table] = {(year, series): {geoid: rec}}."""
    rec = {}
    blocks = {"profile": summary.get("acsProfile") or {},
              "subject": summary.get("acsS0801") or {}}
    stamps = {"profile": stored_year(blocks["profile"]) or year,
              "subject": stored_year(blocks["subject"])}
    # The source population matched is the tie-break for the profile figures:
    # one fetch batch carries population with the headline values.
    pop_stored = to_number(blocks["profile"].get("DP05_0001E"))
    prefer = None
    if pop_stored is not None:
        prefer = match_source(pop_stored, "DP05_0001E", published["profile"], geoid,
                              stamped=stamps["profile"])

    for table, variables in (("profile", PROFILE_VARS), ("subject", SUBJECT_VARS)):
        for var in variables:
            stored = to_number(blocks[table].get(var))
            if stored is None:
                rec[var] = {"e": None, "m": None, "s": None, "cv": None, "t": None,
                            "why": "no estimate stored for this geography"}
                continue
            rec[var] = matched_entry(stored, var, published[table], geoid,
                                     prefer if table == "profile" else None, stamps[table])

    for name, spec in SHOWN.items():
        shown = blocks["profile"].get(name)
        if not isinstance(shown, dict) or shown.get("source") != "acs_raw":
            continue
        stored = to_number(shown.get("value"))
        if stored is None:
            rec[name] = {"e": None, "m": None, "s": None, "cv": None, "t": None,
                         "why": "no estimate stored for this geography"}
            continue
        rec[name] = matched_entry(stored, spec["var"], published["profile"], geoid,
                                  prefer, stamps["profile"])

    for name, spec in DERIVED.items():
        parts = [rec.get(v) or {} for v in spec["sum_of"]]
        if any(p.get("e") is None for p in parts):
            rec[name] = {"e": None, "m": None, "s": None, "cv": None, "t": None,
                         "why": "a component has no estimate"}
            continue
        est = round(sum(p["e"] for p in parts), 1)
        series = {(p.get("y"), p.get("s")) for p in parts}
        if any(p.get("m") is None for p in parts):
            rec[name] = {"e": est, "m": None, "s": None, "cv": None, "t": None,
                         "why": "a component has no margin"}
            continue
        if len(series) != 1:
            # A 1-year and a 5-year margin describe different samples, so
            # their root sum of squares is not the margin of anything.
            rec[name] = {"e": est, "m": None, "s": None, "cv": None, "t": None,
                         "why": "components come from different ACS series or years"}
            continue
        moe = round(math.sqrt(sum(p["m"] ** 2 for p in parts)), 1)
        cv, tier, why = tier_for(est, moe)
        y, ser = series.pop()
        entry = {"e": est, "m": moe, "s": ser, "y": y, "cv": cv, "t": tier}
        if why:
            entry["why"] = why
        fives = [p.get("five") for p in parts]
        if ser == "acs1" and all(f and f.get("m") is not None for f in fives):
            est5 = round(sum(f["e"] for f in fives), 1)
            moe5 = round(math.sqrt(sum(f["m"] ** 2 for f in fives)), 1)
            cv5, tier5, why5 = tier_for(est5, moe5)
            entry["five"] = {"e": est5, "m": moe5, "s": "acs5", "y": y, "cv": cv5, "t": tier5}
            if why5:
                entry["five"]["why"] = why5
        rec[name] = entry
    return rec


def summaries():
    out = {}
    for path in sorted(SUMMARY_DIR.glob("*.json")):
        gid = path.stem
        if not gid.isdigit() or level_of(gid) == "":
            continue  # skips iCloud duplicates such as '08001 2'
        out[gid] = json.loads(path.read_text())
    return out


def vintage_of(all_summaries):
    """The newest ACS year the summaries are stamped with. A geography whose
    profile fell back to an older year keeps that stamp; its year is among the
    fallback years fetched from here, so matching still finds its figures."""
    years = set()
    for s in all_summaries.values():
        y = (s.get("acsProfile") or {}).get("_acsYear")
        if y is not None and str(y).isdigit() and len(str(y)) == 4:
            years.add(int(y))
    if not years:
        raise SystemExit("summaries carry no ACS year")
    newest = max(years)
    if not years <= set(fallback_years(newest)):
        raise SystemExit(f"summaries carry ACS years {sorted(years)}; "
                         f"more than build_hna_data.py's fallback window from {newest}")
    return newest


def build(all_summaries, year, key, getter=census_get):
    # Each table is fetched at every year build_hna_data.py could have settled
    # on, for the geographies that need it; matching then finds the source.
    tables = {"profile": PROFILE_VARS, "subject": SUBJECT_VARS}
    years = {"profile": set(fallback_years(year)), "subject": set()}
    for s in all_summaries.values():
        y = stored_year(s.get("acsS0801"))
        if y is not None:
            years["subject"].update(fallback_years(y))
    levels = sorted({level_of(g) for g in all_summaries})
    published = {t: {} for t in tables}
    not_published = set()
    for table, variables in tables.items():
        for y in sorted(years[table], reverse=True):
            for series in SERIES:
                got = {}
                for level in levels:
                    lv = fetch_level(y, series, table, list(variables), level, key, getter)
                    if lv is None:
                        not_published.add(f"{y} {series} {table}")
                        print(f"  {table} {y} {series} {level}: not published")
                        continue
                    print(f"  {table} {y} {series} {level}: {len(lv)} geographies")
                    got.update(lv)
                published[table][(y, series)] = got
    # The 5-year tables publish every geography, so a short response at the
    # stamped year means a truncated or wrong request, not missing data. This
    # also stops the build when the stamped year itself is not published.
    for table in tables:
        for gid, s in all_summaries.items():
            block = s.get("acsProfile" if table == "profile" else "acsS0801")
            y = stored_year(block) or (year if table == "profile" else None)
            if y is not None and gid not in published[table].get((y, "acs5"), {}):
                raise SystemExit(f"ACS {y} 5-year {table} lacks {gid}; writing nothing")

    geos = {gid: build_record(gid, s, published, year) for gid, s in all_summaries.items()}
    counts = {}
    for r in geos.values():
        for var, e in r.items():
            t = e.get("t") or "no_margin"
            counts.setdefault(var, {}).setdefault(t, 0)
            counts[var][t] += 1
    labels = {**PROFILE_VARS, **SUBJECT_VARS,
              **{k: v["label"] for k, v in SHOWN.items()},
              **{k: v["label"] for k, v in DERIVED.items()}}
    return {
        "meta": {
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "acs_year": year,
            "source": f"U.S. Census Bureau, American Community Survey 1-year and "
                      f"5-year data profiles (DP02-DP05, {', '.join(str(y) for y in sorted(years['profile']))}) and subject table S0801 "
                      f"(at each summary's stored year: "
                      f"{', '.join(str(y) for y in sorted(years['subject']))}), "
                      f"via api.census.gov",
            "margin": "90% margin of error as published",
            "cv_formula": "CV = (MOE / 1.645) / estimate",
            "tiers": {"good": "CV <= 15%", "fair": "CV > 15% and <= 30%",
                      "use_with_caution": "CV > 30%",
                      "zero_in_sample": "estimate is 0; CV undefined"},
            "tier_source": "Washington State Office of Financial Management, ACS user "
                           "guide; the Census Bureau handbook (2020) states there are "
                           "no hard-and-fast rules",
            "series_rule": "each figure uses the series (s) whose published estimate "
                           "equals the stored one; a figure matching neither has no "
                           "margin and a reason (why)",
            "not_published": sorted(not_published),
            "derived": {k: f"sum of {' + '.join(v['sum_of'])}; MOE = root sum of squares"
                        for k, v in DERIVED.items()},
            "shown": {k: f"acsProfile.{k}.value where its source is acs_raw, matched "
                         f"against published {v['var']}" for k, v in SHOWN.items()},
            "variables": labels,
            "tier_counts": counts,
            "fields": {"e": "estimate as stored in data/hna/summary", "m": "90% MOE",
                       "s": "ACS series", "y": "ACS year of the estimate", "cv": "coefficient of variation",
                       "t": "tier", "why": "reason when m or t is absent or special",
                       "five": "for a 1-year figure, the ACS 5-year estimate ending the same "
                               "year, with its own e, m, s, y, cv and t"},
        },
        "geos": geos,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry", action="store_true", help="print counts, write nothing")
    args = ap.parse_args(argv)
    key = os.environ.get("CENSUS_API_KEY", "").strip()
    if not key:
        raise SystemExit("CENSUS_API_KEY required (the Census API refuses keyless requests)")
    all_summaries = summaries()
    year = vintage_of(all_summaries)
    print(f"{len(all_summaries)} summaries, ACS {year}")
    doc = build(all_summaries, year, key)
    for var, c in doc["meta"]["tier_counts"].items():
        print(f"  {var}: {c}")
    if args.dry:
        return 0
    OUT.write_text(json.dumps(doc, separators=(",", ":"), sort_keys=True) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
