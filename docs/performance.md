# Performance Optimization Guide — LIHTC Analytics Hub

Target Lighthouse scores: **≥ 95 desktop / ≥ 90 mobile**.

---

## Current CSS Architecture

| File | Purpose | Load order |
|------|---------|------------|
| `css/site-theme.css` | Design tokens, base layout | 1st |
| `css/dark-mode.css` | Dark mode transitions & toggle | 2nd |
| `css/responsive.css` | Mobile breakpoints & touch targets | 3rd |
| `css/accessibility.css` | Focus states, skip link, ARIA utilities | 4th |
| `css/performance.css` | GPU hints, contain, will-change | 5th |
| `css/print.css` | Print layout | via `@media print` |

---

## CSS Minification

Use a minifier before deploying to production. Options:

```bash
# Lightning CSS (Rust, fastest)
npx lightningcss --minify css/site-theme.css -o dist/site-theme.min.css

# PostCSS with cssnano
npx postcss css/*.css --use cssnano -d dist/

# Clean CSS (Node)
npx cleancss -o dist/bundle.min.css css/site-theme.css css/dark-mode.css \
  css/responsive.css css/accessibility.css css/performance.css
```

Typical size reduction: **40–60 %** of original.

---

## Critical Path CSS

Inline the tokens and above-the-fold styles directly in `<head>` to eliminate render-blocking:

```html
<head>
  <!-- CRITICAL — inlined; enables immediate first paint -->
  <style>
    /* Paste the :root variables block from site-theme.css here */
    /* Paste the html, body, header.site-header, .nav-wrap rules */
  </style>

  <!-- NON-CRITICAL — loaded async after page is interactive -->
  <link rel="preload" href="css/site-theme.css" as="style"
        onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="css/site-theme.css"></noscript>
</head>
```

Estimated LCP improvement: **0.3–0.8 s** on slow 4G.

---

## Font Loading Strategy

Fonts are loaded via Google Fonts with `display=swap`. No changes needed for basic use.

For self-hosted fonts (recommended for maximum performance):

1. Download `Plus Jakarta Sans` and `DM Mono` in `.woff2` format.
2. Place files in `fonts/`.
3. Replace the Google Fonts `@import` in `site-theme.css` with:

```css
@font-face {
  font-family: 'Plus Jakarta Sans';
  src: url('../fonts/PlusJakartaSans-Variable.woff2') format('woff2');
  font-weight: 100 900;
  font-display: swap;
}
```

4. Preload in `<head>`:

```html
<link rel="preload" href="fonts/PlusJakartaSans-Variable.woff2"
      as="font" type="font/woff2" crossorigin>
```

Estimated savings: **250–500 ms** on first load (removes third-party round-trip).

---

## Image Optimization

| Format | Use case | Tool |
|--------|---------|------|
| WebP | Photos, charts screenshots | `cwebp`, Squoosh |
| AVIF | High-compression photos | `avifenc`, Squoosh |
| SVG | Logos, icons, illustrations | Inkscape / SVGO |
| PNG | Pixel-perfect screenshots | `pngquant` |

### Responsive Images

```html
<img
  src="images/state-map.webp"
  srcset="images/state-map-640.webp 640w,
          images/state-map-1280.webp 1280w"
  sizes="(max-width: 640px) 100vw, 1240px"
  alt="Map of US states showing LIHTC allocations"
  loading="lazy"
  width="1240"
  height="700"
>
```

Always specify `width` and `height` attributes to prevent Cumulative Layout Shift (CLS).

---

## Lazy Loading

### Images

Add `loading="lazy"` to all below-the-fold images:

```html
<img src="chart.webp" alt="…" loading="lazy" width="800" height="500">
```

### Iframes / Maps

```html
<iframe src="map-embed.html" loading="lazy" title="LIHTC state map"></iframe>
```

### JavaScript modules (dynamic import)

For heavy dashboard scripts, defer initialisation until the user scrolls the chart into view:

```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      import('./heavy-chart-module.js').then(({ init }) => init(entry.target));
      observer.unobserve(entry.target);
    }
  });
});

document.querySelectorAll('[data-lazy-chart]').forEach((el) => observer.observe(el));
```

---

## Bundle Size Analysis

```bash
# Audit installed npm packages
npx bundlephobia-cli leaflet chart.js

# Check total CSS payload
find css/ -name '*.css' | xargs wc -c | sort -n
```

Target total CSS (uncompressed): **< 80 KB**. After gzip: **< 20 KB**.

---

## Lighthouse Scores to Target

| Category | Mobile target | Desktop target |
|----------|--------------|----------------|
| Performance | ≥ 90 | ≥ 95 |
| Accessibility | ≥ 95 | ≥ 95 |
| Best Practices | ≥ 90 | ≥ 95 |
| SEO | ≥ 90 | ≥ 90 |

### Running Lighthouse locally

```bash
# Chrome DevTools: Lighthouse tab → Generate report

# CLI (requires Chrome)
npx lighthouse https://your-site.github.io/ \
  --output html --output-path ./reports/lighthouse.html \
  --only-categories=performance,accessibility,seo
```

### Key metrics

| Metric | Target |
|--------|--------|
| LCP (Largest Contentful Paint) | < 2.5 s |
| FID / INP (Interaction to Next Paint) | < 200 ms |
| CLS (Cumulative Layout Shift) | < 0.1 |
| FCP (First Contentful Paint) | < 1.8 s |
| TTFB (Time to First Byte) | < 600 ms |

---

## Caching Strategy

For GitHub Pages (no server-side configuration):

- All static assets receive long-term cache headers automatically.
- Use cache-busting query strings for CSS/JS updates:
  ```html
  <link rel="stylesheet" href="css/site-theme.css?v=2.0.0">
  ```
- Or use file hashing in a build step:
  ```html
  <link rel="stylesheet" href="css/site-theme.a1b2c3.css">
  ```

---

## Resources

- [web.dev — Performance](https://web.dev/performance/)
- [Lighthouse documentation](https://developer.chrome.com/docs/lighthouse/)
- [WebPageTest](https://www.webpagetest.org/) — real-device testing
- [Squoosh](https://squoosh.app/) — browser-based image optimizer
- [Lightning CSS](https://lightningcss.dev/) — fast CSS minifier
