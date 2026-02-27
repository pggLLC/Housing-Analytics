const { JSDOM } = require("jsdom");
const fs = require("fs");
const glob = require("glob");
const Color = require("color");
const wcag = require("wcag-contrast");

const MIN_RATIO = 4.5;

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

  const elements = document.querySelectorAll("p, span, a, li, h1, h2, h3, h4, h5, h6");

  let fileChanged = false;

  elements.forEach(el => {
    const style = el.getAttribute("style") || "";
    const colorMatch = style.match(/(?<![a-z-])color:\s*([^;]+)/);

    if (!colorMatch) return;

    const fg = colorMatch[1].trim();
    const bg = getComputedBackground(el);

    try {
      const ratio = wcag.hex(Color(fg).hex(), Color(bg).hex());

      if (ratio < MIN_RATIO) {
        failures++;
        fileChanged = true;
        const newColor = fixColor(fg, bg);
        el.setAttribute("style", style.replace(/(?<![a-z-])color:\s*[^;]+/, `color: ${newColor}`));
        console.log(`Fixed contrast in ${file}: ${ratio.toFixed(2)} → ${newColor}`);
      }
    } catch (e) {
      console.warn(`Color parse error in ${file}`);
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
