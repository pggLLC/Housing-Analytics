# `js/components/edu-callout.js`

edu-callout.js — Educational Callout System for COHO Analytics
ES5 IIFE module. Exposes window.EduCallout.

Usage:
  EduCallout.load().then(function() { EduCallout.init(); });
  EduCallout.setAudience('elected' | 'developer' | 'financier');

Scans for [data-edu="term_key"] attributes, injects ⓘ trigger buttons,
and shows audience-aware callout panels on click.

## Symbols

### `init(options)`

init(options)
Scan the page for [data-edu] attributes and wire up trigger buttons.
Optionally pass { audience: 'elected'|'developer'|'financier' }.
Must be called after load() resolves.

### `setAudience(mode)`

setAudience(mode)
Change the global audience mode. Re-renders any open callout.
@param {string} mode — 'elected', 'developer', or 'financier'

### `load()`

load()
Fetch educational-content.json. Returns a Promise that resolves with the data.

### `isLoaded()`

isLoaded()
Returns true if the data has been loaded.

### `getEntry(key)`

getEntry(key)
Returns the entry object for a given term key, or null if not found.
@param {string} key

### `scan(rootEl)`

scan(rootEl)
Wire up any [data-edu] elements within rootEl that were added after init().
Call this at the end of any function that renders dynamic content containing
[data-edu] anchors (e.g. HousingNeedProjector, NeighborhoodContext).
Safe to call repeatedly — already-wired elements are skipped.

@param {Element} rootEl  Container to scan. Defaults to document.body.
