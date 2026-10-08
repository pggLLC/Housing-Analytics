'use strict';

/**
 * UI/UX & Rendering Validation Module
 *
 * Checks HTML pages for structural issues, accessibility failures (WCAG 2.1 AA),
 * broken asset references, landmark structure, canvas aria attributes, and
 * aria-live regions (Rules 10–16).
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');

// The only non-page exemption is explicit and explained. Redirects are audited.
const NON_PAGE_TEMPLATES = Object.freeze({
    'og-card.html': 'Social-image render template, not a navigable site page.',
});

function parsePage(filePath, stats) {
    const source = readFile(filePath);
    const dom = new JSDOM(source);
    const document = dom.window.document;
    // Record the script dependency before removing scripts from the structural DOM.
    const loadsNavigation = Array.from(document.querySelectorAll('script[src]')).some(script =>
        /^(?:\.?\/)?js\/navigation\.js(?:[?#].*)?$/.test(script.getAttribute('src')));
    document.querySelectorAll('script').forEach(script => script.remove());
    const walker = document.createTreeWalker(document, dom.window.NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach(comment => comment.remove());
    stats.parsedPages++;
    return { filePath, source, dom, document, loadsNavigation };
}

// Known failing hex codes (Rule 10 — must not appear in HTML)
const FAILING_HEX_CODES = [
    '#6c7a89', '#3498db', '#27ae60', '#d4a574',
    '#e4b584', '#2ecc71', '#f39c12', '#c0392b',
];

// Required --accent CSS value (Rule 13)
const REQUIRED_ACCENT = '#096e65';
const FORBIDDEN_ACCENT = '#0a7e74';

// Pages that must exist and pass checks
const CRITICAL_PAGES = [
    'index.html',
    'housing-needs-assessment.html',
    'market-analysis.html',
    'preservation.html',
];

/**
 * Returns root-level HTML pages, including redirects; skips named non-page templates.
 * @returns {string[]} absolute paths
 */
function getRootHtmlFiles({ root = ROOT, stats } = {}) {
    try {
        return fs.readdirSync(root)
            .filter(f => f.endsWith('.html'))
            .filter(f => {
                const reason = NON_PAGE_TEMPLATES[f];
                if (reason && stats) stats.excludedPages[f] = reason;
                return !reason;
            })
            .map(f => path.join(root, f));
    } catch (_) {
        return [];
    }
}

/**
 * Reads a file as text; returns empty string on error.
 * @param {string} filePath
 * @returns {string}
 */
function readFile(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (_) {
        return '';
    }
}

/**
 * Checks for known WCAG-failing hardcoded hex color codes in HTML files (Rule 10).
 * @returns {Array<object>} issues
 */
function checkHardcodedColors(options = {}) {
    const issues = [];
    for (const { filePath, source: content } of options.pages) {
        const relPath = path.basename(filePath);
        for (const hex of FAILING_HEX_CODES) {
            if (content.toLowerCase().includes(hex.toLowerCase())) {
                issues.push({
                    severity: 'high',
                    type: 'ui',
                    file: relPath,
                    description: `Hardcoded failing hex color "${hex}" found (contrast < 4.5:1)`,
                    expected: 'Use var(--chart-1) through var(--chart-7) CSS tokens',
                    actual: `Hardcoded color ${hex}`,
                    recommendation: `Replace "${hex}" with the appropriate --chart-N CSS variable from site-theme.css.`,
                });
            }
        }
    }
    return issues;
}

/**
 * Checks that canvas elements have role="img" and aria-label (Rule 15).
 * @returns {Array<object>} issues
 */
