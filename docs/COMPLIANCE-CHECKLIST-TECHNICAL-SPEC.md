# Compliance Checklist — Technical Specification

**Module:** `js/compliance-checklist.js`  
**Version:** 2026-03  
**Scope:** Prop 123 / HB 22-1093 five-item compliance checklist  
**Page:** `housing-needs-assessment.html`

---

## Overview

The Compliance Checklist module provides persistent, accessible state management for the Prop 123 / HB 22-1093 five-item compliance checklist embedded in the Housing Needs Assessment tool.

### Features

- Full `localStorage` persistence (survives page refresh and browser restart)
- Reactive state management with change-event broadcasting
- Cross-tab synchronization via the browser `storage` event
- DOLA deadline detection (30-day warning badge)
- ARIA live region announcements for screen reader support
- Mobile-responsive layout (supported down to 320px viewport width)
- Graceful degradation when `localStorage` is unavailable

---

## Module Structure

```
js/compliance-checklist.js   — IIFE, exports window.ComplianceChecklist
                               CommonJS-compatible (module.exports) for Node.js tests
```

The module is loaded in `housing-needs-assessment.html` via:
```html
<script defer src="js/compliance-checklist.js"></script>
```
It must load **before** `js/housing-needs-assessment.js`.

---

## Public API

### `initComplianceChecklist(geoType, geoid)`

Initialize the checklist for a specific geography. Loads any saved localStorage state; creates a fresh default state if none exists. Syncs DOM checkbox and visual states.

| Parameter | Type   | Description                                       |
|-----------|--------|---------------------------------------------------|
| `geoType` | string | `'state'` \| `'county'` \| `'place'` \| `'cdp'` \| `'municipality'` |
| `geoid`   | string | 5-digit county FIPS or 7-digit place FIPS         |

**Returns:** `{object}` — The full checklist state record.

**Side effects:**
- Reads `localStorage`
- Updates DOM checkbox checked states, `aria-checked`, CSS classes, status icons, and completion timestamps
- Caches `geoType`/`geoid` as the active geography for subsequent `updateChecklistItem` calls

---

### `updateChecklistItem(itemId, checked, metadata)`

Persist a single checkbox state change to `localStorage` and update the DOM.

| Parameter  | Type    | Description                                              |
|------------|---------|----------------------------------------------------------|
| `itemId`   | string  | One of: `'baseline'`, `'growth'`, `'fasttrack'`, `'dola'`, `'report'` |
| `checked`  | boolean | New checked state                                        |
| `metadata` | object? | Optional: `{ value, date, note }` — saved with the item  |

**Returns:** `{ success: boolean, error: string|null }`

**Behavior:**
- If `checked = true` and no `metadata.date` is provided, `date` defaults to `new Date().toISOString()`.
- If `checked = false`, `date` is cleared to `null`.
- Uses the geography cached by the most recent `initComplianceChecklist` call.
- Calls `broadcastChecklistChange` after a successful save.

---

### `getChecklistState(geoType, geoid)`

Retrieve the full saved checklist state for a geography from `localStorage`.

**Returns:** `{object|null}` — State object or `null` if no state has been saved.

**State shape:**
```json
{
  "geoType":   "county",
  "geoid":     "08031",
  "items": {
    "baseline":  { "checked": true,  "date": "2025-03-08T00:00:00.000Z", "metadata": { "value": 1500 } },
    "growth":    { "checked": true,  "date": "2025-03-08T00:00:00.000Z", "metadata": null },
    "fasttrack": { "checked": false, "date": null, "metadata": null },
    "dola":      { "checked": false, "date": null, "metadata": null },
    "report":    { "checked": false, "date": null, "metadata": null }
  },
  "createdAt": "2025-03-01T00:00:00.000Z",
  "updatedAt": "2025-03-08T00:00:00.000Z"
}
```

---

### `isChecklistComplete(geoType, geoid)`

Returns `true` if all five checklist items are checked for the given geography.

**Returns:** `boolean`

---

### `getNextAction([geoType, geoid])`

Returns a human-readable string describing the next required compliance action.

**Priority:**
1. If DOLA deadline is within 30 days and item 4 (`dola`) is unchecked → `"File with DOLA by January 31 ⚠️"`
2. The first unchecked item's label
3. `"All items complete! ✅"` when everything is checked

**Returns:** `string`

---

### `broadcastChecklistChange(eventData)`

Emit a `checklist-changed` CustomEvent on `document` and write a cross-tab marker key to `localStorage`.

| Parameter   | Type   | Description                               |
|-------------|--------|-------------------------------------------|
| `eventData` | object | `{ geoType, geoid, itemId, checked }`     |

**Cross-tab key written:** `hna_compliance_last_change`  
Other tabs listening to `window.addEventListener('storage', ...)` will receive this update and call `initComplianceChecklist` to sync their state.

---

### `validateChecklistItem(itemId, value)`

Validate a checkbox item before saving.

**Returns:** `{ valid: boolean, error: string|null }`

**Validation rules:**
- `itemId` must be one of the 5 known item IDs
- `value` (the `checked` state) must be a `boolean`

---

## localStorage Keys

| Key Pattern                                | Contents                              |
|--------------------------------------------|---------------------------------------|
| `hna_compliance_{geoType}_{geoid}`         | Full checklist state JSON object      |
| `hna_compliance_last_change`               | Cross-tab broadcast marker            |

