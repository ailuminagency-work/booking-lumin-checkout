import { lstat, open, appendFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateDocumentArtifacts } from './mode-document-artifacts.mjs';
const fail=()=>{throw Error('DOCUMENT_ARTIFACT_COLLECTION_FAILED');};
export async function collectDocumentArtifacts(workspace) {
  const root=resolve(workspace), actual=await realpath(root), cache=resolve(root,'.cache');
  try { const stat=await lstat(cache); if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(cache)!==resolve(actual,'.cache'))fail(); }
  catch(error){if(error.code==='ENOENT')return Object.freeze([]);throw error;}
  const files=[];
  for(const layout of ['public','extensions']) {
    const path=resolve(cache,'mode-document-browser-'+layout+'.json');
    let before;
    try {before=await lstat(path);} catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(!before.isFile()||before.isSymbolicLink()||before.size>65536)fail();
    const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let raw;
    try {
      const stat=await handle.stat();if(!stat.isFile()||stat.size>65536||stat.ino!==before.ino||stat.dev!==before.dev)fail();
      const buffer=Buffer.alloc(65537);let offset=0;
      while(offset<buffer.length){const result=await handle.read(buffer,offset,buffer.length-offset,offset);if(!result.bytesRead)break;offset+=result.bytesRead;}
      if(offset>65536)fail();raw=buffer.subarray(0,offset).toString('utf8');
    }finally{await handle.close();}
    const receipt=JSON.parse(raw);
    if(receipt?.schemaVersion!==1||!['passed','failed'].includes(receipt.status))fail();
    if(typeof receipt.artifactRunId!=='string'){if(receipt.status==='failed')continue;fail();}
    if(receipt.cryptoLayout!==layout)fail();
    let approved;
    try{approved=await validateDocumentArtifacts(root,receipt.artifactRunId);}
    catch{if(receipt.status==='failed')continue;fail();}
    if(receipt.status==='passed'&&approved.status!=='passed')fail();
    files.push(...approved.files);
  }
  if(files.length>14||new Set(files).size!==files.length)fail();
  return Object.freeze(files);
}
async function main(){
  try{
    const files=await collectDocumentArtifacts(process.cwd());
    if(process.env.GITHUB_OUTPUT){const delimiter='document_'+randomUUID();await appendFile(process.env.GITHUB_OUTPUT,`files<<${delimiter}\n${files.join('\n')}\n${delimiter}\n`);}
    process.stdout.write(JSON.stringify({schemaVersion:1,category:'REVIEWED_ARTIFACT_PATHS',count:files.length})+'\n');
  }catch{process.stdout.write('{"schemaVersion":1,"category":"ARTIFACT_COLLECTION_FAILED"}\n');process.exitCode=1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
