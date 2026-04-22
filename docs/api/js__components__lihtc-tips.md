# `js/components/lihtc-tips.js`

js/components/lihtc-tips.js — COHO Analytics
Renders contextual "LIHTC Quick Reference" tip panels at each workflow step.

Reads from data/core/educational-content.json (same source as EduCallout).
If EduCallout has already loaded the data it reuses the cached entries.

Usage:
  LihtcTips.render('lihtcTipsMount-hna', ['ami','cost_burden','housing_gap'], {
    audience: 'developer',   // 'elected' | 'developer' | 'financier'
    heading:  'HNA Quick Reference'
  });

The component is self-contained — no external CSS file required.

## Symbols

### `_renderInto(container, containerId, tags, audience, heading)`

render(containerId, tags, options)
Fetch data (or reuse cache) then inject tip cards into the container.

@param {string}   containerId  ID of mount element
@param {string[]} tags         Term keys from educational-content.json
@param {object}   [options]
@param {string}   [options.audience]  'elected'|'developer'|'financier'
@param {string}   [options.heading]   Override panel heading text

### `setAudience(mode)`

setAudience(mode)
Change the default audience AND re-render all currently mounted panels.
