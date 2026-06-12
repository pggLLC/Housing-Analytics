#!/usr/bin/env python3
"""
scripts/validate-jurisdiction-briefs.py

QA gate for data/jurisdiction-briefs/*.json. Enforces the curation rules
documented in data/jurisdiction-briefs/README.md:

  1. Filename matches geoid field
  2. Schema fields present (geoid, jurisdiction, scope, containing_county_fips,
     last_curated, curator, sections, sources)
  3. Every section has at least one paragraph
  4. Every paragraph either has cites OR is flagged needs_source=True
  5. Every cite resolves to a source id present in the sources array
  6. No orphaned sources (every source must be cited by at least one paragraph)
  7. Single-jurisdiction QA — non-coalition / non-regional sections must
     not mention other CO incorporated places. Sections whose id starts
     with "coalition-" or "regional-" are exempt (multi-jurisdictional by
     definition).

Run before committing a new or edited brief. Exit code 0 on pass, 1 on fail.
"""
import json
import re
import sys
from pathlib import Path

ROOT       = Path(__file__).resolve().parent.parent
BRIEFS_DIR = ROOT / "data" / "jurisdiction-briefs"
REGISTRY   = ROOT / "data" / "hna" / "geography-registry.json"


def load_co_place_names() -> set[str]:
    """Colorado incorporated places + CDPs from the geography registry.
    Used to flag cross-jurisdiction mentions in non-coalition sections.

    Counties are intentionally excluded from this set — a brief routinely
    needs to reference its containing county and the county housing
    authority that manages its deed-restricted program ("Garfield County
    Housing Authority"). The single-jurisdiction QA check targets other
    *municipalities*, not the county containment relationship.
    """
    if not REGISTRY.exists():
        return set()
    data = json.loads(REGISTRY.read_text())
    out = set()
    for g in data.get("geographies", []):
        if not g.get("geoid", "").startswith("08"):
            continue
        if len(g.get("geoid", "")) == 5:
            continue   # skip counties — see docstring
        nm = (g.get("name") or g.get("label") or "").strip()
        # Strip place-type suffixes so the match works whether the brief
        # says "Glenwood Springs" or "Glenwood Springs (city)".
        nm = re.sub(r"\s*\(?(town|city|CDP)\)?\s*$", "", nm, flags=re.I).strip()
        # Skip names that look like county-derived CDPs (e.g. "Garfield"
        # CDP in Pitkin) which collide with the county name — those
        # false-positive on legitimate "Garfield County" references.
        if re.search(r"\s+County$", nm, flags=re.I):
            continue
        if nm and len(nm) >= 4:
            out.add(nm)
    return out


# Government-entity suffixes that turn a place name into a proper-noun
# entity reference (e.g. "Pitkin County Housing Authority"). Mentions
# followed by one of these aren't cross-jurisdiction contamination —
# they're naming a service provider or organization.
ENTITY_SUFFIX_PATTERN = (
    r"(?:\s+County)?\s+(?:Housing\s+Authority|Government|Commissioners?|"
    r"Board|Department|School\s+District|RE-\d+|Re-\d+|Fire\s+District|"
    r"Sheriff|Sheriff's\s+Office|Police|Parks?\s+(?:&|and)\s+Rec)"
)


REGIONAL_SECTION_PREFIXES = ("coalition-", "regional-")


