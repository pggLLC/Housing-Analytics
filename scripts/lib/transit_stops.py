"""
scripts/lib/transit_stops.py

Which statewide transit stops count as transit, in one place.

Both amenity builders read data/amenities/transit_stops_statewide_co.geojson
through this module:

  * scripts/hna/build_ranking_index.py — the transit part of
    amenity_access_score;
  * scripts/market-analysis/build_neighborhood_access.py — the transit_stop
    records OsmAmenities.getAccessScore() scores.

The rule (owner decisions, 2026-09-27):

  * A stop counts when the file's own fields say it is a confirmed, public,
    scheduled stop: ``reliability == "confirmed"`` (published by CDOT, an
    agency GTFS feed, or both — CDOT-only stops are mostly fixed-route), not
    ``operator == "private_shuttle"``, and not ``service == "demand_response"``
    (on-demand providers are not defined transit routes). ``service ==
    "unknown"`` still counts: unknown is not demand response.
    js/transit-zone.js applies the same confirmed/private rule to the same
    file (it treats anything not ``"unconfirmed"`` as confirmed; the file only
    ever holds the two values, and tests/test_transit_stop_selection.py
    checks that the two readings select the same stops).
  * OpenStreetMap-only stops (``reliability == "unconfirmed"``) never count
    where a confirmed stop is in range. They are a FALLBACK only: a point with
    no counted confirmed stop within the builder's own radius, but at least
    one public, non-demand-response OpenStreetMap-only stop, is scored on the
    OpenStreetMap-only stops instead of scoring zero — a town whose only
    mapped transit is in OpenStreetMap would otherwise read as "no transit",
    an unmeasured quantity shown as 0 (AGENTS.md, #1480). The basis is carried
    on the output so a reader can see which it was.

Distances and radii stay with each builder; this module only decides which
stops are eligible and which basis a point is scored on.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Callable, Iterable, Sequence

STATEWIDE_STOPS_REL = "data/amenities/transit_stops_statewide_co.geojson"

BASIS_CONFIRMED = "confirmed"
BASIS_OSM_FALLBACK = "openstreetmap_unconfirmed"
BASIS_NONE = "none"
BASES = (BASIS_CONFIRMED, BASIS_OSM_FALLBACK, BASIS_NONE)


def _public_scheduled(props: dict) -> bool:
    return props.get("operator") != "private_shuttle" and props.get("service") != "demand_response"


def counts_as_confirmed(props: dict) -> bool:
    """A confirmed, public, scheduled stop: the set both builders count."""
    return props.get("reliability") == "confirmed" and _public_scheduled(props)


def is_osm_fallback(props: dict) -> bool:
    """An OpenStreetMap-only public stop: eligible only where no confirmed stop is in range."""
    return props.get("reliability") == "unconfirmed" and _public_scheduled(props)


def _point(feature: dict) -> tuple[float, float] | None:
    geom = feature.get("geometry") or {}
    coords = geom.get("coordinates") or []
    if geom.get("type") != "Point" or len(coords) < 2:
        return None
    try:
        lon, lat = float(coords[0]), float(coords[1])
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return None
    return lat, lon


def load_stops(path: str | Path) -> dict[str, list[dict]]:
    """{basis: [feature, ...]} for the two eligible classes. A missing or
    unreadable file returns two empty lists: the caller decides what absence
    means (neither builder may turn it into a zero silently)."""
    out: dict[str, list[dict]] = {BASIS_CONFIRMED: [], BASIS_OSM_FALLBACK: []}
    try:
        doc = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return out
    for feat in (doc.get("features") or []) if isinstance(doc, dict) else []:
        if not isinstance(feat, dict) or _point(feat) is None:
            continue
        props = feat.get("properties") or {}
        if counts_as_confirmed(props):
            out[BASIS_CONFIRMED].append(feat)
        elif is_osm_fallback(props):
            out[BASIS_OSM_FALLBACK].append(feat)
    return out


def points(features: Iterable[dict]) -> list[tuple[float, float]]:
    """(lat, lon) for each Point feature, sorted, for the distance loops."""
    return sorted(p for p in (_point(f) for f in features) if p is not None)


Distance = Callable[[float, float, float, float], float]


def any_within(lat: float, lon: float, pts: Sequence[Sequence[float]], radius: float, distance: Distance) -> bool:
    return any(distance(lat, lon, p[0], p[1]) <= radius for p in pts)


def basis_for_point(lat: float, lon: float, radius: float,
                    confirmed: Sequence[Sequence[float]], osm_fallback: Sequence[Sequence[float]],
                    distance: Distance) -> str:
    """Which stops a point is scored on. Confirmed wins whenever one is in range."""
    if any_within(lat, lon, confirmed, radius, distance):
        return BASIS_CONFIRMED
    if any_within(lat, lon, osm_fallback, radius, distance):
        return BASIS_OSM_FALLBACK
    return BASIS_NONE


def select_for_point(lat: float, lon: float, radius: float,
                     confirmed: Sequence[Sequence[float]], osm_fallback: Sequence[Sequence[float]],
                     distance: Distance):
    """(basis, the stops to score this point on).

    confirmed -> the confirmed stops only; openstreetmap_unconfirmed -> the
    OpenStreetMap-only stops only (never mixed); none -> the confirmed stops,
    none of which is in range, so the builder's own scoring gives its usual
    out-of-range result.
    """
    basis = basis_for_point(lat, lon, radius, confirmed, osm_fallback, distance)
    return basis, (osm_fallback if basis == BASIS_OSM_FALLBACK else confirmed)
