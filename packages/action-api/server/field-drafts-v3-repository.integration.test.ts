import {expect,it} from 'vitest';
import {fieldRepositoryV3Configuration,repositoryV3Definition} from './field-drafts-v3-repository.integration';
const env={FIELD_DRAFT_V3_REPOSITORY_APPROVED:'1',TEXT_DRAFT_TEST_PROFILE:'local',TEXT_DRAFT_TEST_DISPOSABLE:'1',TEXT_DRAFT_TEST_LAYOUT:'public',TEXT_DRAFT_HTTP_DATABASE:'lumin_text_draft_'+'a'.repeat(32)};
it('rejects unsafe profiles and missing approval before I/O',()=>{
 for(const change of [{FIELD_DRAFT_V3_REPOSITORY_APPROVED:'0'},{TEXT_DRAFT_HTTP_DATABASE:'postgres'},{TEXT_DRAFT_TEST_DISPOSABLE:'0'},{TEXT_DRAFT_TEST_LAYOUT:'other'}])expect(()=>fieldRepositoryV3Configuration({...env,...change},'win32')).toThrow();
 expect(()=>fieldRepositoryV3Configuration({},'win32')).toThrow();expect(()=>fieldRepositoryV3Configuration(env,'linux')).toThrow();
 expect(()=>fieldRepositoryV3Configuration({...env,TEXT_DRAFT_TEST_PROFILE:'github-ci'},'linux')).toThrow();
});
it('pins loopback and bounded pool while ignoring inherited credentials',async()=>{
 const c=fieldRepositoryV3Configuration({...env,PGHOST:'external',PGPASSWORD:'secret',PGOPTIONS:'unsafe'},'win32');
 expect(c.host).toBe('127.0.0.1');expect(c.port).toBe(55439);expect(c.max).toBe(1);expect(c.connectionTimeoutMillis).toBe(5000);expect(c.statement_timeout).toBe(4000);expect(c.lock_timeout).toBe(3000);expect(c.query_timeout).toBe(6000);expect(c.options).toBe('');expect(c.ssl).toBe(false);
 if(typeof c.password==='function')expect(await c.password()).toBe('');else throw Error('PASSWORD_CALLBACK_REQUIRED');
});
it('accepts explicit Linux CI fixtures in both fixed layouts',async()=>{
 for(const layout of ['public','extensions']){const c=fieldRepositoryV3Configuration({...env,TEXT_DRAFT_TEST_PROFILE:'github-ci',GITHUB_ACTIONS:'true',TEXT_DRAFT_TEST_LAYOUT:layout},'linux');expect(c.host).toBe('127.0.0.1');expect(c.port).toBe(5432);if(typeof c.password==='function')expect(await c.password()).toBe('postgres');else throw Error('PASSWORD_CALLBACK_REQUIRED');}
});
it('deeply detaches mixed synthetic fixtures including stable IDs with duplicate labels',()=>{
 const a=repositoryV3Definition(),b=repositoryV3Definition();expect(a).toEqual(b);expect(a.schemaVersion).toBe(3);expect(a.fields.map(f=>f.kind)).toEqual(['text','textarea','dropdown']);
 a.fields[0]!.prompt='Changed';const choices=a.fields[2]!.choices!;expect(choices[0]!.label).toBe(choices[1]!.label);expect(choices[0]!.id).not.toBe(choices[1]!.id);choices[0]!.id='changed';choices[0]!.label='changed';choices.reverse();
 expect(repositoryV3Definition()).toEqual(b);expect(Object.keys(a)).toEqual(['schemaVersion','fields']);
});
