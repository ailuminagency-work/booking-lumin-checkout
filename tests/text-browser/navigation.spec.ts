import { test, expect, type Page } from '@playwright/test';
// Synthetic-client browser acceptance only; no database, authentication or provider claim.
const deniedRequests = new WeakMap<Page, { count: number }>();
const question = (page: Page) => page.getByLabel('Question label', { exact: true });
async function load(page: Page) { await page.getByRole('button', { name: 'Load questions', exact: true }).click(); await expect(question(page)).toHaveValue('Saved question'); }
async function dirty(page: Page) { await load(page); await question(page).fill('Unsaved browser question'); }
async function dialogAction(page: Page, accept: boolean, action: () => Promise<unknown>, kind = 'confirm') {
  const observed = page.waitForEvent('dialog').then(async dialog => { expect(dialog.type()).toBe(kind); if (accept) await dialog.accept(); else await dialog.dismiss(); });
  await Promise.all([observed, action()]);
}
test.beforeEach(async ({ page, context, baseURL }) => {
  expect(baseURL).toBeTruthy(); const allowed = new URL(baseURL!).origin;
  expect(['127.0.0.1', 'localhost']).toContain(new URL(allowed).hostname);
  const attempts = { count: 0 }; deniedRequests.set(page, attempts);
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === allowed) return route.continue();
    attempts.count++; return route.abort('blockedbyclient');
  });
  await page.goto('/edit'); await expect(page.getByRole('button', { name: 'Load questions', exact: true })).toBeVisible();
});
test.afterEach(async ({ page }) => { expect(deniedRequests.get(page)?.count).toBe(0); });
test('dirty PUSH cancellation preserves edits and acceptance retires them', async ({ page }) => {
  await dirty(page);
  await dialogAction(page,false,()=>page.getByRole('link',{name:'Open other page',exact:true}).click());
  await expect(page).toHaveURL(/\/edit$/);await expect(question(page)).toHaveValue('Unsaved browser question');
  await dialogAction(page,true,()=>page.getByRole('link',{name:'Open other page',exact:true}).click());await expect(page).toHaveURL(/\/other$/);
  await page.getByRole('link',{name:'Open editor',exact:true}).click();await load(page);
});
test('programmatic replace obeys cancellation and acceptance', async ({ page }) => {
  await dirty(page);const replace=()=>page.getByRole('button',{name:'Replace with other page',exact:true}).click();
  await dialogAction(page,false,replace);await expect(question(page)).toHaveValue('Unsaved browser question');
  await dialogAction(page,true,replace);await expect(page).toHaveURL(/\/other$/);
});
test('native backward and forward traversal preserve cancelled drafts and reload after acceptance', async ({ page }) => {
  await page.getByRole('link',{name:'Open other page',exact:true}).click();await page.getByRole('link',{name:'Open editor',exact:true}).click();await dirty(page);
  await dialogAction(page,false,()=>page.goBack());await expect(page).toHaveURL(/\/edit$/);await expect(question(page)).toHaveValue('Unsaved browser question');
  await dialogAction(page,true,()=>page.goBack());await expect(page).toHaveURL(/\/other$/);
  await page.goBack();await expect(page).toHaveURL(/\/edit$/);await dirty(page);
  await dialogAction(page,false,()=>page.goForward());await expect(question(page)).toHaveValue('Unsaved browser question');
  await dialogAction(page,true,()=>page.goForward());await expect(page).toHaveURL(/\/other$/);
  await page.goForward();await expect(page).toHaveURL(/\/edit$/);await load(page);
});
test('deferred read and save block navigation without prompting', async ({ page }) => {
  let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss();});
  await page.getByLabel('Defer reads',{exact:true}).check();await page.getByRole('button',{name:'Load questions',exact:true}).click();
  await page.getByRole('link',{name:'Open other page',exact:true}).click();await expect(page).toHaveURL(/\/edit$/);
  await page.getByRole('button',{name:'Resolve next read',exact:true}).click();await expect(question(page)).toHaveValue('Saved question');
  await page.getByLabel('Defer saves',{exact:true}).check();await question(page).fill('Pending save');await page.getByRole('button',{name:'Save questions',exact:true}).click();
  await page.getByRole('button',{name:'Replace with other page',exact:true}).click();await expect(page).toHaveURL(/\/edit$/);expect(dialogs).toBe(0);
  await page.getByRole('button',{name:'Resolve next save',exact:true}).click();await expect(page.getByText('No unsaved question changes.',{exact:true})).toBeVisible();
});
test('accepted query and hash navigation resets the editor', async ({ page }) => {
  await dirty(page);await dialogAction(page,true,()=>page.getByRole('link',{name:'Change editor query',exact:true}).click());
  await expect(page.getByRole('button',{name:'Load questions',exact:true})).toBeVisible();await load(page);await question(page).fill('Hash draft');
  await dialogAction(page,true,()=>page.evaluate(()=>{window.location.hash='other-question';}));
  await expect(page.getByRole('button',{name:'Load questions',exact:true})).toBeVisible();
});
test('late old save cannot clear new account busy state', async ({ page }) => {
  await dirty(page);await page.getByLabel('Defer saves',{exact:true}).check();await page.getByRole('button',{name:'Save questions',exact:true}).click();
  await page.getByRole('button',{name:'Force account switch',exact:true}).click();await page.getByLabel('Defer reads',{exact:true}).check();await page.getByRole('button',{name:'Load questions',exact:true}).click();
  await page.getByRole('button',{name:'Resolve next save',exact:true}).click();await expect(page.getByText('Questions are loading or saving.',{exact:true})).toBeVisible();
  let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss();});await page.getByRole('link',{name:'Open other page',exact:true}).click();await expect(page).toHaveURL(/\/edit$/);expect(dialogs).toBe(0);
  await page.getByRole('button',{name:'Resolve next read',exact:true}).click();await expect(question(page)).toHaveValue('Saved question');
});
test('markup remains text and beforeunload dismiss preserves DOM while acceptance exits', async ({ page }) => {
  await load(page);const markup='<img src=x onerror="window.injected=true">';await question(page).fill(markup);
  await expect(page.locator('section[aria-label="Text questions"] img')).toHaveCount(0);await expect(page.getByText(markup,{exact:true})).toBeVisible();
  await dialogAction(page,false,()=>page.evaluate(()=>{window.location.assign('/other');}),'beforeunload');
  await expect(question(page)).toHaveValue(markup);
  await dialogAction(page,true,()=>page.evaluate(()=>{window.location.assign('/other');}),'beforeunload');await expect(page).toHaveURL(/\/other$/);
});

