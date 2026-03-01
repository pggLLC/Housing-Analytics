/**
 * serve-static.mjs
 * Simple static HTTP server that serves the repo root like GitHub Pages.
 * Usage: node scripts/audit/serve-static.mjs [port] [host]
 * Defaults: port=8080, host=127.0.0.1
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const PORT = parseInt(process.env.PORT || process.argv[2] || '8080', 10);
const HOST = process.env.HOST || process.argv[3] || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain; charset=utf-8',
  '.xml':  'application/xml',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, urlPath);

  // Prevent path traversal outside repo root
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // Try appending .html
      const withHtml = filePath.endsWith('.html') ? null : filePath + '.html';
      if (withHtml) {
        fs.stat(withHtml, (err2, stat2) => {
          if (!err2 && stat2.isFile()) {
            serveFile(withHtml, res);
          } else {
            res.writeHead(404);
            res.end('Not found: ' + urlPath);
          }
        });
      } else {
        res.writeHead(404);
        res.end('Not found: ' + urlPath);
      }
      return;
    }
    serveFile(filePath, res);
  });
});

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  stream.pipe(res);
  stream.on('error', () => {
    res.end();
  });
}

server.listen(PORT, HOST, () => {
  console.log(`Static server running at http://${HOST}:${PORT}/`);
  console.log(`Serving from: ${ROOT}`);
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});
