#!/usr/bin/env node
/**
 * Repo-wide link audit.
 *
 * Scans text-like files across the repository for:
 *   - external http(s) URLs
 *   - local HTML href/src/action/poster attributes
 *   - Markdown links/images
 *
 * The built-in url-health sweep intentionally monitors a curated subset.
 * This script is broader and audit-oriented: it records sources, classifies
 * template/dev/vendor noise, validates local file targets, and can probe
 * unique external URLs with HEAD/GET fallback.
 */

import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'data', 'reports');
const OUT_JSON = path.join(OUT_DIR, 'repo-link-audit.json');

const NOW = new Date().toISOString();
const TIMEOUT_MS = 12_000;
const CONCURRENT = 10;

const args = new Set(process.argv.slice(2));
const DO_PROBE = args.has('--probe');
const WRITE = !args.has('--dry-run');

const SKIP_DIRS = new Set([
  '.git',
  '.agents',
  '.codex',
  'node_modules',
  'audit-report',
  'outputs',
]);

const SKIP_FILE_RE = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)data\/url-health\.json$/,
  /(^|\/)data\/jurisdiction-briefs\/_liveness\.json$/,
  /(^|\/)data\/reports\/repo-link-audit\.json$/,
  /(^|\/)docs\/GENERATED-INVENTORY\.md$/,
];

const TEXT_EXT = new Set([
  '.cjs', '.css', '.csv', '.html', '.js', '.json', '.jsx', '.md', '.mjs',
  '.py', '.sh', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yml',
  '.yaml',
]);

const LOCAL_ATTR_RE = /\b(?:href|src|action|poster)\s*=\s*(["'])(.*?)\1/gi;
const MD_LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const HTTP_RE = /https?:\/\/[^\s"'`<>)\]]+/g;

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function isTextFile(file) {
  const ext = path.extname(file).toLowerCase();
  return TEXT_EXT.has(ext);
}

function shouldSkipFile(file) {
  const r = rel(file);
  return SKIP_FILE_RE.some((rx) => rx.test(r));
}

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      await walk(p, out);
    } else if (ent.isFile() && isTextFile(p) && !shouldSkipFile(p)) {
      out.push(p);
    }
  }
  return out;
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

function trimUrl(raw) {
  return String(raw || '')
    .trim()
    .replace(/[),.;]+$/g, '')
    .replace(/&amp;/g, '&');
}

