# Mobile Optimization Guide — LIHTC Analytics Hub

---

## Breakpoint Strategy

The site uses a **mobile-first** approach. Base styles target the smallest screens; media queries progressively enhance for larger viewports.

| Name | Width | Use case |
|------|-------|---------|
| `xs` | < 640 px | Small phones (iPhone SE, etc.) |
| `sm` | ≥ 640 px | Large phones, narrow tablets |
| `md` | ≥ 768 px | Tablets in portrait |
| `lg` | ≥ 1024 px | Tablets in landscape, small laptops |
| `xl` | ≥ 1280 px | Desktops |

### How to use in custom CSS

```css
/* Mobile-first base */
.my-component {
  display: block;
  padding: 1rem;
}

/* Tablet and up */
@media (min-width: 768px) {
  .my-component {
    display: flex;
    padding: 1.5rem;
  }
}

/* Desktop */
@media (min-width: 1024px) {
  .my-component {
    padding: 2rem;
  }
}
```

---

## Touch Target Sizing

**Minimum 44 × 44 px** per WCAG 2.5.5 and Apple Human Interface Guidelines.

`css/responsive.css` enforces this on all interactive elements:

```css
a, button, [role="button"], select, label, summary, .btn, nav.site-nav a {
  min-height: 44px;
  min-width: 44px;
}
```

### Interactive element spacing

On screens narrower than 768 px, spacing between interactive elements increases automatically:

| Element | Mobile gap |
|---------|------------|
| Toolbar items | 12 px |
| Controls row | 14 px |
| Navigation links | 8 px |

---

## Mobile Typography

Fonts scale down on narrow screens via CSS `clamp()`:

| Token | Mobile (< 640 px) | Desktop |
|-------|------------------|---------|
| `--h1` | `clamp(1.4rem, 6vw, 1.8rem)` | `clamp(1.7rem, 3.5vw, 2.6rem)` |
| `--h2` | `clamp(1.05rem, 4vw, 1.25rem)` | `clamp(1.15rem, 2vw, 1.4rem)` |
| `--h3` | `0.95rem` | `1.05rem` |
| `--body` | `0.875rem` | `0.875rem` |

### Preventing iOS zoom on input focus

Inputs must have a font size of at least **16 px** to prevent iOS Safari from zooming in when focused. `css/responsive.css` sets this automatically:

```css
@media (max-width: 767px) {
  select, input, textarea {
    font-size: 1rem; /* 16 px — prevents iOS auto-zoom */
  }
}
```

---

## Responsive Grid Layouts

### KPI / stat grids

| Viewport | Columns |
|----------|---------|
| < 640 px | 1 |
| 640–1023 px | 2 |
| ≥ 1024 px | auto-fit (minmax 180 px) |

### Feature / content grids

| Viewport | Columns |
|----------|---------|
| < 640 px | 1 |
| ≥ 640 px | auto-fit (minmax 300 px) |

### Main shell

| Viewport | Behaviour |
|----------|-----------|
| < 640 px | `margin: 0.5rem auto`, `padding: 0.9rem`, `border-radius: 10px` |
| 640–760 px | `margin: 0.5rem`, standard padding |
| ≥ 760 px | `max-width: 1240px`, `margin: 0.9rem auto` |

---

## Mobile Navigation

`js/mobile-menu.js` handles the hamburger menu:

1. On screens narrower than **768 px**, a hamburger button is injected before `nav.site-nav`.
2. Tapping the button toggles `nav-collapsed` / `nav-expanded` classes and sets `aria-expanded`.
3. Any nav link click closes the menu.
4. Pressing **Escape** closes the menu and returns focus to the button.
5. `document.body.style.overflow = 'hidden'` prevents background scrolling while the menu is open.
6. Resizing to desktop width restores the nav to the default visible state.

### Including the mobile menu

Add to each page's `<head>` (or before `</body>`):

```html
<script src="js/mobile-menu.js" defer></script>
```

---

## Performance on Mobile

Mobile devices often have:
- Slower CPUs (2–4× slower than desktop)
- Slower networks (throttled 4G, LTE)
- Less RAM

Optimisations applied:

| Optimisation | Where |
|-------------|-------|
| Font display: swap | site-theme.css @import URL |
| Image lazy loading | `loading="lazy"` on all below-fold images |
| GPU acceleration | header.site-header in performance.css |
| Paint containment | .card, .kpi-card in performance.css |
| Reduced motion respected | accessibility.css |

### Target mobile metrics

| Metric | Target |
|--------|--------|
| LCP | < 2.5 s on 4G |
| FID / INP | < 200 ms |
| CLS | < 0.1 |
| Lighthouse Performance | ≥ 90 |

---

## Testing on Real Devices

### Chrome DevTools Device Emulation

1. Open DevTools → click the phone/tablet icon (or `Ctrl + Shift + M`).
2. Select a device from the dropdown (iPhone SE, Pixel 7, iPad, etc.).
3. Test at **320 px**, **375 px**, **640 px**, **768 px**, and **1024 px**.

### Real Device Testing

Priority devices to test:

| Device | Viewport | OS |
|--------|---------|-----|
| iPhone SE (3rd gen) | 375 × 667 | iOS 17 |
| iPhone 14 | 390 × 844 | iOS 17 |
| Pixel 7 | 412 × 915 | Android 14 |
| iPad (10th gen) | 820 × 1180 | iPadOS 17 |
| Samsung Galaxy S23 | 360 × 780 | Android 14 |

### Accessibility on mobile

- Test with **VoiceOver** (iOS) and **TalkBack** (Android).
- Verify touch targets are easy to tap with one finger.
- Verify horizontal scrolling does **not** occur at 320 px.

### No horizontal overflow check

```javascript
// Run in DevTools console to detect overflow
document.querySelectorAll('*').forEach(el => {
  if (el.offsetWidth > document.documentElement.offsetWidth) {
    console.log('Overflow:', el);
  }
});
```

---

## Viewport Meta Tag

Every page must include:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```

This is already present on all pages. **Do not** add `maximum-scale=1` as it prevents users from pinch-zooming (accessibility violation).
