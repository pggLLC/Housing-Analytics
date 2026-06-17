# Domain Cutover: cohoanalytics.com (Wix → GitHub Pages)

> **Supersedes** the earlier "GoDaddy → Cloudflare" draft. This runbook reflects the
> **actual** verified setup: the domain is registered and DNS-hosted at **Wix**, and the
> target is the existing **GitHub Pages** site. **Cloudflare is optional** and deferred —
> see the appendix.

## Current state (verified 2026-06-17 via `whois` / `dig` / `gh`)

| Item | Value |
|---|---|
| Registrar | **Wix.com Ltd.** (bought through Wix; expires 2027-03-08) |
| DNS host | **Wix** nameservers — `ns2.wixdns.net`, `ns3.wixdns.net` |
| Apex + `www` today | Wix site (`185.230.63.x`) |
| Email (MX) | **None** — nothing to break |
| GitHub Pages | Live at `https://pggllc.github.io/Housing-Analytics/`; deployed by Actions (`deploy.yml`) |
| Custom domain on GitHub | **Not connected yet** (Pages `cname` = `null`) |
| Repo `CNAME` file | already contains `cohoanalytics.com` |

## Goal

Make `cohoanalytics.com` serve the GitHub Pages site **at the domain root**, with minimal
downtime and no SEO/data breakage.

## Why Cloudflare is NOT required (deferred to the appendix)

- The site is **static** (GitHub Pages) — GitHub already provides a global CDN (Fastly) and
  free, auto-renewing HTTPS. A WAF has almost no attack surface to protect on a static site.
- The only dynamic surface is the **Cloudflare Workers** (`co-ami-gap`,
  `colorado-demographics`, `hud-markets`). Rate-limiting / bot rules for those can be applied
  **at the Worker level** in Cloudflare without moving the domain's DNS.
- Adding Cloudflare later is a **reversible nameserver change** — nothing here locks you out.
- Note: the repo's `_headers` file is **ignored by GitHub Pages** (it's a Cloudflare/Netlify
  convention). Custom security headers (HSTS/CSP) only take effect if you later front the site
  with Cloudflare.

---

## Cutover — order matters

> **DNS first, then the GitHub custom domain.** Connecting the custom domain makes GitHub
> **301-redirect** `pggllc.github.io/Housing-Analytics` → `cohoanalytics.com`; if DNS still
> points to Wix, that sends visitors to the old Wix site. And never make `cohoanalytics.com`
> canonical until it returns `200`.

### 1. (Wix) Repoint DNS

In the Wix dashboard → **Settings → Domains → cohoanalytics.com**:

1. **Disconnect the domain from the Wix site** (unlocks editing the root `A` record).
2. In **Edit DNS Records**, set:
   - **A** · host `@` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - **CNAME** · host `www` → `pggllc.github.io`
   - *(optional IPv6)* **AAAA** · host `@` → `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`
3. **Remove** the old Wix records: `A @ 185.230.63.x` and `CNAME www → *.wixdns.net`.

If Wix blocks editing the root `A` record, jump to the **Cloudflare appendix** (move
nameservers) — that's the clean escape, not a requirement.

### 2. Verify DNS propagated (~1–4h; Wix TTL is 1h)

```bash
dig +short cohoanalytics.com A            # expect 185.199.108–111.153
dig +short www.cohoanalytics.com          # resolves via pggllc.github.io
curl -sI https://cohoanalytics.com | head -5
```

Or check worldwide at dnschecker.org.

### 3. (GitHub) Connect the custom domain

```bash
gh api -X PUT repos/pggLLC/Housing-Analytics/pages -f cname=cohoanalytics.com
```

(Or repo **Settings → Pages → Custom domain**.) The DNS check goes green once Step 2 has
propagated; GitHub then provisions a Let's Encrypt certificate (minutes, up to 24h).

### 4. Merge the canonical PR

