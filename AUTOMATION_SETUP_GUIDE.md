# Automation Setup Guide

## Overview

This guide explains how to configure the automated website monitoring system for Housing-Analytics. The system:

- Scans all links on the target website daily
- Detects broken links (404, 503, network errors, etc.)
- Sends beautifully formatted HTML email reports
- Saves JSON reports to `monitoring-reports/` for historical tracking
- Runs automatically via GitHub Actions every day at 9:00 AM UTC

## Components

| File | Purpose |
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
