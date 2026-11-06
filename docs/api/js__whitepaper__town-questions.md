# `js/whitepaper/town-questions.js`

town-questions.js — the questions to ask a town, for the Jurisdiction Report.

Two lists:
 - standard questions, asked of every town, each tied to the CHFA QAP threshold or
   scoring line that makes the answer matter (data/policy/chfa-2027-r1-scoring.json);
 - pointed questions, each set off by one signal in this place's own data, and
   printed with the figure that set it off and the file it came from.

The wording lives in the private question bank (coho-backend
gated/data/jurisdiction-briefs/_town-questions.json), served on the gated site only.
This module holds the signals: what in the data fires a question. Without the bank
the report says the questions load on the gated site.

Every figure comes from the report model built by jurisdiction-whitepaper.js; a
signal whose data is missing does not fire (unknown is never read as zero).

## Symbols

### `build(m, bank, scoring, today)`

build(model, bank, scoring, today) -> { standard, pointed, firedNotShown, bankChecked } | { missing: true }
bank: the private question bank; scoring: the CHFA QAP scoring file.
