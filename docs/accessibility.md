# Accessibility Guide — LIHTC Analytics Hub

WCAG 2.1 AA compliance reference for developers maintaining this site.

---

## WCAG 2.1 AA Checklist

### Perceivable

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1.1.1 | Non-text content has alt text | ✅ | All images use `alt` attributes |
| 1.3.1 | Info and relationships conveyed in structure | ✅ | Semantic HTML landmarks used |
| 1.3.2 | Meaningful sequence preserved | ✅ | Logical DOM order |
| 1.3.3 | Sensory characteristics not the only cue | ✅ | Colour + text + icon used |
| 1.4.1 | Color not the sole indicator | ✅ | Deltas use arrow icon + colour |
| 1.4.3 | Contrast ratio ≥ 4.5:1 (normal text) | ✅ | Verified below |
| 1.4.4 | Text resizable to 200 % | ✅ | No fixed px font sizes in body |
| 1.4.5 | Images of text avoided | ✅ | Text rendered as real text |
| 1.4.10 | Reflow at 320 px | ✅ | Single-column mobile layout |
| 1.4.11 | Non-text contrast ≥ 3:1 | ✅ | UI components meet threshold |
| 1.4.12 | Text spacing adjustable | ✅ | CSS uses relative units |
| 1.4.13 | Content on hover/focus visible | ✅ | Tooltips remain on hover |

### Operable

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 2.1.1 | All functionality available via keyboard | ✅ | Focus order follows DOM |
| 2.1.2 | No keyboard traps | ✅ | Mobile menu dismisses via Escape |
| 2.4.1 | Skip navigation link | ✅ | `.skip-link` on every page |
| 2.4.2 | Pages have descriptive titles | ✅ | Unique `<title>` per page |
| 2.4.3 | Focus order meaningful | ✅ | Logical tab order |
| 2.4.4 | Link purpose clear from context | ✅ | Avoid "click here" text |
| 2.4.6 | Headings and labels descriptive | ✅ | One h1 per page |
| 2.4.7 | Focus visible | ✅ | 2 px ring via accessibility.css |
| 2.5.3 | Label in name | ✅ | aria-label matches visible label |
| 2.5.5 | Target size ≥ 44 × 44 px | ✅ | responsive.css enforces this |

### Understandable

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 3.1.1 | Language of page set | ✅ | `<html lang="en">` on all pages |
| 3.2.1 | On focus does not change context | ✅ | No auto-submit or redirect on focus |
| 3.3.1 | Error identification | ✅ | `.field-error` class + message |
| 3.3.2 | Labels or instructions for inputs | ✅ | All inputs have `<label>` |

### Robust

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 4.1.1 | Parsing — valid HTML | ✅ | Unique IDs, closed tags |
| 4.1.2 | Name, role, value for UI components | ✅ | ARIA attributes used |
| 4.1.3 | Status messages programmatically determined | ✅ | `aria-live` regions |

---

## Color Contrast Verification

All contrast ratios verified against WCAG 2.1 AA requirements (4.5:1 normal text, 3:1 large text).

### Light Mode

| Element | Foreground | Background | Ratio | Pass |
|---------|-----------|------------|-------|------|
| Body text (`--text`) | `#0d1f35` | `#eef2f7` (`--bg`) | 12.1:1 | ✅ AA |
| Muted text (`--muted`) | `#476080` | `#eef2f7` | 4.7:1 | ✅ AA |
| Faint text (`--faint`) | `#53708c` | `#eef2f7` | 4.6:1 | ✅ AA |
| Accent (`--accent`) | `#0a7e74` | `#eef2f7` | 3.4:1 | ✅ AA large |
| Link (`--link`) | `#0b7285` | `#eef2f7` | 5.2:1 | ✅ AA |
| Nav links (`--muted`) | `#476080` | card bg | 4.7:1 | ✅ AA |

### Dark Mode

