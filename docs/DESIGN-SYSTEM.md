# DESIGN SYSTEM — LIHTC Analytics Hub

Complete reference for all design tokens, components, typography, spacing, and guidelines.

---

## Design Tokens

All tokens are defined as CSS custom properties in `css/site-theme.css` and are available on every page.

### Color Palette

#### Light Mode

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#eef2f7` | Page background |
| `--bg2` | `#e4ecf4` | Alternate background, input fields |
| `--bg3` | `#dae4f0` | Subtle secondary surface |
| `--card` | `#ffffff` | Card / panel surface |
| `--card2` | `#f7fafd` | Secondary card surface |
| `--surface` | `#ffffff` | Generic elevated surface |
| `--text` | `#0d1f35` | Primary body text |
| `--text-strong` | `#060f1d` | Headings, emphasis |
| `--muted` | `#476080` | Secondary / muted text |
| `--faint` | `#7a96b0` | Placeholder, subtle labels |
| `--border` | `rgba(13,31,53,.11)` | Subtle border |
| `--border-strong` | `rgba(13,31,53,.20)` | Prominent border |
| `--link` | `#0b7285` | Hyperlink colour |
| `--link-hover` | `#096075` | Hyperlink hover |

#### Accent Colors

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--accent` | `#0ea5a0` | `#0fd4cf` | Primary interactive, active states |
| `--accent-dim` | `rgba(14,165,160,.10)` | `rgba(15,212,207,.12)` | Accent backgrounds |
| `--accent2` | `#e8891a` | `#fbbf24` | Gold, secondary accent |
| `--good` | `#059669` | `#34d399` | Positive delta, success |
| `--warn` | `#d97706` | `#fbbf24` | Warning |
| `--bad` | `#dc2626` | `#f87171` | Error, negative delta |
| `--info` | `#2563eb` | `#60a5fa` | Informational |

#### Contrast Ratios (Light Mode)

| Foreground | Background | Ratio | WCAG |
|-----------|------------|-------|------|
| `--text` | `--bg` | 12.1:1 | AAA |
| `--muted` | `--bg` | 4.7:1 | AA |
| `--link` | `--bg` | 5.2:1 | AA |
| `--accent` | `--bg` | 3.4:1 | AA large |
| `--text` | `--card` | 15.2:1 | AAA |
| `--muted` | `--card` | 5.9:1 | AA |

---

### Typography

| Token | Value | Usage |
|-------|-------|-------|
| `--font-sans` | `'Plus Jakarta Sans', system-ui, sans-serif` | All body & UI text |
| `--font-mono` | `'DM Mono', 'Fira Code', monospace` | Code, numbers |
| `--h1` | `clamp(1.7rem, 3.5vw, 2.6rem)` | Page titles |
| `--h2` | `clamp(1.15rem, 2vw, 1.4rem)` | Section headings |
| `--h3` | `1.05rem` | Sub-section headings |
| `--body` | `0.875rem` | Body text (14 px) |
| `--small` | `0.775rem` | Labels, captions (12.4 px) |

#### Heading Hierarchy

Each page must have **exactly one `<h1>`** (the page title). Sub-sections use `<h2>`, card headings use `<h3>`, nested sections use `<h4>`.

```html
<h1>Page Title</h1>
  <h2>Major Section</h2>
    <h3>Card / Component Title</h3>
      <h4>Detail</h4>
```

---

### Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--sp1` | `0.35rem` | Micro gaps (icon spacing) |
| `--sp2` | `0.6rem` | Tight gaps (heading → paragraph) |
| `--sp3` | `0.9rem` | Default gap (card padding top/bottom) |
| `--sp4` | `1.25rem` | Standard spacing (section padding) |
| `--sp5` | `2rem` | Large gap (section separation) |
| `--sp6` | `3rem` | Page-level vertical rhythm |

---

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `6px` | Buttons, inputs, small chips |
| `--radius` | `10px` | Cards, panels |
| `--radius-lg` | `16px` | Large cards, dialogs |
| `--radius-xl` | `22px` | Main content shell |

---

### Shadows

| Token | Usage |
|-------|-------|
| `--shadow-sm` | Subtle lift (inputs, pills) |
| `--shadow` | Standard card elevation |
| `--shadow-lg` | Modal, tooltip, overlay |
| `--shadow-card` | Card with border ring |

---

### Focus Ring

```css
--focus-ring: 0 0 0 3px rgba(14,165,160,.30);
```

Applied automatically to all focusable elements by `css/accessibility.css`.

---

## Component Library

### Buttons

```html
<!-- Default -->
<button class="btn">Default Button</button>

<!-- Primary -->
<button class="btn primary">Primary Action</button>
<button class="btn btn-primary">Primary Action</button>
```

Minimum size: 44 × 44 px (enforced by `css/responsive.css`).

---

### Cards

