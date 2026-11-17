import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const text=x=>typeof x==='string'&&x.length>0;
const instant=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT.*Z$/.test(x)&&Number.isFinite(Date.parse(x));
function url(value){const u=new URL(value);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!['https:','http:'].includes(u.protocol)||(u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('invalid configuration');return u;}
export async function runSmoke(env,{fetchImpl=fetch,now=Date.now,timeoutMs=10000,log=console.log}={}){
 let base;try{base=url(env.BOOKING_LUMIN_API_BASE_URL);}catch{throw Error('CONFIG: valid API root URL required (HTTPS outside localhost)');}
 if(env.BOOKING_LUMIN_SMOKE_MUTATIONS&&env.BOOKING_LUMIN_SMOKE_MUTATIONS!=='0')throw Error('CONFIG: this harness supports read-only checks only');
 const token=env.BOOKING_LUMIN_SMOKE_TOKEN,tenant=env.TENANT_ID,service=env.SERVICE_ID,origin=env.BOOKING_LUMIN_SMOKE_ORIGIN;
 const authenticated=Boolean(token||tenant||service||origin);
 if(authenticated){try{if(!/^[A-Za-z0-9._~-]{16,4096}$/.test(token??'')||!UUID.test(tenant??'')||!UUID.test(service??'')||url(origin).origin!==origin)throw Error();}catch{throw Error('CONFIG: authenticated checks require valid token, TENANT_ID, SERVICE_ID and BOOKING_LUMIN_SMOKE_ORIGIN');}}
 async function check(label,path,validate,auth=false){
  const controller=new AbortController();let reader;let timer;
  try{
   const task=(async()=>{
    const response=await fetchImpl(new URL(path,base),{method:'GET',redirect:'error',signal:controller.signal,headers:auth?{authorization:`Bearer ${token}`,origin,accept:'application/json'}:{accept:'application/json'}});
    if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw Error();}
    if(response.status!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')){void response.body?.cancel().catch(()=>{});throw Error();}
    if(!response.body)throw Error();reader=response.body.getReader();const chunks=[];let bytes=0;
    while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>262144)throw Error();chunks.push(part.value);}
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    if(!validate(data))throw Error();
   })();
   await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error());},timeoutMs);})]);
   log(`PASS ${label}`);
  }catch{throw Error(`FAIL ${label}: expected HTTP 200 and matching schema within bounds`);}
  finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
 }
 await check('health','/health',x=>object(x,['status'])&&x.status==='ok');
 await check('ready','/ready',x=>object(x,['status'])&&x.status==='ready');
 if(!authenticated){log('SKIP authenticated checks: no credentials configured');return;}
 const envelope=x=>object(x,['ok','data'])&&x.ok===true;
 await check('profile',`/api/profile?tenantId=${tenant}`,x=>envelope(x)&&object(x.data,['schemaVersion','profile'])&&x.data.schemaVersion===1&&object(x.data.profile,['id','name','slug','timezone','currency','status'])&&x.data.profile.id.toLowerCase()===tenant.toLowerCase()&&['name','slug','timezone'].every(k=>text(x.data.profile[k]))&&/^[A-Z]{3}$/.test(x.data.profile.currency)&&x.data.profile.status==='active',true);
 const from=new Date(now()+86400000).toISOString(),to=new Date(Date.parse(from)+86400000).toISOString();
 const query=new URLSearchParams({tenantId:tenant,serviceId:service,from,to});
 await check('availability',`/api/availability?${query}`,x=>envelope(x)&&object(x.data,['schemaVersion','serviceId','durationMinutes','slots'])&&x.data.schemaVersion===1&&typeof x.data.serviceId==='string'&&x.data.serviceId.toLowerCase()===service.toLowerCase()&&Number.isInteger(x.data.durationMinutes)&&x.data.durationMinutes>0&&Array.isArray(x.data.slots)&&x.data.slots.length<=10000&&x.data.slots.every(s=>object(s,['start','end','remainingCapacity'])&&instant(s.start)&&instant(s.end)&&Date.parse(s.start)>=Date.parse(from)&&Date.parse(s.end)<=Date.parse(to)&&Date.parse(s.end)>Date.parse(s.start)&&Number.isSafeInteger(s.remainingCapacity)&&s.remainingCapacity>0),true);
}
async function selfTest(){
 const id='a5500000-0000-4000-8000-000000000001';const base={BOOKING_LUMIN_API_BASE_URL:'https://api.example.test'};const auth={...base,BOOKING_LUMIN_SMOKE_TOKEN:'synthetic-token-123456',TENANT_ID:id,SERVICE_ID:id,BOOKING_LUMIN_SMOKE_ORIGIN:'https://portal.example.test'};
 const seen=[];const logs=[];
 const fake=async(u,options)=>{seen.push({path:u.pathname,options});return Response.json(u.pathname==='/health'?{status:'ok'}:u.pathname==='/ready'?{status:'ready'}:u.pathname==='/api/profile'?{ok:true,data:{schemaVersion:1,profile:{id,name:'Private Name',slug:'private',timezone:'UTC',currency:'USD',status:'active'}}}:{ok:true,data:{schemaVersion:1,serviceId:id,durationMinutes:60,slots:[]}});};
 await runSmoke(auth,{fetchImpl:fake,log:x=>logs.push(x)});assert.equal(seen.length,4);assert.ok(seen.every(x=>x.options.method==='GET'&&x.options.redirect==='error'));assert.equal(seen[0].options.headers.authorization,undefined);assert.equal(seen[2].options.headers.authorization,`Bearer ${auth.BOOKING_LUMIN_SMOKE_TOKEN}`);assert.ok(!logs.join().includes('Private')&&!logs.join().includes(auth.BOOKING_LUMIN_SMOKE_TOKEN));
 await runSmoke(base,{fetchImpl:fake,log:()=>{}});
 for(const bad of [{BOOKING_LUMIN_API_BASE_URL:'http://api.example.test'},{...base,BOOKING_LUMIN_SMOKE_TOKEN:'partial'},{...base,BOOKING_LUMIN_SMOKE_MUTATIONS:'1'},{BOOKING_LUMIN_API_BASE_URL:'https://user:secret@api.example.test'}])await assert.rejects(runSmoke(bad,{fetchImpl:()=>{throw Error('must not fetch');},log:()=>{}}),/CONFIG/);
 for(const fetchImpl of [async()=>Response.json({status:'wrong'}),async()=>Response.json({status:'ok'},{status:503}),async()=>Response.json({status:'ok',private:'PII'}),async()=>{throw Error('secret token');},()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}}),async()=>new Response('x'.repeat(262145),{headers:{'content-type':'application/json'}})])await assert.rejects(runSmoke(base,{fetchImpl,timeoutMs:10,log:()=>{}}),/^Error: FAIL health: expected HTTP 200 and matching schema within bounds$/);
 console.log('PASS offline smoke self-test: schemas, authentication dispatch, redaction, configuration, status, timeout, stalled/oversized body');
}
const help=`Usage: npm run smoke:phase-a -- [--help|--self-test]
Required: BOOKING_LUMIN_API_BASE_URL (root URL; HTTPS except localhost).
Optional authenticated checks require all of:
  BOOKING_LUMIN_SMOKE_TOKEN, TENANT_ID, SERVICE_ID, BOOKING_LUMIN_SMOKE_ORIGIN.
Origin must match the API owner-origin allowlist. Availability checks tomorrow's
24-hour interval; zero slots is valid. Each request has a 10-second total timeout
and 256-KiB response limit. Only GET requests are supported. Mutation flags are
rejected. Tokens, URLs, IDs and response bodies are never printed.
--self-test runs deterministic injected-fetch fixtures without network access.`;
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const args=process.argv.slice(2);if(args.length===1&&args[0]==='--help')console.log(help);else if(args.length===1&&args[0]==='--self-test')await selfTest();else if(args.length)throw Error('CONFIG: unsupported arguments; use --help');else await runSmoke(process.env);}catch(error){console.error(error.message);process.exitCode=1;}
}
