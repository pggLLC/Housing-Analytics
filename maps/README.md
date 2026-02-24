# Maps Directory

This directory contains GeoJSON files used by the site's map visualizations.

## Files

- **us-states.geojson** — US state boundaries for the national allocation map.
  Fetch with the GitHub Actions workflow or download from a public source such as
  https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json
  and save as `maps/us-states.geojson`.

## Usage

All map assets should be referenced via `DataService.baseMaps("filename.geojson")`
which resolves the correct path regardless of deployment sub-path.