```html
<div class="card">
  <h3>Card Title</h3>
  <p>Card content with muted text.</p>
</div>
```

Available card variants: `.card`, `.kpi-card`, `.panel`, `.stat-card`, `.chart-card`, `.section-card`, `.data-card`.

---

### KPI Grid

```html
<div class="kpi-grid">
  <div class="kpi-card stat">
    <div class="num">$12.4B</div>
    <div class="lbl">Total Allocations</div>
    <div class="src">Source: HUD</div>
  </div>
  …
</div>
```

---

### Pills / Badges

```html
<span class="pill">Default</span>
<span class="pill accent">Active</span>
<span class="pill good">Positive</span>
<span class="pill warn">Warning</span>
<span class="pill bad">Error</span>
```

---

### Delta Indicators

```html
<span class="delta up">+4.2%</span>
<span class="delta down">−1.8%</span>
<span class="delta flat">0.0%</span>
```

Arrow icons are added automatically via `css/accessibility.css` (colour + icon = two cues).

---

### Form Controls

```html
<div class="field-group">
  <label for="state-select">State</label>
  <select id="state-select">
    <option value="">Select…</option>
  </select>
</div>

<!-- With error -->
<div class="field-group field-error">
  <label for="email">Email</label>
  <input type="email" id="email" aria-describedby="email-error">
  <span id="email-error" class="field-error-message" role="alert">
    Please enter a valid email address.
  </span>
</div>
```

---

### Skip Link

Required on every page as the **first focusable element**:

```html
<a class="skip-link" href="#main-content">Skip to main content</a>
```

The `<main>` element must have `id="main-content"`.

---

### Accessible Chart

```html
<div class="chart-card card">
  <h3>LIHTC Allocations 2020–2026</h3>
  <div class="chart-wrap">
    <canvas
      id="allocations-chart"
      aria-label="Bar chart of LIHTC allocations by year, 2020 to 2026"
      role="img"
      height="180"
    ></canvas>
  </div>
</div>
```

---

## Usage Guidelines

### When to use which card class

| Class | When to use |
|-------|-------------|
| `.card` | Generic content block |
| `.kpi-card` | Key performance indicator with large number |
| `.stat-card` | Stat with delta indicator |
| `.panel` | Form or interactive content block |
| `.chart-card` | Chart or data visualisation |
| `.data-card` | Tabular or list data |

### Text utilities

```html
<p class="text-muted">Secondary information</p>
<p class="text-faint">Very subtle note</p>
<span class="text-accent">Highlighted value</span>
<span class="text-good">Positive value</span>
<span class="text-warn">Warning value</span>
<span class="text-bad">Error value</span>
<span class="kicker">Section label</span>
<small class="note">Footnote or data source</small>
```

### Screen reader only text

```html
<span class="sr-only">Additional context for screen readers</span>
```

---

## Responsive Design Approach

1. **Mobile-first**: base styles target the narrowest viewport, media queries add complexity for wider screens.
2. **Fluid typography**: `clamp()` scales headings between mobile and desktop values.
3. **CSS Grid + auto-fit**: grids reflow naturally without JavaScript.
4. **Touch targets**: all interactive elements are ≥ 44 × 44 px.
5. **No horizontal overflow**: tested at 320 px minimum viewport.

See `docs/mobile-optimization.md` for full details.

---

## Accessibility Requirements

- One `<h1>` per page.
- `lang="en"` on every `<html>` element.
- Skip link as first focusable element.
- All images have `alt` text.
- All form inputs have `<label>` associations.
- Focus visible on all interactive elements (2 px ring).
- Colour contrast ≥ 4.5:1 for normal text.
- ARIA landmarks: `<header>`, `<nav aria-label="Primary">`, `<main id="main-content">`, `<footer>`.

See `docs/accessibility.md` for the full WCAG checklist.

---

## Performance Considerations

- Use `loading="lazy"` on below-fold images.
- Prefer `<canvas aria-label="…" role="img">` for charts — less DOM overhead than SVG for large datasets.
- Use `contain: layout style` on card components (already set in `css/performance.css`).
- Target Lighthouse Performance ≥ 90 on mobile.

See `docs/performance.md` for full recommendations.

---

## File Reference

| File | Purpose |
|------|---------|
| `css/site-theme.css` | Design tokens, base styles, dark mode tokens |
| `css/dark-mode.css` | Transitions, toggle styles, forced dark class |
| `css/responsive.css` | Breakpoints, touch targets, mobile grid |
| `css/accessibility.css` | Focus states, skip link, sr-only, high contrast |
| `css/performance.css` | GPU hints, will-change, contain |
| `css/print.css` | Print layout |
| `js/navigation.js` | Inject site header + footer |
| `js/dark-mode-toggle.js` | Floating dark/light toggle button |
| `js/mobile-menu.js` | Mobile hamburger menu |