Merge the canonical-domain PR (**#975**, branch `chore/canonical-domain-cohoanalytics`) — it
rewrites `sitemap.xml` / `robots.txt` to `cohoanalytics.com`. **Only now**, once the domain
returns `200`. Page `<link rel="canonical">` / `og:url` tags are already relative, so they
need no change.

### 5. ⚠️ Fix Worker CORS (or data panels break)

The public Worker APIs default to allowing CORS only from `https://pggllc.github.io`. **At or
before cutover**, set `CORS_ORIGIN=https://cohoanalytics.com` on:

- `co-ami-gap` — `serverless/cloudflare-worker/co-ami-gap-worker.js`
- `colorado-demographics` — `serverless/cloudflare-worker/colorado-demographics-worker.js`
- `hud-markets` — `serverless/cloudflare-worker/hud-markets-worker.js`

Set it as the Worker environment variable in the Cloudflare dashboard (or a `wrangler` var).
Without it, the browser `Origin` becomes `https://cohoanalytics.com`, the Workers reject it,
and the AMI-gap / demographics / HUD-markets panels go blank.

### 6. Enforce HTTPS

Once the certificate is issued, tick **Enforce HTTPS** in Settings → Pages.

## Validate (post-cutover)

- `curl -I https://cohoanalytics.com` → `200`
- Home and `pipeline.html` load; `indibuild-pipeline-public.html` redirects to `pipeline.html`
- `https://cohoanalytics.com/robots.txt` shows the `cohoanalytics.com` sitemap line
- Data panels that call the Workers load (CORS OK)
- `npm run audit:repo-links:probe`

## Post-cutover cleanup

- **Keep the domain registered** at Wix (or transfer it later to Cloudflare/Porkbun).
  ⚠️ Don't cancel the *domain* — only the Wix **site / Premium plan**, once the site is
  confirmed live on GitHub.
- No email today; if you add `you@cohoanalytics.com` later, create `MX` records wherever DNS
  is hosted at that time.

## Rollback

If anything breaks: in Wix, restore the old records (`A @ 185.230.63.x`,
`CNAME www → *.wixdns.net`) and, on GitHub, clear the custom domain:

```bash
gh api -X PUT repos/pggLLC/Housing-Analytics/pages -f cname=''
```

`https://pggllc.github.io/Housing-Analytics/` keeps serving throughout, so the GitHub site is
never down. Keep TTLs low before cutover to speed rollback.

---

## Appendix — Optional: add Cloudflare later

You don't need this to go live. Add it **when a concrete need appears**:

- You want **HSTS / CSP / security headers** to actually apply (GitHub Pages ignores `_headers`).
- The public **Worker APIs** see abuse and you want edge **rate-limiting / bot challenges**.
- You want **DNSSEC**, or one console to pause/roll back DNS during incidents.

You already have a Cloudflare account (the Workers run there), so this is low-friction.

**How (no downtime):**

1. Inventory current Wix DNS first (`A`, `AAAA`, `CNAME`, `TXT`, `MX`/SPF/DKIM/DMARC, `CAA`).
   Don't lose email records (none today, but re-check at the time).
2. In Cloudflare, **Add a site** → `cohoanalytics.com`; let it scan, then reconcile against
   the Wix inventory.
3. Keep the GitHub Pages records (A `185.199.108–111.153`, `www` → `pggllc.github.io`).
4. At Wix, change **nameservers** to the two Cloudflare nameservers for the zone. Keep the Wix
   records until validated.
5. Conservative settings: SSL/TLS **Full (strict)** once the cert is valid, Always Use HTTPS
   on, minimum TLS 1.2.
6. Harden gradually: DNSSEC (add the DS record at the registrar), HSTS only after HTTPS is
   stable, WAF managed rules in log/challenge mode first, rate limits on API-like routes.

**Footguns:**

- Keep the GitHub records **DNS-only (grey cloud)** until GitHub issues its certificate —
  proxying (orange cloud) too early can block cert validation.
- If you ever proxy, use SSL/TLS **Full** (or Full strict), **never Flexible** — Flexible +
  GitHub "Enforce HTTPS" causes an infinite redirect loop.
