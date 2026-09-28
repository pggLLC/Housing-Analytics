<!-- coho-reminder:r2-second-pass:<batch> -->
Owner decision: 2026-09-27 — move the dated COHO election follow-ups from the deleted Claude Code routines into the repository.

Current batch: <BLOCK>. GEOIDs: <GEOIDS>.

There are <COUNT> rows still at `official_notice_unavailable` on checked-out main:

<ROWS>

## Worker instructions

You were started by the COHO coordinator for block <BLOCK>, set up by the repository owner on 2026-09-26. You are a fresh session; the coordinator already ran the gate once, and you run it again in case anything changed.

Your final message must begin with exactly one of: "WAIT: …", "SKIP: …", "STOP: …", "READY: …" or "DONE: <PR link>", followed by one short paragraph. That line is what the owner sees in the notification.

Your block is <BLOCK>.

GATE — do this before anything else.

Step 1 — wait. Save the script at the end of this message OUTSIDE the repository (for example /tmp/coho-gate.sh). From the repository root, run: bash /tmp/coho-gate.sh <BLOCK>
- exit 10 (WAIT): end the session with "WAIT: <the script's message>". No branch, commit, PR or comment.
- exit 20 (STOP): end with "STOP: <message>".
- exit 0 (GO): continue to step 2.

Step 2 — claimed? Search pull requests in pggLLC/Housing-Analytics (open, closed and merged) whose title starts with "[<BLOCK>]".
- open (including a draft): end with "SKIP: <BLOCK> is in progress in <PR link>".
- merged: end with "SKIP: <BLOCK> already merged (<PR link>)".
- closed without merging: end with "STOP: <BLOCK> was closed unmerged in <PR link>; owner decision needed". Do not redo it.

Step 3 — QA/QC before starting.
a. main is healthy: find the most recent commit on main that has a ci-checks run. If that run failed or was cancelled, end with "STOP: main is red (<run link>); not starting on a broken base."
b. the merged schema matches the block: read the files the block writes to as they exist on main (the schema PR may name a field differently from the block text). Follow the MERGED names. If something the block needs is missing from main, end with "STOP: schema mismatch: <what is missing>". Do not invent it.
c. re-read AGENTS.md on main; its rules override the block wherever they conflict. Never write the CI-skip directive in any commit message, not even in prose.
d. use America/Denver dates for every date check and for every checked/retrieved value.

Step 4 — begin. Do the block below. Claim it early: as soon as you have committed your first real change, push and open a DRAFT pull request titled "[<BLOCK>] <short description>". When the work is finished, mark it ready for review (draft PRs do not run ci-checks), confirm that ci-checks actually ran, and end with "DONE: <PR link>". Do not merge. If you cannot finish, leave the draft PR open, list in its body what is done and what is left, and end with "STOP: partial, see <PR link>".

## Second pass task

SECOND PASS: re-check ONLY rows at official_notice_unavailable in this batch; leave every other row untouched.

Repo pggLLC/Housing-Analytics. Read AGENTS.md. Branch + PR only; no generated files committed.
Precondition: the ballot schema PR is merged. Batch: counties <GEOIDS>.
Touch ONLY data/policy/ballot-2026/counties/<geoid>.json for these counties. First confirm each GEOID's county
name and municipality rows against data/hna/geo-config.json.

For each county, in this order:
1. Find the county clerk's official election page for November 3, 2026. From it, collect:
   a. the TABOR notice and/or the official sample ballot (or ballot-content certification);
   b. the list of political subdivisions participating in the coordinated election (the list or IGA of
      participating entities).
   Record every URL you use, with its retrieved date.
2. County questions: read every county-level question on the sample ballot or notice. Decide housing relevance
   by these rules:
   - include when the question creates, extends or earmarks a tax, fee, bond or revenue retention for housing or
     homelessness; changes land use, zoning, growth limits or housing regulation; or concerns short-term-rental
     or lodging taxes dedicated to housing;
   - exclude general revenue retention (de-Brucing) unless the question text earmarks housing;
   - when unsure, record the question in the row's `limitations` with its exact text for owner review. Do not
     create an entry for it.
   Each included question becomes an entry with:
   - status "on_ballot";
   - the question letter or number;
   - the full official question text quoted verbatim in evidence;
   - neutral_title (mechanism only);
   - fiscal fields exactly as the question states them;
   - sources.ballot_notice, plus sources.resolution if you can find the referring resolution.
3. Municipal questions: for EVERY municipality row in the file:
   - not participating (absent from the participating-entities list): set not_applicable, with the list URL as
     reviewed_source. Do not guess from memory.
   - participating: check the municipality's measures on the county sample ballot or notice AND the municipal
     clerk's own election page. A county summary may omit municipal measures. Apply the same inclusion rules.
4. Coverage state for each row:
   - verified_measure_found, when you created an entry;
   - official_ballot_reviewed_none_found, when you read the official ballot or notice and found nothing that
     qualifies;
   - official_notice_unavailable, when the county or municipality has not posted it yet (note the date you
     checked);
   - source_unreadable, for a scanned or blocked PDF (say which);
   - leave not_researched only if you ran out of time. Say so in the PR body.
   Every row not left at not_researched carries reviewed_source + checked. Never mark none_found without having
   read the notice itself.
