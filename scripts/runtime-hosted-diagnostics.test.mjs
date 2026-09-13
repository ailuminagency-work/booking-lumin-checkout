import test from 'node:test';
import assert from 'node:assert/strict';
import { hostedFailurePhase, HOSTED_FAILURE_PHASES } from './runtime-hosted-diagnostics.mjs';
test('only complete approved literals project fixed phases', () => {
  for (const phase of HOSTED_FAILURE_PHASES.filter(p => p !== 'UNKNOWN')) {
    for (const prefix of ['', 'Error: ']) assert.equal(hostedFailurePhase([{message:prefix+'SAFE_RUNTIME_ASSERTION_FAILED_'+phase}]),phase);
  }
  assert.ok(Object.isFrozen(HOSTED_FAILURE_PHASES));
});
test('untrusted messages and error cardinality cannot add diagnostic data', () => {
  const known='SAFE_RUNTIME_ASSERTION_FAILED_HOSTED_SETUP';
  for (const errors of [undefined,null,{},[],[{message:known},{message:known}], [{message:'SAFE_RUNTIME_ASSERTION_FAILED_PRIVATE_SENTINEL'}], [{message:known+'PRIVATE_SENTINEL'}], [{message:'PRIVATE_SENTINEL'+known}], [{message:known+'\nstack'}], [{message:known.repeat(100)}], [{message:1}], [Object.create({message:known})]]) assert.equal(hostedFailurePhase(errors),'UNKNOWN');
});
test('accessors, proxies and revoked proxies are never invoked', () => {
  let touched=0;const getter=()=>{touched++;throw Error('PRIVATE_SENTINEL');};
  const error=Object.defineProperty({},'message',{get:getter});
  const array=[];Object.defineProperty(array,'0',{get:getter});
  const proxy=new Proxy({},{get:getter,getOwnPropertyDescriptor:getter});
  const arrayProxy=new Proxy([],{get:getter,getOwnPropertyDescriptor:getter});
  const revoked=Proxy.revocable([],{});revoked.revoke();
  for(const errors of [[error],array,[proxy],arrayProxy,revoked.proxy,[revoked.proxy]]) assert.equal(hostedFailurePhase(errors),'UNKNOWN');
  assert.equal(touched,0);
});

