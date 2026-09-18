import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
interface Config { fixtureOrigin: string; apiUrl: string; tenantA: string; tenantB: string; flowA: string; flowB: string; ownerAToken: string; ownerBToken: string; staffToken: string }
interface Callbacks { inspectA(): Promise<{ definition: unknown; revision: number } | null>; advanceParentA(): Promise<number>; revokeOwnerA(): Promise<void> }
const question = (page: Page) => page.getByLabel('Question label', { exact: true });
async function load(page: Page) { await page.getByRole('button', { name: 'Load questions', exact: true }).click(); }
async function saved(page: Page) { await page.getByRole('button', { name: 'Save questions', exact: true }).click(); await expect(page.getByText('Questions saved as a draft.', { exact: true })).toBeVisible(); }
async function dialog(page: Page, accept: boolean, action: () => Promise<unknown>) {
  await Promise.all([page.waitForEvent('dialog', { timeout: 5000 }).then(async value => { if (value.type() !== 'confirm') { await value.dismiss(); throw Error('DIALOG'); } if (accept) await value.accept(); else await value.dismiss(); }), action()]);
}

/** Node-side SQL callbacks never enter page init data or browser endpoints. */
export async function runTextJourneyBrowserCases(browser: Browser, config: Config, callbacks: Callbacks): Promise<{ cases: number }> {
  if (config.fixtureOrigin !== 'http://127.0.0.1:4191' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(config.apiUrl)) throw Error('JOURNEY_CONFIG');
  const contexts: BrowserContext[] = []; let denied = 0, stage = 0;
  async function page() {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false }); contexts.push(context);
    context.setDefaultTimeout(5000); context.setDefaultNavigationTimeout(5000);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (![config.fixtureOrigin, config.apiUrl].includes(url.origin)) { denied++; await route.abort(); } else await route.continue();
    });
    await context.addInitScript(value => { Object.defineProperty(window, '__textJourney', { value, writable: false }); }, {
      apiUrl: config.apiUrl, tenantA: config.tenantA, tenantB: config.tenantB, flowA: config.flowA, flowB: config.flowB,
      ownerAToken: config.ownerAToken, ownerBToken: config.ownerBToken, staffToken: config.staffToken,
    });
    const result = await context.newPage(); await result.goto(config.fixtureOrigin + '/edit'); return result;
  }
  try {
    stage = 1;
    const a = await page(); await load(a); await a.getByRole('button', { name: 'Add text question', exact: true }).click();
    const prompt = '  Exact <question> 🌍  '; await question(a).fill(prompt); await saved(a);
    const initial = await callbacks.inspectA(); expect(initial?.revision).toBe(1);
    expect(initial?.definition).toMatchObject({ schemaVersion: 1, fields: [{ prompt, kind: 'text', required: false, minLength: 0, maxLength: 500 }] });
    let previewRequests = 0;
    const countPreviewRequest = () => { previewRequests++; };
    a.on('request', countPreviewRequest);
    await a.getByRole('button', { name: 'Try questions', exact: true }).click();
    const preview = a.getByRole('region', { name: 'Question preview', exact: true });
    const previewAnswer = '  Local preview <answer> 🌍  ';
    await preview.getByRole('textbox').fill(previewAnswer);
    await preview.getByRole('button', { name: 'Check answers', exact: true }).click();
    await expect(preview.getByText('Preview answers are valid. Nothing was submitted.', { exact: true })).toBeVisible();
    await expect(preview.getByRole('textbox')).toHaveValue(previewAnswer);
    await a.getByRole('button', { name: 'Close preview', exact: true }).click();
    await expect(preview).toHaveCount(0);
    expect(previewRequests).toBe(0); a.off('request', countPreviewRequest);
    expect(await callbacks.inspectA()).toEqual(initial);
    await a.getByRole('button', { name: 'Reload questions', exact: true }).click(); await expect(question(a)).toHaveValue(prompt);

    stage = 2;
    const b = await page(); await load(b); await expect(question(b)).toHaveValue(prompt);
    await question(a).fill('Winner question'); await saved(a); await question(b).fill('Keep conflicting edits');
    await b.getByRole('button', { name: 'Save questions', exact: true }).click(); await expect(b.getByText('Questions changed elsewhere. Your edits are kept. Discard edits and reload to continue.', { exact: true })).toBeVisible();
    await expect(question(b)).toHaveValue('Keep conflicting edits'); expect((await callbacks.inspectA())?.revision).toBe(2);
    const beforeComparison = await callbacks.inspectA();
    await b.getByRole('button', { name: 'Check latest version', exact: true }).click();
    const comparison = b.getByRole('region', { name: 'Question comparison', exact: true });
    await expect(comparison.getByText('Keep conflicting edits', { exact: true })).toBeVisible();
    await expect(comparison.getByText('Winner question', { exact: true })).toBeVisible();
    await expect(question(b)).toHaveValue('Keep conflicting edits');
    await expect(b.getByRole('button', { name: 'Save questions', exact: true })).toBeDisabled();
    expect(await callbacks.inspectA()).toEqual(beforeComparison);
    await dialog(b, false, () => b.getByLabel('Test identity').selectOption('ownerB')); await expect(question(b)).toHaveValue('Keep conflicting edits');
    await dialog(b, true, () => b.getByLabel('Test identity').selectOption('ownerB')); await expect(question(b)).toHaveCount(0);
    await expect(comparison).toHaveCount(0);

    stage = 3;
    await question(a).fill('Rebound question'); const parent = await callbacks.advanceParentA(); expect(parent).toBe(2);
    await a.getByRole('button', { name: 'Save questions', exact: true }).click();
    await expect(a.getByText('Questions changed elsewhere. Your edits are kept. Discard edits and reload to continue.', { exact: true })).toBeVisible();
    await expect(question(a)).toHaveValue('Rebound question'); expect((await callbacks.inspectA())?.revision).toBe(2);
    await a.getByRole('button', { name: 'Discard edits and reload', exact: true }).click(); await expect(question(a)).toHaveValue('Winner question');
    await question(a).fill('Rebound question');
    await a.getByLabel('Parent revision').fill(String(parent)); await expect(question(a)).toHaveValue('Rebound question');
    await expect(a.getByRole('button', { name: 'Save questions', exact: true })).toBeDisabled();
    await a.getByRole('button', { name: 'Check latest version', exact: true }).click();
    await expect(a.getByLabel('I reviewed these questions for the updated booking flow.')).toBeVisible();
    await a.getByLabel('I reviewed these questions for the updated booking flow.').check(); await saved(a);
    const beforeDenial = await callbacks.inspectA(); expect(beforeDenial?.revision).toBe(3);
    expect(beforeDenial?.definition).toMatchObject({ fields: [{ prompt: 'Rebound question' }] });

    stage = 4;
    // Owner B still selects Flow A: authorization must reject the cross-tenant tuple.
    await load(b); await expect(b.getByText('Questions could not be loaded. Try again.', { exact: true })).toBeVisible();
    await expect(question(b)).toHaveCount(0); expect(await callbacks.inspectA()).toEqual(beforeDenial);
    await b.getByLabel('Test identity').selectOption('ownerA'); await b.getByLabel('Test flow').selectOption('B'); await load(b);
    await expect(b.getByText('Questions could not be loaded. Try again.', { exact: true })).toBeVisible(); expect(await callbacks.inspectA()).toEqual(beforeDenial);

    stage = 5;
    await b.getByLabel('Test identity').selectOption('staff'); await b.getByLabel('Test flow').selectOption('A'); await load(b);
    await expect(b.getByText('Questions could not be loaded. Try again.', { exact: true })).toBeVisible(); await expect(question(b)).toHaveCount(0);
    expect(await callbacks.inspectA()).toEqual(beforeDenial);

    stage = 6;
    await question(a).fill('Revoked mutation'); await callbacks.revokeOwnerA();
    await a.getByRole('button', { name: 'Save questions', exact: true }).click();
    await expect(a.getByText('Questions could not be saved. Your edits are kept.', { exact: true })).toBeVisible(); await expect(question(a)).toHaveValue('Revoked mutation');
    await a.getByRole('button', { name: 'Discard edits and reload', exact: true }).click();
    await expect(a.getByText('Questions could not be loaded. Try again.', { exact: true })).toBeVisible(); expect(await callbacks.inspectA()).toEqual(beforeDenial);
    expect(denied).toBe(0); return { cases: 6 };
  } catch { throw Error(`JOURNEY_BROWSER_CASE_${stage}`); }
  finally {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.all(contexts.map(context => context.close())), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('JOURNEY_CONTEXT_CLOSE')), 5000); })]); }
    catch { throw Error('JOURNEY_CONTEXT_CLOSE'); }
    finally { if (timer) clearTimeout(timer); }
  }
}
