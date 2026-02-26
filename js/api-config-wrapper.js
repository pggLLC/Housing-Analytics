// js/api-config-wrapper.js
// Ensures all FRED and Census API calls automatically include keys from js/config.js

(function(){
  if (!window.fetch) return;

  const originalFetch = window.fetch;

  window.fetch = function(input, init){
    try{
      let url = (typeof input === "string") ? input : input.url;

      if (window.APP_CONFIG) {
        // FRED
        if ( (url.includes("fred.stlouisfed.org") || url.includes("api.stlouisfed.org"))  && !url.includes("api_key=")) {
          const fredKey = window.APP_CONFIG.FRED_API_KEY || "";
          if (fredKey) {
            const sep = url.includes("?") ? "&" : "?";
            url = url + sep + "api_key=" + encodeURIComponent(fredKey);
          }
        }

        // Census
        if (url.includes("api.census.gov") && !url.includes("key=")) {
          const censusKey = window.APP_CONFIG.CENSUS_API_KEY || "";
          if (censusKey) {
            const sep = url.includes("?") ? "&" : "?";
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

  console.log("✓ API config wrapper active");
})();
