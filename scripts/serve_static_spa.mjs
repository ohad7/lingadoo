#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const args = {
    host: '127.0.0.1',
    port: 8766,
    root: path.resolve(process.cwd(), 'dist'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--host' && next) {
      args.host = next;
      index += 1;
    } else if (arg === '--port' && next) {
      args.port = Number(next);
      index += 1;
    } else if (arg === '--root' && next) {
      args.root = path.resolve(next);
      index += 1;
    }
  }
  return args;
}

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function contentTypeFor(filePath) {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

function resolveRequestPath(root, requestUrl) {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);
  const normalized = pathname === '/' ? '/index.html' : pathname;
  const candidate = path.resolve(root, `.${normalized}`);
  if (!candidate.startsWith(root)) {
    return null;
  }
  return candidate;
}

async function statSafe(filePath) {
  try {
    return await fs.promises.stat(filePath);
  } catch {
    return null;
  }
}

async function main() {
  const { host, port, root } = parseArgs(process.argv.slice(2));
  const rootStat = await statSafe(root);
  if (!rootStat?.isDirectory()) {
    throw new Error(`Static root does not exist: ${root}`);
  }
  const indexPath = path.join(root, 'index.html');
  const indexStat = await statSafe(indexPath);
  if (!indexStat?.isFile()) {
    throw new Error(`Missing index.html under static root: ${indexPath}`);
  }

  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad Request');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' }, 'Method Not Allowed');
      return;
    }

    const candidatePath = resolveRequestPath(root, req.url);
    if (!candidatePath) {
      send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden');
      return;
    }

    let filePath = candidatePath;
    const candidateStat = await statSafe(candidatePath);
    if (!candidateStat?.isFile()) {
      filePath = indexPath;
    }

    const fileStat = await statSafe(filePath);
    if (!fileStat?.isFile()) {
      send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
      return;
    }

    const headers = {
      'Content-Type': contentTypeFor(filePath),
      'Cache-Control': 'no-cache',
      'Content-Length': String(fileStat.size),
    };

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Internal Server Error');
    });
    res.writeHead(200, headers);
    stream.pipe(res);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  console.log(`static_spa: http://${host}:${port}`);

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
