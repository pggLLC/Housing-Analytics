# ChartFix Usage Guide

`js/chart-fix.js` is the sitewide chart lifecycle manager for COHO Analytics. It eliminates blank/hidden chart rendering issues caused by Chart.js rendering into zero-size containers (collapsed `<details>`, hidden tabs, off-screen sections).

---

## Quick Start

Include `chart-fix.js` after `chart.umd.min.js`:

```html
<script src="js/vendor/chart.umd.min.js"></script>
<script defer src="js/chart-fix.js"></script>
```

---

## How It Works

1. **Register** a canvas with a factory function (`createFn`).
2. An **`IntersectionObserver`** watches the canvas; when it becomes visible, `createFn` is called to create the Chart.js instance.
3. A **`ResizeObserver`** watches the canvas's parent container and triggers `.resize()` when the layout changes.
4. **`<details>` toggle events** are wired automatically — opening a `<details>` panel containing a canvas triggers a refresh.
5. The manager tracks instances per canvas ID to prevent duplicates.

---

## API Reference

### `ChartFix.register(canvasId, createFn, options?)`

Register a canvas for lifecycle management.

```js
ChartFix.register('myChart', function (canvas) {
  return new Chart(canvas, {
    type: 'bar',
    data: { … },
    options: { … }
  });
});
```

| Parameter | Type | Description |
|---|---|---|
| `canvasId` | `string` | The `id` of the `<canvas>` element |
| `createFn` | `Function` | Called with `(canvas)`, must return a Chart.js instance |
| `options.renderImmediately` | `boolean` | Render now if visible (default: `true`) |

### `ChartFix.refresh(canvasId)`

Manually trigger a resize or re-creation for a specific canvas.

```js
ChartFix.refresh('myChart');
```

### `ChartFix.refreshAll()`

Refresh all registered canvases (called automatically on `window.resize`).

### `ChartFix.destroy(canvasId)`

Destroy the Chart.js instance and remove the canvas from the registry.

```js
ChartFix.destroy('myChart');
```

### `ChartFix.getInstance(canvasId)`

Return the Chart.js instance (or `null` if not yet created).

```js
const chart = ChartFix.getInstance('myChart');
if (chart) chart.data.datasets[0].data = newData;
```

### `ChartFix.setInstance(canvasId, instance)`

Register an existing Chart.js instance you created yourself (for lifecycle management without `createFn`).

```js
const myChart = new Chart(document.getElementById('myChart'), config);
ChartFix.setInstance('myChart', myChart);
```

---

## Migration Path

### Before (manual resize workaround)

```js
const details = document.querySelector('details');
details.addEventListener('toggle', function () {
  if (details.open) {
    myChart.resize();
  }
});
```

### After (ChartFix)

```js
ChartFix.register('myChartCanvas', function (canvas) {
  return new Chart(canvas, config);
});
// ChartFix automatically handles <details> toggle, resize, and intersection.
```

---

## Working with `<details>` Elements

No extra configuration needed. ChartFix walks up the DOM tree from each registered canvas and attaches `toggle` listeners to any `<details>` ancestors it finds.

```html
<details>
  <summary>Economic Indicators</summary>
  <canvas id="cpiChart" role="img" aria-label="CPI trend chart"></canvas>
</details>
```

```js
ChartFix.register('cpiChart', function (canvas) {
  return new Chart(canvas, cpiConfig);
});
```

---

## Duplicate-Instance Prevention

ChartFix checks for an existing Chart.js instance on the canvas via `Chart.getChart(canvas)` and destroys it before calling `createFn`. This prevents the "Canvas is already in use" error when a component mounts multiple times.

---

## Diagnostics

```js
// How many canvases are registered?
console.log('ChartFix registrations:', ChartFix.count());

// Is a specific chart created yet?
console.log('myChart instance:', ChartFix.getInstance('myChart'));
```
