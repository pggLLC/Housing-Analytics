# `js/project-market-study/project-scenario.js`

Pure project-scenario/v1 loader, validator, derivation, and adapter.

## Symbols

### `validateLocalBaseline(baseline)`

The local-baseline rule, on its own so a baseline that did NOT come from a
fixture can be held to the same standard.

It is deliberately separate from walkStale(). walkStale rejects a handful
of untraced Fruita figures and a price band around them — a check on the
provenance of the SHIPPED FIXTURES, earned when those figures could not be
traced to a source. Run against a live jurisdiction it is meaningless and
actively harmful: thirty Colorado places, Denver among them, have a
current home value inside that band, and validating their real baseline
through walkStale would take the page down on a true figure.

So a jurisdiction baseline passed to derive() is validated here and not
walked for staleness. The fixtures still are — validate() calls both.
