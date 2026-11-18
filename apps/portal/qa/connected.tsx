/** Dedicated local visual fixture, never imported by production App/main. */
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {ConnectedPortal} from '../src/connected/ConnectedPortal';
import '../src/styles.css';
if(!import.meta.env.DEV||location.hostname!=='127.0.0.1')throw Error('LOCAL_VISUAL_FIXTURE_ONLY');
const query=new URLSearchParams(location.search),role=query.get('role')==='staff'?'BUSINESS_STAFF':'BUSINESS_OWNER',state=query.get('state')??'populated',attention=query.get('attention')??state;
const tenant='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',service='33333333-3333-4333-8333-333333333333';
const json=(data:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}));
const bookings=['confirmed','pending_payment','draft','completed','failed'].map((status,i)=>({id:`44444444-4444-4444-8444-44444444444${i}`,tenant_id:tenant,reference:`BL-${1042-i}`,state:status,slot_start:`2030-06-${String(18+i).padStart(2,'0')}T10:00:00Z`,created_at:'2030-06-10T10:00:00Z'}));
const items=[0,1].map(i=>({receiptId:`55555555-5555-4555-8555-55555555555${i}`,bookingId:bookings[4-i]!.id,bookingReference:bookings[4-i]!.reference,reason:'late_success_after_failure',recordedAt:`2030-06-10T12:00:0${i}.123456Z`,reviewedAt:i===1?'2030-06-11T09:00:00.123456Z':null,conflictSeen:i===0}));
// No network fallthrough: every URL/method is checked, unknown operations are refused.
globalThis.fetch=async(input,init)=>{const url=new URL(String(input));if(!['https://visual.supabase.co','https://visual-api.example.test'].includes(url.origin))throw Error('FIXTURE_NETWORK_DENIED');
 if(url.pathname==='/auth/v1/token')return json({access_token:'synthetic-visual-session'});
 if(url.pathname==='/auth/v1/user')return json({id:user});
 if(url.pathname==='/rest/v1/tenant_members')return json([{tenant_id:tenant,role}]);
 if((url.pathname==='/rest/v1/bookings'||url.pathname==='/rest/v1/services')&&(!init?.method||init.method==='GET')){
  if(state==='loading')return new Promise<Response>(()=>{});if(state==='error')return json({error:'synthetic'},503);
  if(url.pathname.endsWith('/bookings'))return json(state==='empty'?[]:bookings);
  return json(state==='empty'?[]:[{id:service,tenant_id:tenant,name:'Housekeeping',currency:'USD',duration_minutes:60,base_price:12500,active:true}]);
 }
 if(url.pathname==='/api/payment-attention'){
  if(attention==='loading')return new Promise<Response>(()=>{});if(attention==='error')return json({ok:false,error:'synthetic'},503);
  return json({ok:true,data:{tenantId:tenant,items:attention==='empty'?[]:items,nextCursor:null}});
 }
 // Acknowledgment is synthetic in-memory only and never changes a financial fixture.
 if(/^\/api\/payment-attention\/[0-9a-f-]+\/acknowledgment$/.test(url.pathname)&&init?.method==='POST'&&role==='BUSINESS_OWNER')return json({ok:true,data:{tenantId:tenant,receiptId:url.pathname.split('/')[3],reviewedAt:'2030-06-12T09:00:00.123456Z'}});
 throw Error('FIXTURE_OPERATION_UNAVAILABLE');
};
createRoot(document.getElementById('root')!).render(<><aside className="qa-fixture-note">LOCAL SYNTHETIC PREVIEW · {role==='BUSINESS_OWNER'?'Owner':'Staff'} · Sign in with any fixture email and password. No live services or writes.</aside><MemoryRouter initialEntries={[query.get('route')??'/']}><ConnectedPortal config={{url:'https://visual.supabase.co',publishableKey:'sb_publishable_visual_fixture',tenantId:'',bookingApiOrigin:'https://visual-api.example.test'}}/></MemoryRouter></>);
