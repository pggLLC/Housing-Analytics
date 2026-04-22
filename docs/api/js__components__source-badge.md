# `js/components/source-badge.js`

js/components/source-badge.js
Auto-renders source attribution badges beneath chart/stat containers.

Usage (declarative):
  <div class="chart-box" data-source="HUD CHAS 2017-2021" data-source-url="https://huduser.gov/...">
    <canvas id="myChart"></canvas>
  </div>

Or call imperatively from chart render code:
  SourceBadge.attach(element, { source: 'FRED CPIAUCSL', url: '...' });

Styling uses the existing .chart-source class from site-theme.css.
Attaching twice to the same element is a no-op.

Exposes window.SourceBadge.

## Symbols

### `attach(el, opts)`

Attach a source badge to a container element.
@param {HTMLElement} el - The container to attach to.
@param {{ source: string, url?: string }} opts
@returns {HTMLElement|null} the badge element, or null if nothing was attached.

### `scan()`

Scan DOM for [data-source] elements and auto-attach badges.
Safe to call multiple times (attach() skips already-badged elements).

### `_scheduleScan()`

Schedule a single scan() on the next animation frame. Multiple calls
within the same frame collapse to one pass — this is what makes the
MutationObserver cheap even when charts inject lots of DOM in bursts.

### `_startObserver()`

Start a MutationObserver that re-scans whenever new DOM is added.
Replaces the old fixed 3-second setTimeout, which missed charts that
rendered after the 3s window (slow data loads, tab switches, user
interactions). The observer stays active for the page lifetime so
*every* late-arriving chart gets a badge as soon as it lands.
