#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
}).split("\0").filter(Boolean);

const htmlFiles = tracked.filter((file) => file.endsWith(".html"));
const topLevelHtml = htmlFiles.filter((file) => !file.includes("/")).length;
const workflowFiles = tracked.filter((file) =>
  /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)
).length;
const jsFiles = tracked.filter((file) => /^js\/.*\.js$/.test(file)).length;

const geoConfig = JSON.parse(
  readFileSync(path.join(repoRoot, "data/hna/geo-config.json"), "utf8")
);
const counties = geoConfig.counties.length;
const places = geoConfig.places.length;
const cdps = geoConfig.cdps.length;
const geographies = counties + places + cdps;

const inventoryLine = `Current tracked inventory: **${topLevelHtml} top-level / ${htmlFiles.length} total HTML pages**, **${workflowFiles} workflows**, **${jsFiles} JavaScript files under \`js/\`**, and **${geographies} geographies** (**${counties} counties / ${places} places / ${cdps} CDPs**).`;
const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

console.log(inventoryLine);
if (!readme.includes(inventoryLine)) {
  console.error("README inventory is stale. Replace its inventory line with the value above.");
  process.exit(1);
}

console.log("README inventory is current.");
