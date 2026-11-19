import {ConnectedOverview,BookingRecords} from './ConnectedOverview';
import {ConnectedPaymentAttention} from './ConnectedPaymentAttention';
import {ConnectedSettings} from './ConnectedSettings';
import {ConnectedDetailingCatalog} from './ConnectedDetailingCatalog';
import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {createRuntimeClient,type RuntimeConfig,type Membership,type BookingRow,type ServiceRow} from '@lumin/runtime-client';
import { PortalShell } from "../components/Layout";
import { PortalRoutes } from "../components/PortalRoutes";
import {Link,useLocation} from 'react-router-dom';
import {ConnectedBookingDetail} from './ConnectedBookingDetail';
import {ConnectedBookingFormLoader} from './ConnectedBookingFormLoader';
import {ConnectedBusinessOnboarding} from './ConnectedBusinessOnboarding';
import type {BusinessProfile} from '@lumin/contracts';
const googleOAuthStateKey='booking-lumin-google-oauth-state',googleOAuthVerifierKey='booking-lumin-google-oauth-verifier',googleOAuthRedirectStateParam='booking_lumin_google_oauth_state';
function readGoogleOAuthValue(key:string):string|null{
 try{return sessionStorage.getItem(key)??localStorage.getItem(key)}catch{
  try{return localStorage.getItem(key)}catch{return null}
 }
}
function writeGoogleOAuthValue(key:string,value:string):void{
 let wrote=false;
 try{sessionStorage.setItem(key,value);wrote=true}catch{}
 try{localStorage.setItem(key,value);wrote=true}catch{}
 if(!wrote)throw Error('OAuth storage unavailable.');
}
function removeGoogleOAuthValue(key:string):void{
 try{sessionStorage.removeItem(key)}catch{}
 try{localStorage.removeItem(key)}catch{}
}
export function ConnectedPortal({config,staging=false}:{config:RuntimeConfig;staging?:boolean}){
 const attentionAcknowledgmentEnabled=import.meta.env.VITE_PAYMENT_ATTENTION_ACKNOWLEDGMENT==='true';
 const setupRoute=useLocation().pathname.replace(/\/+$/,'')==='/settings/business-type';
 const client=useMemo(()=>{try{return createRuntimeClient({...config,allowMembershipDiscovery:true})}catch{return null}},[config.url,config.publishableKey,config.tenantId,config.bookingApiOrigin]);
 const [,setCreationRevision]=useState(0);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[members,setMembers]=useState<Membership[]>([]),[tenant,setTenant]=useState('');
 const [drafts,setDrafts]=useState<BookingRow[]>([]),[services,setServices]=useState<ServiceRow[]>([]),[signedIn,setSignedIn]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const generation=useRef(0),sessionGeneration=useRef(0);
 useEffect(()=>{generation.current++;sessionGeneration.current++;setSignedIn(false);setMembers([]);setTenant('');setDrafts([]);setServices([]);setEmail('');setPassword('');setError('');setBusy(false);return()=>{generation.current++;sessionGeneration.current++;client?.signOut();}},[client]);
 // Defer consuming the one-use callback until the effect survives StrictMode's setup/cleanup probe.
 useEffect(()=>{
  if(!client||signedIn)return;
  let active=true;
  queueMicrotask(()=>{
   if(!active)return;
   const query=new URLSearchParams(window.location.search),code=query.get('code'),providerState=query.get('state'),redirectState=query.get(googleOAuthRedirectStateParam),oauthError=query.get('error');
   if(!code&&!oauthError)return;
   window.history.replaceState(null,'',window.location.pathname);
   let expected:string|null=null,verifier:string|null=null;
   expected=readGoogleOAuthValue(googleOAuthStateKey);verifier=readGoogleOAuthValue(googleOAuthVerifierKey);
   // Supabase/Google may replace the provider state with its own UUID. The app-owned
   // binding travels inside the exact redirect URL so it remains verifiable without
   // trusting a provider-generated state value.
   const returnedState=redirectState??providerState;
   const bound=!!returnedState&&!!expected&&returnedState===expected;
   // An unbound error must not cancel another pending authorization.
   if(oauthError&&!bound){setError('Google sign-in could not be verified. Start again.');return;}
   removeGoogleOAuthValue(googleOAuthStateKey);removeGoogleOAuthValue(googleOAuthVerifierKey);
   if(oauthError){setError('Google sign-in was cancelled or rejected.');return;}
   if(!bound||!verifier){setError('Google sign-in could not be verified. Start again.');return;}
   const at=++sessionGeneration.current;setBusy(true);setError('');
   void client.finishOAuthCode(code!,verifier).then(async()=>{
    if(!active||at!==sessionGeneration.current)return;
    const own=await client.memberships();if(!active||at!==sessionGeneration.current)return;
    setMembers(own);setSignedIn(true);
    const recovery=staging&&config.bookingApiOrigin?client.simpleOfferRecoveryTenant():undefined;
    const first=(recovery&&own.some(member=>member.tenant_id===recovery&&member.role==='BUSINESS_OWNER')?recovery:own[0]?.tenant_id)??'';
    setTenant(first);if(first)await load(first);
   }).catch(()=>{if(active&&at===sessionGeneration.current){client.signOut();setError('Google sign-in was not completed. Start again.');}}).finally(()=>{if(at===sessionGeneration.current)setBusy(false);});
  });
  return()=>{active=false;};
 },[client,signedIn,staging,config.bookingApiOrigin]);
 async function load(id:string){if(!client)return;const current=++generation.current;setBusy(true);setError('');setDrafts([]);setServices([]);try{const [d,s]=await Promise.all([client.bookings(id),client.services(id,true)]);if(current===generation.current){setDrafts(d);setServices(s)}}catch(e){if(current===generation.current)setError(e instanceof Error?e.message:'Unable to refresh.')}finally{if(current===generation.current)setBusy(false)}}
 async function login(e:FormEvent){e.preventDefault();if(!client||busy)return;const at=++sessionGeneration.current;setBusy(true);setError('');try{await client.signIn(email,password);const own=await client.memberships();if(at!==sessionGeneration.current)return;setMembers(own);setSignedIn(true);const recovery=staging&&config.bookingApiOrigin?client.simpleOfferRecoveryTenant():undefined;const first=(recovery&&own.some(member=>member.tenant_id===recovery&&member.role==='BUSINESS_OWNER')?recovery:own[0]?.tenant_id)??'';setTenant(first);if(first)await load(first)}catch(e){if(at===sessionGeneration.current){client.signOut();setError(e instanceof Error?e.message:'Unable to sign in.')}}finally{if(at===sessionGeneration.current){setPassword('');setBusy(false)}}}
 async function googleLogin(){
  if(!client||busy)return;
  const at=++sessionGeneration.current;setBusy(true);setError('');
  try{
   const state=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
   const verifier=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
   if(at!==sessionGeneration.current)return;
   const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
   const redirect=new URL(window.location.href);redirect.search='';redirect.hash='';redirect.searchParams.set(googleOAuthRedirectStateParam,state);
   const authorize=client.googleAuthorizeUrl(redirect.href,{state,codeChallenge:challenge,allowedOrigins:[window.location.origin]});
   writeGoogleOAuthValue(googleOAuthStateKey,state);writeGoogleOAuthValue(googleOAuthVerifierKey,verifier);
   window.location.assign(authorize);
  }catch{if(at===sessionGeneration.current){removeGoogleOAuthValue(googleOAuthStateKey);removeGoogleOAuthValue(googleOAuthVerifierKey);setError('Google sign-in is unavailable.');setBusy(false);}}
 }
 function logout(){generation.current++;sessionGeneration.current++;client?.signOut();setSignedIn(false);setMembers([]);setTenant('');setDrafts([]);setServices([]);setEmail('');setPassword('');setError('');setBusy(false)}
 async function toggle(s:ServiceRow){if(!client||busy||creationLocked)return;const current=generation.current;setBusy(true);setError('');try{await client.setServiceActive(tenant,s.id,!s.active);if(current===generation.current)await load(tenant)}catch(e){if(current===generation.current)setError(e instanceof Error?e.message:'Unable to update service.')}finally{if(current===generation.current)setBusy(false)}}
 const creation=signedIn&&staging&&config.bookingApiOrigin?client?.businessCreationState():undefined,creationLocked=creation?.phase==='checking'||creation?.phase==='creating'||creation?.phase==='unknown'||(creation&&client?.simpleOfferLocked());
 async function openCreatedBusiness(profile:BusinessProfile){if(!client)return;const at=sessionGeneration.current,context=generation.current;const own=await client.memberships();if(context!==generation.current)throw Error('The selected business changed. Open the created business again after reviewing its receipt.');if(at!==sessionGeneration.current)throw Error('The signed-in account changed. Sign in again before opening the created business.');if(!own.some(member=>member.tenant_id===profile.tenantId&&member.role==='BUSINESS_OWNER'))throw Error('The created business owner membership could not be verified. The creation receipt is retained. Refresh it before opening.');setMembers(own);setTenant(profile.tenantId);await load(profile.tenantId);}
 const role = members.find(member => member.tenant_id === tenant)?.role;
 const firstBusinessEligible=members.length===0&&tenant==='';
 const setupState=signedIn&&staging&&config.bookingApiOrigin&&client&&tenant?{profile:client.businessProfileInitializationState(tenant),offer:client.simpleOfferState(tenant)}:undefined;
 const setupSchedule=setupState?.offer.phase==='created'?client?.offerSchedulingState(tenant,setupState.offer.receipt.service.id):undefined;
 const retainedSetup=!!creation&&['checking','creating','unknown','created'].includes(creation.phase)||!!setupState&&(['checking','initializing','unknown'].includes(setupState.profile.phase)||['checking','creating','unknown'].includes(setupState.offer.phase))||!!setupSchedule&&['checking','creating','unknown'].includes(setupSchedule.phase);
 const setupPanel=client?<><span id="connected-business-setup" tabIndex={-1}/><ConnectedBusinessOnboarding key={client.authContextRevision()} client={client} tenantId={tenant} role={role} firstBusinessEligible={firstBusinessEligible} staging={staging} apiConfigured={!!config.bookingApiOrigin} contextBusy={busy} onStateChange={()=>setCreationRevision(value=>value+1)} onOpen={openCreatedBusiness}/></>:undefined;
 const bookingList=<section className="connected-bookings"><div className="page-header"><div><h1>Bookings</h1><p className="page-subtitle">Review recent bookings and requests from your business.</p></div><span className="workspace-chip">Connected records</span></div><div className="panel"><div className="panel-header"><h2>Recent bookings and requests</h2><span className="muted">Up to 100 records</span></div>{busy?<p role="status" className="workspace-empty">Loading.</p>:error?<p role="status" className="workspace-empty">Booking records could not be verified.</p>:drafts.length===0?<p className="workspace-empty">No bookings found.</p>:<BookingRecords bookings={drafts}/>}<p className="panel-footnote">Status comes from the business database. Unconfirmed requests do not guarantee an appointment.</p></div></section>;
 const serviceList = <section><h1>Services</h1><h2>Service catalog</h2>
  {busy ? <p role="status">Loading…</p> : services.length === 0 ? <p>No simple services found.</p> :
   <ul>{services.map(s => <li key={s.id}>{s.name}  -  {s.active ? "Active" : "Inactive"} <button disabled={busy||creationLocked} onClick={() => void toggle(s)}>{s.active ? "Deactivate" : "Activate"}</button></li>)}</ul>}
  <p>Only the connected simple-service catalog is available here. Editing and resource inventory are not available yet.</p>
 </section>;
 return <PortalShell mode="connected" tenantName={tenant ? `Business ${tenant}` : "Business Portal"} roleLabel={signedIn ? (role === "BUSINESS_OWNER" ? "Owner" : role === "BUSINESS_STAFF" ? "Staff" : "Member") : "Signed out"}>
  {import.meta.env.VITE_RUNTIME_ENV === "staging" && <p className="note-banner" role="note">STAGING / TEST — connected workspace. Use test data only.</p>}
  {!client ? <section><h1>Business Portal</h1><p role="alert">Connected mode configuration is missing or invalid.</p></section> : !signedIn ?
   <section className="workspace-signin panel"><span className="workspace-eyebrow">YOUR BUSINESS WORKSPACE</span><h1>Sign in to your business</h1><p className="page-subtitle">Bookings, services and business settings. One connected workspace.</p><form onSubmit={login}>
    <fieldset disabled={busy} className="form-stack"><label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
     <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
     <button>{busy ? "Signing in…" : "Sign in"}</button>
    </fieldset>
   </form><button type="button" className="google-signin" onClick={()=>void googleLogin()} disabled={busy}>Continue with Google</button><p>Use an existing authorized account. A verified staging account with no memberships can create its first business. Sessions stay in memory and end when this page reloads.</p></section> :
   <><div className="workspace-session"><span className="workspace-session-label">Business workspace</span><button className="btn btn-secondary" onClick={logout}>Sign out</button>
    {members.length > 0 && <><label>Business<select disabled={busy||creationLocked} value={tenant} onChange={e => {setTenant(e.target.value); void load(e.target.value)}}>
     {members.map(m => <option key={m.tenant_id} value={m.tenant_id}>{m.tenant_id}  -  {m.role}</option>)}
    </select></label><button disabled={busy} onClick={() => void load(tenant)}>Refresh</button></>}
   </div>{firstBusinessEligible?<>{setupPanel}</>:retainedSetup&&!setupRoute?<p role="status">A business setup action is pending or retained in this session. Keep its original reviewed details; do not create a replacement. <Link to="/settings/business-type#connected-business-setup">Review retained business setup</Link></p>:null} <ConnectedDetailingCatalog client={client} tenantId={tenant} role={role} staging={staging} apiConfigured={!!config.bookingApiOrigin} contextBusy={busy} onStateChange={()=>setCreationRevision(value=>value+1)}/> {members.length === 0 ? <p>No business membership is assigned to this account.</p> : <PortalRoutes mode="connected" dashboard={<><ConnectedOverview bookings={drafts} services={services} loading={busy} error={!!error}/>{import.meta.env.VITE_PAYMENT_ATTENTION_VISIBILITY==='true'&&<ConnectedPaymentAttention client={client} tenantId={tenant} role={role} acknowledgmentEnabled={attentionAcknowledgmentEnabled}/>}</>} settings={<ConnectedSettings client={client} tenantId={tenant} role={role} setupAvailable={staging&&!!config.bookingApiOrigin} setupControls={setupRoute&&role==='BUSINESS_OWNER'?setupPanel:undefined}/>} bookings={bookingList} bookingDetail={<ConnectedBookingDetail client={client} tenantId={tenant} services={services}/>} services={serviceList} embed={staging&&config.bookingApiOrigin?(role!=='BUSINESS_OWNER'?<section><p role="alert">Only a business owner can publish a staging paid form.</p></section>:<ConnectedBookingFormLoader key={tenant} client={client} tenantId={tenant} role={role} services={services} staging={staging} customerFieldPublicationAvailable={staging&&import.meta.env.VITE_CUSTOMER_FIELD_PUBLICATION_STAGING==='true'} conditionalPublicationAvailable={staging&&import.meta.env.VITE_CONDITIONAL_CUSTOMER_FIELD_PUBLICATION_STAGING==='true'} catalogLoading={busy}/>):undefined} />}</>}
  {error && <p role="alert">{error}</p>}
 </PortalShell>;
}
