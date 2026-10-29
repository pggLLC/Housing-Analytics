# `js/components/housing-events.js`

js/components/housing-events.js
Upcoming Colorado housing events (data/policy/housing-events.json) for the
Housing News page and the jurisdiction briefs.

Until 2026-10-14 Housing News carried no events: its feeds are news
searches, and neither the Housing Colorado conference nor CHFA's chfareach
classes ever made the news. scripts/news/fetch_housing_events.py now reads
CHFA's calendar feed, Housing Colorado's events page and a hand-checked list
every day.

What a reader must never get is an old list presented as current. So:
  - an event that has ended is not shown, whatever the file says;
  - a file not refreshed in STALE_DAYS shows no events at all, and says when
    it last updated;
  - a source the fetcher could not read is named as unavailable, never left
    to look like a quiet calendar.

Past events are kept (from 2026-10-19) under their own heading, newest
first: an ended event in the upcoming list moves there, and the file's
`past` list is shown even when the file has stopped updating, since what
already happened does not go out of date.

## Symbols

### `read(doc, now)`

The state of the file as a reader should see it.
{ stale, updated, events, unavailable: [source names] }

### `noteText(state)`

The note under the panel heading: where the list comes from, and what is missing.
