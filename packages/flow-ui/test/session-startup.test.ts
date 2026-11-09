import {afterEach,it,expect,vi} from 'vitest';
import {createFlowClient,FLOW_SESSION_STARTUP_TIMEOUT_MS} from '../src/client';
const id='11111111-1111-4111-8111-111111111111',token='t'.repeat(43);
const data={sessionToken:token,expiresAt:'2035-01-01T00:00:00Z',render:{versionId:id,config:{key:'test',steps:[{key:'q',questionKey:'q',kind:'question',required:true}]},service:{id,name:'Test',durationMinutes:30,questions:[{id:'q',prompt:'Choose an option',kind:'single_choice',required:true,choices:[{id:'a',label:'Option A'}]}]}}};
const response=()=>new Response(JSON.stringify({ok:true,data}));
afterEach(()=>vi.useRealTimers());
it.each(['session','customerFieldSession','conditionalCustomerFieldSession'] as const)('bounds never-settling %s fetch and aborts without automatic retry',async method=>{
 vi.useFakeTimers();const fetcher=vi.fn<typeof fetch>(()=>new Promise(()=>{})),client=createFlowClient('https://api.example',false,fetcher);
 const pending=client[method](id),failure=expect(pending).rejects.toMatchObject({message:expect.stringContaining('temporary session could not be verified')});
 const signal=fetcher.mock.calls[0]![1]!.signal!;
 await vi.advanceTimersByTimeAsync(FLOW_SESSION_STARTUP_TIMEOUT_MS-1);expect(signal.aborted).toBe(false);
 await vi.advanceTimersByTimeAsync(1);await failure;expect(signal.aborted).toBe(true);
 await vi.advanceTimersByTimeAsync(2*FLOW_SESSION_STARTUP_TIMEOUT_MS);expect(fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('bounds a never-settling response body and discards its late valid result',async()=>{
 vi.useFakeTimers();let finish!:(value:unknown)=>void;
 const fetcher=vi.fn<typeof fetch>(async()=>({ok:true,json:()=>new Promise(resolve=>finish=resolve)}) as Response),client=createFlowClient('https://api.example',false,fetcher);
 const pending=client.conditionalCustomerFieldSession(id),failure=expect(pending).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 await vi.advanceTimersByTimeAsync(FLOW_SESSION_STARTUP_TIMEOUT_MS);await failure;finish({ok:true,data});await Promise.resolve();
 expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it('invalidates a pending startup immediately, clears its deadline, and rejects late old-context responses',async()=>{
 vi.useFakeTimers();let finish!:(value:Response)=>void;
 const fetcher=vi.fn<typeof fetch>(()=>new Promise(resolve=>finish=resolve)),client=createFlowClient('https://api.example',false,fetcher);
 const pending=client.customerFieldSession(id),failure=expect(pending).rejects.toMatchObject({code:'UNAUTHENTICATED'});client.invalidate();await failure;
 expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);finish(response());await Promise.resolve();
 fetcher.mockImplementation(async()=>response());expect(await client.conditionalCustomerFieldSession(id)).toEqual(data);expect(vi.getTimerCount()).toBe(0);
});
it('keeps successful startup request protections and clears its timer only after validated parsing',async()=>{
 vi.useFakeTimers();const fetcher=vi.fn<typeof fetch>(async()=>response()),client=createFlowClient('https://api.example',false,fetcher);
 expect(await client.conditionalCustomerFieldSession(id)).toEqual(data);expect(vi.getTimerCount()).toBe(0);
 expect(fetcher.mock.calls[0]![1]).toMatchObject({method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',body:'{}'});
 expect(fetcher.mock.calls[0]![1]!.headers).not.toHaveProperty('Authorization');expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(false);
});
it('rejects malformed startup without extending its deadline or leaking server detail',async()=>{
 vi.useFakeTimers();const client=createFlowClient('https://api.example',false,async()=>new Response(JSON.stringify({ok:true,data:{...data,secret:'private'}})));
 await expect(client.conditionalCustomerFieldSession(id)).rejects.toMatchObject({code:'INTERNAL_ERROR'});expect(vi.getTimerCount()).toBe(0);
});
it.each(['timeout','invalidate'])('never admits a late V6 capability after startup %s',async reason=>{
 vi.useFakeTimers();let finish!:(value:unknown)=>void;
 const fetcher=vi.fn<typeof fetch>(async()=>({ok:true,json:()=>new Promise(resolve=>finish=resolve)}) as Response),client=createFlowClient('https://api.example',false,fetcher);
 const pending=client.conditionalCustomerFieldSession(id),failure=expect(pending).rejects.toMatchObject({code:reason==='timeout'?'INTERNAL_ERROR':'UNAUTHENTICATED'});
 await Promise.resolve();if(reason==='timeout')await vi.advanceTimersByTimeAsync(FLOW_SESSION_STARTUP_TIMEOUT_MS);else client.invalidate();await failure;
 const render={versionId:id,renderSchemaVersion:6,submissionMode:'paid_conditional_customer_field_request',paymentMode:'staging_mock',simulated:true,service:{id,name:'Cleaning',durationMinutes:60,price:{amount:12500,currency:'USD'}},publication:{name:'Cleaning form',draftRevision:3,presentation:{accentColor:'#4f46e5',layout:'stacked'}},customerFields:[{id:'custom_access',kind:'text',label:'Access',required:true,maxLength:20}]};
 finish({ok:true,data:{...data,render}});await Promise.resolve();await Promise.resolve();
 await expect(client.submitConditionalCustomerFields(token,{schemaVersion:3,idempotencyKey:'conditional-request-123456',answers:{},customerAnswers:{custom_access:'key'},customer:{name:'Controlled',email:'controlled@example.test'},requestedStart:'2030-01-01T10:00:00Z'})).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 expect(fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('handles an abort-ignoring transport rejection after the deadline without retry or leaking its reason',async()=>{
 vi.useFakeTimers();let rejectFetch!:(reason:unknown)=>void;
 const fetcher=vi.fn<typeof fetch>(()=>new Promise((_,reject)=>rejectFetch=reject)),client=createFlowClient('https://api.example',false,fetcher);
 const pending=client.session(id),failure=expect(pending).rejects.toMatchObject({message:expect.stringContaining('temporary session could not be verified')});
 await vi.advanceTimersByTimeAsync(FLOW_SESSION_STARTUP_TIMEOUT_MS);await failure;rejectFetch(Error('private transport details'));await Promise.resolve();await Promise.resolve();
 expect(fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it.each(['hold','mockPayment'] as const)('does not add deadlines, abort signals or replay to %s writers',async method=>{
 vi.useFakeTimers();let finish!:(value:Response)=>void;const fetcher=vi.fn<typeof fetch>(()=>new Promise(resolve=>finish=resolve)),client=createFlowClient('https://api.example',false,fetcher);
 let settled=false;const pending=client[method](token).finally(()=>settled=true),failure=expect(pending).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 await vi.advanceTimersByTimeAsync(3*FLOW_SESSION_STARTUP_TIMEOUT_MS);expect(settled).toBe(false);expect(fetcher.mock.calls[0]![1]).not.toHaveProperty('signal');expect(fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 finish(new Response('{}'));await failure;
});
