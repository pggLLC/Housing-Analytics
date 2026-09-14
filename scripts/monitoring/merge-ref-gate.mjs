// scripts/monitoring/merge-ref-gate.mjs
// 1B — A conflicting PR must not appear ready merely because no checks ran.
//
// GitHub only creates a merge ref for a PR it can merge cleanly. When a PR
// conflicts there is no merge ref, so `pull_request`-triggered workflows
// never run — and a PR with zero checks renders as "nothing failing", not
// as "nothing was verified". #1417, #1438 and #1439 were all merged that
// way, through data/manifest.json conflicts, with CodeQL still showing
// green because it runs on a different trigger.
//
// A PR-triggered check cannot close this hole: the defect is precisely the
// absence of PR-triggered runs. So this runs on a schedule and on pushes to
// main (merging one PR is what makes the next one conflict), and writes an
// explicit commit status on each open PR's head. Branch protection can then
// require that status, which turns "no checks ran" into a visible failure.

export const STATUS_CONTEXT = 'merge-ref/available';

export const MERGEABILITY = {
  CONFLICTING: 'conflicting',
  MERGEABLE: 'mergeable',
  UNKNOWN: 'unknown'
};

/**
 * Classify a PR's mergeability.
 *
 * `mergeable: null` is the case that matters. GitHub computes mergeability
 * asynchronously and returns null until it has finished, so null means
 * "not yet known" — it is neither mergeable nor conflicting. Collapsing it
 * into either direction is how a guard starts lying: treat it as mergeable
 * and a genuinely conflicting PR gets a green status; treat it as
 * conflicting and every freshly-opened PR fails for a few seconds.
 */
export function classifyMergeability(pr) {
  if (!pr || typeof pr !== 'object') return MERGEABILITY.UNKNOWN;
  if (pr.mergeable === true) return MERGEABILITY.MERGEABLE;
  if (pr.mergeable === false) return MERGEABILITY.CONFLICTING;
  return MERGEABILITY.UNKNOWN;
}

/**
 * Decide the commit status to post, or null to post nothing.
 *
 * Returning null for UNKNOWN is deliberate: posting a success there would
 * be the unearned green this gate exists to prevent, and posting a failure
 * would punish PRs GitHub simply has not finished evaluating. The next
 * scheduled pass re-checks them.
 */
export function decideStatus(classification) {
  switch (classification) {
    case MERGEABILITY.CONFLICTING:
      return {
        state: 'failure',
        description: 'Conflicts with the base branch — no merge ref, so PR checks cannot run.'
      };
    case MERGEABILITY.MERGEABLE:
      return {
        state: 'success',
        description: 'Merge ref exists; PR checks are able to run.'
      };
    default:
      return null;
  }
}

/**
 * Pair each PR with the status to post. PRs needing no status are omitted,
 * so the caller never has to re-derive the skip rule.
 */
export function planStatuses(prs) {
  if (!Array.isArray(prs)) return [];
  const plan = [];
  for (const pr of prs) {
    const status = decideStatus(classifyMergeability(pr));
    if (!status) continue;
    if (!pr.head || !pr.head.sha) continue;   // nothing to attach a status to
    plan.push({
      number: pr.number,
      sha: pr.head.sha,
      state: status.state,
      description: status.description
    });
  }
  return plan;
}

/** Human-readable one-line summary for the job log. */
export function summarize(prs) {
  const counts = { conflicting: 0, mergeable: 0, unknown: 0 };
  for (const pr of (Array.isArray(prs) ? prs : [])) {
    counts[classifyMergeability(pr)]++;
  }
  return `${counts.conflicting} conflicting, ${counts.mergeable} mergeable, ` +
         `${counts.unknown} not yet computed`;
}
