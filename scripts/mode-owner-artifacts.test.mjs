import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateOwnerArtifacts} from './mode-owner-artifacts.mjs';
const id='12345678-1234-1234-1234-123456789abc';
async function fixture(summary={schemaVersion:1,status:'passed',category:'COMPLETE',events:[{id:'owner-01',status:'passed',durationMs:1}],screenshots:[]}){
 const root=await mkdtemp(join(tmpdir(),'lumin-owner-artifacts-')),dir=join(root,'.cache/mode-owner-artifacts',id);await mkdir(dir,{recursive:true});await writeFile(join(dir,'summary.json'),JSON.stringify(summary));return {root,dir};
}
test('only exact reviewed files are returned',async()=>{const {root}=await fixture();const result=await validateOwnerArtifacts(root,id);assert.equal(result.files.length,1);assert.ok(result.files[0].endsWith('summary.json'));});
test('unreviewed files cannot become upload attachments',async()=>{const {root,dir}=await fixture();await writeFile(join(dir,'credential.txt'),'private-marker');await assert.rejects(validateOwnerArtifacts(root,id));});
test('unknown fields and empty or skipped passing runs fail',async()=>{for(const extra of [{credentials:'private-marker'},{events:[]},{events:[{id:'owner-01',status:'skipped',durationMs:0}]}]){const {root}=await fixture({schemaVersion:1,status:'passed',category:'COMPLETE',events:[{id:'owner-01',status:'passed',durationMs:1}],screenshots:[],...extra});await assert.rejects(validateOwnerArtifacts(root,id));}});
test('traversal identifiers never reach filesystem access',async()=>{await assert.rejects(validateOwnerArtifacts('.', '../private-marker'));});

test('redirected artifact parents are rejected before file access',async()=>{
 const {symlink}=await import('node:fs/promises');
 const target=await fixture(),root=await mkdtemp(join(tmpdir(),'lumin-owner-redirect-'));
 await symlink(join(target.root,'.cache'),join(root,'.cache'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(validateOwnerArtifacts(root,id));
});
test('oversized or duplicate screenshots are not approved',async()=>{
 const summary={schemaVersion:1,status:'passed',category:'COMPLETE',events:[{id:'owner-01',status:'passed',durationMs:1}],screenshots:['owner-01-320.png']};
 const {root,dir}=await fixture(summary);await writeFile(join(dir,'owner-01-320.png'),Buffer.alloc(5*1024*1024+1));await assert.rejects(validateOwnerArtifacts(root,id));
 const duplicate=await fixture({...summary,screenshots:['owner-01-320.png','owner-01-320.png']});await assert.rejects(validateOwnerArtifacts(duplicate.root,id));
});
