#!/usr/bin/env node
// Regression guard for #1232 PR A: PMA display renders actual included
// tract polygons, not a centroid convex hull.

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const sourcePath = path.join(ROOT, 'data/market/tract_boundaries_co.geojson');
const displayPath = path.join(ROOT, 'data/market/pma_tract_display_geometry.geojson');
const modulePath = path.join(ROOT, 'js/pma-delineation.js');
const scriptPath = path.join(ROOT, 'scripts/market-analysis/build_pma_tract_display_geometry.mjs');

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function geoidOf(feature) {
  const p = feature && feature.properties;
  return p && (p.GEOID || p.geoid || p.GEOID20 || p.tract_geoid);
}

function makeFakeLeaflet() {
  return {
    circle(latlng, options) {
      return {
        type: 'circle',
        latlng,
        options,
        addTo(map) {
          map.layers.push(this);
          return this;
        },
        bindTooltip(html) {
          this.tooltip = html;
          return this;
        }
      };
    },
    geoJSON(featureCollection, options) {
      const styles = (featureCollection.features || []).map((feature) => (
        typeof options.style === 'function' ? options.style(feature) : options.style
      ));
      return {
        type: 'geoJSON',
        featureCollection,
        options,
        styles,
        addTo(map) {
          map.layers.push(this);
          return this;
        },
        bindTooltip(html) {
          this.tooltip = html;
          return this;
        }
      };
    }
  };
}

async function main() {
  const source = readJson(sourcePath);
  const display = readJson(displayPath);

  assert.equal(display.type, 'FeatureCollection', 'display geometry is GeoJSON FeatureCollection');
  assert.equal(display.meta.source, 'data/market/tract_boundaries_co.geojson', 'display geometry records canonical source');
  assert.equal(display.meta.generated_by, 'scripts/market-analysis/build_pma_tract_display_geometry.mjs', 'display geometry records generator');
  assert.equal(
    display.meta.source_sha256,
    crypto.createHash('sha256').update(fs.readFileSync(sourcePath, 'utf8')).digest('hex'),
    'display geometry records the source boundary hash used to build it'
  );
  assert(display.features.length >= 1000, 'display geometry contains Colorado tract-scale feature count');
  assert.equal(display.features.length, source.features.length, 'display geometry has one feature per canonical tract');
  assert(fs.statSync(displayPath).size < fs.statSync(sourcePath).size / 8, 'display geometry is materially smaller than canonical tract GeoJSON');

  const sourceGeoids = new Set(source.features.map(geoidOf).filter(Boolean));
  const displayGeoids = new Set(display.features.map(geoidOf).filter(Boolean));
  assert.equal(displayGeoids.size, sourceGeoids.size, 'display geometry GEOID set size matches source');
  for (const geoid of sourceGeoids) {
    assert(displayGeoids.has(geoid), `display geometry includes source tract ${geoid}`);
  }

  const sourceText = fs.readFileSync(modulePath, 'utf8');
  assert(!sourceText.includes('convex hull'), 'pma-delineation no longer describes a convex hull PMA display');
  assert(!sourceText.includes('_convexHull'), 'pma-delineation no longer carries a convex-hull helper');
  assert(sourceText.includes('pma_tract_display_geometry.geojson'), 'pma-delineation lazy-loads the lightweight tract display artifact');
  assert(sourceText.includes('_featureCollectionForTracts'), 'pma-delineation builds a tract FeatureCollection');

  const generatorText = fs.readFileSync(scriptPath, 'utf8');
  assert(generatorText.includes('tract_boundaries_co.geojson'), 'generator reads canonical tract boundaries');
  assert(generatorText.includes('pma_tract_display_geometry.geojson'), 'generator writes lightweight display geometry');

  const included = [
    { geoid: '08059011601', _bufferShare: 1 },
    { geoid: '08001007801', _bufferShare: 0.5 },
    { geoid: '08031004006', _bufferShare: 0.12 }
  ];
  const expectedGeoids = included.map((tract) => tract.geoid).sort();

  const fakeMap = {
    layers: [],
    removed: [],
    removeLayer(layer) {
      this.removed.push(layer);
    }
  };

  global.window = {
    L: makeFakeLeaflet(),
    fetchWithBase(url) {
      assert.equal(url, 'data/market/pma_tract_display_geometry.geojson', 'render path fetches lightweight display geometry');
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(display)
      });
    }
  };

  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  assert(global.window.PMADelineation, 'PMADelineation is exposed on window');

  const rendered = await global.window.PMADelineation.renderPmaLayer(fakeMap, 39.74, -105.0, 5, included);
  assert(rendered, 'renderPmaLayer resolves rendered FeatureCollection');
  assert.equal(rendered.type, 'FeatureCollection', 'rendered PMA is a FeatureCollection');
  assert.deepEqual(
    rendered.features.map(geoidOf).sort(),
    expectedGeoids,
    'rendered tract set exactly matches included tract set'
  );

  const geoJsonLayers = fakeMap.layers.filter((layer) => layer.type === 'geoJSON');
  assert.equal(geoJsonLayers.length, 1, 'one tract display GeoJSON layer is added');
  assert.deepEqual(
    geoJsonLayers[0].featureCollection.features.map(geoidOf).sort(),
    expectedGeoids,
    'Leaflet layer receives the same included tract set'
  );
  assert(geoJsonLayers[0].styles.every((style) => style.weight === 0 && style.opacity === 0), 'tract display suppresses per-tract borders for visual dissolve');
  assert(geoJsonLayers[0].styles[0].fillOpacity > geoJsonLayers[0].styles[1].fillOpacity, 'higher buffer share has stronger fill opacity');
  assert(geoJsonLayers[0].styles[1].fillOpacity > geoJsonLayers[0].styles[2].fillOpacity, 'partial tract opacity remains proportional');
  assert(fakeMap.layers.some((layer) => layer.type === 'circle'), 'dashed buffer ring still renders');

  const droppedOne = rendered.features.slice(1).map(geoidOf).sort();
  assert.notDeepEqual(
    droppedOne,
    expectedGeoids,
    'non-vacuousness: dropping one included tract would fail the exact-set assertion'
  );

  console.log('pma-tract-display: all tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
