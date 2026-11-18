import {describe,it,expect,vi} from 'vitest';
// Fake-only transport fixture scaffold. Final contract assertions follow reviewed result schema.
const secret='sk_test_synthetic_not_a_real_credential';
const config=()=>({secretKey:secret,platformAccountId:'acct_platformAAA',accountId:'acct_connectedAA',livemode:false,apiVersion:'2024-06-20'});
const charge=(extra:Record<string,unknown>={})=>({id:'ch_fixture',object:'charge',livemode:false,payment_intent:'pi_fixture',currency:'usd',amount:100,captured:true,amount_captured:100,amount_refunded:100,refunded:true,...extra});
const refund=(i:number,extra:Record<string,unknown>={})=>({id:`re_fixture${i}`,object:'refund',charge:'ch_fixture',payment_intent:'pi_fixture',currency:'usd',amount:1,status:'succeeded',...extra});
type Request={method:'GET';url:string;headers:Readonly<Record<string,string>>;redirect:'error';signal:AbortSignal};
type Response={status:number;url:string;redirected:boolean;body:AsyncIterable<Uint8Array>};
async function* chunks(raw:string,size=7){const bytes=new TextEncoder().encode(raw);for(let offset=0;offset<bytes.length;offset+=size)yield bytes.slice(offset,offset+size);}
function reply(request:Request,value:unknown,extra:Partial<Response>={}):Response{return {status:200,url:request.url,redirected:false,body:chunks(JSON.stringify(value),1024),...extra};}
function pagedTransport(count:number,mutate?:(pass:number,rows:Record<string,unknown>[])=>Record<string,unknown>[]){
 let traversal=0;
 const calls:Request[]=[];
 const transport=vi.fn(async(request:Request):Promise<Response>=>{
  calls.push(request);const url=new URL(request.url);
  if(url.pathname==='/v1/charges/ch_fixture')return reply(request,charge());
  if(url.pathname!=='/v1/refunds')throw Error('UNEXPECTED_SYNTHETIC_REQUEST');
  const after=url.searchParams.get('starting_after');if(!after)traversal++;
  let rows:Record<string,unknown>[]=Array.from({length:count},(_,i)=>refund(i));if(mutate)rows=mutate(traversal,rows);
  const start=after?rows.findIndex(r=>r.id===after)+1:0;
  if(after&&start===0)throw Error('SYNTHETIC_CURSOR_UNKNOWN');
  const data=rows.slice(start,start+100);
  return reply(request,{object:'list',url:'/v1/refunds',data,has_more:start+100<rows.length});
 });
 return {transport,calls};
}
// Transport fixture sanity check.
describe('refund observer injected transport fixtures',()=>{
 it('streams byte chunks without a network transport',async()=>{const request={method:'GET' as const,url:'https://api.stripe.com/v1/charges/ch_fixture',headers:{},redirect:'error' as const,signal:new AbortController().signal};const r=reply(request,charge());let text='';const decoder=new TextDecoder();for await(const bytes of r.body)text+=decoder.decode(bytes,{stream:true});text+=decoder.decode();expect(JSON.parse(text)).toEqual(charge());});
});
import {createStripeRefundObserverInternal as create} from '../src/stripeRefundObservation.internal';
const flags={atomicSnapshot:false,accountingAuthorized:false,coverageComplete:false,sourceIdentityVerified:false};
const input={chargeId:'ch_fixture',intentId:'pi_fixture'};
const failed=(r:unknown,reason?:string)=>{expect(r).toEqual({...flags,status:'verification_required',reason:reason??expect.any(String)});};
const run=(transport:any)=>create(config(),transport).observe(input);
describe('dormant refund observer with injected bytes only',()=>{
 it.each([0,101,1000])('traverses %i records twice within aggregate limits',async count=>{const p=pagedTransport(count);const r=await run(p.transport);expect(r).toMatchObject({...flags,status:'observed_stable',traversalComplete:true});if(r.status==='verification_required')throw Error('unexpected failure');expect(r.refunds).toHaveLength(count);if(!r.charge)throw Error('missing charge');expect(Object.keys(r.charge).sort()).toEqual(['chargeId','intentId','livemode','currency','amount','captured','amountCaptured','amountRefunded','refunded'].sort());for(const call of p.calls){expect(call.method).toBe('GET');expect(call.redirect).toBe('error');expect(Object.isFrozen(call.headers)).toBe(true);const u=new URL(call.url);expect(u.origin).toBe('https://api.stripe.com');if(u.pathname==='/v1/refunds'){expect(u.searchParams.get('charge')).toBe('ch_fixture');expect(u.searchParams.get('limit')).toBe('100');}}expect(p.calls[0]!.url).toContain('/v1/charges/ch_fixture');expect(p.calls.at(-1)?.url).toContain('/v1/charges/ch_fixture');});
 it('supports more than ten pages inside shared budgets',async()=>{let passes=0;const t=vi.fn(async(q:Request)=>{const u=new URL(q.url);if(u.pathname.includes('/charges/'))return reply(q,charge());const after=u.searchParams.get('starting_after');if(!after)passes++;const n=after?Number(after.replace('re_fixture',''))+1:0;return reply(q,{object:'list',url:'/v1/refunds',data:[refund(n)],has_more:n<10});});expect(await run(t)).toMatchObject({status:'observed_stable'});expect(passes).toBe(2);expect(t).toHaveBeenCalledTimes(24);});
 it.each(['insert','status'])('detects between-pass %s churn',async kind=>{const p=pagedTransport(2,(pass,rows)=>pass===2?(kind==='insert'?[...rows,refund(99)]:rows.map((r,i)=>i===0?{...r,status:'pending'}:r)):rows);failed(await run(p.transport),'observations_changed');});
 it('ignores provider order but compares closed facts',async()=>{const p=pagedTransport(2,(pass,rows)=>pass===2?rows.reverse():rows);expect(await run(p.transport)).toMatchObject({status:'observed_stable'});});
 it.each([null,'pending','requires_action','succeeded','failed','canceled'])('preserves refund status %s without financial verdict',async status=>{const p=pagedTransport(1,(_,rows)=>rows.map(r=>({...r,status})));const r=await run(p.transport);expect(r).toMatchObject({...flags,status:status===null?'unresolved':'observed_stable'});});
 it.each(['charge','payment_intent'])('null refund %s is unresolved, contradictory is source mismatch',async key=>{for(const value of [null,key==='charge'?'ch_wrong':'pi_wrong']){const p=pagedTransport(1,(_,rows)=>rows.map(r=>({...r,[key]:value})));const r=await run(p.transport);if(value===null)expect(r).toMatchObject({status:'unresolved'});else failed(r,'source_mismatch');}});
 it('requires charge mode and rejects wrong mode',async()=>{for(const mode of [undefined,'false',true]){const t=async(q:Request)=>reply(q,charge({livemode:mode}));failed(await run(t));}});
 it.each([429,500])('redacts HTTP %i response',async status=>{failed(await run(async(q:Request)=>reply(q,{secret,error:'private-detail'},{status})),status===429?'rate_limited':'http_error');});
 it('rejects redirects and response URL drift',async()=>{for(const extra of [{redirected:true},{url:'https://evil.invalid/'}])failed(await run(async(q:Request)=>reply(q,charge(),extra)),'redirect');});
 it('redacts thrown transport secrets',async()=>{const r=await run(async()=>{throw Error(secret+' private detail');});failed(r,'transport_error');expect(JSON.stringify(r)).not.toContain(secret);});
 it('rejects invalid JSON and oversized bytes',async()=>{failed(await run(async(q:Request)=>reply(q,null,{body:chunks('{')})),'invalid_response');failed(await run(async(q:Request)=>reply(q,null,{body:chunks(' '.repeat(1048577),1048577)})),'byte_limit');});
 it('rejects duplicate records and empty has_more pages',async()=>{for(const data of [[refund(0),refund(0)],[]]){const t=async(q:Request)=>q.url.includes('/charges/')?reply(q,charge()):reply(q,{object:'list',url:'/v1/refunds',data,has_more:true});failed(await run(t),data.length?'duplicate_refund':'pagination_stalled');}});
 it('enforces shared record budget',async()=>{failed(await run(pagedTransport(1001).transport),'record_limit');});
 it('copies caller config and never defaults to global fetch',async()=>{const spy=vi.spyOn(globalThis,'fetch').mockImplementation(()=>{throw Error('network forbidden');});try{const cfg=config(),p=pagedTransport(0),observer=create(cfg,p.transport);cfg.secretKey='changed';cfg.accountId='acct_changedAAA';expect(await observer.observe(input)).toMatchObject({status:'observed_stable'});expect(JSON.stringify(p.calls[0]!.headers)).toContain(secret);expect(JSON.stringify(p.calls[0]!.headers)).toContain('acct_connectedAA');expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}});
 it.each(['transport','stream'])('whole deadline stops noncooperative %s',async kind=>{vi.useFakeTimers();try{const t=async(q:Request)=>kind==='transport'?await new Promise<Response>(()=>{}):reply(q,null,{body:{[Symbol.asyncIterator](){return {next:()=>new Promise<IteratorResult<Uint8Array>>(()=>{})};}}});const pending=run(t);await vi.advanceTimersByTimeAsync(10001);failed(await pending,'timeout');}finally{vi.useRealTimers();}});
});
it('enforces page budget with short nonempty pages',async()=>{let i=0;failed(await run(async(q:Request)=>q.url.includes('/charges/')?reply(q,charge()):reply(q,{object:'list',url:'/v1/refunds',data:[refund(i++)],has_more:true})),'page_limit');});
it('enforces whole-attempt chunk limit',async()=>{async function* many(){for(let i=0;i<8193;i++)yield new Uint8Array(0);yield new TextEncoder().encode(JSON.stringify(charge()));}failed(await run(async(q:Request)=>reply(q,null,{body:many()})),'chunk_limit');});
it('enforces aggregate response bytes below individual response maximum',async()=>{let i=0;const t=async(q:Request)=>{const value=q.url.includes('/charges/')?charge():{object:'list',url:'/v1/refunds',data:[refund(i++)],has_more:true};const raw=JSON.stringify(value)+' '.repeat(900000);return reply(q,null,{body:chunks(raw,100000)});};failed(await run(t),'byte_limit');});
it('does not accept mutated charge after traversals',async()=>{const p=pagedTransport(1);let charges=0;const t=async(q:Request)=>{if(q.url.includes('/charges/'))return reply(q,charge({amount_refunded:++charges===1?100:50}));return p.transport(q);};failed(await run(t),'observations_changed');});


