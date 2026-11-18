import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {ConnectedPortal} from './ConnectedPortal';
const tenant='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
const json=(x:unknown)=>new Response(JSON.stringify(x));
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it.each([undefined,'false','true'])('connected dashboard attention visibility flag %s stays independent of provider activation',async flag=>{
 vi.stubEnv('VITE_PAYMENT_ATTENTION_VISIBILITY',flag);
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>{const url=String(input);if(url.includes('/token?'))return json({access_token:'synthetic-token'});if(url.endsWith('/user'))return json({id:user});if(url.includes('/tenant_members?'))return json([{tenant_id:tenant,role:'BUSINESS_STAFF'}]);if(url.includes('/services?')||url.includes('/bookings?'))return json([]);if(url.includes('/api/payment-attention?'))return json({ok:true,data:{tenantId:tenant,items:[],nextCursor:null}});throw Error('unexpected');});
 vi.stubGlobal('fetch',fetcher);
 render(<MemoryRouter><ConnectedPortal config={{url:'https://example.supabase.co',publishableKey:'sb_publishable_synthetic',tenantId:'',bookingApiOrigin:'https://api.example.test'}}/></MemoryRouter>);
 fireEvent.change(screen.getByLabelText('Email'),{target:{value:'staff@example.test'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'synthetic'}});fireEvent.click(screen.getByText('Sign in'));await screen.findByText('Sign out');
 if(flag==='true'){await screen.findByText(/No historical late-payment/);expect(fetcher.mock.calls.filter(([u])=>String(u).includes('/api/payment-attention?'))).toHaveLength(1);fireEvent.click(screen.getByText('Sign out'));await waitFor(()=>expect(screen.queryByText('Payment attention history')).toBeNull());}
 else {expect(screen.queryByText('Payment attention history')).toBeNull();expect(fetcher.mock.calls.some(([u])=>String(u).includes('/api/payment-attention?'))).toBe(false);}
 expect(fetcher.mock.calls.some(([u])=>String(u).includes('stripe.com'))).toBe(false);
});
