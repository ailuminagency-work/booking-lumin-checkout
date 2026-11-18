import {describe,expect,it,vi} from 'vitest';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createMigrationAttestationHandler,createMigrationAttestationReader,MIGRATION_ATTESTATION_EVIDENCE,MIGRATION_ATTESTATION_HEAD} from './migration-attestation';

const completeRow={
 migrationHead:MIGRATION_ATTESTATION_HEAD,
 evidence:MIGRATION_ATTESTATION_EVIDENCE,
 tenants:true,
 services:true,
 bookings:true,
 payments:true,
 availabilityRules:true,
 availabilityOverrides:true,
 capacityHolds:true,
 resources:true,
 resourceReservations:true,
 confirmationAuthority:true,
 paymentReadinessContract:true,
};

function poolFor(rows:unknown[],failure?:Error){
 const query=vi.fn(async(sql:string)=>{
  if(sql==='begin'||sql==='set local role service_role'||sql==='commit'||sql==='rollback')return {rows:[]};
  if(failure)throw failure;
  return {rows};
 });
 const release=vi.fn();
 return {pool:{connect:vi.fn(async()=>({query,release}))} as never,query,release};
}

function request(method:'GET'|'POST'='GET',authorization?:string){
 return {method,headers:authorization===undefined?{}:{authorization}} as IncomingMessage;
}

function response(){
 let status=0;
 let body='';
 return {
  response:{
   writeHead:(nextStatus:number)=>{status=nextStatus;},
   end:(value?:string)=>{body=value??'';},
  } as unknown as ServerResponse,
  status:()=>status,
  body:()=>body,
 };
}

describe('server-side migration attestation',()=>{
 it('reads only the fixed row through service_role and returns no database detail',async()=>{
  const fixture=poolFor([completeRow]);
  await expect(createMigrationAttestationReader(fixture.pool)()).resolves.toEqual({schemaVersion:1,migrationHead:MIGRATION_ATTESTATION_HEAD,evidence:MIGRATION_ATTESTATION_EVIDENCE});
  expect(fixture.query).toHaveBeenNthCalledWith(2,'set local role service_role');
  expect(fixture.query).toHaveBeenNthCalledWith(3,expect.stringContaining('booking_lumin_schema_attestation'));
  expect(fixture.query).toHaveBeenCalledWith('commit');
  expect(fixture.release).toHaveBeenCalledOnce();
 });
 const malformedRows:unknown[][]=[[],[{...completeRow,migrationHead:'0098_refund_event_shape_authority'}],[{...completeRow,migrationHead:'private credential'}],[{...completeRow,evidence:'full_chain'}]];
 it.each(malformedRows.map(rows=>({rows})))('fails closed for missing or stale/forged row %j',async({rows})=>{
  const fixture=poolFor(rows);
  await expect(createMigrationAttestationReader(fixture.pool)()).rejects.toThrow('MIGRATION_ATTESTATION_MISMATCH');
  expect(fixture.query).toHaveBeenCalledWith('rollback');
  expect(fixture.release).toHaveBeenCalledOnce();
 });
 it('fails closed when a core object or confirmation authority is missing despite the current sentinel',async()=>{
  for(const missing of ['services','confirmationAuthority','paymentReadinessContract'] as const){
   const fixture=poolFor([{...completeRow,[missing]:false}]);
   await expect(createMigrationAttestationReader(fixture.pool)()).rejects.toThrow('MIGRATION_ATTESTATION_SCHEMA_MISMATCH');
   expect(fixture.query).toHaveBeenCalledWith('rollback');
   expect(fixture.release).toHaveBeenCalledOnce();
  }
 });
 it('propagates a failure for the HTTP boundary to redact',async()=>{
  const fixture=poolFor([],new Error('database unavailable'));
  await expect(createMigrationAttestationReader(fixture.pool)()).rejects.toThrow('database unavailable');
  expect(fixture.release).toHaveBeenCalledOnce();
 });
});

