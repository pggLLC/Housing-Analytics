# DESIGN SYSTEM — COHO Analytics

Complete reference for all design tokens, components, typography, spacing, and guidelines.

Last consolidated: 2026-06-06. The system below is enforced by **five CI gates**
(`npm run test:ci`) and one **runtime contrast guard** in JS. See §9 for the
list of gates and §10 for the F119–F126 changelog.

---

## TL;DR — Pattern cheatsheet

```
HEADINGS         <h1>Page title</h1>           ← no inline style ever
                 <h2>Section</h2>              ← global token wins
                 <h3>Sub-section</h3>          ← gate: test:inline-heading-typography

BUTTONS (accent) background: var(--accent)
                 color: var(--on-accent)        ← NEVER `#fff` hardcoded
                 (gate: test:inline-contrast)

PILLS            class="pill | tag | lof-badge | …"
                 (gate: test:pill-contrast)

DATA FRESHNESS   <span style="color:var(--good);font-weight:700;">LIVE</span>
                 <span style="color:var(--warn);font-weight:700;">STATIC</span>
                 <span style="color:var(--warn);font-weight:700;">QUAL</span>

SPACING          var(--sp1)…var(--sp6)         ← never hardcoded px

WIDTH            .article-wrap (820px) | .home-container (1100px) | --wide (1400px)
```

If you write `<h2 style="font-size:1.2rem">`, the gate fails the build. If
you write `style="background:var(--accent); color:#fff"`, the gate fails the
build. The system tells you when you've drifted.

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
| `--accent` | `#096e65` | `#0fd4cf` | Primary interactive, active states |
| `--accent-dim` | `rgba(9,110,101,.10)` | `rgba(15,212,207,.12)` | Accent backgrounds |
| **`--on-accent`** | **`#ffffff`** | **`#0a0f1d`** | **Text/icon on accent surfaces (F122)** |
| `--accent2` | `#c86f0d` | `#fbbf24` | Gold, secondary accent |
| `--good` | `#047857` | `#34d399` | Positive delta, success |
| `--warn` | `#d97706` | `#fbbf24` | Warning |
| `--bad` | `#dc2626` | `#f87171` | Error, negative delta |
| `--info` | `#2563eb` | `#60a5fa` | Informational |

##### Why `--on-accent` matters (F122)

Dark-mode `--accent` is bright cyan `#0fd4cf`. White (`#fff`) text on it scores
1.7:1 — a **hard WCAG fail**. Before F122 the site had 27 inline-style anti-
patterns like `background:var(--accent); color:#fff` that silently broke for
every dark-mode user. The fix is the paired token:

| Mode | `--accent` | `--on-accent` | Contrast |
|------|-----------|---------------|----------|
| Light | `#096e65` (dark teal) | `#ffffff` | 5.6:1 (AA) |
| Dark | `#0fd4cf` (bright cyan) | `#0a0f1d` (deep navy) | 10.3:1 (AAA) |

**Rule:** any time you set `background: var(--accent)` you also set
`color: var(--on-accent, #fff)`. The `#fff` fallback is intentional — if the
token ever drops, the result reverts to the prior (working) light-mode color.

Enforced by `npm run test:inline-contrast`.

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
| `--h1` | `clamp(1.4rem, 3vw, 1.9rem)` | Page titles |
| `--h2` | `clamp(1.05rem, 1.6vw, 1.25rem)` | Section headings |
| `--h3` | `1rem` | Sub-section headings |
| `--h4` | `0.92rem` | Component / card title |
| `--body` | `0.875rem` | Body text (14 px) |
| `--small` | `0.775rem` | Labels, captions (12.4 px) |

Token values updated F94 (consolidated from 5 distinct h1 sizes, 4 h2 sizes,
3 h3 sizes, 4 h4 sizes the original type-scale audit flagged). Don't
re-introduce hardcoded sizes on individual heading tags — use the token.

#### Heading hierarchy

Each page must have **exactly one `<h1>`** (the page title). Sub-sections use
`<h2>`, card headings use `<h3>`, nested sections use `<h4>`.

```html
<h1>Page Title</h1>
  <h2>Major Section</h2>
    <h3>Card / Component Title</h3>
      <h4>Detail</h4>
```

#### Global heading rules (F124)

Every `h1`–`h6` is enforced site-wide via `css/site-theme.css` with `!important`
on `font-size`, `color`, and other key properties so per-page inline overrides
cannot drift away from the canonical look. All headings carry:

- `color: var(--text-strong)` — single contrast level across the hierarchy
  (was inconsistent before F124; h1 used `text-strong` but h2/h3/h4 used `text`,
  and every inline override was trying to upgrade them anyway)
- `text-wrap: balance` — prevents orphan-word-on-last-line layout. 95%+ browser
  support; progressive enhancement on older browsers
