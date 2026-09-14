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
// Heading was reworded to "Data sources & variables"; match either so a copy
// edit is not a test failure.
assert(
  /Census Variables Used on This Page|Data sources &amp;? variables/i.test(html),
  "Variable inventory heading exists",
);
assert(/DP04_0001E/.test(html), "DP04_0001E is listed");

// This used to require DP04_0011PE / 0012PE / 0013PE. Those are from the
// pre-2026-05-10 numbering that js/hna/hna-controller.js documents as
// MISLABELED -- it read 0003E-0010E as structure types when the real
// structure-type codes are 0007E-0014E. The page has since moved to the correct
// range, so demanding the old codes back would assert the bug.
//
// What matters is that the page still publishes an inventory of the variables
// it actually uses, so assert the structure-type range is documented and that
// the superseded codes have not crept back.
assert(/DP04_0007E/.test(html) && /DP04_0014E/.test(html),
  "structure-type range (DP04_0007E–0014E) is listed");
["DP04_0011PE", "DP04_0012PE", "DP04_0013PE"].forEach((code) => {
  assert(!new RegExp(code).test(html),
    code + " (superseded mislabeled numbering) is not listed");
});

if (!process.exitCode) {
  console.log("\nAll checks passed ✅");
}
