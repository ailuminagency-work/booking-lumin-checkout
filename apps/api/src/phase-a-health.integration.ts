import assert from 'node:assert/strict';
import {createFlowHttpServer} from './http';

// This is the local factory contract. Production /ready belongs to main.ts and
// cannot be proven by copying its handler into this test. No database is needed
// for these routes: the fixture repository fails if any query is attempted.
if(process.env.LOCAL_HARNESS!=='1'||process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_[a-z0-9_]+$/.test(process.env.PGDATABASE??''))throw Error('explicit disposable loopback fixture configuration required');
if(process.env.PGHOSTADDR!==undefined&&process.env.PGHOSTADDR!=='127.0.0.1')throw Error('PGHOSTADDR must be exact loopback');
if(['PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'].some(key=>process.env[key]!==undefined))throw Error('ambient PostgreSQL overrides are unsupported');
const origin='http://127.0.0.1:5174';let queries=0;
const server=createFlowHttpServer({repository:{call:async()=>{queries++;throw Error('unexpected repository call');}},ownerOrigins:[origin],customerOrigins:[],authenticateOwner:async()=>null});
try{
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();assert.ok(address&&typeof address!=='string');assert.equal(address.address,'127.0.0.1');
 const base=`http://127.0.0.1:${address.port}`;
 const request=async(path:string,method='GET',headers:Record<string,string>={})=>{
  const response=await fetch(base+path,{method,headers,redirect:'error',signal:AbortSignal.timeout(5000)});
  assert.match(response.headers.get('content-type')??'',/^application\/json/);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  const raw=await response.text();assert.ok(raw.length<256,'probe response must remain minimal');
  return{status:response.status,body:raw?JSON.parse(raw):null};
 };
 assert.deepEqual(await request('/health'),{status:200,body:{ok:true,data:{mode:'LOCAL_HARNESS',providerConnections:false}}});
 for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS'])assert.deepEqual(await request('/health',method),{status:403,body:{ok:false,code:'FORBIDDEN'}});
 const head=await request('/health','HEAD');assert.equal(head.status,403);assert.equal(head.body,null);
 assert.deepEqual(await request('/ready'),{status:403,body:{ok:false,code:'FORBIDDEN'}});
 assert.deepEqual(await request('/ready','GET',{origin,authorization:'Bearer local-invalid-synthetic-token'}),{status:401,body:{ok:false,code:'UNAUTHENTICATED'}});
 assert.deepEqual(await request('/ready','POST'),{status:403,body:{ok:false,code:'FORBIDDEN'}});
 assert.equal(queries,0);
 console.log('PASS local factory health schema, non-GET denial, loopback binding and zero repository calls');
 console.log('LIMIT: factory /ready is denied; production main.ts readiness and hosted staging were not exercised');
}finally{server.closeAllConnections();if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
