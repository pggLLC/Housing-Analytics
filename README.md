# Affordable Housing / LIHTC Analytics Hub

Static GitHub Pages site + automated data refresh for FRED.

## Automated data refresh
The workflow `.github/workflows/fetch-fred-data.yml` runs daily and writes:
- `data/fred-data.json`

It requires a repo secret:
- `FRED_API_KEY`

## Quick start (local)
Run a local server from the repo root:
```bash
python3 -m http.server 8000
```
Then open `http://localhost:8000/`.

## Deploy via GitHub Web Upload
See **DEPLOYMENT_WEB.md** for step-by-step GitHub web interface deployment (Pages + Secrets + Actions).


### Data refresh workflows
- **Fetch FRED Data** → updates `data/fred-data.json`
- **Fetch Census ACS Data** → updates `data/census-acs-state.json`
