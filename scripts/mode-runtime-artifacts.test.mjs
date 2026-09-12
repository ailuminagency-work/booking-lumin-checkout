import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateRuntimeArtifacts, RUNTIME_CASE_IDS, RUNTIME_SCREENSHOTS } from './mode-runtime-artifacts.mjs';
const png = Buffer.from([137,80,78,71,13,10,26,10]);
test('runtime artifacts require every reviewed case and exact file inventory', async t => {
  const temp=await realpath(tmpdir()),root=await mkdtemp(join(temp,'lumin-runtime-artifacts-')),run=randomUUID();
  const directory=join(root,'.cache','mode-runtime-artifacts',run); await mkdir(directory,{recursive:true});
  const initial={schemaVersion:1,status:'passed',category:'COMPLETE',events:RUNTIME_CASE_IDS.map(id=>({id,status:'passed',durationMs:1})),screenshots:[...RUNTIME_SCREENSHOTS]};
  const summary=value=>writeFile(join(directory,'summary.json'),JSON.stringify(value));
  const reject=()=>assert.rejects(validateRuntimeArtifacts(root,run));
  try {
    for (const name of RUNTIME_SCREENSHOTS) await writeFile(join(directory,name),png,{flag:'wx'});
    await summary(initial);
    await t.test('valid complete manifest yields only seven fixed approved paths',async()=>{const result=await validateRuntimeArtifacts(root,run);assert.equal(result.status,'passed');assert.equal(result.files.length,7);});
    await t.test('missing case cannot certify completion',async()=>{await summary({...initial,events:initial.events.slice(1)});await reject();});
    await t.test('duplicate case cannot substitute for another case',async()=>{await summary({...initial,events:[...initial.events.slice(0,15),initial.events[0]]});await reject();});
    await t.test('unknown case, duration and unreviewed metadata fail',async()=>{for(const event of [{id:'runtime-99',status:'passed',durationMs:1},{id:'runtime-01',status:'passed',durationMs:900001},{...initial.events[0],rawError:'fixture'}]){await summary({...initial,events:[event,...initial.events.slice(1)]});await reject();}});
    await t.test('successful screenshot subset is not complete evidence',async()=>{await summary({...initial,screenshots:initial.screenshots.slice(1)});await reject();});
    await t.test('wrong screenshot name and duplicate screenshot fail',async()=>{for(const names of [[...initial.screenshots.slice(1),'runtime-07-320.png'],[...initial.screenshots.slice(1),initial.screenshots[1]]]){await summary({...initial,screenshots:names});await reject();}});
    await t.test('unknown fields and false success fail',async()=>{for(const s of [{...initial,extra:true},{...initial,category:'RUNNER_ERROR'},{...initial,events:initial.events.map((e,i)=>i?e:{...e,status:'skipped'})}]){await summary(s);await reject();}});
    await t.test('extra framework diagnostic file is never uploaded',async()=>{await summary(initial);const extra=join(directory,'error-context.md');await writeFile(extra,'fixture');try{await reject();}finally{await unlink(extra);}});
    await t.test('PNG signature and size cap are enforced',async()=>{const file=join(directory,RUNTIME_SCREENSHOTS[0]);await writeFile(file,'not png');await reject();await writeFile(file,Buffer.alloc(5*1024*1024+1));await reject();await writeFile(file,png);});
    await t.test('summary bound and run path grammar are enforced',async()=>{await writeFile(join(directory,'summary.json'),'x'.repeat(65537));await reject();await assert.rejects(validateRuntimeArtifacts(root,'../other'));await summary(initial);});
    await t.test('explicit failure remains failure even when its bounded inventory validates',async()=>{await summary({...initial,status:'failed',events:initial.events.map((e,i)=>i?e:{...e,status:'failed'})});assert.equal((await validateRuntimeArtifacts(root,run)).status,'failed');});
    await t.test('schema2 limits fixed phase to failed hosted case and retains schema1',async()=>{
      const phased={...initial.events[0],status:'failed',failurePhase:'HOSTED_V_ONE_INITIAL_READY'};
      const version2={...initial,schemaVersion:2,status:'failed',events:[phased,...initial.events.slice(1)]};
      for(const failurePhase of ['HOSTED_V_ONE_INITIAL_READY','UNKNOWN']){await summary({...version2,events:[{...phased,failurePhase},...initial.events.slice(1)]});assert.equal((await validateRuntimeArtifacts(root,run)).status,'failed');}
      for(const invalid of [
        {...version2,schemaVersion:1}, {...version2,schemaVersion:3}, {...version2,status:'passed'},
        {...version2,events:[{id:'runtime-01',status:'failed',durationMs:1},...initial.events.slice(1)]},
        ...['PRIVATE_SENTINEL','HOSTED_UNKNOWN',null].map(failurePhase=>({...version2,events:[{...phased,failurePhase},...initial.events.slice(1)]})),
        ...['passed','timedOut','skipped','interrupted'].map(status=>({...version2,events:[{...phased,status},...initial.events.slice(1)]})),
        {...version2,events:[{...phased,id:'runtime-02'},initial.events[0],...initial.events.slice(2)]},
      ]){await summary(invalid);await reject();}
      await summary({...initial,schemaVersion:2});assert.equal((await validateRuntimeArtifacts(root,run)).status,'passed');
    });
    await t.test('complete neighboring case remains valid after negative controls',async()=>{await summary(initial);assert.equal((await validateRuntimeArtifacts(root,run)).status,'passed');});
  } finally {const actual=await realpath(root);assert.equal(actual,resolve(root));assert.ok(actual.startsWith(temp+sep+'lumin-runtime-artifacts-'));await rm(actual,{recursive:true,force:false});}
});
