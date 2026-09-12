process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
const cache = path.resolve('.cache/mode-runtime-playwright');
if (path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH ?? '') !== cache || !fs.existsSync(cache)) throw Error('RUNTIME_BROWSER_CACHE_REQUIRED');
export default defineConfig({
  testDir: './tests/mode-runtime', testMatch: 'runtime.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true, maxFailures: 0,
  timeout: 90000, globalTimeout: 900000, expect: { timeout: 5000 },
  reporter: [['./tests/mode-runtime/safe-reporter.ts']],
  outputDir: '.cache/mode-runtime-framework-private',
  use: { headless: false, serviceWorkers: 'block', trace: 'off', video: 'off', screenshot: 'off',
    actionTimeout: 10000, navigationTimeout: 10000, ignoreHTTPSErrors: false },
  projects: [{ name: 'local-runtime-headed-chromium' }],
});
