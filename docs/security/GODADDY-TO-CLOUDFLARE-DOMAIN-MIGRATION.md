# GoDaddy to Cloudflare Domain Migration

## Goal

Move DNS management for the production domain from GoDaddy to Cloudflare without changing the registrar unless you choose to transfer registration later. This lets Cloudflare manage DNS, TLS, WAF, bot controls, caching, and domain security while GoDaddy can remain the place where the domain is registered.

## Why Do This

- Stronger DNS security: Cloudflare supports DNSSEC, fast DNS propagation, and granular DNS record management.
- Better TLS posture: Cloudflare can enforce HTTPS, modern TLS versions, HSTS, and automatic certificate renewal.
- Web application protection: Cloudflare WAF rules can block common exploit patterns before traffic reaches the site or APIs.
- Bot and rate controls: Cloudflare can challenge obvious automation, rate-limit API endpoints, and reduce scraping or noisy probes.
- Origin shielding: If the custom domain fronts GitHub Pages or Workers, Cloudflare can centralize redirects, headers, caching, and access rules.
- Easier incident response: Cloudflare gives one place to pause traffic, add firewall rules, inspect events, or roll back DNS changes.

## No-Downtime Migration Checklist

1. Inventory current GoDaddy DNS records.
   - Export or screenshot all `A`, `AAAA`, `CNAME`, `TXT`, `MX`, `CAA`, and verification records.
   - Pay special attention to email records (`MX`, SPF, DKIM, DMARC). Do not lose these.

2. Add the domain to Cloudflare.
   - In Cloudflare, choose "Add a site" and enter the root domain.
   - Let Cloudflare scan existing records.
   - Compare the scan against the GoDaddy inventory and manually add anything missing.

3. Set the web target.
   - For GitHub Pages, point the custom domain according to GitHub Pages custom-domain guidance.
   - Keep the GitHub Pages fallback URL working: `https://pggllc.github.io/Housing-Analytics/`.
   - Do not make `cohoanalytics.com` canonical until `cohoanalytics.com/index.html` returns 200.

4. Start conservative Cloudflare settings.
   - SSL/TLS mode: `Full` or `Full (strict)` once the origin certificate is valid.
   - Always Use HTTPS: on.
   - Automatic HTTPS Rewrites: on.
   - Minimum TLS version: TLS 1.2 or higher.
   - Proxy only web records at first. Leave mail and verification records DNS-only.

5. Change nameservers at GoDaddy.
   - Replace GoDaddy nameservers with the two Cloudflare nameservers assigned to the zone.
   - Do not delete GoDaddy DNS records immediately; keep the inventory until validation is complete.

6. Validate after propagation.
   - Confirm root, `www`, and key pages return 200.
   - Confirm email still passes SPF, DKIM, and DMARC checks.
   - Confirm GitHub Pages custom-domain status is healthy.
   - Run the repo link audit: `npm run audit:repo-links:probe`.

7. Harden after the site is stable.
   - Enable DNSSEC in Cloudflare and add the DS record at GoDaddy.
   - Add HSTS only after HTTPS is stable on every required subdomain.
   - Add WAF managed rules in log/challenge mode first, then tighten.
   - Add rate limits for API-like routes and form/collection endpoints.
   - Add security headers with Cloudflare rules or the hosting layer: `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, and a measured `Content-Security-Policy`.

## Practical Security Gains For Housing Analytics

- Protects public dashboards from common scanner traffic and exploit probes.
- Reduces exposure of Cloudflare Worker/API endpoints through rate limits and bot challenges.
- Lets you force HTTPS and modern TLS consistently for the production domain.
- Gives a clean place to redirect old hosts to the current canonical site.
- Makes DNS changes auditable and faster to roll back during incidents.

## Rollback

If anything fails badly, switch the nameservers at GoDaddy back to the previous GoDaddy nameservers and restore the original DNS records from the inventory. DNS rollback is not instant everywhere, so keep TTLs low before migration when possible.
