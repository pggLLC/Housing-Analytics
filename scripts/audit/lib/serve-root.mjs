/**
 * A minimal static server over a directory, like GitHub Pages serves this
 * repository. Used by the browser audits so pages load their data the way a
 * visitor's browser does.
 *
 * Opening pages as file:// URLs looks equivalent and is not: every fetch() of
 * a data file fails, so maps, tables and charts never render and an audit
 * inspects an empty shell. The axe audit reported 0 violations on
 * hna-what-housing-exists.html from April to October 2026 that way, while the
 * live page drew 926 map markers with no accessible name.
 *
 * Port 0 lets the OS choose a free port, so an audit never collides with a
 * preview server already listening on 8765.
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/geo+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.csv': 'text/csv', '.txt': 'text/plain', '.xml': 'application/xml',
  '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json',
};

/** Resolves to { origin, close() }. */
export function serveRoot(root) {
  const base = path.resolve(root);
  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.resolve(base, '.' + rel);
      if (!file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}
