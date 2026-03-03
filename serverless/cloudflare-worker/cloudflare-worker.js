/**
 * Cloudflare Worker: Main Router
 *
 * Routes incoming requests to the appropriate handler:
 * - GET /co-ami-gap      → handleAMIGap()      (AMI gap analysis)
 * - GET /prop123         → handleProp123()      (Proposition 123 commitments)
 * - GET /co-demographics → handleDemography()   (CO State Demography Office data)
 * - GET /hud-markets     → handleHUDMarkets()   (HUD Market Analysis data)
 *
 * Env vars (Cloudflare Worker secrets/vars):
 * - HUD_USER_TOKEN         (required for /co-ami-gap and /hud-markets)
 * - CENSUS_API_KEY         (optional, for /co-ami-gap)
 * - CO_DEMO_CACHE_SECONDS  (optional, cache TTL for demographics/markets; default 604800)
 * - CORS_ORIGIN            (optional, CORS allowed origin; default "*")
 *
 * To deploy this unified worker instead of individual workers, set the `main`
 * entry in wrangler.toml to this file.
 */

import demoHandler from "./colorado-demographics-worker.js";
import hudHandler from "./hud-markets-worker.js";
import amiHandler from "./co-ami-gap-worker.js";
import prop123Handler from "./prop123-worker.js";

/** Map of pathname prefix → handler module */
const ROUTES = {
  "/co-demographics": demoHandler,
  "/hud-markets": hudHandler,
  "/co-ami-gap": amiHandler,
  "/prop123": prop123Handler
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Find matching handler
    const handler = ROUTES[pathname];
    if (handler) {
      return handler.fetch(request, env, ctx);
    }

    // Root health-check / index
    if (pathname === "/" || pathname === "") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "Housing Analytics API",
          endpoints: Object.keys(ROUTES)
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": env.CORS_ORIGIN || "*"
          }
        }
      );
    }

    return new Response("Not Found", { status: 404 });
  }
};
