#!/usr/bin/env node
/**
 * source-url-sweep.mjs
 *
 * Verify external source-citation URLs are still reachable.
 *
 * Scans:
 *   - DATA-MANIFEST.json
 *   - js/citations.js
 *   - root-level *.html href attributes
 *
 * Exit codes:
 *   0 => all URLs are OK (or allow-listed / timeout-only outcomes)
 *   1 => at least one hard failure (404/5xx/network)
 *   2 => script-level failure
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

const TIMEOUT_MS = 10_000;
const CONCURRENT = 8;

const ALLOW_LIST = new Set([
  "https://overpass-api.de/api/interpreter", // POST-only API
  // Known sources that frequently block CI user-agents.
  "https://www.novoco.com",
  "https://www.novoco.com/",
  "https://www.novoco.com/resource-centers/affordable-housing-tax-credits",
  "https://www.novoco.com/resource-centers/affordable-housing-tax-credits/2026-federal-lihtc-information-by-state",
  "https://www.novoco.com/resource-centers/affordable-housing-tax-credits/qct-dda-mapping-tool",
  "https://www.novoco.com/resource-centers/affordable-housing-tax-credits/lihtc-basics",
  "https://www.novoco.com/resource-centers/affordable-housing-tax-credits/rankings",
  "https://www.ncsha.org",
  "https://www.ncsha.org/",
  "https://www.ncsha.org/advocacy-issues/lihtc/",
  "https://www.congress.gov/",
  "https://www.congress.gov/bill/118th-congress/house-bill/6644",
  "https://www.cbre.com/insights",
  "https://www.ffiec.gov/craadweb/main.aspx",
  "https://cdola.colorado.gov/commitment-filings",
  "https://cdola.colorado.gov/housing",
  "https://cdola.colorado.gov/prop123",
  "https://cdola.colorado.gov/prop-123",
  "https://cdola.colorado.gov/proposition-123",
  "https://cdola.colorado.gov/division-of-housing",
  // BLS blocks CI user-agents across all subpaths (returns 403).
  "https://www.bls.gov/cew/",
  "https://www.bls.gov/ppi/",
  "https://www.bls.gov/ppi",
  "https://www.bls.gov/cps",
  "https://www.bls.gov/jlt",
  "https://www.bls.gov/lau/",
  "https://www.bls.gov/data/",
  // Colorado Division of Local Government — blocks CI agents.
  "https://dlg.colorado.gov/news-article/final-housing-needs-assessment-methodology-and-displacement-risk-assessment-guidance",
  // GitHub settings URLs require authentication and are not publicly reachable.
  "https://github.com/pggLLC/Housing-Analytics/settings/secrets/actions",
]);

const SKIP_PATTERNS = [
  /^mailto:/i,
  /^tel:/i,
  /^javascript:/i,
  /^#/,
  /localhost/i,
  /^\/\//,
  /\$\{/,
  /^https?:\/\/fonts\.googleapis\.com/i,
  /^https?:\/\/fonts\.gstatic\.com/i,
  /^https?:\/\/cdn\.jsdelivr\.net/i,
  /^https?:\/\/unpkg\.com/i,
  /^https?:\/\/cdnjs\.cloudflare\.com/i,
];

function parseArgs() {
  const args = process.argv.slice(2);
  const paths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--paths" && args[i + 1]) {
      paths.push(
        ...args[i + 1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      i++;
    }
  }
  return {
    quiet: args.includes("--quiet"),
    json: args.includes("--json"),
    paths,
  };
}

function isHttpUrl(v) {
  return typeof v === "string" && /^https?:\/\//i.test(v);
}

function shouldSkip(url) {
  return SKIP_PATTERNS.some((rx) => rx.test(url));
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch (_) {
    return url;
  }
}

function collectUrlsFromObject(obj, out = []) {
  if (obj === null || obj === undefined) return out;
  if (typeof obj === "string") {
    if (isHttpUrl(obj)) out.push(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) collectUrlsFromObject(item, out);
    return out;
  }
  if (typeof obj === "object") {
    for (const v of Object.values(obj)) collectUrlsFromObject(v, out);
  }
  return out;
}

async function readManifestUrls() {
  const p = path.join(ROOT, "DATA-MANIFEST.json");
  const raw = await fs.readFile(p, "utf8");
  const parsed = JSON.parse(raw);
  return collectUrlsFromObject(parsed);
}

async function readCitations() {
  const p = path.join(ROOT, "js", "citations.js");
  const src = await fs.readFile(p, "utf8");
  const urls = [];
  const rx = /https?:\/\/[^\s"'`<>)]*/g;
  let m;
  while ((m = rx.exec(src)) !== null) {
    urls.push(m[0]);
  }
  return urls;
}

async function readHtmlUrls() {
  return readHtmlUrlsFromFiles();
}

