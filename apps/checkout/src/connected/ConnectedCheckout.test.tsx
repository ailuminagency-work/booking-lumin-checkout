import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {ConnectedCheckout} from './ConnectedCheckout';
const T='11111111-1111-4111-8111-111111111111',S='22222222-2222-4222-8222-222222222222';
const config={url:'https://example.supabase.co',publishableKey:'sb_publishable_synthetic_fixture',tenantId:T};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
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
