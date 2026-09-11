import { randomUUID } from 'node:crypto';
import { call, committed, seedOwnerRequests, state } from '../../packages/action-api/server/mode-owner-journey-fixtures.js';
import { test, expect, login, uiFlags } from './fixtures.js';

for (const v2 of [false, true])

    test(`owner-${v2 ? '02' : '01'} ${v2 ? 'v2' : 'v1'} persisted publication and installation`, async ({ page, journey: j }) => {

        let phase = 'startup';

        try {

            phase = 'login';

            await login(page, j, value => { phase = 'login-' + value; });

            phase = 'editor-select';

            phase = 'nav-click';

            await page.getByRole('link', { name: 'Embed Builder', exact: true }).click();

            phase = 'nav-mounted';

            if (v2)

                await page.getByRole('button', { name: 'Configurable questionnaires', exact: true }).click();

            phase = 'select-existing';

            await page.getByRole('combobox', { name: v2 ? 'Saved configurable questionnaire' : 'Saved questionnaire', exact: true }).selectOption(j.world.f.flow);

            phase = 'flow-loaded';

            const name = page.getByLabel(v2 ? 'Configurable questionnaire name' : 'Questionnaire name', { exact: true });

            const save = page.getByRole('button', { name: v2 ? 'Save configurable questionnaire' : 'Save questionnaire', exact: true });

            const publish = page.getByRole('button', { name: v2 ? 'Publish configurable saved version' : 'Publish saved version', exact: true });

            await name.fill(v2 ? 'Browser configurable revision' : 'Browser standard revision');

            await expect(publish).toBeDisabled();

            await save.click();

            await expect(publish).toBeEnabled();

            phase = 'publish';

            await publish.click();

            await expect(page.getByRole('button', { name: 'Create installation', exact: true })).toBeEnabled();

            const first = await j.db.query('select published_version_id from public.flows where tenant_id=$1 and id=$2', [j.world.f.tenant, j.world.f.flow]);

            const version = first.rows[0].published_version_id;

            expect(version).toMatch(/^[0-9a-f-]{36}$/);

            expect((await j.db.query('select count(*)::int n from public.mode_flow_installations where tenant_id=$1', [j.world.f.tenant])).rows[0].n).toBe(0);

            phase = 'install';

            await page.getByRole('button', { name: 'Create installation', exact: true }).click();

            const hosted = page.getByRole('button', { name: /^hosted installation / });

            await expect(hosted).toHaveCount(1);

            await page.getByRole('combobox', { name: 'Installation mode', exact: true }).selectOption('iframe');

            await page.getByLabel('Allowed parent origins', { exact: true }).fill('https://website.example.test');

            phase = 'install';

            await page.getByRole('button', { name: 'Create installation', exact: true }).click();

            await expect(page.getByRole('button', { name: /^iframe installation / })).toHaveCount(1);

            await hosted.click();

            await page.getByLabel('Distribution enabled', { exact: true }).uncheck();

            await page.getByRole('button', { name: 'Save distribution policy', exact: true }).click();

            await expect(page.getByText(/Disabled.*Target revision 1.*Policy revision 2/)).toBeVisible();

            await name.fill(v2 ? 'Browser configurable next' : 'Browser standard next');

            await save.click();

            await expect(publish).toBeEnabled();

            phase = 'publish';

            await publish.click();
            phase = 'publication-settled';
            await expect(publish).toBeEnabled();
            phase = 'select-refreshed-installation';
            await hosted.click();
            phase = 'apply-control';
            await expect(page.getByRole('button', { name: 'Apply published version', exact: true })).toBeEnabled();

            const pinned = await j.db.query("select current_version_id from public.mode_flow_installations where tenant_id=$1 and mode='hosted'", [j.world.f.tenant]);

            expect(pinned.rows[0].current_version_id).toBe(version);

            phase = 'apply';
            await page.getByRole('button', { name: 'Apply published version', exact: true }).click();

            await expect(page.getByText(/Disabled.*Target revision 2.*Policy revision 2/)).toBeVisible();

            await hosted.click();

            await page.getByRole('button', { name: 'View installation history', exact: true }).click();

            await expect(page.getByText(/Change 3:/)).toBeVisible();

            phase = 'screenshots';

            await j.screenshots(page, v2 ? 'owner-02' : 'owner-01');

            phase = 'reload';

            await page.reload();

            phase = 'login';

            await login(page, j, value => { phase = 'login-' + value; });

            phase = 'editor-select';

            phase = 'nav-click';

            await page.getByRole('link', { name: 'Embed Builder', exact: true }).click();

            phase = 'nav-mounted';

            if (v2)

                await page.getByRole('button', { name: 'Configurable questionnaires', exact: true }).click();

            phase = 'select-existing';

            await page.getByRole('combobox', { name: v2 ? 'Saved configurable questionnaire' : 'Saved questionnaire', exact: true }).selectOption(j.world.f.flow);

            phase = 'flow-loaded';

            await expect(page.getByRole('button', { name: /^hosted installation / })).toHaveCount(1);

            await expect(page.getByRole('button', { name: /^iframe installation / })).toHaveCount(1);

            await page.getByRole('button', { name: 'Sign out / change business', exact: true }).click();

            await expect(page.getByRole('button', { name: 'Open business', exact: true })).toBeVisible();

            await expect(page.getByRole('button', { name: /^hosted installation / })).toHaveCount(0);

            await expect(page.getByRole('button', { name: 'Save distribution policy', exact: true })).toHaveCount(0);

            await expect(page.getByLabel('Local test credential', { exact: true })).toHaveValue('');

        }

        catch {

            throw Error('SAFE_BROWSER_CASE_FAILED_' + phase + '_' + j.lastHttp() + '_' + await uiFlags(page));

        }

    });

