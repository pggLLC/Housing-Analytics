# SiteState Usage Guide

`js/site-state.js` is the shared site state manager for COHO Analytics. It persists county, geography, and PMA context across pages using `localStorage`, with a subscribe/event pattern for reactive updates and automatic DOM wiring.

---

## Quick Start

Include `site-state.js` before any page-specific scripts:

```html
<script defer src="js/site-state.js"></script>
```

---

## API Reference

### County

```js
// Set the active county (5-digit FIPS automatically zero-padded per Rule 1)
SiteState.setCounty('08013', 'Boulder County');

// Read the active county
const { fips, name } = SiteState.getCounty() || {};

// Clear
SiteState.clearCounty();
```

### Geography (sub-county)

```js
SiteState.setGeography('0836410', 'Highlands Ranch', 'cdp');
const { geoid, name, type } = SiteState.getGeography() || {};
SiteState.clearGeography();
```

### PMA Results

```js
SiteState.setPmaResults({ score: 82, demandScore: 90, …});
const results = SiteState.getPmaResults();
SiteState.clearPmaResults();
```

### Subscribe to Changes

```js
const unsub = SiteState.subscribe('county', function (value) {
  console.log('County changed:', value);
});

// Later, to stop listening:
unsub();
```

### Generic key/value

```js
SiteState.set('myKey', { foo: 'bar' });
const val = SiteState.get('myKey');
```

### Snapshot & Reset

```js
const snap = SiteState.getSnapshot();   // plain object copy of all in-memory state
SiteState.clearAll();                   // wipe localStorage + memory + notify all listeners
```

---

## DOM Auto-Wiring

Any element with a `[data-state-key]` attribute is automatically populated when state changes:

```html
<!-- Displays county name as text -->
<span data-state-key="county"></span>

<!-- Populates a select or input with the county name -->
<input type="text" data-state-key="county" />
```

The display value for `county` is `county.name` (the human-readable label).

---

## Context Banner

Pages can include an optional context breadcrumb banner:

```html
<div id="siteStateContextBanner" hidden aria-live="polite">
  <span data-state-label></span>
</div>
```

`SiteState` will show/hide this element and populate it whenever the county or geography changes.

---

## localStorage Keys

All keys are namespaced with `coho_state_`:

| Key | Stored value |
|---|---|
| `coho_state_county` | `{ fips, name }` |
| `coho_state_geography` | `{ geoid, name, type }` |
| `coho_state_pmaResults` | PMA scorecard object |
| `coho_state_awardContext` | Award probability context object |

---

## Graceful Degradation

If `localStorage` is unavailable (private browsing, storage quota exceeded), `SiteState` operates entirely in-memory. The page still functions correctly but state is not persisted across navigation.

---

## Cross-Page Persistence Example

**Housing Needs Assessment** → selects "Boulder County":

```js
// In housing-needs-assessment.html (auto-wired via inline script)
SiteState.setCounty('08013', 'Boulder County');
```

**Market Analysis** → reads on load:

```js
const county = SiteState.getCounty();
if (county) {
  document.getElementById('maLiveRegion').textContent = 'Context: ' + county.name;
}
```

**Economic Dashboard** → context banner auto-populates with "Boulder County".
