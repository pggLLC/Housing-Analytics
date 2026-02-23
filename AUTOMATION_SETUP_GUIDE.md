# Automation Setup Guide

This guide explains how to set up and use the automated website monitoring system for Housing Analytics.

---
## Overview

This guide explains how to configure the automated website monitoring system for Housing-Analytics. The system:

- Scans all links on the target website daily
- Detects broken links (404, 503, network errors, etc.)
- Sends beautifully formatted HTML email reports
- Saves JSON reports to `monitoring-reports/` for historical tracking
- Runs automatically via GitHub Actions every day at 9:00 AM UTC

## Components

| File | Purpose |
|---|---|
| `test/website-monitor-enhanced.js` | Scans all links on the target website, detects broken links, and emails a formatted HTML report |
| `test/send-test-email.js` | Sends two sample monitoring emails (success and failure) so you can preview the format |
| `.github/workflows/daily-monitoring.yml` | GitHub Actions workflow that runs the monitor every day at 9:00 AM UTC |
| `.env.example` | Template for local environment variables |

---

## Quick Start

### 1. Create a `.env` file for local testing

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```
EMAIL_USER=your-gmail-address@gmail.com
EMAIL_PASSWORD=your-gmail-app-password
WEBSITE_URL=https://your-website.com
RECIPIENT_EMAIL=communityplanner@gmail.com
```

### 2. Get a Gmail App Password

1. Go to your Google Account → **Security**
2. Enable **2-Step Verification** (required)
3. Under **2-Step Verification**, click **App passwords**
4. Select app: **Mail**, device: **Other** (type "Housing Analytics")
5. Copy the generated 16-character password — use this as `EMAIL_PASSWORD`

> ⚠️ Never use your real Gmail password. Always use an App Password.

### 3. Install dependencies

```bash
npm install nodemailer jsdom node-fetch
```

### 4. Run the monitor locally

```bash
node test/website-monitor-enhanced.js
```

### 5. Send sample test emails

```bash
node test/send-test-email.js
```

This sends two emails to `communityplanner@gmail.com`:
- **Email 1** — "Everything is Fine ✅" (45 healthy links, 0 broken)
- **Email 2** — "Issues Found ⚠️" (42 healthy, 3 broken with recommended fixes)

---

## GitHub Actions Setup

### Add GitHub Secrets

Go to your repository on GitHub:
**Settings → Secrets and variables → Actions → New repository secret**

Add these three secrets:

| Secret Name | Description |
|---|---|
| `EMAIL_USER` | Gmail address that sends the monitoring emails |
| `EMAIL_PASSWORD` | Gmail App Password for that address |
| `WEBSITE_URL` | Full URL of the website to monitor (e.g. `https://example.com`) |

> `RECIPIENT_EMAIL` (`communityplanner@gmail.com`) is set directly in the workflow file and does **not** need to be a secret.

### The workflow runs automatically

The workflow (`.github/workflows/daily-monitoring.yml`) is triggered:
- **Daily at 9:00 AM UTC** via `cron: '0 9 * * *'`
- **On demand** via the **Run workflow** button on the Actions tab

---

## Sample Email Screenshots

### ✅ Everything is Fine

```
Subject: ✅ Website Monitor: Everything is Fine — https://example.com

┌─────────────────────────────────────────────────────────┐
│ 🔍 Website Monitoring Report                            │
│ Site: https://example.com  |  Generated: 2026-01-01     │
│                                                         │
│ ✅ Everything is Fine — All links are healthy!          │
│                                                         │
│ Summary                                                 │
│ Total Links Checked  │ 45                               │
│ Healthy Links        │ ✅ 45                            │
│ Broken Links         │ ✅ 0                             │
│ Health Score         │ 100%                             │
└─────────────────────────────────────────────────────────┘
```

### ⚠️ Issues Found