test('owner-03 actual committed install response loss and recovery', async ({ page, journey: j }) => {

    let phase = 'startup';

    try {

        phase = 'login';

        await login(page, j, value => { phase = 'login-' + value; });

        phase = 'editor-select';

        phase = 'nav-click';

        await page.getByRole('link', { name: 'Embed Builder', exact: true }).click();

        phase = 'nav-mounted';

        phase = 'select-existing';

        await page.getByRole('combobox', { name: 'Saved questionnaire', exact: true }).selectOption(j.world.f.flow);

        phase = 'flow-loaded';

        await page.getByRole('button', { name: 'Publish saved version', exact: true }).click();

        await expect(page.getByRole('button', { name: 'Create installation', exact: true })).toBeEnabled();

        // Unsaved edits may still install the known current publication; publication remains locked.

        await page.getByLabel('Questionnaire name', { exact: true }).fill('Unsaved draft stays private');

        await expect(page.getByRole('button', { name: 'Publish saved version', exact: true })).toBeDisabled();

        let calls = 0, committedResponse = false, interceptionFailed = false, key = '';

        await page.route(j.addresses.owner + '/api/local/mode-owner/install', async (route) => { let phase = 'startup'; try {

            calls++;

            key = route.request().postDataJSON().idempotencyKey;

            const response = await route.fetch({ maxRedirects: 0, timeout: 15000 });

            committedResponse = response.status() === 200;

            await route.abort('failed');

        }

        catch {

            interceptionFailed = true;

            await route.abort('failed').catch(() => { });

        } });

        phase = 'install';

        await page.getByRole('button', { name: 'Create installation', exact: true }).click();

        await expect(page.getByRole('button', { name: 'Check previous change', exact: true })).toBeVisible();

        phase = 'actual-loss-observed';
        await expect.poll(() => committedResponse || interceptionFailed).toBe(true);
        expect(interceptionFailed).toBe(false);

        expect(committedResponse).toBe(true);

        expect(calls).toBe(1);

        expect(key).toMatch(/^[0-9a-f-]{36}$/);

        const persisted = await j.db.query('select id from public.mode_flow_installations where tenant_id=$1', [j.world.f.tenant]);

        expect(persisted.rows).toHaveLength(1);

        await expect(page.getByRole('button', { name: 'Create installation', exact: true })).toBeDisabled();

        // A separate genuine owner change advances policy after the immutable install receipt.
        phase = 'external-policy-advance';
        committed(await call(j.addresses.owner, 'update-policy', j.world.credential, { tenantId:j.world.f.tenant, flowId:j.world.f.flow, installationId:persisted.rows[0].id, expectedPolicyRevision:1, enabled:false, allowedParentOrigins:[], idempotencyKey:randomUUID() }));
        phase = 'recover-history-current';
        await page.getByRole('button', { name: 'Check previous change', exact: true }).click();
        await expect(page.getByText('Historical receipt recorded: install. Current controls use refreshed settings.',{exact:true})).toBeVisible();
        await expect(page.getByText(/Disabled.*Target revision 1.*Policy revision 2/)).toBeVisible();

        await expect(page.getByRole('button', { name: 'Check previous change', exact: true })).toHaveCount(0);

        await expect(page.getByRole('button', { name: /^hosted installation / })).toHaveCount(1);

        expect(calls).toBe(1);

        expect((await j.db.query('select id from public.mode_flow_installations where tenant_id=$1', [j.world.f.tenant])).rows).toEqual(persisted.rows);

    }

    catch {

        throw Error('SAFE_BROWSER_CASE_FAILED_' + phase + '_' + j.lastHttp() + '_' + await uiFlags(page));

    }

});

