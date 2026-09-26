# COHO 2026 handoff gate

Run readiness checks with ordinary code, before starting a model session. The
gate does not call an AI service, start a routine, post comments, or merge PRs.
It supports R1, R2-B1 through R2-B8, their `-P2` passes, R3, R4, R5, R6-0,
R6-A and R6-B. H1/H2 remain separately authorized foundation handoffs.

Requires Python 3.9+, Git and an authenticated GitHub CLI (`gh auth status`),
with read access for checks and push access for reservations. Run from a clone
whose origin is `pggLLC/Housing-Analytics`; pass `--repo-dir /path/to/clone` to
run elsewhere. The checkout and index are never changed by the gate.

## Check, claim, begin

```bash
# Report all blocks, sharing the same main/PR/CI snapshot. No remote writes.
bash scripts/coho-gate.sh scan --json

# Check one block. READY does not reserve it or authorize starting work.
bash scripts/coho-gate.sh check R2-B5

# Reserve the block immediately before starting. Only GO permits new work.
bash scripts/coho-gate.sh claim R2-B5 --json
```

`claim` creates a unique empty commit and atomically creates the remote branch
`coho/2026/<BLOCK>`, only if that branch does not exist. Competing sessions
cannot both win, even if both checked readiness first. It rechecks the gate and
main after reserving; a change releases only its own unchanged reservation and
returns WAIT. An ambiguous network failure keeps the reservation for recovery.

Work on the returned branch, preserving the reservation commit:

```bash
git fetch origin refs/heads/coho/2026/R2-B5:refs/remotes/origin/coho/2026/R2-B5
git switch -c coho/2026/R2-B5 --track origin/coho/2026/R2-B5
```

Use a clean, isolated checkout. Read `AGENTS.md`, `docs/CHANGE-IMPACT.md`, and
the block's target files at the returned `base_sha` before editing. Use the
**merged** schema and field names. The gate checks foundation file presence,
JSON readability, dependencies and CI; it cannot validate every assumption in
a handoff's prose. Stop for a schema mismatch instead of inventing a field.

Open a non-draft PR titled `[<BLOCK>] <description>` from the reserved branch,
confirm `ci-checks` actually ran, and stop for owner review. The gate identifies
PRs by exact bracketed block prefix **or** the reserved branch, including
closed PRs and renamed titles. It does not implement the research handoff.

## Paste above a later handoff

```text
Before this block, run: bash scripts/coho-gate.sh claim <BLOCK> --json
If it does not return GO, report its reason and end without doing the block.
Do not replace claim with check: READY is informational, not a reservation.
On GO, use the returned coho/2026/<BLOCK> branch and base_sha in an isolated
checkout. Read AGENTS.md and the actual target files at that base. Follow the
merged schema; stop on a mismatch. Use America/Denver dates for checked and
retrieved. Then do only the supplied handoff. Open a non-draft PR titled
[<BLOCK>] <description>, confirm ci-checks ran, and stop for owner review.
If interrupted, report the branch and claim_sha so the owner can resume it.
Do not steal or automatically expire an existing reservation.
```

## Results and scheduling

| Status | Exit | Meaning |
| --- | --- | --- |
| READY | 0 | Read-only check passed; no reservation |
| GO | 0 | This session acquired the reservation |
| WAIT | 10 | Date, prerequisite, CI, access or reservation prevents starting |
| SKIP | 20 | Existing PR; no duplicate work |
| STOP | 20 | Expired window, closed PR, schema problem or failed CI |

JSON includes `retire`. Only `retire: true` retires that block from a dispatcher:
merged into main, closed without an applicable merge, past its window, or a
second-pass batch with no notice gaps. Failed CI is a STOP with `retire: false`;
it can recover. An open PR is SKIP with `retire: false` so a later merge can be
recognized. Terminal PR/date checks happen before dependency/date waits. A
`scan` exits 0 when the report completed, even if all blocks are waiting;
dispatchers must inspect individual statuses, never its exit code alone.