```
Subject: ⚠️ Website Monitor: 3 Issue(s) Found — https://example.com

┌─────────────────────────────────────────────────────────┐
│ 🔍 Website Monitoring Report                            │
│                                                         │
│ ⚠️ Issues Found — 3 broken link(s) detected            │
│                                                         │
│ Summary                                                 │
│ Total Links Checked  │ 45                               │
│ Healthy Links        │ ✅ 42                            │
│ Broken Links         │ ❌ 3                             │
│ Health Score         │ 93%                              │
│                                                         │
│ Broken Links Details                                    │
│ URL                       │ Status │ Recommended Fix    │
│ /old-page                 │ 404    │ Update or remove   │
│ /data/missing.json        │ 503    │ Check server       │
│ broken-domain.com/res     │ ENOTFOUND │ Check domain    │
│                                                         │
│ Action Items                                            │
│ • Fix link #1 ...                                       │
│ • Fix link #2 ...                                       │
│ • Fix link #3 ...                                       │
└─────────────────────────────────────────────────────────┘
```

---

## Schedule Customization

Edit the `cron` value in `.github/workflows/daily-monitoring.yml`:

```yaml
schedule:
  - cron: '0 9 * * *'   # 9:00 AM UTC daily (default)
```

Common cron examples:

| Schedule | Cron expression |
|---|---|
| Every day at 9 AM UTC | `0 9 * * *` |
| Every day at midnight UTC | `0 0 * * *` |
| Every Monday at 8 AM UTC | `0 8 * * 1` |
| Every 6 hours | `0 */6 * * *` |
| Every hour | `0 * * * *` |
|------|---------|
| `test/website-monitor-enhanced.js` | Main monitoring script |
| `test/send-test-email.js` | Sends sample reports to verify email setup |
| `.github/workflows/daily-monitoring.yml` | GitHub Actions workflow |
| `.env.example` | Template for local `.env` file |

---

## Security — Read This First

> ⚠️ **NEVER commit real email addresses, passwords, or URLs to the repository.**

All sensitive values must be stored **only** in GitHub Secrets. The `.env.example` file contains placeholder values as a template — do not replace them with real values.

Sensitive variables required:

| Variable | Description |
|----------|-------------|
| `EMAIL_USER` | Gmail address used to send reports |
| `EMAIL_PASSWORD` | Gmail App Password (not your regular password) |
| `WEBSITE_URL` | URL of the website to monitor |
| `RECIPIENT_EMAIL` | Email address that receives the reports |

---

## Step 1: Create a Gmail App Password

1. Sign in to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Under "Select app", choose **Mail**; under "Select device", choose **Other** and type `Housing-Analytics`
3. Click **Generate** and copy the 16-character password
4. Store this as `EMAIL_PASSWORD` in GitHub Secrets (see Step 3)

---

## Step 2: Create a Local `.env` File (for testing only)

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```
EMAIL_USER=your_gmail_account@gmail.com
EMAIL_PASSWORD=your_16_char_app_password
WEBSITE_URL=https://your-website-url.com
RECIPIENT_EMAIL=your_recipient_email@example.com
```

> `.env` is listed in `.gitignore` and will never be committed to the repository.

---

## Step 3: Add GitHub Secrets

1. Go to your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** for each variable:

   - `EMAIL_USER` — your Gmail address
   - `EMAIL_PASSWORD` — your Gmail App Password
   - `WEBSITE_URL` — the website to monitor (e.g. `https://pgglcc.github.io/Housing-Analytics`)
   - `RECIPIENT_EMAIL` — the email address to receive reports

> **IMPORTANT:** `RECIPIENT_EMAIL` must be stored **only** in GitHub Secrets. It must never appear in any file committed to the repository.

---

## Step 4: Verify Email Setup Locally

Install dependencies and run the test email script:

```bash
npm install nodemailer jsdom node-fetch
node test/send-test-email.js
```

You should receive two emails:
- **"✅ Everything is Fine"** — showing 45 healthy links
- **"⚠️ Issues Found"** — showing 3 broken links with recommended fixes

---

## Step 5: Run the Monitor Locally

```bash
node test/website-monitor-enhanced.js
```

The script will:
1. Scan all links on `WEBSITE_URL`
2. Print a summary to the console
3. Save a JSON report to `monitoring-reports/`
4. Send an HTML email report to `RECIPIENT_EMAIL`

---

## GitHub Actions Workflow

