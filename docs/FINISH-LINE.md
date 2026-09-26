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
| PC-1 | Numbers agree everywhere: the same figure for the same place shows the same value, with the same source and year, on the page, in the PDF and Excel downloads, and on the recommendation page | owner, approved 2026-09-26 (drafted with Claude after the 2026-09-24 text could not be found) |
| PC-2 | An ownership project never displays or exports tax credits, eligible basis, NOI or LIHTC debt unless the user intentionally adds a rental component | Codex/Claude reconciliation, 2026-09-24, quoted in #1874 and `test/ownership-rental-separation.test.js` |
| PC-3 | No false numbers: nowhere on the site does missing or unknown data show up as 0, "none", or a score; it says "Unavailable" and explains why | owner, approved 2026-09-26 (drafted with Claude after the 2026-09-24 text could not be found) |
| PC-4 | Works for any Colorado place: a person can complete all 7 guided steps for any of the 546 Colorado counties, towns and communities without an error, a dead end, or losing their place | owner, approved 2026-09-26 (drafted with Claude after the 2026-09-24 text could not be found) |
| PC-5 | Honest about what it is: every analysis says whether it is a screening result or a full study, and any draft, example, or county-level stand-in figure is labelled as such where it appears | owner, approved 2026-09-26 (drafted with Claude after the 2026-09-24 text could not be found) |
| PC-6 | Cost per square foot is available in the deal path | owner's plan, quoted 2026-09-15 |

**There are six criteria and no PC-7.** PC-2 and PC-6 reached the repo in
September because a PR or a session quoted them word for word. The text of
PC-1, PC-3, PC-4 and PC-5 could not be found anywhere (PC-1 was known only by its
title, *cross-surface integrity*), so on 2026-09-26 the owner approved the
wording above in their place. Change a criterion only with the owner's
agreement: a criterion nobody agreed to measures nothing.

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
