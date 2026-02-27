const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const glob = require("glob");
const Color = require("color");
const wcag = require("wcag-contrast");

const MIN_RATIO = 4.5;

/**
 * Parse CSS text and extract CSS custom property (variable) definitions
 * from :root or top-level rules (light-mode values only — first occurrence wins).
 */
function parseCssVariables(cssText) {
  const vars = {};
  // Match variable declarations: --name: value;
  const re = /--([a-zA-Z0-9_-]+)\s*:\s*([^;}{]+)/g;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    const name = `--${m[1]}`;
    const value = m[2].trim();
    // Keep only the first (light-mode default) definition
    if (!(name in vars)) {
      vars[name] = value;
    }
  }
  return vars;
}

/**
 * Resolve a CSS value that may contain var() references using a variable map.
 * Handles var(--name) and var(--name, fallback).
 * Resolves chains up to a fixed depth to avoid infinite loops.
 */
function resolveCssValue(value, vars, depth = 0) {
  if (depth > 10) return value;
  const varRe = /var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^)]+))?\)/;
  const m = varRe.exec(value);
  if (!m) return value;
  const varName = m[1];
  const fallback = m[2] ? m[2].trim() : null;
  const resolved = vars[varName] !== undefined ? vars[varName] : fallback;
  if (!resolved) return value;
  // Substitute the var() call with the resolved value and recurse
  const next = value.replace(varRe, resolved);
  return resolveCssValue(next, vars, depth + 1);
}

/**
 * Build a CSS variable map for a given HTML document.
 * Reads all linked external CSS files and inline <style> tags.
 */
function buildCssVarMap(document, htmlFilePath) {
  const vars = {};
  const dir = path.dirname(htmlFilePath);

  // Load external CSS files referenced by <link rel="stylesheet">
  const links = document.querySelectorAll('link[rel="stylesheet"]');
  links.forEach(link => {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("http")) return;
    const cssPath = path.resolve(dir, href);
    if (fs.existsSync(cssPath)) {
      const cssText = fs.readFileSync(cssPath, "utf8");
      Object.assign(vars, parseCssVariables(cssText));
    }
  });

  // Load inline <style> tags (these may override external variables)
  const styles = document.querySelectorAll("style");
  styles.forEach(styleEl => {
    Object.assign(vars, parseCssVariables(styleEl.textContent || ""));
  });

  return vars;
}

function getComputedBackground(el) {
  while (el) {
    const style = el.getAttribute("style");
    if (style && style.includes("background")) {
      const match = style.match(/background(?:-color)?:\s*([^;]+)/);
      if (match) return match[1].trim();
    }
    el = el.parentElement;
  }
  return "#ffffff";
}

function fixColor(fg, bg) {
  const light = "#ffffff";
  const dark = "#0f172a";
  const contrastWithLight = wcag.hex(bg, light);
  const contrastWithDark = wcag.hex(bg, dark);

  return contrastWithLight > contrastWithDark ? light : dark;
}

let failures = 0;

glob.sync("**/*.html", { ignore: ["node_modules/**"] }).forEach(file => {
  const html = fs.readFileSync(file, "utf8");
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const cssVars = buildCssVarMap(document, path.resolve(file));

  const elements = document.querySelectorAll("p, span, a, li, h1, h2, h3, h4, h5, h6");

  let fileChanged = false;

  elements.forEach(el => {
    const style = el.getAttribute("style") || "";
    const colorMatch = style.match(/(?<![a-z-])color:\s*([^;]+)/);

    if (!colorMatch) return;

    const fgRaw = colorMatch[1].trim();
    const bgRaw = getComputedBackground(el);

    const fg = resolveCssValue(fgRaw, cssVars);
    const bg = resolveCssValue(bgRaw, cssVars);

    // Skip if still unresolvable (e.g. dynamic values or unknown variables)
    if (fg.includes("var(") || bg.includes("var(")) return;

    try {
      const ratio = wcag.hex(Color(fg).hex(), Color(bg).hex());

      if (ratio < MIN_RATIO) {
        failures++;
        fileChanged = true;
        const newColor = fixColor(Color(fg).hex(), Color(bg).hex());
        el.setAttribute("style", style.replace(/(?<![a-z-])color:\s*[^;]+/, `color: ${newColor}`));
        console.log(`Fixed contrast in ${file}: ${ratio.toFixed(2)} → ${newColor}`);
      }
    } catch (e) {
      console.warn(`Color parse error in ${file}: ${fg}`);
    }
  });

  if (fileChanged) {
    fs.writeFileSync(file, dom.serialize());
  }
});

if (failures > 0) {
  console.error(`\nContrast audit completed with ${failures} fixes.`);
  process.exit(1);
} else {
  console.log("\nContrast audit passed.");
}