**Example:** `hna_compliance_county_08031`

localStorage is namespaced to avoid collisions with other tools. All JSON is stored with `JSON.stringify` and parsed with `JSON.parse`. Errors (invalid JSON, quota exceeded, private browsing) are swallowed gracefully — the page continues to work without persistence.

---

## DOM Structure

The module expects the following HTML structure in `housing-needs-assessment.html`:

```html
<div aria-live="polite" aria-atomic="true" id="checklistAnnouncer" class="sr-only"></div>
<ul class="compliance-checklist" id="prop123Checklist">
  <li class="checklist-item pending" id="checkItemBaseline" data-storage-key="baseline">
    <span class="checklist-status-icon" aria-hidden="true">⏳</span>
    <input type="checkbox" id="chkBaseline" aria-label="..." aria-checked="false">
    <div class="checklist-item-content">
      <label for="chkBaseline">…</label>
      <time class="checklist-date-completed" style="display:none;"></time>
    </div>
  </li>
  …
</ul>
```

**Key element roles:**

| Element / Attribute           | Purpose                                                       |
|-------------------------------|---------------------------------------------------------------|
| `data-storage-key`            | Maps the `<li>` to its `itemId` in the state object          |
| `aria-checked` on checkbox    | WCAG 4.1.2 — kept in sync with `checked` property            |
| `id="checklistAnnouncer"`     | WCAG 4.1.3 — announces checklist changes to screen readers   |
| `.checklist-status-icon`      | Visual icon (✓ / ⏳ / ⚠️) updated by the module              |
| `.checklist-date-completed`   | Timestamp shown when item is checked                          |
| `.checklist-item.done`        | CSS — strikethrough + muted text                              |
| `.checklist-item.pending`     | CSS — pending (gray dot) state                                |
| `.checklist-item.warning`     | CSS — orange highlight when DOLA deadline is approaching      |

---

## Data Flow

```
User selects County
  → update(geoType, geoid) in housing-needs-assessment.js
    → renderProp123Section(profile, geoType)
      → renderChecklist(baselineData, eligibility)
        → ComplianceChecklist.initComplianceChecklist('county', '08031')
          → Load from localStorage (or create default)
            → _syncDom(state) — update all checkboxes, icons, timestamps, DOLA warning

calculateBaseline() returns units
  → ComplianceChecklist.updateChecklistItem('baseline', true, { value: 1500, date: today })
    → Save to localStorage
      → broadcastChecklistChange({ geoType, geoid, itemId, checked })
        → CustomEvent 'checklist-changed' on document (same tab)
        → localStorage 'hna_compliance_last_change' (other tabs)
          → compliance-dashboard.html receives 'storage' event → re-syncs

User clicks checkbox manually
  → change event on #prop123Checklist
    → ComplianceChecklist.updateChecklistItem(itemId, checked, { date: now })
      → Persist to localStorage
        → DOM updated (strikethrough + timestamp)
          → ARIA announcer text updated with getNextAction()

DOLA deadline within 30 days?
  → _isDeadlineWarning() === true
    → _syncWarningBadge() adds .warning class + ⚠️ icon to DOLA item
      → getNextAction() returns "File with DOLA by January 31 ⚠️"
```

---

## CSS Classes

Defined in `css/pages/housing-needs-assessment.css`:

| Class                       | Applied when                                         |
|-----------------------------|------------------------------------------------------|
| `.checklist-item.done`      | Item is checked; adds strikethrough + muted color    |
| `.checklist-item.pending`   | Item is not yet checked                              |
| `.checklist-item.warning`   | DOLA deadline within 30 days + item unchecked        |
| `.checklist-status-icon`    | Inline icon element (✓ / ⏳ / ⚠️)                    |
| `.checklist-item-content`   | Flex column wrapper for label + timestamp            |
| `.checklist-date-completed` | Completion timestamp (`.8rem`, muted, italic)        |

**Breakpoints:**
- `@media (max-width: 640px)` — larger touch targets, relaxed gaps
- `@media (max-width: 480px)` — `flex-wrap: wrap` for very small viewports
- `@media (max-width: 400px)` — reduced font size

---

## Integration Points

### `js/housing-needs-assessment.js`

1. **`renderChecklist(baselineData, eligibility)`** — calls `initComplianceChecklist` and auto-checks data-driven items (1–3) when baseline/eligibility data is available.
2. **`init()`** — wires a `change` event listener on `#prop123Checklist` to call `updateChecklistItem` for manual user interactions.
3. **`init()`** — wires `beforeunload` to broadcast final state to other tabs.

### `compliance-dashboard.html`

Listens for `window.storage` events on keys prefixed with `hna_compliance_` to stay in sync when the user interacts with the HNA page.

---

## Testing

Unit tests: `test/compliance-checklist.test.js`  
Integration tests: `test/integration/housing-needs-assessment.test.js` (12 new assertions)

Run:
```bash
node test/compliance-checklist.test.js
node test/integration/housing-needs-assessment.test.js
```

---

## Backward Compatibility

- All existing checklist HTML structure is preserved (IDs unchanged).
- CSS classes are additive — `.done` class behavior is unchanged.
- JS functions wrapped with defensive `window.ComplianceChecklist` guards — fallback path works without the module.
- localStorage keys are namespaced (`hna_compliance_`) — no collisions.
- Graceful degradation if `localStorage` is unavailable (private browsing, quota full).