test('owner-04 logout and tenant switch discard delayed genuine response', async ({ page, journey: j }) => {

    let phase = 'startup';

    let release: () => void = () => { };

    try {

        phase = 'login';

        await login(page, j, value => { phase = 'login-' + value; });

        phase = 'editor-select';

        phase = 'nav-click';

        await page.getByRole('link', { name: 'Embed Builder', exact: true }).click();

        phase = 'nav-mounted';

        phase = 'select-existing';

        await page.getByRole('combobox', { name: 'Saved questionnaire', exact: true }).selectOption(j.world.f.flow);

        phase = 'flow-loaded';

        await expect(page.getByLabel('Questionnaire name', { exact: true })).toBeVisible();

        let ready = false, held = false, oldAfterRelease = 0, released = false;

        const gate = new Promise<void>(resolve => { release = resolve; });

        await page.route(j.addresses.owner + '/api/local/mode-owner/request-history', async (route) => { let phase = 'startup'; try {

            const request = route.request().postDataJSON();

            if (request.tenantId === j.world.f.tenant) {

                if (released)

                    oldAfterRelease++;

                if (!held) {

                    held = true;

                    const response = await route.fetch({ maxRedirects: 0, timeout: 15000 });

                    ready = true;

                    await gate;

                    await route.fulfill({ response }).catch(() => { });

                    return;

                }

            }

            await route.continue();

        }

        catch {

            await route.abort('failed').catch(() => { });

        } });

        await page.getByRole('link', { name: 'Bookings', exact: true }).click();

        await page.getByRole('button', { name: 'Refresh requests', exact: true }).click();

        await expect.poll(() => ready).toBe(true);

        await page.getByRole('button', { name: 'Sign out / change business', exact: true }).click();

        await expect(page.getByLabel('Local test credential', { exact: true })).toHaveValue('');

        await expect(page.getByLabel('Business ID', { exact: true })).toHaveValue('');

        await expect(page.getByLabel('Questionnaire name', { exact: true })).toHaveCount(0);

        await page.getByLabel('Local test credential', { exact: true }).fill(j.world.credentials[3]!.credential);

        await page.getByLabel('Business ID', { exact: true }).fill(j.world.f.foreignTenant);

        await page.getByRole('button', { name: 'Open business', exact: true }).click();

        await expect(page.getByRole('button', { name: 'Sign out / change business', exact: true })).toBeVisible();

        released = true;

        release();

        phase = 'nav-click';

        await page.getByRole('link', { name: 'Embed Builder', exact: true }).click();

        phase = 'nav-mounted';

        await expect(page.getByText('No compatible services are available.', { exact: true })).toBeVisible();

        expect(oldAfterRelease).toBe(0);

        await expect(page.getByLabel('Questionnaire name', { exact: true })).toHaveCount(0);

        // Keyboard access remains usable after the generation change.

        const signout = page.getByRole('button', { name: 'Sign out / change business', exact: true });

        await signout.focus();

        await expect(signout).toBeFocused();

        await page.keyboard.press('Enter');

        await expect(page.getByRole('button', { name: 'Open business', exact: true })).toBeVisible();

    }

    catch {

        throw Error('SAFE_BROWSER_CASE_FAILED_' + phase + '_' + j.lastHttp() + '_' + await uiFlags(page));

    }

    finally {

        release();

    }

});


