import {useMemo,useRef,useState,type FormEvent} from 'react';
import {createRuntimeClient,type RuntimeConfig,type Membership,type DraftRow,type ServiceRow} from '@lumin/runtime-client';
import { PortalShell } from "../components/Layout";
import { PortalRoutes } from "../components/PortalRoutes";
export function ConnectedPortal({config}:{config:RuntimeConfig}){
 const client=useMemo(()=>{try{return createRuntimeClient(config)}catch{return null}},[config.url,config.publishableKey,config.tenantId]);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[members,setMembers]=useState<Membership[]>([]),[tenant,setTenant]=useState('');
 const [drafts,setDrafts]=useState<DraftRow[]>([]),[services,setServices]=useState<ServiceRow[]>([]),[signedIn,setSignedIn]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const generation=useRef(0);
 async function load(id:string){if(!client)return;const current=++generation.current;setBusy(true);setError('');setDrafts([]);setServices([]);try{const [d,s]=await Promise.all([client.drafts(id),client.services(id,true)]);if(current===generation.current){setDrafts(d);setServices(s)}}catch(e){if(current===generation.current)setError(e instanceof Error?e.message:'Unable to refresh.')}finally{if(current===generation.current)setBusy(false)}}
 async function login(e:FormEvent){e.preventDefault();if(!client||busy)return;setBusy(true);setError('');try{await client.signIn(email,password);const own=await client.memberships();setMembers(own);setSignedIn(true);const first=own[0]?.tenant_id??'';setTenant(first);if(first)await load(first)}catch(e){client.signOut();setError(e instanceof Error?e.message:'Unable to sign in.')}finally{setPassword('');setBusy(false)}}
 function logout(){generation.current++;client?.signOut();setSignedIn(false);setMembers([]);setTenant('');setDrafts([]);setServices([]);setEmail('');setPassword('');setError('');setBusy(false)}
 async function toggle(s:ServiceRow){if(!client||busy)return;const current=generation.current;setBusy(true);setError('');try{await client.setServiceActive(tenant,s.id,!s.active);if(current===generation.current)await load(tenant)}catch(e){if(current===generation.current)setError(e instanceof Error?e.message:'Unable to update service.')}finally{if(current===generation.current)setBusy(false)}}
 const role = members.find(member => member.tenant_id === tenant)?.role;
 const bookingList = <section><h1>Bookings</h1><h2>Unconfirmed requests</h2>
  {busy ? <p role="status">Loading…</p> : drafts.length === 0 ? <p>No unconfirmed requests found.</p> :
   <div className="table-wrap"><table><thead><tr><th>Reference</th><th>Requested time</th><th>Status</th><th>Price</th></tr></thead><tbody>
    {drafts.map(d => <tr key={d.id}><td>{d.reference}</td><td>{new Date(d.slot_start).toLocaleString()}</td><td>Unconfirmed</td><td>Not priced</td></tr>)}
   </tbody></table></div>}
  <p>Up to 100 latest drafts. Requests have not been charged or reserved.</p>
 </section>;
 const serviceList = <section><h1>Services</h1><h2>Service catalog</h2>
  {busy ? <p role="status">Loading…</p> : services.length === 0 ? <p>No simple services found.</p> :
   <ul>{services.map(s => <li key={s.id}>{s.name} · {s.active ? "Active" : "Inactive"} <button disabled={busy} onClick={() => void toggle(s)}>{s.active ? "Deactivate" : "Activate"}</button></li>)}</ul>}
  <p>Only the connected simple-service catalog is available here. Editing and resource inventory are not available yet.</p>
 </section>;
 return <PortalShell mode="connected" tenantName={tenant ? `Business ${tenant}` : "Business Portal"} roleLabel={signedIn ? (role === "BUSINESS_OWNER" ? "Owner" : role === "BUSINESS_STAFF" ? "Staff" : "Member") : "Signed out"}>
  {!client ? <section><h1>Business Portal</h1><p role="alert">Connected mode configuration is missing or invalid.</p></section> : !signedIn ?
   <section><h1>Sign in to your business</h1><form onSubmit={login}>
    <fieldset disabled={busy} className="form-stack"><label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
     <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
     <button>{busy ? "Signing in…" : "Sign in"}</button>
    </fieldset>
   </form><p>Use an existing authorized business account. Sessions stay in memory and end when this page reloads.</p></section> :
   <><div className="panel"><button onClick={logout}>Sign out</button>
    {members.length > 0 && <><label>Business<select disabled={busy} value={tenant} onChange={e => {setTenant(e.target.value); void load(e.target.value)}}>
     {members.map(m => <option key={m.tenant_id} value={m.tenant_id}>{m.tenant_id} · {m.role}</option>)}
    </select></label><button disabled={busy} onClick={() => void load(tenant)}>Refresh</button></>}
   </div>{members.length === 0 ? <p>No business membership is assigned to this account.</p> : <PortalRoutes mode="connected" bookings={bookingList} services={serviceList} />}</>}
  {error && <p role="alert">{error}</p>}
 </PortalShell>;
}
