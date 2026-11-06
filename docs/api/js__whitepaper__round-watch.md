# `js/whitepaper/round-watch.js`

round-watch.js — the gated "Next round watch" page: deals likely to apply in
CHFA's next housing tax credit rounds, why each is on the list, and who to
call first.

Joins three files the gated site serves:
  data/jurisdiction-briefs/_round-watch.json           scores, reasons, sources
      (scripts/funding/build_round_watch.py; no contacts)
  data/jurisdiction-briefs/_round-watch-contacts.json  contacts, from the
      private backend only (coho-backend gated/). Never in this repository.
  data/chfa-qap-calendar.json  CHFA's letter of intent and application dates,
      for the countdown above each round.

Also: New and moved tags (30 days, from each deal's history in the data
file), a spreadsheet download of the filtered list with contacts, and
"Add to Deal Tracker" on each open deal (js/components/pipeline-*.js).

A contact shows only with a public https source. Everything shown is
escaped. The map puts each deal at its town's Census centroid, coloured by
likelihood, and follows the same round, region and likelihood filters as
the list.

Lives in js/whitepaper/ because the gated bundle copies that folder and the
public build excludes it. window.RoundWatch in the browser; module.exports in Node.

## Symbols

### `contactsFor(contacts, id)`

Contacts for one project, best first: CHFA's named applicant contact,
 then the land banking contact, then the organisation's main office.
 Each needs a public https source.

### `freshTag(i, asOf)`

"New" when the deal joined the list in the last 30 days of data, or
 "Up from Medium" / "Down from High" when its band moved in that time.

### `visibleItems(round, state)`

The deals a round shows under the current filters: likelihood (High
 only, High and Medium, or all with Watch), region, and new or moved.

### `roundDates(round, cal)`

CHFA's letter of intent and application dates for a round, with days
 to go from today. Dates from a QAP not yet adopted say so.

### `summaryText(shown, total, state)`

What the list shows now: its count by band, under the filters in use.

### `localDate(d)`

The viewer's own calendar date (not UTC, which in Colorado turns over at 6 or 7 pm).

### `csvFor(round, items, contacts, asOf)`

The list as shown (same filters and order), one row per deal, with its
 best contact when the private file loaded.

### `firstContactCell(i, contacts)`

The first contact, short, for the list: who, then a phone or email.

### `townsFor(items)`

Deals grouped by town, strongest first; deals with no town location are
 returned apart, so the page can name them.

### `townPanelHtml(towns)`

The panel under the map for the towns a tap reached: each deal is a
 button that opens it in the list.
