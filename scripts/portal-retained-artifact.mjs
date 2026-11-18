import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync,writeFileSync,unlinkSync,realpathSync} from 'node:fs';
import {resolve,dirname,parse,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const SERVICE='28c26c3b-b7b2-4d3b-87d8-d94c32c4cf9f',ENVIRONMENT='bb29146d-5fe2-44fc-9798-a74c22ef70c7';
const NAME='portal-release-manifest.json';
const fail=code=>{throw Error(`PORTAL_ARTIFACT_${code}`);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const exactSha=s=>typeof s==='string'&&s.length===40&&/^[0-9a-f]+$/.test(s);
export function selectIdentity(env,git){
 const service=env.RAILWAY_SERVICE_ID,environment=env.RAILWAY_ENVIRONMENT_ID;
 if(service!==SERVICE&&environment!==ENVIRONMENT)return null;
 if(service!==SERVICE||environment!==ENVIRONMENT)fail('DESTINATION');
 const sha=env.RAILWAY_GIT_COMMIT_SHA;if(!exactSha(sha))fail('IDENTITY');
 if(git&&(git.sha!==sha||git.dirty))fail('IDENTITY');return sha;
}
export function disabledFlags(env,define={}){
 for(const key of Object.keys(define))if(key==='import.meta'||key.startsWith('import.meta.env'))fail('OVERRIDE');
 for(const key of ['VITE_PAYMENT_ATTENTION_VISIBILITY','VITE_PAYMENT_ATTENTION_ACKNOWLEDGMENT'])if(env[key]!==undefined&&env[key]!==''&&env[key]!=='false')fail('FLAGS');
 return {attentionVisibility:false,attentionAcknowledgment:false};
}
// Reject symlinks/junctions in every existing path component, not only the leaf.
export function regularPath(path,kind){
 const absolute=resolve(path);let at=parse(absolute).root;
 for(const piece of absolute.slice(at.length).split(/[\\/]/).filter(Boolean)){at=join(at,piece);const s=lstatSync(at);if(s.isSymbolicLink())fail('PATH');}
 const stat=lstatSync(absolute);if(kind==='file'?!stat.isFile():!stat.isDirectory())fail('PATH');return stat;
}
export function collectManifest(out,identity,env,emitted){
 if(!exactSha(identity))fail('IDENTITY');const flags=disabledFlags(env);regularPath(out,'directory');
 const assetsDir=join(out,'assets');regularPath(assetsDir,'directory');
 const names=readdirSync(assetsDir).sort();if(names.length<1||names.length>64)fail('COUNT');
 if(names.some(n=>!/^[-A-Za-z0-9_]+\.(js|css)$/.test(n)||n.includes('\n')))fail('PATH');
 const auxiliary=readdirSync(out).filter(n=>!['index.html','assets'].includes(n)).sort();
 if(auxiliary.some(n=>!['_redirects','staging-install-check.html','staging-install-check.js'].includes(n)))fail('STALE');
 const paths=['index.html',...names.map(n=>'assets/'+n)];
 const expected=Object.keys(emitted).sort();if(expected.join('\n')!==[...paths].sort().join('\n'))fail('STALE');
 let total=0;const hashes=new Map();for(const p of [...paths,...auxiliary]){const file=join(out,p),stat=regularPath(file,'file');if(stat.size>4*1024*1024||(total+=stat.size)>16*1024*1024)fail('SIZE');const bytes=readFileSync(file);if(paths.includes(p)&&hash(bytes)!==emitted[p])fail('STALE');hashes.set(p,hash(bytes));}
 return {portalCommit:identity,apiCommit:'ce544cef714ee524d935ef1f8def78411bf9052e',migrationHead:'0103_payment_readiness_attestation',...flags,htmlSha256:hashes.get('index.html'),assets:names.map(n=>({path:'/assets/'+n,sha256:hashes.get('assets/'+n)})),auxiliaryFiles:auxiliary.map(n=>({path:'/'+n,sha256:hashes.get(n)}))};
}
function gitIdentity(root){try{const opts={cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']};return {sha:execFileSync('git',['rev-parse','HEAD'],opts).trim(),dirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],opts).trim()!==''};}catch{return null;}}
/** Build-only, same resolved Vite config and emitted bundle. Never infers provenance from served bytes. */
export function portalRetainedArtifact(){
 let config,out,identity,emitted,failed=false;
 return {name:'portal-retained-artifact',apply:'build',enforce:'post',
 configResolved(c){config=c;out=resolve(c.root,c.build.outDir);
 // Fixed output root only. Never erase arbitrary user-selected build output.
 if(out!==resolve(c.root,'dist'))fail('OUTPUT');
 try{regularPath(out,'directory');const file=join(out,NAME);try{regularPath(file,'file');unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}}catch(e){if(e.code!=='ENOENT')throw e;}
 identity=selectIdentity(process.env,gitIdentity(c.root)); if(identity)disabledFlags(c.env,c.define);
 },
 buildEnd(error){failed=!!error;},
 generateBundle(_options,bundle){if(!identity)return;emitted={};for(const [name,item] of Object.entries(bundle)){if(name==='index.html'||name.startsWith('assets/')){if(name!=='index.html'&&!/^assets\/[-A-Za-z0-9_]+\.(js|css)$/.test(name))fail('PATH');emitted[name]=hash(item.type==='chunk'?item.code:item.source);}}},
 closeBundle:{order:'post',sequential:true,handler(){if(!identity||failed)return;if(!emitted)fail('INCOMPLETE');
 const manifest=collectManifest(out,identity,config.env,emitted);const serialized=JSON.stringify(manifest);if(serialized.length>16384)fail('SIZE');
 const target=join(out,NAME);writeFileSync(target,serialized+'\n',{flag:'wx'});
 console.log('PORTAL_RELEASE_MANIFEST_BEGIN\n'+serialized+'\nPORTAL_RELEASE_MANIFEST_END');
 }}
 };
}