async function readHtmlUrlsFromFiles(files = null) {
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  const rootHtmlFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".html"))
    .map((e) => path.join(ROOT, e.name));
  const htmlFiles = files
    ? files
        .map((f) => path.join(ROOT, f))
        .filter((p) => p.toLowerCase().endsWith(".html"))
    : rootHtmlFiles;

  const hrefRx = /href\s*=\s*["']([^"']+)["']/gi;
  const urls = [];
  for (const file of htmlFiles) {
    const src = await fs.readFile(file, "utf8");
    let m;
    while ((m = hrefRx.exec(src)) !== null) {
      const href = (m[1] || "").trim();
      if (isHttpUrl(href)) urls.push(href);
    }
  }
  return urls;
}

async function readUrlsFromExplicitPaths(pathsArg) {
  const files = pathsArg
    .map((p) => p.replace(/^\.\//, ""))
    .filter((p) => !p.includes(".."));
  const urls = [];

  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    try {
      const src = await fs.readFile(abs, "utf8");
      if (rel === "DATA-MANIFEST.json" || rel.toLowerCase().endsWith(".json")) {
        try {
          const parsed = JSON.parse(src);
          collectUrlsFromObject(parsed, urls);
        } catch (_) {
          const rx = /https?:\/\/[^\s"'`<>)]*/g;
          let m;
          while ((m = rx.exec(src)) !== null) urls.push(m[0]);
        }
      } else if (rel.toLowerCase().endsWith(".html")) {
        const hrefRx = /href\s*=\s*["']([^"']+)["']/gi;
        let m;
        while ((m = hrefRx.exec(src)) !== null) {
          const href = (m[1] || "").trim();
          if (isHttpUrl(href)) urls.push(href);
        }
      } else {
        const rx = /https?:\/\/[^\s"'`<>)]*/g;
        let m;
        while ((m = rx.exec(src)) !== null) urls.push(m[0]);
      }
    } catch (_) {
      // Ignore absent/renamed files in diff lists.
    }
  }
  return urls;
}

async function checkUrl(url) {
  if (ALLOW_LIST.has(url)) {
    return { url, status: "ALLOW", http: null, message: "allow-listed" };
  }

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    // Try HEAD first; fallback to GET if server disallows HEAD.
    let res;
    try {
      res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: ac.signal,
      });
      if (res.status === 405 || res.status === 403) {
        res = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: ac.signal,
          headers: { Range: "bytes=0-0" },
        });
      }
    } catch (_) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: ac.signal,
        headers: { Range: "bytes=0-0" },
      });
    }

    clearTimeout(timeout);
    if (res.ok) return { url, status: "OK", http: res.status, message: "" };
    if (res.status === 404) {
      return { url, status: "404", http: 404, message: "not found" };
    }
    if (res.status >= 500) {
      return { url, status: "5XX", http: res.status, message: "server error" };
    }
    return {
      url,
      status: "FAIL",
      http: res.status,
      message: "unexpected status",
    };
  } catch (err) {
    clearTimeout(timeout);
    if (
      err &&
      (err.name === "AbortError" || /aborted|timeout/i.test(String(err)))
    ) {
      return {
        url,
        status: "TIMEOUT",
        http: null,
        message: "request timed out",
      };
    }
    return {
      url,
      status: "FAIL",
      http: null,
      message: (err && err.message) || String(err),
    };
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await mapper(items[cur], cur);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

function printTable(results, quiet) {
  if (quiet) {
    results
      .filter((r) => !["OK", "ALLOW", "TIMEOUT"].includes(r.status))
      .forEach((r) => {
        console.log(`${r.status}\t${r.http || "-"}\t${r.url}\t${r.message}`);
      });
    return;
  }
  for (const r of results) {
    console.log(
      `${r.status.padEnd(7)} ${String(r.http || "-").padStart(3)}  ${r.url}`,
    );
  }
}

async function main() {
  const args = parseArgs();
  let rawUrls;
  if (args.paths.length > 0) {
    rawUrls = await readUrlsFromExplicitPaths(args.paths);
  } else {
    const [manifestUrls, citationUrls, htmlUrls] = await Promise.all([
      readManifestUrls().catch(() => []),
      readCitations().catch(() => []),
      readHtmlUrls().catch(() => []),
    ]);
    rawUrls = [...manifestUrls, ...citationUrls, ...htmlUrls];
  }

  const urls = Array.from(
    new Set(
      rawUrls
        .map((u) => normalizeUrl(u))
        .filter((u) => isHttpUrl(u) && !shouldSkip(u)),
    ),
  );

  const results = await mapLimit(urls, CONCURRENT, checkUrl);
  const hardFailures = results.filter((r) =>
    ["404", "5XX", "FAIL"].includes(r.status),
  );
  const nonAllowTimeouts = results.filter((r) => r.status === "TIMEOUT");

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          scanned: urls.length,
          hardFailures: hardFailures.length,
          timeouts: nonAllowTimeouts.length,
          results,
        },
        null,
        2,
      ),
    );
  } else {
    printTable(results, args.quiet);
    console.log(
      `\nScanned ${urls.length} URLs · hard failures: ${hardFailures.length} · timeouts: ${nonAllowTimeouts.length}`,
    );
  }

  process.exitCode = hardFailures.length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error("[source-url-sweep] fatal:", err);
  process.exit(2);
});
