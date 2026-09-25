# Running a guided-path walkthrough

This guide is for the finish-line item G3: can someone who has never used this
tool get through the seven guided steps and come out with something they would
act on? `TEMPLATE.md` in this folder is where the answer is recorded; this page
is how to get it.

This file is not a record. `scripts/audit/walkthrough-record.mjs` reads only
files named `YYYY-MM-DD-*.md`, so nothing here counts toward G3.

## Part 1 — for the person arranging it

**Who to ask.** Someone who has not used this site. Ideally they are close to
the people it is for, but outside housing finance: a council member, a
planning commissioner, a nonprofit board member, a planner who works on
something else. G3 does not count a walkthrough by someone who already knows
the tool (see `walkthrough-record.mjs`).

**What to give them.** Part 2 of this page and the start link. Nothing else.
Do not explain the tool first, and do not answer questions while they work.
Where they get stuck is the result. If they ask, say "what would you try?",
and note that they asked.

**If they cannot find the next step**, note it and give them the link:

| Step | Page |
|---|---|
| 1 | <https://cohoanalytics.com/select-jurisdiction.html> |
| 2 | <https://cohoanalytics.com/lihtc-opportunity-finder.html> |
| 3 | <https://cohoanalytics.com/hna-what-housing-exists.html> |
| 4 | <https://cohoanalytics.com/market-analysis.html> |
| 5 | <https://cohoanalytics.com/hna-scenario-builder.html> |
| 6 | <https://cohoanalytics.com/deal-calculator.html> |
| 7 | <https://cohoanalytics.com/recommendation.html> |

**How long.** Plan for 60–90 minutes. If they stop early, that is a result
too: record where and why.

**Set-up.** Use a private or incognito browser window, so no progress saved
from an earlier visit shapes what they see. A laptop is better than a phone
unless phones are what you want to test.

**Afterwards.** Copy `TEMPLATE.md` to `docs/walkthroughs/YYYY-MM-DD-<name>.md`
and fill it in from their notes. Use their words and not a summary of them.
The record is only complete when:

- `Unfamiliar with the tool` says `yes`;
- every one of the seven steps has real notes (at least a sentence or two, with
  no template text left in);
- `Verdict` is `would-act` or `would-not-act`.

`would-not-act` is a complete, useful record. G3 reports it as OPEN along with
their reasons, which tells you far more than not having checked at all. Do not
soften it. Then run `npm run finish-line` to see what G3 reads from it.

## Part 2 — for the walker

Thank you for doing this. You are testing the site, not being tested. If
something confuses you, that is a problem with the site and exactly what we
need to hear about.

**Start here:** <https://cohoanalytics.com/select-jurisdiction.html>

Pick a Colorado city, town or county **you know**. You will notice when
something looks wrong for a place you know.

Then work through the seven steps below, moving from page to page the way
the site suggests. If you cannot tell how to reach the next step, write that
down, then ask for the link and carry on. At every step, jot down:

- **Before:** what you expect this page to tell you.
- **After:** what it actually told you, in your own words.
- **Stuck:** anywhere you hesitated, went back or clicked the wrong thing.
- **Words:** any word or abbreviation you did not know. Many have a dotted
  underline you can hover over or tap; say whether that explanation helped.

The questions below each step are prompts and not a checklist. Answer what
you can.

### 1. Where are you working?

- Could you find your place? Was it clear whether to choose the town or the
  county?
- Did you know what would happen next?

### 2. Opportunity Finder

- Find your place in the list. In your own words, why does it rank where it
  does?
- What do the labels and badges next to places mean to you?

### 3. What housing exists

- Name one thing you learned about housing in your place.
- Did any number look wrong for a place you know?

### 4. Market Analysis

- Pick a spot on the map. What score did it get, and do you believe it?
- Did you know what to do with the result?

### 5. Scenarios

- What does it say will happen to the population by 2050?
- Did you try changing anything? Could you tell what your change did?

### 6. Deal

- Did you know what to enter, or did you leave the defaults in place?
- Could you tell whether the project works financially? If the page said it
  could not calculate something, did it say why?

### 7. Recommendation

- In one sentence, what does it recommend for your place?
- Which questions does it say it cannot answer?

### At the end

- **Would you take this result to your board, council or funder?** Answer
  *yes* (would act) or *no* (would not act), and say why.
- What would stop you from using this?
