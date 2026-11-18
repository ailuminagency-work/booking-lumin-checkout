/** INTERNAL dormant facts projection, NOT signature/source proof or refund accounting.
 * No runtime caller, financial action, persistence, or barrel export. Nullable
 * pointers are observations, never inferred from metadata or refund-list entries.
 */
type Common = Readonly<{
 provider:'stripe_connect'; platformAccountId:string; accountId:string; livemode:boolean;
 eventId:string; eventCreated:number; eventApiVersion:string|null; parserVersion:3;
 schemaVersion:3; currency:string; intentId:string|null;
}>;
export type StripeRefundReceiptCandidateV3 = Common & (
 Readonly<{objectType:'charge';eventType:'charge.refunded';chargeId:string;chargeAmount:number;
 chargeCaptured:boolean;chargeAmountCaptured:number;chargeAmountRefunded:number;chargeRefunded:boolean}> |
 Readonly<{objectType:'refund';eventType:'refund.created'|'refund.updated'|'refund.failed';
 refundId:string;refundAmount:number;refundStatus:'pending'|'requires_action'|'succeeded'|'failed'|'canceled'|null;chargeId:string|null}>
);
export function normalizeStripeRefundReceiptCandidateV3(rawEvent:unknown, trustedIngressContext:unknown):StripeRefundReceiptCandidateV3 {
 try {
  const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v as Record<string,unknown>;};
  const str=(v:unknown,pattern:RegExp,max:number):string=>{if(typeof v!=='string'||v.length>max||/[\s\x00-\x1f\x7f]/.test(v)||!pattern.test(v))throw Error();return v;};
  const integer=(v:unknown,max=Number.MAX_SAFE_INTEGER):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw Error();return v;};
  const bool=(v:unknown):boolean=>{if(typeof v!=='boolean')throw Error();return v;};
  const id=(v:unknown,prefix:'pi'|'ch'|'re'):string=>str(v,new RegExp(`^${prefix}_[A-Za-z0-9]{1,252}$`),255);
  const nullableId=(v:unknown,prefix:'pi'|'ch'):string|null=>v===null?null:id(v,prefix);
  const ctx=object(trustedIngressContext);
  if(Object.keys(ctx).length!==1||!Object.hasOwn(ctx,'platformAccountId'))throw Error();
  const event=object(rawEvent),item=object(object(event.data).object);
  if(event.object!=='event'||!Object.hasOwn(event,'api_version'))throw Error();
  const mode=bool(event.livemode),type=event.type;
  const common:Common={provider:'stripe_connect',platformAccountId:str(ctx.platformAccountId,/^acct_[A-Za-z0-9]{8,64}$/,69),
   accountId:str(event.account,/^acct_[A-Za-z0-9]{8,64}$/,69),livemode:mode,
   eventId:str(event.id,/^evt_[A-Za-z0-9]{1,251}$/,255),eventCreated:integer(event.created,253402300799),
   eventApiVersion:event.api_version===null?null:str(event.api_version,/^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[a-z]+)?$/,64),
   parserVersion:3,schemaVersion:3,currency:str(item.currency,/^[a-z]{3}$/,3).toUpperCase(),intentId:nullableId(item.payment_intent,'pi')};
  if(type==='charge.refunded'&&item.object==='charge') {
   if(bool(item.livemode)!==mode)throw Error();
   return Object.freeze({...common,objectType:'charge',eventType:type,chargeId:id(item.id,'ch'),
    chargeAmount:integer(item.amount),chargeCaptured:bool(item.captured),chargeAmountCaptured:integer(item.amount_captured),
    chargeAmountRefunded:integer(item.amount_refunded),chargeRefunded:bool(item.refunded)});
  }
  if((type==='refund.created'||type==='refund.updated'||type==='refund.failed')&&item.object==='refund') {
   if(Object.hasOwn(item,'livemode')&&bool(item.livemode)!==mode)throw Error();
   const status=item.status;
   if(status!==null&&(typeof status!=='string'||!['pending','requires_action','succeeded','failed','canceled'].includes(status)))throw Error();
   return Object.freeze({...common,objectType:'refund',eventType:type,refundId:id(item.id,'re'),refundAmount:integer(item.amount),
    refundStatus:status as 'pending'|'requires_action'|'succeeded'|'failed'|'canceled'|null,chargeId:nullableId(item.charge,'ch')});
  }
  throw Error();
 } catch {throw new Error('INVALID_STRIPE_RECEIPT_CANDIDATE');}
}