The recommended scheduler runs this script after a prerequisite merge and
after successful main CI, with one daily fallback for calendar dates. Do not
create one recurring AI session per block. This implementation installs no
schedules or Claude routines, so there is nothing to auto-delete and no idle
model usage. An existing routine that already starts an AI session before the
gate still incurs that session's usage; move the gate outside it to save that
cost. External dispatchers must persist retired block IDs; this stateless CLI
does not silently claim it deleted someone else's routines.

To attach an already configured worker command, gate it outside the model:

```bash
bash scripts/coho-gate.sh run R1 -- /absolute/path/to/your-worker
```

The command starts only after GO, receives `COHO_BLOCK`, `COHO_BASE_SHA`,
`COHO_BRANCH` and `COHO_CLAIM_SHA`, and must use that existing reservation
instead of calling `claim` again. Its exit code is returned. A crash retains
the claim so retries cannot duplicate partially completed work. This is an
integration point, not a configured Claude/Codex launcher.

## Dates and prerequisites

All comparisons use America/Denver. Closing dates are inclusive.

| Blocks | Opens | Last day |
| --- | --- | --- |
| R1, R2-B1…B8, R3, R4 | H2 foundation on main | 2026-11-02 |
| R2-B1-P2…B8-P2 | H2 + 2026-10-06 + gaps in that batch | 2026-11-02 |
| R5 | H1 reader + H2 foundation | 2026-12-18 |
| R6-0 | `[R5]` merged and reachable on main | 2026-12-18 |
| R6-A | `[R6-0]` merged + 2026-11-04 | 2026-11-20 |
| R6-B | `[R6-0]` merged + 2026-11-24 + verified certification | No expiry |

H2 requires statewide ballot data, all 64 county files, candidate platforms
and policy-watch. Later rendering prerequisites require actual merged PRs,
not a matching string in an unrelated source file. Existing unprefixed R5 or
R6-0 PRs need an explicit mapping change reviewed by the owner.

Every READY also requires the newest ci-checks workflow run for the **exact
current main SHA** to succeed, with an actually successful `ci-checks` job.
Old green runs, skipped jobs, missing checks and pending runs do not qualify.
If main has no current run, wait for its existing CI schedule or dispatch
`ci-checks.yml` on main; this gate does not silently start extra CI runs.

R6-B's calendar date is not evidence of certification. First read the official
Secretary of State page and verify it explicitly certifies statewide results.
Then provide the page/PDF URL and today's Denver date:

```bash
bash scripts/coho-gate.sh claim R6-B \
  --certification-url '<verified HTTPS URL on www.sos.state.co.us>' \
  --certification-checked "$(TZ=America/Denver date +%F)"
```

These flags attest to the operator's verification; the script validates the
official host and current date, not the page's meaning. Record that evidence
in the eventual PR and data. R6-B can proceed without unofficial results.

## Recovery

A reservation has no automatic timeout: a slow worker is not permission for a
second worker to start. Resume the existing branch with owner coordination.
If the worker never started, the owner may release its **unchanged** reservation
using the SHA returned by claim:

```bash
bash scripts/coho-gate.sh release R2-B5 --claim-sha <full-reservation-commit-sha>
```

The expected-SHA lease refuses to delete the branch if anyone has pushed work
since the reservation. A closed PR remains a STOP even after branch deletion;
the owner must decide whether to reopen it. Do not delete branches containing
work just to bypass the gate. Completed PR/branch cleanup is separate from
retiring scheduler entries.

## Validation

`python3 -m pytest tests/test_coho_gate.py -q` covers the work windows, Denver
dates, lifecycle order, per-batch gaps, CI states, error handling, worker launch
suppression and competing claims against a real temporary bare Git repository.
The existing `pytest tests/` step in ci-checks discovers this suite; no separate
workflow or package.json wiring is required.
