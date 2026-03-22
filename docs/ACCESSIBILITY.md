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

## Emphasis and Highlight Colors

### When Emphasis Backgrounds Are Used

The design system provides a set of **dim** tokens — `--accent-dim`, `--good-dim`, `--warn-dim`, `--bad-dim`, and `--info-dim` — for subtle tinted backgrounds used in:

- Table row hover and selected states
- Status badges (success, warning, error, info)
- Alert / callout boxes
- Active navigation links and checkboxes

Each dim token is a semi-transparent version of its corresponding semantic color at **10 % opacity on white** (e.g. `--warn-dim: rgba(168,70,8,.10)`), producing a nearly-white tinted surface.

### Choosing the Right Text Color

| Background | Preferred text color | Why |
|------------|---------------------|-----|
| `--accent-dim` | `--text`, `--muted` | Dark text has ≥ 8:1 on near-white tint |
| `--good-dim` | `--text`, `--good` | `--text` ≥ 14:1; `--good` ≥ 4.78:1 |
| `--warn-dim` | `--text`, `--warn` | `--text` ≥ 14:1; `--warn` ≥ 5.13:1 |
| `--bad-dim` | `--text`, `--bad` | `--text` ≥ 13:1; `--bad` ≥ 6.96:1 |
| `--info-dim` | `--text`, `--info` | `--text` ≥ 14:1; `--info` ≥ 5.83:1 |

**Never** place muted or faint text on a dim background using the semantic status color — use `--text` or `--muted` instead.

### Adding a New Emphasis Style

Before shipping any new badge, alert, or highlighted region:

1. **Identify the text/background pair** — e.g. `--warn` text on `--warn-dim` background.
2. **Add the pair to `.contrast-check-config.json`** with `"lightOnly": true` (dim backgrounds are rgba and cannot be blended correctly in the dark-mode model):
   ```json
   {
     "label": "Warn status text on warn-dim badge background",
     "fg": "--warn",
     "bg": "--warn-dim",
     "lightOnly": true
   }
   ```
3. **Run the light-mode check** to confirm ≥ 4.5:1:
   ```bash
   node tools/contrast-checker.js
   ```
4. **Manually verify dark mode** — open a page in dark mode and visually inspect the element. The automated tool blends rgba colors on white and cannot correctly model dark card backgrounds, so dark mode requires manual verification.
5. **Do not hardcode hex values** in inline styles or `backgroundColor` arrays; always use `var(--xxx-dim)`.

### Selection / Highlight

`::selection` uses `var(--accent)` as background with white text in light mode (6.12:1 ✅) and dark navy text (`#0d1f35`) in dark mode (8.97:1 ✅). Do not override `::selection` background without re-verifying contrast.

### Prohibited Inline Patterns

The following patterns have been found to fail WCAG in alert boxes and must **not** be used:

| Pattern | Problem |
|---------|---------|
| `background: rgba(192, 57, 43, …)` | Base `#c0392b` fails (3.4:1 on white) |
| `background: rgba(198, 40, 40, …)` | Use `rgba(169, 50, 38, …)` (`#a93226`, 5.4:1) |

Always use `var(--bad-dim)` or `var(--accent-dim)` CSS tokens instead of rgba literals derived from failing base colors.

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
    },
    {
      "label": "Status text on dim badge background (light mode only)",
      "fg": "--warn",
      "bg": "--warn-dim",
      "lightOnly": true
    }
  ]
}
```

**`"lightOnly": true`** — Add this flag for any pair whose background is a semi-transparent `rgba()` token (e.g. `--warn-dim`). The checker always blends rgba on white, which correctly models light-mode near-white surfaces but gives misleading results for dark mode (where the real backdrop is a dark card). Such pairs are skipped when running `node tools/contrast-checker.js --dark`. Always **verify dark mode manually**.

### CI/CD Integration

The `accessibility.yml` workflow runs the contrast checker on every pull request targeting `main`. It will block merging if any configured pair falls below the WCAG AA threshold.

A comprehensive browser-based audit is performed by `contrast-audit.yml`, which uses Playwright to render each page, measure computed colors, and report violations.

---

## Accessibility Checklist for New Features

Before merging any UI changes, verify:

- [ ] All new text uses `--text`, `--muted`, or `--faint` tokens (never hardcoded hex)
- [ ] Any non-token color has been verified with `tools/contrast-checker.js` or an online tool
- [ ] New emphasis backgrounds (alerts, badges, highlights) use `--xxx-dim` tokens and the pair has been added to `.contrast-check-config.json` with `"lightOnly": true`
- [ ] Dark mode emphasis backgrounds verified manually (the automated checker cannot model rgba backgrounds on dark cards)
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
