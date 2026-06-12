#!/usr/bin/env bash
# scripts/handoff-audit.sh
#
# Prints the canonical handoff prompt for one brief (or the bulk-mode
# prompt). Paste the output into a fresh Claude Code / Codex / Cursor
# session that's already pointed at this repo, and the agent will pick
# up the audit package and work it end to end.
#
# Usage:
#   scripts/handoff-audit.sh 0820000          # one brief
#   scripts/handoff-audit.sh --all            # bulk mode (all 10)
#   scripts/handoff-audit.sh --list           # show available GEOIDs
#   scripts/handoff-audit.sh --first-session 0820000   # include context preamble
#
# Source of truth for the prompt text is
# docs/codex-audits/HANDOFF-PROMPTS.md — keep them in sync.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGES_DIR="$ROOT/docs/codex-audits"

usage() {
  cat <<EOF
Usage:
  $0 <GEOID>             Print the canonical one-liner for one brief
  $0 --first-session <G> Print the longer "fresh session" prompt for one brief
  $0 --all               Print the bulk-mode prompt (all 10 briefs, serially)
  $0 --list              List the GEOIDs that have audit packages
  $0 --help              Show this message

Available GEOIDs (regenerate packages with scripts/build-codex-audit-package.py):
EOF
  for p in "$PACKAGES_DIR"/*.md; do
    name="$(basename "$p")"
    [[ "$name" == "README.md" || "$name" == "HANDOFF-PROMPTS.md" ]] && continue
    geoid="${name%.md}"
    echo "  $geoid"
  done
}

# Validate that a package exists for the given GEOID.
check_geoid() {
  local g="$1"
  if [[ ! -f "$PACKAGES_DIR/$g.md" ]]; then
    echo "error: no audit package at $PACKAGES_DIR/$g.md" >&2
    echo "       rebuild with: python3 scripts/build-codex-audit-package.py --geoid $g" >&2
    exit 1
  fi
}

# Canonical one-liner — short, points at the package.
oneliner() {
  local g="$1"
  cat <<EOF
Open docs/codex-audits/$g.md and complete the source-first audit
exactly as described in that file. Use WebFetch (not WebSearch) for
every cited URL. When the verification report is clean and the
validator exits 0, set published: true on the brief, commit, push, and
update the per-brief status row in docs/JURISDICTION-BRIEFS-HANDOFF.md.
EOF
}

# Longer first-session prompt — adds project context for a fresh agent.
first_session() {
  local g="$1"
  cat <<EOF
You're picking up a jurisdictional housing-history briefs feature in
this repo. A spot-check on 2026-06-12 caught a fabricated source-to-
claim mapping: a brief cited a Sopris Sun article as evidence for a
claim, but the article didn't contain anything about the claim. A
follow-up direct-WebFetch re-audit found that only 24% of cite-pairs
in that brief were actually supported. Every brief in the batch is
now quarantined (published: false).

Per-brief audit packages have been pre-built at docs/codex-audits/.
Each package is self-contained — the brief content, the row-by-row
verification plan, the exact WebFetch prompt to use, the verification
report schema, the decision rules, and the validator + commit steps
are all inlined in the markdown file.

Your job: re-audit ONE brief end-to-end using direct WebFetch (NOT
WebSearch). Then either republish it (if clean) or strip it to
verified content like the gold-standard Carbondale brief was.

Read docs/JURISDICTION-BRIEFS-HANDOFF.md first for context, then open
docs/codex-audits/$g.md and follow that file step by step. Use
data/jurisdiction-briefs/_verified/0812045.json as the reference
example of a clean verification report. Commit and push when done.
EOF
}

# Bulk-mode prompt — one session walks all 10 briefs.
bulk_mode() {
  cat <<'EOF'
You're picking up a jurisdictional housing-history briefs feature in
this repo, post-fabrication-incident. Read
docs/JURISDICTION-BRIEFS-HANDOFF.md, then work through each package
under docs/codex-audits/ (excluding README.md and HANDOFF-PROMPTS.md)
in order of fewest cite-pairs first: 0864255, 08045, 0803455, 08097,
0817375, 0816000, 0867280, 0830780, 0827425, 0820000.

For each package, follow the workflow in that file exactly. Use
WebFetch (not WebSearch). Commit + push after every brief. Update the
per-brief status table in docs/JURISDICTION-BRIEFS-HANDOFF.md so
progress is visible between commits.

Stop and ask if the validator fails for reasons not covered in the
package, or if more than 50% of a brief's cite-pairs come back
unsupported / inaccessible.
EOF
}

main() {
  if [[ $# -eq 0 ]]; then
    usage
    exit 1
  fi

  case "$1" in
    --help|-h)
      usage
      ;;
    --list)
      for p in "$PACKAGES_DIR"/*.md; do
        name="$(basename "$p")"
        [[ "$name" == "README.md" || "$name" == "HANDOFF-PROMPTS.md" ]] && continue
        echo "${name%.md}"
      done
      ;;
    --all)
      bulk_mode
      ;;
    --first-session)
      if [[ $# -lt 2 ]]; then
        echo "error: --first-session requires a GEOID" >&2
        exit 1
      fi
      check_geoid "$2"
      first_session "$2"
      ;;
    *)
      check_geoid "$1"
      oneliner "$1"
      ;;
  esac
}

main "$@"
