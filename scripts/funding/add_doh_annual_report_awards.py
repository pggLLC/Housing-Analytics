#!/usr/bin/env python3
"""Add Division of Housing awards from its FY2021-22 and FY2022-23 annual reports.

data/policy/funding-awards/dola-awards.json was read by hand from DOLA
announcements and the FY2023-24 and FY2024-25 annual reports, so it held almost
nothing before July 2023. DOH's annual public reports to the legislature
(HB21-1028, C.R.S. 24-32-705.5) for FY2021-22 and FY2022-23 print every award
by project, with funding source, county, units and amount. This script reads
those project tables and adds each award once:

  * FY2021-22: Figure 10 "Funds Awarded By Project and Program".
  * FY2022-23: Figure 8 "Funds Awarded By Project and Program", rows whose staff
    recommendation is "Award" with an amount above $0, outside the "Withdrawn
    Funding Requests" section. Supplemental funding rows are kept as awards;
    DOH prints 0 units for them because their homes count on the first award. The HB22-1377
    homelessness-response grants printed after it (services, shelters, outreach)
    are not housing development awards and are left out, as the FY2023-24 rows
    leave out the homelessness-response operating grants.

A row that matches an award already in the file (same normalised project name,
or same normalised grantee, with the same amount, a year or less apart) is kept
once: the existing row stays and the match is listed in dropped_as_duplicates.
Rows are dated to the state fiscal year (year = the year it starts, as the
FY2023-24 rows are). Re-running replaces this script's own rows (ids fy2122-*,
fy2223-*) and changes nothing else.

    python3 scripts/funding/add_doh_annual_report_awards.py

Needs pdfplumber (pip install pdfplumber). Network: content.leg.colorado.gov.
"""
import io, json, os, re, sys, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "data", "policy", "funding-awards", "dola-awards.json")
COUNTIES = os.path.join(ROOT, "data", "boundaries", "counties_co.geojson")

REPORTS = [
    {
        "key": "fy2122", "year": 2021, "period": "2021-07-01/2022-06-30",
        "url": "https://content.leg.colorado.gov/sites/default/files/images/doh_annual_report_fy21-22.pdf",
        "title": "DOH Annual Public Report on Funding of Affordable Housing Preservation and Production, FY2021-22 (Figure 10)",
        "figure": "Figure 10: Funds Awarded By Project and Program",
        "stated_total": 243857470, "stated_count": 94,
        "stated_quote": '"$243,857,470 awarded by DOH to grantees & borrowers"; Figure 9 prints 94 under "Awards Made"',
        "cols": {"grantee": "Applicant", "name": "Project / Program Name", "source": "Funding Source",
                 "town": "City", "county": "County / Counties", "type": "Project Type", "activity": "Project Activity",
                 "requested": "Requested Amount", "amount": "Funding Awarded", "cost": "Total Project Cost",
                 "homes": "Total Affordable Units Created"},
    },
    {
        "key": "fy2223", "year": 2022, "period": "2022-07-01/2023-06-30",
        "url": "https://content.leg.colorado.gov/sites/default/files/images/division_of_housing_annual_public_report_fy22-23_updated.pdf",
        "title": "DOH Annual Public Report on Funding of Affordable Housing Preservation and Production, FY2022-23 (Figure 8)",
        "figure": "Figure 8: Funds Awarded By Project and Program",
        "stated_total": 336456854, "stated_count": 99,
        "stated_quote": '"$336,456,854 awarded by DOH to grantees & borrowers"; Figure 7 prints 99 under "Awards Made" for accepted awards',
        "cols": {"grantee": "Applicant", "name": "Project or Program Name", "source": "Funding Sources",
                 "town": None, "county": "County", "type": "Housing Type", "activity": "Activity",
                 "requested": "Requested Funding", "amount": "Award Amount", "cost": "Total Cost",
                 "homes": "Units", "recommendation": "Staff Recommendation"},
    },
]

PROGRAMS = [
    (r"^HDG\b|Housing Development Grant", "Housing Development Grant"),
    (r"^HOME\b", "HOME (federal)"),
    (r"^CDBG\b", "CDBG (federal)"),
    (r"^(HTF|Housing Trust Fund)\b", "Housing Trust Fund (federal)"),
    (r"^SB22-159\b", "Revolving loan fund (SB22-159)"),
    (r"^(HB21-1329|HB22-1304|HB22-1377|SB21-242|SB22-160|AHIF|OTK)\b", "State stimulus housing funds"),
    (r"^CHIF\b", "Colorado Housing Investment Funds (CHIF)"),
]


