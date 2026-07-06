# `js/components/vacancy-context.js`

js/components/vacancy-context.js
===============================================================
Renders a vacancy-rate context card on the PMA page.

Data landscape for Colorado vacancy:
  • Census ACS B25004 (5-year estimates) — best FREE machine-readable
    source. Tract-level, annual, ~18 mo lag. Already cached in
    data/market/acs_tract_metrics_co.json (1,447 CO tracts, 2023 vintage).
    We use this as the primary value below.
  • Colorado Division of Housing (DOH) + CHFA quarterly Multi-Family
    Vacancy & Rent Survey — historically the gold standard. DOH sponsorship
    ended Q2 2020; the survey is now run by 1876 Analytics for CHFA and
    published as quarterly PDFs (paid / restricted distribution).
    We can't pull it programmatically but we link to it.
  • DOLA historical regional series (data.colorado.gov / Socrata) —
    publicly downloadable but stops at 2015. Useful only as historical
    trend context, not current-state vacancy.
  • State Demography Office (SDO) — housing stock + population time-
    series; not a vacancy survey but provides denominator data for
    deriving vacancy at the county level when ACS coverage is thin.

The card surfaces:
  1) the buffer-weighted ACS B25004 vacancy rate (the headline figure)
  2) per-tract breakdown for the same buffer
  3) a small "where this comes from" strip with outbound links to the
     three other sources so users can escalate to professional data
     when the public-data view isn't enough

Mount target: id="pmaVacancyContextMount"
Inputs: bufferTracts (array of GEOIDs) — provided by the PMA pipeline.

## Symbols

### `render(container, opts)`

@param {HTMLElement} container - mount point
@param {Object} opts
@param {Array<string>} opts.bufferTracts - GEOIDs in the PMA buffer
@param {Object} [opts.weightsByTract] - optional polygon-clip share per tract
