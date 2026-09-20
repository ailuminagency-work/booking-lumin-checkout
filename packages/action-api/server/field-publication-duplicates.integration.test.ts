import {expect,it,vi} from 'vitest';
const constructors=vi.hoisted(()=>({Client:vi.fn(function(){throw Error('UNEXPECTED_CLIENT');})}));
vi.mock('pg',()=>constructors);
import {configuration,initialReceipt,CASE_COUNT,definition} from './field-publication-duplicates.integration';
import {parseFieldDocumentV3} from '../../workflow/src/fieldDocumentV3';
const env=()=>({FIELD_PUBLICATION_DUPLICATES_APPROVED:'1',TEXT_DRAFT_CONCURRENCY_APPROVED:'1',TEXT_DRAFT_CONCURRENCY_DATABASE:'lumin_text_draft_'+'a'.repeat(32),TEXT_DRAFT_TEST_PROFILE:'local',TEXT_DRAFT_TEST_LAYOUT:'public',TEXT_DRAFT_TEST_DISPOSABLE:'1'});
it('imports without constructing clients and starts with a finite failed four-case receipt',()=>{expect(constructors.Client).not.toHaveBeenCalled();expect(CASE_COUNT).toBe(4);expect(initialReceipt()).toEqual({schemaVersion:1,kind:'FIELD_PUBLICATION_DUPLICATES',status:'failed',category:'CONFIGURATION_FAILED',cases:0,connectionsClosed:false});expect(parseFieldDocumentV3(definition())).toEqual(definition());});
it('requires independent approval, concurrency approval and valid disposable identity',()=>{
 for(const patch of [{FIELD_PUBLICATION_DUPLICATES_APPROVED:undefined},{FIELD_PUBLICATION_DUPLICATES_APPROVED:'0'},{FIELD_PUBLICATION_DUPLICATES_APPROVED:undefined,FIELD_DRAFT_V3_CONCURRENCY_APPROVED:'1'},{TEXT_DRAFT_CONCURRENCY_APPROVED:'0'},{TEXT_DRAFT_TEST_DISPOSABLE:'0'},{TEXT_DRAFT_CONCURRENCY_DATABASE:'postgres'},{TEXT_DRAFT_TEST_LAYOUT:'bad'}])expect(()=>configuration({...env(),...patch},'win32')).toThrow();expect(constructors.Client).not.toHaveBeenCalled();
});
it('pins local endpoint, credentials and unchanged query/lock bounds',async()=>{
 const result=configuration({...env(),PGHOST:'foreign',PGPORT:'1',PGUSER:'foreign',PGPASSWORD:'private',PGOPTIONS:'foreign'},'win32');
 expect(result.host).toBe('127.0.0.1');expect(result.port).toBe(55439);expect(result.user).toBe('postgres');expect(result.ssl).toBe(false);expect(result.options).toBe('');expect(typeof result.password).toBe('function');if(typeof result.password==='function')expect(await result.password()).toBe('');
 expect(result.statement_timeout).toBe(7000);expect(result.lock_timeout).toBe(5000);expect(result.query_timeout).toBe(9000);expect(result.idle_in_transaction_session_timeout).toBe(10000);expect(constructors.Client).not.toHaveBeenCalled();
});
it('allows only explicit Linux CI and both pinned crypto layouts',async()=>{
 for(const layout of ['public','extensions']){const result=configuration({...env(),TEXT_DRAFT_TEST_PROFILE:'github-ci',TEXT_DRAFT_TEST_LAYOUT:layout,GITHUB_ACTIONS:'true'},'linux');expect(result.port).toBe(5432);if(typeof result.password==='function')expect(await result.password()).toBe('postgres');}
 expect(()=>configuration(env(),'linux')).toThrow();expect(()=>configuration({...env(),TEXT_DRAFT_TEST_PROFILE:'github-ci'},'linux')).toThrow();expect(()=>configuration({...env(),TEXT_DRAFT_TEST_PROFILE:'github-ci',GITHUB_ACTIONS:'true'},'win32')).toThrow();expect(constructors.Client).not.toHaveBeenCalled();
});
