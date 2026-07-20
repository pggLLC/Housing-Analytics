# `js/components/watchlist.js`

## Symbols

### `renderToggle(opts)`

Build a star toggle button for one jurisdiction. The button label/state
stays in sync with localStorage — click → toggles → updates label.
@param {Object} opts {geoid, name, type, fips}
@returns {HTMLButtonElement}

### `renderPanel(opts)`

Mount a small fixed corner panel that shows the saved jurisdictions.
Idempotent — calling twice doesn't double-mount. Default position is
bottom-right; opts.position can override ('bottom-left' etc.).

### `autoWireMarkers(root)`

Auto-replace <span data-watchlist-toggle data-geoid="..." data-name="..."
data-type="..." data-fips="..."></span> markers with star buttons.
Run once on DOMContentLoaded; also exposed for late-render pages.
