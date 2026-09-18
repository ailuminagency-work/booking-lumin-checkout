import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { nativeConfiguration, fixtureDefinition, fixturePromptDefinition, observeTextDraftConnectionEnd, awaitTextDraftConnectionCleanup } from './text-field-drafts.integration';
it('requires explicit disposable approval and fixed local database namespace',async()=>{
 expect(()=>nativeConfiguration({})).toThrow();expect(()=>nativeConfiguration({TEXT_DRAFT_HTTP_APPROVED:'1',TEXT_DRAFT_HTTP_DATABASE:'postgres'})).toThrow();
 const c=nativeConfiguration({TEXT_DRAFT_TEST_PROFILE:'local',TEXT_DRAFT_TEST_DISPOSABLE:'1',TEXT_DRAFT_TEST_LAYOUT:'public',TEXT_DRAFT_HTTP_APPROVED:'1',TEXT_DRAFT_HTTP_DATABASE:'lumin_text_draft_'+'a'.repeat(32),PGHOST:'foreign',PGPASSWORD:'foreign'},'win32');
 expect(c.host).toBe('127.0.0.1');expect(c.port).toBe(55439);expect(c.ssl).toBe(false);expect(c.max).toBe(2);expect(typeof c.password).toBe('function');if(typeof c.password==='function')expect(await c.password()).toBe('');
});
it('fixture remains definition-only, deterministic and detached',()=>{const a=fixtureDefinition();a.fields[0]!.key='changed';expect(fixtureDefinition().fields[0]!.key).toBe('notes');expect(Object.keys(fixtureDefinition())).toEqual(['schemaVersion','fields']);});

it('waits for delayed client end events after pool/end promises have resolved',async()=>{
 const first=new EventEmitter(),second=new EventEmitter();const observations=[observeTextDraftConnectionEnd(first),observeTextDraftConnectionEnd(second)];
 let resolved=false;const done=awaitTextDraftConnectionCleanup([Promise.resolve(),Promise.resolve()],observations).then(()=>{resolved=true;});
 await Promise.resolve();expect(resolved).toBe(false);first.emit('end');await Promise.resolve();expect(resolved).toBe(false);
 second.emit('end');await done;expect(resolved).toBe(true);expect(observations.every(value=>value.observed())).toBe(true);
});
it('retains bounded failure when an end event never arrives',async()=>{
 vi.useFakeTimers();try{const observation=observeTextDraftConnectionEnd(new EventEmitter());const done=awaitTextDraftConnectionCleanup([Promise.resolve()],[observation],100);
 const rejected=expect(done).rejects.toThrow('TIME_BOUND');await vi.advanceTimersByTimeAsync(100);await rejected;expect(observation.observed()).toBe(false);
 }finally{vi.useRealTimers();}
});
it('retains observed early end and rejects end-call failure',async()=>{
 const emitter=new EventEmitter();const observation=observeTextDraftConnectionEnd(emitter);emitter.emit('end');
 await expect(awaitTextDraftConnectionCleanup([Promise.resolve()],[observation])).resolves.toBeUndefined();
 await expect(awaitTextDraftConnectionCleanup([Promise.reject(Error('END_FAILED'))],[observation])).rejects.toThrow('END_FAILED');
});

it('prompt fixture preserves exact inert text and leaves old fixtures detached',()=>{
 const definition=fixturePromptDefinition();
 expect(definition.fields[0]?.prompt).toBe('  Question \u{1f600} e\u0301 <b>plain text</b>  ');
 definition.fields[0]!.prompt='changed';
 expect(fixturePromptDefinition().fields[0]?.prompt).not.toBe('changed');
 expect(fixtureDefinition().fields[0]).not.toHaveProperty('prompt');
});