test('owner-05 persisted archived current request summaries and privacy', async ({page, journey:j})=>{
 let phase='seed';
 try {
  const pub=committed(await call(j.addresses.owner,'publish',j.world.credential,{tenantId:j.world.f.tenant,flowId:j.world.f.flow,expectedDraftRevision:j.world.revision,idempotencyKey:randomUUID()}));
  const install=committed(await call(j.addresses.owner,'install',j.world.credential,{tenantId:j.world.f.tenant,flowId:j.world.f.flow,versionId:pub.versionId,expectedPublishedVersionId:pub.versionId,mode:'hosted',deploymentProfileVersion:'local-s1',allowedParentOrigins:[],idempotencyKey:randomUUID()}));
  const requests=await seedOwnerRequests(j.db,j.world,pub.versionId,install.installationId);
  await j.db.query("update public.flows set status='archived' where tenant_id=$1 and id=$2",[j.world.f.tenant,j.world.f.flow]);
  const before=await state(j.db,j.world.f);
  phase='login-history'; await login(page,j);
  await page.getByRole('link',{name:'Bookings',exact:true}).click();
  for(const r of requests){
   await expect(page.getByText(`${r.reference} · ${r.state} · ${r.slotStart}`,{exact:true})).toBeVisible();
   await expect(page.locator(`time[datetime="${r.slotStart}"]`)).toHaveCount(1);
  }
  await expect(page.getByText('Synthetic history',{exact:true})).toHaveCount(0);
  await expect(page.getByText('summary@example.test',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Next requests',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Previous requests',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Refresh requests',exact:true}).click();
  await expect(page.getByRole('button',{name:'Refresh requests',exact:true})).toBeEnabled();
  expect(await state(j.db,j.world.f)).toEqual(before);
  const privateState=await page.evaluate(()=>({local:Object.values(localStorage),session:Object.values(sessionStorage),cookie:document.cookie,referrer:document.referrer,url:location.href}));
  expect(JSON.stringify(privateState).includes(j.world.credential)).toBe(false);
  j.assertPrivacy();
  expect(privateState.local).toEqual([]);
  expect(privateState.session).toEqual([]);
  expect(privateState.cookie).toBe('');
  expect(await page.context().cookies()).toEqual([]);
  expect(privateState.referrer).toBe('');
  await page.getByRole('button',{name:'Sign out / change business',exact:true}).click();
  for(const r of requests)await expect(page.getByText(new RegExp(r.reference))).toHaveCount(0);
 }catch{throw Error('SAFE_BROWSER_CASE_FAILED_'+phase+'_'+j.lastHttp());}
});

test('owner-06 native unsaved navigation confirmation preserves or discards local edits',async({page,journey:j})=>{
 let phase='login'; let dialogs=0; let decision:'dismiss'|'accept'='dismiss'; let dialogFailure=false;
 const onDialog=async(dialog:import('@playwright/test').Dialog)=>{try{dialogs++;if(dialog.type()!=='confirm')dialogFailure=true;await dialog[decision]();}catch{dialogFailure=true;}};
 page.on('dialog',onDialog);
 try{
  await login(page,j);await page.getByRole('link',{name:'Embed Builder',exact:true}).click();
  await page.getByRole('combobox',{name:'Saved questionnaire',exact:true}).selectOption(j.world.f.flow);
  const name=page.getByLabel('Questionnaire name',{exact:true});
  await name.fill('Unsaved navigation fixture');const before=await state(j.db,j.world.f);
  phase='dismiss-native';await page.getByRole('link',{name:'Bookings',exact:true}).click();
  await expect(name).toHaveValue('Unsaved navigation fixture');expect(dialogs).toBe(1);expect(dialogFailure).toBe(false);
  decision='accept';phase='accept-native';await page.getByRole('link',{name:'Bookings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Request history',exact:true})).toBeVisible();
  expect(dialogs).toBe(2);expect(dialogFailure).toBe(false);expect(await state(j.db,j.world.f)).toEqual(before);
 }catch{throw Error('SAFE_BROWSER_CASE_FAILED_'+phase+'_'+j.lastHttp());}finally{page.removeListener('dialog',onDialog);}
});

test('owner-07 stale policy CAS refreshes current controls without replay',async({page,journey:j})=>{
 let phase='seed';let failed=false;let policyCalls=0;
 const observed=(response:import('@playwright/test').Response)=>{if(response.url()===j.addresses.owner+'/api/local/mode-owner/update-policy'){policyCalls++;if(response.status()===409)failed=true;}};
 page.on('response',observed);
 try{
  const pub=committed(await call(j.addresses.owner,'publish',j.world.credential,{tenantId:j.world.f.tenant,flowId:j.world.f.flow,expectedDraftRevision:j.world.revision,idempotencyKey:randomUUID()}));
  const install=committed(await call(j.addresses.owner,'install',j.world.credential,{tenantId:j.world.f.tenant,flowId:j.world.f.flow,versionId:pub.versionId,expectedPublishedVersionId:pub.versionId,mode:'hosted',deploymentProfileVersion:'local-s1',allowedParentOrigins:[],idempotencyKey:randomUUID()}));
  phase='select';await login(page,j);await page.getByRole('link',{name:'Embed Builder',exact:true}).click();
  await page.getByRole('combobox',{name:'Saved questionnaire',exact:true}).selectOption(j.world.f.flow);
  await expect(page.getByRole('button',{name:'Refresh installations',exact:true})).toBeEnabled();
  const hosted=page.getByRole('button',{name:/^hosted installation /});await hosted.click();
  await expect(page.getByLabel('Distribution enabled',{exact:true})).toBeChecked();
  committed(await call(j.addresses.owner,'update-policy',j.world.credentials[1]!.credential,{tenantId:j.world.f.tenant,flowId:j.world.f.flow,installationId:install.installationId,expectedPolicyRevision:1,enabled:false,allowedParentOrigins:[],idempotencyKey:randomUUID()}));
  const advanced=await state(j.db,j.world.f);
  phase='stale-cas';await page.getByRole('button',{name:'Save distribution policy',exact:true}).click();
  await expect.poll(()=>failed).toBe(true);
  await expect(page.getByText(/Disabled.*Target revision 1.*Policy revision 2/)).toBeVisible();
  await hosted.click();await expect(page.getByLabel('Distribution enabled',{exact:true})).not.toBeChecked();
  expect(policyCalls).toBe(1);expect(await state(j.db,j.world.f)).toEqual(advanced);
  await expect(page.getByRole('button',{name:'Check previous change',exact:true})).toHaveCount(0);
 }catch{throw Error('SAFE_BROWSER_CASE_FAILED_'+phase+'_'+j.lastHttp());}finally{page.removeListener('response',observed);}
});