- Per-level `font-weight`, `line-height`, `letter-spacing` — see source

#### Lead-paragraph wrap (F124)

Three selectors get `text-wrap: pretty`:

```css
.page-sub
.intro-card p:first-of-type
.article-body > p:first-of-type
```

`pretty` optimizes the last 1–2 lines without disturbing every line, which is
the right behavior for long body paragraphs. `balance` is for short headlines.

#### Anti-patterns

```html
<!-- ❌ FAILS gate: drift risk + redundant (global has !important) -->
<h2 style="font-size:1.2rem; font-weight:700; color:var(--text-strong);">…</h2>

<!-- ✅ PASSES: global tokens handle everything -->
<h2>…</h2>

<!-- ✅ PASSES: non-typography props are allowed -->
<h2 style="margin-top:var(--sp5);">…</h2>

<!-- ✅ PASSES: intentional override via class, not inline -->
<h3 class="h-as-h2">Visually-promoted h3</h3>
```

#### Escape hatches

If you genuinely need a non-canonical size, use a class — **not** inline:

```css
.h-as-h2   /* makes any heading element render at h2 size */
.h-as-h3   /* makes any heading element render at h3 size */
```

Defined in `css/site-theme.css`. Classes are searchable, inline styles are not.

Enforced by `npm run test:inline-heading-typography`.

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
| `js/contrast-guard.js` | Runtime contrast safety net (F252, theme-aware F122) |
| `scripts/audit/inline-contrast-check.mjs` | F122 gate — inline accent+#fff |
| `scripts/audit/inline-heading-typography.mjs` | F124 gate — h1–4 inline typo |
| `test/wcag-pill-contrast.test.js` | Predefined badge contrast in light + dark |

---

## 9. CI Gates (the system's teeth)

All five run in `npm run test:ci`. Adding a new gate? Mirror the pattern in
`scripts/audit/*.mjs` and wire it into `package.json` between existing gates
so it runs in stable order.

### `npm run test:pill-contrast`

Tests every predefined badge / pill / tag class against light + dark backgrounds
and fails if any pair drops below 4.5:1 (WCAG AA) — or 3.0:1 for large text.
Covers all classes in §3.4 above.

Add a new badge → register it in `test/wcag-pill-contrast.test.js`'s
`EXPECTED_BADGES` array.

### `npm run test:inline-contrast` (F122)

Static scan for inline-style anti-pattern: HTML files containing
`background:var(--accent` + `color:#fff` in the same `style="…"` value. The
class-based gate above can't see inline styles; this gate can.

Fix the failure by replacing `color:#fff` with `color:var(--on-accent,#fff)`.

### `npm run test:inline-heading-typography` (F124)

Static scan for `<h1-4 ... style="…">` carrying any of `{font-size,
font-weight, font-family, line-height, letter-spacing, color, text-wrap}`.
Strip them — the global `h1-h6` rules already enforce the canonical values
with `!important`, so the inline overrides were either silently overridden
(noise) or creating cross-page drift.

For intentional one-offs, use `.h-as-h2` / `.h-as-h3` classes.

### `npm run test:phantom-css-vars`

Scans CSS for references to custom properties that aren't defined anywhere.
Catches typos like `var(--text-strng)` or tokens that were renamed without
sweeping consumers.

### `npm run test:data-scope` (F248)

Per-page guard that place-level data masks aren't accidentally shown as
county-level (and vice-versa). Not a typography/color gate but lives in the
same `test:ci` chain.

---

## 10. Runtime contrast guard

`js/contrast-guard.js` is the safety net for cases the static gates miss
(third-party injected content, dynamically-set styles, edge-case selectors).

### When it runs

- `DOMContentLoaded`
- `nav:rendered` (custom event from `js/navigation.js`)
- `window.load`
- **Theme change (F122):** MutationObserver on `<html>` class changes +
  `matchMedia(prefers-color-scheme:dark)` listener. Both deduped through
  `requestAnimationFrame` so back-to-back triggers don't double-scan.

### What it does

For each text-bearing element matched by the scan selector (`h1`–`h6`, `p`,
`span`, `a`, `li`, `td`, `th`, `label`, `button`, plus `.stat-value`,
`.stat-label`, `.metric-value`, `.metric-label`, `.card`, `.panel`, `.chip`,
`.badge`):

1. Compute foreground vs effective background luminance contrast ratio
2. If below 4.5:1 (or 3.0:1 for large text), patch `el.style.color` with
   either `var(--text-d)` or `var(--text-l)` — whichever produces higher
   contrast against the specific background
3. If the element's own background is near-transparent AND the element is
   a card-like surface, also patch `el.style.backgroundColor` to a card
   token
4. Mark with `.contrast-guard-fixed` class so the next theme-change scan
   knows to clear the override before recomputing

