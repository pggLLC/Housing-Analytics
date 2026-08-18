# Codex Integration Guide (Browser-Only / No Terminal Required)

This guide is for non-technical collaborators who use the GitHub website
and Claude/Copilot chat interfaces — no terminal or command line needed.

---

## Agent roles (quick reference)

| Agent | What it does | How you trigger it |
|---|---|---|
| **Claude** | Reviews plans, audits PRs, answers questions | Copilot chat or GitHub Copilot workspace |
| **Codex** | Implements code and docs changes, opens PRs | GitHub Copilot coding agent interface |
| **You (owner)** | Files issues, signs off on plans, merges PRs | GitHub web UI |

**Rule:** Claude reviews every Codex PR before you merge. Never merge without Claude's green light.

---

## Step-by-step: Full browser-only workflow

### Step 1 — File a GitHub issue (you)

1. Go to: **https://github.com/pggLLC/Housing-Analytics/issues/new**
2. Paste the issue template below (fill in the blanks).
3. Click **"Submit new issue"**.
4. Note the issue number (e.g. `#1452`).

#### Issue template

```
## Summary
[One sentence: what is wrong or missing.]

## What I expected
[What should have happened.]

## What actually happened
[What went wrong. Paste any error message or link to a failed CI run.]

## Affected files or pages
- 

## Agent context
- Agent involved: Codex / Claude / both
- Branch or PR (if known): 
- Recent related PRs: #1447, #1448, #1449, #1450, #1451

## Notes for Claude
[Anything Claude should check first — e.g., "confirm this isn't already fixed",
"check AGENTS.md constraint #N", "owner sign-off given in this comment".]
```

---

### Step 2 — Ask Claude to analyze and plan (you)

Open a Claude chat and paste this prompt (replace `#NNNN` with your issue number):

```
Review GitHub issue #NNNN in pggLLC/Housing-Analytics.

1. Read AGENTS.md and the 18 governance rules (.github/copilot-instructions.md).
2. Confirm the work is not in the DEFERRED list (requires owner sign-off if so).
3. Propose a minimal plan to fix the issue. Docs-only changes do not need
   manifest rebuild. Data changes require running:
     python scripts/rebuild_manifest.py
     node scripts/validate-schemas.js
4. Wait for owner approval before proceeding.
```

Claude will either present a plan or tell you owner sign-off is needed first.

---

### Step 3 — Approve the plan (you)

Read Claude's plan. Reply:

> "Approved — proceed."

Or ask for changes before approving.

---

### Step 4 — Claude or Codex implements

**If Claude is handling it:** it will create files and open a PR automatically.

**If you want Codex to implement** (paste into the Copilot coding agent interface):

```
Implement the plan for issue #NNNN in pggLLC/Housing-Analytics.

Constraints:
- Branch + PR only. Never push to main. Do not merge.
- If any file under data/ is changed, run:
    python scripts/rebuild_manifest.py
    node scripts/validate-schemas.js
- Follow all 18 governance rules in .github/copilot-instructions.md.
- Follow all hard constraints in AGENTS.md.
- Run npm test and confirm it passes before opening the PR.
- Open the PR and stop.
```

---

### Step 5 — Claude reviews the Codex PR (you trigger this)

Paste into a Claude chat (replace `#NNNN` with the PR number Codex opened):

```
Review PR #NNNN in pggLLC/Housing-Analytics.

Check:
1. Does it follow all 18 governance rules (.github/copilot-instructions.md)?
2. Does it follow AGENTS.md hard constraints?
3. Are there any data files changed that require manifest rebuild?
4. Does npm test pass?

Report: APPROVED or list specific problems.
```

---

### Step 6 — Merge (you, after Claude approves)

1. Go to the PR on GitHub.
2. Once Claude says **APPROVED** — click **"Merge pull request"**.
3. Done ✅

---

## Common mistakes to avoid

| Mistake | What to do instead |
|---|---|
| Merging a Codex PR without Claude review | Always get Claude's APPROVED first |
| Editing `places/*.html` by hand | Edit the template in `scripts/hna/build_place_pages.py` and rerun |
| Changing data files without rebuilding manifest | Run `python scripts/rebuild_manifest.py` then `node scripts/validate-schemas.js` |
| Starting DEFERRED work | Get explicit owner sign-off first (see AGENTS.md) |
| Pushing directly to `main` | Always use a branch + PR |

---

## Need help?

If you're unsure whether something needs owner sign-off, ask Claude:

> "Is issue #NNNN in pggLLC/Housing-Analytics deferred work per AGENTS.md?
> Does it need owner sign-off before Codex can start?"
