import {useEffect,useRef,useState} from 'react';
import {BusinessTimezone,CurrencyCode,NotificationPlannerReceipt,SaveNotificationPlannerConfig,type StrictNotificationPlannerConfig,type NotificationChannel} from '@lumin/contracts';
import {NotificationPlannerError,type RuntimeClient,type OwnerBusinessContext} from '@lumin/runtime-client';
export type NotificationSettingsClient=Pick<RuntimeClient,'memberships'|'ownerBusinessContext'|'authContextRevision'|'readNotificationPlannerConfig'|'saveNotificationPlannerConfig'>;
type Props={client:NotificationSettingsClient;tenantId:string;role?:string};
type Scope={client:NotificationSettingsClient;tenantId:string;role?:string;auth:number};
type State=Scope&{busy?:boolean;loaded?:boolean;context?:OwnerBusinessContext;receipt?:NotificationPlannerReceipt|null;draft?:StrictNotificationPlannerConfig;blocked?:boolean;review?:boolean;error?:string;message?:string};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const owner=(value:unknown,tenant:string)=>Array.isArray(value)&&value.every(row=>exact(row,['tenant_id','role'])&&uuid(row.tenant_id)&&typeof row.role==='string')&&value.some(row=>row.tenant_id.toLowerCase()===tenant.toLowerCase()&&row.role==='BUSINESS_OWNER');
const copy=<T,>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
export function ConnectedNotificationSettings({client,tenantId,role}:Props){
 const auth=client.authContextRevision(),scope={client,tenantId,role,auth};
 const [state,setState]=useState<State>(scope),generation=useRef(0),flight=useRef(false);
 useEffect(()=>{generation.current++;flight.current=false;setState(scope);return()=>{generation.current++;};},[client,tenantId,role,auth]);
 const current=state.client===client&&state.tenantId===tenantId&&state.role===role&&state.auth===auth?state:undefined;
 const allowed=role==='BUSINESS_OWNER'&&uuid(tenantId)&&typeof client.readNotificationPlannerConfig==='function'&&typeof client.saveNotificationPlannerConfig==='function';
 const live=(at:number,revision:number)=>at===generation.current&&revision===client.authContextRevision();
 function mutate(change:(draft:StrictNotificationPlannerConfig)=>void){if(!current?.draft||current.busy||current.blocked||current.auth!==client.authContextRevision())return;const draft=copy(current.draft);change(draft);setState({...current,draft,message:undefined,error:undefined});}
 async function refresh(){
  if(!allowed||flight.current)return;const at=generation.current,revision=client.authContextRevision(),review=!!current?.blocked||!!current?.review;flight.current=true;setState({...scope,busy:true,review});
  try{
   if(!owner(await client.memberships(),tenantId))throw Error('unverified');if(!live(at,revision))throw Error('changed');
   const context=await client.ownerBusinessContext(tenantId);if(!live(at,revision))throw Error('changed');
   if(!exact(context,['tenantId','name','slug','timezone','currency','status'])||context.tenantId!==tenantId.toLowerCase()||typeof context.name!=='string'||!context.name.trim()||typeof context.slug!=='string'||!context.slug||context.status!=='active'||!BusinessTimezone.safeParse(context.timezone).success||!CurrencyCode.safeParse(context.currency).success)throw Error('unverified');
   const value=await client.readNotificationPlannerConfig(tenantId);if(!live(at,revision))throw Error('changed');
   const parsed=value===null?null:NotificationPlannerReceipt.safeParse(value);
   if(parsed!==null&&(!parsed.success||parsed.data.tenantId!==tenantId.toLowerCase()||parsed.data.config.timezone!==context.timezone))throw Error('unverified');
   if(!owner(await client.memberships(),tenantId)||!live(at,revision))throw Error('changed');
   setState({...scope,loaded:true,context,receipt:parsed===null?null:parsed.data,review,message:review?'Current settings loaded. This read does not identify which save attempt committed. Review this current state before editing again.':undefined});
  }catch(error){if(at===generation.current)setState({...scope,error:error instanceof NotificationPlannerError&&error.delivery==='unavailable'?'Notification settings are unavailable in this workspace.':'Fresh owner, business timezone and notification settings could not be verified. Refresh after checking your signed-in business.',blocked:review,review});}
  finally{if(at===generation.current)flight.current=false;}
 }
 function edit(){if(!current?.loaded||!current.context||current.busy||current.blocked||current.review||current.auth!==client.authContextRevision())return;
  const draft=current.receipt?copy(current.receipt.config):{tenantId:tenantId.toLowerCase(),locale:'',timezone:current.context.timezone,sender:{},events:[],reminders:[],templates:[]};
  if(!draft.events.some(row=>row.event==='booking.confirmed'))draft.events.push({event:'booking.confirmed',channels:[]});
  setState({...current,draft,error:undefined,message:'Unsaved draft. Saving stores planner settings only; it does not send a notification.'});
 }
 async function save(){
  if(!allowed||!current?.draft||flight.current||current.blocked||current.review||current.auth!==client.authContextRevision())return;
  const input=SaveNotificationPlannerConfig.safeParse({expectedRevision:current.receipt?.revision??0,config:current.draft});
  if(!input.success){setState({...current,error:'Complete valid locale, sender and template fields before saving. Use only the listed template variables.'});return;}
  const at=generation.current,revision=client.authContextRevision(),frozen=copy(input.data);flight.current=true;setState({...current,busy:true,error:undefined,message:undefined});
  try{
   const value=await client.saveNotificationPlannerConfig(tenantId,frozen);if(!live(at,revision))throw new NotificationPlannerError('unknown','changed');
   const parsed=NotificationPlannerReceipt.safeParse(value);
   if(!parsed.success||parsed.data.tenantId!==tenantId.toLowerCase()||parsed.data.revision!==frozen.expectedRevision+1||JSON.stringify(parsed.data.config)!==JSON.stringify(frozen.config))throw new NotificationPlannerError('unknown','unverified');
   setState({...current,busy:false,receipt:parsed.data,draft:undefined,message:'Planner settings saved. No notification was sent, and provider readiness has not been verified.'});
  }catch(error){if(at===generation.current){const uncertain=!(error instanceof NotificationPlannerError)||error.delivery==='unknown'||error.delivery==='conflict';setState({...current,busy:false,loaded:uncertain||error instanceof NotificationPlannerError&&error.delivery==='unavailable'?false:current.loaded,blocked:uncertain||error instanceof NotificationPlannerError&&error.delivery==='unavailable',review:uncertain,error:uncertain?'Save outcome or revision is unverified. Do not repeat this save. Refresh current settings, then explicitly review them before editing.':error.delivery==='unavailable'?'Notification settings are unavailable in this workspace.':'The save was not accepted. Check the draft and refresh current settings before trying again.'});}}
  finally{if(at===generation.current)flight.current=false;}
 }
 const draft=current?.draft,channels=draft?.events.find(row=>row.event==='booking.confirmed')?.channels??[];
 function channelChange(channel:NotificationChannel,enabled:boolean){mutate(value=>{const policy=value.events.find(row=>row.event==='booking.confirmed')!;policy.channels=enabled?[...policy.channels.filter(item=>item!==channel),channel]:policy.channels.filter(item=>item!==channel);const matches=(template:StrictNotificationPlannerConfig['templates'][number])=>template.trigger==='booking.confirmed'&&template.channel===channel&&template.locale===value.locale;if(enabled&&!value.templates.some(matches))value.templates.push({trigger:'booking.confirmed',channel,locale:value.locale,body:''});if(!enabled)value.templates=value.templates.filter(template=>!matches(template));});}
 function templateChange(channel:NotificationChannel,field:'subject'|'body',text:string){mutate(value=>{const template=value.templates.find(row=>row.trigger==='booking.confirmed'&&row.channel===channel&&row.locale===value.locale);if(template){if(field==='subject'&&!text)delete template.subject;else template[field]=text;}});}
 const locked=!!current?.busy||!!current?.blocked||!!current?.review;
 return <section aria-label="Booking confirmation notification settings" style={{minWidth:0,maxWidth:'100%',overflowWrap:'anywhere'}}>
 <p>Configure saved booking-confirmation rules for this business. Saving does not send email or SMS or connect a provider.</p>
 {!allowed?<p role="alert">An authenticated business owner and the notification settings capability are required.</p>:<>
 <button type="button" disabled={current?.busy} onClick={()=>void refresh()}>Refresh notification settings</button>
 {current?.busy&&<p role="status">Checking or saving current business settings…</p>}{current?.error&&<p role="alert">{current.error}</p>}{current?.message&&<p role="status">{current.message}</p>}
 {current?.loaded&&current.context&&<><p>Verified business: {current.context.name}. Timezone: {current.context.timezone}.</p>
 {current.receipt?<p>Saved planner revision {current.receipt.revision}. Locale: {current.receipt.config.locale}. Confirmation channels: {current.receipt.config.events.find(row=>row.event==='booking.confirmed')?.channels.join(', ')||'none'}.</p>:<p role="status">Notification planner settings are not configured. No default rules have been saved.</p>}
 {current.review&&<button type="button" disabled={current.busy} onClick={()=>{if(current.auth===client.authContextRevision())setState({...current,review:false,blocked:false,message:'Current settings reviewed. Create or edit a new draft explicitly.'});}}>Review current settings</button>}
 {!draft&&<button type="button" disabled={locked} onClick={edit}>{current.receipt?'Edit confirmation settings':'Create notification draft'}</button>}
 {draft&&<form onSubmit={event=>{event.preventDefault();void save();}} aria-label="Confirmation settings draft">
 <fieldset disabled={locked} style={{minWidth:0,maxWidth:'100%'}}><legend>Unsaved booking-confirmation draft</legend>
 <label>Planner locale <input style={{boxSizing:'border-box',maxWidth:'100%'}} aria-label="Planner locale" maxLength={35} value={draft.locale} readOnly={!!current.receipt} onChange={event=>mutate(value=>{value.locale=event.target.value;for(const template of value.templates)if(template.trigger==='booking.confirmed')template.locale=value.locale;})}/></label>
 <p>Timezone: {draft.timezone} (verified business timezone). Existing saved locale and timezone are preserved.</p>
 <p>Sender changes apply to other saved notification rules too. Other events, reminders and templates are preserved.</p>
 <label>Email sender <input style={{boxSizing:'border-box',maxWidth:'100%'}} aria-label="Email sender" type="email" maxLength={254} value={draft.sender.emailFrom??''} onChange={event=>mutate(value=>{if(event.target.value)value.sender.emailFrom=event.target.value;else delete value.sender.emailFrom;})}/></label>
 <label>Email sender name <input style={{boxSizing:'border-box',maxWidth:'100%'}} aria-label="Email sender name" maxLength={100} value={draft.sender.emailFromName??''} onChange={event=>mutate(value=>{if(event.target.value)value.sender.emailFromName=event.target.value;else delete value.sender.emailFromName;})}/></label>
 <label>SMS sender <input style={{boxSizing:'border-box',maxWidth:'100%'}} aria-label="SMS sender" type="tel" maxLength={16} value={draft.sender.smsFrom??''} onChange={event=>mutate(value=>{if(event.target.value)value.sender.smsFrom=event.target.value;else delete value.sender.smsFrom;})}/></label>
 {(['email','sms'] as const).map(channel=><div key={channel}><label><input type="checkbox" checked={channels.includes(channel)} onChange={event=>channelChange(channel,event.target.checked)}/>Enable confirmation {channel==='email'?'email':'SMS'}</label>{channels.includes(channel)&&<>
 {channel==='email'&&<label>Email confirmation subject <input style={{boxSizing:'border-box',maxWidth:'100%'}} aria-label="Email confirmation subject" maxLength={200} value={draft.templates.find(row=>row.trigger==='booking.confirmed'&&row.channel===channel)?.subject??''} onChange={event=>templateChange(channel,'subject',event.target.value)}/></label>}
 <label>{channel==='email'?'Email':'SMS'} confirmation body <textarea aria-label={`${channel==='email'?'Email':'SMS'} confirmation body`} maxLength={4000} value={draft.templates.find(row=>row.trigger==='booking.confirmed'&&row.channel===channel)?.body??''} onChange={event=>templateChange(channel,'body',event.target.value)} style={{boxSizing:'border-box',maxWidth:'100%',width:'100%'}}/></label></>}</div>)}
 <p id="notification-variables">Allowed variables: tenantName, customerName, customerEmail, bookingReference, bookingState, slotStart, slotEnd, slotDate, slotTime, customerPhone, total. Write variables inside double braces.</p>
 <button type="submit" aria-describedby="notification-variables">Save notification settings</button><button type="button" onClick={()=>setState({...current,draft:undefined,error:undefined,message:'Draft discarded. Saved settings are unchanged.'})}>Discard draft</button>
 </fieldset></form>}
 </>}
 </>}
 </section>;
}
