<!-- coho-reminder:r6b-certified -->
Owner decision: 2026-09-27 — move the dated COHO election follow-ups from the deleted Claude Code routines into the repository.

Archive deadline: **2026-12-18**. Must merge before this date: it is the election
on 2026-11-03 plus 45 days, the first failing day for unarchived records.

Merged-field clarification (takes precedence over the legacy block below): `result.source`
is `{url, retrieved}` and `result.as_of` is an ISO calendar date, not a timestamp.
Append history using `{checked, note, source}`; `source` is `{url, retrieved}` or `null`.
Read `docs/POLICY-ELECTION-SCHEMAS.md` and the merged schemas before writing data.
The merged candidate schema has no race-level `archived` or `history` fields.
Archive each candidate record; preserve race metadata and do not invent those fields.
This correction overrides the legacy block's instruction to archive races.

## R6-B

Repo pggLLC/Housing-Analytics. Read AGENTS.md. Branch + PR only; no generated files committed.
Preconditions: R6-A is merged, and the Secretary of State has certified the November 3, 2026 statewide results
(check the SoS certification notice or official abstract; county canvass boards certify first). Must merge
before December 18, 2026, when the 45-day currency test starts failing.
Touch data/policy/ballot-2026/**, data/policy/candidate-platforms-2026.json, and data/policy/policy-watch.json
(meta and "people" only).

1. Ballot entries:
   - statewide: take the result from the SoS certified official abstract or certification notice;
   - county and municipal: take it from the county's certified official results or canvass abstract.
   For each entry:
   - set result = {outcome, stage: "certified", source, as_of: certification date}, and quote the certified line
     in evidence (section "certified results");
   - set status to "passed" or "failed", or keep "litigated" with a limitations[] line quoting the official
     notice when a recount or contest is open;
   - when certified and unofficial outcomes differ, record both in history[] and say so in the PR body;
   - set archived: true once the certified result is recorded. A litigated entry stays unarchived, and the PR
     body says the 45-day test will fail on it: list the entry ids so the owner can decide whether to extend
     them.
2. Coverage rows: do not change coverage_state or checked. They describe what was researched before the
   election and stay as the record of that.
3. Candidate platforms: set archived: true on every candidate record and race; append to history[]
   {date, change: "archived after the November 3, 2026 election"}. Do NOT add who won, vote totals, or any
   judgement of platforms against results. Do not edit summaries or quotes.
4. policy-watch.json: update meta.known_gaps and meta.as_of so the ballot and candidate lines say the 2026
   coverage is archived, and name what remains open (litigated entries, any not_researched rows).
   Leave the "people" entries as they are; the governor-elect's appointments are a separate follow-up.
5. Nothing is deleted. Every pre-election field stays byte-for-byte as it was, apart from result, status,
   archived and history[].
Run pytest tests/ -k "policy or ballot or candidate". Stop at an open PR. The PR body has a table: entry id ·
certified outcome · source · certification date, and lists any entry left unarchived and why.

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