function checkCanvasAccessibility(options = {}) {
    const issues = [];
    for (const { filePath, source: content } of options.pages) {
        const relPath = path.basename(filePath);
        // Find all <canvas tags
        const canvasMatches = content.match(/<canvas[^>]*>/gi) || [];
        for (const tag of canvasMatches) {
            if (options.stats) options.stats.canvases++;
            const missingRole = !/role\s*=\s*["']img["']/i.test(tag);
            const missingAria = !/aria-label\s*=/i.test(tag);
            if (missingRole || missingAria) {
                issues.push({
                    severity: 'high',
                    type: 'ui',
                    file: relPath,
                    description: `Canvas element missing ${[missingRole && 'role="img"', missingAria && 'aria-label'].filter(Boolean).join(' and ')}: ${tag.substring(0, 80)}`,
                    expected: '<canvas role="img" aria-label="...">',
                    actual: tag.substring(0, 80),
                    recommendation: 'Add role="img" and a descriptive aria-label to every <canvas> element.',
                });
            }
        }
    }
    return issues;
}

/**
 * Checks pages with a canvas AND a user control in their own markup (Rule 11).
 * This structural scan cannot prove that every update handler announces.
 * @returns {Array<object>} issues
 */
function checkAriaLiveRegions(options = {}) {
    const issues = [];
    for (const { filePath, document } of options.pages) {
        const relPath = path.basename(filePath);
        const hasCanvas = document.querySelector('canvas');
        const hasControl = document.querySelector('select, input, button, textarea');
        const hasAriaLive = document.querySelector('[aria-live="polite" i]');
        if (hasCanvas && hasControl && !hasAriaLive) {
            issues.push({
                severity: 'medium',
                type: 'ui',
                file: relPath,
                description: 'Page has interactive charts but no aria-live="polite" region',
                expected: 'aria-live="polite" region with aria-atomic="true" and window.__announceUpdate()',
                actual: 'No aria-live region found',
                recommendation: 'Add <div aria-live="polite" aria-atomic="true"> and call window.__announceUpdate() on filter changes.',
            });
        }
    }
    return issues;
}

/**
 * Checks that all HTML pages have required landmark structure (Rule 12).
 * @returns {Array<object>} issues
 */
function checkLandmarkStructure(options = {}) {
    const issues = [];
    const navigation = readFile(path.join(options.root || ROOT, 'js', 'navigation.js'));
    const createsHeader = /\.createElement\s*\(\s*['"]header['"]\s*\)/.test(navigation);
    const createsFooter = /\.createElement\s*\(\s*['"]footer['"]\s*\)/.test(navigation);
    if (options.stats) options.stats.navigation = { createsHeader, createsFooter };
    for (const { filePath, document, loadsNavigation } of options.pages) {
        const relPath = path.basename(filePath);
        if (options.stats) {
            options.stats.landmarkPages++;
            if (loadsNavigation && (createsHeader || createsFooter)) options.stats.navigationPages++;
        }
        const missing = [];
        if (!document.querySelector('header') && !(loadsNavigation && createsHeader)) missing.push('<header>');
        if (!document.querySelector('main')) missing.push('<main>');
        if (!document.querySelector('footer') && !(loadsNavigation && createsFooter)) missing.push('<footer>');
        if (missing.length > 0) {
            issues.push({
                severity: 'medium',
                type: 'ui',
                file: relPath,
                description: `Page missing landmark elements: ${missing.join(', ')}`,
                expected: '<header>, <main id="main-content">, and <footer> present',
                actual: `Missing: ${missing.join(', ')}`,
                recommendation: 'Add the missing landmark elements following the pattern in index.html.',
            });
        }
    }
    return issues;
}

/**
 * Checks skip-navigation links target #main-content and main has correct id (Rule 16).
 * @returns {Array<object>} issues
 */
function checkSkipNavigation(options = {}) {
    const issues = [];
    for (const { filePath, document } of options.pages) {
        const relPath = path.basename(filePath);
        // Only check pages that have skip nav links.
        const hasSkipLink = document.querySelector('a[href^="#main" i]');
        if (!hasSkipLink) continue;

        const hasCorrectHref = document.querySelector('a[href="#main-content"]');
        const hasCorrectId = document.querySelector('main#main-content');

        if (!hasCorrectHref) {
            issues.push({
                severity: 'medium',
                type: 'ui',
                file: relPath,
                description: 'Skip-navigation link does not use href="#main-content"',
                expected: 'href="#main-content"',
                actual: 'Different anchor target found',
                recommendation: 'Update skip-nav link href to "#main-content" to match <main id="main-content">.',
            });
        }
        if (!hasCorrectId) {
            issues.push({
                severity: 'medium',
                type: 'ui',
                file: relPath,
                description: '<main> element is missing id="main-content"',
                expected: '<main id="main-content">',
                actual: '<main> without correct id',
                recommendation: 'Add id="main-content" to the <main> element.',
            });
        }
    }
    return issues;
}

/**
 * Checks CSS site-theme.css for correct --accent token value (Rule 13).
 * @returns {Array<object>} issues
 */
function checkAccentToken(options = {}) {
    const issues = [];
    const themePath = path.join(options.root || ROOT, 'css', 'site-theme.css');
    if (!fs.existsSync(themePath)) return issues;

    const content = readFile(themePath);
    if (content.includes(FORBIDDEN_ACCENT)) {
        issues.push({
            severity: 'critical',
            type: 'ui',
            file: 'css/site-theme.css',
            description: `--accent is set to ${FORBIDDEN_ACCENT} (contrast ratio 4.4:1 — fails WCAG AA)`,
            expected: `--accent: ${REQUIRED_ACCENT} (contrast ratio 4.51:1)`,
            actual: `--accent: ${FORBIDDEN_ACCENT}`,
            recommendation: `Change --accent to ${REQUIRED_ACCENT} in css/site-theme.css.`,
        });
    }
    if (!content.includes(REQUIRED_ACCENT)) {
        issues.push({
            severity: 'high',
            type: 'ui',
            file: 'css/site-theme.css',
            description: `--accent token is not set to the required WCAG AA value ${REQUIRED_ACCENT}`,
            expected: `--accent: ${REQUIRED_ACCENT}`,
            actual: 'Value not found',
            recommendation: `Set --accent to ${REQUIRED_ACCENT} in css/site-theme.css.`,
        });
    }
    return issues;
}

/**
 * Checks that critical HTML pages exist (Rule 4 equivalent for pages).
 * @returns {Array<object>} issues
 */
function checkCriticalPages(options = {}) {
    const issues = [];
    for (const page of CRITICAL_PAGES) {
        const filePath = path.join(options.root || ROOT, page);
        if (!fs.existsSync(filePath)) {
            issues.push({
                severity: 'critical',
                type: 'ui',
                file: page,
                description: `Critical page not found: ${page}`,
                expected: 'Page file exists',
                actual: 'File not found',
                recommendation: `Restore ${page} from version control.`,
            });
        }
    }
    return issues;
}

/**
 * Checks for touch target size markers (min 44×44 px via .dot-wrap class) (Rule 14).
 * @returns {Array<object>} issues
 */
function checkTouchTargets(options = {}) {
    const issues = [];
    const cssDir = path.join(options.root || ROOT, 'css');
    if (!fs.existsSync(cssDir)) return issues;

    const cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
    const combinedCss = cssFiles.map(f => readFile(path.join(cssDir, f))).join('\n');

    // Check that .dot-wrap enforces min-height/min-width of 44px
    const dotWrapBlock = combinedCss.match(/\.dot-wrap[^{]*\{([^}]*)\}/s);
    if (!dotWrapBlock) return issues;

    const blockContent = dotWrapBlock[1];
    const hasMinHeight = /min-height\s*:\s*44px/.test(blockContent);
    const hasMinWidth = /min-width\s*:\s*44px/.test(blockContent);

    if (!hasMinHeight || !hasMinWidth) {
        issues.push({
            severity: 'medium',
            type: 'ui',
            file: 'css/',
            description: `.dot-wrap class does not enforce 44×44px minimum touch target size`,
            expected: 'min-height: 44px and min-width: 44px on .dot-wrap',
            actual: `min-height: ${hasMinHeight ? '✅' : '❌'}  min-width: ${hasMinWidth ? '✅' : '❌'}`,
            recommendation: 'Add min-height: 44px and min-width: 44px to the .dot-wrap CSS rule.',
        });
    }
    return issues;
}

/**
 * Checks that required CSS chart color tokens exist in site-theme.css (Rule 10).
 * @returns {Array<object>} issues
 */
function checkChartTokens(options = {}) {
    const issues = [];
    const themePath = path.join(options.root || ROOT, 'css', 'site-theme.css');
    if (!fs.existsSync(themePath)) return issues;

    const content = readFile(themePath);
    const missing = [];
    for (let i = 1; i <= 7; i++) {
        if (!content.includes(`--chart-${i}`)) missing.push(`--chart-${i}`);
    }
    if (missing.length > 0) {
        issues.push({
            severity: 'high',
            type: 'ui',
            file: 'css/site-theme.css',
            description: `Missing WCAG AA chart color tokens: ${missing.join(', ')}`,
            expected: '--chart-1 through --chart-7 tokens defined',
            actual: `Missing: ${missing.join(', ')}`,
            recommendation: 'Add the missing chart color tokens to site-theme.css.',
        });
    }
    return issues;
}

/**
 * Runs all UI/UX and rendering validation checks.
 * @returns {Promise<Array<object>>}
 */
async function runUiValidationChecks({ root = ROOT, stats = {} } = {}) {
    Object.assign(stats, { canvases: 0, landmarkPages: 0, navigationPages: 0, parsedPages: 0, excludedPages: {} });
    const options = { root, stats, pages: [] };
    try {
        for (const filePath of getRootHtmlFiles(options)) options.pages.push(parsePage(filePath, stats));
        console.log('[ui-validation] Running UI/UX & rendering checks...');
        const issues = [
            ...checkCriticalPages(options),
            ...checkHardcodedColors(options),
            ...checkCanvasAccessibility(options),
            ...checkAriaLiveRegions(options),
            ...checkLandmarkStructure(options),
            ...checkSkipNavigation(options),
            ...checkAccentToken(options),
            ...checkChartTokens(options),
            ...checkTouchTargets(options),
        ];
        console.log(`[ui-validation] Found ${issues.length} issue(s).`);
        return issues;
    } finally {
        options.pages.forEach(page => page.dom.window.close());
    }
}

module.exports = { runUiValidationChecks };
