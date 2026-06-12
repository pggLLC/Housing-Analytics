#!/usr/bin/env python3
"""
scripts/draft-jurisdiction-brief.py

Brief-generator: produces a `published: false` skeleton brief for any
Colorado jurisdiction (county or incorporated place with ACS pop ≥ 2,000).
The skeleton has structural sections, durable Google-search source URLs
scoped to the jurisdiction, and `needs_source: true` flags on every
paragraph — it satisfies the schema and validator (published=false skips
the "no search-kind sources" check) and surfaces to the curator backlog.

The skeletons are NOT public-facing: the renderer hides any brief without
`published: true`. Curators promote skeletons to verified, published
briefs over time by replacing search sources with primary / secondary /
press deep links and clearing the needs_source flags.

Scope rules (per product decision 2026-06-11):
  - INCLUDE: counties (5-digit FIPS)
  - INCLUDE: incorporated places with ACS population ≥ 2,000
  - EXCLUDE: CDPs
  - EXCLUDE: incorporated places below the threshold

Usage:
  # Draft one specific jurisdiction
  python3 scripts/draft-jurisdiction-brief.py --geoid 0808400

  # Draft every missing in-scope jurisdiction in one pass
  python3 scripts/draft-jurisdiction-brief.py --all-missing

  # Limit the batch (testing / cron throttling)
  python3 scripts/draft-jurisdiction-brief.py --all-missing --limit 10

  # Overwrite existing skeletons (default: skip)
  python3 scripts/draft-jurisdiction-brief.py --geoid 0808400 --force
"""
import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path
from urllib.parse import quote_plus

ROOT       = Path(__file__).resolve().parent.parent
REGISTRY   = ROOT / "data" / "hna" / "geography-registry.json"
SUMMARY    = ROOT / "data" / "hna" / "summary"
BRIEFS     = ROOT / "data" / "jurisdiction-briefs"

PLACE_MIN_POPULATION = 2000
TODAY = date.today().isoformat()
CURATOR_TAG = "auto-draft"


def _read_population(geoid):
    p = SUMMARY / f"{geoid}.json"
    if not p.exists():
        return None
    try:
        d = json.loads(p.read_text())
        pop = d.get("acsProfile", {}).get("DP05_0001E")
        if isinstance(pop, (int, float)) and pop >= 0:
            return int(pop)
    except Exception:
        return None
    return None


def _registry_index():
    data = json.loads(REGISTRY.read_text())
    by_geoid = {}
    for g in data.get("geographies", []):
        by_geoid[g.get("geoid", "")] = g
    return by_geoid


def _clean_label(name):
    # "Aspen (city)" → "Aspen"; "Garfield County" → "Garfield County"
    return re.sub(r"\s*\(\s*(town|city|cdp)\s*\)\s*", "", name, flags=re.I).strip()


def _jurisdiction_label(geog):
    """Render a friendly jurisdiction string for the brief."""
    name = _clean_label(geog.get("name") or geog.get("label") or "")
    gtype = geog.get("type")
    if gtype == "county":
        # already "X County"
        return name if name.endswith("County") else f"{name} County"
    raw = (geog.get("name") or "").lower()
    if "(town)" in raw:
        return f"Town of {name}"
    if "(city)" in raw:
        return f"City of {name}"
    return name


def _scope(geog):
    gt = geog.get("type")
    if gt == "cdp":
        return "cdp"
    if gt == "county":
        return "county"
    return "place"


def _containing_county_fips(geog):
    geoid = geog.get("geoid", "")
    if len(geoid) == 5:
        # county-level brief: containing county is itself
        return geoid
    cc = geog.get("containingCounty")
    if cc and re.match(r"^08\d{3}$", cc):
        return cc
    return None


def _gov_domain_hint(label):
    """Best-effort guess for the jurisdiction's gov domain (informational
    only — gets baked into the search URL, not blindly trusted)."""
    slug = re.sub(r"[^a-z]", "", label.lower())
    # Most CO city sites land at *.gov, *.co.us, or *.org. Without a curated
    # mapping we just include the slug as a substring hint.
    return slug


def _search_url(query):
    return "https://www.google.com/search?q=" + quote_plus(query)


