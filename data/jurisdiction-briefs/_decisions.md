# Jurisdictional briefs — decisions log

Records of design / scope / process decisions the user explicitly made
on this feature, via `AskUserQuestion` or direct instruction. Each
entry: date, the choice presented, the option picked, and what it
caused downstream. New entries append at the bottom — the log is
append-only so reflection on prior choices stays intact.

---

## 2026-06-11

### Bulk-generation scope

**Question:** Colorado has 64 counties + ~270 incorporated places + ~150
CDPs (≈500 jurisdictions). Each manually-researched brief takes 5-10
min of agent time. What scope and policy?

**Picked:** *"DO NOT DO CDP OR PLACES UNDER 2000."*

**Effect:** Drives `scripts/list-brief-candidates.py` filter. Drops the
addressable set from ~500 to ~174 (62 counties not yet briefed + ~112
places ≥ 2,000 pop). CDPs and small places are intentionally out of
scope; the HNA renderer falls back to the containing county's brief
for them.

### Refresh cadence

**Question:** Should the weekly/monthly cron run a fresh web search per
brief?

**Picked:** *"Monthly: re-research only briefs > 30 days old."*

**Effect:** `scripts/find-stale-briefs.py` default threshold is 30
days. `.github/workflows/jurisdiction-briefs-monthly.yml` runs on the
1st of every month at 15:00 UTC. The cron does not auto-rewrite
content — it surfaces what needs a curator pass.

### Auth gating (later superseded)

**Question:** What does "behind developer tools" mean for briefs?

**Picked:** *"Require auth / login gate"* (the only practical option
available at the time the question was asked).

**Effect:** I initially built a separate `?dev=1` / localStorage gate
on the brief component. **This was the wrong reading** — the right
"login" was the existing `salida2026` password on `indibuild-brief.html`
(the Developer Tools section). Superseded by the 2026-06-12 decision
below.

---

## 2026-06-12

### Brief rendering surface

**Question:** Where should the briefs render?

**Picked:** *"Only on indibuild-brief.html (Developer Tools, salida2026
gate)."*

**Effect:** Reverted the `?dev=1` localStorage flag and the brief
mounts I had added to the HNA Local Resources panel + the PMA tool.
The brief component is now loaded only from `indibuild-brief.html`,
which is already password-gated by `js/indibuild-gate.js`. Public
HNA/PMA stay public.

### Watchlist trigger

**Question:** When a user adds a jurisdiction to their Watchlist, what
should happen?

**Picked:** *"Nothing automatic — Watchlist stays a bookmark, briefs
are curator-driven."*

**Effect:** No coupling between `Watchlist.add()` and brief drafting.
The Watchlist is a per-device localStorage bookmark for tracking
jurisdictions of interest; brief authoring stays a deliberate curator
action driven off `_candidates.json` and the monthly cron.

### Brief encryption

**Question:** Are the brief JSON files supposed to be inaccessible
without auth, or just the rendering?

**Picked:** *"Rendering gate is enough — stay as plain JSON in the
repo."*

**Effect:** No encryption of the brief content. The static JSON
remains fetchable, but the renderer is gated by the `salida2026`
password.

### Carbondale repair sequence

**Direct instruction:** *"b then a"* — surgical strip first, then
full source-first rewrite.

**Effect:**
1. **Strip (commit 863844ba)** — Carbondale cut from 4 sections / 17
   paragraphs / 25 cite-pairs down to 2 sections / 6 paragraphs / 7
   cite-pairs, keeping only claims with verbatim source quotes. Brief
   re-published.
2. **Source-first rewrite (commit 016d1ed2)** — expanded back to 5
   sections / 12 paragraphs / 16 cite-pairs. Every sentence now backed
   by a WebFetch-verbatim quote captured in `_verified/0812045.json`.
   Many factual corrections in the process (e.g. Resolution #8 not
   #9; Pitkin $2M not $1M; 30-by-2026 cost $13.5M not $8-10M).

---

## Logging convention

Going forward, every option the user picks via `AskUserQuestion` (or
clear directive like "b then a") will be appended here in the same
shape: dated heading, the question, the option text in quotes, and a
short "Effect" describing what it caused.

The log is for reflection — it is not consulted by code at runtime.
