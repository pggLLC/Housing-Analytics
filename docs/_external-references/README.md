# External Reference Documents

Mirror of upstream data publishers' technical documentation, kept in-repo
so that future debugging doesn't depend on those publishers' availability.

## Why this directory exists

During the 2026-05-08 CHAS audit, the parsing bug investigation was delayed
~1 hour because HUD's CDN gates direct downloads of the CHAS data dictionary
behind a WAF challenge (returns HTTP 202 with empty body for non-browser
clients). The dictionary was eventually sourced from the Wayback Machine.
Mirroring critical reference docs here prevents that class of friction.

## What lives here

| File | Source | Why it matters |
|---|---|---|
| `HUD-CHAS-data-dictionary-2018-2022.xlsx` | HUD CDN (gated behind WAF) | Definitive column → semantic mapping for CHAS Tables 1-18. Required reference for `scripts/fetch_chas.py` to interpret which T7_estN column corresponds to which HAMFI tier × cost-burden cell. |

## Adding a new reference

When you add a new external data source pipeline, also mirror its primary
reference doc here:

1. Download the canonical version (data dictionary, methodology PDF, etc.)
2. Save with a name that includes the publisher + vintage
3. Add a row to the table above with the source URL + why it matters
4. If the source updates the doc, refresh the mirror within a sprint

## Licensing

These mirrors are copies of public-domain US Government documents (HUD,
Census Bureau, BLS, FRED). No license-tracking required, but if you mirror
a non-government source, capture its license alongside the file.
