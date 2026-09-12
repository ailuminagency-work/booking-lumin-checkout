/** Trusted startup registration for the dedicated runtime asset pair. No application routes. */
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, parse } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { modePolicyProfiles } from './mode-policy-http';
import { modeRecord } from './mode-installation-contracts';
const errorBody = Buffer.from(JSON.stringify({error:'ASSET_UNAVAILABLE'}));
const MAX = 262144;
async function regular(file: string, maximum: number): Promise<Buffer> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum) throw Error('INVALID_RUNTIME_ASSET');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.dev !== stat.dev || before.ino !== stat.ino || before.size !== stat.size) throw Error('INVALID_RUNTIME_ASSET');
    const data = Buffer.alloc(maximum + 1);
    let total = 0;
    while (total < data.length) { const r = await handle.read(data,total,data.length-total,null); if (!r.bytesRead) break; total += r.bytesRead; }
    if (total !== stat.size || total > maximum) throw Error('INVALID_RUNTIME_ASSET');
    return Buffer.from(data.subarray(0,total));
  } finally { await handle.close(); }
}
export async function loadModeRuntimeAssets(directory: string) {
  const absolute = resolve(directory);
  // Reject redirected ancestors as well as the final directory and files.
  let cursor = parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor,part);
    if ((await lstat(cursor)).isSymbolicLink()) throw Error('INVALID_RUNTIME_ASSET_DIRECTORY');
  }
  if (await realpath(absolute) !== absolute || !(await lstat(absolute)).isDirectory()) throw Error('INVALID_RUNTIME_ASSET_DIRECTORY');
  const bytes = await regular(join(absolute,'manifest.json'),8192);
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { throw Error('INVALID_RUNTIME_MANIFEST'); }
  const manifest = modeRecord(raw,['schemaVersion','profile','loader','controller']);
  if (manifest.schemaVersion !== 1) throw Error('INVALID_RUNTIME_MANIFEST');
  const profile = modePolicyProfiles([manifest.profile])[0]!;
  const assets = new Map<string,Buffer>();
  const files = ['manifest.json'];
  let controllerSha256 = '';
  for (const name of ['loader','controller'] as const) {
    const asset = modeRecord(manifest[name],['file','sha256','bytes']);
    if (typeof asset.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(asset.sha256) || asset.file !== `booking-lumin-${name}.${asset.sha256}.js` || !Number.isInteger(asset.bytes) || (asset.bytes as number) < 1 || (asset.bytes as number) > MAX) throw Error('INVALID_RUNTIME_MANIFEST');
    const file = asset.file as string;
    const data = await regular(join(absolute,file),MAX);
    if (data.length !== asset.bytes || createHash('sha256').update(data).digest('hex') !== asset.sha256) throw Error('INVALID_RUNTIME_ASSET');
    if (name === 'loader' && profile.loaderUrl !== profile.rendererOrigin+'/assets/'+file) throw Error('INVALID_RUNTIME_MANIFEST');
    if (name === 'controller') controllerSha256 = asset.sha256;
    files.push(file); assets.set('/assets/'+file,data);
  }
  if (JSON.stringify((await readdir(absolute)).sort()) !== JSON.stringify(files.sort())) throw Error('INVALID_RUNTIME_ASSET_INVENTORY');
  const origin = new URL(profile.rendererOrigin);
  let closed = false;
  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const head = req.method === 'HEAD';
    function respond(status: number, body = errorBody): void {
      if (res.destroyed || res.writableEnded) return;
      res.statusCode = status;
      const success = status === 200;
      res.setHeader('Content-Type',success?'application/javascript;charset=utf-8':'application/json;charset=utf-8');
      res.setHeader('Content-Length',body.length);
      res.setHeader('Cache-Control',success?'public,max-age=31536000,immutable':'no-store,max-age=0');
      for (const h of ['CDN-Cache-Control','Netlify-CDN-Cache-Control']) res.setHeader(h,success?'public,max-age=31536000,immutable':'no-store');
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
      if (success) res.setHeader('Access-Control-Allow-Origin','*');
      if (status === 405) res.setHeader('Allow','GET, HEAD');
      res.end(head?undefined:body);
    }
    if (closed) return respond(503);
    const target = req.url ?? '';
    if (!target || Buffer.byteLength(target)>256 || !/^[\x20-\x7e]+$/.test(target) || !target.startsWith('/') || /[%?#\\]/.test(target) || target.includes('//') || target.split('/').some(p=>p==='.'||p==='..')) return respond(400);
    const headers: Record<string,string> = Object.create(null);
    let size = 0;
    if (req.rawHeaders.length%2) return respond(400);
    for (let i=0;i<req.rawHeaders.length;i+=2) {
      const key = req.rawHeaders[i]!.toLowerCase(), value = req.rawHeaders[i+1]!;
      size += Buffer.byteLength(key)+Buffer.byteLength(value)+4;
      if (size>8192) return respond(400);
      if (['host','authorization','cookie','content-length','transfer-encoding','range','if-range'].includes(key)) {
        if (Object.hasOwn(headers,key)) return respond(400);
        headers[key]=value;
      }
    }
    const socket = req.socket as TLSSocket;
    if (!socket.encrypted || socket.servername !== origin.hostname || headers.host !== origin.host || ['authorization','cookie','transfer-encoding','range','if-range'].some(k=>Object.hasOwn(headers,k)) || (headers['content-length'] !== undefined && headers['content-length'] !== '0')) return respond(400);
    if (req.method !== 'GET' && req.method !== 'HEAD') return respond(405);
    const asset = assets.get(target);
    if (!asset) return respond(404);
    respond(200,asset);
  };
  return Object.freeze({profile,controllerSha256,handle,close:()=>{closed=true;assets.clear();}});
}
