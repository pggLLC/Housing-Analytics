'use strict';

function normalizeRgb(value) {
  if (Array.isArray(value)) {
    return { r: +value[0], g: +value[1], b: +value[2], a: value[3] == null ? 1 : +value[3] };
  }
  return {
    r: +value.r,
    g: +value.g,
    b: +value.b,
    a: value.a == null ? 1 : +value.a,
  };
}

function srgbToLin(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(rgbValue) {
  const rgb = normalizeRgb(rgbValue);
  return 0.2126 * srgbToLin(rgb.r) + 0.7152 * srgbToLin(rgb.g) + 0.0722 * srgbToLin(rgb.b);
}

function contrastRatio(fgValue, bgValue) {
  const L1 = luminance(fgValue);
  const L2 = luminance(bgValue);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseCssColor(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3
      ? hex[1].split('').map((ch) => ch + ch).join('')
      : hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgb) {
    return {
      r: +rgb[1],
      g: +rgb[2],
      b: +rgb[3],
      a: rgb[4] == null ? 1 : +rgb[4],
    };
  }
  return null;
}

function blendOver(fgValue, bgValue) {
  const fg = normalizeRgb(fgValue);
  const bg = normalizeRgb(bgValue);
  const a = fg.a == null ? 1 : fg.a;
  if (a >= 1) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

module.exports = {
  contrastRatio,
  parseCssColor,
  blendOver,
};
