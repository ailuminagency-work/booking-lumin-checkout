import { test as base, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadTls, observer, seed, snapshot, startWorld, closeWithin, HOSTS, type TlsFixture, type World } from './fixtures';
import { artifactDirectory } from './safe-reporter';
import type { Pool } from 'pg';
type Journey = { db: Pool; w: World; tls: TlsFixture; local: Awaited<ReturnType<typeof startWorld>>; page: Page; context: BrowserContext; capture(name: string, width: number): Promise<void>; unchanged(): Promise<void>; };
const pngs = new Set(['document-01-1440.png', 'document-02-768.png', 'document-03-1440.png', 'document-08-320.png', 'document-08-768.png', 'document-08-1440.png']);
export const test = base.extend<{ journey: Journey }>({
  journey: async ({}, use, info) => {
    let browser: Browser | undefined, context: BrowserContext | undefined, db: Pool | undefined, local: Awaited<ReturnType<typeof startWorld>> | undefined;
    try {
      const t = await loadTls(); db = await observer(); const w = await seed(db, info.title.startsWith('document-08'));
      local = await startWorld(t); const before = await snapshot(db, w.f);
      browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors-spki-list=' + t.spki, '--host-resolver-rules=' + HOSTS.map(h => 'MAP ' + h + ' 127.0.0.1').join(', '), '--no-proxy-server'] });
      expect(browser.version()).toBe('153.0.8010.12'); context = await browser.newContext({ ignoreHTTPSErrors: false, serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
      let forbidden = false, requests = 0;
      context.on('request', req => { requests++; if (requests > 1000) forbidden = true; const u = new URL(req.url()); if (!HOSTS.includes(u.hostname as typeof HOSTS[number]) || /session|submit|booking|api\/local|token|credential/.test(u.pathname)) forbidden = true; const headers = req.headers(); if (headers.authorization !== undefined || headers.cookie !== undefined) forbidden = true; });
      const page = await context.newPage();
      await use({ db, w, tls: t, local, page, context, unchanged: async () => { expect(await snapshot(db!, w.f)).toEqual(before); }, capture: async (name, width) => {
        expect(pngs.has(name)).toBe(true); await page.setViewportSize({ width, height: width === 320 ? 740 : width === 768 ? 1024 : 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const png = await page.screenshot({ animations: 'disabled', fullPage: false }); expect(png.length).toBeLessThanOrEqual(5 * 1024 * 1024); await fs.writeFile(path.join(artifactDirectory(), name), png, { flag: 'wx' });
      } });
      expect(forbidden).toBe(false); expect(local.attempted.issuance).toBe(0);
    } catch { throw Error('SAFE_DOCUMENT_FIXTURE_FAILED'); }
    finally { await closeWithin([async () => { try { if (context) await context.close(); } finally { if (browser) await browser.close(); } }, ...(local ? [() => local!.close()] : []), ...(db ? [() => db!.end()] : [])]).catch(() => { throw Error('SAFE_DOCUMENT_CLEANUP_FAILED'); }); }
  },
});
export { expect };