The workflow file `.github/workflows/daily-monitoring.yml` runs automatically every day at 9:00 AM UTC and can also be triggered manually.

### Schedule customization

Edit the `cron` line in the workflow file:

```yaml
- cron: '0 9 * * *'   # 9:00 AM UTC daily (default)
- cron: '0 6 * * *'   # 6:00 AM UTC daily
- cron: '0 9 * * 1'   # 9:00 AM UTC every Monday
- cron: '0 9 1 * *'   # 9:00 AM UTC on the 1st of each month
```

### Manual trigger

1. Go to **Actions** tab in your repository
2. Select **Daily Website Monitoring**
3. Click **Run workflow**

---

## Viewing Results

| Where | What you see |
|---|---|
| **Email inbox** (`communityplanner@gmail.com`) | HTML report with health score and broken link details |
| **GitHub → Actions tab** | Workflow run logs and status |
| **GitHub → Actions → Artifacts** | Downloadable `monitoring-reports/` JSON files (kept 30 days) |
| **`monitoring-reports/` directory** | JSON reports when run locally |

---

## Troubleshooting

### No email received
- Check `EMAIL_USER` and `EMAIL_PASSWORD` secrets are set correctly
- Verify the App Password is 16 characters with no spaces
- Check your Gmail Spam folder
- Confirm 2-Step Verification is enabled on the Gmail account

### Workflow fails at "Install monitoring dependencies"
- The workflow installs `nodemailer`, `jsdom`, and `node-fetch` at runtime
- These do not need to be in `package.json` for the workflow to work

### Website fetch fails
- Verify `WEBSITE_URL` starts with `https://`
- Some sites block automated requests; check if the target site has rate limiting

### Broken links are false positives
- Some URLs return non-200 status to bots; adjust the link-checking logic in `website-monitor-enhanced.js` if needed

---

## Security Notes

- `EMAIL_USER` and `EMAIL_PASSWORD` are stored only in **GitHub Secrets** and never appear in code
- `RECIPIENT_EMAIL` (`communityplanner@gmail.com`) is visible in the workflow file — this is intentional as it is not sensitive
- `WEBSITE_URL` is stored as a secret if it is not a public URL
- The `.env` file is listed in `.gitignore` and should **never** be committed
- Use Gmail App Passwords — never your main account password
| Location | What you'll find |
|----------|-----------------|
| Your email inbox | HTML report with ✅ or ⚠️ status |
| GitHub Actions → workflow run | Console logs and step summaries |
| `monitoring-reports/` | JSON reports (also uploaded as GitHub artifacts with 30-day retention) |

---

## Sample Email Screenshots

### All Links Healthy

```
✅ Everything is Fine

Total Links Checked:  45
Healthy Links:        45
Broken Links:          0
Health Score:        100%
```

### Issues Found

```
⚠️ Issues Found (3 broken links)

Total Links Checked:  45
Healthy Links:        42
Broken Links:          3
Health Score:         93%

Broken Links:
  https://example.com/old-page        | 404 | Page not found — update or remove this link.
  https://example.com/api/data        | 503 | Service unavailable — contact the host.
  https://broken.example.com/resource | N/A | Network error — verify the URL is reachable.

Action Items:
  ☐ https://example.com/old-page — update or remove this link
  ☐ https://example.com/api/data — retry later or contact host
  ☐ https://broken.example.com/resource — verify URL is reachable
```

---

## Troubleshooting

| Problem | Solution |
|---------|---------|
| "Missing environment variables" | Ensure all 4 secrets are set in GitHub Secrets (Step 3) |
| Email not received | Check spam folder; verify Gmail App Password is correct |
| 535 Authentication error | Re-generate Gmail App Password; ensure 2-Step Verification is on |
| No links found | Confirm `WEBSITE_URL` is publicly accessible |
| `node-fetch` not found | Run `npm install nodemailer jsdom node-fetch` |

---

## Security Best Practices

- **No real email addresses** should appear anywhere in the repository code
- Store all sensitive values exclusively in GitHub Secrets
- Use a Gmail App Password, not your main Gmail password
- Rotate your App Password periodically
- The `monitoring-reports/` directory (JSON files only) is safe to commit — it contains no credentials
