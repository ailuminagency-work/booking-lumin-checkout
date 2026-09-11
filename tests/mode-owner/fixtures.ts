import { test as base, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { startModeOwnerLocal } from '../../packages/action-api/server/mode-owner-local.js';
import { observer, world, endpoints, profile, boundedClose, type World } from '../../packages/action-api/server/mode-owner-journey-fixtures.js';
import { artifactDirectory } from './safe-reporter.js';
import type { Pool } from 'pg';
export { expect };
async function browserClose(task: () => Promise<unknown>) { let timer: ReturnType<typeof setTimeout> | undefined; try {
    await Promise.race([Promise.resolve().then(task), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('SAFE_BROWSER_CLOSE_DEADLINE')), 10000); })]);
}
finally {
    if (timer)
        clearTimeout(timer);
} }
// Product composition has its own ten-second bound; the shared eleven-second wrapper observes it with one second of test grace.
type Journey = {
    world: World;
    db: Pool;
    addresses: ReturnType<typeof endpoints>;
    screenshots: (page: Page, id: string) => Promise<void>;
    lastHttp: () => string;
    assertPrivacy: () => void;
};
export const test = base.extend<{
    journey: Journey;
}>({
    journey: async ({ browser, page }, use, testInfo) => {
        try {
            expect(browser.version()).toBe('153.0.8010.12');
            const require = createRequire(path.join(process.cwd(), "package.json")), runner = require('@playwright/test/package.json').version, core = require('playwright-core/package.json').version;
            expect(runner).toBe('1.63.0');
            expect(core).toBe('1.63.0');
            const candidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
            expect(candidate).toMatch(/^[0-9a-f]{40}$/);
            testInfo.annotations.push({ type: 'verified-runtime', description: JSON.stringify({ runner, core, browser: browser.version(), platform: process.platform, architecture: process.arch, candidate, sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', windowsHide: true }).trim().length > 0 }) });
            const addresses = endpoints(), db = await observer();
            const statuses = new Map<string, number>(), counts = new Map<string, number>(), failures = new Map<string, number>();
            let pageErrors = 0, reactCode = 0, publishInstallationActive = 0, maxInstallationActive = 0;
            let fixtureCredential = '', privacyFailed = false;
            const activeInstallations = new Set<import('@playwright/test').Request>();
            const requestStarted = (request: import('@playwright/test').Request) => {
                if (request.url().startsWith(addresses.owner + '/') || request.url().startsWith(addresses.draft + '/')) {
                    if(request.headers()['referer'] !== undefined || (fixtureCredential !== '' && request.url().includes(fixtureCredential))) privacyFailed = true;
                }
                if (request.url() === addresses.owner + '/api/local/mode-owner/installations') {
                    if (activeInstallations.size < 128) activeInstallations.add(request);
                    maxInstallationActive = Math.max(maxInstallationActive, activeInstallations.size);
                }
                if (request.url() === addresses.owner + '/api/local/mode-owner/publish') publishInstallationActive = activeInstallations.size;
            };
            const requestEnded = (request: import('@playwright/test').Request) => { activeInstallations.delete(request); };
            page.on('request', requestStarted);
            page.on('requestfinished', requestEnded);
            page.on('requestfailed', requestEnded);
            const pageError = (error: Error) => { pageErrors = Math.min(100, pageErrors + 1); const match = error.message.match(/Minified React error #([0-9]{1,4})/); if (match)
                reactCode = Number(match[1]); };
            page.on('pageerror', pageError);
            const observed = (response: any) => { try {
                const u = new URL(response.url());
                let name = '';
                if (u.origin === addresses.draft) {
                    if (u.pathname === '/api/services')
                        name = 'draft-services';
                    else if (u.pathname === '/api/flows')
                        name = 'draft-flows';
                    else if (u.pathname === '/api/configurable-flows')
                        name = 'draft-configurable';
                    else if (/^\/api\/flows\/[0-9a-f-]{36}\/draft$/.test(u.pathname))
                        name = 'draft-standard';
                    else if (/^\/api\/configurable-flows\/[0-9a-f-]{36}\/draft$/.test(u.pathname))
                        name = 'draft-v2';
                }
                else if (u.origin === addresses.owner) {
                    const candidate = u.pathname.replace('/api/local/mode-owner/', '');
                    if (['profile', 'request-history', 'publish', 'install', 'installations', 'operation', 'installation-history', 'apply-version', 'update-policy'].includes(candidate))
                        name = 'owner-' + candidate;
                }
                const status = response.status();
                if (name && Number.isInteger(status) && status >= 100 && status <= 599) {
                    statuses.set(name, status);
                    counts.set(name, Math.min(100, (counts.get(name) ?? 0) + 1));
                            if(status>=400&&failures.size<40)failures.set(name+'-'+status,Math.min(100,(failures.get(name+'-'+status)??0)+1));
                }
            }
            catch { } };
            page.on('response', observed);
            let local: Awaited<ReturnType<typeof startModeOwnerLocal>> | undefined, server: http.Server | undefined;
            try {
                const w = await world(db, testInfo.title.includes('v2'));
                fixtureCredential=w.credential;
                local = await startModeOwnerLocal({ profiles: [profile], credentials: w.credentials, localPortalOrigin: addresses.portal });
                const root = await fs.realpath(path.resolve('apps/portal/dist'));
                await fs.access(path.join(root, 'index.html'));
                server = http.createServer(async (req, res) => { try {
                    const u = new URL(req.url ?? '/', addresses.portal);
                    if (req.method !== 'GET' || u.origin !== addresses.portal || u.pathname.includes('..') || u.pathname.includes('%')) {
                        res.writeHead(400);
                        res.end();
                        return;
                    }
                    const file = path.resolve(root, '.' + (u.pathname === '/' ? '/index.html' : u.pathname));
                    if (path.relative(root, file).startsWith('..'))
                        throw Error();
                    let content: Buffer, chosen = file;
                    try {
                        content = await fs.readFile(file);
                    }
                    catch {
                        if (path.extname(u.pathname))
                            throw Error();
                        chosen = path.join(root, 'index.html');
                        content = await fs.readFile(chosen);
                    }
                    const mime = chosen.endsWith('.js') ? 'text/javascript' : chosen.endsWith('.css') ? 'text/css' : chosen.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
                    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
                    res.end(content);
                }
                catch {
                    res.writeHead(404);
                    res.end();
                } });
                server.headersTimeout = 2000;
                server.requestTimeout = 15000;
                await new Promise<void>((resolve, reject) => { server!.once('error', () => reject(Error('PORTAL_BIND_FAILED'))); server!.listen(Number(new URL(addresses.portal).port), '127.0.0.1', resolve); });
                await use({ world: w, db, addresses, assertPrivacy: () => { expect(privacyFailed).toBe(false); }, lastHttp: () => [...statuses].map(([k, v]) => k + '-' + v + '-count' + counts.get(k)).join('_') + '_publish-install-active-' + publishInstallationActive + '_max-install-active-' + maxInstallationActive + '_page-errors-' + pageErrors + '_react-' + reactCode + '_failures-' + ([...failures].map(([k,v])=>k+'-count'+v).join('_')||'none'), screenshots: async (page, id) => { expect(id).toMatch(/^owner-\d{2}$/); for (const [width, height] of [[320, 740], [768, 1024], [1440, 900]]) {
                        await page.setViewportSize({ width: width!, height: height! });
                        await expect(page.locator('body')).toBeVisible();
                        await page.getByRole('heading',{name:'Installations',exact:true}).evaluate(element=>element.scrollIntoView({block:'start'}));
                        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
                        const png = await page.screenshot({ fullPage: false, mask: [page.locator('input'), page.locator('details')], animations: 'disabled' });
                            expect(png.length).toBeLessThanOrEqual(5 * 1024 * 1024);
                            await fs.writeFile(path.join(artifactDirectory(), `${id}-${width}.png`), png, { flag: 'wx' });
                    } } });
            }
            catch {
                throw Error('SAFE_BROWSER_FIXTURE_FAILED');
            }
            finally {
                page.removeListener('response', observed);
                page.removeListener('request', requestStarted); page.removeListener('requestfinished', requestEnded); page.removeListener('requestfailed', requestEnded); activeInstallations.clear(); page.removeListener('pageerror', pageError);
                const cleanup = await Promise.allSettled([local ? boundedClose(() => local!.close()) : Promise.resolve(), server ? browserClose(() => new Promise<void>(resolve => { server!.close(() => resolve()); server!.closeAllConnections(); })) : Promise.resolve(), boundedClose(() => db.end())]);
                if (cleanup.some(r => r.status === 'rejected'))
                    throw Error('SAFE_BROWSER_CLEANUP_FAILED');
            }
        }
        catch {
            throw Error('SAFE_BROWSER_FIXTURE_FAILED');
        }
    },
    context: async ({ browser }, use) => {
        try {
            const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
            const allowed = new Set(Object.values(endpoints())), violations: string[] = [];
            let closing = false;
            try {
                await context.route('**/*', async (route) => { try {
                    let origin = '';
                    try {
                        origin = new URL(route.request().url()).origin;
                    }
                    catch { }
                    if (!allowed.has(origin)) {
                        if (violations.length < 16)
                            violations.push('EXTERNAL_REQUEST');
                        await route.abort('blockedbyclient');
                        return;
                    }
                    await route.continue();
                }
                catch {
                    if (!closing && violations.length < 16)
                        violations.push('ROUTE_FAILURE');
                    await route.abort('failed').catch(() => { });
                } });
                await context.routeWebSocket('**/*', socket => { if (violations.length < 16)
                    violations.push('UNEXPECTED_WEBSOCKET'); socket.close(); });
                await use(context);
                expect(violations).toEqual([]);
            }
            catch {
                throw Error('SAFE_BROWSER_CONTEXT_FAILED');
            }
            finally {
                closing = true;
                try {
                    await browserClose(() => context.close());
                }
                catch {
                    throw Error('SAFE_BROWSER_CONTEXT_CLEANUP_FAILED');
                }
            }
        }
        catch {
            throw Error('SAFE_BROWSER_CONTEXT_FAILED');
        }
    }
});
export async function login(page: Page, j: Journey, checkpoint: (phase: string) => void = () => { }) { checkpoint('navigate'); await page.goto(j.addresses.portal); const credential = page.getByLabel('Local test credential', { exact: true }), business = page.getByLabel('Business ID', { exact: true }), open = page.getByRole('button', { name: 'Open business', exact: true }); checkpoint('credential'); await credential.focus(); await expect(credential).toBeFocused(); await credential.fill(j.world.credential); checkpoint('tab-business'); await page.keyboard.press('Tab'); await expect(business).toBeFocused(); await business.fill(j.world.f.tenant); checkpoint('tab-open'); await page.keyboard.press('Tab'); await expect(open).toBeFocused(); checkpoint('authenticate'); await page.keyboard.press('Enter'); await expect(page.getByRole('button', { name: 'Sign out / change business', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Local installation setup', exact: true })).toBeVisible(); }

export async function uiFlags(page:Page):Promise<string>{try{const publish=page.getByRole('button',{name:/^Publish.*saved version$/}),present=await publish.count();const flags=present===1?await publish.evaluate(element=>({own:(element as HTMLButtonElement).disabled,fieldset:!!element.closest('fieldset')?.disabled}),undefined,{timeout:1000}):{own:false,fieldset:false};return 'ui-pending'+Number(await page.getByRole('button',{name:'Check previous change',exact:true}).count()>0)+'-unavailable'+Number(await page.getByText('Current settings unavailable. Refresh before making a change.',{exact:true}).count()>0)+'-unsaved'+Number(await page.getByText(/Unsaved changes/).count()>0)+'-publish'+Number(present===1)+'-own'+Number(flags.own)+'-fieldset'+Number(flags.fieldset);}catch{return 'ui-unavailable';}}
