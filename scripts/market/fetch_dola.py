#!/usr/bin/env python3
"""
scripts/market/fetch_dola.py

Fetch Colorado county-level demographic and housing data from the
DOLA State Demography Office (Colorado Department of Local Affairs).

Output:
    data/market/dola_demographics_co.json

Usage:
    python3 scripts/market/fetch_dola.py

Source:
    https://demography.dola.colorado.gov/
    https://gis.dola.colorado.gov/lookups/

All sources are free and publicly accessible without authentication.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "dola_demographics_co.json"

# DOLA GIS Lookup API endpoints
# Profile endpoint returns population, housing units, households by county
DOLA_PROFILE_URL = "https://gis.dola.colorado.gov/lookups/profile"

# Components of change (births, deaths, migration)
DOLA_COMPONENTS_URL = "https://gis.dola.colorado.gov/lookups/components"

# Municipal data
DOLA_MUNI_URL = "https://gis.dola.colorado.gov/lookups/municipality"

# Years to fetch (most recent available)
TARGET_YEARS = [2024, 2023, 2022]

# Colorado county FIPS codes (001-125, odd numbers)
# Full list of 64 Colorado counties
CO_COUNTY_FIPS = [
    ("001", "Adams"),      ("003", "Alamosa"),    ("005", "Arapahoe"),
    ("007", "Archuleta"),  ("009", "Baca"),       ("011", "Bent"),
    ("013", "Boulder"),    ("014", "Broomfield"), ("015", "Chaffee"),
    ("017", "Cheyenne"),   ("019", "Clear Creek"),("021", "Conejos"),
    ("023", "Costilla"),   ("025", "Crowley"),    ("027", "Custer"),
    ("029", "Delta"),      ("031", "Denver"),     ("033", "Dolores"),
    ("035", "Douglas"),    ("037", "Eagle"),      ("039", "Elbert"),
    ("041", "El Paso"),    ("043", "Fremont"),    ("045", "Garfield"),
    ("047", "Gilpin"),     ("049", "Grand"),      ("051", "Gunnison"),
    ("053", "Hinsdale"),   ("055", "Huerfano"),   ("057", "Jackson"),
    ("059", "Jefferson"),  ("061", "Kiowa"),      ("063", "Kit Carson"),
    ("065", "Lake"),       ("067", "La Plata"),   ("069", "Larimer"),
    ("071", "Las Animas"), ("073", "Lincoln"),    ("075", "Logan"),
    ("077", "Mesa"),       ("079", "Mineral"),    ("081", "Moffat"),
    ("083", "Montezuma"),  ("085", "Montrose"),   ("087", "Morgan"),
    ("089", "Otero"),      ("091", "Ouray"),      ("093", "Park"),
    ("095", "Phillips"),   ("097", "Pitkin"),     ("099", "Prowers"),
    ("101", "Pueblo"),     ("103", "Rio Blanco"), ("105", "Rio Grande"),
    ("107", "Routt"),      ("109", "Saguache"),   ("111", "San Juan"),
    ("113", "San Miguel"), ("115", "Sedgwick"),   ("117", "Summit"),
    ("119", "Teller"),     ("121", "Washington"), ("123", "Weld"),
    ("125", "Yuma"),
]

# Map of FIPS code -> county name for lookup
COUNTY_NAME_MAP = {fips: name for fips, name in CO_COUNTY_FIPS}


def fetch_json(url, timeout=30):
    """Fetch JSON from a URL and return parsed data."""
    req = urllib.request.Request(url, headers={
        "User-Agent": "Housing-Analytics-PMA/1.0 (research; non-commercial)",
        "Accept": "application/json"
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError) as e:
        print(f"    Failed: {e}")
        return None


def fetch_all_counties_profile(year):
    """
    Fetch county profile data for all counties at once.
    DOLA API: county=0 means all counties.
    """
    url = f"{DOLA_PROFILE_URL}?county=0&year={year}&format=json"
    print(f"  Fetching all-county profile for {year}...")
    return fetch_json(url)


def fetch_single_county_profile(county_fips, year):
    """Fetch profile data for a single county."""
    # DOLA uses county FIPS without state prefix (e.g., 1 for Adams, not 001)
    county_num = int(county_fips)
    url = f"{DOLA_PROFILE_URL}?county={county_num}&year={year}&format=json"
    return fetch_json(url)


def parse_profile_data(data):
    """
    Parse DOLA profile response into structured county records.
    The API returns various formats depending on the endpoint version.
    """
    counties = {}

    if not data:
        return counties

    # Handle different response formats
    records = []
    if isinstance(data, list):
        records = data
    elif isinstance(data, dict):
        # May be nested under a key
        for key in ["data", "results", "profile", "rows"]:
            if key in data and isinstance(data[key], list):
                records = data[key]
                break
        if not records:
            # Maybe the dict itself is keyed by county
            records = [data]

    for rec in records:
        if not isinstance(rec, dict):
            continue

        # Try to extract county FIPS
        county_fips = None
        for key in ["countyfips", "county_fips", "fips", "county", "FIPS", "COUNTYFIPS"]:
            val = rec.get(key)
            if val is not None:
                county_fips = str(int(val)).zfill(3)
                break

        if not county_fips or county_fips == "000":
            # Skip state totals
            continue

        full_fips = "08" + county_fips

        # Extract population
        population = None
        for key in ["totalpopulation", "total_population", "population", "totpop",
                     "totalPopulation", "TotalPopulation", "pop"]:
            val = rec.get(key)
            if val is not None:
                try:
                    population = int(float(val))
                    break
                except (ValueError, TypeError):
                    pass

        # Extract housing units
        housing_units = None
        for key in ["totalhousingunits", "total_housing_units", "housing_units",
                     "totalHousingUnits", "HousingUnits", "hu"]:
            val = rec.get(key)
            if val is not None:
                try:
                    housing_units = int(float(val))
                    break
                except (ValueError, TypeError):
                    pass

        # Extract occupied housing units
        occupied = None
        for key in ["occupiedhousingunits", "occupied_housing_units", "occupied",
                     "occupiedHousingUnits", "occ_hu"]:
            val = rec.get(key)
            if val is not None:
                try:
                    occupied = int(float(val))
                    break
                except (ValueError, TypeError):
                    pass

        # Extract households
        households = None
        for key in ["households", "total_households", "hh", "totalHouseholds"]:
            val = rec.get(key)
            if val is not None:
                try:
                    households = int(float(val))
                    break
                except (ValueError, TypeError):
                    pass

        # Extract group quarters population
        gq_pop = None
        for key in ["groupquarterspopulation", "group_quarters", "gq_pop", "gqpop"]:
            val = rec.get(key)
            if val is not None:
                try:
                    gq_pop = int(float(val))
                    break
                except (ValueError, TypeError):
                    pass

        # Build record
        county_name = COUNTY_NAME_MAP.get(county_fips, rec.get("county_name", rec.get("countyname", "Unknown")))

        entry = {"name": county_name}
        if population is not None:
            entry["population"] = population
        if housing_units is not None:
            entry["housingUnits"] = housing_units
        if occupied is not None:
            entry["occupiedUnits"] = occupied
        if households is not None:
            entry["households"] = households
        if gq_pop is not None:
            entry["groupQuartersPop"] = gq_pop

        # Compute derived metrics
        if housing_units and occupied is not None:
            vacant = housing_units - occupied
            entry["vacantUnits"] = max(vacant, 0)
            if housing_units > 0:
                entry["vacancyRate"] = round(max(vacant, 0) / housing_units, 4)
        elif housing_units and households is not None:
            # Approximate occupied from households
            entry["occupiedUnits"] = households
            vacant = housing_units - households
            entry["vacantUnits"] = max(vacant, 0)
            if housing_units > 0:
                entry["vacancyRate"] = round(max(vacant, 0) / housing_units, 4)

        # Persons per household
        if population and (occupied or households):
            hh_count = occupied or households
            if hh_count > 0:
                entry["personsPerHousehold"] = round(population / hh_count, 2)

        counties[full_fips] = entry

    return counties


def try_individual_counties(year):
    """
    Fall back to fetching counties one at a time if bulk fetch fails.
    """
    print(f"  Falling back to individual county fetches for {year}...")
    counties = {}
    for fips, name in CO_COUNTY_FIPS:
        data = fetch_single_county_profile(fips, year)
        if data:
            parsed = parse_profile_data(data)
            counties.update(parsed)
        # Be polite to the API
        time.sleep(0.2)

    return counties


def fetch_components_of_change(year):
    """
    Fetch components of population change (births, deaths, net migration)
    for additional demographic context.
    """
    url = f"{DOLA_COMPONENTS_URL}?county=0&year={year}&format=json"
    print(f"  Fetching components of change for {year}...")
    data = fetch_json(url)

    if not data:
        return {}

    components = {}
    records = data if isinstance(data, list) else data.get("data", data.get("results", []))

    if not isinstance(records, list):
        return {}

    for rec in records:
        if not isinstance(rec, dict):
            continue

        county_fips = None
        for key in ["countyfips", "county_fips", "fips", "county"]:
            val = rec.get(key)
            if val is not None:
                county_fips = str(int(val)).zfill(3)
                break

        if not county_fips or county_fips == "000":
            continue

        full_fips = "08" + county_fips

        comp = {}
        for src_key, dest_key in [
            ("births", "births"), ("deaths", "deaths"),
            ("netmigration", "netMigration"), ("net_migration", "netMigration"),
            ("naturalincrease", "naturalIncrease"), ("natural_increase", "naturalIncrease"),
        ]:
            val = rec.get(src_key)
            if val is not None:
                try:
                    comp[dest_key] = int(float(val))
                except (ValueError, TypeError):
                    pass

        if comp:
            components[full_fips] = comp

    return components


def main():
    print("=== DOLA State Demography Office Data ===")
    print(f"Output: {OUT_FILE}")

    counties = {}
    data_year = None

    # Try each year from most recent to oldest
    for year in TARGET_YEARS:
        print(f"\n--- Trying year {year} ---")

        # Strategy 1: Bulk fetch all counties
        data = fetch_all_counties_profile(year)
        if data:
            counties = parse_profile_data(data)

        # Strategy 2: Individual county fetches
        if not counties:
            counties = try_individual_counties(year)

        if counties:
            data_year = year
            print(f"  Got {len(counties)} counties for {year}")
            break
        else:
            print(f"  No data for {year}")

    # If API fails entirely, try a simplified approach
    if not counties:
        print("\nDOLA API returned no usable data.")
        print("Attempting simplified query format...")

        for year in TARGET_YEARS:
            # Try without format parameter
            url = f"{DOLA_PROFILE_URL}?county=0&year={year}"
            print(f"  Trying: {url}")
            data = fetch_json(url)
            if data:
                print(f"  Response type: {type(data).__name__}")
                if isinstance(data, dict):
                    print(f"  Keys: {list(data.keys())[:10]}")
                elif isinstance(data, list) and data:
                    print(f"  First record keys: {list(data[0].keys()) if isinstance(data[0], dict) else 'N/A'}")
                counties = parse_profile_data(data)
                if counties:
                    data_year = year
                    break

    # Fetch components of change if profile data succeeded
    components = {}
    if counties and data_year:
        components = fetch_components_of_change(data_year)
        if components:
            print(f"  Got components of change for {len(components)} counties")
            # Merge components into county records
            for fips, comp in components.items():
                if fips in counties:
                    counties[fips].update(comp)

    # If still no data, create output with known county list but no metrics
    if not counties:
        print("\nWARNING: Could not fetch data from DOLA API.")
        print("The API may be down or the endpoint format may have changed.")
        print("Check: https://demography.dola.colorado.gov/")
        print("Creating output with county list only...")

        for fips, name in CO_COUNTY_FIPS:
            full_fips = "08" + fips
            counties[full_fips] = {"name": name, "_noData": True}
        data_year = None

    # Build output
    result = {
        "meta": {
            "source": "Colorado State Demography Office (DOLA)",
            "sourceUrl": "https://demography.dola.colorado.gov/",
            "apiBase": DOLA_PROFILE_URL,
            "year": data_year,
            "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "counties": len(counties),
            "description": "County-level population and housing estimates from the "
                           "Colorado State Demography Office. More current than ACS "
                           "(annual estimates vs. 5-year rolling average)."
        },
        "counties": counties
    }

    if not data_year:
        result["meta"]["error"] = "API returned no parseable data — county list only"

    # Write output
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w") as f:
        json.dump(result, f, indent=2)

    size_kb = OUT_FILE.stat().st_size / 1024
    print(f"\nWrote {OUT_FILE} ({size_kb:.1f} KB)")

    # Summary
    pop_counties = [c for c in counties.values() if "population" in c]
    if pop_counties:
        total_pop = sum(c["population"] for c in pop_counties)
        total_hu = sum(c.get("housingUnits", 0) for c in pop_counties)
        print(f"\nSummary:")
        print(f"  Counties with data: {len(pop_counties)}")
        print(f"  Total population: {total_pop:,}")
        print(f"  Total housing units: {total_hu:,}")

        # Sample
        sample_fips = ["08031", "08001", "08005", "08041", "08013"]
        print(f"\nSample counties:")
        for fips in sample_fips:
            if fips in counties:
                print(f"  {fips} ({counties[fips].get('name', '?')}): "
                      f"pop={counties[fips].get('population', '?'):,}, "
                      f"hu={counties[fips].get('housingUnits', '?')}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
