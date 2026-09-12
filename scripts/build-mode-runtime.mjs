import { build, version } from 'esbuild';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInstallationProfile } from '../packages/contracts/src/installation.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX = 262144;
export function runtimeIdentity(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw Error('INVALID_RUNTIME_IDENTITY');
  const keys = ['abiVersion', 'profileVersion', 'rendererOrigin', 'apiOrigin', 'portalOrigin'];
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(k => !Object.getOwnPropertyDescriptor(value,k)?.enumerable || !('value' in Object.getOwnPropertyDescriptor(value,k)))) throw Error('INVALID_RUNTIME_IDENTITY');
  if (value.abiVersion !== 1) throw Error('INVALID_RUNTIME_IDENTITY');
  const p = parseInstallationProfile({profileVersion:value.profileVersion,rendererOrigin:value.rendererOrigin,apiOrigin:value.apiOrigin,portalOrigin:value.portalOrigin,loaderUrl:value.rendererOrigin+'/assets/booking-lumin-loader.'+'0'.repeat(64)+'.js'});
  for (const origin of [p.rendererOrigin,p.apiOrigin,p.portalOrigin]) {
    const host = new URL(origin).hostname;
    if (origin.length > 300 || !/^[\x00-\x7f]+$/.test(origin) || host.includes(':') || host.split('.').some(x=>x.startsWith('xn--')) || !/[a-z]/.test(host.split('.').at(-1)) || /^0x[0-9a-f]*$/.test(host.split('.').at(-1))) throw Error('INVALID_RUNTIME_IDENTITY');
  }
  return Object.freeze({abiVersion:1,profileVersion:p.profileVersion,rendererOrigin:p.rendererOrigin,apiOrigin:p.apiOrigin,portalOrigin:p.portalOrigin});
}
export async function buildModeRuntime({identity: raw, outRoot = join(root,'.cache','mode-runtime-build')}) {
  const identity = runtimeIdentity(raw);
  if (version !== '0.25.12') throw Error('RUNTIME_BUILD_VERSION');
  const expected = join(root,'.cache','mode-runtime-build');
  if (resolve(outRoot) !== expected) throw Error('INVALID_RUNTIME_OUTPUT');
  const canonical = await realpath(root);
  for (const parts of [['.cache'],['.cache','mode-runtime-build']]) {
    const dir = join(root,...parts);
    await mkdir(dir,{recursive:true});
    if ((await lstat(dir)).isSymbolicLink() || await realpath(dir) !== join(canonical,...parts)) throw Error('REDIRECTED_RUNTIME_OUTPUT');
  }
  const directory = join(expected,randomUUID());
  await mkdir(directory);
  const emit = async (name, define) => {
    const result = await build({absWorkingDir:root,entryPoints:[`packages/flow-ui/entries/mode-${name}.ts`],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',minify:true,sourcemap:false,legalComments:'none',metafile:true,logLevel:'silent',define});
    if (result.outputFiles.length !== 1 || Object.values(result.metafile.outputs).some(o=>o.imports.length)) throw Error('RUNTIME_EXTERNAL_DEPENDENCY');
    const data = result.outputFiles[0].contents;
    if (!data.length || data.length > MAX) throw Error('RUNTIME_ASSET_SIZE');
    const sha256 = createHash('sha256').update(data).digest('hex');
    const file = `booking-lumin-${name}.${sha256}.js`;
    await writeFile(join(directory,file),data,{flag:'wx'});
    return Object.freeze({file,sha256,bytes:data.length});
  };
  const loader = await emit('loader',{'__MODE_IDENTITY__':JSON.stringify(identity)});
  const {abiVersion,...origins} = identity;
  const profile = parseInstallationProfile({...origins,loaderUrl:identity.rendererOrigin+'/assets/'+loader.file});
  const controller = await emit('controller',{'__MODE_PROFILE__':JSON.stringify(profile)});
  const manifest = Object.freeze({schemaVersion:1,profile,loader,controller});
  await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest)+'\n',{flag:'wx'});
  return Object.freeze({directory,manifest});
}
