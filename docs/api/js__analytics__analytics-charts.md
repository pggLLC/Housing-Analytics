# `js/analytics/analytics-charts.js`

js/analytics/analytics-charts.js
Advanced analytics chart visualizations.

Responsibilities:
 - Heatmap visualization (industries × age groups)
 - Scatter plot (income vs. rent, sized by population)
 - Box plot (affordability distribution)
 - Parallel coordinates plot (multi-geography, multi-metric)

Depends on Chart.js (window.Chart) if available for scatter/box;
uses pure SVG/canvas for heatmap and parallel coordinates.

Exposed on window.AnalyticsCharts.

## Symbols

### `renderHeatmap(container, options)`

Render a heatmap into a container element.
@param {HTMLElement|string} container
@param {object} options
@param {string[]} options.rows        - Row labels (e.g., industry names).
@param {string[]} options.cols        - Column labels (e.g., age groups).
@param {number[][]} options.values    - Matrix [row][col].
@param {string} [options.title]

### `renderScatterPlot(canvas, data, options)`

Render a scatter plot (income vs. rent, optionally sized by population).
@param {HTMLCanvasElement|string} canvas
@param {object[]} data - Array of records with { label, x, y, r }.
@param {object} [options]
@param {string} [options.xLabel]
@param {string} [options.yLabel]
@param {string} [options.title]

### `renderBoxPlot(container, series, options)`

Render a box plot for affordability distribution.
@param {HTMLElement|string} container
@param {object[]} series - Array of { label, values[] }.
@param {object} [options]
@param {string} [options.title]
@param {string} [options.yLabel]

### `renderParallelCoordinates(container, series, axes, options)`

Render a parallel coordinates plot.
@param {HTMLElement|string} container
@param {object[]} series  - Array of { label, values[] } (one per geography).
@param {string[]} axes    - Axis labels (length = values.length).
@param {object} [options]
@param {string} [options.title]
