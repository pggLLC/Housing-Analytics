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
const jsNonVendor = tracked.filter(
  (file) => /^js\/.*\.js$/.test(file) && !file.startsWith("js/vendor/")
).length;
const docsFiles = tracked.filter((file) => /^docs\/.*\.md$/.test(file)).length;
const dataFiles = tracked.filter((file) => file.startsWith("data/")).length;
const scriptFiles = tracked.filter((file) => file.startsWith("scripts/")).length;

const geoConfig = JSON.parse(
  readFileSync(path.join(repoRoot, "data/hna/geo-config.json"), "utf8")
);
const counties = geoConfig.counties.length;
const places = geoConfig.places.length;
const cdps = geoConfig.cdps.length;
const geographies = counties + places + cdps;

// geo-config rows and distinct geoids are NOT the same number: a duplicate row
// makes the config total (547) exceed the number of real geographies (546),
// which is why ranking-index.json carries 546 entries. Surface both so the
// discrepancy stays visible instead of being silently rounded to one value.
const uniqueGeoids = new Set(
  ["counties", "places", "cdps"].flatMap((key) =>
    geoConfig[key].map((entry) => String(entry.geoid))
  )
).size;

const chfa = JSON.parse(
  readFileSync(path.join(repoRoot, "data/chfa-lihtc.json"), "utf8")
);
const chfaFeatures = (chfa.features ?? chfa).length;

const inventoryLine = `Current tracked inventory: **${topLevelHtml} top-level / ${htmlFiles.length} total HTML pages**, **${workflowFiles} workflows**, **${jsFiles} JavaScript files under \`js/\`**, and **${geographies} geographies** (**${counties} counties / ${places} places / ${cdps} CDPs**).`;

// AGENTS.md is what Codex and Copilot read before every task, so a stale count
// there misdirects agents. It cites more metrics than the README, hence its own
// line. Keep the two formats independent — do not merge them.
const agentsLine = `Inventory (derived — run \`node scripts/compute-inventory.mjs\`): **${topLevelHtml}** top-level / **${htmlFiles.length}** total HTML · **${workflowFiles}** workflows · **${jsFiles}** client JS (**${jsNonVendor}** excl. \`vendor/\`) · **${scriptFiles}** build/fetch scripts · **${docsFiles}** \`docs/\` markdown · **${dataFiles}** data files · **${geographies}** geo-config rows / **${uniqueGeoids}** unique geographies (**${counties}** counties / **${places}** places / **${cdps}** CDPs) · **${chfaFeatures}** CHFA LIHTC features.`;

const targets = [
  { file: "README.md", line: inventoryLine },
  { file: "AGENTS.md", line: agentsLine },
];

let stale = false;
for (const { file, line } of targets) {
  console.log(`${file}: ${line}`);
  if (!readFileSync(path.join(repoRoot, file), "utf8").includes(line)) {
    console.error(`${file} inventory is stale. Replace its inventory line with the value above.`);
    stale = true;
  }
}

if (stale) process.exit(1);
console.log("README and AGENTS.md inventory are current.");
