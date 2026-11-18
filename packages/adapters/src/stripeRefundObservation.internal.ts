/** INTERNAL dormant observer. No default transport, runtime caller or barrel export. */
export type ObservationRequest=Readonly<{method:'GET';url:string;headers:Readonly<Record<string,string>>;redirect:'error';signal:AbortSignal}>;
export type ObservationResponse={status:number;url:string;redirected:boolean;body:AsyncIterable<Uint8Array>};
export type ObservationTransport=(request:ObservationRequest)=>Promise<ObservationResponse>;
type Reason='invalid_input'|'timeout'|'transport_error'|'redirect'|'rate_limited'|'http_error'|'byte_limit'|'record_limit'|'page_limit'|'chunk_limit'|'invalid_response'|'pagination_stalled'|'duplicate_refund'|'source_mismatch'|'observations_changed';
type Charge=Readonly<{chargeId:string;intentId:string|null;livemode:boolean;currency:string;amount:number;captured:boolean;amountCaptured:number;amountRefunded:number;refunded:boolean}>;
type Refund=Readonly<{refundId:string;chargeId:string|null;intentId:string|null;amount:number;currency:string;status:string|null}>;
const flags=Object.freeze({atomicSnapshot:false as const,accountingAuthorized:false as const,coverageComplete:false as const,sourceIdentityVerified:false as const});
class Refusal extends Error{constructor(readonly reason:Reason){super(reason);}}
const fail=(reason:Reason):never=>{throw new Refusal(reason);};
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))return fail('invalid_response');return v as Record<string,unknown>;}
function text(v:unknown,re:RegExp,max=255):string{if(typeof v!=='string'||v.length>max||/[\s\x00-\x1f\x7f]/.test(v)||!re.test(v))return fail('invalid_response');return v;}
const id=(v:unknown,prefix:'ch'|'pi'|'re')=>text(v,new RegExp(`^${prefix}_[A-Za-z0-9]{1,252}$`));
const nullableId=(v:unknown,prefix:'ch'|'pi')=>v===null?null:id(v,prefix);
const integer=(v:unknown):number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:fail('invalid_response');
const bool=(v:unknown):boolean=>typeof v==='boolean'?v:fail('invalid_response');
const currency=(v:unknown)=>text(v,/^[a-z]{3}$/,3).toUpperCase();
const failure=(reason:Reason)=>Object.freeze({status:'verification_required' as const,reason,...flags});
export function createStripeRefundObserverInternal(config:unknown,transport:ObservationTransport){
 let secretKey:string,platformAccountId:string,accountId:string,livemode:boolean,apiVersion:string;
 try{const c=object(config);if(Object.keys(c).sort().join('|')!==['secretKey','platformAccountId','accountId','livemode','apiVersion'].sort().join('|')||typeof transport!=='function')throw Error();
 secretKey=text(c.secretKey,/^[!-~]{8,256}$/,256);platformAccountId=text(c.platformAccountId,/^acct_[A-Za-z0-9]{8,64}$/,69);accountId=text(c.accountId,/^acct_[A-Za-z0-9]{8,64}$/,69);livemode=bool(c.livemode);apiVersion=text(c.apiVersion,/^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[a-z]+)?$/,64);
 }catch{throw Error('INVALID_STRIPE_OBSERVER_CONFIG');}
 // Primitive snapshot only. Configured platform is not response-authenticated ownership.
 void platformAccountId;
 const headers=Object.freeze({'Authorization':`Bearer ${secretKey}`,'Stripe-Account':accountId,'Stripe-Version':apiVersion,'Accept':'application/json'});
 return Object.freeze({async observe(expected:unknown){
 let chargeId:string,intentId:string;
 try{const e=object(expected);if(Object.keys(e).sort().join('|')!=='chargeId|intentId')throw Error();chargeId=id(e.chargeId,'ch');intentId=id(e.intentId,'pi');}catch{return failure('invalid_input');}
 const controller=new AbortController();let expired=false,bytes=0,chunks=0,pages=0,items=0;const started=Date.now();let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();reject(new Refusal('timeout'));},10000);});
 const check=()=>{if(expired||Date.now()-started>=10000){expired=true;controller.abort();fail('timeout');}};
 const bounded=<T>(p:Promise<T>)=>Promise.race([p,timeout]);
 const get=async(url:string):Promise<unknown>=>{
  check();let response:ObservationResponse;
  try{response=await bounded(Promise.resolve().then(()=>transport(Object.freeze({method:'GET',url,headers,redirect:'error',signal:controller.signal}))));}catch(e){if(e instanceof Refusal)throw e;return fail('transport_error');}
  check();if(!response||typeof response!=='object')return fail('invalid_response');
  const iterator=response.body&&typeof response.body[Symbol.asyncIterator]==='function'?response.body[Symbol.asyncIterator]():undefined;
  const parts:Uint8Array[]=[];let size=0,complete=false;
  try{
   if(response.redirected!==false||response.url!==url||response.status>=300&&response.status<400)fail('redirect');
   if(response.status===429)fail('rate_limited');if(response.status!==200)fail('http_error');
   if(!iterator)return fail('invalid_response');
   while(true){check();const next=await bounded(Promise.resolve().then(()=>iterator.next()));check();if(next.done){complete=true;break;}chunks++;if(chunks>8192)fail('chunk_limit');if(!(next.value instanceof Uint8Array))fail('invalid_response');size+=next.value.byteLength;bytes+=next.value.byteLength;if(size>1048576||bytes>8388608)fail('byte_limit');parts.push(next.value.slice());}}
  finally{if(!complete){controller.abort();try{void Promise.resolve(iterator?.return?.()).catch(()=>{});}catch{/* No transport details escape. */}}}
  const joined=new Uint8Array(size);let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined));}catch{return fail('invalid_response');}
 };
 const normalizeCharge=(raw:unknown):Charge=>{const c=object(raw);if(c.object!=='charge')return fail('invalid_response');const value:Charge=Object.freeze({chargeId:id(c.id,'ch'),intentId:nullableId(c.payment_intent,'pi'),livemode:bool(c.livemode),currency:currency(c.currency),amount:integer(c.amount),captured:bool(c.captured),amountCaptured:integer(c.amount_captured),amountRefunded:integer(c.amount_refunded),refunded:bool(c.refunded)});if(value.chargeId!==chargeId||value.livemode!==livemode||value.intentId!==null&&value.intentId!==intentId)fail('source_mismatch');return value;};
 const normalizeRefund=(raw:unknown,charge:Charge):Refund=>{const r=object(raw);if(r.object!=='refund')return fail('invalid_response');const status=r.status;if(status!==null&&(typeof status!=='string'||!['pending','requires_action','succeeded','failed','canceled'].includes(status)))return fail('invalid_response');const value:Refund=Object.freeze({refundId:id(r.id,'re'),chargeId:nullableId(r.charge,'ch'),intentId:nullableId(r.payment_intent,'pi'),amount:integer(r.amount),currency:currency(r.currency),status:status as string|null});if(value.chargeId!==null&&value.chargeId!==chargeId||value.intentId!==null&&value.intentId!==intentId||value.currency!==charge.currency||Object.hasOwn(r,'livemode')&&bool(r.livemode)!==livemode)fail('source_mismatch');return value;};
 const traverse=async(charge:Charge):Promise<readonly Refund[]>=>{const found=new Map<string,Refund>();let cursor:string|undefined;while(true){check();pages++;if(pages>40)fail('page_limit');const query=new URLSearchParams({charge:chargeId,limit:'100'});if(cursor)query.set('starting_after',cursor);const page=object(await get('https://api.stripe.com/v1/refunds?'+query.toString()));if(page.object!=='list'||page.url!=='/v1/refunds'||typeof page.has_more!=='boolean'||!Array.isArray(page.data)||page.data.length>100)fail('invalid_response');const data=page.data as unknown[];items+=data.length;if(items>2000)fail('record_limit');if(page.has_more&&data.length===0)fail('pagination_stalled');for(const raw of data){const refund=normalizeRefund(raw,charge);if(found.has(refund.refundId))fail('duplicate_refund');found.set(refund.refundId,refund);cursor=refund.refundId;}if(!page.has_more)break;}return Object.freeze([...found.values()].sort((a,b)=>a.refundId<b.refundId?-1:a.refundId>b.refundId?1:0));};
 try{const before=normalizeCharge(await get('https://api.stripe.com/v1/charges/'+chargeId));const first=await traverse(before),second=await traverse(before);const after=normalizeCharge(await get('https://api.stripe.com/v1/charges/'+chargeId));check();if(JSON.stringify(before)!==JSON.stringify(after)||JSON.stringify(first)!==JSON.stringify(second))fail('observations_changed');const unresolved=before.intentId===null||first.some(r=>r.chargeId===null||r.intentId===null||r.status===null);return Object.freeze({status:unresolved?'unresolved' as const:'observed_stable' as const,traversalComplete:true as const,charge:before,refunds:first,...flags});}
 catch(e){controller.abort();return failure(e instanceof Refusal?e.reason:expired?'timeout':'transport_error');}
 finally{if(timer!==undefined)clearTimeout(timer);controller.abort();}
 }});
}
