/**
 * js/analytics/analytics-charts.js
 * Advanced analytics chart visualizations.
 *
 * Responsibilities:
 *  - Heatmap visualization (industries × age groups)
 *  - Scatter plot (income vs. rent, sized by population)
 *  - Box plot (affordability distribution)
 *  - Parallel coordinates plot (multi-geography, multi-metric)
 *
 * Depends on Chart.js (window.Chart) if available for scatter/box;
 * uses pure SVG/canvas for heatmap and parallel coordinates.
 *
 * Exposed on window.AnalyticsCharts.
 */
(function () {
  'use strict';

  /* ── Color helpers ──────────────────────────────────────────────── */

  var HEATMAP_LOW  = [255, 247, 236];
  var HEATMAP_HIGH = [127,  39,   4];

  function interpolateColor(lo, hi, t) {
    var r = Math.round(lo[0] + (hi[0] - lo[0]) * t);
    var g = Math.round(lo[1] + (hi[1] - lo[1]) * t);
    var b = Math.round(lo[2] + (hi[2] - lo[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  var PARALLEL_PALETTE = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2'];

  /* ── SVG helper ─────────────────────────────────────────────────── */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  /* ── Stat helpers ───────────────────────────────────────────────── */

  function extent(arr) {
    var min = Infinity, max = -Infinity;
    arr.forEach(function (v) { if (v < min) min = v; if (v > max) max = v; });
    return [min, max];
  }

  function quartiles(sorted) {
    var n  = sorted.length;
    var q1 = sorted[Math.floor(n * 0.25)];
    var q2 = sorted[Math.floor(n * 0.50)];
    var q3 = sorted[Math.floor(n * 0.75)];
    var iqr = q3 - q1;
    var lo  = q1 - 1.5 * iqr;
    var hi  = q3 + 1.5 * iqr;
    var min = sorted.find(function (v) { return v >= lo; });
    var max = sorted.slice().reverse().find(function (v) { return v <= hi; });
    return { min: min, q1: q1, median: q2, q3: q3, max: max };
  }

  /* ================================================================ */
  /* 1. Heatmap (SVG)                                                 */
  /* ================================================================ */

  /**
   * Render a heatmap into a container element.
   * @param {HTMLElement|string} container
   * @param {object} options
   * @param {string[]} options.rows        - Row labels (e.g., industry names).
   * @param {string[]} options.cols        - Column labels (e.g., age groups).
   * @param {number[][]} options.values    - Matrix [row][col].
   * @param {string} [options.title]
   */
  function renderHeatmap(container, options) {
    var el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);

    var rows   = options.rows   || [];
    var cols   = options.cols   || [];
    var values = options.values || [];
    var title  = options.title  || '';

    var cellW  = 60, cellH = 28;
    var labelW = 160, labelH = 80;
    var svgW   = labelW + cols.length * cellW + 20;
    var svgH   = labelH + rows.length * cellH + 20;

    // Compute global min/max for normalization
    var flat = [];
    values.forEach(function (r) { r.forEach(function (v) { if (v !== null && v !== undefined) flat.push(v); }); });
    var mn = flat.length ? Math.min.apply(null, flat) : 0;
    var mx = flat.length ? Math.max.apply(null, flat) : 1;

    var svg = svgEl('svg', { width: svgW, height: svgH, role: 'img', 'aria-label': title || 'Heatmap' });

    // Title
    if (title) {
      var titleText = svgEl('text', { x: svgW / 2, y: 18, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 'bold', fill: '#333' });
      titleText.textContent = title;
      svg.appendChild(titleText);
    }

    // Column headers
    cols.forEach(function (col, ci) {
      var t = svgEl('text', {
        x: labelW + ci * cellW + cellW / 2,
        y: labelH - 8,
        'text-anchor': 'middle',
        'font-size': 10,
        fill: '#555',
        transform: 'rotate(-35,' + (labelW + ci * cellW + cellW / 2) + ',' + (labelH - 8) + ')',
      });
      t.textContent = col;
      svg.appendChild(t);
    });

    // Row headers + cells
    rows.forEach(function (row, ri) {
      var t = svgEl('text', {
        x: labelW - 6,
        y: labelH + ri * cellH + cellH / 2 + 4,
        'text-anchor': 'end',
        'font-size': 10,
        fill: '#555',
      });
      t.textContent = row.length > 20 ? row.slice(0, 18) + '…' : row;
      svg.appendChild(t);

      cols.forEach(function (col, ci) {
        var v   = (values[ri] && values[ri][ci] !== undefined) ? values[ri][ci] : null;
        var t01 = (v !== null && mx !== mn) ? (v - mn) / (mx - mn) : 0;
        var fill = v !== null ? interpolateColor(HEATMAP_LOW, HEATMAP_HIGH, t01) : '#eee';

        var rect = svgEl('rect', {
          x: labelW + ci * cellW,
          y: labelH + ri * cellH,
          width: cellW - 1,
          height: cellH - 1,
          fill: fill,
          rx: 2,
        });
        var valTitle = svgEl('title');
        valTitle.textContent = row + ' × ' + col + ': ' + (v !== null ? v : 'N/A');
        rect.appendChild(valTitle);
        svg.appendChild(rect);

        if (v !== null) {
          var vt = svgEl('text', {
            x: labelW + ci * cellW + cellW / 2,
            y: labelH + ri * cellH + cellH / 2 + 4,
            'text-anchor': 'middle',
            'font-size': 9,
            fill: t01 > 0.55 ? '#fff' : '#333',
          });
          vt.textContent = typeof v === 'number' ? v.toLocaleString() : v;
          svg.appendChild(vt);
        }
      });
    });

    el.appendChild(svg);
  }

  /* ================================================================ */
  /* 2. Scatter plot via Chart.js                                     */
  /* ================================================================ */

  /**
   * Render a scatter plot (income vs. rent, optionally sized by population).
   * @param {HTMLCanvasElement|string} canvas
   * @param {object[]} data - Array of records with { label, x, y, r }.
   * @param {object} [options]
   * @param {string} [options.xLabel]
   * @param {string} [options.yLabel]
   * @param {string} [options.title]
   */
  function renderScatterPlot(canvas, data, options) {
    var el = typeof canvas === 'string' ? document.querySelector(canvas) : canvas;
    if (!el || !window.Chart) return null;
    options = options || {};

    // Normalize bubble radii
    var radii = data.map(function (d) { return d.r || 5; });
    var maxR  = Math.max.apply(null, radii) || 1;
    var normalized = data.map(function (d) {
      return {
        x: d.x,
        y: d.y,
        r: Math.max(4, ((d.r || 5) / maxR) * 20),
        label: d.label,
      };
    });

    return new window.Chart(el, {
      type: 'bubble',
      data: {
        datasets: [{
          label: options.title || 'Data',
          data: normalized,
          backgroundColor: 'rgba(78,121,167,0.55)',
          borderColor: '#4e79a7',
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend:  { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var d = ctx.raw;
                return (d.label || '') + ' (' + (options.xLabel || 'X') + ': ' + d.x + ', ' + (options.yLabel || 'Y') + ': ' + d.y + ')';
              },
            },
          },
          title: {
            display: !!options.title,
            text:    options.title || '',
          },
        },
        scales: {
          x: { title: { display: !!options.xLabel, text: options.xLabel || '' } },
          y: { title: { display: !!options.yLabel, text: options.yLabel || '' } },
        },
      },
    });
  }

  /* ================================================================ */
  /* 3. Box plot (SVG)                                                 */
  /* ================================================================ */

  /**
   * Render a box plot for affordability distribution.
   * @param {HTMLElement|string} container
   * @param {object[]} series - Array of { label, values[] }.
   * @param {object} [options]
   * @param {string} [options.title]
   * @param {string} [options.yLabel]
   */
  function renderBoxPlot(container, series, options) {
    var el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
    options = options || {};

    var W = 80, PAD = 40, CHART_H = 220, LABEL_H = 60;
    var svgW = PAD + series.length * W + PAD;
    var svgH = LABEL_H + CHART_H + PAD;

    // Compute global extent
    var allVals = [];
    var stats = series.map(function (s) {
      var sorted = s.values.slice().filter(function (v) { return v !== null && v !== undefined; }).sort(function (a, b) { return a - b; });
      allVals = allVals.concat(sorted);
      return sorted.length > 0 ? quartiles(sorted) : null;
    });
    var globalExt = extent(allVals);
    var mn = globalExt[0], mx = globalExt[1];
    var range = mx - mn || 1;

    function toY(v) { return LABEL_H + CHART_H - ((v - mn) / range) * CHART_H; }

    var svg = svgEl('svg', { width: svgW, height: svgH, role: 'img', 'aria-label': options.title || 'Box Plot' });

    if (options.title) {
      var titleT = svgEl('text', { x: svgW / 2, y: 16, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 'bold', fill: '#333' });
      titleT.textContent = options.title;
      svg.appendChild(titleT);
    }

    // Y-axis label
    if (options.yLabel) {
      var yLbl = svgEl('text', {
        x: 12, y: LABEL_H + CHART_H / 2,
        'text-anchor': 'middle', 'font-size': 10, fill: '#666',
        transform: 'rotate(-90,12,' + (LABEL_H + CHART_H / 2) + ')',
      });
      yLbl.textContent = options.yLabel;
      svg.appendChild(yLbl);
    }

    // Horizontal gridlines
    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      var v = mn + t * range;
      var y = toY(v);
      var line = svgEl('line', { x1: PAD, x2: svgW - PAD, y1: y, y2: y, stroke: '#e0e0e0', 'stroke-width': 1 });
      svg.appendChild(line);
      var t2 = svgEl('text', { x: PAD - 4, y: y + 4, 'text-anchor': 'end', 'font-size': 9, fill: '#888' });
      t2.textContent = v.toFixed(1);
      svg.appendChild(t2);
    });

    // Draw each box
    series.forEach(function (s, si) {
      var q = stats[si];
      var cx = PAD + si * W + W / 2;
      var bw = W * 0.4;

      // Label
      var lbl = svgEl('text', { x: cx, y: svgH - 8, 'text-anchor': 'middle', 'font-size': 10, fill: '#555' });
      lbl.textContent = s.label;
      svg.appendChild(lbl);

      if (!q) return;

      // Whiskers
      var wTop = svgEl('line', { x1: cx, x2: cx, y1: toY(q.max), y2: toY(q.q3), stroke: '#666', 'stroke-width': 1.5 });
      var wBot = svgEl('line', { x1: cx, x2: cx, y1: toY(q.q1), y2: toY(q.min), stroke: '#666', 'stroke-width': 1.5 });
      var capTop = svgEl('line', { x1: cx - bw / 2, x2: cx + bw / 2, y1: toY(q.max), y2: toY(q.max), stroke: '#666', 'stroke-width': 1.5 });
      var capBot = svgEl('line', { x1: cx - bw / 2, x2: cx + bw / 2, y1: toY(q.min), y2: toY(q.min), stroke: '#666', 'stroke-width': 1.5 });
      [wTop, wBot, capTop, capBot].forEach(function (n) { svg.appendChild(n); });

      // IQR box
      var boxRect = svgEl('rect', {
        x:      cx - bw / 2,
        y:      toY(q.q3),
        width:  bw,
        height: Math.abs(toY(q.q1) - toY(q.q3)),
        fill:   'rgba(78,121,167,0.5)',
        stroke: '#4e79a7',
        'stroke-width': 1.5,
      });
      svg.appendChild(boxRect);

      // Median line
      var medLine = svgEl('line', {
        x1: cx - bw / 2, x2: cx + bw / 2,
        y1: toY(q.median), y2: toY(q.median),
        stroke: '#e15759', 'stroke-width': 2,
      });
      svg.appendChild(medLine);
    });

    el.appendChild(svg);
  }

  /* ================================================================ */
  /* 4. Parallel Coordinates (SVG)                                    */
  /* ================================================================ */

  /**
   * Render a parallel coordinates plot.
   * @param {HTMLElement|string} container
   * @param {object[]} series  - Array of { label, values[] } (one per geography).
   * @param {string[]} axes    - Axis labels (length = values.length).
   * @param {object} [options]
   * @param {string} [options.title]
   */
  function renderParallelCoordinates(container, series, axes, options) {
    var el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
    options = options || {};

    var PAD_L = 30, PAD_R = 30, PAD_T = 40, PAD_B = 60;
    var AXIS_H = 200;
    var AXIS_GAP = 100;
    var svgW = PAD_L + (axes.length - 1) * AXIS_GAP + PAD_R;
    var svgH = PAD_T + AXIS_H + PAD_B;

    // Compute per-axis extents
    var axisExtents = axes.map(function (ax, ai) {
      var vals = series.map(function (s) { return parseFloat(s.values[ai]); }).filter(function (v) { return !isNaN(v); });
      return vals.length ? extent(vals) : [0, 1];
    });

    function axisX(ai) { return PAD_L + ai * AXIS_GAP; }
    function pointY(ai, v) {
      var ext = axisExtents[ai];
      var range = ext[1] - ext[0] || 1;
      return PAD_T + AXIS_H - ((v - ext[0]) / range) * AXIS_H;
    }

    var svg = svgEl('svg', { width: svgW, height: svgH, role: 'img', 'aria-label': options.title || 'Parallel Coordinates' });

    if (options.title) {
      var titleT = svgEl('text', { x: svgW / 2, y: 16, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 'bold', fill: '#333' });
      titleT.textContent = options.title;
      svg.appendChild(titleT);
    }

    // Draw axes
    axes.forEach(function (ax, ai) {
      var x = axisX(ai);
      var axLine = svgEl('line', { x1: x, x2: x, y1: PAD_T, y2: PAD_T + AXIS_H, stroke: '#ccc', 'stroke-width': 1 });
      svg.appendChild(axLine);

      var lbl = svgEl('text', { x: x, y: PAD_T + AXIS_H + 16, 'text-anchor': 'middle', 'font-size': 10, fill: '#555' });
      lbl.textContent = ax;
      svg.appendChild(lbl);

      // Min/max labels
      var ext = axisExtents[ai];
      var topLbl = svgEl('text', { x: x + 4, y: PAD_T + 4, 'font-size': 8, fill: '#888' });
      topLbl.textContent = ext[1].toFixed(0);
      svg.appendChild(topLbl);
      var botLbl = svgEl('text', { x: x + 4, y: PAD_T + AXIS_H, 'font-size': 8, fill: '#888' });
      botLbl.textContent = ext[0].toFixed(0);
      svg.appendChild(botLbl);
    });

    // Draw polylines (one per geography)
    series.forEach(function (s, si) {
      var color = PARALLEL_PALETTE[si % PARALLEL_PALETTE.length];
      var points = axes.map(function (ax, ai) {
        var v = parseFloat(s.values[ai]);
        if (isNaN(v)) return null;
        return [axisX(ai), pointY(ai, v)];
      });
      // Build path segments skipping nulls
      var d = '';
      points.forEach(function (pt, pi) {
        if (!pt) return;
        if (!d || points[pi - 1] === null) {
          d += 'M ' + pt[0] + ' ' + pt[1] + ' ';
        } else {
          d += 'L ' + pt[0] + ' ' + pt[1] + ' ';
        }
      });
      if (d) {
        var path = svgEl('path', {
          d: d,
          stroke: color,
          'stroke-width': 1.8,
          fill: 'none',
          opacity: 0.8,
        });
        var title = svgEl('title');
        title.textContent = s.label;
        path.appendChild(title);
        svg.appendChild(path);
      }
    });

    // Legend
    series.forEach(function (s, si) {
      var color = PARALLEL_PALETTE[si % PARALLEL_PALETTE.length];
      var lx = PAD_L + si * 100;
      var ly = svgH - 12;
      var dot = svgEl('circle', { cx: lx + 6, cy: ly - 4, r: 4, fill: color });
      svg.appendChild(dot);
      var t = svgEl('text', { x: lx + 14, y: ly, 'font-size': 9, fill: color });
      t.textContent = s.label;
      svg.appendChild(t);
    });

    el.appendChild(svg);
  }

  /* ── Expose on window ───────────────────────────────────────────── */

  window.AnalyticsCharts = {
    renderHeatmap:             renderHeatmap,
    renderScatterPlot:         renderScatterPlot,
    renderBoxPlot:             renderBoxPlot,
    renderParallelCoordinates: renderParallelCoordinates,
    // Expose for testing
    _quartiles:                quartiles,
    _extent:                   extent,
    _interpolateColor:         interpolateColor,
  };

}());
