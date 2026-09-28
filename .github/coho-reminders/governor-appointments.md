<!-- coho-reminder:governor-appointments -->
Owner decision: 2026-09-27 — move the dated COHO election follow-ups from the deleted Claude Code routines into the repository.

The owner handoff schedules governor-elect cabinet/housing appointments for
November 2026–January 2027; this reminder opens on 2026-12-01. The detailed task
text has not yet been written. Ask the owner to define that research block.

Appointments belong in policy-watch `people` entries: “nominated” from the official
transition announcement, then “appointed” with an effective date. Campaign
`proposed_appointments[]` stay archived as claims; do not convert them into
appointments. Read the merged policy-watch schema and use official sources.

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