def validate_brief(path: Path, co_places: set[str]) -> list[str]:
    errors: list[str] = []
    try:
        brief = json.loads(path.read_text())
    except Exception as e:
        return [f"{path.name}: invalid JSON — {e}"]

    # 1. filename matches geoid
    expected = path.stem
    if brief.get("geoid") != expected:
        errors.append(f"{path.name}: filename geoid '{expected}' != field geoid "
                      f"'{brief.get('geoid')}'")

    # 2. required top-level fields
    required = ["geoid", "jurisdiction", "scope", "containing_county_fips",
                "last_curated", "curator", "sections", "sources"]
    for f in required:
        if f not in brief:
            errors.append(f"{path.name}: missing required field '{f}'")

    sections = brief.get("sections") or []
    sources  = brief.get("sources")  or []
    source_ids = {s.get("id") for s in sources if isinstance(s, dict)}
    cited_ids: set[str] = set()
    own_name = re.sub(r"^(town|city|county) of ", "",
                      (brief.get("jurisdiction") or "").lower()).strip()
    own_name_stripped = re.sub(r"\s+(county|town|city|cdp)$", "",
                               own_name, flags=re.I).strip()

    # 3, 4, 5 — paragraph / cite checks
    for sec_idx, sec in enumerate(sections):
        sid = sec.get("id") or f"<section-{sec_idx}>"
        paras = sec.get("paragraphs") or []
        if not paras:
            errors.append(f"{path.name}: section '{sid}' has no paragraphs")
        is_regional = sid.startswith(REGIONAL_SECTION_PREFIXES)
        for p_idx, p in enumerate(paras):
            cites = p.get("cites") or []
            needs = bool(p.get("needs_source"))
            if not cites and not needs:
                errors.append(f"{path.name}: section '{sid}' paragraph {p_idx} "
                              "has no cites and is not flagged needs_source=true")
            for c in cites:
                if c not in source_ids:
                    errors.append(f"{path.name}: section '{sid}' paragraph "
                                  f"{p_idx} cites unknown source id '{c}'")
                cited_ids.add(c)

            # 7. single-jurisdiction QA on non-regional sections.
            # Match `\bPlace\b` but EXCLUDE cases where the word is part of
            # a common compound like "Town Center", "Town Hall", "City of",
            # "Center Street", etc. The heuristic: require either a sentence
            # start, an article ("the"), a preposition ("in/of/near/from/to"),
            # or another capitalised name immediately before the match — that
            # filters out generic-noun adjacency without missing real refs.
            if not is_regional and co_places:
                text = p.get("text") or ""
                for place in co_places:
                    if place.lower() == own_name_stripped:
                        continue
                    pattern = (
                        r"(?:(?<=^)|(?<=\W))"                              # boundary
                        r"(?:in|of|near|from|to|the|with|and|by|at|—)\s+"   # context
                        rf"{re.escape(place)}"
                        r"(?!" + ENTITY_SUFFIX_PATTERN + r")"               # not an entity name
                        r"(?=\W|$)"
                    )
                    if re.search(pattern, text, flags=re.I):
                        errors.append(
                            f"{path.name}: section '{sid}' paragraph {p_idx} "
                            f"mentions other jurisdiction '{place}' — move this "
                            f"claim into a section whose id starts with "
                            f"'coalition-' or 'regional-' if it's genuinely "
                            f"about coalition/regional activity, or remove it "
                            f"if it doesn't belong in this brief."
                        )

    # 6. orphaned sources
    orphans = source_ids - cited_ids
    for o in sorted(orphans):
        errors.append(f"{path.name}: source '{o}' is never cited — remove or "
                      "wire it into a paragraph's cites array")

    # 8. publish gate. A brief with published=true must have:
    #    - zero paragraphs flagged needs_source
    #    - zero sources of kind 'search' (must be primary/secondary/press)
    #    - a verification report at data/jurisdiction-briefs/_verified/<geoid>.json
    #      where EVERY row.verdict is 'supported' or 'partial' (no 'unsupported'
    #      or 'inaccessible'). This is the durable answer to the 2026-06-12
    #      Carbondale s9 fabrication: no claim ships without an end-to-end
    #      source-text check.
    # Briefs with published=false are stayed off the public UI.
    if brief.get("published") is True:
        unsourced = []
        for sec in sections:
            sid = sec.get("id") or "?"
            for p_idx, p in enumerate(sec.get("paragraphs") or []):
                if p.get("needs_source"):
                    unsourced.append(f"{sid}#{p_idx}")
        if unsourced:
            errors.append(
                f"{path.name}: published=true but {len(unsourced)} paragraph(s) "
                f"still flagged needs_source: {', '.join(unsourced[:5])}"
                f"{'…' if len(unsourced) > 5 else ''}. Either verify the source "
                "and clear the flag, or set published=false."
            )
        search_sources = [s.get("id") for s in sources if s.get("kind") == "search"]
        if search_sources:
            errors.append(
                f"{path.name}: published=true but {len(search_sources)} source(s) "
                f"are kind='search' ({', '.join(search_sources[:5])}). Replace "
                "each with a verified primary/secondary/press deep link before "
                "publishing."
            )

        # Source-provenance verification gate.
        verified_path = BRIEFS_DIR / "_verified" / f"{brief.get('geoid')}.json"
        if not verified_path.exists():
            errors.append(
                f"{path.name}: published=true but no source-verification report "
                f"at {verified_path.relative_to(ROOT)}. Run "
                "scripts/verify-brief-sources.py to enumerate the audit plan, "
                "WebFetch every cited URL to confirm each claim is supported, "
                "and write the verdict report before publishing."
            )
        else:
            try:
                report = json.loads(verified_path.read_text())
            except Exception as e:
                errors.append(
                    f"{path.name}: verification report at "
                    f"{verified_path.relative_to(ROOT)} is unreadable ({e}). "
                    "Regenerate it before publishing."
                )
            else:
                report_rows = report.get("rows") or []
                expected_pairs = {
                    (sec.get("id") or "", p_idx, cid)
                    for sec in sections
                    for p_idx, p in enumerate(sec.get("paragraphs") or [])
                    for cid in (p.get("cites") or [])
                }
                report_pairs = {
                    (r.get("section_id") or "", r.get("paragraph_index"), r.get("source_id"))
                    for r in report_rows
                }
                missing_pairs = expected_pairs - report_pairs
                if missing_pairs:
                    sample = ", ".join(
                        f"{sid}#{p_idx}:{cid}"
                        for sid, p_idx, cid in sorted(missing_pairs)[:5]
                    )
                    errors.append(
                        f"{path.name}: published=true but verification report "
                        f"does not cover {len(missing_pairs)} current cited "
                        f"(section, paragraph, source) pair(s): {sample}"
                        f"{'…' if len(missing_pairs) > 5 else ''}."
                    )
                unsupported = [r for r in report_rows if r.get("verdict") == "unsupported"]
                inaccessible = [r for r in report_rows if r.get("verdict") == "inaccessible"]
                invalid_verdicts = [
                    r for r in report_rows
                    if r.get("verdict") not in {"supported", "partial", "unsupported", "inaccessible"}
                ]
                if invalid_verdicts:
                    sample = ", ".join(
                        f"{r.get('section_id','?')}#{r.get('paragraph_index','?')}"
                        f":{r.get('source_id','?')}={r.get('verdict')!r}"
                        for r in invalid_verdicts[:5]
                    )
                    errors.append(
                        f"{path.name}: verification report has "
                        f"{len(invalid_verdicts)} row(s) with invalid verdicts: "
                        f"{sample}{'…' if len(invalid_verdicts) > 5 else ''}."
                    )

                # Methodology gate. The 2026-06-12 audit established that a
                # research agent using WebSearch as a substitute for direct
                # URL fetch will overstate "supported" by matching topical
                # keywords without verifying the article text. Require the
                # report to declare a direct-WebFetch (or equivalent direct-
                # URL-fetch) methodology. Substring match, case-insensitive.
                method = (report.get("audit_method") or "").lower()
                if "direct webfetch" not in method and "direct url fetch" not in method:
                    errors.append(
                        f"{path.name}: published=true but verification report "
                        f"{verified_path.relative_to(ROOT)} does not declare a "
                        f"direct-fetch methodology. audit_method must contain "
                        f"'direct WebFetch' or 'direct URL fetch' to confirm the "
                        f"reviewer fetched each source URL and read the article "
                        f"text — not WebSearch snippets or paraphrased summaries."
                    )

                # Per-row quote gate. A 'supported' verdict without a verbatim
                # supporting_quote is a paper-thin claim — could be a
                # hallucinated verdict on an unread source. Require non-empty.
                missing_quote = [
                    r for r in report_rows
                    if r.get("verdict") == "supported"
                    and not (r.get("supporting_quote") or "").strip()
                ]
                if missing_quote:
                    sample = ", ".join(
                        f"{r.get('section_id','?')}#{r.get('paragraph_index','?')}"
                        f":{r.get('source_id','?')}"
                        for r in missing_quote[:5]
                    )
                    errors.append(
                        f"{path.name}: {len(missing_quote)} 'supported' row(s) "
                        f"in the verification report have an empty "
                        f"supporting_quote: {sample}"
                        f"{'…' if len(missing_quote) > 5 else ''}. Every "
                        "'supported' verdict must include a verbatim quote "
                        "from the article — otherwise the verdict is just a claim."
                    )

                # We DO allow 'supported' and 'partial' (partial means the
                # source is in the right vicinity; curator's call). 'unsupported'
                # and 'inaccessible' are blocking.
                if unsupported:
                    sample = ", ".join(f"{r.get('section_id','?')}#{r.get('paragraph_index','?')}"
                                       f":{r.get('source_id','?')}" for r in unsupported[:5])
                    errors.append(
                        f"{path.name}: published=true but verification report flags "
                        f"{len(unsupported)} unsupported (claim, source) pair(s): "
                        f"{sample}{'…' if len(unsupported) > 5 else ''}. Fix or "
                        "drop the claim before re-publishing."
                    )
                if inaccessible:
                    sample = ", ".join(f"{r.get('section_id','?')}#{r.get('paragraph_index','?')}"
                                       f":{r.get('source_id','?')}" for r in inaccessible[:5])
                    errors.append(
                        f"{path.name}: published=true but {len(inaccessible)} cited "
                        f"source(s) are inaccessible: {sample}"
                        f"{'…' if len(inaccessible) > 5 else ''}. Replace each with "
                        "a fetchable URL before re-publishing."
                    )

    return errors


def main() -> int:
    if not BRIEFS_DIR.exists():
        print(f"[validate] {BRIEFS_DIR} does not exist — nothing to check.")
        return 0
    co_places = load_co_place_names()
    if not co_places:
        print("[validate] WARN: geography-registry.json missing or empty — "
              "single-jurisdiction QA check will be skipped.")

    all_errors: list[str] = []
    briefs = [p for p in sorted(BRIEFS_DIR.glob("*.json"))
              if not p.name.startswith("_")]
    if not briefs:
        print("[validate] No jurisdiction briefs found (skipping _schema.json).")
        return 0

    for p in briefs:
        errs = validate_brief(p, co_places)
        if errs:
            all_errors.extend(errs)

    if all_errors:
        print(f"[validate] FAIL — {len(all_errors)} issue(s) across "
              f"{len(briefs)} brief(s):")
        for e in all_errors:
            print(f"  - {e}")
        return 1

    print(f"[validate] OK — {len(briefs)} brief(s) passed the QA gate.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
