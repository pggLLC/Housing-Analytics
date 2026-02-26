#!/usr/bin/env node
/**
 * Dead-link checker for GitHub Pages repos.
 *
 * - Scans .html files for local href/src links and validates that the referenced
 *   file exists in the repo.
 * - Ignores external URLs (http/https), mailto:, tel:, and pure anchors (#...).
 * - Treats query strings as part of URL but checks only the pathname.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const IGNORE_DIRS = new Set([
  ".git",
  ".github",
  "node_modules",
  "scripts",
  "tools",
]);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      walk(path.join(dir, ent.name), out);
    } else {
      out.push(path.join(dir, ent.name));
    }
  }
  return out;
}

function read(file) {
  return fs.readFileSync(file, "utf-8");
}

function isExternal(u) {
  return /^(https?:)?\/\//i.test(u) || /^mailto:/i.test(u) || /^tel:/i.test(u) || /^data:/i.test(u);
}

function normalizeLink(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  if (s.startsWith("#")) return null;
  if (isExternal(s)) return null;
  // Drop query/hash
  return s.split("#")[0].split("?")[0];
}

function extractLinks(html) {
  const links = [];
  const re = /(href|src)\s*=\s*(["'])(.*?)\2/gi;
  let m;
  while ((m = re.exec(html))) {
    links.push(m[3]);
  }
  return links;
}

function exists(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function checkHtmlFile(file) {
  const html = read(file);
  const dir = path.dirname(file);
  const rawLinks = extractLinks(html);

  const problems = [];
  for (const raw of rawLinks) {
    const link = normalizeLink(raw);
    if (!link) continue;

    // Ignore templated or JS pseudo-links
    if (link === "javascript:void(0)" || link.startsWith("javascript:")) continue;

    // Absolute path in GH Pages site = relative to repo root
    const target = link.startsWith("/")
      ? path.join(ROOT, link.replace(/^\//, ""))
      : path.resolve(dir, link);

    // If it points to a directory, try index.html
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      const idx = path.join(target, "index.html");
      if (!exists(idx)) {
        problems.push({ file, link: raw, resolved: idx, reason: "directory without index.html" });
      }
      continue;
    }

    if (!exists(target)) {
      problems.push({ file, link: raw, resolved: target, reason: "missing file" });
    }
  }
  return problems;
}

function main() {
  const files = walk(ROOT).filter((f) => f.toLowerCase().endsWith(".html"));
  const all = [];
  for (const f of files) {
    all.push(...checkHtmlFile(f));
  }

  if (all.length) {
    console.error(`\nDead-link check failed: ${all.length} issue(s) found.`);
    for (const p of all) {
      console.error(`- ${path.relative(ROOT, p.file)} -> ${p.link}  (resolved: ${path.relative(ROOT, p.resolved)})  [${p.reason}]`);
    }
    console.error("\nTip: if a link is intentionally external, ensure it starts with https://.");
    process.exit(1);
  }

  console.log(`Dead-link check passed: ${files.length} HTML file(s) scanned.`);
}

main();