### Anchor exception (F122)

`a:not([style*="background"])` in `site-theme.css` excludes anchors that
explicitly carry their own background. Without this, the `a { color:
var(--link) !important }` rule clobbered every inline color on button-styled
anchors — even when they used `var(--on-accent)`, the `!important` won.

`a[style*="background"] { text-decoration: none }` is the paired rule so
pill-styled anchors don't get accidentally underlined.

---

## 11. Data freshness convention

Every stat on the site falls into one of four categories. Listed in
`docs/demo-mode-audit.csv` with per-element evidence.

| Category | Badge   | Color    | Source of truth                              |
|----------|---------|----------|----------------------------------------------|
| LIVE     | LIVE    | `--good` | Fetched from a tracked data file at page load |
| STATIC   | STATIC  | `--warn` | Real published number, snapshot (lags)        |
| QUAL     | QUAL    | `--warn` | Editorial judgment or modeled output          |
| FAKE     | (none)  | n/a      | Invented — **must** be replaced or removed    |

`FAKE` stats are convention failures, not gate failures (yet). The F115 →
F118 → F124 sweep history eliminated all known instances. New stats must
always cite a source.

Pattern:

```html
<div class="stat-card">
  <div class="stat-value" id="myStatValue">—</div>
  <div class="stat-label">Stat label</div>
  <div style="font-size:.68rem;color:var(--muted);margin-top:.25rem;">
    <span style="color:var(--good);font-weight:700;">LIVE</span> ·
    <a href="https://source.example/">Source</a>
  </div>
</div>
```

The `LIVE` text color is hardcoded `var(--good)` rather than the badge class
because the badge is one of three semantic states (LIVE/STATIC/QUAL), not a
named badge type. If this needs to change, do it once in a global rule.

---

## 12. Anti-patterns to recognize

| Pattern | Why it's wrong | Fix |
|---------|---------------|-----|
| `<h2 style="font-size:1.2rem">` | Bypasses global token, creates drift | Remove inline; global wins |
| `background:var(--accent); color:#fff` | 1.7:1 contrast in dark mode | Use `var(--on-accent,#fff)` |
| `<button style="color:#fff">` on `.btn` | Same as above | Use the `.btn` class |
| Hardcoded `margin: 12px` | Doesn't scale; arbitrary value | Use `var(--sp3)` |
| `font-size: 14px` on body text | Doesn't scale with rem-based theme | Use `var(--body)` |
| `color: black` / `color: white` | Breaks dark/light mode | Use `var(--text)` / `var(--bg)` |
| `<a class="btn">` with inline `color:` | Anchor `!important` clobbers it | Use `.btn` class or `:not([style*="background"])` selector pattern |

When in doubt, run `npm run test:ci`. The gates know.

---

## 13. Recent additions changelog

| Feature | What it shipped                                          |
|---------|----------------------------------------------------------|
| F94     | Heading-scale consolidation (typography tokens)          |
| F108    | LIVE wiring of statewide snapshot KPIs                   |
| F115    | LIVE / STATIC / QUAL badge pattern established           |
| F118-0..6 | Site-wide demo-mode audit + badge sweep + CSV inventory |
| F119    | Audit residuals + git rebase fix for 4 workflows         |
| F120    | All P1+P2+P3 from Codex audit                            |
| F121    | CHFA watchlist + Opportunity Finder badge                |
| F122    | `--on-accent` paired token + 27-occurrence sweep + gate  |
|         | + js/contrast-guard.js theme-change re-scan              |
|         | + a:not([style*="background"]) anchor exception          |
|         | + `--autostash` on 4 workflows (companion fix)           |
| F123    | 2026 R1 award geocoding + map bridge layer               |
|         | + 11 street + 3 city-centroid coordinates                |
| F124    | Heading typography sweep + gate; text-wrap: balance      |
|         | + text-wrap: pretty on lead paragraphs                   |
|         | + h2/h3/h4 color upgraded to text-strong                 |
| F125    | Visual regression verification on 23 swept pages         |
| F126    | This document update                                     |

For specific commit SHAs: `git log --oneline | grep -E "F1[12][0-9]"`.

---

## 14. When this document is wrong

If you find a pattern that contradicts what's in here, **the source code wins**.
Update this doc as part of the same commit that changes the system — never as
a follow-up.

The fastest way to keep the doc honest is to run the CI gates before shipping:

```bash
npm run lint                              # CSS + HTML syntax
npm run test:pill-contrast                # predefined badge contrast
npm run test:inline-contrast              # F122 inline accent
npm run test:inline-heading-typography    # F124 heading drift
npm run test:phantom-css-vars             # undefined tokens
```

If all of these are green and you're still seeing a visual bug, the gate is
missing a case. Add the case to the gate before patching the bug — that's how
the system gets stronger over time, not how it ossifies.
