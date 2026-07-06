# `js/ic-summary.js`

ic-summary.js — render a one-page LIHTC underwriting snapshot for a chosen
jurisdiction. The HNA / OF / Compare pages have already been audited so the
place-level data files we read here are trustworthy (F30–F46). This page
pulls a curated subset into a single printable view so a developer can drop
it into an investment-committee packet.

URL: ic-summary.html?geoid=<7-digit place geoid>      (place / CDP)
     ic-summary.html?geoid=<5-digit county FIPS>      (county)

Data loaded (all already in repo):
  data/hna/summary/{geoid}.json        — ACS profile (place / county)
  data/hna/place-lehd.json             — per-place LEHD blob (F40 + F46)
  data/hna/place-chas.json             — per-place CHAS summary (F28)
  data/co_ami_gap_by_place.json        — per-place affordable demand (F30)
  data/co_ami_gap_by_county.json       — fallback for county selection
  data/hna/local-resources.json        — Prop 123 / plans / authority (F44)
  data/co-place-centroids.json         — place centroids for radius
  data/market/hud_lihtc_co.geojson     — statewide LIHTC points
  data/hna/geo-config.json             — place→county membership
  data/dda-colorado.json               — DDA designations
  data/qct-colorado.json               — QCT tracts

Render order matches the underwriting narrative: profile → demand → commute
→ competition/basis → civic → peers.

_No documented symbols — module has a file-header comment only._
