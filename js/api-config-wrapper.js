// js/api-config-wrapper.js
// Ensures all FRED and Census API calls automatically include keys from js/config.js

(function(){
  if (!window.fetch) return;

  var originalFetch = window.fetch;

  window.fetch = function(input, init){
    try{
      var url = (typeof input === "string") ? input : input.url;
      var hostname = "";
      var sep, fredKey, censusKey;

      try {
        hostname = new URL(url, window.location.href).hostname;
      } catch (_) {
        // Fail closed: an unparseable URL must never receive an API key.
      }

      if (window.APP_CONFIG) {
        // FRED
        if ( (hostname === "fred.stlouisfed.org" || hostname === "api.stlouisfed.org")  && !url.includes("api_key=")) {
          fredKey = window.APP_CONFIG.FRED_API_KEY || "";
          if (fredKey) {
            sep = url.includes("?") ? "&" : "?";
            url = url + sep + "api_key=" + encodeURIComponent(fredKey);
          }
        }

        // Census
        if (hostname === "api.census.gov" && !url.includes("key=")) {
          censusKey = window.APP_CONFIG.CENSUS_API_KEY || "";
          if (censusKey) {
            sep = url.includes("?") ? "&" : "?";
            url = url + sep + "key=" + encodeURIComponent(censusKey);
          }
        }
      }

      return originalFetch.call(this, url, init);
    } catch(e){
      console.warn("API wrapper error:", e);
      return originalFetch.call(this, input, init);
    }
  };

})();
