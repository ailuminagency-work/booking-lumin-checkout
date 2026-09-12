process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
const cache = path.resolve('.cache/mode-owner-playwright');
if (path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH ?? '') !== cache || !fs.existsSync(cache)) throw Error('DOCUMENT_BROWSER_CACHE_REQUIRED');
export default defineConfig({ testDir: './tests/mode-document', testMatch: 'document.spec.ts', fullyParallel: false, workers: 1, retries: 0, forbidOnly: true, maxFailures: 1, timeout: 60000, globalTimeout: 600000, expect: { timeout: 5000 }, reporter: [['./tests/mode-document/safe-reporter.ts']], outputDir: '.cache/mode-document-framework-private', use: { headless: true, serviceWorkers: 'block', trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 10000, navigationTimeout: 10000, ignoreHTTPSErrors: false }, projects: [{ name: 'local-document-chromium' }] });
