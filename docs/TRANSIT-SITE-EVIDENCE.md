# Exact-site THIZ evidence (#1931 — Task 3)

## Controlling source

Verified 2026-09-28 against [HB26-1065 as enacted](https://leg.colorado.gov/bills/HB26-1065)
and [2026 Session Laws, chapter 157, §4](https://leg.colorado.gov/laws/session-laws/HB26-1065/157/download).
C.R.S. 24-48.5-136 assigns the **Transit and Housing Investment Zone map**
to Colorado OEDIT, consulting DOLA and CDOT, with publication due October 30,
2026. The act became effective May 27, 2026; that is **not a map vintage**.
A zone is the area within two miles of a transportation facility identified on
that map.

OEDIT published the map on 2026-11-03 as an
[ArcGIS Experience](https://experience.arcgis.com/experience/e6147b1935764243814c801b14d6d411)
(checked 2026-11-03). It identifies 10,980 facilities: existing bus stops (the
large majority), rail stations, park-and-rides and mobility hubs, plus planned
facilities marked Concept/Design or Under Construction. The zone is OEDIT's own
dissolved two-mile layer. `scripts/policy/fetch_thiz_zones.mjs`
(`npm run fetch:thiz-zones`) writes both to `data/policy/thiz-zones.geojson`
with each layer's last-edit date; `.github/workflows/thiz-zones-watch.yml`
reports weekly whether OEDIT has edited them since. Program guidelines are not
yet posted, and OEDIT's data notice says the data is subject to change.

## Result and state

`TransitZone.create(...).status(lat, lon, siteSource)` retains the existing
stop-screen fields and adds `program`. Only `program.qualified` determines
THIZ geography eligibility or the calculator's informational credit line.
Legacy `status`, `designation`, and `confirmedOnly` fields do not authorize it.
No money is automatically added to the stack.

An exact site is an explicit `site`, `map_point`, `geocoded_address`, `parcel`,
or `manual_coordinates` location with finite Colorado coordinates. The market
page passes `site` for map clicks, geocoded addresses and coordinate entry;
jurisdiction deep links pass `jurisdiction_centroid`. Missing/unknown provenance
and all proxy sources are unknown even when their coordinates fall in a zone.

The existing controller owns `transitEvidence`; `savePmaToProject()` stores it
in the existing WorkflowState market step, including site provenance. It keeps
program tri-state/reason, coordinates, facility/zone references, source/file,
map vintage (when available), check time, rule, method and distance, alongside
nearest-stop accessibility, stop-data vintage/source and reliability. Selecting
a different point or changing provenance clears current evidence before drawing
or analysis. The project's saved site remains intact until the user saves the
new selection. A delayed load updates saved evidence only when the coordinates
and provenance still match that saved site, including saves made while loading.
Buffer-only changes keep the program result. No second state store or PMA-runner
eligibility system was added.

## Official-map ingestion contract

The tracked `zones_file` loader is the entry point. The file must have:

- FeatureCollection `meta.sourceUrl` matching `map_source_url`, a documented
  `meta.vintage`, and `meta.complete: true` only for complete Colorado
  coverage. The map status must be `published` and name the tracked file.
- Valid Polygon/MultiPolygon zone features with a stable `id`.
- Facility linkage, either (a) a `facilities` table whose `meta.facilityColumns`
  are `id, name, type, status, agency, city, county, lat, lon`, whose row count
  equals `meta.facilityCount`, and whose rows each carry an id, a type, a status
  (`existing`, `concept_design` or `under_construction`) and Colorado
  coordinates, with `meta.radiusMiles`; or (b) per-feature `facilityId` and a
  non-empty `facilityType`. A malformed table makes every answer unknown.

With a table, a site inside the zone is linked to the nearest listed facility
within `radiusMiles`, preferring an existing one and falling back to a planned
one; the result names its type, status and agency. Any type OEDIT lists counts,
because the published map lists bus stops and the statute defines the zone by that map; the site follows the map until program guidelines say otherwise (owner decision, 2026-11-04). Inside
the zone with no listed facility in range stays unknown with a reason.

`true` requires the exact point in a valid official polygon with identified
qualifying facility; `false` requires the point outside all polygons in a
verified complete map. Missing, partial, malformed, failed or unlinked sources
return `null` with a reason. A point exactly on a mapped boundary also stays
unknown pending confirmation. No stop proximity fallback exists.

The determination uses official polygon membership. If the mapped facility
has coordinates, its distance from the site is retained as straight-line
haversine miles, **descriptive only**: it does not redraw the state boundary or
claim to implement an official walking/network measurement. The statutory
threshold is retained separately. Without facility coordinates distance and
method stay null. Nearest ordinary stops use their own straight-line distance
and never become qualifying facilities. Current stop data lacks routes and
frequency; the page says so. PMA resident demand and the existing general
accessibility score remain separate from this site-program determination.

## Validation

`npm run test:site-transit-evidence` exercises the resolver, production marker,
gate, controller, calculator and saved/reopened project. Existing transit-zone,
funding-line, absence, QCT/DDA, OZ and site-persistence guards remain in CI.
The PR records applied/restored methodology sabotage and the full-suite result.
