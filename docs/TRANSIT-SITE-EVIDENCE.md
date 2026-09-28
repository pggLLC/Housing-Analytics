# Exact-site THIZ evidence (#1931 — Task 3)

## Controlling source and current limitation

Verified 2026-09-28 against [HB26-1065 as enacted](https://leg.colorado.gov/bills/HB26-1065)
and [2026 Session Laws, chapter 157, §4](https://leg.colorado.gov/laws/session-laws/HB26-1065/157/download).
C.R.S. 24-48.5-136 assigns the **Transit and Housing Investment Zone map**
to Colorado OEDIT, consulting DOLA and CDOT, with publication due October 30,
2026. The act became effective May 27, 2026; that is **not a map vintage**.
The two-mile definition concerns facilities identified on that map. A qualifying
facility is a transit station (the multimodal definition in §24-46-402(23)) or
passenger rail station, not an arbitrary bus stop.

The tracked `data/policy/thiz-map-status.json` was last checked September 26,
2026, says `not_published`, and names no zones file. No authoritative THIZ
geometry or linked facility dataset exists in this checkout. On September 28,
the state legislation was accessible, but the tracked OEDIT program URL could
not be retrieved and targeted state-site searches yielded no usable official
map. This is a limitation of the available evidence, not proof that no map
exists elsewhere. Live results therefore remain `qualified: null`. No polygons,
station classifications, map vintage, or eligibility are invented.

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

The existing tracked `zones_file` loader remains the entry point. Before enabling
it, a maintainer must verify and retain the **actual official geometry and its
facility linkage**, and adapt the published format to:

- FeatureCollection `meta.sourceUrl` matching `map_source_url`, documented
  `meta.vintage`, and `meta.complete: true` only for verified complete Colorado
  coverage. The map status must be `published` and name the tracked file.
- Valid Polygon/MultiPolygon features with a stable `id`, `facilityId` and
  `facilityType` (`transit_station` or `passenger_rail_station`) derived from the
  official map. `facilityName` and `facilityLat`/`facilityLon` are optional,
  retained only when supplied by that source.

This is an internal ingestion contract, **not a claim about an unpublished
OEDIT schema**. Synthetic test fixtures exercise the contract, not actual
Colorado designations. Publication still requires a source review and real-data
integration tests before changing the tracked status file.

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
