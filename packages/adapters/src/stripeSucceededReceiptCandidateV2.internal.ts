/** INTERNAL explicit v2 succeeded-event facts projection ONLY, not signature/source verification.
 * Output is an unverified candidate even if its shape is valid. Future ingress
 * must verify exact raw bytes and trusted source before invoking/storing it.
 * Old v1 callers are unchanged. Status/requested/received/capturable are separate
 * observations, NOT paid/eligible/confirmed verdicts. No runtime caller,
 * persistence, ACK, financial action or barrel export.
 */
export function normalizeStripeSucceededReceiptCandidateV2(rawEvent: unknown, trustedIngressContext: unknown) {
 try {
  const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v as Record<string,unknown>;};
  const str=(v:unknown,pattern:RegExp,max:number):string=>{if(typeof v!=='string'||v.length>max||/[\s\x00-\x1f\x7f]/.test(v)||!pattern.test(v))throw Error();return v;};
  const integer=(v:unknown,min:number,max:number):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)throw Error();return v;};
  const ctx=object(trustedIngressContext);
  if(Object.keys(ctx).length!==1||!Object.hasOwn(ctx,'platformAccountId'))throw Error();
  const platformAccountId=str(ctx.platformAccountId,/^acct_[A-Za-z0-9]{8,64}$/,69);
  const event=object(rawEvent),pi=object(object(event.data).object);
  if(event.object!=='event'||pi.object!=='payment_intent')throw Error();
  const mode=event.livemode,objectMode=pi.livemode,type=event.type,apiVersion=event.api_version;
  if(typeof mode!=='boolean'||typeof objectMode!=='boolean'||mode!==objectMode)throw Error();
  if(typeof type!=='string'||!['payment_intent.succeeded'].includes(type))throw Error();
  if(!Object.hasOwn(event,'api_version'))throw Error();
  const eventApiVersion=apiVersion===null?null:str(apiVersion,/^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[a-z]+)?$/,64);
  const status=pi.status;
  if(typeof status!=='string'||!['requires_payment_method','requires_confirmation','requires_action','processing','requires_capture','canceled','succeeded'].includes(status))throw Error();
  return Object.freeze({provider:'stripe_connect' as const,platformAccountId,
   accountId:str(event.account,/^acct_[A-Za-z0-9]{8,64}$/,69),livemode:mode,
   eventId:str(event.id,/^evt_[A-Za-z0-9]{1,251}$/,255),objectType:'payment_intent' as const,eventType:type,
   eventCreated:integer(event.created,0,253402300799),eventApiVersion,parserVersion:2 as const,schemaVersion:2 as const,
   intentId:str(pi.id,/^pi_[A-Za-z0-9]{1,252}$/,255),intentAmount:integer(pi.amount,1,Number.MAX_SAFE_INTEGER),currency:str(pi.currency,/^[a-z]{3}$/,3).toUpperCase(),
   intentStatus:status,amountReceived:integer(pi.amount_received,0,Number.MAX_SAFE_INTEGER),amountCapturable:integer(pi.amount_capturable,0,Number.MAX_SAFE_INTEGER)});
 } catch { throw new Error('INVALID_STRIPE_RECEIPT_CANDIDATE'); }
}
