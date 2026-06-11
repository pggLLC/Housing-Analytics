# Jurisdictional housing-history briefs

Curated narrative briefs that summarize each jurisdiction's affordable-housing
history: prior LIHTC awards/denials, town-owned land donations, capital pledges,
dedicated revenue streams, coalition memberships, and policy decisions. Surfaced
in the developer tools (HNA Local Resources panel and PMA tool) as
context that an underwriter or developer needs before scoping a deal.

## File naming

One JSON file per jurisdiction, named by 7-digit Census place GEOID (or 5-digit
county FIPS for county-level briefs):

```
data/jurisdiction-briefs/
  0812045.json     # Carbondale (town)
  0830780.json     # Glenwood Springs (city)
  08045.json       # Garfield County (county-level)
```

The component looks up `place:<geoid>` first, then falls back to
`county:<containing-county>` when no place-level brief exists.

## Schema

See [`_schema.json`](./_schema.json) for the JSON Schema. Required fields:

| Field             | Description                                              |
|-------------------|----------------------------------------------------------|
| `geoid`           | 5- or 7-digit FIPS — must match filename                 |
| `jurisdiction`    | Human-readable name (e.g. `"Town of Carbondale"`)        |
| `scope`           | One of `place`, `county`, `cdp`                          |
| `containing_county_fips` | 5-digit county FIPS that contains this jurisdiction |
| `last_curated`    | ISO date (`YYYY-MM-DD`) of most recent verification      |
| `curator`         | Initials or name of curator                              |
| `sections`        | Ordered array of narrative sections (see below)          |
| `sources`         | Deduped array of source records (see below)              |

### Sections

Each `section` has:

```json
{
  "id": "lihtc-history",
  "heading": "LIHTC application history",
  "paragraphs": [
    { "text": "In February 2024 …", "cites": ["s1", "s2"] }
  ]
}
```

`cites` reference source `id`s in the same file. Every factual claim should
carry at least one cite. Claims without cites must be flagged with
`"needs_source": true` on the paragraph so QA can pick them up.

### Sources

```json
{
  "id": "s1",
  "label": "CHFA 2024 R1 award decisions",
  "url": "https://www.chfainfo.com/…",
  "kind": "primary"        // "primary" | "secondary" | "press" | "search"
}
```

When a verified deep link isn't available, use a durable Google search scoped
to the jurisdiction (matches the existing repo convention in
[`data/hna/local-resources.json`](../hna/local-resources.json)) with
`"kind": "search"`. Searches don't rot; deep links do.

## Publish gate

Every brief carries a `published: boolean` flag (defaults to `false`). The UI
component on the HNA Local Resources panel and the PMA tool **only renders
briefs where `published === true`** — unpublished drafts never reach the public
site. An internal "briefing" view can opt into draft rendering by passing
`allowDraft: true` to `JurisdictionBrief.attach()`, but the public surfaces do
not.

The validator enforces, for any brief with `published: true`:

- Zero paragraphs flagged `needs_source: true`
- Zero sources of `kind: "search"` (must be `primary` / `secondary` / `press`)

Flip `published` to `true` only when every claim has been verified against a
deep-linked primary, secondary, or press source.

## Curation rules (QA bar)

These rules are what the user explicitly flagged on 2026-06-11 — a sample brief
they reviewed conflated multiple Roaring Fork jurisdictions and was not
acceptable.

1. **Single-jurisdiction scope.** Every factual claim must be about THIS
   jurisdiction's actions, properties, decisions, or budget. Regional context
   (coalitions, county-level programs) is allowed only when this jurisdiction
   formally participates — and must be clearly labeled as regional, not
   attributed to the jurisdiction itself.

2. **Source per claim.** Every factual claim has at least one source `id` in
   `cites`. A paragraph without `cites` must set `needs_source: true` so the
   validator flags it and the renderer surfaces a "source pending" badge.

3. **No fabrication.** If a source link is unverified, mark it
   `"kind": "search"` and use a Google search query, not a guessed deep link.
   Never invent a URL.

4. **Date specificity.** Any "recent" / "current" claim needs a year-month
   precision (e.g. `"In February 2024 …"`, not `"recently …"`).

5. **Coalition / multi-jurisdiction sections** must live under a section with
   `id` starting `coalition-` or `regional-` so the QA validator can apply
   looser cross-jurisdiction rules to that section only.

## Adding a new brief

1. Create `<geoid>.json` from the template in `_template.json`.
2. Fill in all required fields. Use durable search URLs when deep links aren't
   verified.
3. Run `python3 scripts/validate-jurisdiction-briefs.py` (see file for what it
   checks — currently: schema compliance + single-jurisdiction rule for
   non-coalition sections).
4. Commit with message like `data(briefs): add Carbondale jurisdictional brief`.

## What this is NOT

- Not a place to dump every news article ever written about housing in a town
- Not a marketing pitch
- Not a substitute for the curated `local-resources.json` entries (housingLead,
  contacts, housing plans) — those stay where they are
- Not auto-generated; do not ship LLM-drafted briefs without source verification