def _build_skeleton(geog):
    geoid = geog.get("geoid", "")
    jurisdiction = _jurisdiction_label(geog)
    scope = _scope(geog)
    cc = _containing_county_fips(geog)
    if cc is None:
        raise ValueError(f"{geoid}: missing containing_county_fips and not a county")

    pop = _read_population(geoid)
    name_short = _clean_label(geog.get("name") or "")
    slug_hint = _gov_domain_hint(name_short)

    sections = [
        {
            "id": "lihtc-history",
            "heading": "CHFA LIHTC award history",
            "paragraphs": [{
                "text": (
                    f"Skeleton placeholder. Research CHFA Round One and Round "
                    f"Two Housing Tax Credit award announcements (2022-2026) "
                    f"for any {jurisdiction} project awards or denials. Verify "
                    f"against the CHFA awards index at "
                    f"chfainfo.com/rental-housing/housing-credit/awards and "
                    f"the per-round narrative PDFs."
                ),
                "cites": ["s1"],
                "needs_source": True,
            }],
        },
        {
            "id": "local-funding-and-policy",
            "heading": "Local funding & policy",
            "paragraphs": [{
                "text": (
                    f"Skeleton placeholder. Research the housing fund, "
                    f"dedicated revenue streams (lodging / STR / sales tax / "
                    f"mill levy), recent housing-strategic-plan adoptions, "
                    f"inclusionary ordinances, fee waivers, and council "
                    f"resolutions specific to {jurisdiction}."
                ),
                "cites": ["s2"],
                "needs_source": True,
            }],
        },
        {
            "id": "regional-housing-authority",
            "heading": "Housing authority & regional context",
            "paragraphs": [{
                "text": (
                    f"Skeleton placeholder. Identify the public housing "
                    f"authority serving {jurisdiction} (municipal, county, or "
                    f"regional) plus any coalition memberships (e.g. WMRHC, "
                    f"CHA, APCHA, etc.). Document the authority's voucher "
                    f"inventory and any project-based vouchers committed to "
                    f"local LIHTC pipeline."
                ),
                "cites": ["s3"],
                "needs_source": True,
            }],
        },
    ]

    sources = [
        {
            "id": "s1",
            "label": f"CHFA Housing Tax Credit awards — search scoped to '{name_short}'",
            "url": _search_url(f'site:chfainfo.com "{name_short}" "housing tax credit"'),
            "kind": "search",
        },
        {
            "id": "s2",
            "label": f"{jurisdiction} affordable-housing fund / STR / lodging-tax search",
            "url": _search_url(
                f'"{name_short}" Colorado "affordable housing" '
                f'("housing fund" OR "short-term rental" OR "lodging tax" OR "mill levy")'
            ),
            "kind": "search",
        },
        {
            "id": "s3",
            "label": f"{jurisdiction} housing authority / regional coalition search",
            "url": _search_url(
                f'"{name_short}" Colorado ("housing authority" OR "housing coalition" '
                f'OR "deed restriction")'
            ),
            "kind": "search",
        },
    ]

    brief = {
        "geoid": geoid,
        "jurisdiction": jurisdiction,
        "scope": scope,
        "containing_county_fips": cc,
        "last_curated": TODAY,
        "curator": CURATOR_TAG,
        "published": False,
        "summary": (
            f"Skeleton brief for {jurisdiction} — auto-drafted on {TODAY}, "
            f"pending curator research. The renderer hides this brief until "
            f"published is flipped to true (after every source is verified)."
        ),
        "sections": sections,
        "sources": sources,
    }
    if pop is not None:
        brief["_meta_population_at_draft"] = pop
    return brief


def _in_scope(geog):
    geoid = geog.get("geoid", "")
    gt = geog.get("type")
    if gt == "cdp":
        return False
    if gt == "county":
        return True
    if gt == "place":
        pop = _read_population(geoid)
        return pop is not None and pop >= PLACE_MIN_POPULATION
    return False


def _write_brief(brief, force):
    geoid = brief["geoid"]
    target = BRIEFS / f"{geoid}.json"
    if target.exists() and not force:
        return False, "exists"
    BRIEFS.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(brief, indent=2) + "\n")
    return True, "written"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--geoid", help="Single 5- or 7-digit GEOID to draft")
    g.add_argument("--all-missing", action="store_true",
                   help="Draft every in-scope jurisdiction that doesn't already have a brief")
    ap.add_argument("--force", action="store_true",
                    help="Overwrite an existing file (default: skip)")
    ap.add_argument("--limit", type=int, default=None,
                    help="Maximum number of skeletons to draft this run")
    args = ap.parse_args()

    by_geoid = _registry_index()
    targets = []
    if args.geoid:
        g = by_geoid.get(args.geoid)
        if not g:
            print(f"error: GEOID '{args.geoid}' not in registry", file=sys.stderr)
            return 2
        if not _in_scope(g):
            print(f"warn: '{args.geoid}' is out of scope (CDP or pop < {PLACE_MIN_POPULATION})",
                  file=sys.stderr)
        targets = [g]
    else:
        for g in by_geoid.values():
            if _in_scope(g):
                targets.append(g)

    written = skipped = errors = 0
    for g in targets:
        if args.limit and (written + skipped) >= args.limit:
            break
        try:
            brief = _build_skeleton(g)
        except Exception as e:
            print(f"error: {g.get('geoid')} — {e}", file=sys.stderr)
            errors += 1
            continue
        ok, msg = _write_brief(brief, args.force)
        if ok:
            written += 1
        else:
            skipped += 1
    print(f"[draft] {written} written, {skipped} skipped, {errors} error(s) "
          f"(scanned {len(targets)} candidate(s))", file=sys.stderr)
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
