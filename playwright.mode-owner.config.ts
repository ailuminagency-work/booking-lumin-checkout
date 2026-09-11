process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
process.env.MODE_OWNER_ARTIFACT_RUN_ID ??= randomUUID();
const root = process.cwd(), cache = path.resolve(root, '.cache/mode-owner-playwright');
if (path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH ?? '') !== cache)
    throw Error('BROWSER_CACHE_NOT_SCOPED');
if (!fs.existsSync(cache))
    throw Error('PINNED_BROWSER_NOT_INSTALLED');
export default defineConfig({ testDir: './tests/mode-owner', testMatch: 'owner-journey.spec.ts', fullyParallel: false, workers: 1, retries: 0, forbidOnly: true, maxFailures: 1, timeout: 60000, globalTimeout: 600000, expect: { timeout: 5000 }, reporter: [['./tests/mode-owner/safe-reporter.ts']], outputDir: '.cache/mode-owner-framework-private', use: { browserName: 'chromium', headless: true, serviceWorkers: 'block', trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 10000, navigationTimeout: 15000, ignoreHTTPSErrors: false }, projects: [{ name: 'local-owner-chromium' }] });
