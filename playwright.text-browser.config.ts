import { defineConfig } from '@playwright/test';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const root = __dirname;
if (process.platform !== 'win32' || process.env.TEXT_BROWSER_APPROVED !== '1') throw Error('LOCAL_FIXTURE_NOT_APPROVED');
const manifest = JSON.parse(readFileSync(resolve(root, 'node_modules/playwright-core/browsers.json'), 'utf8'));
if (!manifest.browsers.some((entry: { name: string; revision: string }) => entry.name === 'chromium' && entry.revision === '1243')) throw Error('BROWSER_VERSION_MISMATCH');
const executablePath = resolve(root, '../mode-session-http/.cache/mode-runtime-playwright/chromium-1243/chrome-win64/chrome.exe');
if (!lstatSync(executablePath).isFile() || lstatSync(executablePath).isSymbolicLink() || realpathSync(executablePath).toLowerCase() !== executablePath.toLowerCase()) throw Error('BROWSER_PATH_INVALID');
export default defineConfig({
  testDir: './tests/text-browser', testMatch: 'navigation.spec.ts', workers: 1, fullyParallel: false, retries: 0, forbidOnly: true, maxFailures: 1,
  timeout: 30000, globalTimeout: 240000, expect: { timeout: 5000 }, reporter: [['./tests/text-browser/safe-reporter.ts']],
  outputDir: '.cache/text-browser-private',
  use: { baseURL: 'http://127.0.0.1:4189', browserName: 'chromium', headless: true, launchOptions: { executablePath }, serviceWorkers: 'block', trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 5000, navigationTimeout: 10000 },
  webServer: { command: 'node scripts/text-browser-server.mjs', url: 'http://127.0.0.1:4189/edit', timeout: 30000, reuseExistingServer: false, stdout: 'ignore', stderr: 'ignore' },
});
