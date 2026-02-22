// js/config.js
// Centralized config for API keys and optional serverless endpoints.
// NOTE: For GitHub Pages, secrets should NOT be embedded in client JS.
// Only include non-sensitive keys here (Census & FRED are public keys; HUD USER token must stay server-side).

window.APP_CONFIG = {
  CENSUS_API_KEY: "1f2c85dbf656c97578b8a94fbe3c62bbc5ee3f85",
  FRED_API_KEY:   "00f51491752bdb81cfe7f7524ac63da8",

  // Optional: URL to your serverless endpoint that returns AMI gap JSON.
  // Example (Cloudflare Worker): "https://your-worker.yourdomain.workers.dev/co-ami-gap"
  AMI_GAP_API_URL: "",

  // Optional: URL to your serverless endpoint that returns Prop 123 commitments JSON (for map + table).
  // Example: "https://your-worker.yourdomain.workers.dev/prop123"
  PROP123_API_URL: ""
};
