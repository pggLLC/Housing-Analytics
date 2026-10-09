#!/usr/bin/env python3
"""Rebuild data/market/colorado-foreclosure-performance.json from FHFA NMDB.

FHFA publishes the National Mortgage Database state-level quarterly
Residential Mortgage Performance Statistics as one CSV inside a ZIP. Each
release revises earlier quarters, so the whole series is rebuilt, never
appended to. Only the series, the summary and the release dates change; the
file's methodology and verification notes are kept as written.

Usage:
  python3 scripts/market/build_colorado_foreclosure_performance.py
  python3 scripts/market/build_colorado_foreclosure_performance.py --zip path/to/download.zip
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import pathlib
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "market" / "colorado-foreclosure-performance.json"
SERIES = {
    "foreclosure_process_pct": "PFORECL",
    "serious_delinquency_pct": "P90DL",
    "early_delinquency_pct": "P3089DL",
}


def read_rows(zip_bytes: bytes) -> list[dict]:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if len(names) != 1:
            raise SystemExit(f"expected one CSV in the NMDB zip, found {names}")
        text = zf.read(names[0]).decode("utf-8-sig")
    return [r for r in csv.DictReader(io.StringIO(text))
            if r["GEOID"] == "CO" and r["MARKET"] == "All Mortgages"]


def tidy(value: float) -> float | int:
    """Write 0.0 as 0, as the committed file does."""
    return int(value) if float(value).is_integer() else value


def points_for(rows: list[dict], series_id: str) -> list[dict]:
    points = []
    for r in rows:
        if r["SERIESID"] != series_id:
            continue
        suppressed = r["SUPPRESSED"].strip() not in ("", "0")
        raw = r["VALUE1"].strip()
        # A suppressed or blank value is unknown: null, never 0.
        value = None if suppressed or raw == "" else float(raw)
        if value is not None and value.is_integer():
            value = int(value)
        points.append({"period": r["PERIOD"], "year": int(r["YEAR"]), "quarter": int(r["QUARTER"]),
                       "value_pct": value, "suppressed": suppressed})
    points.sort(key=lambda p: (p["year"], p["quarter"]))
    if not points:
        raise SystemExit(f"no Colorado All Mortgages rows for {series_id}")
    return points


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", help="use a downloaded NMDB zip instead of fetching it")
    args = ap.parse_args()
    doc = json.loads(OUT.read_text())
    meta = doc["meta"]
    if args.zip:
        data = pathlib.Path(args.zip).read_bytes()
        release = None
    else:
        req = urllib.request.Request(meta["source_url"], headers={"User-Agent": "Mozilla/5.0 (COHO data refresh)"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read()
            modified = resp.headers.get("Last-Modified")
        release = (dt.datetime.strptime(modified, "%a, %d %b %Y %H:%M:%S %Z").date().isoformat()
                   if modified else None)
    rows = read_rows(data)
    for key, series_id in SERIES.items():
        doc["series"][key]["points"] = points_for(rows, series_id)

    fc = doc["series"]["foreclosure_process_pct"]["points"]
    sd = doc["series"]["serious_delinquency_pct"]["points"]
    known = [p for p in fc if p["value_pct"] is not None]
    latest, latest_sd = fc[-1], sd[-1]
    peak = max(known, key=lambda p: p["value_pct"])
    y2019 = [p["value_pct"] for p in known if p["year"] == 2019]
    avg2019 = tidy(round(sum(y2019) / len(y2019), 2)) if len(y2019) == 4 else None
    s = doc["summary"]
    s.update({
        "latest_period": latest["period"],
        "latest_foreclosure_process_pct": latest["value_pct"],
        "latest_serious_delinquency_pct": latest_sd["value_pct"],
        "peak_foreclosure_process_pct": peak["value_pct"],
        "peak_foreclosure_process_period": peak["period"],
        "avg_2019_foreclosure_process_pct": avg2019,
        "foreclosure_process_vs_2019_delta_pct_points": (
            tidy(round(latest["value_pct"] - avg2019, 2))
            if latest["value_pct"] is not None and avg2019 is not None else None),
    })
    meta["data_through"] = latest["period"]
    for note in meta.get("verification_notes", []):
        if note.get("source") == "FHFA NMDB Aggregate Statistics":
            note["result"] = ("fetchable official page exposing Residential Mortgage Performance Statistics "
                              f"state quarterly CSV ZIP through {latest['period']}")
    if release:
        meta["source_release_date"] = release
    today = dt.date.today()
    meta["as_of"] = release or meta["as_of"]
    meta["last_verified"] = today.isoformat()
    meta["review_by"] = (today + dt.timedelta(days=90)).isoformat()
    # FHFA posts a quarter about one quarter after it ends, so the next one is
    # due by the end of the quarter after next.
    k = latest["year"] * 4 + (latest["quarter"] - 1) + 2
    meta["next_expected_update"] = f"{k // 4}-Q{k % 4 + 1}"
    OUT.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    print(f"{OUT.relative_to(ROOT)}: through {latest['period']}, PFORECL {latest['value_pct']}, P90DL {latest_sd['value_pct']}")


if __name__ == "__main__":
    main()
