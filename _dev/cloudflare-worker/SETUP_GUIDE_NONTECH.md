# Cloudflare Worker + GitHub Pages (Non‑technical Setup Guide)

This guide helps you add a small “API” to your existing GitHub Pages site **without** exposing your HUD or Census keys in the browser.

## What you get
A single Cloudflare Worker (a tiny server) that provides:
- **/prop123**  → Proposition 123 jurisdictions + commitments JSON
- **/co-ami-gap** → Colorado county “Households vs Priced‑Affordable Units by %AMI” JSON
- **/health** → quick check

Your website then loads that JSON and shows the tables/charts.

---

## Part 1 — Create the Worker (Cloudflare Dashboard)

### Step 1) Open Cloudflare Workers
1. Log in to Cloudflare.
2. Click **Workers & Pages** (left menu).
3. Click **Create application**.
4. Click **Workers**.
5. Name it: `affordable-housing-api` (or any name).
6. Click **Deploy**.

### Step 2) Paste the Worker code
1. Open the Worker you just deployed.
2. Click **Edit code**.
3. Delete the default code.
4. Open the file in this kit named **cloudflare-worker.js**.
5. Copy ALL of it and paste into the editor.
6. Click **Save and deploy**.

---

## Part 2 — Add Secrets (so the Worker can call HUD/Census)

1. In the Worker page, click **Settings**.
2. Click **Variables and Secrets**.
3. Add these **Secrets** (important: choose “secret”, not plain text):

### Required secret
- **Name:** HUD_USER_TOKEN  
- **Value:** your HUD USER API token

### Recommended secret
- **Name:** CENSUS_API_KEY  
- **Value:** your Census API key (you already have this in GitHub secrets; paste the same value here)

### Optional variables (plain text is fine)
- **ALLOW_ORIGIN** = `*`
- **PROP123_CACHE_SECONDS** = `86400`   (1 day)
- **AMI_CACHE_SECONDS** = `604800`      (7 days)

Click **Save**.

---

## Part 3 — Test the Worker (2 quick tests)

Open these URLs in your browser (replace YOUR_WORKER_NAME):

1) Health check  
`https://YOUR_WORKER_NAME.workers.dev/health`

You should see:  
`{"ok":true,"now":"..."}`

2) Prop 123 data  
`https://YOUR_WORKER_NAME.workers.dev/prop123`

3) AMI Gap data  
`https://YOUR_WORKER_NAME.workers.dev/co-ami-gap`

If you see an error, go to Troubleshooting.

---

## Part 4 — Connect your GitHub Pages site to the Worker

### Step 1) Update js/config.js in GitHub
1. Go to your GitHub repository page.
2. Click **Code** → open the `js` folder → click `config.js`
3. Click the ✏️ pencil icon to edit.
4. Inside `window.APP_CONFIG = { ... }` add these two lines (use your Worker name):

- `PROP123_API_URL: "https://YOUR_WORKER_NAME.workers.dev/prop123",`
- `AMI_GAP_API_URL: "https://YOUR_WORKER_NAME.workers.dev/co-ami-gap",`

5. Scroll down and click **Commit changes**.

### Step 2) Confirm your page already loads the modules
Your `colorado-deep-dive.html` should already include:
- `js/prop123-map.js`
- `js/co-ami-gap.js`

If those exist, you’re done.

---

## Part 5 — Verify it worked
Open your website page:
- `.../colorado-deep-dive.html`

Confirm:
- The Prop 123 overlay toggle highlights counties + municipalities
- Tooltips show commitment info (where available)
- The AMI module loads (no “fallback only” warning)

---

## Troubleshooting

### “Missing HUD_USER_TOKEN secret”
You forgot to add it (Worker Settings → Variables and Secrets). Add it and redeploy.

### “CORS error” in browser console
Set **ALLOW_ORIGIN** to `*` (Worker variables) and redeploy.

### Prop 123 returns an empty list
The DOLA page may have changed its HTML so the Worker can’t find the sheet link.
Fix: open the DOLA page, find the spreadsheet link, and hard‑wire it in the code:
- search for `extractFirstSheetOrCsvUrl` in the Worker code
- replace the auto‑detection with a direct URL

(If you paste the sheet link here, I’ll update the Worker code for you.)

### AMI endpoint is slow the first time
That’s normal (it computes). After that it should be fast because of caching.

---

## Notes
- Your existing GitHub Actions workflows (for FRED/Census JSON files) can stay as-is.
- The Worker is only used for endpoints that should NOT run in the browser (HUD token + heavy calculations).
