#!/usr/bin/env node
/**
 * Local convenience wrapper for the rendered mobile overflow smoke.
 *
 * CI enforcement lives in .github/workflows/site-audit.yml, where Chromium is
 * installed explicitly before running core-rendered-smoke.mjs. The default
 * ci-checks chain intentionally avoids browser installation, so this npm
 * wrapper skips loudly when a local Playwright browser binary is missing.
 */

import fs from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const smokeScript = path.join(__dirname, 'core-rendered-smoke.mjs');

let executablePath = '';
try {
  executablePath = chromium.executablePath();
} catch (_) {
  executablePath = '';
}

if (!executablePath || !fs.existsSync(executablePath)) {
  console.warn('SKIPPED — enforced in site-audit workflow: Playwright Chromium browser binary is not installed for this npm script.');
  console.warn('Run `npx playwright install chromium --with-deps` locally to execute the rendered mobile overflow smoke outside GitHub Actions.');
  process.exit(0);
}

const result = spawnSync(process.execPath, [smokeScript], {
  cwd: path.resolve(__dirname, '..', '..'),
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status == null ? 1 : result.status);
