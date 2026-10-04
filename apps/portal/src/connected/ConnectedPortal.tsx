import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {createRuntimeClient,type RuntimeConfig,type Membership,type BookingRow,type ServiceRow} from '@lumin/runtime-client';
import { PortalShell } from "../components/Layout";
import { PortalRoutes } from "../components/PortalRoutes";
import {Link} from 'react-router-dom';
import {ConnectedBookingDetail} from './ConnectedBookingDetail';
import {PaidSimplePublisher} from './PaidSimplePublisher';
import {ConnectedBusinessOnboarding} from './ConnectedBusinessOnboarding';
import type {BusinessProfile} from '@lumin/contracts';
export function ConnectedPortal({config,staging=false}:{config:RuntimeConfig;staging?:boolean}){
 const client=useMemo(()=>{try{return createRuntimeClient({...config,allowMembershipDiscovery:true})}catch{return null}},[config.url,config.publishableKey,config.tenantId,config.bookingApiOrigin]);
 const [,setCreationRevision]=useState(0);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[members,setMembers]=useState<Membership[]>([]),[tenant,setTenant]=useState('');
 const [drafts,setDrafts]=useState<BookingRow[]>([]),[services,setServices]=useState<ServiceRow[]>([]),[signedIn,setSignedIn]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const generation=useRef(0),sessionGeneration=useRef(0);
 useEffect(()=>{generation.current++;sessionGeneration.current++;setSignedIn(false);setMembers([]);setTenant('');setDrafts([]);setServices([]);setEmail('');setPassword('');setError('');setBusy(false);return()=>{generation.current++;sessionGeneration.current++;client?.signOut();}},[client]);
 async function load(id:string){if(!client)return;const current=++generation.current;setBusy(true);setError('');setDrafts([]);setServices([]);try{const [d,s]=await Promise.all([client.bookings(id),client.services(id,true)]);if(current===generation.current){setDrafts(d);setServices(s)}}catch(e){if(current===generation.current)setError(e instanceof Error?e.message:'Unable to refresh.')}finally{if(current===generation.current)setBusy(false)}}
 async function login(e:FormEvent){e.preventDefault();if(!client||busy)return;const at=++sessionGeneration.current;setBusy(true);setError('');try{await client.signIn(email,password);const own=await client.memberships();if(at!==sessionGeneration.current)return;setMembers(own);setSignedIn(true);const recovery=staging&&config.bookingApiOrigin?client.simpleOfferRecoveryTenant():undefined;const first=(recovery&&own.some(member=>member.tenant_id===recovery&&member.role==='BUSINESS_OWNER')?recovery:own[0]?.tenant_id)??'';setTenant(first);if(first)await load(first)}catch(e){if(at===sessionGeneration.current){client.signOut();setError(e instanceof Error?e.message:'Unable to sign in.')}}finally{if(at===sessionGeneration.current){setPassword('');setBusy(false)}}}
 function logout(){generation.current++;sessionGeneration.current++;client?.signOut();setSignedIn(false);setMembers([]);setTenant('');setDrafts([]);setServices([]);setEmail('');setPassword('');setError('');setBusy(false)}
 async function toggle(s:ServiceRow){if(!client||busy||creationLocked)return;const current=generation.current;setBusy(true);setError('');try{await client.setServiceActive(tenant,s.id,!s.active);if(current===generation.current)await load(tenant)}catch(e){if(current===generation.current)setError(e instanceof Error?e.message:'Unable to update service.')}finally{if(current===generation.current)setBusy(false)}}
 const creation=signedIn&&staging&&config.bookingApiOrigin?client?.businessCreationState():undefined,creationLocked=creation?.phase==='checking'||creation?.phase==='creating'||creation?.phase==='unknown'||(creation&&client?.simpleOfferLocked());
 async function openCreatedBusiness(profile:BusinessProfile){if(!client)return;const at=sessionGeneration.current,context=generation.current;const own=await client.memberships();if(context!==generation.current)throw Error('The selected business changed. Open the created business again after reviewing its receipt.');if(at!==sessionGeneration.current)throw Error('The signed-in account changed. Sign in again before opening the created business.');if(!own.some(member=>member.tenant_id===profile.tenantId&&member.role==='BUSINESS_OWNER'))throw Error('The created business owner membership could not be verified. The creation receipt is retained. Refresh it before opening.');setMembers(own);setTenant(profile.tenantId);await load(profile.tenantId);}
 const role = members.find(member => member.tenant_id === tenant)?.role;
 const bookingLabels:Record<string,string>={draft:'Unconfirmed request',pending_payment:'Awaiting payment',confirmed:'Confirmed',completed:'Completed',cancelled:'Cancelled',refunded:'Refunded',failed:'Failed'};
 const bookingList = <section><h1>Bookings</h1><h2>Recent bookings and requests</h2>
  {busy ? <p role="status">Loading…</p> : drafts.length === 0 ? <p>No bookings found.</p> :
   <div className="table-wrap"><table><thead><tr><th>Reference</th><th>Scheduled time</th><th>Status</th></tr></thead><tbody>
    {drafts.map(d => <tr key={d.id}><td><Link to={`/bookings/${d.id}`}>{d.reference}</Link></td><td>{new Date(d.slot_start).toLocaleString()}</td><td>{bookingLabels[d.state]}</td></tr>)}
   </tbody></table></div>}
  <p>Up to 100 latest records. Status comes from the business database. Unconfirmed requests do not guarantee an appointment.</p>
 </section>;
 const serviceList = <section><h1>Services</h1><h2>Service catalog</h2>
  {busy ? <p role="status">Loading…</p> : services.length === 0 ? <p>No simple services found.</p> :
   <ul>{services.map(s => <li key={s.id}>{s.name} · {s.active ? "Active" : "Inactive"} <button disabled={busy||creationLocked} onClick={() => void toggle(s)}>{s.active ? "Deactivate" : "Activate"}</button></li>)}</ul>}
  <p>Only the connected simple-service catalog is available here. Editing and resource inventory are not available yet.</p>
 </section>;
 return <PortalShell mode="connected" tenantName={tenant ? `Business ${tenant}` : "Business Portal"} roleLabel={signedIn ? (role === "BUSINESS_OWNER" ? "Owner" : role === "BUSINESS_STAFF" ? "Staff" : "Member") : "Signed out"}>
  {import.meta.env.VITE_RUNTIME_ENV === "staging" && <p className="note-banner" role="note">STAGING / TEST — connected workspace. Use test data only.</p>}
  {!client ? <section><h1>Business Portal</h1><p role="alert">Connected mode configuration is missing or invalid.</p></section> : !signedIn ?
   <section><h1>Sign in to your business</h1><form onSubmit={login}>
    <fieldset disabled={busy} className="form-stack"><label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
     <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
     <button>{busy ? "Signing in…" : "Sign in"}</button>
    </fieldset>
   </form><p>Use an existing authorized account. A verified staging account with no memberships can create its first business. Sessions stay in memory and end when this page reloads.</p></section> :
   <><div className="panel"><button onClick={logout}>Sign out</button>
    {members.length > 0 && <><label>Business<select disabled={busy||creationLocked} value={tenant} onChange={e => {setTenant(e.target.value); void load(e.target.value)}}>
     {members.map(m => <option key={m.tenant_id} value={m.tenant_id}>{m.tenant_id} · {m.role}</option>)}
    </select></label><button disabled={busy} onClick={() => void load(tenant)}>Refresh</button></>}
   </div><ConnectedBusinessOnboarding client={client} tenantId={tenant} role={role} firstBusinessEligible={members.length===0&&tenant===''} staging={staging} apiConfigured={!!config.bookingApiOrigin} contextBusy={busy} onStateChange={()=>setCreationRevision(value=>value+1)} onOpen={openCreatedBusiness}/> {members.length === 0 ? <p>No business membership is assigned to this account.</p> : <PortalRoutes mode="connected" bookings={bookingList} bookingDetail={<ConnectedBookingDetail client={client} tenantId={tenant} services={services}/>} services={serviceList} embed={staging&&config.bookingApiOrigin?<PaidSimplePublisher client={client} tenantId={tenant} role={role} services={services} staging={staging} catalogLoading={busy}/>:undefined} />}</>}
  {error && <p role="alert">{error}</p>}
 </PortalShell>;
}
