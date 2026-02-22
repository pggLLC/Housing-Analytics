// contrast-guard.js

/**
 * Accessibility helpers for contrast and theme management.
 * Provides functions to check contrast ratio and manage themes.
 */

// Calculate the contrast ratio between two colors
function getContrastRatio(color1, color2) {
    const lum1 = getLuminance(color1);
    const lum2 = getLuminance(color2);
    return (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
}

// Get the luminance value of a color
function getLuminance(color) {
    const rgb = hexToRgb(color);
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;

    return 0.2126 * (r < 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)) +
           0.7152 * (g < 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)) +
           0.0722 * (b < 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4));
}

// Convert HEX color to RGB
function hexToRgb(hex) {
    let r = 0, g = 0, b = 0;

    // 3 digits
    if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    }
    // 6 digits
    else if (hex.length === 7) {
        r = parseInt(hex[1] + hex[2], 16);
        g = parseInt(hex[3] + hex[4], 16);
        b = parseInt(hex[5] + hex[6], 16);
    }

    return { r, g, b };
}

// Example usage:
// const contrast = getContrastRatio('#000000', '#FFFFFF');
// console.log(contrast); // 21

