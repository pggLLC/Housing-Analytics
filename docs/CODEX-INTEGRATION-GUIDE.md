# Codex Integration Guide (Browser-Only / No Terminal Required)

This guide addresses three structural problems in the Claude ↔ Codex workflow:

1. **Claude has no memory between sessions** — it starts every chat fresh with no knowledge of what Codex is doing.
2. **No standard handoff** — when Codex finishes a PR, Claude doesn't automatically know what to review or why.
3. **No terminal access** — all coordination must happen through the GitHub web UI and chat interfaces.

The fixes below are practical and app-based only.

---

## Fix 1 — Use a pinned issue as the persistent task queue

Because Claude starts every session fresh, you need one always-open place it can check.

### One-time setup (you, in the browser)

1. Go to **https://github.com/pggLLC/Housing-Analytics/issues/new**
2. Title: `Agent task queue — Claude/Codex coordination`
3. Body: paste the template below
4. Submit, then **pin the issue**: on the issue page → ⋯ menu → "Pin issue"

This pinned issue becomes the shared memory between you, Claude, and Codex.

#### Pinned task queue template

```
## Active Codex tasks
<!-- Codex: add a line here when you open a PR -->
<!-- Format: - [ ] PR #NNNN — branch-name — brief description -->

## Completed (awaiting Claude review)
<!-- Move items here when Codex opens the PR -->

## Reviewed by Claude
<!-- Move items here after Claude posts APPROVED -->

## Merged
<!-- Move items here after you merge -->

## Notes
<!-- Owner: leave sign-off comments here -->
```

**Start every Claude session by telling it:**
> "Check the pinned issue in pggLLC/Housing-Analytics for the current task queue before doing anything."

---

## Fix 2 — Standard Codex PR comment (handoff to Claude)

When Codex opens a PR, it should leave a comment that Claude can read immediately. Paste this into the Codex prompt every time (see Fix 3), and Claude will know exactly what to check.

#### Standard Codex PR comment format
```
## Codex handoff note
- Closes issue: #NNNN
- Data files changed: yes / no
- Manifest rebuild run: yes / no / n/a
- npm test result: passed / not run
- Governance rules checked: yes
- Ready for Claude review: yes
```

---

## Fix 3 — Copy-paste prompts (the only things you ever need to paste)

### A. Start a new task — paste this to Claude

```
Check the pinned "Agent task queue" issue in pggLLC/Housing-Analytics for 
current status.

Then review GitHub issue #NNNN in pggLLC/Housing-Analytics.

1. Read AGENTS.md and .github/copilot-instructions.md (18 governance rules).
2. Confirm this is not on the DEFERRED list (if it is, stop and tell me).
3. Propose a minimal plan. Docs-only = no manifest rebuild needed.
   Data changes require: python scripts/rebuild_manifest.py 
   then node scripts/validate-schemas.js
4. Wait for my approval before proceeding.
```

### B. Hand off to Codex — paste this to the Copilot coding agent

```
Implement the plan for issue #NNNN in pggLLC/Housing-Analytics.

When you open the PR:
1. Leave the standard Codex handoff comment on the PR (see docs/CODEX-INTEGRATION-GUIDE.md).
2. Update the pinned "Agent task queue" issue — move this task to "Completed (awaiting Claude review)".

Constraints:
- Branch + PR only. Never push to main. Do not merge.
- If any file under data/ is changed, run:
    python scripts/rebuild_manifest.py
    node scripts/validate-schemas.js
- Follow all 18 governance rules in .github/copilot-instructions.md.
- Follow all hard constraints in AGENTS.md.
- Run npm test before opening the PR.
- Open the PR and stop.
```

### C. Ask Claude to review a Codex PR — paste this to Claude

```
Check the pinned "Agent task queue" issue in pggLLC/Housing-Analytics, 
then review PR #NNNN.

Check:
1. Is the Codex handoff note present and complete?
2. Does the diff follow all 18 governance rules (.github/copilot-instructions.md)?
3. Does it follow AGENTS.md hard constraints?
4. Were data files changed without a manifest rebuild?
5. Does npm test pass (check CI status on the PR)?

Respond with APPROVED or a numbered list of problems to fix.
```

---

## Fix 4 — Issue template for recording problems

Use this when something goes wrong and you need to log it.

```
## Summary
[One sentence: what is wrong or missing.]

## What I expected
[What should have happened.]

## What actually happened
[What went wrong. Paste any error or link to a failed CI run.]

## Affected PR or branch (if known)
- 

## Owner sign-off
[ ] I approve this work starting immediately
[ ] This needs discussion before starting

## Notes for Claude
[Anything relevant — e.g., "check if this is already fixed", 
"this started after PR #NNNN merged".]
```

---

## Who does what — at a glance

| Step | Who | Tool |
|---|---|---|
| File issue or update task queue | You | GitHub web UI |
| Analyze + plan | Claude | Copilot chat |
| Sign off on plan | You | Reply in chat |
| Implement + open PR | Codex | Copilot coding agent |
| Review PR | Claude | Copilot chat (Prompt C above) |
| Merge | You | GitHub web UI |

**Hard rule: never merge a Codex PR without Claude's explicit APPROVED.**
