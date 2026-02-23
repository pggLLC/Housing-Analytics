# Dark Mode Implementation Guide — LIHTC Analytics Hub

---

## How Dark Mode Works

The site uses a **two-layer** dark mode system:

### Layer 1 — OS preference (`prefers-color-scheme`)

`css/site-theme.css` defines all colour tokens in `:root` for light mode and re-declares them inside `@media (prefers-color-scheme: dark)`. Every component that uses these CSS custom properties automatically adapts when the OS switches to dark mode.

No JavaScript is required for the basic OS-preference-based behaviour.

### Layer 2 — Manual toggle (`js/dark-mode-toggle.js`)

`js/dark-mode-toggle.js` adds a floating button that lets the user override their OS preference. It:

1. Reads `localStorage.getItem('lihtc-color-scheme')` on page load.
2. If no stored preference, falls back to `window.matchMedia('(prefers-color-scheme: dark)').matches`.
3. Applies `.dark-mode` or `.light-mode` class to `<html>`.
4. `css/dark-mode.css` mirrors all dark-mode token values under `html.dark-mode { … }` so the class overrides the media query.
5. Listens for OS preference changes and updates automatically when no manual preference is stored.

---

## Color Palette for Dark Mode

| Token | Light value | Dark value |
|-------|------------|------------|
| `--bg` | `#eef2f7` | `#08121e` |
| `--bg2` | `#e4ecf4` | `#0c1928` |
| `--card` | `#ffffff` | `#0d1e30` |
| `--text` | `#0d1f35` | `rgba(215,232,248,.93)` |
| `--muted` | `#476080` | `rgba(155,185,215,.72)` |
| `--accent` | `#0ea5a0` | `#0fd4cf` |
| `--accent2` (gold) | `#e8891a` | `#fbbf24` |
| `--link` | `#0b7285` | `#5ecbcc` |
| `--good` | `#059669` | `#34d399` |
| `--warn` | `#d97706` | `#fbbf24` |
| `--bad` | `#dc2626` | `#f87171` |

All contrast ratios in dark mode meet WCAG 2.1 AA (4.5:1 for normal text). See `docs/accessibility.md` for the full contrast table.

---

## Smooth Transitions

`css/dark-mode.css` adds a global transition to `background-color`, `border-color`, `color`, and `box-shadow` so mode switches animate smoothly over 250 ms.

Elements that should **not** transition (e.g., images, map tiles, canvas charts) are exempted:

```css
img, video, canvas, svg, .leaflet-container, [data-no-transition] {
  transition: none !important;
}
```

To exclude any element from the transition, add `data-no-transition`:

```html
<canvas data-no-transition aria-label="Chart">…</canvas>
```

---

## Including the Dark Mode Files

Add these two lines to the `<head>` of every page, **after** `site-theme.css`:

```html
<link rel="stylesheet" href="css/dark-mode.css">
<script src="js/dark-mode-toggle.js" defer></script>
```

The script is deferred so it doesn't block page rendering. The CSS should be loaded synchronously (before first paint) to avoid a flash of un-themed content.

---

## Testing Dark Mode

### In Chrome / Edge DevTools

1. Open DevTools (`F12`).
2. Go to **More tools → Rendering**.
3. Under **Emulate CSS media feature `prefers-color-scheme`**, choose **dark**.

### In Firefox DevTools

1. Open DevTools.
2. Open the **Responsive Design Mode** or the **Inspector**.
3. Click the palette icon next to `prefers-color-scheme` in the toolbar.

### Manual toggle

Click the 🌙 button in the bottom-right corner of any page that includes `js/dark-mode-toggle.js`.

### Local storage reset

To test the OS-default behaviour (without a stored preference):

```javascript
localStorage.removeItem('lihtc-color-scheme');
location.reload();
```

---

## Optional: Dark Mode Toggle Implementation

The toggle is **optional** and off by default. To enable it on a page:

```html
<script src="js/dark-mode-toggle.js" defer></script>
```

The button is injected automatically into `document.body` and styled by `css/dark-mode.css`.

### Customising the button position

Override the `.dark-mode-toggle` CSS custom positioning:

```css
.dark-mode-toggle {
  bottom: 2rem;
  right: 2rem;
}
```

### Listening for mode changes in custom scripts

```javascript
document.addEventListener('DOMSubtreeModified', function () {
  var isDark = document.documentElement.classList.contains('dark-mode');
  // Update chart colours, etc.
});
```

Or use a `MutationObserver` for better performance:

```javascript
new MutationObserver(function () {
  var isDark = document.documentElement.classList.contains('dark-mode');
  myChart.options.color = isDark ? '#e4f0fc' : '#0d1f35';
  myChart.update();
}).observe(document.documentElement, { attributeFilter: ['class'] });
```

---

## Browser Support

| Browser | OS preference | Manual toggle |
|---------|--------------|---------------|
| Chrome 76+ | ✅ | ✅ |
| Firefox 67+ | ✅ | ✅ |
| Safari 12.1+ | ✅ | ✅ |
| Edge 79+ | ✅ | ✅ |
| Samsung Internet 12+ | ✅ | ✅ |
| IE 11 | ❌ | ❌ |

IE 11 falls back to light mode (the media query is simply ignored).

---

## Contrast Verification in Dark Mode

Run the [Colour Contrast Analyser](https://www.tpgi.com/color-contrast-checker/) against the dark-mode token values in the table above, or use Chrome DevTools:

1. Inspect any text element.
2. In the **Styles** panel, click the colour swatch next to `color`.
3. The contrast ratio is shown at the bottom of the picker.

All foreground/background pairs must achieve:
- **4.5:1** for normal text (< 18 pt / < 14 pt bold)
- **3:1** for large text (≥ 18 pt / ≥ 14 pt bold)
- **3:1** for UI components and graphical objects
