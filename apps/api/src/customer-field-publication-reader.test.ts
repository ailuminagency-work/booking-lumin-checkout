import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import type {Server} from 'node:http';
import {createCustomerFieldPublicationReader} from './customer-field-publication-reader';
import {createFlowHttpServer} from './http';
const id=(n:number)=>`53000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),flow=id(3),version=id(4),installation=id(5),origin='https://portal.example.test',checkout='https://checkout.example.test';
const snapshot={renderSchemaVersion:5,submissionMode:'paid_customer_field_request',paymentMode:'staging_mock',simulated:true,
 service:{id:id(6),name:'Cleaning',durationMinutes:60,price:{amount:12500,currency:'USD'}},
 publication:{name:'Saved cleaning',draftRevision:2,presentation:{accentColor:'#0e7490',layout:'compact'}},
 customerFields:[{id:'custom_access',kind:'text',label:'Access',required:true,maxLength:20}]};
const row={tenantId:tenant,flowId:flow,versionId:version,installationId:installation,sourceRevision:'2',renderSchemaVersion:5,snapshot,
 config:{key:'paid_customer_field',steps:[{key:'service',kind:'info',title:'Cleaning'}]},allowedOrigins:[checkout]};
const receipt={flowId:flow,draftRevision:2,publication:{versionId:version,installationId:installation,renderSchemaVersion:5 as const,hostedPath:`/checkout/flow/${installation}`}};
function fixture(rows:unknown[],fail=false){const release=vi.fn(),query=vi.fn(async(sql:string)=>{if(sql.startsWith('select')){if(fail)throw Error('private connection detail');return{rows};}return{rows:[]};});return{query,release,read:createCustomerFieldPublicationReader({connect:async()=>({query,release})} as unknown as Pool,[checkout])};}
describe('V5 current publication evidence',()=>{
 it('returns only bound version/revision/installation metadata without submitted answers or writer authority',async()=>{
  const f=fixture([row]);expect(await f.read(actor,tenant,flow)).toEqual(receipt);
  expect(f.query).toHaveBeenNthCalledWith(1,'begin isolation level repeatable read read only');
  expect(f.query).toHaveBeenNthCalledWith(3,expect.stringContaining("m.role='BUSINESS_OWNER'"),[tenant,actor,flow]);
  const sql=f.query.mock.calls[2]![0];for(const guard of ["t.status='active'","f.status='active'",'v.id=f.published_version_id','i.version_id=v.id','limit 2'])expect(sql).toContain(guard);
  expect(sql).not.toContain('flow_requests');expect(sql).not.toContain('bound_flow_versions');expect(sql).not.toContain(actor);expect(f.query).toHaveBeenLastCalledWith('commit');expect(f.release).toHaveBeenCalledOnce();
 });
 it.each([[],[row,row],...[{tenantId:id(9)},{flowId:id(9)},{renderSchemaVersion:3},{versionId:'invalid'},{installationId:'invalid'},{sourceRevision:'1'},{sourceRevision:'9007199254740992'},{snapshot:null},{snapshot:{...snapshot,versionId:version}},{snapshot:{...snapshot,paymentMode:'stripe'}},{snapshot:{...snapshot,customerFields:[{...snapshot.customerFields[0],label:'Bad\ud800'}]}},{config:{...row.config,key:'paid_simple'}},{allowedOrigins:[]},{allowedOrigins:[checkout,checkout]},{allowedOrigins:['*']},{allowedOrigins:['https://foreign.example.test']}].map(change=>[{...row,...change}])].map(rows=>({rows})))('denies ambiguous or corrupt evidence %j',async({rows})=>expect(await fixture(rows).read(actor,tenant,flow)).toBeNull());
 it('rejects malformed IDs before acquisition and redacts database failures with rollback',async()=>{const f=fixture([row]);await expect(f.read('bad',tenant,flow)).rejects.toMatchObject({code:'INVALID_REQUEST'});expect(f.query).not.toHaveBeenCalled();const broken=fixture([],true);await expect(broken.read(actor,tenant,flow)).rejects.toMatchObject({code:'INTERNAL_ERROR',message:'INTERNAL_ERROR'});expect(broken.query).toHaveBeenLastCalledWith('rollback');expect(broken.release).toHaveBeenCalledOnce();});
});
let server:Server;afterEach(async()=>{server?.closeAllConnections();if(server)await new Promise<void>(r=>server.close(()=>r()));});
async function http(enabled=true,value:unknown=receipt){const call=vi.fn(async()=>{throw Error('writer forbidden');}),read=vi.fn(async()=>value as typeof receipt),authenticate=vi.fn(async token=>token==='owner-token-123456'?actor:null);
 server=createFlowHttpServer({repository:{call},paidSimplePublication:enabled,paidCustomerFieldPublication:read,authenticateOwner:authenticate,ownerOrigins:[origin],customerOrigins:[checkout]});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 return{call,read,authenticate,get:(query=`tenantId=${tenant}`,token='owner-token-123456',o=origin,method='GET')=>fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/paid-customer-field-flows/${flow}/publication?${query}`,{method,headers:{origin:o,authorization:`Bearer ${token}`}})};
}
describe('explicit V5 owner recovery HTTP',()=>{
 it('verifies owner on every GET and exposes the exact current saved revision with no-store',async()=>{const f=await http();for(let n=0;n<2;n++){const r=await f.get();expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(await r.json()).toEqual({ok:true,data:receipt});}expect(f.authenticate).toHaveBeenCalledTimes(2);expect(f.read).toHaveBeenCalledWith(actor,tenant,flow);expect(f.call).not.toHaveBeenCalled();});
 it.each(['',`tenantId=${tenant}&tenantId=${tenant}`,`tenantId=${tenant}&retry=true`])('denies ambiguous queries %s',async query=>{const f=await http();expect((await f.get(query)).status).toBe(400);expect(f.read).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();});
 it('keeps auth/origin/method/staging gates closed',async()=>{const f=await http();expect((await f.get(undefined,'invalid-token-123456')).status).toBe(401);expect((await f.get(undefined,undefined,checkout)).status).toBe(403);expect((await f.get(undefined,undefined,origin,'POST')).status).toBe(404);expect(f.read).not.toHaveBeenCalled();});
 it('returns absence without retry permission',async()=>{const f=await http(true,null);const r=await f.get();expect(r.status).toBe(404);expect(await r.json()).toEqual({ok:false,code:'NOT_AVAILABLE'});expect(f.call).not.toHaveBeenCalled();});
 it('rejects disabled staging',async()=>{const f=await http(false);expect((await f.get()).status).toBe(422);expect(f.read).not.toHaveBeenCalled();});
 it.each([{...receipt,flowId:id(9)},{...receipt,draftRevision:0},{...receipt,retryAllowed:true},{...receipt,publication:{...receipt.publication,renderSchemaVersion:3}},{...receipt,publication:{...receipt.publication,hostedPath:'https://foreign.example.test'}}])('rejects corrupt reader transport %j',async value=>{const f=await http(true,value);expect((await f.get()).status).toBe(500);expect(f.call).not.toHaveBeenCalled();});
});
