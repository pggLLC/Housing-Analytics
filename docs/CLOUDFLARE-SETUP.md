# Cloudflare Access — Setup for IndiBuild Private Page

**Read this when sober.** All the info you'll need is already filled in below.

---

## Your saved details
- Cloudflare account email: **`communityplanner@gmail.com`**
- Domain to protect: `indibuild.com` (or whatever you've registered)
- Path to gate: `/indibuild-pipeline.html`
- Second allowed email: **TBD** — Kim's email goes here

> When you start tomorrow, decide Kim's address. Then use both emails in step 5 below.

---

## Estimated time: 30–45 min, mostly waiting for DNS

## Reversibility: Easy — point nameservers back if you change your mind

---

## Step 1 — Log in to Cloudflare

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Sign in with **`communityplanner@gmail.com`**
3. If this is a new account, create it; verify the email

## Step 2 — Add your domain

1. In the Cloudflare dashboard click **"+ Add a domain"**
2. Type `indibuild.com` (or your registered domain)
3. Pick the **Free** plan
4. Cloudflare will scan existing DNS records — let it import them all
5. Cloudflare gives you 2 nameservers like `xxx.ns.cloudflare.com` and `yyy.ns.cloudflare.com`
6. **Leave this browser tab open** — you'll come back

## Step 3 — Update nameservers at your registrar

1. In a new tab, log in to wherever you registered `indibuild.com` (GoDaddy, Namecheap, Google Domains, etc.)
2. Find DNS / Nameserver settings for the domain
3. Replace the current nameservers with the 2 Cloudflare values from Step 2
4. Save

**Wait 10–60 min** for propagation. Back in Cloudflare, the domain status will change from "Pending" to "Active." You can leave the tab open and check back.

## Step 4 — Connect Cloudflare Pages to GitHub

1. Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. Authorize GitHub → pick **`pggLLC/Housing-Analytics`**
3. Build settings:
   - **Framework preset:** None
   - **Build command:** (leave blank)
   - **Build output directory:** `/`
4. Click **Save and Deploy**
5. After ~2 min you'll get a URL like `housing-analytics.pages.dev`
6. Open it — confirm the site loads
7. Now add the custom domain:
   - Pages project → **Custom domains** → **Set up a custom domain**
   - Enter `coho.indibuild.com` (or whatever subdomain you want)
   - Cloudflare adds the CNAME record automatically

## Step 5 — Enable Zero Trust + create the Access policy

1. Cloudflare dashboard → **Zero Trust** (left sidebar)
2. First time: pick a team name like `indibuild` → Free plan (covers up to 50 users)
3. **Settings → Authentication → Login methods → Add new** → choose **One-time PIN** (sends a magic link to email — simplest, no Google OAuth setup needed)
4. **Access → Applications → Add an application → Self-hosted**
   - **Application name:** `IndiBuild Pipeline`
   - **Application domain:** `coho.indibuild.com` (or your subdomain)
   - **Path:** `indibuild-pipeline.html`
   - Click **Next**
5. **Add a policy:**
   - **Policy name:** `IndiBuild team`
   - **Action:** Allow
   - **Configure rules** → **Selector: Emails** → add:
     - `communityplanner@gmail.com`
     - `<Kim's email here>`
   - Click **Next** → **Add application**

## Step 6 — Test

1. Open a **private/incognito browser window**
2. Go to `https://coho.indibuild.com/indibuild-pipeline.html`
3. Should hit a Cloudflare login wall asking for email
4. Type `communityplanner@gmail.com` → check inbox for the 6-digit code → enter it
5. Page loads
6. Try from regular browser with a different email — should be denied

Done.

---

## Optional: also gate the CSV files

The page reads CSV files at `docs/indibuild-pipeline-prototype/*.csv`. If you also want those private (recommended — otherwise the data is readable by anyone who guesses the URLs), repeat Step 5 with:

- **Application name:** `IndiBuild Pipeline Data`
- **Application domain:** `coho.indibuild.com`
- **Path:** `docs/indibuild-pipeline-prototype/*`
- Same email policy

---

## If you get stuck

Tell me what step number you're on and what you're seeing. I'll walk you through it.

## To turn it off

Just delete the Access application in Zero Trust → Access → Applications. The page becomes public again. No code changes needed.