describe('authenticated staging migration attestation boundary',()=>{
 const token='staging-token-123456';
 const path='/api/staging/readiness/migration';
 const attestation={schemaVersion:1 as const,migrationHead:MIGRATION_ATTESTATION_HEAD,evidence:MIGRATION_ATTESTATION_EVIDENCE};

 it('returns the fixed attestation only after bearer verification',async()=>{
  const verifyIdentity=vi.fn(async(received:string)=>({userId:'owner-1',sessionId:'session-1',expiresAt:'2099-01-01T00:00:00.000Z'}));
  const read=vi.fn(async()=>attestation);
  const handler=createMigrationAttestationHandler({environment:'staging',verifyIdentity,read});
  const out=response();
  await expect(handler(request('GET',`Bearer ${token}`),out.response,path)).resolves.toBe(true);
  expect(out.status()).toBe(200);
  expect(JSON.parse(out.body())).toEqual(attestation);
  expect(verifyIdentity).toHaveBeenCalledWith(token);
  expect(read).toHaveBeenCalledOnce();
 });

 it.each([undefined,'Bearer short','Basic staging-token-123456','Bearer token with spaces'])('rejects missing or malformed bearer credentials: %j',async authorization=>{
  const verifyIdentity=vi.fn(async()=>({userId:'owner-1'}));
  const read=vi.fn(async()=>attestation);
  const handler=createMigrationAttestationHandler({environment:'staging',verifyIdentity,read});
  const out=response();
  await expect(handler(request('GET',authorization),out.response,path)).resolves.toBe(true);
  expect(out.status()).toBe(401);
  expect(JSON.parse(out.body())).toEqual({ok:false,code:'UNAUTHENTICATED'});
  expect(verifyIdentity).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
 });

 it('rejects an identity verifier miss or failure without reading the database',async()=>{
  const read=vi.fn(async()=>attestation);
  for(const verifyIdentity of [
   vi.fn(async()=>null),
   vi.fn(async()=>{throw new Error('auth secret should not escape');}),
  ]){
   const handler=createMigrationAttestationHandler({environment:'staging',verifyIdentity,read});
   const out=response();
   await handler(request('GET',`Bearer ${token}`),out.response,path);
   expect(out.status()).toBe(401);
   expect(JSON.parse(out.body())).toEqual({ok:false,code:'UNAUTHENTICATED'});
  }
  expect(read).not.toHaveBeenCalled();
 });

 it('redacts database failures and invokes the failure hook',async()=>{
  const onFailure=vi.fn();
  const read=vi.fn(async()=>{throw new Error('postgres password and host must not escape');});
  const handler=createMigrationAttestationHandler({environment:'staging',verifyIdentity:async()=>({userId:'owner-1'}),read,onFailure});
  const out=response();
  await expect(handler(request('GET',`Bearer ${token}`),out.response,path)).resolves.toBe(true);
  expect(out.status()).toBe(503);
  expect(JSON.parse(out.body())).toEqual({status:'unready',reason:'migration_attestation_unavailable'});
  expect(out.body()).not.toContain('postgres');
  expect(onFailure).toHaveBeenCalledOnce();
 });

 it('fails closed for non-staging, non-GET, and unrelated paths',async()=>{
  const verifyIdentity=vi.fn(async()=>({userId:'owner-1'}));
  const read=vi.fn(async()=>attestation);
  const staging=createMigrationAttestationHandler({environment:'staging',verifyIdentity,read});
  const nonStaging=createMigrationAttestationHandler({environment:'production',verifyIdentity,read});
  const wrongPath=response();
  await expect(staging(request('GET',`Bearer ${token}`),wrongPath.response,'/health')).resolves.toBe(false);
  expect(wrongPath.status()).toBe(0);
  const production=response();
  await expect(nonStaging(request('GET',`Bearer ${token}`),production.response,path)).resolves.toBe(true);
  expect(production.status()).toBe(404);
  const post=response();
  await expect(staging(request('POST',`Bearer ${token}`),post.response,path)).resolves.toBe(true);
  expect(post.status()).toBe(404);
  expect(verifyIdentity).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
 });
});
