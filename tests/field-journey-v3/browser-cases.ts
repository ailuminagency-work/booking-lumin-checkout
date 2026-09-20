import { expect, type Browser, type BrowserContext, type Page, type Route, type APIResponse } from '@playwright/test';
interface Config { fixtureOrigin: string; apiUrl: string; tenantA: string; tenantB: string; flowA: string; flowB: string; ownerAToken: string; ownerBToken: string; staffToken: string }
interface Callbacks { inspectA(): Promise<{ definition: unknown; revision: number } | null>; advanceParentA(): Promise<number>; revokeOwnerA(): Promise<void> }
const question = (page: Page) => page.getByLabel('Question label', { exact: true }).first();
async function load(page: Page) { await page.getByRole('button', { name: 'Load questions', exact: true }).click(); }
async function saved(page: Page) { await page.getByRole('button', { name: 'Save questions', exact: true }).click(); await expect(page.getByText('Questions saved as a draft.', { exact: true })).toBeVisible(); }
async function dialog(page: Page, accept: boolean, action: () => Promise<unknown>) {
  await Promise.all([page.waitForEvent('dialog', { timeout: 5000 }).then(async value => { if (value.type() !== 'confirm') { await value.dismiss(); throw Error('DIALOG'); } if (accept) await value.accept(); else await value.dismiss(); }), action()]);
}

