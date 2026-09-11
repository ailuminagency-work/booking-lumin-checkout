import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateOwnerArtifacts } from './mode-owner-artifacts.mjs';
const files=[];
try {
  for (const layout of ['public','extensions']) {
    let raw;
    try { raw=await readFile(resolve('.cache',`mode-owner-browser-${layout}.json`),'utf8'); }
    catch(error) { if(error.code==='ENOENT')continue;throw error; }
    if(Buffer.byteLength(raw)>65536)throw Error();
    const receipt=JSON.parse(raw);
    if(typeof receipt.artifactRunId!=='string')continue;
    let approved;
    try { approved=await validateOwnerArtifacts(process.cwd(),receipt.artifactRunId); }
    catch { if(receipt.status==='failed')continue;throw Error(); }
    files.push(...approved.files);
  }
  if(files.length>26||new Set(files).size!==files.length)throw Error();
  if(process.env.GITHUB_OUTPUT){const delimiter='owner_'+randomUUID();await appendFile(process.env.GITHUB_OUTPUT,`files<<${delimiter}\n${files.join('\n')}\n${delimiter}\n`);}
  process.stdout.write(JSON.stringify({schemaVersion:1,category:'REVIEWED_ARTIFACT_PATHS',count:files.length})+'\n');
} catch {
  process.stdout.write('{"schemaVersion":1,"category":"ARTIFACT_COLLECTION_FAILED"}\n');process.exitCode=1;
}
