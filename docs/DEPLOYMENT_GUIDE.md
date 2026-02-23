# GitHub Pages Deployment Guide

This guide explains how to deploy the Housing-Analytics static site on GitHub Pages, verify it after launch, and keep it healthy over time.

---

## Overview of the Static-File Archive

The repository root serves as the deployable archive. All files required to run the site are present in the repository:

```
Housing-Analytics/
├── index.html               # Site entry point
├── *.html                   # All site pages
├── css/                     # Site-wide stylesheets
│   ├── styles.css           # Base styles
│   ├── site-theme.css       # Color theme and typography
│   ├── unified-theme.css    # Unified dark/light theme variables
│   ├── responsive-nav.css   # Responsive navigation
│   └── predictions-dashboard.css
├── js/                      # Site-wide JavaScript
│   ├── main.js              # Entry point
│   ├── navigation.js        # Navigation logic
│   ├── config.js            # API/feature configuration
│   └── vendor/              # Bundled third-party libraries
│       ├── chart.umd.min.js
│       ├── d3.v7.min.js
│       ├── leaflet.js / leaflet.css
│       └── topojson.v3.min.js
├── data/                    # Static data files
├── includes/                # Shared HTML fragments
└── docs/                    # Developer documentation
```

No build step is required — the repository is ready to serve as-is.

---

## Part 1: Deploying on GitHub Pages

### Option A — Deploy from the `main` branch (recommended for most users)

1. Push all static files to the `main` branch (or ensure the branch is up to date).
2. In your repository on GitHub, click **Settings**.
3. In the left sidebar, click **Pages**.
4. Under **Build and deployment → Source**, select **Deploy from a branch**.
5. Under **Branch**, choose `main` and set the folder to `/ (root)`.
6. Click **Save**.

GitHub Pages will build and publish the site within a few minutes. The URL will be:

```
https://<your-github-username>.github.io/<repository-name>/
```

### Option B — Deploy from a dedicated `gh-pages` branch

Use this option if you want to keep deployment artifacts separate from your development history.

1. Create and publish the `gh-pages` branch:

   ```bash
   git checkout --orphan gh-pages
   git reset --hard
   git commit --allow-empty -m "Initialize gh-pages branch"
   git push origin gh-pages
   git checkout main
   ```

2. Copy (or merge) all static files into the `gh-pages` branch:

   ```bash
   git checkout gh-pages
   git checkout main -- .
   git push origin gh-pages
   git checkout main
   ```

3. In **Settings → Pages → Branch**, select `gh-pages` and folder `/ (root)`, then click **Save**.

### Option C — Deploy from the `docs/` folder

1. Move or copy all static files into a `docs/` subdirectory on `main`.
2. In **Settings → Pages → Branch**, select `main` and folder `/docs`, then click **Save**.

---

## Part 2: Verifying the Live Website

After GitHub Pages finishes publishing (typically 1–3 minutes):

1. **Confirm the published URL**
   - Go to **Settings → Pages** — the live URL is shown at the top of the page.

2. **Open the site in a browser**
   - Navigate to `https://<username>.github.io/<repo>/` and confirm the home page loads.

3. **Check each main page**

   | URL path | Expected page |
   |----------|---------------|
   | `/` | LIHTC Analytics Hub home |
   | `/dashboard.html` | Main analytics dashboard |
   | `/regional.html` | Regional housing data |
   | `/census-dashboard.html` | Census data dashboard |
   | `/state-allocation-map.html` | Federal LIHTC map |

4. **Verify static assets load**
   - Open browser DevTools (F12) → **Console** tab. There should be no `404` errors for CSS or JS files.
   - Open the **Network** tab, reload the page, and confirm all resources return `200 OK`.

5. **Run the automated monitor** (optional but recommended)
   - See `AUTOMATION_SETUP_GUIDE.md` for instructions to run the link checker against the live URL.

---

## Part 3: Maintenance Tips

### Updating content without breaking the site

- **CSS changes** — Edit files in `css/`. All pages import stylesheets using relative paths, so no HTML edits are needed for style-only changes.
- **JS changes** — Edit files in `js/`. Configuration lives in `js/config.js`; update API keys or feature flags there without touching individual page files.
- **Adding a new page** — Create the `.html` file at the repository root and add a link to it in `includes/header.html` so it appears in the navigation automatically.
- **Updating vendor libraries** — Replace the relevant file in `js/vendor/` only. Verify with `npm run test:vendor` before deploying.

### Keeping GitHub Pages accessible

- **Never remove `index.html`** from the branch being served. Deleting or renaming it will cause a blank/404 home page.
- **Use relative paths** for all CSS, JS, image, and page links (e.g., `./css/styles.css`, not `/css/styles.css`), so the site works under any repository sub-path.
- **Test locally before pushing.** Open `index.html` directly in a browser or serve the folder with a static server:

  ```bash
  npx serve .
  # then open http://localhost:3000
  ```

- **Run the test suite** after any significant change:

  ```bash
  npm run test:scripts   # verify JS files load without errors
  npm run test:vendor    # verify vendor bundle integrity
  npm run test:fallback  # verify fallback mechanisms
  ```

### Preventing breaking changes

| Risk | Mitigation |
|------|-----------|
| Renaming a CSS or JS file | Update every `<link>` / `<script>` tag that references it |
| Moving a page to a subdirectory | Update all internal `<a href>` links and the navigation in `includes/header.html` |
| Changing an API key or endpoint | Update `js/config.js` only; no other files need to change |
| Merging a large PR | Deploy to a preview branch first; verify with the link checker before merging to the served branch |
| Removing a vendor library | Confirm no JS file imports it before deleting from `js/vendor/` |

### Archiving the site for offline use

To create a standalone downloadable archive of the current static files:

```bash
git archive --format=zip --output=housing-analytics-static.zip HEAD
```

This produces a ZIP containing exactly the files tracked in the repository, ready for immediate download and local use without any build step.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Site shows a 404 after deployment | Pages branch/folder not set correctly | Re-check **Settings → Pages** branch and folder selection |
| CSS styles missing on live site | Absolute paths used in `<link>` tags | Change to relative paths (e.g., `css/styles.css`) |
| JavaScript errors in console | File not found (404) or syntax error | Check the Network tab for failed requests; run `npm run test:scripts` |
| Changes not appearing after push | GitHub Pages cache | Wait 2–3 minutes and hard-refresh (Ctrl+Shift+R) |
| Automated monitor reports broken links | Page removed or renamed without redirect | Restore the file or add a redirect in a 404 page |
