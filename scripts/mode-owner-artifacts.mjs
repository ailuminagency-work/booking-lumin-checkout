import { lstat, readdir, open, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { constants } from 'node:fs';
const fixed = () => { throw Error('OWNER_ARTIFACT_VALIDATION_FAILED'); };
const keys = (v, expected) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v,k));
async function boundedFile(file, limit, headerOnly = false) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > limit) fixed();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit || stat.ino !== before.ino || stat.dev !== before.dev) fixed();
    const buffer = Buffer.alloc(headerOnly ? 8 : limit + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (!headerOnly && offset > limit) fixed();
    return buffer.subarray(0,offset);
  } finally { await handle.close(); }
}
/** Returns only exact reviewed files. Never upload a directory or framework output glob. */
export async function validateOwnerArtifacts(workspace, runId) {
  if (typeof runId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId)) fixed();
  const root = resolve(workspace), actual = await realpath(root);
  let directory = root;
  for (const part of ['.cache','mode-owner-artifacts',runId]) {
    directory = join(directory,part);
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== join(actual,...directory.slice(root.length+1).split(/[\\/]/))) fixed();
  }
  const summaryPath = join(directory,'summary.json'), info = await lstat(summaryPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) fixed();
  const summaryBytes = await boundedFile(summaryPath,65536);
  if (summaryBytes.length > 65536) fixed();
  const s = JSON.parse(summaryBytes.toString('utf8'));
  if (!keys(s,['schemaVersion','status','category','events','screenshots']) || s.schemaVersion !== 1 || !['passed','failed','timedout','interrupted'].includes(s.status) || !['COMPLETE','OUTPUT_SENTINEL_DETECTED','EVENT_BOUND','RUNNER_ERROR'].includes(s.category) || !Array.isArray(s.events) || s.events.length > 100 || !Array.isArray(s.screenshots) || s.screenshots.length > 12) fixed();
  for (const event of s.events) {
    if (!keys(event,['id','status','durationMs']) || !/^owner-[0-9]{2}$/.test(event.id) || !['passed','failed','timedOut','skipped','interrupted'].includes(event.status) || !Number.isSafeInteger(event.durationMs) || event.durationMs < 0 || event.durationMs > 600000) fixed();
  }
  if (s.status === 'passed' && (s.category !== 'COMPLETE' || !s.events.length || s.events.some(e=>e.status !== 'passed'))) fixed();
  if (new Set(s.screenshots).size !== s.screenshots.length || s.screenshots.some(name => typeof name !== 'string' || !/^owner-[0-9]{2}-(320|768|1440)\.png$/.test(name))) fixed();
  const names = await readdir(directory), allowed = ['summary.json',...s.screenshots];
  if (names.length !== allowed.length || names.some(n=>!allowed.includes(n))) fixed();
  for (const name of s.screenshots) {
    const file = join(directory,name), stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5*1024*1024) fixed();
    const data = await boundedFile(file,5*1024*1024,true);
    if (data.length > 5*1024*1024 || !data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fixed();
  }
  return Object.freeze({status:s.status,category:s.category,files:Object.freeze(allowed.map(n=>join(directory,n)))});
}
