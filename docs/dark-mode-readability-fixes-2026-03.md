# Dark Mode Readability Fixes — March 2026

## Summary

This document records all CSS changes made to resolve dark mode contrast and readability issues across the COHO Analytics repository. All changes are CSS-only and replace hard-coded light color values with semantic CSS custom properties that automatically adapt between light and dark themes.

---

## Root Cause

Several CSS files used hard-coded light hex colors (`#e6f4ea`, `#fff3e0`, `#fde8e8`, `#f5f7fa`, etc.) for backgrounds of status badges, table headers, coverage matrix cells, gauges, and alerts. These colors are near-white or very light, so they:

- Are nearly invisible in dark mode (dark `--bg` / `--card` backgrounds)
- Fail WCAG 1.4.3 minimum 4.5:1 contrast ratio on dark backgrounds
- Do not respond to the OS `prefers-color-scheme: dark` media query

---

## Files Changed

### 1. `css/data-dashboard.css` — Primary

**Status Badges** (`.dd-badge--*`)

| Class | Before | After |
|---|---|---|
| `.dd-badge--current` | `background: #e6f4ea; color: #1e6e3a` | `background: var(--good-dim); color: var(--good)` |
| `.dd-badge--aging` | `background: #fff3e0; color: #b45309` | `background: var(--warn-dim); color: var(--warn)` |
| `.dd-badge--stale` | `background: #fde8e8; color: #b91c1c` | `background: var(--bad-dim); color: var(--bad)` |
| `.dd-badge--unknown` | `background: #f0f0f0; color: #555` | `background: var(--bg2); color: var(--muted)` |

**Table Headers** (`.dd-table th`)

| Property | Before | After |
|---|---|---|
| `background` | `var(--table-header-bg, #f5f7fa)` | `var(--bg2)` |
| `:hover background` | `var(--table-header-hover, #eaecf0)` | `var(--bg3)` |

**Table Row Hover**

| Selector | Before | After |
|---|---|---|
| `.dd-table tr:hover td` | `var(--row-hover, #f7f9fc)` | `var(--accent-dim)` |
| `.dd-table tr.expanded td` | `var(--row-hover, #f7f9fc)` | `var(--accent-dim)` |
| `.dd-table td border-bottom` | `var(--border-subtle, #eff1f5)` | `var(--border)` |

**Freshness Gauge Fills** (`.dd-gauge-fill.*`)

| Class | Before | After |
|---|---|---|
| `.fresh` | `background: #2e7d32` | `background: var(--good)` |
| `.aging` | `background: #f57c00` | `background: var(--warn)` |
| `.stale` | `background: #c62828` | `background: var(--bad)` |
| `.dd-gauge-bar` background | `var(--border-subtle, #e4e7ee)` | `var(--border)` |

**Timeline Card Status Borders** (`.dd-timeline-card.status-*`)

| Class | Before | After |
|---|---|---|
| `.status-current` | `border-left-color: #2e7d32` | `border-left-color: var(--good)` |
| `.status-aging` | `border-left-color: #f57c00` | `border-left-color: var(--warn)` |
| `.status-stale` | `border-left-color: #c62828` | `border-left-color: var(--bad)` |

**Coverage Matrix** (`.dd-cell--*`)

| Class | Before | After |
|---|---|---|
| `.dd-cell--full` | `background: #c8e6c9` | `background: var(--good-dim)` |
| `.dd-cell--partial` | `background: #fff9c4` | `background: var(--warn-dim)` |
| `.dd-cell--none` | `background: #ffd7d7` | `background: var(--bad-dim)` |
| `.dd-cell--na` | `var(--border-subtle, #e9eaed)` | `var(--bg2)` |
| Matrix `th` background | `var(--table-header-bg, #f5f7fa)` | `var(--bg2)` |
| Matrix cell border | `var(--border-subtle, #e4e7ee)` | `var(--border)` |

**Activity Feed Dots** (`.dd-feed-dot--*`)

| Class | Before | After |
|---|---|---|
| `.dd-feed-dot--ok` | `background: #2e7d32` | `background: var(--good)` |
| `.dd-feed-dot--warn` | `background: #f57c00` | `background: var(--warn)` |
| `.dd-feed-dot--error` | `background: #c62828` | `background: var(--bad)` |
| Feed item border | `var(--border-subtle, #eff1f5)` | `var(--border)` |

**Alert Items** (`.dd-alert-item--*`)

| Class | Before | After |
|---|---|---|
| `.dd-alert-item--warn` | `background: #fff8e1; border: #f57c00` | `background: var(--warn-dim); border: var(--warn)` |
| `.dd-alert-item--error` | `background: #fdecea; border: #c62828` | `background: var(--bad-dim); border: var(--bad)` |
| `.dd-alert-item--ok` | `background: #e8f5e9; border: #2e7d32` | `background: var(--good-dim); border: var(--good)` |

**Sidebar Filter Button Active State**

| Selector | Before | After |
|---|---|---|
| `.dd-filter-btn.active` | `background: var(--accent-light, #e6f0ef)` | `background: var(--accent-dim)` |

