#!/usr/bin/env node
/**
 * validate.js — Affordable Housing Intelligence
 * Checks that all referenced CSS and JS files exist.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let errors = 0;

const htmlFiles = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html'))
  .map(f => path.join(ROOT, f));

console.log(`Validating ${htmlFiles.length} HTML files...\n`);

htmlFiles.forEach(file => {
  const rel = path.basename(file);
  const content = fs.readFileSync(file, 'utf8');
  
  // Find CSS refs
  const cssRefs = [...content.matchAll(/href="(css\/[^"]+)"/g)].map(m => m[1]);
  // Find JS refs
  const jsRefs = [...content.matchAll(/src="(js\/[^"]+)"/g)].map(m => m[1]);
  
  [...cssRefs, ...jsRefs].forEach(ref => {
    const abs = path.join(ROOT, ref);
    if (!fs.existsSync(abs)) {
      console.error(`  ❌ ${rel}: MISSING ${ref}`);
      errors++;
    }
  });
});

if (errors === 0) {
  console.log(`✅ All asset references resolved successfully.`);
  process.exit(0);
} else {
  console.error(`\n❌ ${errors} broken reference(s) found.`);
  process.exit(1);
}
