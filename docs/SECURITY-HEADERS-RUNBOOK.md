# Security headers rollout runbook

The production site is hosted by GitHub Pages. GitHub Pages does not process the repository's `_headers` file, so that file does not currently set response headers on `cohoanalytics.com`. This runbook describes the human-operated Cloudflare configuration needed to add security headers without changing the application or its GitHub Pages deployment.

No Cloudflare dashboard changes are made by this repository change.

## Preconditions

- Administrative access to the Cloudflare zone for `cohoanalytics.com`.
- Administrative access to the repository's GitHub Pages settings.
- GitHub Pages already recognizes `cohoanalytics.com` as its custom domain and serves it over HTTPS.
- A maintenance window in which the operator can check DNS, TLS, and browser-console behavior.

## 1. Put Cloudflare in front of GitHub Pages

1. In Cloudflare, open **Websites → cohoanalytics.com → DNS → Records**.
2. Confirm the apex and `www` records use the existing GitHub Pages targets documented in `docs/security/DOMAIN-CUTOVER-WIX-TO-PAGES.md`.
3. Change the relevant web records from **DNS only** (gray cloud) to **Proxied** (orange cloud).
4. Do not change the repository's GitHub Pages custom-domain setting or remove `CNAME`.
5. Wait for Cloudflare to report the records as active, then confirm `https://cohoanalytics.com/` still returns the GitHub Pages site.

## 2. Set TLS mode before enabling redirects

1. Open **SSL/TLS → Overview** in the Cloudflare dashboard.
2. Set encryption mode to **Full (strict)**.
3. Do not use **Flexible** mode. Flexible sends HTTP from Cloudflare to the HTTPS-enforcing GitHub Pages origin and can create an HTTP→HTTPS redirect loop.
4. Confirm the origin certificate validates and the homepage loads over HTTPS before continuing.
5. Keep GitHub Pages' **Enforce HTTPS** setting enabled.

## 3. Add a report-only Transform Rule

Use a Cloudflare **Response Header Modification Transform Rule**. Do not rely on the repository's `_headers` file; GitHub Pages ignores it.

1. Open **Rules → Transform Rules → Modify Response Header**.
2. Create a rule named `Security headers — report only`.
3. Apply it to production HTML responses. A safe starting expression for the whole hostname is:

   ```text
   (http.host eq "cohoanalytics.com" or http.host eq "www.cohoanalytics.com")
   ```

4. Add or replace the response headers below:

   | Header | Value |
   | --- | --- |
   | `Content-Security-Policy-Report-Only` | Use the starting policy below |
   | `X-Frame-Options` | `DENY` |
   | `X-Content-Type-Options` | `nosniff` |
   | `Referrer-Policy` | `strict-origin-when-cross-origin` |

5. Save and deploy the rule.

### Starting report-only policy

Enter this as one line in the `Content-Security-Policy-Report-Only` response header:

```text
default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://*.openstreetmap.fr https://server.arcgisonline.com; connect-src 'self' https://api.census.gov https://*.arcgis.com https://services.arcgis.com https://hudgis-hud.opendata.arcgis.com https://api.stlouisfed.org https://hazards.fema.gov https://coho-backend.communityplanner.workers.dev; frame-ancestors 'none'; object-src 'none'; base-uri 'self'
```

The Worker source tree does not contain a deployable public Worker hostname. The policy above uses the currently documented Cloudflare Worker domain. If the public data Worker is deployed under a different hostname, add that exact origin before enforcement rather than broadening the policy to all `*.workers.dev` hosts.

TODO for Batch 3: add the exact R2 public/custom hostname to the appropriate directive before any data is migrated to R2.

`'unsafe-inline'` remains in `script-src` only as a temporary compatibility measure for the site's current inline JavaScript. Remove it after inline JavaScript is extracted in Batch 4. `style-src 'unsafe-inline'` is separate and should be evaluated from report-only telemetry before enforcement.

## 4. Observe report-only violations

1. Confirm the live response headers:

   ```bash
   curl -I https://cohoanalytics.com/
   ```

2. Verify that the response includes all four headers from the Transform Rule and that the CSP header name ends in `-Report-Only`.
3. Load the homepage and representative high-network pages in a clean browser profile:
   - `index.html`
   - `colorado-deep-dive.html`
   - `housing-needs-assessment.html`
   - `market-analysis.html`
   - `economic-dashboard.html`
4. Exercise maps, geography searches, charts, exports, and data refreshes.
5. Record every CSP violation from the browser console. Classify each blocked origin as required application traffic, an optional third-party integration, or unexpected traffic.
6. Add only required, narrowly scoped origins to the report-only policy. Do not add `*` to any directive.
7. Repeat until representative workflows produce no unexplained CSP violations for at least one normal release cycle.

## 5. Move from report-only to enforcement

1. Copy the reviewed policy value.
2. Change the header name from `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in the same Transform Rule.
3. Keep `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin` unchanged.
4. Deploy during a monitored window and immediately repeat the representative-page checks.
5. If enforcement breaks a required workflow, revert the CSP header name to `Content-Security-Policy-Report-Only`, investigate the violation, and refine the allowlist before trying enforcement again.

## Rollback

If Cloudflare proxying or TLS causes an outage, first disable the response-header Transform Rule. If the problem persists, return the affected DNS records to **DNS only** while preserving the GitHub Pages records and custom-domain configuration. Do not switch SSL/TLS to Flexible as a workaround.
