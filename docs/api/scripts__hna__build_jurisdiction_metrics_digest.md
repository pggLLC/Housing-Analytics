# `scripts/hna/build_jurisdiction_metrics_digest.mjs`

Build per-jurisdiction metric digests for future brief generation.

This is a non-scoring data spine: it reads the committed ranking index and
summaries, tags each affordable-housing-relevant metric with provenance, and
writes one digest per ranked geography. It must not rebuild or rewrite
data/hna/ranking-index.json.

## Symbols

### `acsVintageLabel(year, series = 'acs5')`

"ACS 2020-2024 5-year" from a summary's acsProfile._acsYear/_acsSeries.

### `chasVintageLabel(vintage)`

"HUD CHAS 2018-2022" from a CHAS file's vintage field.

### `acsAsOf(summary)`

The ACS vintage of the summary this jurisdiction's ACS values came from.
