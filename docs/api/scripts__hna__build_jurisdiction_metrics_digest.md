# `scripts/hna/build_jurisdiction_metrics_digest.mjs`

Build per-jurisdiction metric digests for future brief generation.

This is a non-scoring data spine: it reads the committed ranking index and
summaries, tags each affordable-housing-relevant metric with provenance, and
writes one digest per ranked geography. It must not rebuild or rewrite
data/hna/ranking-index.json.

_No documented symbols — module has a file-header comment only._
