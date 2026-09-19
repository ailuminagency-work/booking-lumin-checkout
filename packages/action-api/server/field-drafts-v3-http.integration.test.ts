import {expect,it} from 'vitest';
import {fieldHttpV3Configuration} from './field-drafts-v3-http.integration';
const env={FIELD_DRAFT_V3_HTTP_APPROVED:'1',TEXT_DRAFT_TEST_PROFILE:'local',TEXT_DRAFT_TEST_DISPOSABLE:'1',TEXT_DRAFT_TEST_LAYOUT:'public',TEXT_DRAFT_HTTP_DATABASE:'lumin_text_draft_'+'a'.repeat(32)};
it('requires explicit approval and disposable identity before I/O',()=>{
 expect(()=>fieldHttpV3Configuration({},'win32')).toThrow();
 for(const extra of [{FIELD_DRAFT_V3_HTTP_APPROVED:'0'},{TEXT_DRAFT_HTTP_DATABASE:'postgres'},{TEXT_DRAFT_TEST_DISPOSABLE:'0'},{TEXT_DRAFT_TEST_LAYOUT:'unknown'}])expect(()=>fieldHttpV3Configuration({...env,...extra},'win32')).toThrow();
 expect(()=>fieldHttpV3Configuration(env,'linux')).toThrow();expect(()=>fieldHttpV3Configuration({...env,TEXT_DRAFT_TEST_PROFILE:'github-ci'},'linux')).toThrow();
});
it('pins loopback and bounded pool independently of inherited credentials',async()=>{
 const c=fieldHttpV3Configuration({...env,PGHOST:'external',PGPASSWORD:'secret',PGOPTIONS:'unsafe'},'win32');
 expect(c.host).toBe('127.0.0.1');expect(c.port).toBe(55439);expect(c.max).toBe(2);expect(c.connectionTimeoutMillis).toBe(5000);expect(c.options).toBe('');expect(c.ssl).toBe(false);
 if(typeof c.password==='function')expect(await c.password()).toBe('');else throw Error('NO_CALLBACK');
});
it('accepts only explicit Linux CI on both approved layouts',async()=>{
 for(const layout of ['public','extensions']){const c=fieldHttpV3Configuration({...env,TEXT_DRAFT_TEST_PROFILE:'github-ci',GITHUB_ACTIONS:'true',TEXT_DRAFT_TEST_LAYOUT:layout},'linux');expect(c.host).toBe('127.0.0.1');expect(c.port).toBe(5432);if(typeof c.password==='function')expect(await c.password()).toBe('postgres');else throw Error('NO_CALLBACK');}
});
