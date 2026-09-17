import { expect, it } from 'vitest';
import { configuration, corpus, blocked } from './text-field-drafts-concurrency.integration';
const env=()=>({TEXT_DRAFT_TEST_PROFILE:'local',TEXT_DRAFT_TEST_DISPOSABLE:'1',TEXT_DRAFT_TEST_LAYOUT:'public',TEXT_DRAFT_CONCURRENCY_APPROVED:'1',TEXT_DRAFT_CONCURRENCY_DATABASE:'lumin_text_draft_'+'a'.repeat(32)});
it('keeps separate concurrency approval and uses explicit portable profiles',async()=>{
 expect(()=>configuration({...env(),TEXT_DRAFT_CONCURRENCY_APPROVED:'0'},'win32')).toThrow();
 expect(()=>configuration({...env(),TEXT_DRAFT_TEST_DISPOSABLE:'0'},'win32')).toThrow();
 const local=configuration(env(),'win32'),ci=configuration({...env(),TEXT_DRAFT_TEST_PROFILE:'github-ci',GITHUB_ACTIONS:'true'},'linux');
 expect(local.port).toBe(55439);expect(ci.port).toBe(5432);expect(local.statement_timeout).toBe(10000);expect(local.lock_timeout).toBe(8000);
 if(typeof local.password==='function')expect(await local.password()).toBe('');else throw Error('Missing callback');
 if(typeof ci.password==='function')expect(await ci.password()).toBe('postgres');else throw Error('Missing callback');
});
it('retains all45 parity cases and cardinality boundaries',()=>{
 const values=corpus();expect(values).toHaveLength(45);
 const fieldCounts=values.map(value=>value&&typeof value==='object'&&'fields' in value&&Array.isArray(value.fields)?value.fields.length:-1);
 expect(fieldCounts).toContain(64);expect(fieldCounts).toContain(65);for(const value of values)expect(()=>JSON.stringify(value)).not.toThrow();
});
it('requires actual blocked PID evidence, rejects early completion and expires without sleeps',async()=>{
 let calls=0;const observer={query:async(_sql:string,params:number[])=>{expect(params).toEqual([2,1]);calls++;return {rows:[{blocked:calls===2}]};}};
 await blocked(observer,2,1,()=>false);expect(calls).toBe(2);
 await expect(blocked(observer,2,1,()=>true)).rejects.toThrow();let time=0;
 await expect(blocked({query:async()=>({rows:[{blocked:false}]})},2,1,()=>false,()=>time+=1000)).rejects.toThrow();
});
