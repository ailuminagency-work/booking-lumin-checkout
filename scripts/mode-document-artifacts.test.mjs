import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateDocumentArtifacts, DOCUMENT_CASE_IDS, DOCUMENT_SCREENSHOTS } from './mode-document-artifacts.mjs';
const png = Buffer.from([137,80,78,71,13,10,26,10]);
test('document artifacts require every reviewed case and exact file inventory', async t => {
  const temp=await realpath(tmpdir()),root=await mkdtemp(join(temp,'lumin-document-artifacts-')),run=randomUUID();
  const directory=join(root,'.cache','mode-document-artifacts',run); await mkdir(directory,{recursive:true});
  const initial={schemaVersion:1,status:'passed',category:'COMPLETE',events:DOCUMENT_CASE_IDS.map(id=>({id,status:'passed',durationMs:1})),screenshots:[...DOCUMENT_SCREENSHOTS]};
  const summary=value=>writeFile(join(directory,'summary.json'),JSON.stringify(value));
  const reject=()=>assert.rejects(validateDocumentArtifacts(root,run));
  try {
    for (const name of DOCUMENT_SCREENSHOTS) await writeFile(join(directory,name),png,{flag:'wx'});
    await summary(initial);
    await t.test('valid complete manifest yields only seven fixed approved paths',async()=>{const result=await validateDocumentArtifacts(root,run);assert.equal(result.status,'passed');assert.equal(result.files.length,7);});
    await t.test('missing case cannot certify completion',async()=>{await summary({...initial,events:initial.events.slice(1)});await reject();});
    await t.test('duplicate case cannot substitute for another case',async()=>{await summary({...initial,events:[...initial.events.slice(0,7),initial.events[0]]});await reject();});
    await t.test('unknown case, duration and unreviewed metadata fail',async()=>{for(const event of [{id:'document-99',status:'passed',durationMs:1},{id:'document-01',status:'passed',durationMs:600001},{...initial.events[0],rawError:'fixture'}]){await summary({...initial,events:[event,...initial.events.slice(1)]});await reject();}});
    await t.test('successful screenshot subset is not complete evidence',async()=>{await summary({...initial,screenshots:initial.screenshots.slice(1)});await reject();});
    await t.test('wrong screenshot name and duplicate screenshot fail',async()=>{for(const names of [[...initial.screenshots.slice(1),'document-07-320.png'],[...initial.screenshots.slice(1),initial.screenshots[1]]]){await summary({...initial,screenshots:names});await reject();}});
    await t.test('unknown fields and false success fail',async()=>{for(const s of [{...initial,extra:true},{...initial,category:'RUNNER_ERROR'},{...initial,events:initial.events.map((e,i)=>i?e:{...e,status:'skipped'})}]){await summary(s);await reject();}});
    await t.test('extra framework diagnostic file is never uploaded',async()=>{await summary(initial);const extra=join(directory,'error-context.md');await writeFile(extra,'fixture');try{await reject();}finally{await unlink(extra);}});
    await t.test('PNG signature and size cap are enforced',async()=>{const file=join(directory,DOCUMENT_SCREENSHOTS[0]);await writeFile(file,'not png');await reject();await writeFile(file,Buffer.alloc(5*1024*1024+1));await reject();await writeFile(file,png);});
    await t.test('summary bound and run path grammar are enforced',async()=>{await writeFile(join(directory,'summary.json'),'x'.repeat(65537));await reject();await assert.rejects(validateDocumentArtifacts(root,'../other'));await summary(initial);});
    await t.test('explicit failure remains failure even when its bounded inventory validates',async()=>{await summary({...initial,status:'failed',events:initial.events.map((e,i)=>i?e:{...e,status:'failed'})});assert.equal((await validateDocumentArtifacts(root,run)).status,'failed');});
    await t.test('complete neighboring case remains valid after negative controls',async()=>{await summary(initial);assert.equal((await validateDocumentArtifacts(root,run)).status,'passed');});
  } finally {const actual=await realpath(root);assert.equal(actual,resolve(root));assert.ok(actual.startsWith(temp+sep+'lumin-document-artifacts-'));await rm(actual,{recursive:true,force:false});}
});
