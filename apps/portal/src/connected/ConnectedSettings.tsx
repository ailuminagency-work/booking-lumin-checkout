import {useEffect,useRef,useState} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {BusinessProfile,BusinessTimezone,CurrencyCode} from '@lumin/contracts';
import {getBusinessTemplateDefaults} from '@lumin/templates';
import type {RuntimeClient,BusinessProfileRead,OwnerBusinessContext} from '@lumin/runtime-client';
export const CONNECTED_SETTINGS_SECTIONS=[['business','BUSINESS'],['business-type','BUSINESS TYPE & TEMPLATE'],['availability','AVAILABILITY'],['payments','PAYMENTS'],['documents','DOCUMENTS & INVOICES'],['domains','DOMAINS & WEBSITE'],['integrations','INTEGRATIONS'],['notifications','NOTIFICATIONS'],['team','TEAM & PERMISSIONS'],['subscription','SUBSCRIPTION & USAGE'],['developer','DEVELOPER'],['security','SECURITY'],['support','SUPPORT']] as const;
type Context=OwnerBusinessContext;
type Client=Pick<RuntimeClient,'memberships'|'businessProfile'|'ownerBusinessContext'>;
type Props={client:Client;tenantId:string;role?:string;setupAvailable?:boolean};
type Snapshot={client:Client;tenantId:string;loading:boolean;ownerVerified:boolean;context?:Context;profile?:BusinessProfileRead;contextError?:string;typeError?:string;error?:string};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const businessNames={HOUSEKEEPING:'Housekeeping',AUTO_DETAILING:'Auto detailing',VEHICLE_RENTAL:'Vehicle rental',EQUIPMENT_RENTAL:'Equipment rental',EVENT_RENTAL:'Event rental',JUNK_REMOVAL:'Junk removal'};
export function ConnectedSettings({client,tenantId,role,setupAvailable=false}:Props){
 const location=useLocation(),sectionId=location.pathname.replace(/\/$/,'').split('/').slice(2).join('/')||'business',section=CONNECTED_SETTINGS_SECTIONS.find(([id])=>id===sectionId);
 const [snapshot,setSnapshot]=useState<Snapshot>({client,tenantId,loading:false,ownerVerified:false}),generation=useRef(0),inFlight=useRef(false);
 useEffect(()=>{generation.current++;inFlight.current=false;setSnapshot({client,tenantId,loading:false,ownerVerified:false});return()=>{generation.current++;};},[client,tenantId,role]);
 const current=snapshot.client===client&&snapshot.tenantId===tenantId&&role==='BUSINESS_OWNER'?snapshot:undefined;
 async function refresh(){if(inFlight.current||role!=='BUSINESS_OWNER'||!uuid(tenantId))return;const at=generation.current;inFlight.current=true;setSnapshot({client,tenantId,loading:true,ownerVerified:false});
  try{
   const memberships=await client.memberships();if(at!==generation.current)return;
   if(!Array.isArray(memberships)||!memberships.every(member=>exact(member,['tenant_id','role'])&&uuid(member.tenant_id)&&typeof member.role==='string')||!memberships.some(member=>member.tenant_id.toLowerCase()===tenantId.toLowerCase()&&member.role==='BUSINESS_OWNER'))throw Error('owner unverified');
   const [business,type]=await Promise.allSettled([client.ownerBusinessContext(tenantId),client.businessProfile(tenantId)]);if(at!==generation.current)return;
   const next:Snapshot={client,tenantId,loading:false,ownerVerified:true};
   if(business.status==='fulfilled'&&exact(business.value,['tenantId','name','slug','timezone','currency','status'])&&business.value.tenantId===tenantId.toLowerCase()&&typeof business.value.name==='string'&&business.value.name.trim()&&typeof business.value.slug==='string'&&business.value.slug&&business.value.status==='active'&&BusinessTimezone.safeParse(business.value.timezone).success&&CurrencyCode.safeParse(business.value.currency).success)next.context=business.value;else next.contextError='Current business identity, currency and timezone are unverified. Refresh the authenticated server read; no local defaults are used.';
   if(type.status==='fulfilled'&&exact(type.value,['status','profile'])&&type.value.status==='initialized'){const parsed=BusinessProfile.safeParse(type.value.profile);if(parsed.success&&parsed.data.tenantId===tenantId.toLowerCase())next.profile={status:'initialized',profile:parsed.data};}
   else if(type.status==='fulfilled'&&exact(type.value,['status','tenantId'])&&type.value.status==='uninitialized'&&type.value.tenantId===tenantId.toLowerCase())next.profile=type.value;
   if(!next.profile)next.typeError='Business type and template remain unverified or unavailable. The profile capability may be disabled; no type is inferred from services or selected form values.';
   setSnapshot(next);
  }catch{if(at===generation.current)setSnapshot({client,tenantId,loading:false,ownerVerified:false,error:'Fresh owner membership for this exact business could not be verified. Settings data is not displayed.'});}
  finally{if(at===generation.current)inFlight.current=false;}
 }
 const profile=current?.profile,defaults=profile?.status==='initialized'?getBusinessTemplateDefaults(profile.profile):undefined;
 const supported=sectionId==='business'||sectionId==='business-type';
 return <section aria-label="Connected settings" style={{minWidth:0,maxWidth:'100%',overflowWrap:'anywhere'}}><h1>Settings</h1><nav aria-label="Settings sections"><ul style={{display:'flex',flexWrap:'wrap',gap:'0.75rem',padding:0,listStyle:'none',maxWidth:'100%'}}>{CONNECTED_SETTINGS_SECTIONS.map(([id,label])=><li key={id} style={{minWidth:0,maxWidth:'100%'}}><Link to={'/settings/'+id} aria-current={sectionId===id?'page':undefined} style={{fontWeight:sectionId===id?700:undefined}}>{label}</Link></li>)}</ul></nav>
 {!section?<><h2>Settings section not found</h2><p>No connected settings capability is available at this address.</p></>:<><h2>{section[1]}</h2>{!supported?<><p role="status">This connected section is not available yet.</p><p>No mock integrations, provider status, financial totals or saved settings are shown here. No changes can be made in this section.</p></>:role!=='BUSINESS_OWNER'||!uuid(tenantId)?<p role="alert">An authenticated business owner and a valid selected business are required to read these settings.</p>:<>
 <p>Read current server information for this selected business. This view does not change identity, currency, timezone, business type or templates.</p><button type="button" disabled={current?.loading} onClick={()=>void refresh()}>Refresh verified business settings</button>{current?.loading&&<p role="status">Checking fresh owner membership and current business settings...</p>}{current?.error&&<p role="alert">{current.error}</p>}
 {current?.contextError&&<p role="alert">{current.contextError}</p>}{current?.typeError&&<p role="alert">{current.typeError}</p>}
 {sectionId==='business'&&current?.context&&<dl aria-label="Verified current business"><dt>Business ID</dt><dd>{current.context.tenantId}</dd><dt>Business name</dt><dd>{current.context.name}</dd><dt>Business slug</dt><dd>{current.context.slug}</dd><dt>Timezone</dt><dd>{current.context.timezone}</dd><dt>Currency</dt><dd>{current.context.currency}</dd><dt>Business status</dt><dd>{current.context.status}</dd></dl>}
 {profile?.status==='initialized'&&<><p>Verified permanent business type: {businessNames[profile.profile.businessType]}. Template contract version: {profile.profile.templateVersion}.</p><p>This type is immutable. There is no casual type toggle or template application action here.</p>{sectionId==='business-type'&&defaults&&<><h3>Unapplied template description</h3><p>Catalog: {defaults.catalog.plural}; option group: {defaults.catalog.optionsLabel}; resource context: {defaults.context.resourceLabel}.</p><p>These structural defaults are descriptive only. They are not applied or persisted here and do not configure prices, resources, capacities, booking eligibility or payment integrations.</p></>}</>}
 {profile?.status==='uninitialized'&&<p role="status">This existing business is uninitialized. No authoritative business type or template contract is recorded. Nothing has been assigned by this read.</p>}
 {sectionId==='business-type'&&setupAvailable&&<><p>Existing staging business setup controls remain in their original workspace panel. Use their separate checks and permanent-type review for eligible setup; reading Settings does not grant writer authority or release pending attempts.</p><a href="#connected-business-setup">Go to existing business setup controls</a></>}
 </>}</>}
 </section>;
}