test('preview answers stay local, do not dirty the draft, and disappear on close', async ({ page }) => {
  await load(page);
  const before = await page.evaluate(() => window.__textFixture!.snapshot());
  await page.getByRole('button', { name: 'Try questions', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Question preview', exact: true });
  const answer = preview.getByRole('textbox');
  const value = '  <img src=x onerror=alert(1)> 🌍  ';
  await answer.fill(value); await expect(answer).toHaveValue(value);
  await preview.getByRole('button', { name: 'Check answers', exact: true }).click();
  await expect(preview.getByText('Preview answers are valid. Nothing was submitted.', { exact: true })).toBeVisible();
  await expect(preview.locator('img')).toHaveCount(0);
  await expect(page.getByText('No unsaved question changes.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__textFixture!.snapshot())).toEqual(before);
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await page.getByRole('button', { name: 'Try questions', exact: true }).click();
  await expect(preview.getByRole('textbox')).toHaveValue('');
  // A preview answer alone must not create a draft-discard confirmation.
  let dialogs = 0; page.on('dialog', async d => { dialogs++; await d.dismiss(); });
  await preview.getByRole('textbox').fill('Temporary answer');
  await page.getByRole('link', { name: 'Open other page', exact: true }).click();
  await expect(page).toHaveURL(/\/other$/); expect(dialogs).toBe(0);
});

test('preview validates Unicode code points and clears across account changes', async ({ page }) => {
  await load(page);
  await page.getByLabel('Answer required', { exact: true }).check();
  await page.getByLabel('Minimum characters', { exact: true }).fill('2');
  await page.getByLabel('Maximum characters', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Try questions', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Question preview', exact: true });
  const answer = preview.getByRole('textbox');
  await answer.fill('🌍🌍');
  await preview.getByRole('button', { name: 'Check answers', exact: true }).click();
  await expect(preview.getByText('Preview answers are valid. Nothing was submitted.', { exact: true })).toBeVisible();
  await answer.fill('🌍🌍🌍');
  await preview.getByRole('button', { name: 'Check answers', exact: true }).click();
  await expect(answer).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Force account switch', exact: true }).click();
  await expect(preview).toHaveCount(0); await load(page);
  await page.getByRole('button', { name: 'Try questions', exact: true }).click();
  await expect(preview.getByRole('textbox')).toHaveValue('');
});
