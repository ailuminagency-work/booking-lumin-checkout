/** INTERNAL ONLY: input/output contain a booking capability. Never expose/log.
 * No network or credentials; no runtime caller or barrel export. Syntax != compatibility.
 */
function record(value: unknown, keys: string[]): Record<string,unknown> {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_PAYMENT_ENVELOPE');
 const obj=value as Record<string,unknown>;
 if(Object.keys(obj).sort().join('|')!==keys.sort().join('|'))throw Error('INVALID_PAYMENT_ENVELOPE');
 return obj;
}
export function serializeStripeRequestEnvelopeInternal(value: unknown) {
 const e=record(value,['serializerVersion','apiVersion','tenantId','bookingId','amount','currency','idempotencyKey','source']);
 const s=record(e.source,['platformAccountId','accountId','livemode','chargeModel']);
 const matches=(v:unknown,r:RegExp)=>typeof v==='string'&&!/[\s\x00-\x1f\x7f]/.test(v)&&r.test(v);
 if(e.serializerVersion!==1||!matches(e.apiVersion,/^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[a-z]+)?$/)||String(e.apiVersion).length>64
 ||!matches(e.tenantId,/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)||!matches(e.bookingId,/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
 ||typeof e.amount!=='number'||!Number.isSafeInteger(e.amount)||e.amount<=0||!matches(e.currency,/^[A-Z]{3}$/)
 ||!matches(e.idempotencyKey,/^[!-~]{16,255}$/)||!matches(s.accountId,/^acct_[A-Za-z0-9]{8,64}$/)
 ||!matches(s.platformAccountId,/^acct_[A-Za-z0-9]{8,64}$/)||typeof s.livemode!=='boolean'||s.chargeModel!=='direct')throw Error('INVALID_PAYMENT_ENVELOPE');
 const body=new URLSearchParams();
 body.set('amount',String(e.amount));body.set('currency',String(e.currency).toLowerCase());
 body.set('metadata[tenantId]',String(e.tenantId));body.set('metadata[bookingId]',String(e.bookingId));
 body.set('automatic_payment_methods[enabled]','true');
 return Object.freeze({method:'POST' as const,path:'/v1/payment_intents' as const,body:body.toString(),
 headers:Object.freeze({'Content-Type':'application/x-www-form-urlencoded','Stripe-Version':String(e.apiVersion),'Stripe-Account':String(s.accountId),'Idempotency-Key':String(e.idempotencyKey)}),
 source:Object.freeze({platformAccountId:String(s.platformAccountId),accountId:String(s.accountId),livemode:s.livemode,chargeModel:'direct' as const})});
}
