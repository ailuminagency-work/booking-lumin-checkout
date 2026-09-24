import {expect,it,vi} from 'vitest';
const constructors=vi.hoisted(()=>({Client:vi.fn(function(){throw Error('UNEXPECTED_CLIENT');})}));vi.mock('pg',()=>constructors);
import {configuration,initialReceipt} from './field-publication-parity.integration';
import {semanticCases,storageLimitCases,wireRejectCases,SEMANTIC_COUNT,STORAGE_LIMIT_COUNT,WIRE_REJECT_COUNT} from './field-publication-parity-corpus';
import {parseFieldPublicationV1} from '../../workflow/src/fieldPublicationV1';
const env=()=>({FIELD_PUBLICATION_PARITY_APPROVED:'1',TEXT_DRAFT_CONCURRENCY_APPROVED:'1',TEXT_DRAFT_CONCURRENCY_DATABASE:'lumin_text_draft_'+'a'.repeat(32),TEXT_DRAFT_TEST_PROFILE:'local',TEXT_DRAFT_TEST_LAYOUT:'public',TEXT_DRAFT_TEST_DISPOSABLE:'1'});
it('is inert with finite failed default receipt and independent approval',()=>{
 expect(constructors.Client).not.toHaveBeenCalled();expect(initialReceipt()).toEqual({schemaVersion:1,kind:'FIELD_PUBLICATION_PARITY',status:'failed',category:'CONFIGURATION_FAILED',semanticCases:0,storageLimitCases:0,wireRejectCases:0,connectionsClosed:false});
 for(const patch of [{FIELD_PUBLICATION_PARITY_APPROVED:undefined,FIELD_PUBLICATION_MUTATIONS_APPROVED:'1'},{TEXT_DRAFT_CONCURRENCY_APPROVED:'0'},{TEXT_DRAFT_TEST_DISPOSABLE:'0'},{TEXT_DRAFT_CONCURRENCY_DATABASE:'postgres'},{TEXT_DRAFT_TEST_LAYOUT:'bad'}])expect(()=>configuration({...env(),...patch},'win32')).toThrow();expect(constructors.Client).not.toHaveBeenCalled();
});
it('pins both disposable profiles and unchanged limits without clients',async()=>{
 const local=configuration({...env(),PGHOST:'foreign',PGPORT:'1',PGPASSWORD:'private',PGOPTIONS:'bad'},'win32');expect(local.host).toBe('127.0.0.1');expect(local.port).toBe(55439);expect(local.options).toBe('');expect(local.ssl).toBe(false);if(typeof local.password==='function')expect(await local.password()).toBe('');
 expect(local.statement_timeout).toBe(7000);expect(local.lock_timeout).toBe(5000);expect(local.query_timeout).toBe(9000);expect(local.idle_in_transaction_session_timeout).toBe(10000);
 for(const layout of ['public','extensions']){const ci=configuration({...env(),TEXT_DRAFT_TEST_PROFILE:'github-ci',TEXT_DRAFT_TEST_LAYOUT:layout,GITHUB_ACTIONS:'true'},'linux');expect(ci.port).toBe(5432);if(typeof ci.password==='function')expect(await ci.password()).toBe('postgres');}
 expect(()=>configuration(env(),'linux')).toThrow();expect(()=>configuration({...env(),TEXT_DRAFT_TEST_PROFILE:'github-ci'},'linux')).toThrow();expect(constructors.Client).not.toHaveBeenCalled();
});
it('has fixed named semantic outcomes checked against decoded JSON, never inferred from parser success',()=>{
 const cases=semanticCases();expect(SEMANTIC_COUNT).toBe(167);expect(cases).toHaveLength(167);expect(new Set(cases.map(value=>value.name)).size).toBe(167);
 for(const entry of cases){const wire=JSON.stringify(entry.input),decoded:unknown=JSON.parse(wire);if(entry.accepted)expect(parseFieldPublicationV1(decoded),entry.name).toEqual(decoded);else expect(()=>parseFieldPublicationV1(decoded),entry.name).toThrow('INVALID_FIELD_PUBLICATION_V1_CONTRACT');}
});
it('separates storage byte limits from semantic rejection and preserves exact accepted data',()=>{
 const cases=storageLimitCases();expect(STORAGE_LIMIT_COUNT).toBe(2);expect(cases).toHaveLength(2);expect(cases.map(value=>value.envelopeExceedsLimit)).toEqual([false,true]);
 for(const entry of cases){const wire=JSON.stringify(entry.input),decoded=JSON.parse(wire);expect(parseFieldPublicationV1(decoded)).toEqual(decoded);expect(Buffer.byteLength(JSON.stringify(decoded.definition),'utf8')).toBeGreaterThan(32768);}
});
it('keeps JSONB wire rejection categories explicit and distinct, without invoking SQL',()=>{
 const cases=wireRejectCases();expect(WIRE_REJECT_COUNT).toBe(3);expect(cases).toHaveLength(3);expect(cases.map(value=>[value.name,value.sqlstate])).toEqual([['nul','22P05'],['lone-high-surrogate','22P02'],['lone-low-surrogate','22P02']]);
 for(const entry of cases){const decoded=JSON.parse(JSON.stringify(entry.input));expect(()=>parseFieldPublicationV1(decoded)).toThrow('INVALID_FIELD_PUBLICATION_V1_CONTRACT');}expect(constructors.Client).not.toHaveBeenCalled();
});
