# Ballots, campaign platforms and housing appointments

H2 defines storage and validation only. It ships no measure, candidate or
appointment records, and does not change public rendering. The JSON Schemas in
`schemas/` define structure; `tests/policy_schema.py` also enforces relationships,
evidence, neutrality and dates. Both are exercised by pytest in `ci-checks`.

```sh
pytest tests/ -k 'policy or ballot'
pytest tests/ -k candidate
```

## Ballot files for R1 and R2

`data/policy/ballot-2026/statewide.json` and each
`data/policy/ballot-2026/counties/<county GEOID>.json` use `ballot/v1`:
`{schema, coverage: [...], entries: [...]}`. `coverage` is never empty.
State GEOID is `08`; county GEOIDs are five-digit strings; municipal GEOIDs are
seven-digit strings. Names match `geo-config.json` labels, including its city/town
suffixes. The 64 county files contain the county row and precisely the `places`
whose `containingCounty` names it. CDPs are excluded. This single-file assignment
also applies to municipalities that physically span county boundaries.

The initial 337 rows are all `not_researched`, with `reviewed_source: null`,
`checked: null`, empty `entry_ids` and empty `limitations`. No review is implied.
The live-data tests derive the municipality count and exact membership from
`geo-config.json`; the county count must remain 64.

`reviewed_source` is one HTTPS URL, the principal official list/ballot/notice.
Optional `reviewed_sources: [{url, retrieved}]` retains additional pages, including
municipal clerk pages and participating-entity lists. Put measures reviewed but
excluded, exact quotes for unresolved classifications, and unreadable-source
explanations in `limitations`. Every state other than `not_researched` requires
`reviewed_source` and `checked`. Only `verified_measure_found` has `entry_ids`.
Each ID must resolve exactly once in its own file, to the same jurisdiction;
unreferenced entries, duplicate IDs and cross-file links fail.

Entry fields are described in `schemas/ballot-2026.schema.json`. Decisions where
the handoff left the representation open:

- `measure.number` is a string for letters as well as numbers. Fiscal values
  (`mechanism`, `rate`, `amount_cap`, `duration`, `sunset`) are source-worded
  strings, or `null` when unknown/not supplied. They are not numeric estimates.
- All five `sources` keys are present. Each is `null` or `{url, retrieved}`.
  `certified` and `on_ballot` require `certification` or `ballot_notice`.
- `evidence` contains `{section, quote}`. Verification has `level` (`primary` or
  `reported`), `against`, `checked`, and `by` for a named reporting outlet.
- `result` is `null` until known, then `{outcome: passed|failed,
  stage: unofficial|certified, source: {url, retrieved}, as_of}`. Results do not
  override the requirement to archive an old election. A terminal `passed` or
  `failed` status requires a result with the same outcome.
- `history` contains `{checked, note, source}`, where `source` is `null` or
  `{url, retrieved}`. Use an empty array until there is a change to record.
- `archived` is an explicit boolean. An unarchived entry fails starting on the
  45th day after the election (day 44 passes, day 45 fails).

## Candidate records for R3

`data/policy/candidate-platforms-2026.json` uses `candidate-platforms/v1` and
ships `races: []` and `candidates: []`. Offices are exactly
`Governor/Lieutenant Governor`, `Attorney General`, `Secretary of State`,
and `Treasurer`. A joint ticket is one roster item/coverage record, with the
candidate or ticket name transcribed consistently from the official list.

Each race adds these minimal fields to the handoff:

- `certified_candidates: [{candidate, party}]` is a **separate authoritative
  roster**, transcribed from the Secretary of State candidate list in ballot
  order. Never derive it from `candidates[]`. `party` is the printed ballot label,
  including minor-party and unaffiliated labels; it has no analytic meaning.
- `roster_checked` dates that transcription. A populated roster or any candidate
  record requires both this date and `candidates_source`, an HTTPS URL under the
  Colorado Secretary of State elections path. An untouched race may use an
  empty roster and null source/date. Human QA must verify that the URL really is
  the applicable complete certified list; hostname checks cannot establish that.
- Race `coverage_state` is `not_researched` or `complete`. Use `not_researched`
  until every campaign coverage record has a state other than `not_researched`.
  Even while the race is `not_researched`, adding **any** candidate record requires
  one campaign coverage record for **every** roster identity. Missing candidates
  get explicit unresearched placeholders, never fabricated verification.

A campaign coverage record has the handoff's fields plus required `archived`
and `verification.checked` when verified. Election dates come from its race,
so the date cannot disagree between a race and its candidates.