**Primary Button Hover**

| Selector | Before | After |
|---|---|---|
| `.dd-btn--primary:hover` | `background: #075c55` | `background: color-mix(in srgb, var(--accent) 80%, #000000 20%)` |

---

### 2. `css/colorado-regional-predictions.css`

**Disclaimer Banner Fallback** (`.crp-disclaimer`)

The main style already uses `color-mix(in srgb, var(--color-warning, #e65100) 10%, transparent)` which adapts to the CSS variable. The `@supports not` fallback for older browsers was `#fff3e0` (a hard-coded light yellow), which would be invisible in dark mode.

| Selector | Before | After |
|---|---|---|
| `@supports not` fallback | `background: #fff3e0` | `background: var(--warn-dim, rgba(180,83,9,.10))` |

---

### 3. `css/pages/housing-needs-assessment.css`

**Default Banner Background** (`.banner`)

| Property | Before | After |
|---|---|---|
| `background` | `color-mix(in oklab, #ffd866 18%, var(--card) 82%)` | `var(--warn-dim)` |

**Compliance Status Badges** (`.compliance-status.*`)

| Class | Before | After |
|---|---|---|
| `.on-track` | `color-mix(in oklab, #22a06b 18%, var(--card) 82%)` / `color: #22a06b` | `var(--good-dim)` / `var(--good)` |
| `.below-target` | `color-mix(in oklab, #f59e0b 18%, var(--card) 82%)` / `color: #d97706` | `var(--warn-dim)` / `var(--warn)` |
| `.eligible` | `color-mix(in oklab, #3b82f6 18%, var(--card) 82%)` / `color: #3b82f6` | `var(--info-dim)` / `var(--info)` |
| `.not-eligible` | `color-mix(in oklab, #ef4444 18%, var(--card) 82%)` / `color: #ef4444` | `var(--bad-dim)` / `var(--bad)` |

**DOLA Filing Badges** (`.dola-filing-*`)

| Class | Before | After |
|---|---|---|
| `.dola-filing-filed` | `color-mix(in oklab, #22a06b 15%, var(--card) 85%)` / `color: #22a06b` | `var(--good-dim)` / `var(--good)` |
| `.dola-filing-urgent` | `color-mix(in oklab, #f97316 15%, var(--card) 85%)` / `color: #c2410c` | `var(--warn-dim)` / `var(--warn)` |

**Checklist Warning State** (`.checklist-item.warning`)

| Property | Before | After |
|---|---|---|
| `background` | `color-mix(in oklab, #f97316 10%, transparent 90%)` | `var(--warn-dim)` |
| `.warning label color` | `#c2410c` | `var(--warn)` |

**Coverage Warning Indicators** (`.pma-coverage-warn`, `.pma-coverage-warning`)

| Class | Before | After |
|---|---|---|
| `.pma-coverage-warn` | `color: #b45309; background: color-mix(…#fbbf24…); border: #fbbf24` | `color: var(--warn); background: var(--warn-dim); border: var(--warn)` |
| `.pma-coverage-warning` | `color: #92400e; background: color-mix(…#fbbf24…); border: #fbbf24` | `color: var(--warn); background: var(--warn-dim); border: var(--warn)` |

---

## CSS Custom Properties Used

All replacement values come from `css/site-theme.css`. These tokens automatically provide the correct values for both light and dark modes:

| Token | Light Mode | Dark Mode |
|---|---|---|
| `--good-dim` | `rgba(4,120,87,.10)` | `rgba(52,211,153,.12)` |
| `--good` | `#047857` | `#34d399` |
| `--warn-dim` | `rgba(180,83,9,.10)` | `rgba(251,191,36,.12)` |
| `--warn` | `#b45309` | `#fbbf24` |
| `--bad-dim` | `rgba(153,27,27,.10)` | `rgba(248,113,113,.12)` |
| `--bad` | `#991b1b` | `#f87171` |
| `--info-dim` | `rgba(29,78,216,.09)` | `rgba(96,165,250,.11)` |
| `--info` | `#1d4ed8` | `#60a5fa` |
| `--accent-dim` | `rgba(9,110,101,.10)` | `rgba(15,212,207,.12)` |
| `--bg2` | `#e4ecf4` | `#0c1928` |
| `--bg3` | `#dae4f0` | `#0f1e30` |
| `--border` | `rgba(13,31,53,.11)` | `rgba(90,150,210,.11)` |
| `--muted` | `#374151` | `rgba(210,225,245,.95)` |

---

## Acceptance Criteria Verification

| Criterion | Status |
|---|---|
| Status badges on `dashboard-data-sources-ui.html` readable in light + dark | ✅ |
| Table headers have sufficient contrast in both modes | ✅ |
| Coverage matrix cells clearly visible + distinguishable in both modes | ✅ |
| All data visualization elements meet WCAG AA 4.5:1 contrast | ✅ |
| No hard-coded light colors that break dark mode | ✅ |
| Changes are CSS-only | ✅ |
| GitHub Pages compatibility maintained | ✅ |
| No behavioral changes for users | ✅ |
