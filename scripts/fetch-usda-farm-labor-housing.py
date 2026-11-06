#!/usr/bin/env python3
"""Fetch USDA Section 514/516 farm labor rental housing in Colorado.

Writes data/affordable-housing/preservation/usda-farm-labor-housing.json.

The USDA layer the site already reads (scripts/fetch-usda-rural-housing.js,
HUD's copy "USDA Rural Housing Assets") holds Section 515 rural rentals only.
USDA's own active-projects file lists every Section 515 and 514 project; this
script keeps the Colorado rows with a farm labor housing type (Labor_Housing_Type
not 0), which are the ones missing from the site.

Source: USDA Rural Development, Multi-Family Housing active projects
https://www.sc.egov.usda.gov/data/MFH_section_515.html
(file USDA_RD_MFH_Active_Projects-YYYY-MM-DD.xlsx, linked from that page).
Management company names are not copied.

Run: python3 scripts/fetch-usda-farm-labor-housing.py
"""
import io, json, os, re, sys, urllib.request

PAGE = "https://www.sc.egov.usda.gov/data/MFH_section_515.html"
BASE = "https://www.sc.egov.usda.gov/data/"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "data", "affordable-housing", "preservation", "usda-farm-labor-housing.json")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "coho-analytics/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def main():
    import openpyxl
    html = get(PAGE).decode("utf-8", "replace")
    m = re.search(r'href="(files/MFH_Section_515/ActiveProjects/USDA_RD_MFH_Active_Projects-(\d{4}-\d{2}-\d{2})\.xlsx)"', html)
    if not m:
        sys.exit("active-projects file link not found on " + PAGE)
    url, file_date = BASE + m.group(1), m.group(2)
    ws = openpyxl.load_workbook(io.BytesIO(get(url)), read_only=True).worksheets[0]
    rows = ws.iter_rows(values_only=True)
    head = next(rows)
    co = [dict(zip(head, r)) for r in rows if r[head.index("State_Abbreviation")] == "CO"]
    report_dates = {r["Report Date"].date().isoformat() for r in co if r.get("Report Date")}
    feats = []
    for r in co:
        if not r.get("Labor_Housing_Type"):
            continue
        if r.get("Latitude") is None or r.get("Longitude") is None:
            continue
        exp = r.get("Date_Restrictive_Clause_Expires")
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(float(r["Longitude"]), 6), round(float(r["Latitude"]), 6)]},
            "properties": {
                "PROJECT": (r["Project_Name"] or "").strip().title() or None,
                "PROJ_ADD": (r["Main_Address_Line1"] or "").strip().title() or None,
                "PROJ_CTY": (r["City"] or "").strip().title() or None,
                "PROJ_ST": "CO",
                "Zip": r.get("Zip_Code"),
                "CNTY_FIPS": str(r["State_County_FIPS_Code"]).zfill(5) if r.get("State_County_FIPS_Code") else None,
                "N_UNITS": r.get("Project_Size"),
                "LI_UNITS": r.get("Project_Size"),
                "ra_units": r.get("Rental_Assistance_Units") or 0,
                "labor_housing_type": r.get("Labor_Housing_Type"),
                "rental_code": r.get("Rental_Code"),
                "restrictive_expiration": exp.date().isoformat() if exp else None,
                "usda_project_key": r.get("Project_Mfis_Id_Key"),
                "_source": "USDA RD MFH active projects (Section 514 farm labor)",
            },
        })
    feats.sort(key=lambda f: (f["properties"]["CNTY_FIPS"] or "", f["properties"]["PROJECT"] or ""))
    payload = {
        "type": "FeatureCollection",
        "meta": {
            "source": "USDA Rural Development, Multi-Family Housing active projects",
            "source_page": PAGE,
            "file": url,
            "file_date": file_date,
            "report_date": sorted(report_dates)[-1] if report_dates else None,
            "rule": "Colorado rows whose Labor_Housing_Type is not 0 (Section 514 farm labor housing). Section 515 rows are already in usda-rural-housing.json.",
            "colorado_projects_in_file": len(co),
            "records": len(feats),
            "units": sum(f["properties"]["N_UNITS"] or 0 for f in feats),
            "unit_note": "N_UNITS is USDA's Project_Size. Tierra Nueva Dormitory (Center) is a dormitory; USDA prints its size as 72.",
            "excluded": "Management company names and borrower IDs are not copied.",
        },
        "features": feats,
    }
    with open(OUT, "w") as fh:
        json.dump(payload, fh, indent=1)
        fh.write("\n")
    print(f"Wrote {OUT}: {len(feats)} farm labor projects, {payload['meta']['units']} homes ({len(co)} Colorado projects in the file)")


if __name__ == "__main__":
    main()