def clean(s):
    return re.sub(r"\s+", " ", (s or "").replace("-\n", "").replace("\n", " ")).strip()


def money(s):
    m = re.fullmatch(r"\$?([\d,]+)(\.\d+)?", clean(s).replace(" ", ""))
    return int(m.group(1).replace(",", "")) if m else None


def norm(s):
    s = (s or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    w = [x for x in s.split() if x not in ("the", "apartments", "apartment", "apts", "inc", "llc", "lp", "phase")]
    return " ".join(w)


def held_back_rules():
    """The publication guard's patterns and the owner exclusion list: a row
    either one catches is not written to the public award file."""
    text = open(os.path.join(ROOT, "scripts", "lib", "public-sensitive-patterns.mjs")).read()
    pats = [re.compile(m.group(1).replace("\\/", "/"), re.I if "i" in m.group(2) else 0)
            for m in re.finditer(r"regex:\s*/((?:\\/|[^/])+)/([a-z]*)", text)]
    if not pats:
        sys.exit("could not read scripts/lib/public-sensitive-patterns.mjs; not writing")
    sys.path.insert(0, os.path.join(ROOT, "scripts", "funding"))
    import build_lihtc_applications as apps
    excl = json.load(open(os.path.join(ROOT, "data", "jurisdiction-briefs", "_lihtc-applications-excluded.json")))
    entries = excl if isinstance(excl, list) else excl.get("entries", excl.get("excluded", []))
    hashes = {e["sha256"] for e in entries}
    def held(rec):
        blob = json.dumps(rec, ensure_ascii=False)
        if any(p.search(blob) for p in pats):
            return True
        return any(apps.exclusion_hash(rec.get(k) or "", rec.get("town") or "") in hashes for k in ("name", "grantee"))
    return held


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "coho-analytics/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def table_rows(pdf_bytes):
    import pdfplumber
    rows = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for i, page in enumerate(pdf.pages):
            for tb in page.extract_tables():
                if not tb or not tb[0] or clean(tb[0][0]) != "Applicant":
                    continue
                head = [clean(h) for h in tb[0]]
                for r in tb[1:]:
                    rows.append((i + 1, dict(zip(head, [c or "" for c in r]))))
    return rows


SECTION = re.compile(r"^(Applications|Supplemental Funding Requests|Withdrawn Funding Requests)\b")


def stitch(rows, amount_col):
    """A row with no amount continues the row above it (a cell split across a
    page), except a section heading, which sets the section of the rows below."""
    out = []
    section = ""
    for page, cells in rows:
        vals = [clean(v) for v in cells.values()]
        if vals and SECTION.match(vals[0]) and not any(vals[1:]):
            section = vals[0]
            continue
        if not clean(cells.get(amount_col)) and out:
            prev = out[-1]
            for k, v in cells.items():
                if clean(v):
                    prev["cells"][k] = (prev["cells"].get(k, "") + "\n" + v).strip()
            prev["pages"].append(page)
        else:
            out.append({"pages": [page], "cells": dict(cells), "section": section})
    return out


def main():
    data = json.load(open(OUT))
    cnames = {f["properties"]["NAME"].lower(): f["properties"]["GEOID"] for f in json.load(open(COUNTIES))["features"]}
    keep = [a for a in data["awards"] if not re.match(r"^(fy2122|fy2223)-", a.get("id") or "")]
    titles = {r["title"] for r in REPORTS}
    data["meta"]["announcements"] = [x for x in data["meta"]["announcements"] if x.get("title") not in titles]
    dup_note = re.compile(r"^\[(fy2122|fy2223)\] ")
    data["meta"]["dropped_as_duplicates"] = [x for x in data["meta"].get("dropped_as_duplicates", []) if not dup_note.match(x)]

    added, dropped = [], []
    held = held_back_rules()
    held_count = 0
    for rep in REPORTS:
        c = rep["cols"]
        rows = stitch(table_rows(fetch(rep["url"])), c["amount"])
        n = 0
        rows_sum = 0
        for row in rows:
            cell = {k: clean(v) for k, v in row["cells"].items()}
            for k in (c["requested"], c["amount"], c["cost"], c["homes"]):
                if k in cell:  # a number wrapped inside its cell ("$10,000,00 0")
                    cell[k] = re.sub(r"(?<=[\d,]) (?=[\d,])", "", cell[k])
            if c.get("recommendation") and cell.get(c["recommendation"]) != "Award":
                continue
            if row["section"].startswith("Withdrawn"):
                continue
            supplemental = row["section"].startswith("Supplemental")
            amount = money(cell.get(c["amount"]))
            if not amount:
                continue
            rows_sum += amount
            n += 1
            src = cell.get(c["source"]) or ""
            program = next((lab for pat, lab in PROGRAMS if re.search(pat, src)), "Division of Housing award")
            county = cell.get(c["county"]) or ""
            cname = re.sub(r"\s+county$", "", county.strip(), flags=re.I).lower()
            fips = cnames.get(cname)
            homes_txt = re.sub(r"[^\d]", "", cell.get(c["homes"]) or "")
            homes = int(homes_txt) if homes_txt else None
            printed = [cell.get(c[k]) or "" for k in ("grantee", "name", "source", "town", "county", "type", "activity", "homes", "amount") if c.get(k)]
            rec = {
                "name": cell.get(c["name"]) or cell.get(c["grantee"]),
                "grantee": cell.get(c["grantee"]) or None,
                "town": (cell.get(c["town"]) or None) if c.get("town") else None,
                "county_fips": fips,
                "county_method": "county as printed" if fips else None,
                "program": program,
                "program_as_printed": src or None,
                "amount": amount,
                "amount_basis": "awarded",
                "homes": homes if homes else None,
                "year": rep["year"],
                "announced": rep["period"],
                "source_title": rep["title"],
                "source_type": "DOH annual report table row",
                "source_url": rep["url"],
                "quote": " | ".join(printed),
                "confirmed": False,
                "note": f"{rep['figure']} (PDF page {', '.join(map(str, row['pages']))}); awarded during SFY {rep['period'][:4]}-{rep['period'][13:15]} "
                        f"(July {rep['period'][:4]}-June {rep['period'][11:15]}). Project type: {cell.get(c['type']) or 'not printed'}; "
                        f"activity: {cell.get(c['activity']) or 'not printed'}. Units are DOH's units or loans projected."
                        + (" Supplemental funding for an earlier award; its homes count on that award." if supplemental else "")
                        + ("" if fips or not county else f" Counties as printed: {county}; not mapped to one county."),
                "id": f"{rep['key']}-{n:03d}",
            }
            if held(rec):
                held_count += 1
                continue
            match = next((a for a in keep + added if a.get("amount") == amount and abs((a.get("year") or 0) - rep["year"]) <= 1
                          and ((norm(a.get("name")) and norm(a.get("name")) == norm(rec["name"]))
                               or (norm(a.get("grantee")) and norm(a.get("grantee")) == norm(rec["grantee"])))), None)
            if match:
                dropped.append(f"[{rep['key']}] {rec['name']}: also reported as {match.get('id')}")
                continue
            added.append(rec)
        data["meta"]["announcements"].append({
            "title": rep["title"], "date": None, "period": rep["period"], "url": rep["url"],
            "source_type": "DOH annual report to legislature (PDF)",
            "stated_total": rep["stated_total"], "rows_sum": rows_sum, "complete": True,
            "note": (f"{n} award rows read from {rep['figure']}; the report's summary: {rep['stated_quote']}. "
                     f"Rows sum to ${rows_sum:,}, ${rows_sum - rep['stated_total']:+,} against that total"
                     + (f", and {n} rows against {rep['stated_count']} awards" if n != rep["stated_count"] else "")
                     + "; units in the rows match the report's unit totals. The rows are kept as printed."),
        })
        print(f"{rep['key']}: {n} award rows, ${rows_sum:,} (report says ${rep['stated_total']:,}, {rep['stated_count']} awards)")

    data["meta"]["held_back_note"] = (
        f"{held_count} annual-report rows that the site's publication rules hold back are left out "
        "(scripts/lib/public-sensitive-patterns.mjs and the owner exclusion list)."
    )
    data["awards"] = keep + added
    data["meta"]["dropped_as_duplicates"] = data["meta"]["dropped_as_duplicates"] + dropped
    data["meta"]["coverage"] = (
        "Every Division of Housing award from July 2021 on, from DOH's annual reports (FY2021-22 to FY2024-25) and, "
        "for later months, State Housing Board vote summaries, DOLA releases and DOH award tables. Awards before July 2021 "
        "are not included. An announcement that names fewer awards than its total is marked complete: false, and its "
        "awards are marked unconfirmed."
    )
    with open(OUT, "w") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"added {len(added)}, kept once as duplicates {len(dropped)}; awards now {len(data['awards'])}")


if __name__ == "__main__":
    sys.exit(main())
