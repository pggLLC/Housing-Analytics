<!-- coho-reminder:adams-sample-ballot -->
Owner decision: 2026-09-27 — move the dated COHO election follow-ups from the deleted Claude Code routines into the repository.

Adams County (08001) sample ballot is due 2026-10-01. Re-check only the rows still
at `official_notice_unavailable` in `data/policy/ballot-2026/counties/08001.json`.
The owner handoff names Thornton, Brighton, Commerce City and Westminster among
the places awaiting it; use the actual rows in the committed file, not that list.
Read the county clerk's official sample ballot and the municipal clerk pages,
applying the R2 inclusion and coverage rules below. Record sources and Denver
checked/retrieved dates. Leave every other row untouched. Branch + PR only.

Repo pggLLC/Housing-Analytics. Read AGENTS.md. Branch + PR only; no generated files committed.
Precondition: the ballot schema PR is merged. Batch: counties 08001.
Touch ONLY data/policy/ballot-2026/counties/<geoid>.json for these counties. First confirm each GEOID's county
name and municipality rows against data/hna/geo-config.json.

For each county, in this order:
1. Find the county clerk's official election page for November 3, 2026. From it, collect:
   a. the TABOR notice and/or the official sample ballot (or ballot-content certification);
   b. the list of political subdivisions participating in the coordinated election (the list or IGA of
      participating entities).
   Record every URL you use, with its retrieved date.
2. County questions: read every county-level question on the sample ballot or notice. Decide housing relevance
   by these rules:
   - include when the question creates, extends or earmarks a tax, fee, bond or revenue retention for housing or
     homelessness; changes land use, zoning, growth limits or housing regulation; or concerns short-term-rental
     or lodging taxes dedicated to housing;
   - exclude general revenue retention (de-Brucing) unless the question text earmarks housing;
   - when unsure, record the question in the row's `limitations` with its exact text for owner review. Do not
     create an entry for it.
   Each included question becomes an entry with:
   - status "on_ballot";
   - the question letter or number;
   - the full official question text quoted verbatim in evidence;
   - neutral_title (mechanism only);
   - fiscal fields exactly as the question states them;
   - sources.ballot_notice, plus sources.resolution if you can find the referring resolution.
3. Municipal questions: for EVERY municipality row in the file:
   - not participating (absent from the participating-entities list): set not_applicable, with the list URL as
     reviewed_source. Do not guess from memory.
   - participating: check the municipality's measures on the county sample ballot or notice AND the municipal
     clerk's own election page. A county summary may omit municipal measures. Apply the same inclusion rules.
4. Coverage state for each row:
   - verified_measure_found, when you created an entry;
   - official_ballot_reviewed_none_found, when you read the official ballot or notice and found nothing that
     qualifies;
   - official_notice_unavailable, when the county or municipality has not posted it yet (note the date you
     checked);
   - source_unreadable, for a scanned or blocked PDF (say which);
   - leave not_researched only if you ran out of time. Say so in the PR body.
   Every row not left at not_researched carries reviewed_source + checked. Never mark none_found without having
   read the notice itself.
5. The Colorado Health Foundation's local ballot measure tracker
   (https://coloradohealth.org/local-ballot-measure-tracker) and news stories may be used ONLY to find measures
   to verify. Never cite them as the source of an entry.
Neutrality: quote the question; paraphrase only in neutral_title; no adjectives; no predictions.
Every figure in neutral_title/detail must appear in evidence.
Run pytest tests/ -k "policy or ballot". Stop at an open PR. The PR body has a table: county/municipality ·
state · source · entries created · anything flagged for owner review.

## Ground rules (owner handoff section 5)

- Never commit generated files: `data/manifest.json`, `data/_manifest.json`, `data/paper/*`, `methods.html`,
  `working-paper.html`, the README/AGENTS inventory line. On conflict take main's copy. CI regenerates them.
- Never hand-edit counts in `js/data-source-inventory.js`; CI re-syncs them.
- Before asking for review and after any merge to main: merge `origin/main` into the branch and confirm
  **ci-checks actually ran and passed on that head**. Draft PRs, conflicting PRs, runs awaiting approval,
  and commits containing the CI-skip directive all run no CI and can still look "clean".
- Never write the CI-skip directive in a commit message, even in prose.
- Stay in your own files; if another open PR touches a file you need, say so on your PR.
- Missing values are `null`, never `0`.
- Keep the developer gate in `js/developer-gate.js`.
- Don't merge while `build-hna-data.yml` is running.
- Give the owner one PR at a time, by number and full title; say explicitly when it is green and up to date with main.
- Research sources: official county clerk / SoS / municipal pages only. The Colorado Health Foundation tracker
  and news may be used to FIND measures, never cited. colorado.gov often returns 403 to automation.
