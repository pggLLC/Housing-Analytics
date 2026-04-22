# `js/iframe-spinner.js`

js/iframe-spinner.js
Auto-attaches loading spinner overlays to <iframe> elements.

For each <iframe> that does not already have a spinner overlay in its parent,
this utility:
  1. Ensures the parent has position:relative so the overlay can be positioned.
  2. Inserts a themed spinner overlay div that shows immediately.
  3. Hides the overlay when the iframe fires its "load" event.
  4. Leaves the overlay visible if the iframe fails to load (visual error state).

Usage (automatic):
  Include this script in the page; all iframes present at DOMContentLoaded
  are wired automatically.  To attach spinners to iframes added later, call:
      window.iframeSpinner.attach(iframeElement);
  or to re-scan the whole page:
      window.iframeSpinner.attachAll();

CSS dependency:
  Uses .map-iframe-overlay / .map-iframe-spinner classes defined in
  site-theme.css (or inline-style fallbacks if the classes are absent).

## Symbols

### `attach(iframe)`

Inject a spinner overlay into the parent of the given iframe.
Does nothing if an overlay is already present.
@param {HTMLIFrameElement} iframe

### `attachAll()`

Scan the document for all iframes and attach spinners to those that do
not already have one.