it.each([429,302])('closes unconsumed rejected response body status %i',async status=>{const close=vi.fn(async()=>({done:true as const,value:undefined}));const next=vi.fn(async()=>({done:false as const,value:new Uint8Array([1])}));await run(async(q:Request)=>reply(q,null,{status,redirected:status===302,body:{[Symbol.asyncIterator](){return {next,return:close};}}}));expect(next).not.toHaveBeenCalled();expect(close).toHaveBeenCalledTimes(1);});

it('rejects malformed constructor config without secret echo',()=>{for(const change of [{extraHeaders:{}},{apiVersion:'2024-06-20\n'},{apiVersion:undefined},{secretKey:undefined}]){let error;try{create({...config(),...change} as any,vi.fn());}catch(e){error=e;}expect(error).toBeDefined();expect(String(error)).not.toContain(secret);}expect(()=>create(config(),undefined as any)).toThrow();});
it('rejects request extensions and invalid identifiers before transport',async()=>{for(const value of [{...input,url:'https://evil.invalid'},{...input,headers:{}},{...input,chargeId:'pi_wrong'},{...input,intentId:'pi_bad\n'}]){const t=vi.fn();failed(await create(config(),t).observe(value as any),'invalid_input');expect(t).not.toHaveBeenCalled();}});
it('fatal UTF8 decoding rejects malformed byte sequence',async()=>{async function* bad(){yield new Uint8Array([0xc3,0x28]);}failed(await run(async(q:Request)=>reply(q,null,{body:bad()})),'invalid_response');});
it('optional refund mode absent works, mismatch or coercion fails',async()=>{for(const value of [true,'false',null]){const p=pagedTransport(1,(_,rows)=>rows.map(r=>({...r,livemode:value})));failed(await run(p.transport));}});
it('expanded pointers are unsupported, never silently projected',async()=>{for(const field of ['charge','payment_intent']){const p=pagedTransport(1,(_,rows)=>rows.map(r=>({...r,[field]:{id:field==='charge'?'ch_fixture':'pi_fixture'}})));failed(await run(p.transport),'invalid_response');}});
it('charge null PI is unresolved and nonnull mismatches are rejected',async()=>{for(const patch of [{payment_intent:null},{payment_intent:'pi_wrong'},{id:'ch_wrong'}]){const p=pagedTransport(0),t=async(q:Request)=>q.url.includes('/charges/')?reply(q,charge(patch)):p.transport(q);const r=await run(t);if(patch.payment_intent===null)expect(r).toMatchObject({status:'unresolved'});else failed(r,'source_mismatch');}});
it('requires every normalized source fact explicitly',async()=>{for(const key of ['id','object','livemode','payment_intent','currency','amount','captured','amount_captured','amount_refunded','refunded']){const c:Record<string,unknown>=charge();delete c[key];failed(await run(async(q:Request)=>reply(q,c)));}for(const key of ['id','object','charge','payment_intent','currency','amount','status']){const p=pagedTransport(1,(_,rows)=>rows.map(r=>{const x={...r};delete x[key];return x;}));failed(await run(p.transport));}});
it('returns deeply frozen closed facts without metadata or raw errors',async()=>{const p=pagedTransport(1,(_,rows)=>rows.map(r=>({...r,metadata:{email:'PRIVATE_EMAIL'},failure_reason:'PRIVATE_ERROR'})));const r=await run(p.transport);expect(r.status).toBe('observed_stable');if(r.status==='verification_required')throw Error('unexpected failure');expect(Object.isFrozen(r)).toBe(true);expect(Object.isFrozen(r.charge)).toBe(true);expect(Object.isFrozen(r.refunds)).toBe(true);expect(Object.isFrozen(r.refunds?.[0])).toBe(true);expect(JSON.stringify(r)).not.toMatch(/PRIVATE_EMAIL|PRIVATE_ERROR|metadata|failure_reason/);expect(Object.keys(r.refunds![0]!)).toHaveLength(6);});
it('insertion during pagination is caught by second full traversal',async()=>{let pass=0;const t=async(q:Request)=>{const u=new URL(q.url);if(u.pathname.includes('/charges/'))return reply(q,charge());const after=u.searchParams.get('starting_after');if(!after){pass++;return reply(q,{object:'list',url:'/v1/refunds',data:pass===1?[refund(0)]:[refund(99),refund(0)],has_more:true});}return reply(q,{object:'list',url:'/v1/refunds',data:[refund(1)],has_more:false});};failed(await run(t),'observations_changed');});
it('repeated last ID cannot advance pagination',async()=>{failed(await run(async(q:Request)=>q.url.includes('/charges/')?reply(q,charge()):reply(q,{object:'list',url:'/v1/refunds',data:[refund(0)],has_more:true})),'duplicate_refund');});

it.each(['\n','\r','\r\n'])('rejects trailing control sequence %j in all string authority fields',async suffix=>{
 for(const key of ['accountId','platformAccountId','apiVersion']){const c=config();expect(()=>create({...c,[key]:c[key as keyof typeof c]+suffix},vi.fn())).toThrow('INVALID_STRIPE_OBSERVER_CONFIG');}
 for(const key of ['chargeId','intentId']){const t=vi.fn();failed(await create(config(),t).observe({...input,[key]:input[key as keyof typeof input]+suffix}),'invalid_input');expect(t).not.toHaveBeenCalled();}
 for(const key of ['id','payment_intent','currency']){const c=charge();failed(await run(async(q:Request)=>reply(q,charge({[key]:c[key as keyof typeof c]+suffix}))),'invalid_response');}
 for(const key of ['id','charge','payment_intent','currency']){const p=pagedTransport(1,(_,rows)=>rows.map(r=>({...r,[key]:String(r[key])+suffix})));failed(await run(p.transport),'invalid_response');}
});
