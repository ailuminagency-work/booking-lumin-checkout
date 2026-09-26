import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {ConnectedCheckout} from './ConnectedCheckout';
const T='11111111-1111-4111-8111-111111111111',S='22222222-2222-4222-8222-222222222222';
const config={url:'https://example.supabase.co',publishableKey:'sb_publishable_synthetic_fixture',tenantId:T};
const other={...config,tenantId:'33333333-3333-4333-8333-333333333333'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const row=(tenantId:string,name:string)=>({id:S,tenant_id:tenantId,name,currency:'USD',base_price:1000,duration_minutes:60,active:true});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve}}
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it('persists a real-mode draft with stable retry identity and reports unconfirmed without charging',async()=>{
 const bodies:string[]=[];let attempts=0;const fetcher=vi.fn(async(url:RequestInfo|URL,options?:RequestInit)=>{
  if(String(url).includes('/services?'))return json([{id:S,tenant_id:T,name:'Preview service',currency:'USD',base_price:1000,duration_minutes:60,active:true}]);
  bodies.push(String(options?.body));attempts++;return attempts===1?json({message:'private error'},500):json([{booking_id:S,reference:'LMN-TEST'}]);
 });vi.stubGlobal('fetch',fetcher);
 render(<ConnectedCheckout config={config}/>);
 await screen.findByText('Preview service · 60 minutes');
 fireEvent.change(screen.getByLabelText(/desired date and time/i),{target:{value:'2030-01-01T12:00'}});
 fireEvent.change(screen.getByLabelText(/your name/i),{target:{value:'Synthetic Example'}});
 fireEvent.change(screen.getByLabelText('Email'),{target:{value:'synthetic@example.test'}});
 fireEvent.click(screen.getByRole('button',{name:'Save unconfirmed request'}));
 await screen.findByRole('alert');expect(screen.queryByText('private error')).toBeNull();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Save unconfirmed request'})).not.toBeDisabled());
 fireEvent.click(screen.getByRole('button',{name:'Save unconfirmed request'}));
 await screen.findByText('Request saved — unconfirmed');expect(screen.getByText('LMN-TEST')).toBeInTheDocument();expect(bodies).toHaveLength(2);expect(bodies[0]).toBe(bodies[1]);
 expect(fetcher.mock.calls.every(([url])=>!String(url).includes('payment'))).toBe(true);
});
it('starts a fresh session for every connection switch and ignores late catalog results',async()=>{
 const pending=deferred<Response>();
 let first=true;
 const fetcher=vi.fn((url:RequestInfo|URL)=>{
  if(String(url).includes(`tenant_id=eq.${T}`)){
   if(first){first=false;return pending.promise}
   return Promise.resolve(json([row(T,'Original service')]));
  }
  return Promise.resolve(json([row(other.tenantId,'Other service')]));
 });
 vi.stubGlobal('fetch',fetcher);
 const view=render(<ConnectedCheckout config={config}/>);
 view.rerender(<ConnectedCheckout config={other}/>);
 await screen.findByText(/Other service/);
 await act(async()=>{pending.resolve(json([row(T,'Original service')]));await pending.promise});
 expect(screen.queryByText(/Original service/)).toBeNull();
 expect(screen.getByText(/Other service/)).toBeInTheDocument();
 view.rerender(<ConnectedCheckout config={config}/>);
 await screen.findByText(/Original service/);
 expect(fetcher).toHaveBeenCalledTimes(3);
});
it('removes saved references and customer details on tenant and credential switches',async()=>{
 const fetcher=vi.fn(async(url:RequestInfo|URL)=>String(url).includes('/services?')?json([row(String(url).includes(other.tenantId)?other.tenantId:T,'Preview service')]):json([{booking_id:S,reference:'LMN-PRIVATE'}]));
 vi.stubGlobal('fetch',fetcher);
 const view=render(<ConnectedCheckout config={config}/>);
 await screen.findByText(/Preview service/);
 fireEvent.change(screen.getByLabelText(/desired date and time/i),{target:{value:'2030-01-01T12:00'}});
 fireEvent.change(screen.getByLabelText(/your name/i),{target:{value:'Private Customer'}});
 fireEvent.change(screen.getByLabelText('Email'),{target:{value:'private@example.test'}});
 fireEvent.click(screen.getByRole('button',{name:'Save unconfirmed request'}));
 await screen.findByText('LMN-PRIVATE');
 view.rerender(<ConnectedCheckout config={other}/>);
 await screen.findByText(/Preview service/);
 expect(screen.queryByText('LMN-PRIVATE')).toBeNull();
 expect(screen.getByLabelText(/your name/i)).toHaveValue('');
 expect(screen.getByLabelText('Email')).toHaveValue('');
 view.rerender(<ConnectedCheckout config={{...other,publishableKey:'invalid'}}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('Connected mode configuration is missing or invalid.');
 expect(screen.queryByText('LMN-PRIVATE')).toBeNull();
});
it('does not expose a late saved reference after switching tenants',async()=>{
 const pending=deferred<Response>();
 const fetcher=vi.fn((url:RequestInfo|URL)=>String(url).includes('/services?')?Promise.resolve(json([row(String(url).includes(other.tenantId)?other.tenantId:T,'Preview service')])):pending.promise);
 vi.stubGlobal('fetch',fetcher);
 const view=render(<ConnectedCheckout config={config}/>);
 await screen.findByText(/Preview service/);
 fireEvent.change(screen.getByLabelText(/desired date and time/i),{target:{value:'2030-01-01T12:00'}});
 fireEvent.change(screen.getByLabelText(/your name/i),{target:{value:'Private Customer'}});
 fireEvent.change(screen.getByLabelText('Email'),{target:{value:'private@example.test'}});
 fireEvent.click(screen.getByRole('button',{name:'Save unconfirmed request'}));
 await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
 view.rerender(<ConnectedCheckout config={other}/>);
 await screen.findByText(/Preview service/);
 await act(async()=>{pending.resolve(json([{booking_id:S,reference:'LMN-PRIVATE'}]));await pending.promise});
 expect(screen.queryByText('LMN-PRIVATE')).toBeNull();
 expect(screen.getByLabelText(/your name/i)).toHaveValue('');
 expect(fetcher.mock.calls.filter(([url])=>String(url).includes('create_booking_draft'))).toHaveLength(1);
});
it('starts new retry identities on valid key-only and A to B to A switches',async()=>{
 const bodies:{p_tenant_id:string;p_idempotency_key:string}[]=[];
 const fetcher=vi.fn(async(url:RequestInfo|URL,options?:RequestInit)=>{
  if(String(url).includes('/services?'))return json([row(String(url).includes(other.tenantId)?other.tenantId:T,'Preview service')]);
  const body=JSON.parse(String(options?.body)) as {p_tenant_id:string;p_idempotency_key:string};bodies.push(body);
  return json([{booking_id:S,reference:`LMN-${bodies.length}`}]);
 });vi.stubGlobal('fetch',fetcher);
 const view=render(<ConnectedCheckout config={config}/>);
 async function save(expected:number){
  await screen.findByText(/Preview service/);
  fireEvent.change(screen.getByLabelText(/desired date and time/i),{target:{value:'2030-01-01T12:00'}});
  fireEvent.change(screen.getByLabelText(/your name/i),{target:{value:'Synthetic Customer'}});
  fireEvent.change(screen.getByLabelText('Email'),{target:{value:'synthetic@example.test'}});
  fireEvent.click(screen.getByRole('button',{name:'Save unconfirmed request'}));
  await screen.findByText(`LMN-${expected}`);
 }
 await save(1);
 const newKey={...config,publishableKey:'sb_publishable_other_synthetic_fixture'};
 view.rerender(<ConnectedCheckout config={newKey}/>);await save(2);
 view.rerender(<ConnectedCheckout config={other}/>);await save(3);
 view.rerender(<ConnectedCheckout config={config}/>);await save(4);
 expect(bodies.map(body=>body.p_tenant_id)).toEqual([T,T,other.tenantId,T]);
 expect(new Set(bodies.map(body=>body.p_idempotency_key)).size).toBe(4);
});
it('resets customer input when the endpoint changes with the same tenant',async()=>{
 const fetcher=vi.fn(async(url:RequestInfo|URL)=>json([row(T,String(url).startsWith('https://other.supabase.co')?'Other endpoint':'Original endpoint')]));
 vi.stubGlobal('fetch',fetcher);
 const view=render(<ConnectedCheckout config={config}/>);
 await screen.findByText(/Original endpoint/);
 fireEvent.change(screen.getByLabelText(/your name/i),{target:{value:'Private Customer'}});
 view.rerender(<ConnectedCheckout config={{...config,url:'https://other.supabase.co'}}/>);
 await screen.findByText(/Other endpoint/);
 expect(screen.getByLabelText(/your name/i)).toHaveValue('');
 expect(screen.queryByText(/Original endpoint/)).toBeNull();
 expect(fetcher.mock.calls[1]?.[0]).toContain('https://other.supabase.co');
});