5. The Colorado Health Foundation's local ballot measure tracker
   (https://coloradohealth.org/local-ballot-measure-tracker) and news stories may be used ONLY to find measures
   to verify. Never cite them as the source of an entry.
Neutrality: quote the question; paraphrase only in neutral_title; no adjectives; no predictions.
Every figure in neutral_title/detail must appear in evidence.
Run pytest tests/ -k "policy or ballot". Stop at an open PR. The PR body has a table: county/municipality ·
state · source · entries created · anything flagged for owner review.

## Batch definitions (owner handoff)

```text
R2-B1: 08001 08003 08005 08007 08009 08011 08013 08014
R2-B2: 08015 08017 08019 08021 08023 08025 08027 08029
R2-B3: 08031 08033 08035 08037 08039 08041 08043 08045
R2-B4: 08047 08049 08051 08053 08055 08057 08059 08061
R2-B5: 08063 08065 08067 08069 08071 08073 08075 08077
R2-B6: 08079 08081 08083 08085 08087 08089 08091 08093
R2-B7: 08095 08097 08099 08101 08103 08105 08107 08109
R2-B8: 08111 08113 08115 08117 08119 08121 08123 08125
```

## Gate script

```bash
#!/usr/bin/env bash
# Exit codes: 0 GO · 10 WAIT (prerequisites or date not reached) · 20 STOP (no longer appropriate)
set -u
B="${1:?block id}"
TODAY=$(TZ=America/Denver date +%F)
git fetch -q origin main || { echo "WAIT: cannot fetch origin/main"; exit 10; }

has()  { git cat-file -e "origin/main:$1" 2>/dev/null; }
code() { git grep -q -F -- "$1" origin/main -- '*.html' 'js/*.js' 'js/**/*.js' 2>/dev/null; }
data() { git grep -q -F -- "$1" origin/main -- 'data/policy/ballot-2026/*' 'data/policy/ballot-2026/**' 2>/dev/null; }
lt()   { [[ "$TODAY" < "$1" ]]; }                 # today is before $1
gt()   { [[ "$TODAY" > "$1" ]]; }                 # today is after $1
wait_() { echo "WAIT: $*"; exit 10; }
stop_() { echo "STOP: $*"; exit 20; }

H1_MERGED() { has research-brief.html; }
H2_MERGED() { has data/policy/ballot-2026/statewide.json && has data/policy/candidate-platforms-2026.json; }
R5_MERGED() { code 'ballot-2026'; }               # the page reads the ballot files
R60_MERGED() { code 'unofficial, may change'; }   # R6-0's exact label (plain "may change" already exists in qap-calendar.js)
R6A_DONE()  { data '"unofficial"'; }              # at least one unofficial result recorded

case "$B" in
  R1|R3|R4)
    H2_MERGED || wait_ "H2 (ballot/candidate/appointment schema) is not on main yet"
    gt 2026-11-02 && stop_ "the election is $TODAY or past; pre-election research is no longer useful" ;;
  R2-B[1-8])
    H2_MERGED || wait_ "H2 is not on main yet"
    gt 2026-11-02 && stop_ "the election is $TODAY or past" ;;
  R2-B[1-8]-P2)                                   # second pass over notice-unavailable rows
    H2_MERGED || wait_ "H2 is not on main yet"
    lt 2026-10-06 && wait_ "second pass starts 2026-10-06 (TABOR notices)"
    gt 2026-11-02 && stop_ "the election is $TODAY or past"
    data 'official_notice_unavailable' || stop_ "no official_notice_unavailable rows left; nothing to re-check" ;;
  R5)
    H1_MERGED || wait_ "H1 (research-brief.html) is not on main yet"
    H2_MERGED || wait_ "H2 is not on main yet"
    gt 2026-12-18 && stop_ "past the archive deadline; rendering pre-election data now would mislead" ;;
  R6-0)
    R5_MERGED || wait_ "R5 (ballot rendering) is not on main yet"
    gt 2026-12-18 && stop_ "past the archive deadline" ;;
  R6-A)
    R60_MERGED || wait_ "R6-0 (result display) is not on main yet"
    lt 2026-11-04 && wait_ "unofficial results are recorded from 2026-11-04"
    gt 2026-11-20 && stop_ "too late for unofficial results; use R6-B (certified)" ;;
  R6-B)
    R60_MERGED || wait_ "R6-0 is not on main yet"
    lt 2026-11-24 && wait_ "statewide certification is expected late November / early December"
    R6A_DONE || echo "NOTE: no unofficial results on main; R6-B will record certified results directly" ;;
    # No STOP date: after 2026-12-18 the currency test is failing, and R6-B is the fix.
    # The agent must still confirm on the Secretary of State site that statewide results are certified,
    # and end with "WAIT: not yet certified" if they are not.
  *) stop_ "unknown block id $B" ;;
esac
echo "GO: $B prerequisites met ($TODAY)"; exit 0
```

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
