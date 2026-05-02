import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

function getGitInfo(cwd: string) {
  const run = (cmd: string) => {
    try {
      return execSync(cmd, { cwd, encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };
  return {
    commit: run('git rev-parse --short HEAD'),
    branch: run('git branch --show-current'),
    dirty: (run('git status --porcelain') || '') !== '',
  };
}

function devLocalFiles(): Plugin {
  const repoRoot = __dirname;
  const appDir = __dirname;
  return {
    name: 'dev-local-files',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/__dev__/')) {
          return next();
        }

        // /__dev__/info — JSON with server identity
        if (req.url === '/__dev__/info') {
          const info = {
            cwd: appDir,
            repoRoot,
            git: getGitInfo(repoRoot),
            pid: process.pid,
            startedAt: new Date().toISOString(),
          };
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(info));
          return;
        }

        const relative = decodeURIComponent(req.url.slice('/__dev__/'.length));
        const absolute = path.resolve(repoRoot, relative);
        if (!absolute.startsWith(repoRoot)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
        if (!fs.existsSync(absolute)) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        const ext = path.extname(absolute).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.pdf': 'application/pdf',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
        };
        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
        fs.createReadStream(absolute).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), devLocalFiles()],
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
  },
});
