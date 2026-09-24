# The finish line

What "done" means for the 90-day program, in a form something can check.

**Run it:**

```bash
node scripts/audit/finish-line.mjs            # status
node scripts/audit/finish-line.mjs --run-tests  # actually execute each guard
node scripts/audit/finish-line.mjs --json     # machine-readable
```

Every item is **PASS**, **OPEN**, or **UNMEASURED**. `UNMEASURED` is not a soft
pass — it means nobody has checked. Keeping that separate is the single habit
this codebase has had to learn the hard way, and a definition of done that
blurs it would be the largest instance of the defect yet.

## Why this file exists

The 90-day plan lived in the owner's head, in Codex, and in chat. It was not in
the repo. So a working session had no way to tell whether it was converging on
anything — and on 2026-09-15/16 one didn't: eleven PRs merged in a night, five
of them spawned by defects found while fixing the previous one. Every fix was
real and verified. The sequence was still divergent, because there was no
target to measure against.

A checklist alone would not fix that. This repo has a week of evidence that
written-down rules go stale silently: a `GOTCHA` comment nobody read (#1695), a
derived chain reconstructed from memory each time (#1696), a glossary that
shipped and reached 17 of 975 terms. So the criteria below are measured by
`scripts/audit/finish-line.mjs`, and `test:finish-line` fails if a PASS
regresses.

## The deliverable

A person unfamiliar with housing finance can complete the guided path for their
own jurisdiction and come out with something they trust enough to act on.

Seven steps, in the order the rail (`js/components/workflow-progress.js` STEPS) ships them:

| # | Step | Page |
|---|------|------|
| 1 | Jurisdiction | `select-jurisdiction.html` |
| 2 | Opportunity Finder | `lihtc-opportunity-finder.html` |
| 3 | Needs Assessment | `hna-what-housing-exists.html` |
| 4 | Market Analysis | `market-analysis.html` |
| 5 | Scenarios | `hna-scenario-builder.html` |
| 6 | Deal | `deal-calculator.html` |
| 7 | Recommendation | `recommendation.html` |

## Pass criteria

| id | criterion | source |
|----|-----------|--------|
| PC-6 | Cost per square foot is available in the deal path | owner's plan, quoted 2026-09-15 |
| PC-1 | **NOT RECORDED** | owner's plan — text not in the repo |
| PC-2 | **NOT RECORDED** | owner's plan — text not in the repo |
| PC-3 | **NOT RECORDED** | owner's plan — text not in the repo |
| PC-4 | **NOT RECORDED** | owner's plan — text not in the repo |
| PC-5 | **NOT RECORDED** | owner's plan — text not in the repo |
| PC-7+ | **NOT RECORDED** | unknown how many criteria exist |

**This table is deliberately incomplete and says so.** PC-6 is the only pass
criterion whose text reached this repo — it surfaced because a session happened
to quote it. The rest exist in the owner's plan. Until they are pasted in,
`finish-line.mjs` reports D2 as OPEN, and no session can honestly claim the
program is finished. Filling this table in is the highest-value thing the owner
can do for the remaining schedule; everything else is guesswork dressed as
progress.

## Phases, as given by the owner (2026-09-15)

| Phase | Window |
|-------|--------|
| 0 | Sep 14 – 18 |
| 1 | Sep 14 – Oct 12 |
| 2 | Oct 13 – Nov 9 |
| 3 | Nov 10 – Dec 11 |
| 3B | Dec 12 – 18 |
| **HNA deadline** | **2026-12-31** |

## Standing constraints

From the owner's plan. These govern *how* work happens, not whether it is done.

- Pause new standalone analytical tools for the program's duration.
- Correctness, security, accessibility, data integrity, and completion of the
  guided HNA path remain allowed throughout.
- Maximum implementation work in progress: **two PRs**.
- Only **one PR at a time** may touch generated data, `package.json`, the
  canonical HNA, or shared navigation.
- Generated outputs are changed through their source and generator, never
  directly.
- Data generation occurs in a clean, non-iCloud disposable worktree.
- **The owner merges.** Implementation agents never merge their own PRs.

## The correctness floor

Not the deliverable — the floor the deliverable stands on. Each is guarded by a
test in `test:ci`, so it cannot regress silently. All were built 2026-09-15/16
against one defect class: *a value that means something other than what it
appears to mean.*

| id | what it holds | guard |
|----|---------------|-------|
| C1 | no unmeasured value is published as `0` | `test:no-coerced-zeros` |
| C2 | the derived-data chain is runnable and mapped | `test:derived-chain` |
| C3 | freshness checks refuse to discard uncommitted work | `test:freshness-guard` |
| C4 | every data source has a declared state | `test:planned-sources` |
| C5 | the glossary reaches rendered content | `test:glossary-reach` |
| C6 | the ownership panel leads with its answer | `test:ownership-answer` |
| C7 | a blocked calculation produces no number | `test:deal-calc-absence` |

## How to use this

Before starting work, run it. If what you are about to do does not move an
`OPEN` item, or is not one of the always-allowed categories above, it is not
part of closing this program — however real the defect is.

That is the rule the 2026-09-16 session needed and did not have.