function normalizeExternal(raw) {
  const url = trimUrl(raw);
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

function isExternal(s) {
  return /^https?:\/\//i.test(s);
}

function skipReason(link, fileRel) {
  if (!link) return 'empty';
  if (/\s|<|>/.test(link)) return 'dynamic or escaped HTML fragment';
  if (/^#/i.test(link)) return 'same-page-anchor';
  if (/^(mailto|tel|data|javascript):/i.test(link)) return 'non-file scheme';
  if (/^\s*(\$\{|`|\+|' \+|" \+)/.test(link)) return 'dynamic template expression';
  if (/\$\{|<%|%\>|{{|}}/.test(link)) return 'dynamic template expression';
  if (/\{[a-z_][a-z0-9_-]*\}/i.test(link)) return 'URL template placeholder';
  if (/^(https?:)?\/\//i.test(link)) return 'external';
  if (fileRel.startsWith('places/_template.html')) return 'place-page template';
  return null;
}

function resolveLocal(link, file) {
  const clean = link.split('#')[0].split('?')[0];
  if (!clean) return null;
  const base = clean.startsWith('/')
    ? path.join(ROOT, clean.replace(/^\/+/, ''))
    : path.resolve(path.dirname(file), clean);
  return base;
}

function classifyLocal(link, file, src, index) {
  const fileRel = rel(file);
  const reason = skipReason(link, fileRel);
  const record = {
    file: fileRel,
    line: lineOf(src, index),
    link,
    status: 'unknown',
    reason: '',
    resolved: null,
  };
  if (reason) {
    record.status = 'skipped';
    record.reason = reason;
    return record;
  }
  const target = resolveLocal(link, file);
  if (!target) {
    record.status = 'skipped';
    record.reason = 'anchor-only after query/hash removal';
    return record;
  }
  record.resolved = rel(target);
  try {
    if (fss.existsSync(target) && fss.statSync(target).isDirectory()) {
      const idx = path.join(target, 'index.html');
      record.resolved = rel(idx);
      if (/\.md$/i.test(file)) {
        record.status = 'ok';
        record.reason = 'directory link from Markdown';
      } else if (fss.existsSync(idx) && fss.statSync(idx).isFile()) {
        record.status = 'ok';
      } else {
        record.status = 'missing';
        record.reason = 'directory without index.html';
      }
      return record;
    }
    if (fss.existsSync(target) && fss.statSync(target).isFile()) {
      record.status = 'ok';
    } else if (fileRel.startsWith('archive/')) {
      record.status = 'archived-missing';
      record.reason = 'archived page has root-page-relative asset/link';
    } else {
      record.status = 'missing';
      record.reason = 'missing file';
    }
  } catch (err) {
    record.status = 'missing';
    record.reason = String(err).slice(0, 120);
  }
  return record;
}

function addExternal(map, url, source) {
  const normalized = normalizeExternal(url);
  if (!normalized || !/^https?:\/\//i.test(normalized)) return;
  if (!map.has(normalized)) {
    map.set(normalized, { url: normalized, sources: [], status: 'not-probed' });
  }
  const entry = map.get(normalized);
  if (entry.sources.length < 25) entry.sources.push(source);
}

function externalSkipReason(url) {
  if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(url)) return 'localhost/dev URL';
  if (/^https?:\/\/(?:…)?$/i.test(url)) return 'incomplete placeholder URL';
  if (/\$\{|{{|}}|\{[a-z_][a-z0-9_-]*\}|%7B|%7D|%E2%80%A6|YOUR_|your_|custom-domain\.com/i.test(url)) return 'template/dev placeholder';
  if (/\bexample\.(com|org|net)\b/i.test(url)) return 'example domain';
  if (/^https?:\/\/[ab]\.com\/?$/i.test(url)) return 'test fixture domain';
  if (/^https?:\/\/api\.github\.com\/repos\/pggLLC\/Housing-Analytics\/actions\/workflows\/[^/]+\/dispatches$/i.test(url)) return 'GitHub Actions POST-only API reference';
  if (/^https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)\//i.test(url)) return 'third-party static CDN';
  if (/^https?:\/\/(?:api\.stlouisfed\.org|api\.bls\.gov|api\.census\.gov)\//i.test(url) && (!url.includes('?') || /api_key=(test|YOUR_KEY)/i.test(url))) return 'API endpoint reference without usable parameters';
  return null;
}

async function probeExternal(entry) {
  const reason = externalSkipReason(entry.url);
  if (reason) return { ...entry, status: 'skipped', reason };

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const headers = {
    'User-Agent': 'COHO-repo-link-audit/1.0 (+github.com/pggLLC/Housing-Analytics)',
    'Accept': '*/*',
  };
  try {
    let res;
    try {
      res = await fetch(entry.url, { method: 'HEAD', redirect: 'follow', headers, signal: ac.signal });
      if ([401, 403, 405].includes(res.status)) {
        res = await fetch(entry.url, {
          method: 'GET',
          redirect: 'follow',
          headers: { ...headers, Range: 'bytes=0-0' },
          signal: ac.signal,
        });
      }
    } catch {
      res = await fetch(entry.url, {
        method: 'GET',
        redirect: 'follow',
        headers: { ...headers, Range: 'bytes=0-0' },
        signal: ac.signal,
      });
    }
    clearTimeout(timeout);
    const finalUrl = res.url && normalizeExternal(res.url) !== entry.url ? normalizeExternal(res.url) : null;
    if (res.ok) return { ...entry, status: 'ok', httpStatus: res.status, finalUrl };
    if ([401, 403].includes(res.status)) return { ...entry, status: 'auth', httpStatus: res.status, finalUrl };
    if (res.status >= 400 && res.status < 500) return { ...entry, status: 'client_error', httpStatus: res.status, finalUrl };
    if (res.status >= 500) return { ...entry, status: 'server_error', httpStatus: res.status, finalUrl };
    return { ...entry, status: 'other', httpStatus: res.status, finalUrl };
  } catch (err) {
    clearTimeout(timeout);
    const msg = String(err && err.message ? err.message : err);
    if (err && err.name === 'AbortError') return { ...entry, status: 'timeout', error: 'timeout' };
    if (/ENOTFOUND|getaddrinfo|dns/i.test(msg)) return { ...entry, status: 'dns_failure', error: msg.slice(0, 160) };
    return { ...entry, status: 'other', error: msg.slice(0, 160) };
  }
}

async function probeAll(entries) {
  const results = new Array(entries.length);
  let index = 0;
  async function worker() {
    while (index < entries.length) {
      const i = index++;
      results[i] = await probeExternal(entries[i]);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENT }, worker));
  return results;
}

async function main() {
  const files = await walk(ROOT);
  const externalMap = new Map();
  const localLinks = [];
  const errors = [];

  for (const file of files) {
    let src;
    try {
      src = await fs.readFile(file, 'utf8');
    } catch (err) {
      errors.push({ file: rel(file), error: String(err).slice(0, 120) });
      continue;
    }

    let match;
    while ((match = HTTP_RE.exec(src)) !== null) {
      addExternal(externalMap, match[0], { file: rel(file), line: lineOf(src, match.index), kind: 'text-url' });
    }

    if (/\.(html|svg)$/i.test(file)) {
      const localScanSrc = src
        .replace(/<script\b[\s\S]*?<\/script>/gi, '')
        .replace(/<pre\b[\s\S]*?<\/pre>/gi, '')
        .replace(/<code\b[\s\S]*?<\/code>/gi, '');
      while ((match = LOCAL_ATTR_RE.exec(localScanSrc)) !== null) {
        const link = trimUrl(match[2]);
        if (isExternal(link)) {
          addExternal(externalMap, link, { file: rel(file), line: lineOf(src, match.index), kind: 'html-attr' });
        } else {
          localLinks.push(classifyLocal(link, file, localScanSrc, match.index));
        }
      }
    }

    if (/\.md$/i.test(file)) {
      while ((match = MD_LINK_RE.exec(src)) !== null) {
        const link = trimUrl(match[1]);
        if (isExternal(link)) {
          addExternal(externalMap, link, { file: rel(file), line: lineOf(src, match.index), kind: 'markdown-link' });
        } else {
          localLinks.push(classifyLocal(link, file, src, match.index));
        }
      }
    }
  }

  const externalEntries = [...externalMap.values()].sort((a, b) => a.url.localeCompare(b.url));
  const external = DO_PROBE ? await probeAll(externalEntries) : externalEntries;

  const localBreakdown = localLinks.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const externalBreakdown = external.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const report = {
    generatedAt: NOW,
    probeExternal: DO_PROBE,
    filesScanned: files.length,
    localLinkCount: localLinks.length,
    externalUrlCount: external.length,
    summary: {
      local: localBreakdown,
      external: externalBreakdown,
      readErrors: errors.length,
    },
    local: {
      missing: localLinks.filter((r) => r.status === 'missing'),
      archivedMissing: localLinks.filter((r) => r.status === 'archived-missing'),
      skipped: localLinks.filter((r) => r.status === 'skipped'),
    },
    external: {
      failures: external.filter((r) => !['ok', 'auth', 'skipped', 'not-probed'].includes(r.status)),
      auth: external.filter((r) => r.status === 'auth'),
      skipped: external.filter((r) => r.status === 'skipped'),
      all: external,
    },
    readErrors: errors,
  };

  if (WRITE) {
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.writeFile(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    generatedAt: report.generatedAt,
    filesScanned: report.filesScanned,
    localLinkCount: report.localLinkCount,
    externalUrlCount: report.externalUrlCount,
    summary: report.summary,
    reportPath: WRITE ? rel(OUT_JSON) : null,
  }, null, 2));
}

main().catch((err) => {
  console.error('[repo-link-audit] FATAL:', err);
  process.exit(2);
});
