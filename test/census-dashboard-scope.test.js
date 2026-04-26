// test/census-dashboard-scope.test.js
// Ensures Census dashboard stays Colorado-scoped and lists variables used.

const fs = require("fs");
const path = require("path");

function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

const htmlPath = path.join(__dirname, "..", "census-dashboard.html");
const jsPath = path.join(__dirname, "..", "js", "census-multifamily.js");

const html = fs.readFileSync(htmlPath, "utf8");
const js = fs.readFileSync(jsPath, "utf8");

console.log("\n[test] Census dashboard is Colorado-only");
assert(
  /<option value="state">State<\/option>/.test(html),
  "State level option exists",
);
assert(
  /<option value="county">County<\/option>/.test(html),
  "County level option exists",
);
assert(
  /<option value="place">City\/Place<\/option>/.test(html),
  "Place level option exists",
);
assert(!/value="us"/.test(html), "US level option is not present");
assert(
  /COLORADO_FIPS\s*=\s*["']08["']/.test(js),
  "Colorado FIPS constant is set to 08",
);

console.log("\n[test] Census variable inventory is present");
assert(
  /Census Variables Used on This Page/.test(html),
  "Variable inventory heading exists",
);
assert(/DP04_0001E/.test(html), "DP04_0001E is listed");
assert(/DP04_0011PE/.test(html), "DP04_0011PE is listed");
assert(/DP04_0012PE/.test(html), "DP04_0012PE is listed");
assert(/DP04_0013PE/.test(html), "DP04_0013PE is listed");

if (!process.exitCode) {
  console.log("\nAll checks passed ✅");
}
