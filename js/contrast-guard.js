// contrast-guard.js

/**
 * Contrast Guard - A module for checking contrast ratios in web applications.
 * This module ensures that color contrast ratios meet WCAG standards.
 */

const WCAG_CONTRAST_RATIO_THRESHOLD = 4.5; // Minimum contrast ratio for normal text

/**
 * Calculates the luminance of a color.
 * @param {String} hex - Hexadecimal color string.
 * @returns {Number} - Luminance of the color.
 */
function getLuminance(hex) {
    const rgb = parseInt(hex.slice(1), 16);
    const r = ((rgb >> 16) & 0xff) / 255;
    const g = ((rgb >> 8) & 0xff) / 255;
    const b = (rgb & 0xff) / 255;
    return (0.2126 * (r < 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4))) +
           (0.7152 * (g < 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4))) +
           (0.0722 * (b < 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4)));
}

/**
 * Calculates the contrast ratio between two colors.
 * @param {String} color1 - Hexadecimal color string for the first color.
 * @param {String} color2 - Hexadecimal color string for the second color.
 * @returns {Number} - Contrast ratio.
 */
function getContrastRatio(color1, color2) {
    const lum1 = getLuminance(color1);
    const lum2 = getLuminance(color2);
    const lighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Checks if the contrast between two colors meets accessibility standards.
 * @param {String} color1 - Hexadecimal color string for the first color.
 * @param {String} color2 - Hexadecimal color string for the second color.
 * @returns {Boolean} - True if contrast meets standards, false otherwise.
 */
function checkContrast(color1, color2) {
    return getContrastRatio(color1, color2) >= WCAG_CONTRAST_RATIO_THRESHOLD;
}

module.exports = {
    checkContrast,
};
