# `js/chart-fix.js`

chart-fix.js — Sitewide chart lifecycle manager for COHO Analytics

Solves the "blank chart" problem that occurs when Chart.js renders into a
hidden container (e.g. inside a collapsed <details> element, a hidden tab,
or a section off-screen).

How it works:
 1. Charts are *registered* before or after creation.
 2. An IntersectionObserver watches each canvas; when it becomes visible the
    chart is (re)rendered or resized.
 3. A ResizeObserver watches each canvas's parent container so that charts
    reflow when the layout changes.
 4. <details> elements that contain canvases have a toggle listener added
    so that charts inside them refresh when the panel opens.
 5. Charts can be destroyed and re-created without duplication because the
    manager tracks the Chart.js instance per canvas.

Usage:
  ChartFix.register(canvasId, createFn);
  ChartFix.refresh(canvasId);
  ChartFix.destroy(canvasId);
  ChartFix.refreshAll();

See docs/CHART_FIX_USAGE.md for full documentation.

_No documented symbols — module has a file-header comment only._