- For `not_researched` or `campaign_source_unavailable`, verification is `null`;
  summary/quote are empty strings, and topics/appointments are empty arrays.
  Campaign source fields may all be `null`. Log an unsuccessful search and its
  date in `history` without inventing a verification claim.
- `verified_platform_found` requires a primary verification, campaign URL,
  retrieved date, topics, attributed neutral summary and verbatim quote.
- `official_material_reviewed_no_housing_position_found` requires primary
  verification with a checked date and a campaign URL/retrieved date, but empty
  topics, summary and quote. Optional `reviewed_sources` preserves all pages read.
  The renderer can show the specified absence label using `verification.checked`.
- `campaign_source.published` is null if the page provides no date;
  `archive_url` is null if no snapshot was found. All stored dates are ISO calendar
  dates. Future `checked` dates fail; genuine future appointment effective/term-end
  dates are allowed.
- `proposed_appointments` items add `claim_type: "campaign_claim"` to the handoff's
  role/person/source/quote. Source is `{url, retrieved}`; `person` is null for an
  announced position with no named person. This is never a government appointment.

R3 may append a **separate supplemental candidate item** with the same
candidate/office/party, `verification.level: "reported"`, `verification.by`
naming the outlet, a checked date, and that report's URL/retrieved date in
`campaign_source`. Its coverage state must be `not_researched` or
`campaign_source_unavailable`: it cannot establish verified campaign material
or absence of a housing position. It needs a verbatim quote and cannot contain
proposed appointments. A reported item never satisfies roster completeness or
replaces the campaign coverage record. Keep the record's `neutral_summary`
attributed to the named outlet. Campaign and reported quotes are limited to 40
whitespace-delimited words, as requested by R3.

## Existing policy watch and R4

`schemas/policy-watch.schema.json` formalizes the existing `policy-watch/v1`
shape. All six existing QAP entries and the data file itself are unchanged.
The new fields are optional, allowed only for `section: "people"`:
`role`, `agency`, `appointing_authority`, `person: {name}`, `action`,
`dates: {nominated, confirmed, effective, term_end}`, `predecessor`, `relevance`.
The dates are nullable ISO dates; unknown authority/predecessor may be null.
`relevance` is an array of source-grounded housing-role explanations.
Existing title/status/source/evidence/verification fields still apply. People
entries require primary verification; unknown roles remain in `meta.known_gaps`.
The person's object allows only a name. No contacts, biographies or photographs.

## R5 rendering contract and validation limits

Discover county files using `geo-config.counties`, not a hand-maintained index.
Coverage rows, including every unavailable/unresearched row, remain visible.
For each candidate race, order by `certified_candidates`; select its campaign
coverage records by `verification.level != "reported"` (including null).
If any campaign record is unresearched, suppress all race summaries. Supplemental
reported items do not change that gate and must be visibly attributed separately.
Display parties only as ballot labels and proposed appointees as campaign claims.
Archived or expired records belong under Past elections. Expiration begins on
day 45 for validation and should use the same boundary in rendering.

Unknown properties fail schema validation. Forbidden fields (scores, ranks,
endorsements, stances and party inference) are also checked recursively, including
history. Neutral title/detail/summary text is scanned for endorsement and
recommendation forms, best, friendly, pro- and anti-. Quoted source material is
excluded from that wording scan so it can remain verbatim.

Dollar, percentage, mill and duration figures in neutral prose must match the
same record's evidence/quote as typed values. Common unit/number spellings and
abbreviations normalize without rounding; explicit calendar years and both ends
of unit ranges are checked too. Equivalent wording passes; invented figures fail.
These are mechanical checks of the text stored in the repository. They cannot
establish source authenticity, legal interpretation, quote context, complete
roster transcription or political neutrality on their own. Owner/Claude QA must
read the cited pages for future populated records. H2 performs no research.

The handoff's explicit two-manifest check takes precedence over the older
`CHANGE-IMPACT.md` instruction against local rebuilds. Run the audit manifest,
then `scripts/rebuild_manifest.py`, then `scripts/validate-schemas.js`; check for
iCloud duplicates immediately beforehand. Do not commit generated manifests
or inventory lines. Pytest is already in CI, so no package.json edit is needed.
PR CI also refreshes the Data Trust Center's derived counts after rebuilding the
manifest, using the existing post-merge refresh command. This is required because
H2 adds 66 data files; it avoids committing a generated count alongside the source.
