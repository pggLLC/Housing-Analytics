# IndiBuild Pipeline — Manual Prototype

A working Google Sheet template for the IndiBuild opportunity pipeline. Use this for **two weeks** to validate the workflow before we build any private COHO pages around it.

The whole point of the manual prototype: prove (or disprove) that capturing signals + working a pipeline changes which calls you make. If yes → ship the closed COHO surfaces around the same data model. If no → diagnose why before building.

---

## What's in this folder

| File | Tab name | Purpose |
|---|---|---|
| `01-signal-log.csv` | **Signal Log** | Every housing-related signal you spot — agendas, news, personnel, RFPs, land moves |
| `02-pipeline.csv` | **Pipeline** | Jurisdictions × stages — Screen → Signal → Outreach → IC → Active |
| `03-anti-targets.csv` | **Anti-Targets** | Places you've decided NOT to pursue + when to revisit |
| `04-network.csv` | **Network** | Your and Kim's contacts per jurisdiction |
| `05-outreach-templates.csv` | **Outreach Templates** | 5 starter templates by use-case |
| `WEEKLY-REVIEW.md` | — | 30-min Monday-morning routine |
| `CONTROLLED-VOCABULARY.md` | — | Allowed values for signal_type, stage, strength, classification |

---

## Setup (one-time, ~10 min)

### Option A — Google Sheets (recommended)

1. Open [sheets.google.com](https://sheets.google.com) → **Blank**
2. Rename the sheet to **"IndiBuild Pipeline"**
3. For each CSV file:
   - **File → Import → Upload** → drag the CSV
   - **Import location:** "Append to current sheet" is wrong — use **"Insert new sheet(s)"**
   - **Separator type:** Comma
   - **Convert text to numbers, dates, and formulas:** Yes
4. After all 5 imports, rename each new tab to match the table above (Signal Log, Pipeline, Anti-Targets, Network, Outreach Templates)
5. Delete the empty default "Sheet1" tab
6. Share with Kim → set permissions to **Editor**

### Option B — Excel / Numbers

Open each CSV directly. Save the workbook as `.xlsx` to OneDrive / iCloud Drive.

### Option C — Airtable

Each CSV becomes a separate base. Airtable's import auto-detects columns. Set the views to match the workflow (filter Signal Log by `status=open`, filter Pipeline by `stage`, etc.).

---

## The 5 tabs explained

### 1. Signal Log

**Purpose:** Every housing-related signal you encounter — wherever it came from.

**When to log:** When you see it. Don't batch at end of day; you'll forget half. Add the row in 30 seconds; clean up later if needed.

**Key columns:**
- `signal_type` — controlled vocabulary, see `CONTROLLED-VOCABULARY.md`
- `strength` — `weak` / `moderate` / `strong` (your gut read)
- `opportunity_implication` — what this means for IndiBuild in one sentence
- `follow_up_action` — what to do, deterministically
- `status` — `open` / `done` / `dropped`

**Anti-pattern:** logging everything as "strong." Most signals are weak. Save "strong" for things that should drive a same-week call.

### 2. Pipeline

**Purpose:** Jurisdictions × stages. The IndiBuild Kanban.

**Stages (left → right):**
- `Screen` — passed initial OF filter, no signal yet
- `Signal` — at least one logged signal of moderate+ strength
- `Outreach` — email sent or call scheduled
- `IC` — feasibility / IC packet underway
- `Active` — LOI / MOU / project in motion

**Critical rule:** Promote a jurisdiction LEFT-to-RIGHT only with explicit decision + a dated note. Never auto-promote. This is what makes it a pipeline rather than a list.

**Classification (A/B/C/D):**
- `A` — Real development opportunity
- `B` — Planning-to-development consulting opportunity
- `C` — Relationship / monitor opportunity
- `D` — Not worth current time (move to Anti-Targets)

### 3. Anti-Targets

**Purpose:** Places you've consciously decided NOT to pursue, with a reason and a revisit date.

**Why this matters:** Without this list you'll re-evaluate the same dead-ends every quarter. The 5 minutes to log a "no" saves hours.

**Revisit dates:** Default 12 months for most; 6 months if the blocker is a single personnel/political variable; 24 months for structural blockers (e.g. "no growth, no demand").

### 4. Network

**Purpose:** Your and Kim's actual contacts. **Never fabricate.**

**relationship_tier:**
- `1` — Strong / recurring contact (quarterly+ touch)
- `2` — Warm / introduced (met once or twice)
- `3` — Cold / research-only (haven't actually met)

**Why this matters:** You'll be tempted to send Tier 1 templates to Tier 3 contacts. The tier column is a guardrail.

### 5. Outreach Templates

**Purpose:** Starter templates by use-case. Personalize before sending; never send a template raw.

**5 included:**
- T1 — HNA refresh + workforce intro
- T2 — Open RFP response intro
- T3 — Land bank partnership probe
- T4 — Personnel-change relationship reset
- T5 — Soft monitor / dormant follow-up

---

## Daily / weekly habits

| Cadence | Time | Activity |
|---|---|---|
| **Daily (when something surfaces)** | 30 sec | Log it in **Signal Log** |
| **Weekly Monday 8–8:30am** | 30 min | Run the weekly review — see `WEEKLY-REVIEW.md` |
| **Monthly first Tue** | 90 min | Re-run OF lens; refresh Briefs for T1 set |
| **Quarterly** | half-day | QA/QC, weight tuning, anti-target review |

---

## When to stop using the sheet

After **2 weeks of disciplined logging**, ask:
1. Did the Signal Log catch things I'd have missed otherwise? (Y/N)
2. Did I move at least 1 jurisdiction LEFT-to-RIGHT in the Pipeline? (Y/N)
3. Did I send at least 1 outreach I wouldn't have sent without this? (Y/N)

If 2+ are YES → the workflow is real. Tell me and I'll ship the private COHO pages around the same data model. The CSVs export from Google Sheets and drop straight into `/pipeline/data/*.json` (we'll automate the export with a small Apps Script).

If 0–1 are YES → diagnose first. Common reasons:
- The lens isn't right (wrong product type or region weights)
- The signal sources aren't generating enough volume
- The workflow doesn't fit your actual week

Don't build the COHO surfaces until the manual loop demonstrably changes behavior.

---

## Linking back to COHO

While using the sheet, you can paste these COHO URLs into the `source_url` column for instant context:

| Need | URL pattern |
|---|---|
| HNA detail | `https://coho.indibuild.com/housing-needs-assessment.html?fips=<GEOID>` |
| Opportunity Finder | `https://coho.indibuild.com/lihtc-opportunity-finder.html` |
| Deal Calc | `https://coho.indibuild.com/deal-calculator.html?fips=<COUNTY_FIPS>` |
| Compare | `https://coho.indibuild.com/compare.html?jurisdictions=<GEOID1>,<GEOID2>` |

(Replace `coho.indibuild.com` with your actual domain.)
