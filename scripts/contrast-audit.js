/**
 * scripts/contrast-audit.js — DEPRECATED
 *
 * This script has been replaced by scripts/contrast-audit/run.js.
 *
 * The original JSDOM-based implementation only checked inline `style`
 * attributes and missed all CSS-class-based contrast issues, defaulted to
 * a white background when none was found, and could not detect dark-on-dark
 * or light-on-light text combinations.
 *
 * Migration:
 *   Old: node scripts/contrast-audit.js
 *   New: CONTRAST_BASE_URL=http://localhost:8080 node scripts/contrast-audit/run.js
 *
 * Optional flags for the new script:
 *   CONTRAST_FIX=1             Apply fixes in the browser context and show before/after ratios
 *   CONTRAST_JSON=1            Output full JSON report to stdout
 *   CONTRAST_REPORT_FILE=path  Write JSON report to a file
 *   CONTRAST_PAGE=page.html    Audit a single page (e.g. for CI per-page loops)
 */
'use strict';

console.warn('[contrast-audit] DEPRECATED: scripts/contrast-audit.js has been replaced.');
console.warn('[contrast-audit] Use: CONTRAST_BASE_URL=http://localhost:8080 node scripts/contrast-audit/run.js');
console.warn('[contrast-audit] See scripts/contrast-audit/run.js for full documentation.');
process.exit(0);

