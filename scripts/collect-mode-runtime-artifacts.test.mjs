import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,unlink,rm,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { collectRuntimeArtifacts } from './collect-mode-runtime-artifacts.mjs';
import { RUNTIME_CASE_IDS,RUNTIME_SCREENSHOTS } from './mode-runtime-artifacts.mjs';
test('runtime collector returns only separately validated fixed artifacts',async t=>{
 const temp=await realpath(tmpdir()),root=await mkdtemp(join(temp,'lumin-runtime-collector-')),runs={public:randomUUID(),extensions:randomUUID()};
 const receiptPath=layout=>join(root,'.cache','mode-runtime-browser-'+layout+'.json');
 const receipt=(layout,changes={})=>({schemaVersion:1,status:'passed',cryptoLayout:layout,artifactRunId:runs[layout],...changes});
 const save=(layout,value)=>writeFile(receiptPath(layout),JSON.stringify(value));
 try{
  await t.test('absent cache yields no upload paths',async()=>assert.deepEqual(await collectRuntimeArtifacts(root),[]));
  for(const layout of ['public','extensions']){
   const dir=join(root,'.cache','mode-runtime-artifacts',runs[layout]);await mkdir(dir,{recursive:true});
   await writeFile(join(dir,'summary.json'),JSON.stringify({schemaVersion:1,status:'passed',category:'COMPLETE',events:RUNTIME_CASE_IDS.map(id=>({id,status:'passed',durationMs:1})),screenshots:[...RUNTIME_SCREENSHOTS]}));
   for(const name of RUNTIME_SCREENSHOTS)await writeFile(join(dir,name),Buffer.from([137,80,78,71,13,10,26,10]));
   await save(layout,receipt(layout));
  }
  await t.test('two layouts collect fourteen exact files and never receipt or key paths',async()=>{const files=await collectRuntimeArtifacts(root);assert.equal(files.length,14);assert.ok(Object.isFrozen(files));assert.ok(files.every(p=>p.endsWith('.png')||p.endsWith('summary.json')));});
  await t.test('layout mismatch cannot reuse other run proof',async()=>{await save('public',receipt('public',{cryptoLayout:'extensions'}));await assert.rejects(collectRuntimeArtifacts(root));await save('public',receipt('public'));});
  await t.test('duplicate run cannot yield repeated upload paths',async()=>{await save('extensions',receipt('extensions',{artifactRunId:runs.public}));await assert.rejects(collectRuntimeArtifacts(root));await save('extensions',receipt('extensions'));});
  await t.test('unknown receipt status and successful missing run fail',async()=>{for(const change of [{status:'unknown'},{artifactRunId:undefined},{artifactRunId:'../private'},{schemaVersion:2}]){await save('public',receipt('public',change));await assert.rejects(collectRuntimeArtifacts(root));}await save('public',receipt('public'));});
  await t.test('malformed or oversized receipt is rejected',async()=>{for(const raw of ['{','x'.repeat(65537)]){await writeFile(receiptPath('public'),raw);await assert.rejects(collectRuntimeArtifacts(root));}await save('public',receipt('public'));});
  await t.test('failed startup without a run preserves other valid layout evidence',async()=>{await save('public',{schemaVersion:1,status:'failed'});assert.equal((await collectRuntimeArtifacts(root)).length,7);await save('public',receipt('public'));});
  await t.test('successful receipt cannot bless failed summary',async()=>{const file=join(root,'.cache','mode-runtime-artifacts',runs.public,'summary.json');await writeFile(file,JSON.stringify({schemaVersion:1,status:'failed',category:'RUNNER_ERROR',events:[],screenshots:[...RUNTIME_SCREENSHOTS]}));await assert.rejects(collectRuntimeArtifacts(root));await save('public',receipt('public',{status:'failed'}));assert.equal((await collectRuntimeArtifacts(root)).length,14);});
  await t.test('missing receipt yields no invented proof',async()=>{await unlink(receiptPath('public'));assert.equal((await collectRuntimeArtifacts(root)).length,7);});
 }finally{const actual=await realpath(root);assert.equal(actual,resolve(root));assert.ok(actual.startsWith(temp+sep+'lumin-runtime-collector-'));await rm(actual,{recursive:true,force:false});}
});
