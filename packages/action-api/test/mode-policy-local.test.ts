import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { __createLocalModePolicyCompositionForTests, __restrictModePolicyPoolForTests, startLocalModePolicyServer } from '../server/mode-policy-local';
import type { ModePool, ModeClient } from '../server/mode-installation-repository';
import type { PoolConfig } from 'pg';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const profile = { profileVersion: 'test-v1', rendererOrigin: 'https://renderer.test:44301', apiOrigin: 'https://api.test:44302', portalOrigin: 'https://portal.test:44303', loaderUrl: 'https://renderer.test:44301/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js' };
const env = { LOCAL_HARNESS: '1', FLOW_TEST_DISPOSABLE: '1', MODE_INSTALLATIONS_TEST_DISPOSABLE: '1', MODE_DOCUMENT_TEST_DISPOSABLE: '1', PGHOST: '127.0.0.1', PGPORT: '55439', PGUSER: 'postgres', PGDATABASE: 'lumin_mode_document_unit' };
const data = { schemaVersion:1,installationId:id,mode:'hosted',deploymentProfileVersion:'test-v1',rendererOrigin:profile.rendererOrigin,apiOrigin:profile.apiOrigin,loaderUrl:profile.loaderUrl,currentVersionId:id,targetRevision:1,policyRevision:1,allowedParentOrigins:[],enabled:true };
function fixture() {
  const commands: { text: string; values: unknown[] | undefined }[] = [];
  const events = new EventEmitter();
  const client: ModeClient = { query: vi.fn(async (text, values) => {
    commands.push({ text, values });
    return text.startsWith('SELECT ') ? { command:'SELECT',rowCount:1,rows:[{result:data}] } : { command:text.startsWith('BEGIN')?'BEGIN':text==='COMMIT'?'COMMIT':'SET' };
  }), release: vi.fn(), on:events.on.bind(events), removeListener:events.removeListener.bind(events) };
  const pool: ModePool = { connect:vi.fn(async()=>client),end:vi.fn(async()=>{}),on:events.on.bind(events),removeListener:events.removeListener.bind(events) };
  return {pool,client,commands};
}
describe('guarded policy composition', () => {
  it('executes accepted eight-command read and exposes no owner/pool handles', async()=>{
    const f=fixture();let config!:PoolConfig;
    const c=__createLocalModePolicyCompositionForTests({profiles:[profile]}, {env,poolFactory:value=>{config=value;return f.pool;}});
    expect(Object.keys(c).sort()).toEqual(['close','profile','reader']);expect(Object.keys(c.reader).sort()).toEqual(['close','publicPolicy']);
    const r=await c.reader.publicPolicy({installationId:id});expect(r).toMatchObject({kind:'completed',delivery:'data',data});
    expect(f.commands.map(x=>x.text)).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED',"SET LOCAL statement_timeout='5s'","SET LOCAL lock_timeout='5s'","SET LOCAL idle_in_transaction_session_timeout='1s'",'SET LOCAL ROLE service_role','SELECT public.mode_public_installation_policy($1::uuid) AS result','SET CONSTRAINTS ALL IMMEDIATE','COMMIT']);
    expect(f.commands.filter(x=>!x.text.startsWith('SELECT')).every(x=>x.values===undefined)).toBe(true);expect(f.commands[5]!.values).toEqual([id]);
    expect(config).toMatchObject({max:2,ssl:false,pipeline:false,statement_timeout:5000,lock_timeout:5000,connectionTimeoutMillis:3000,query_timeout:0});
    expect(typeof config.password).toBe('function');expect(await (config.password as ()=>unknown)()).toBe('');
    expect(f.client.release).toHaveBeenCalledWith(undefined);await c.close();await c.close();expect(f.pool.end).toHaveBeenCalledTimes(1);
  });
  it.each([{MODE_DOCUMENT_TEST_DISPOSABLE:'0'},{PGHOST:'db.example'},{PGPORT:'055439'},{PGDATABASE:'lumin_installation_s1_transport_unit'},{PGPASSWORD:'real-looking-secret'},{PGPASSFILE:'sentinel'},{DATABASE_URL:'sentinel'},{PGUSER:'service_role'}])('rejects invalid environment before pool %o',bad=>{
    const factory=vi.fn();expect(()=>__createLocalModePolicyCompositionForTests({profiles:[profile]},{env:{...env,...bad},poolFactory:factory})).toThrow('EXPLICIT_LOCAL_DISPOSABLE_REQUIRED');expect(factory).not.toHaveBeenCalled();
  });
  it('zero profiles constructs no pool; startup rejects without binding',async()=>{
    const factory=vi.fn();const c=__createLocalModePolicyCompositionForTests({profiles:[]},{env,poolFactory:factory});
    expect(c.profile).toBeNull();expect((await c.reader.publicPolicy({installationId:id})).kind).toBe('failed');await c.close();expect(factory).not.toHaveBeenCalled();
    await expect(startLocalModePolicyServer({profiles:[],tls:{key:'no',cert:'no'}})).rejects.toThrow('MODE_POLICY_PROFILE_REQUIRED');
  });
  it('captures allowed synthetic password snapshot and denies after close',async()=>{
    const f=fixture();let cfg!:PoolConfig;const mutable={...env,PGPASSWORD:'postgres'};
    const c=__createLocalModePolicyCompositionForTests({profiles:[profile]},{env:mutable,poolFactory:v=>{cfg=v;return f.pool;}});mutable.PGPASSWORD='changed';
    expect(await (cfg.password as ()=>unknown)()).toBe('postgres');await c.close();expect(await c.reader.publicPolicy({installationId:id})).toMatchObject({code:'CLOSED',transaction:'not_started'});expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it.each(['SELECT 1','ROLLBACK','SELECT public.mode_owner_installations($1::uuid) AS result','COMMIT; SELECT 1',' SET LOCAL ROLE service_role'])('rejects unexpected SQL %s before driver',async sql=>{
    const f=fixture();const wrapped=__restrictModePolicyPoolForTests(f.pool);const client=await wrapped.connect();
    await expect(client.query(sql)).rejects.toThrow('MODE_POLICY_QUERY_DENIED');expect(f.client.query).not.toHaveBeenCalled();client.release(Error('discard'));expect(f.client.release).toHaveBeenCalledTimes(1);
  });
  it('rejects substituted parameters but keeps valid neighboring read and command',async()=>{
    const f=fixture();const client=await __restrictModePolicyPoolForTests(f.pool).connect();const sql='SELECT public.mode_public_installation_policy($1::uuid) AS result';
    for(const values of [undefined,[],[id,id],['INVALID']]) await expect(client.query(sql,values)).rejects.toThrow('MODE_POLICY_QUERY_DENIED');
    await expect(client.query('COMMIT',[id])).rejects.toThrow('MODE_POLICY_QUERY_DENIED');expect(f.client.query).not.toHaveBeenCalled();
    await client.query(sql,[id]);await client.query('COMMIT');expect(f.client.query).toHaveBeenCalledTimes(2);
  });
  it('read COMMIT response loss and explicit ROLLBACK tag remain undeliverable',async()=>{
    for(const lost of [true,false]){
      const f=fixture();const original=f.client.query;
      f.client.query=async(text,values)=>{if(text==='COMMIT'){if(lost)throw Error('lost');return{command:'ROLLBACK'};}return original(text,values);};
      const c=__createLocalModePolicyCompositionForTests({profiles:[profile]},{env,poolFactory:()=>f.pool});
      const result=await c.reader.publicPolicy({installationId:id});expect(result.kind).toBe(lost?'completion_uncertain':'failed');await c.close();
    }
  });
});
