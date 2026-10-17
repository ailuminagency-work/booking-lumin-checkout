export interface StoredMoney {amount:number;currency:string}
export interface ConnectedBookingDetail {
 id:string;tenantId:string;reference:string;state:string;slotStart:string;slotEnd:string;createdAt:string;
 serviceId:string;customer:{name:string;email:string;phone:string|null}|null;
 selection:Record<string,unknown>;address:Record<string,unknown>|null;notes:string|null;
 total:StoredMoney|null;deposit:StoredMoney|null;
 payment:{id:string;state:string;amount:StoredMoney;provider:string}|null;
 history:Array<{from:string|null;to:string;reason:string|null;at:string}>;
}
const states=['draft','pending_payment','confirmed','completed','cancelled','refunded','failed'];
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const instant=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const bounded=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max;
const invalid=():never=>{throw Error('Booking detail could not be verified. Please refresh.');};
function money(v:unknown):StoredMoney{if(!record(v)||!Number.isSafeInteger(v.amount)||Number(v.amount)<0||typeof v.currency!=='string'||!/^[A-Z]{3}$/.test(v.currency))return invalid();return{amount:Number(v.amount),currency:v.currency};}
/** Validate both parent and embedded rows; never trust an adapter to maintain tenant binding. */
export function parseBookingDetail(value:unknown,tenant:string,id:string):ConnectedBookingDetail|null{
 if(!Array.isArray(value)||value.length>1)return invalid();if(value.length===0)return null;
 const r=value[0];if(!record(r)||r.id!==id||r.tenant_id!==tenant||!uuid(r.id)||!bounded(r.reference,200)||!states.includes(String(r.state))||!instant(r.slot_start)||!instant(r.slot_end)||Date.parse(r.slot_end)<=Date.parse(r.slot_start)||!instant(r.created_at)||!record(r.selection)||!uuid(r.selection.serviceId)||!record(r.pricing)||(r.notes!==null&&!bounded(r.notes,2000))||(r.address!==null&&!record(r.address)))return invalid();
 if(JSON.stringify(r.selection).length>32768||JSON.stringify(r.address).length>16384)return invalid();
 let customer:ConnectedBookingDetail['customer']=null;
 if(r.customer_id!==null){const c=r.customer;if(!uuid(r.customer_id)||!record(c)||c.id!==r.customer_id||c.tenant_id!==tenant||!bounded(c.name,200)||!bounded(c.email,254)||(c.phone!==null&&!bounded(c.phone,100)))return invalid();customer={name:c.name,email:c.email,phone:c.phone as string|null};}
 else if(r.customer!==null)return invalid();
 const empty=Object.keys(r.pricing).length===0;const total=empty?null:money(r.pricing.total);const deposit=empty?null:money(r.pricing.deposit);
 if(total&&deposit&&total.currency!==deposit.currency)return invalid();
 let payment:ConnectedBookingDetail['payment']=null;
 if(r.payment_id!==null){const p=r.payment;if(!uuid(r.payment_id)||!record(p)||p.id!==r.payment_id||p.booking_id!==id||p.tenant_id!==tenant||!['requires_payment','processing','succeeded','failed','refunded','partially_refunded'].includes(String(p.state))||!bounded(p.provider,100))return invalid();const amount=money({amount:p.amount,currency:p.currency});if(total&&amount.currency!==total.currency)return invalid();payment={id:r.payment_id,state:String(p.state),amount,provider:p.provider};}
 else if(r.payment!==null)return invalid();
 if(!Array.isArray(r.history)||r.history.length>1000)return invalid();
 const history=r.history.map((h:unknown)=>{if(!record(h)||h.booking_id!==id||(h.from_state!==null&&!states.includes(String(h.from_state)))||!states.includes(String(h.to_state))||!instant(h.at)||(h.reason!==null&&!bounded(h.reason,2000)))return invalid();return{from:h.from_state as string|null,to:String(h.to_state),reason:h.reason as string|null,at:h.at};}).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 return{id,tenantId:tenant,reference:r.reference,state:String(r.state),slotStart:r.slot_start,slotEnd:r.slot_end,createdAt:r.created_at,serviceId:r.selection.serviceId,customer,selection:r.selection,address:r.address as Record<string,unknown>|null,notes:r.notes as string|null,total,deposit,payment,history};
}
