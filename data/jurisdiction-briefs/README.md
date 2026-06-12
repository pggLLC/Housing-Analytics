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

## Rendering surface (where briefs live)

Briefs are internal underwriting context and only render on
[`indibuild-brief.html`](../../indibuild-brief.html) — the Jurisdiction
Briefs page in the Developer Tools section of the navigation. That page
is gated by [`js/indibuild-gate.js`](../../js/indibuild-gate.js) (the
`salida2026` password prompt, `sessionStorage['ib-auth-v1']`, 12-hour
session). Public-facing tools — HNA Local Resources panel, PMA tool —
do **not** mount the brief component. The brief JSON is plain (not
encrypted), so the password gate is UI-level, not security.

Internal briefing views can pass `allowDraft: true` to `attach()` to
bypass the `published` check (for previewing unverified drafts during
curation). Public surfaces never set this flag.

## Source-first authoring + verification gate (mandatory, post-2026-06-12)

On 2026-06-12 a fabricated source-to-claim mapping was caught in the
Carbondale brief: source `s9` was supposed to back the Artspace exit
claim, but the cited Sopris Sun URL was about waste/water/ADUs and did
not mention Artspace at all. A follow-up direct-WebFetch audit found
that the brief had **24% supported / 36% partial / 24% unsupported /
16% inaccessible** cite-pairs — the original research-agent pattern
had hallucinated URL ↔ excerpt mappings at scale.

The discipline is now non-negotiable:

1. **WebFetch first.** Before adding any source to a brief, WebFetch
   the URL and ask the model to quote supporting sentences verbatim
   (or say `NOT SUPPORTED`). Never trust an agent's claim that "this
   URL says X" without confirming via WebFetch directly.
2. **Write the claim to match the source**, not the other way around.
   If the source doesn't say it, the brief doesn't claim it.
3. **Record the quote.** Every published brief must have a
   verification report at `data/jurisdiction-briefs/_verified/<geoid>.json`
   capturing the verbatim quote, source URL, and verdict for each
   (paragraph, source) pair.
4. **Validator enforces.** `scripts/validate-jurisdiction-briefs.py`
   refuses `published: true` without a report whose rows are all
   `supported` or `partial`. Any `unsupported` or `inaccessible` row
   blocks publish.

WebSearch is **not** an acceptable substitute for WebFetch. Search
engines return paraphrased snippets that overstate support by keyword
match. The 2026-06-12 audit demonstrated that Carbondale went from
~75% supported under WebSearch to 24% supported under direct WebFetch.

See [`../../docs/JURISDICTION-BRIEFS-HANDOFF.md`](../../docs/JURISDICTION-BRIEFS-HANDOFF.md)
for the full incident write-up, the verification-report schema, and
the per-brief status snapshot.

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

## Scope: who gets a brief

In-scope:

- **All Colorado counties** (5-digit FIPS, 64 total).
- **All Colorado incorporated places with ACS population ≥ 2,000** (city or
  town, 7-digit GEOID).

Out of scope:

- **CDPs** (unincorporated census-designated places). The HNA renders them
  via the place-scaled county brief fallback; they don't get their own.
- **Incorporated places with population < 2,000.** Same fallback path —
  the brief for the containing county is what users see.

Population is read from `data/hna/summary/<geoid>.json` `acsProfile.DP05_0001E`.

## Brief-management scripts

Two scripts surface the curation backlog. The monthly GitHub Actions cron
([`jurisdiction-briefs-monthly.yml`](../../.github/workflows/jurisdiction-briefs-monthly.yml))
runs both and opens a PR with the snapshots.

```bash
# What needs a brief but doesn't have one?
python3 scripts/list-brief-candidates.py            # JSON to stdout
python3 scripts/list-brief-candidates.py --top 20   # top-N by population
python3 scripts/list-brief-candidates.py --write    # _candidates.json

# What existing briefs are stale (>30 days since last_curated)?
python3 scripts/find-stale-briefs.py                # default 30 days
python3 scripts/find-stale-briefs.py --days 60
python3 scripts/find-stale-briefs.py --write        # _stale.json
```

Both produce JSON files under `data/jurisdiction-briefs/` prefixed with `_`
(skipped by the validator). The curator picks GEOIDs off these lists, runs
the research + authoring workflow, and lands the brief in a separate PR.

## Adding a new brief

1. Create `<geoid>.json`. Fill in all required top-level fields.
2. Sources start as `kind: "search"` (durable Google searches) and
   paragraphs carry `needs_source: true` while you research.
3. For each candidate source, **WebFetch the URL** with a verification
   prompt of the form:
   > "Does the article at this URL support the following claim? Quote
   > supporting sentences VERBATIM, or say 'NOT SUPPORTED'.
   > Claim: \<text>"
4. If the source materially supports the claim, swap the search URL
   for the verified primary / secondary / press deep link, clear the
   `needs_source` flag, and **record the verbatim quote** in a row in
   `data/jurisdiction-briefs/_verified/<geoid>.json` (see the schema
   in [`../../docs/JURISDICTION-BRIEFS-HANDOFF.md`](../../docs/JURISDICTION-BRIEFS-HANDOFF.md)).
5. When every (paragraph, source) row in the verification report is
   `supported` or `partial`, set `published: true`.
6. Run `python3 scripts/validate-jurisdiction-briefs.py` — must exit 0.
   Validator rule 8 enforces the verification gate.
7. Commit with message like
   `data(briefs): add <jurisdiction> jurisdictional brief`.

## What this is NOT

- Not a place to dump every news article ever written about housing in a town
- Not a marketing pitch
- Not a substitute for the curated `local-resources.json` entries (housingLead,
  contacts, housing plans) — those stay where they are
- Not auto-generated; do not ship LLM-drafted briefs without source verification
- **Not WebSearch-verifiable.** A search-engine snippet that paraphrases
  the source is not a verification. The verifier must WebFetch the URL
  and quote the article verbatim. (See the 2026-06-12 incident in
  [`../../docs/JURISDICTION-BRIEFS-HANDOFF.md`](../../docs/JURISDICTION-BRIEFS-HANDOFF.md).)
