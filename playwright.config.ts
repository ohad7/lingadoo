import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = __dirname;

const host = '127.0.0.1';
const port = Number(process.env.LINGADOO_E2E_PORT || 8766);
const runId = process.env.LINGADOO_E2E_RUN_ID || `${Date.now()}-${process.pid}`;

const sharedArtifactsRoot = path.join(repoRoot, '.test-artifacts/e2e/shared/artifacts');
const runtimeRoot = path.join(repoRoot, `.test-artifacts/e2e/runs/${runId}/runtime`);
const reportRoot = path.join(repoRoot, '.test-artifacts/e2e/report');
const resultsRoot = path.join(repoRoot, `.test-artifacts/e2e/runs/${runId}/results`);
const startScript = path.join(__dirname, 'tests/e2e/scripts/start_e2e_server.sh');
const healthUrl = `http://${host}:${port}/`;

export default defineConfig({
  testDir: path.join(__dirname, 'tests/e2e'),
  timeout: 180_000,
  expect: {
    timeout: 30_000,
  },
  retries: process.env.CI ? 1 : 0,
  fullyParallel: false,
  outputDir: resultsRoot,
  reporter: [
    ['list'],
    ['html', { outputFolder: reportRoot, open: 'never' }],
  ],
  use: {
    baseURL: `http://${host}:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'on',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: {
    command: `bash "${startScript}"`,
    url: healthUrl,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      ...process.env,
      LINGADOO_E2E_HOST: host,
      LINGADOO_E2E_PORT: String(port),
      LINGADOO_E2E_ARTIFACTS_ROOT: sharedArtifactsRoot,
      LINGADOO_E2E_RUNTIME_ROOT: runtimeRoot,
    },
  },
});
