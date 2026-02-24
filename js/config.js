// js/config.js
// Copy this file to js/config.js and fill in your own free API keys.
//
// FRED (Federal Reserve Economic Data):  https://research.stlouisfed.org/useraccount/apikey
// Census Bureau:                         https://api.census.gov/data/key_signup.html
//
// ⚠️  NEVER commit js/config.js to a public repo — it is listed in .gitignore.

// Guarantee window.APP_CONFIG exists without overwriting any keys already set
// (e.g. by a page-specific inline script loaded before this file).
window.APP_CONFIG = window.APP_CONFIG || {};
var _defaults = {
  CENSUS_API_KEY: "1f2c85dbf656c97578b8a94fbe3c62bbc5ee3f85",
  FRED_API_KEY:   "00f51491752bdb81cfe7f7524ac63da8"
};
Object.keys(_defaults).forEach(function (k) {
  if (!Object.prototype.hasOwnProperty.call(window.APP_CONFIG, k)) {
    window.APP_CONFIG[k] = _defaults[k];
  }
});