test('actual reporter failure round-trips through unchanged collector without private errors', async () => {
  const {default:Reporter}=await import('../tests/mode-runtime/safe-reporter.ts');
  const fs=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join,resolve,sep}=await import('node:path');
  const {randomUUID}=await import('node:crypto');
  const {collectRuntimeArtifacts}=await import('./collect-mode-runtime-artifacts.mjs');
  const temp=await fs.realpath(tmpdir()),root=await fs.mkdtemp(join(temp,'lumin-hosted-diagnostic-'));
  const previous=process.cwd(), previousRun=process.env.MODE_RUNTIME_ARTIFACT_RUN_ID;
  try {
    process.chdir(root);
    for(const errors of [[{message:'SAFE_RUNTIME_ASSERTION_FAILED_HOSTED_V_ONE_FRAME_DENIAL',stack:'PRIVATE_SENTINEL'}],[{message:'PRIVATE_SENTINEL'}]]) {
      const run=randomUUID();process.env.MODE_RUNTIME_ARTIFACT_RUN_ID=run;
      const reporter=new Reporter();reporter.onBegin();
      reporter.onTestEnd({title:'runtime-01 fixed'}, {status:'failed',duration:5,errors});
      reporter.onTestEnd({title:'runtime-02 fixed'}, {status:'failed',duration:5,errors});
      await reporter.onEnd({status:'failed'});
      const file=join(root,'.cache','mode-runtime-artifacts',run,'summary.json');
      const raw=await fs.readFile(file,'utf8'),summary=JSON.parse(raw);
      assert.equal(raw.includes('PRIVATE_SENTINEL'),false);assert.equal(summary.schemaVersion,2);
      assert.equal(summary.events[0].failurePhase,errors[0].message==='PRIVATE_SENTINEL'?'UNKNOWN':'HOSTED_V_ONE_FRAME_DENIAL');
      assert.deepEqual(Object.keys(summary.events[1]),['id','status','durationMs']);
      await fs.writeFile(join(root,'.cache','mode-runtime-browser-public.json'),JSON.stringify({schemaVersion:1,status:'failed',cryptoLayout:'public',artifactRunId:run}));
      assert.deepEqual(await collectRuntimeArtifacts(root),[file]);
    }
    const run=randomUUID();process.env.MODE_RUNTIME_ARTIFACT_RUN_ID=run;
    const reporter=new Reporter();reporter.onBegin();
    const {RUNTIME_CASE_IDS,RUNTIME_SCREENSHOTS}=await import('./mode-runtime-artifacts.mjs');
    for(const id of RUNTIME_CASE_IDS) reporter.onTestEnd({title:id+' fixed'}, {status:'passed',duration:1,errors:[{message:'PRIVATE_SENTINEL'}]});
    const dir=join(root,'.cache','mode-runtime-artifacts',run);
    for(const name of RUNTIME_SCREENSHOTS) await fs.writeFile(join(dir,name),Buffer.from([137,80,78,71,13,10,26,10]));
    await reporter.onEnd({status:'passed'});
    const raw=await fs.readFile(join(dir,'summary.json'),'utf8'),summary=JSON.parse(raw);
    assert.equal(raw.includes('PRIVATE_SENTINEL'),false);assert.equal(summary.status,'passed');
    assert.ok(summary.events.every(e=>Object.keys(e).length===3));
    await fs.writeFile(join(root,'.cache','mode-runtime-browser-public.json'),JSON.stringify({schemaVersion:1,status:'passed',cryptoLayout:'public',artifactRunId:run}));
    assert.equal((await collectRuntimeArtifacts(root)).length,7);
  } finally {
    process.chdir(previous);if(previousRun===undefined)delete process.env.MODE_RUNTIME_ARTIFACT_RUN_ID;else process.env.MODE_RUNTIME_ARTIFACT_RUN_ID=previousRun;
    const actual=await fs.realpath(root);assert.equal(actual,resolve(root));assert.ok(actual.startsWith(temp+sep+'lumin-hosted-diagnostic-'));await fs.rm(actual,{recursive:true,force:false});
  }
});


test('prefixed literals remain exact and cannot carry diagnostic payloads', () => {
  const literal = 'SAFE_RUNTIME_ASSERTION_FAILED_HOSTED_SETUP';
  const known = 'Error: ' + literal;
  for (const message of [
    'TypeError: ' + literal, 'Error:' + literal, 'Error:  ' + literal,
    ' Error: ' + literal, known + ' ', known + 'PRIVATE_SENTINEL',
    'PRIVATE_SENTINEL' + known, known + '\nstack', known + '\r\n',
    '\u001b[31m' + known + '\u001b[0m', known + ': cause',
  ]) assert.equal(hostedFailurePhase([{message}]), 'UNKNOWN');
  assert.equal(hostedFailurePhase([{message: known}, {message: known}]), 'UNKNOWN');
  let touched = 0;
  const accessor = Object.defineProperty({}, 'message', {get() {touched++; return known;}});
  assert.equal(hostedFailurePhase([accessor]), 'UNKNOWN');
  assert.equal(touched, 0);
});

