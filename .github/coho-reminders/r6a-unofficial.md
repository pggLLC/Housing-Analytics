<!-- coho-reminder:r6a-unofficial -->
Owner decision: 2026-09-27 — move the dated COHO election follow-ups from the deleted Claude Code routines into the repository.

the merged schema allows `result.outcome` only
`passed|failed`, and the source URL lives at `result.source.url`. There is no `recount` outcome. For a
too-close / recount / contested measure, set `status: "litigated"` and add a `limitations[]` line quoting the
official notice; do not add a result. The R6-A text below still says "recount" — follow the schema, not the text.

Merged-field clarification (takes precedence over the legacy block below): `result.source`
is `{url, retrieved}` and `result.as_of` is an ISO calendar date, not a timestamp.
Append history using `{checked, note, source}`; `source` is `{url, retrieved}` or `null`.
Read `docs/POLICY-ELECTION-SCHEMAS.md` and the merged schemas before writing data.

## R6-A — November 4–20, 2026

Repo pggLLC/Housing-Analytics. Read AGENTS.md. Branch + PR only; no generated files committed.
Preconditions: R6-0 and the ballot data PRs are merged. Touch only data/policy/ballot-2026/statewide.json and
data/policy/ballot-2026/counties/*.json. Do not touch candidate-platforms-2026.json.

For every ballot entry with status "on_ballot":
1. Source, in this order:
   - statewide measures: the Secretary of State's official election-night results site (the SoS
     election-results page for the November 3, 2026 General Election);
   - county and municipal measures: the county clerk's official election-results page for that county;
   - a municipality's own posted results only when the county does not report that municipal question.
   News outlets are never a source for a result.
2. Record result = {outcome: "passed"|"failed", stage: "unofficial", source: <URL>, as_of: <the timestamp the
   results page shows, else today>}. Add one evidence item quoting the results line exactly as the page shows it
   (question label and yes/no totals), with section "unofficial results".
3. Leave status "on_ballot" (not passed/failed) until certification. Do not set archived.
4. Too close to call, or a recount has been announced: result.outcome "recount" or no result at all, and a
   limitations[] line quoting the official notice. Never infer the outcome from a partial count.
5. Append to history[]: {date, change: "unofficial result added", source}.
6. An entry whose results you could not find: no result; list it in the PR body.
Do NOT change neutral_title, detail, the official question, or any pre-election evidence.
Run pytest tests/ -k "policy or ballot". Stop at an open PR. The PR body has a table: entry id · outcome ·
source · as_of, plus the not-found list.

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