/** Node-side SQL callbacks never enter page init data or browser endpoints. */
export async function runFieldJourneyV3BrowserCases(browser: Browser, config: Config, callbacks: Callbacks): Promise<{ cases: number }> {
  if (config.fixtureOrigin !== 'http://127.0.0.1:4193' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(config.apiUrl)) throw Error('JOURNEY_CONFIG');
  const contexts: BrowserContext[] = []; const closedContexts=new Set<BrowserContext>(); let denied = 0, stage = 0;
  let firstPhase: 'PAGE' | 'LOAD' | 'EDIT' | 'SAVE' | 'SQL' | 'PREVIEW' | 'PREVIEW_SQL' | 'RELOAD' = 'PAGE';
  async function page() {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false }); contexts.push(context); context.once('close',()=>closedContexts.add(context));
    context.setDefaultTimeout(5000); context.setDefaultNavigationTimeout(5000);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (![config.fixtureOrigin, config.apiUrl].includes(url.origin)) { denied++; await route.abort(); } else await route.continue();
    });
    await context.addInitScript(value => { Object.defineProperty(window, '__fieldJourney', { value, writable: false }); }, {
      apiUrl: config.apiUrl, tenantA: config.tenantA, tenantB: config.tenantB, flowA: config.flowA, flowB: config.flowB,
      ownerAToken: config.ownerAToken, ownerBToken: config.ownerBToken, staffToken: config.staffToken,
    });
    const result = await context.newPage(); await result.goto(config.fixtureOrigin + '/edit'); return result;
  }
  try {
    stage = 1;
    const a = await page(); firstPhase = 'LOAD'; await load(a); await a.getByRole('button', { name: 'Add text question', exact: true }).click();
    firstPhase = 'EDIT';
    const prompt = '  Exact <question> 🌍  '; await question(a).fill(prompt);
    await a.getByRole('button',{name:'Add text question',exact:true}).click();
    await a.getByLabel('Question label',{exact:true}).nth(1).fill('Long instructions');
    const longFormat = a.getByRole('group',{name:'Question 2',exact:true}).getByRole('combobox');
    await expect(longFormat).toHaveCount(1); await longFormat.selectOption('textarea'); await expect(longFormat).toHaveValue('textarea');
    await a.getByRole('button',{name:'Add dropdown question',exact:true}).click();
    await a.getByLabel('Question label',{exact:true}).nth(2).fill('Choose vehicle');
    await a.getByLabel('Choice 1 label',{exact:true}).fill('  Duplicate <choice>  ');
    await a.getByRole('button',{name:'Add choice',exact:true}).click();
    await a.getByLabel('Choice 2 label',{exact:true}).fill('  Duplicate <choice>  ');
    firstPhase = 'SAVE';
    const requestSaved=a.waitForRequest(request=>request.method()==='POST'&&request.url().startsWith(config.apiUrl+'/api/field-drafts-v3/'));
    await saved(a); const submitted=(await requestSaved).postDataJSON();
    firstPhase = 'SQL';
    const initial = await callbacks.inspectA(); expect(initial?.revision).toBe(1);
    const fields=submitted.definition.fields;
    expect(fields).toHaveLength(3);for(const field of fields)expect(field.key).toMatch(/^question_[a-f0-9]{32}$/);
    expect(new Set(fields.map((field:{key:string})=>field.key)).size).toBe(3);
    const choices=fields[2].choices;expect(choices).toHaveLength(2);for(const choice of choices)expect(choice.id).toMatch(/^choice_[a-f0-9]{32}$/);expect(choices[0].id).not.toBe(choices[1].id);
    const expected={schemaVersion:3,fields:[{key:fields[0].key,prompt,kind:'text',required:false,minLength:0,maxLength:500},{key:fields[1].key,prompt:'Long instructions',kind:'textarea',required:false,minLength:0,maxLength:500},{key:fields[2].key,prompt:'Choose vehicle',kind:'dropdown',required:false,choices:[{id:choices[0].id,label:'  Duplicate <choice>  '},{id:choices[1].id,label:'  Duplicate <choice>  '}]}]};
    expect(submitted).toEqual({fieldDraftVersion:3,parentAuthoringVersion:2,expectedRevision:0,expectedFlowRevision:1,definition:expected});expect(initial?.definition).toEqual(expected);
    firstPhase = 'RELOAD';await a.getByRole('button',{name:'Reload questions',exact:true}).click();await expect(question(a)).toHaveValue(prompt);await expect(a.getByLabel('Choice 1 label',{exact:true})).toHaveValue('  Duplicate <choice>  ');
    stage = 2;
    firstPhase = 'PREVIEW';
    let previewRequests = 0;
    const countPreviewRequest = () => { previewRequests++; };
    a.on('request', countPreviewRequest);
    await a.getByRole('button', { name: 'Try questions', exact: true }).click();
    const preview = a.getByRole('region', { name: 'Question preview', exact: true });
    const previewAnswer = '  Local preview <answer> 🌍  ';
    await preview.getByRole('textbox').first().fill(previewAnswer);
    await preview.getByRole('textbox').nth(1).fill('Exact line one\n🌍 line two');
    await preview.getByRole('combobox').selectOption(choices[1].id);
    await preview.getByRole('button', { name: 'Check answers', exact: true }).click();
    await expect(preview.getByText('Preview answers are valid. Nothing was submitted.', { exact: true })).toBeVisible();
    await expect(preview.getByRole('textbox').first()).toHaveValue(previewAnswer);
    await expect(preview.getByRole('textbox').nth(1)).toHaveValue('Exact line one\n🌍 line two');
    // Clearing an optional selection represents absence and remains valid.
    await preview.getByRole('combobox').selectOption('');
    await preview.getByRole('button',{name:'Check answers',exact:true}).click();
    await expect(preview.getByRole('combobox')).toHaveValue('');
    await expect(preview.getByText('Preview answers are valid. Nothing was submitted.',{exact:true})).toBeVisible();
    await a.getByRole('button', { name: 'Close preview', exact: true }).click();
    await expect(preview).toHaveCount(0);
    const required=a.getByRole('group',{name:'Question 3',exact:true}).getByLabel('Answer required',{exact:true});
    await required.check();await a.getByRole('button',{name:'Try questions',exact:true}).click();
    await preview.getByRole('button',{name:'Check answers',exact:true}).click();
    await expect(preview.getByRole('combobox')).toHaveAttribute('aria-invalid','true');
    await expect(preview.getByText('Check required answers, character limits and selected options.',{exact:true})).toBeVisible();
    await preview.getByRole('combobox').selectOption(choices[0].id);
    await preview.getByRole('button',{name:'Check answers',exact:true}).click();
    await expect(preview.getByRole('combobox')).toHaveValue(choices[0].id);
    await expect(preview.getByText('Preview answers are valid. Nothing was submitted.',{exact:true})).toBeVisible();
    await preview.getByRole('combobox').selectOption('');
    await preview.getByRole('button',{name:'Check answers',exact:true}).click();
    await expect(preview.getByRole('combobox')).toHaveValue('');
    await expect(preview.getByRole('combobox')).toHaveAttribute('aria-invalid','true');
    await expect(preview.getByText('Check required answers, character limits and selected options.',{exact:true})).toBeVisible();
    await a.getByRole('button',{name:'Close preview',exact:true}).click();await required.uncheck();
    await expect(required).not.toBeChecked();await expect(preview).toHaveCount(0);
    expect(previewRequests).toBe(0); a.off('request', countPreviewRequest);
    firstPhase = 'PREVIEW_SQL'; expect(await callbacks.inspectA()).toEqual(initial);
    stage = 3;
    const b = await page(); await load(b); await expect(question(b)).toHaveValue(prompt);
    await question(a).fill('Winner question'); await a.getByRole('button',{name:'Move choice 1 down',exact:true}).click(); await saved(a); await question(b).fill('Keep conflicting edits');
    await b.getByRole('button', { name: 'Save questions', exact: true }).click(); await expect(b.getByText('Questions changed elsewhere. Your edits are kept. Discard edits and reload to continue.', { exact: true })).toBeVisible();
    await expect(question(b)).toHaveValue('Keep conflicting edits'); expect((await callbacks.inspectA())?.revision).toBe(2);
    const reordered={...expected,fields:[{...expected.fields[0],prompt:'Winner question'},expected.fields[1],{...expected.fields[2],choices:[{id:choices[1].id,label:'  Duplicate <choice>  '},{id:choices[0].id,label:'  Duplicate <choice>  '}]}]};
    const beforeComparison = await callbacks.inspectA();expect(beforeComparison?.definition).toEqual(reordered);
    await b.getByRole('button', { name: 'Check latest version', exact: true }).click();
    await expect(question(b)).toHaveValue('Keep conflicting edits');
    await expect(b.getByRole('button', { name: 'Save questions', exact: true })).toBeDisabled();
    expect(await callbacks.inspectA()).toEqual(beforeComparison);
    await dialog(b, false, () => b.getByLabel('Test identity').selectOption('ownerB')); await expect(question(b)).toHaveValue('Keep conflicting edits');
    await dialog(b, true, () => b.getByLabel('Test identity').selectOption('ownerB')); await expect(question(b)).toHaveCount(0);

    stage = 4;
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
    expect(beforeDenial?.definition).toEqual({...reordered,fields:[{...reordered.fields[0],prompt:'Rebound question'},reordered.fields[1],reordered.fields[2]]});

    stage = 5;
    // Owner B still selects Flow A: authorization must reject the cross-tenant tuple.
    await load(b); await expect(b.getByText('Questions could not be loaded. Try again.', { exact: true })).toBeVisible();
    await expect(question(b)).toHaveCount(0); expect(await callbacks.inspectA()).toEqual(beforeDenial);
    await b.getByLabel('Test identity').selectOption('ownerA'); await b.getByLabel('Test flow').selectOption('B'); await load(b);
    await expect(b.getByText('Questions could not be loaded. Try again.', { exact: true })).toBeVisible(); expect(await callbacks.inspectA()).toEqual(beforeDenial);

    await b.getByLabel('Test identity').selectOption('staff'); await b.getByLabel('Test flow').selectOption('A'); await load(b);
    await expect(b.getByText('Questions could not be loaded. Try again.', { exact: true })).toBeVisible(); await expect(question(b)).toHaveCount(0);
    expect(await b.evaluate(()=>window.__fieldJourneyProbe!.saveAsStaff())).toBe('FORBIDDEN');
    expect(await callbacks.inspectA()).toEqual(beforeDenial);

    stage = 7;
    // Hold only genuine GET responses; no fabricated receipt or claim about cancelling a committed POST.
    async function heldRead(target:Page, action:()=>Promise<void>, expectAbort=false) {
      const pattern=config.apiUrl+'/api/field-drafts-v3/**';
      let release!:()=>void, reached!:()=>void;
      const hold=new Promise<void>(resolve=>release=resolve), fetched=new Promise<void>(resolve=>reached=resolve);
      let handlerTask:Promise<void>|undefined, response:APIResponse|undefined, handlerFailed=false;
      const handler=(route:Route)=>{
        if(route.request().method()!=='GET')return route.fallback();
        handlerTask=(async()=>{
          try {response=await route.fetch({maxRedirects:0,timeout:5000});expect(response.status()).toBe(200);reached();await hold;
            try {await route.fulfill({response});} catch { if(!expectAbort)throw Error('HELD_GET_FULFILL');await expect.poll(()=>route.request().failure()?.errorText??'',{timeout:5000}).toMatch(/ERR_ABORTED|NS_BINDING_ABORTED/); }
          } catch {handlerFailed=true;reached();}
          finally {if(response)await response.dispose();}
        })();return handlerTask;
      };
      let timer:ReturnType<typeof setTimeout>|undefined;
      await target.route(pattern,handler);
      try {
        await target.getByRole('button',{name:'Check latest version',exact:true}).click();
        await Promise.race([fetched,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('HELD_GET_TIMEOUT')),5000);})]);
        expect(handlerFailed).toBe(false);expect(response).toBeDefined();await action();
      } finally {if(timer)clearTimeout(timer);release();try{if(handlerTask){let cleanupTimer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([handlerTask,new Promise<never>((_,reject)=>{cleanupTimer=setTimeout(()=>reject(Error('HELD_GET_CLEANUP')),7000);})]);}finally{if(cleanupTimer)clearTimeout(cleanupTimer);}}}finally{await target.unroute(pattern,handler);}}
      expect(handlerFailed).toBe(false);
    }
    async function boundedHeld<T>(task:Promise<T>,milliseconds:number):Promise<T> {
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{return await Promise.race([task,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('HELD_GET_TIMEOUT')),milliseconds);})]);}
      finally{if(timer)clearTimeout(timer);}
    }
    for(const mode of ['revision','dirty'] as const){
      await a.getByLabel('Choice 1 label',{exact:true}).fill('Unsaved '+mode);
      // Each actual GET owns its response, release and task; neither can replace the other's cleanup.
      function slot(expectAbort:boolean){
        let release!:()=>void,reached!:()=>void;
        const hold=new Promise<void>(resolve=>release=resolve),fetched=new Promise<void>(resolve=>reached=resolve);
        return {expectAbort,release,reached,hold,fetched,response:undefined as APIResponse|undefined,task:undefined as Promise<void>|undefined,failed:false,disposed:false};
      }
      const old=slot(true),fresh=slot(false),slots=[old,fresh];let admitted=0,unexpected=false;
      const pattern=config.apiUrl+'/api/field-drafts-v3/**';
      const handler=(route:Route)=>{
        if(route.request().method()!=='GET')return route.fallback();
        const owned=slots[admitted++];
        if(!owned){unexpected=true;return route.abort();}
        owned.task=(async()=>{
          try {
            owned.response=await route.fetch({maxRedirects:0,timeout:5000});expect(owned.response.status()).toBe(200);owned.reached();await owned.hold;
            try{await route.fulfill({response:owned.response});}
            catch{if(!owned.expectAbort)throw Error('HELD_GET_FULFILL');await expect.poll(()=>route.request().failure()?.errorText??'',{timeout:5000}).toMatch(/ERR_ABORTED|NS_BINDING_ABORTED/);}
          }catch{owned.failed=true;owned.reached();}
          finally{if(owned.response){await owned.response.dispose();owned.disposed=true;}}
        })();
        // The task is also awaited explicitly below and in cleanup.
        void owned.task.catch(()=>undefined);return owned.task;
      };
      await a.route(pattern,handler);
      try{
        await a.getByRole('button',{name:'Check latest version',exact:true}).click();await boundedHeld(old.fetched,5000);expect(old.failed).toBe(false);expect(old.response).toBeDefined();
        await expect(a.getByText('Questions are loading or saving.',{exact:true})).toBeVisible();
        if(mode==='revision') {await a.getByLabel('Parent revision',{exact:true}).fill('3');await expect(a.getByLabel('Parent revision',{exact:true})).toHaveValue('3');await expect(a.getByText('Unsaved question changes.',{exact:true})).toBeVisible();await a.getByLabel('Parent revision',{exact:true}).fill('2');await expect(a.getByLabel('Parent revision',{exact:true})).toHaveValue('2');}
        else {await a.getByLabel('Parent dirty',{exact:true}).check();await expect(a.getByLabel('Parent dirty',{exact:true})).toBeChecked();await expect(a.getByText('Unsaved question changes.',{exact:true})).toBeVisible();await a.getByLabel('Parent dirty',{exact:true}).uncheck();await expect(a.getByLabel('Parent dirty',{exact:true})).not.toBeChecked();}
        await expect(a.getByRole('button',{name:'Save questions',exact:true})).toBeDisabled();
        await a.getByRole('button',{name:'Check latest version',exact:true}).click();await boundedHeld(fresh.fetched,5000);expect(fresh.failed).toBe(false);expect(fresh.response).toBeDefined();expect(admitted).toBe(2);
        old.release();await boundedHeld(old.task!,7000);expect(old.failed).toBe(false);expect(old.disposed).toBe(true);
        // Old settlement must not clear the newer operation's busy state or permit navigation/save.
        await expect(a.getByText('Questions are loading or saving.',{exact:true})).toBeVisible();
        await expect(a.getByLabel('Choice 1 label',{exact:true})).toHaveValue('Unsaved '+mode);
        await expect(a.getByRole('button',{name:'Save questions',exact:true})).toBeDisabled();
        await a.getByRole('link',{name:'Other route',exact:true}).click();await expect(a).toHaveURL(config.fixtureOrigin+'/edit');
        await expect(a.getByText('Questions are loading or saving.',{exact:true})).toBeVisible();
        fresh.release();await boundedHeld(fresh.task!,7000);expect(fresh.failed).toBe(false);expect(fresh.disposed).toBe(true);
        await expect(a.getByRole('button',{name:'Save questions',exact:true})).toBeEnabled();
        await expect(a.getByText('Unsaved question changes.',{exact:true})).toBeVisible();
        await expect(a.getByLabel('Choice 1 label',{exact:true})).toHaveValue('Unsaved '+mode);expect(await callbacks.inspectA()).toEqual(beforeDenial);expect(unexpected).toBe(false);
      }finally{
        old.release();fresh.release();
        try{await boundedHeld(Promise.all(slots.map(owned=>owned.task)),7000);}
        finally{await a.unroute(pattern,handler);}
        for(const owned of slots)if(owned.response)expect(owned.disposed).toBe(true);
      }
    }
    stage = 8;
    await dialog(a,false,()=>a.getByRole('link',{name:'Other route',exact:true}).click());await expect(a).toHaveURL(config.fixtureOrigin+'/edit');await expect(a.getByLabel('Choice 1 label',{exact:true})).toHaveValue('Unsaved dirty');
    await heldRead(a,async()=>{await a.getByRole('link',{name:'Other route',exact:true}).click();await expect(a).toHaveURL(config.fixtureOrigin+'/edit');await expect(a.getByText('Questions are loading or saving.',{exact:true})).toBeVisible();});
    await expect(a.getByRole('button',{name:'Save questions',exact:true})).toBeEnabled();
    await dialog(a,true,()=>a.getByRole('link',{name:'Other route',exact:true}).click());await expect(a.getByText('Other static route',{exact:true})).toBeVisible();await a.goBack();await load(a);await expect(a.getByLabel('Choice 1 label',{exact:true})).toHaveValue('  Duplicate <choice>  ');
    await a.getByLabel('Choice 1 label',{exact:true}).fill('Query unsaved');await dialog(a,false,()=>a.getByRole('link',{name:'Change route query',exact:true}).click());await expect(a).toHaveURL(config.fixtureOrigin+'/edit');await expect(a.getByLabel('Choice 1 label',{exact:true})).toHaveValue('Query unsaved');
    await dialog(a,true,()=>a.getByRole('link',{name:'Change route query',exact:true}).click());await expect(a).toHaveURL(config.fixtureOrigin+'/edit?view=choices#preview');await expect(a.getByRole('button',{name:'Load questions',exact:true})).toBeVisible();await load(a);await expect(a.getByLabel('Choice 1 label',{exact:true})).toHaveValue('  Duplicate <choice>  ');expect(await callbacks.inspectA()).toEqual(beforeDenial);

    stage = 6;
    await question(a).fill('Revoked mutation'); await callbacks.revokeOwnerA();
    await a.getByRole('button', { name: 'Save questions', exact: true }).click();
    await expect(a.getByText('Questions could not be saved. Your edits are kept.', { exact: true })).toBeVisible(); await expect(question(a)).toHaveValue('Revoked mutation');
    await a.getByRole('button', { name: 'Discard edits and reload', exact: true }).click();
    await expect(a.getByText('Questions could not be loaded. Try again.', { exact: true })).toBeVisible(); expect(await callbacks.inspectA()).toEqual(beforeDenial);
    expect(denied).toBe(0); return { cases: 8 };
  } catch { throw Error(stage === 1 ? `JOURNEY_BROWSER_CASE_1_${firstPhase}` : `JOURNEY_BROWSER_CASE_${stage}`); }
  finally {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.all(contexts.map(context => context.close())), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('JOURNEY_CONTEXT_CLOSE')), 5000); })]); }
    catch { throw Error('JOURNEY_CONTEXT_CLOSE'); }
    finally { if (timer) clearTimeout(timer); }
    if(closedContexts.size!==contexts.length || contexts.some(context=>context.pages().length!==0))throw Error('JOURNEY_CONTEXT_CLOSE');
  }
}
