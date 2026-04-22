# `js/temporal-dashboard.js`

## Symbols

### `formatCurrencyLabel(isoDate)`

Formats an ISO date string as a human-readable "As of [date]" label.
Returns "As of [Month DD, YYYY]" or "—" if the date is invalid.
@param {string} isoDate - ISO-8601 date string (e.g. "2026-02-01")
@returns {string}

### `applyCurrencyLabel(containerEl, latestDate)`

Updates all elements with class "meta-currency" inside a container,
setting their text to "As of [latestDate]" and adding the
data-currency attribute to the container.

@param {Element} containerEl - The card/section element wrapping the chart
@param {string} latestDate   - ISO date of the most recent observation