test('pinned Playwright serializes real failures through the safe reporter', async () => {
  const fs = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join, resolve, sep} = await import('node:path');
  const {fileURLToPath, pathToFileURL} = await import('node:url');
  const {randomUUID} = await import('node:crypto');
  const {runBoundedChild} = await import('./run-mode-owner-browser.mjs');
  const {collectRuntimeArtifacts} = await import('./collect-mode-runtime-artifacts.mjs');
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const temp = await fs.realpath(tmpdir());
  const root = await fs.mkdtemp(join(temp, 'lumin-playwright-phase-'));
  const run = randomUUID();
  try {
    const playwright = join(repo, 'node_modules/@playwright/test');
    const fixed = 'SAFE_RUNTIME_ASSERTION_FAILED_HOSTED_V_ONE_FRAME_DENIAL';
    await fs.writeFile(join(root, 'probe.spec.cjs'), `
      const {test,expect}=require(${JSON.stringify(playwright)});
      test('runtime-01 approved',async()=>{throw new Error(${JSON.stringify(fixed)});});
      test('runtime-02 sentinel',async()=>{throw new Error('PRIVATE_SENTINEL'+${JSON.stringify(fixed)});});
      test('runtime-03 multiple',async()=>{expect.soft(false).toBe(true);throw new Error(${JSON.stringify(fixed)});});
    `);
    await fs.writeFile(join(root, 'reporter.mjs'), `
      import ImportedReporter from ${JSON.stringify(pathToFileURL(join(repo, 'tests/mode-runtime/safe-reporter.ts')).href)};
      import {hostedFailurePhase} from ${JSON.stringify(new URL('./runtime-hosted-diagnostics.mjs', import.meta.url).href)};
      import fs from 'node:fs';
      import path from 'node:path';
      const Reporter=typeof ImportedReporter==='function'?ImportedReporter:ImportedReporter.default;
      export default class extends Reporter {
        rows=[];
        onTestEnd(test,result) {
          super.onTestEnd(test,result);
          if(this.rows.length>=3) throw Error('PROBE_EVENT_BOUND');
          this.rows.push({count:result.errors.length===1?1:result.errors.length===2?2:0,
            prefixed:result.errors.length===1&&result.errors[0].message===${JSON.stringify('Error: '+fixed)},
            phase:hostedFailurePhase(result.errors)});
        }
        async onEnd(result) {
          const outcome=await super.onEnd(result);
          fs.writeFileSync(path.join(process.cwd(),'projection.json'),JSON.stringify(this.rows),{flag:'wx'});
          return outcome;
        }
      }
    `);
    await fs.writeFile(join(root, 'probe.config.cjs'), `module.exports={testDir:__dirname,testMatch:'probe.spec.cjs',workers:1,retries:0,timeout:5000,globalTimeout:20000,fullyParallel:false,outputDir:__dirname+'/output',reporter:[[__dirname+'/reporter.mjs']]};`);
    const child = await runBoundedChild(process.execPath, ['--import',pathToFileURL(join(repo,'node_modules/tsx/dist/loader.mjs')).href,join(repo,'node_modules/@playwright/test/cli.js'),'test','--config='+join(root,'probe.config.cjs')], {
      cwd:root, env:{...process.env,MODE_RUNTIME_ARTIFACT_RUN_ID:run}, timeoutMs:30000, outputLimit:8192,
    });
    assert.deepEqual(child, {category:'BROWSER_TEST_FAILED',status:'failed'});
    const projected = await fs.readFile(join(root,'projection.json'),'utf8');
    assert.ok(Buffer.byteLength(projected)<2048);
    assert.deepEqual(JSON.parse(projected), [
      {count:1,prefixed:true,phase:'HOSTED_V_ONE_FRAME_DENIAL'},
      {count:1,prefixed:false,phase:'UNKNOWN'},
      {count:2,prefixed:false,phase:'UNKNOWN'},
    ]);
    const file=join(root,'.cache','mode-runtime-artifacts',run,'summary.json');
    const raw=await fs.readFile(file,'utf8');
    assert.equal(raw.includes('PRIVATE_SENTINEL'),false);
    const summary=JSON.parse(raw);
    assert.equal(summary.schemaVersion,2);
    assert.equal(summary.status,'failed');
    assert.equal(summary.category,'COMPLETE');
    assert.equal(summary.events.length,3);
    assert.equal(summary.events[0].failurePhase,'HOSTED_V_ONE_FRAME_DENIAL');
    assert.ok(summary.events.every(e=>e.status==='failed'));
    assert.ok(summary.events.slice(1).every(e=>Object.keys(e).length===3));
    await fs.writeFile(join(root,'.cache','mode-runtime-browser-public.json'),JSON.stringify({schemaVersion:1,status:'failed',cryptoLayout:'public',artifactRunId:run}));
    assert.deepEqual(await collectRuntimeArtifacts(root),[file]);
  } finally {
    const actual=await fs.realpath(root);
    assert.equal(actual,resolve(root));
    assert.ok(actual.startsWith(temp+sep+'lumin-playwright-phase-'));
    await fs.rm(actual,{recursive:true,force:false});
  }
});
