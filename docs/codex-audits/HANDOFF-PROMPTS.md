# Handoff prompts — what to paste into a fresh agent session

Copy one of these into a new Claude Code / Codex / Cursor session, with
that agent already pointed at this repo. The audit packages under
[`docs/codex-audits/`](.) contain everything the agent needs at runtime
— this file just gives you the one-line "kickoff" prompt that points
them there.

---

## Canonical one-liner (recommended)

```
Open docs/codex-audits/<GEOID>.md and complete the source-first audit
exactly as described in that file. Use WebFetch (not WebSearch) for
every cited URL. When the verification report is clean and the
validator exits 0, set published: true on the brief, commit, push, and
update the per-brief status row in docs/JURISDICTION-BRIEFS-HANDOFF.md.
```

Replace `<GEOID>` with one of:

| Paste this | Brief | Cite-pairs |
|---|---|---|
| `0820000` | Denver | 37 |
| `0827425` | Fort Collins | 33 |
| `0830780` | Glenwood Springs | 30 |
| `0867280` | Salida | 27 |
| `0816000` | Colorado Springs | 27 |
| `0817375` | Cortez | 26 |
| `0803455` | Aspen | 25 |
| `08097` | Pitkin County | 25 |
| `08045` | Garfield County | 22 |
| `0864255` | Rifle | 21 |

---

## First-session version (when the agent has no project context)

Use this in a brand-new Claude Code session that's never seen the repo
before. It front-loads the why and the discipline so the agent doesn't
waste a turn asking.

```
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
docs/codex-audits/<GEOID>.md and follow that file step by step. Use
data/jurisdiction-briefs/_verified/0812045.json as the reference
example of a clean verification report. Commit and push when done.
```

---

## Bulk handoff (one agent, all 10 briefs serially)

Heavy. Expect hours of compute. Use only if you specifically want one
session to walk all ten without intervention.

```
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
```

---

## CI / non-interactive

For a Claude API call, GitHub Actions workflow, or scheduled cron, use
the canonical one-liner with `<GEOID>` substituted. The agent must
have:

- repo write access (to commit the verification report + brief edits)
- WebFetch (or equivalent direct-URL-fetch) capability
- Python 3.10+ on PATH (for the validator)

The handoff helper script prints the right prompt:

```bash
scripts/handoff-audit.sh 0820000        # one brief
scripts/handoff-audit.sh --all          # the bulk-mode prompt
```

---

## What "done" looks like, per brief

The agent has finished when all of:

- `data/jurisdiction-briefs/_verified/<GEOID>.json` exists and its
  `audit_method` contains the literal string `"direct WebFetch"`.
- The verification-report `summary` shows `unsupported: 0` AND
  `inaccessible: 0` (partial is OK).
- `data/jurisdiction-briefs/<GEOID>.json` has `"published": true`.
- `python3 scripts/validate-jurisdiction-briefs.py` exits 0.
- A commit lands on `main` (or a PR is opened against `main`).
- The per-brief row in `docs/JURISDICTION-BRIEFS-HANDOFF.md` shows
  ✓ in the `published` column.

---

## Where to verify after the handoff

Once the agent reports done, you can confirm independently:

```bash
# Was the verification done via WebFetch (not WebSearch)?
grep -l "direct WebFetch" data/jurisdiction-briefs/_verified/*.json

# Are all briefs validator-green?
python3 scripts/validate-jurisdiction-briefs.py

# What's published right now?
python3 -c "
import json, glob
for p in sorted(glob.glob('data/jurisdiction-briefs/*.json')):
    if p.split('/')[-1].startswith('_'): continue
    d = json.load(open(p))
    print(f\"{d['geoid']}  {'✓' if d.get('published') else ' '}  {d['jurisdiction']}\")
"
```

A green sweep would output 11 rows with `✓` next to each one.