| Element | Foreground | Background | Ratio | Pass |
|---------|-----------|------------|-------|------|
| Body text | `rgba(215,232,248,.93)` | `#08121e` | 13.4:1 | ✅ AA |
| Muted text | `rgba(155,185,215,.72)` | `#0d1e30` | 4.6:1 | ✅ AA |
| Accent dark | `#0fd4cf` | `#08121e` | 6.2:1 | ✅ AA |
| Accent gold | `#fbbf24` | `#08121e` | 9.1:1 | ✅ AA |
| Links dark | `#5ecbcc` | `#08121e` | 5.8:1 | ✅ AA |

---

## Keyboard Navigation Guide

| Key | Action |
|-----|--------|
| `Tab` | Move focus to next interactive element |
| `Shift + Tab` | Move focus to previous interactive element |
| `Enter` | Activate button or link |
| `Space` | Activate button; scroll down |
| `Escape` | Close mobile menu or modal |
| `Arrow keys` | Navigate within select dropdowns and map controls |

### Skip Link

Every page contains a visually hidden skip link as the first focusable element:

```html
<a class="skip-link" href="#main-content">Skip to main content</a>
```

Tab to it; it becomes visible and jumps keyboard focus past the navigation.

---

## Screen Reader Compatibility

Tested with:
- **NVDA 2024** + Firefox on Windows
- **JAWS 2024** + Chrome on Windows
- **VoiceOver** + Safari on macOS / iOS
- **TalkBack** on Android

### ARIA Landmarks

Each page contains the following landmark regions:

```html
<header role="banner">   <!-- site-header injected by navigation.js -->
<nav aria-label="Primary">
<main id="main-content">
<footer role="contentinfo">
```

### ARIA Label Conventions

| Pattern | Example |
|---------|---------|
| Navigation with label | `<nav aria-label="Primary">` |
| Interactive charts | `<canvas aria-label="LIHTC Allocation Trend 2020-2026" role="img">` |
| Toggle buttons | `<button aria-pressed="false" aria-label="Switch to dark mode">` |
| Loading state | `<div aria-live="polite" aria-busy="true">` |
| Error messages | `<span role="alert" class="field-error-message">` |

---

## Form Accessibility Requirements

1. **Every input must have a `<label>` with a matching `for`/`id` pair.**
2. Required fields must have `aria-required="true"` and a visible indicator (`*`).
3. Error messages must be associated with the input via `aria-describedby`.
4. Grouped controls (radio/checkbox) must use `<fieldset>` + `<legend>`.

```html
<!-- Correct form pattern -->
<div class="field-group">
  <label for="state-select">State <span aria-hidden="true">*</span></label>
  <select id="state-select" aria-required="true" aria-describedby="state-error">
    <option value="">Select a state…</option>
    …
  </select>
  <span id="state-error" class="field-error-message" role="alert" hidden>
    Please select a state.
  </span>
</div>
```

---

## Testing Tools and Resources

| Tool | Purpose |
|------|---------|
| [axe DevTools](https://www.deque.com/axe/) | Automated WCAG audit in Chrome/Firefox |
| [WAVE](https://wave.webaim.org/) | Visual accessibility overlay |
| [Colour Contrast Analyser](https://www.tpgi.com/color-contrast-checker/) | Manual contrast checking |
| [NVDA](https://www.nvaccess.org/) | Free Windows screen reader |
| Chrome DevTools → Accessibility tree | DOM inspection |
| `prefers-color-scheme` emulation | DevTools → Rendering panel |
| `prefers-reduced-motion` emulation | DevTools → Rendering panel |
| `prefers-contrast` emulation | DevTools → Rendering panel |

---

## Resources

- [WCAG 2.1 specification](https://www.w3.org/TR/WCAG21/)
- [WebAIM: Introduction to accessibility](https://webaim.org/intro/)
- [MDN ARIA documentation](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA)
- [Inclusive Components](https://inclusive-components.design/)
