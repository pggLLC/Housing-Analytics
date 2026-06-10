# IndiBuild Weekly Pipeline Review

**Time:** 30 minutes, Monday 8:00–8:30am
**Who:** Paul + Kim (synchronous; phone OK)
**Where:** Google Sheet open + COHO Opportunity Finder open in browser

The goal isn't to be exhaustive — it's to make at least one decisive choice each week that wouldn't have happened without the review.

---

## The 6-step routine

### 1. Triage last week's Signal Log (5 min)

Open the **Signal Log** tab. Filter to entries from the past 7 days with `status = open`.

For each row:
- Confirm `strength` (gut check — does it still feel right a week later?)
- Set `status = done` if the follow-up is complete OR `status = dropped` if it's no longer worth pursuing
- For strong signals — confirm there's a `follow_up_action` with a real deadline

**Output:** every signal from the past week has a non-open status OR a concrete follow-up.

### 2. Pipeline movement decisions (10 min)

Open the **Pipeline** tab.

For each row in `Signal` stage, ask:
- Has any signal from this jurisdiction reached `moderate+` strength in the past 30 days?
- If yes → consider promoting to `Outreach` this week
- If no → leave in `Signal` (or demote to `Screen` if signal volume has dried up)

For each row in `Outreach` stage, ask:
- Did we hear back from the last contact?
- If yes → either schedule the call, or promote to `IC`
- If no → set a follow-up date; if 3+ weeks of silence, demote back to `Signal` with a note

**Critical rule:** Every promotion gets a `last_update` timestamp and a `next_action` with a deadline. No empty actions.

**Output:** at least 1 jurisdiction moved this week.

### 3. Pick this week's 1–2 outreach targets (5 min)

From the updated Pipeline `Outreach` column, pick **at most 2** jurisdictions to actively work this week. Outreach quality drops sharply past 2-per-week for a 2-person team.

For each chosen target:
- Pick the right template from the **Outreach Templates** tab (T1–T5)
- Confirm the contact tier in **Network** (don't send T2 to a Tier 3 contact)
- Draft + send (or calendar a call)

**Output:** 1–2 outreach emails sent or calls scheduled.

### 4. On Pause hygiene (3 min)

Open **On Pause**. Filter to `revisit_date <= today`.

For each row that's due:
- Has anything material changed? (personnel, election, comp plan, funding)
- If yes → move back to Pipeline `Screen` with a fresh signal entry
- If no → push revisit date out 6–12 months with reason

**Output:** on-pause list stays current; no stale revisits.

### 5. OF + Brief sanity check (5 min)

Open the COHO Opportunity Finder with the IndiBuild lens (when it's live; for now, manual filter).

- Skim the top 10 ranked jurisdictions
- Anything new in T1/T2 that isn't in Pipeline? → add a Pipeline row in `Screen` stage
- Any Pipeline jurisdiction whose IOI has dropped significantly? → reconsider classification

**Output:** Pipeline mirrors the COHO ranking; no surprises drift.

### 6. Calendar the week (2 min)

Block calendar for:
- The 1–2 outreach calls / follow-ups
- Any IC packet work for `IC`-stage jurisdictions
- One 30-min "signal scan" mid-week (Wed) to keep the Signal Log fresh

**Output:** calendar reflects the pipeline.

---

## End-of-review prompt

Before closing the sheet, write a one-line note in the README or a Slack message:

> Week of YYYY-MM-DD — promoted X to Outreach, sent Y emails, logged Z new signals.

Sounds small. Done weekly for a quarter, it becomes the most valuable record of how IndiBuild does business.

---

## What success looks like after 2 weeks

- 20–40 Signal Log entries
- 1–3 Pipeline promotions
- 2–4 outreach emails sent
- 0–2 On Pause additions
- At least 1 conversation that wouldn't have happened otherwise

If you hit 3+ of those, the workflow is real and we should build the private COHO surfaces. If not, see "When to stop using the sheet" in the README.
