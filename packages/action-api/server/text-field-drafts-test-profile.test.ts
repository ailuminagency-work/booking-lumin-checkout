import { expect, it } from 'vitest';
import { textDraftTestProfile as profile, verifyTextDraftDatabase } from './text-field-drafts-test-profile';
const env=()=>({TEXT_DRAFT_TEST_PROFILE:'local',TEXT_DRAFT_TEST_DISPOSABLE:'1',TEXT_DRAFT_TEST_LAYOUT:'public',TEXT_DRAFT_HTTP_DATABASE:'lumin_text_draft_'+'a'.repeat(32)});
it('selects exactly reviewed local/CI endpoints and callback fixture credentials',async()=>{
 for(const [mode,platform,port,password] of [['local','win32',55439,''],['github-ci','linux',5432,'postgres']] as const){
  const p=profile({...env(),TEXT_DRAFT_TEST_PROFILE:mode,GITHUB_ACTIONS:'true',PGHOST:'foreign',PGPORT:'9999',PGPASSWORD:'foreign',PGSERVICE:'foreign'},'TEXT_DRAFT_HTTP_DATABASE',platform);
  expect(p.connection.host).toBe('127.0.0.1');expect(p.connection.port).toBe(port);expect(p.connection.ssl).toBe(false);expect(typeof p.connection.password).toBe('function');if(typeof p.connection.password==='function')expect(await p.connection.password()).toBe(password);
 }
});
it('rejects missing/unknown guards, layout, platform and non-disposable database',()=>{
 for(const extra of [{TEXT_DRAFT_TEST_PROFILE:''},{TEXT_DRAFT_TEST_DISPOSABLE:'0'},{TEXT_DRAFT_TEST_LAYOUT:'other'},{TEXT_DRAFT_HTTP_DATABASE:'postgres'},{TEXT_DRAFT_HTTP_DATABASE:env().TEXT_DRAFT_HTTP_DATABASE+'\n'}])expect(()=>profile({...env(),...extra},'TEXT_DRAFT_HTTP_DATABASE','win32')).toThrow();
 expect(()=>profile(env(),'TEXT_DRAFT_HTTP_DATABASE','linux')).toThrow();
 expect(()=>profile({...env(),TEXT_DRAFT_TEST_PROFILE:'github-ci'},'TEXT_DRAFT_HTTP_DATABASE','linux')).toThrow();
 expect(()=>profile({...env(),TEXT_DRAFT_TEST_PROFILE:'github-ci',GITHUB_ACTIONS:'true'},'TEXT_DRAFT_HTTP_DATABASE','win32')).toThrow();
});
it('checks actual database/host/port and pgcrypto namespace for both layouts',async()=>{
 for(const layout of ['public','extensions'] as const){const p=profile({...env(),TEXT_DRAFT_TEST_LAYOUT:layout},'TEXT_DRAFT_HTTP_DATABASE','win32');const row={database:p.connection.database,host:'127.0.0.1',port:55439,crypto_layout:layout};
  await expect(verifyTextDraftDatabase({query:async()=>({rows:[row]})},p)).resolves.toBeUndefined();
  for(const change of [{database:'postgres'},{host:'127.0.0.1/32'},{host:'::1'},{port:5432},{crypto_layout:layout==='public'?'extensions':'public'},{crypto_layout:null}])await expect(verifyTextDraftDatabase({query:async()=>({rows:[{...row,...change}]})},p)).rejects.toThrow();
 }
});
