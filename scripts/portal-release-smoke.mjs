import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
const sha=/^[a-f0-9]{40}$/;const digest=/^[a-f0-9]{64}$/;
const routes=['/','/bookings','/embed','/services','/settings'];
const qa=['/qa/connected.html','/qa/connected.tsx'];
function root(s){const u=new URL(s);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error();return u;}
const fail=code=>{throw Error(`PORTAL_SMOKE_${code}`);};
/** Expected manifest is trusted build evidence, not discovered from the deployment under test. */
export async function runPortalReleaseSmoke(config,{fetchImpl=fetch,timeoutMs=5000}={}){
 let portal,api,m;try{portal=root(config.portal);api=root(config.api);m=structuredClone(config.manifest);
 if(!sha.test(m.portalCommit)||!sha.test(m.apiCommit)||m.migrationHead!=='0103_payment_readiness_attestation'||!digest.test(m.htmlSha256)||m.attentionVisibility!==false||m.attentionAcknowledgment!==false||!Array.isArray(m.assets)||m.assets.length<1||m.assets.length>64||new Set(m.assets.map(a=>a.path)).size!==m.assets.length||m.assets.some(a=>!/^\/assets\/[A-Za-z0-9_-]+\.(js|css)$/.test(a.path)||!digest.test(a.sha256)))throw Error();
 }catch{fail('CONFIG');}
 let total=0;
 async function get(base,path){let reader,timer;const controller=new AbortController();try{return await Promise.race([(async()=>{
 const url=new URL(path,base);const r=await fetchImpl(url,{method:'GET',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal,headers:{accept:'*/*'}});
 if(r.redirected||(r.url&&r.url!==url.href)||controller.signal.aborted){void r.body?.cancel().catch(()=>{});throw Error();}
 reader=r.body?.getReader();if(!reader)throw Error();const chunks=[];let bytes=0;
 for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.byteLength;total+=p.value.byteLength;if(bytes>4*1024*1024||total>16*1024*1024)throw Error();chunks.push(p.value);}
 return {status:r.status,body:Buffer.concat(chunks),type:r.headers.get('content-type')??''};
 })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error()),timeoutMs);})]);}catch{fail('FETCH');}finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}}
 const hasFixture=b=>/synthetic connected preview|\/qa\/connected\.tsx|owner@fixture\.test/.test(b.toString('utf8'));
 for(const path of routes){const r=await get(portal,path);if(r.status!==200||!/^text\/html\b/.test(r.type)||hash(r.body)!==m.htmlSha256||hasFixture(r.body))fail('HTML');
 if(path==='/'){const refs=[...r.body.toString('utf8').matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(x=>x[1]);if(!refs.length||refs.some(p=>!m.assets.some(a=>a.path===p)))fail('ASSET_MANIFEST');}}
 for(const a of m.assets){const r=await get(portal,a.path);if(r.status!==200||hash(r.body)!==a.sha256||hasFixture(r.body))fail('ASSET');}
 for(const path of qa){const r=await get(portal,path);if(hasFixture(r.body)||!(r.status===404||r.status===410||r.status===200&&hash(r.body)===m.htmlSha256))fail('QA_EXPOSED');}
 for(const [path,status] of [['/health','ok'],['/ready','ready']]){const r=await get(api,path);let b;try{b=JSON.parse(r.body);}catch{fail('HEALTH');}if(r.status!==200||b.status!==status||Object.keys(b).length!==1)fail('HEALTH');}
 const r=await get(api,'/version');let v;try{v=JSON.parse(r.body);}catch{fail('BASELINE');}if(r.status!==200||v.schemaVersion!==1||v.service!=='booking-lumin-api'||v.environment!=='staging'||v.releaseSha!==m.apiCommit||v.migrationHead!==m.migrationHead)fail('BASELINE');
 return {portalCommit:m.portalCommit,apiCommit:m.apiCommit,artifactMatch:true,publicMetadataMatch:true,databaseAttested:false,authenticatedJourneyVerified:false,providerContacted:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==5)fail('USAGE');const result=await runPortalReleaseSmoke({portal:process.argv[2],api:process.argv[3],manifest:JSON.parse(readFileSync(process.argv[4],'utf8'))});console.log(JSON.stringify(result));}catch(e){console.error(/^PORTAL_SMOKE_[A-Z_]+$/.test(e.message)?e.message:'PORTAL_SMOKE_CONFIG');process.exitCode=1;}}
