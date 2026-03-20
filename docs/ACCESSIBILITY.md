# Accessibility Standards — COHO Analytics

This document describes the WCAG 2.1 AA accessibility standards enforced in COHO Analytics and explains how automated testing prevents regressions.

---

## Color Contrast Requirements

COHO Analytics targets **WCAG 2.1 Level AA** compliance for all text/background color combinations.

| Text type | Minimum contrast ratio |
|-----------|----------------------|
| Normal text (< 18 pt / < 24 px) | **4.5 : 1** |
| Large text (≥ 18 pt regular / ≥ 14 pt bold) | **3.0 : 1** |
| UI components and graphical objects | **3.0 : 1** |

---

## CSS Design Tokens

All colors are defined as CSS custom properties in `css/site-theme.css`. The site supports automatic OS-level dark mode via `@media (prefers-color-scheme: dark)` and a manual JS toggle via the `html.dark-mode` class.

### Light Mode Tokens (`:root`)

| Token | Value | Role |
|-------|-------|------|
| `--text` | `#0d1f35` | Primary body text (16.6:1 on white) |
| `--text-strong` | `#060f1d` | Headings and emphasized text (19.2:1 on white) |
| `--muted` | `#374151` | Secondary text, labels, UI chrome (10.3:1 on white) |
| `--faint` | `#4b5563` | Tertiary text, sources, captions (7.6:1 on white) |
| `--bg` | `#eef2f7` | Page background |
| `--bg2` | `#e4ecf4` | Section/panel backgrounds |
| `--bg3` | `#dae4f0` | Nested/inset backgrounds |
| `--card` | `#ffffff` | Card surfaces |
| `--accent` | `#096e65` | Brand/interactive color (6.1:1 on white, WCAG AA) |
| `--link` | `#005a9c` | Hyperlinks (7.1:1 on white) |
| `--good` | `#047857` | Success indicators (5.5:1 on white) |
| `--warn` | `#b45309` | Warning indicators (5.0:1 on white) |
| `--bad` | `#991b1b` | Error indicators (8.3:1 on white) |
| `--info` | `#1d4ed8` | Informational indicators (6.7:1 on white) |

### Dark Mode Tokens (`@media (prefers-color-scheme: dark)`)

Dark mode uses light text on dark surfaces. All light mode token values are overridden automatically. Key changes:

| Token | Dark Value | Role |
|-------|-----------|------|
| `--text` | `rgba(215,232,248,.93)` | Primary text (~15:1 on dark bg) |
| `--muted` | `rgba(210,225,245,.95)` | Secondary text (~14:1 on dark bg) |
| `--faint` | `rgba(190,210,235,.90)` | Tertiary text (~12:1 on dark bg) |
| `--bg` | `#08121e` | Page background |
| `--card` | `#0d1e30` | Card surfaces |
| `--accent` | `#0fd4cf` | Brand color, light version (~10:1 on dark bg) |

---

## Automated Contrast Testing

### Local Check

Run the contrast checker before committing changes to `css/site-theme.css`:

```bash
# Check light mode (default)
node tools/contrast-checker.js

# Check dark mode
node tools/contrast-checker.js --dark

# JSON output for CI integration
node tools/contrast-checker.js --json
node tools/contrast-checker.js --dark --json
```

The tool exits with code `0` if all configured pairs pass WCAG AA, `1` if any fail.

### Configuration

Token pairs and thresholds are configured in `.contrast-check-config.json`. Add new pairs when introducing new text/background combinations:

```json
{
  "thresholds": { "normal": 4.5, "large": 3.0 },
  "pairs": [
    {
      "label": "My new text component",
      "fg": "--my-text-token",
      "bg": "--my-bg-token",
      "large": false
    }
  ]
}
```

### CI/CD Integration

The `accessibility.yml` workflow runs the contrast checker on every pull request targeting `main`. It will block merging if any configured pair falls below the WCAG AA threshold.

A comprehensive browser-based audit is performed by `contrast-audit.yml`, which uses Playwright to render each page, measure computed colors, and report violations.

---

## Accessibility Checklist for New Features

Before merging any UI changes, verify:

- [ ] All new text uses `--text`, `--muted`, or `--faint` tokens (never hardcoded hex)
- [ ] Any non-token color has been verified with `tools/contrast-checker.js` or an online tool
- [ ] `<canvas>` elements have `role="img"` and a descriptive `aria-label`
- [ ] Interactive controls that update chart data call `window.__announceUpdate(message)` in their handler and the page has an `aria-live="polite"` region
- [ ] All pages include `<header>`, `<main id="main-content">`, and `<footer>` landmarks
- [ ] A skip-navigation link (`<a class="skip-link" href="#main-content">`) is the first focusable element
- [ ] `<html lang="en">` is present on every page
- [ ] Touch targets (labels, checkboxes, dot-plot indicators) meet the 44 × 44 px minimum
- [ ] Chart colors use `var(--chart-1)` through `var(--chart-7)` tokens only

---

## Prohibited Colors

The following hex values fail WCAG AA on white (`#ffffff`) or the site's light backgrounds and must **never** appear in HTML `backgroundColor` arrays or inline styles:

| Hex | Ratio on white | Problem |
|-----|---------------|---------|
| `#6c7a89` | 2.6:1 | Too light |
| `#3498db` | 3.5:1 | Too light |
| `#27ae60` | 2.5:1 | Too light |
| `#d4a574` | 1.9:1 | Too light |
| `#e4b584` | 2.1:1 | Too light |
| `#2ecc71` | 2.4:1 | Too light |
| `#f39c12` | 2.8:1 | Too light |
| `#c0392b` | 3.4:1 | Too light |

Use the `--chart-1` … `--chart-7` CSS tokens instead.

---

## References

- [WCAG 2.1 — Understanding SC 1.4.3: Contrast (Minimum)](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [APCA Contrast Calculator](https://www.myndex.com/APCA/)
