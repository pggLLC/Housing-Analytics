# `js/hna/county-comparison.js`

Place-vs-county comparison.

A county figure is almost never the figure a housing professional needs.
Funding applications, inclusionary ordinances and site scoring happen at the
municipal scale, and "Boulder County: 31.2% severe renter burden" hides the
fact that the same county contains Louisville at 18.7% and Boulder city at
41.0%. That spread is the product; until now the page never showed it.

Everything needed already exists. Each jurisdiction-metrics digest carries
`geography.containingCounty`, and every metric carries its own value,
`geography_level`, `confidence`, `source_id`, `as_of` and — where it is a
rate — a `denominator_key` and `denominator`. So the comparison is a lookup
of two ~29KB documents, not a computation.

Three rules keep the comparison honest:

1. RATES ONLY. A place always has fewer units than the county containing it,
   so comparing levels ("8,888 vs 13,990 units needed") invites a reading
   that is arithmetically guaranteed and tells the reader nothing. A metric
   is comparable iff it declares a `denominator_key`. That is data-driven:
   29 metrics qualify, all of them pct_/rate/share, and every pct_ metric
   has one. `measure_type` is NOT usable for this — it labels
   pct_cost_burdened as "level".

2. NEVER COMPARE A VALUE WITH ITSELF. If a place's metric is carrying the
   county's own number, the delta is zero by construction and would read as
   "this town matches its county". All 482 places currently hold genuine
   place-level values for all 29 rate metrics, but the guard costs nothing
   and the invariant is not guaranteed.

3. DROP UNRELIABLE DENOMINATORS. A rate computed over a denominator below
   the digest's floor is already flagged; comparing it would give a precise-
   looking delta built on a handful of households.

## Symbols

### `DISPLAY_METRICS`

The metrics worth putting in front of a practitioner, in reading order.
Deliberately a curated subset — all 29 comparable rates would be a data
dump, and the point is a decision, not an inventory. Labels follow the
existing wording in hna-ranking-index.js where they overlap.

`higherIsWorse` drives the plain-language reading only; the delta itself
is always stated as a signed difference so a reader can disagree.

### `containingCountyOf(digest)`

The containing county for a place digest, or null.

### `comparable(placeMetric, countyMetric)`

comparable — may this metric be compared between the two geographies?
Returns a reason string when it may not, so callers can explain a gap
rather than silently dropping a row.

### `compare(placeDigest, countyDigest, opts)`

compare — build the place-vs-county rows.

@param {object} placeDigest   jurisdiction-metrics digest for the place
@param {object} countyDigest  digest for its containing county
@param {{metrics?: Array}} [opts]
@returns {{available: boolean, reason: (string|null), place: object, county: object,
           rows: Array, skipped: Array}}

### `describeDelta(row)`

describeDelta — a plain-language reading of one row.
Returns null where "better"/"worse" would be a value judgement the data
does not support (renter share, multifamily share).
