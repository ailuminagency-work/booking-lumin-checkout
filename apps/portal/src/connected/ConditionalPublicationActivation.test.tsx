import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {ConnectedPortal} from './ConnectedPortal';
vi.mock('./ConnectedBookingFormLoader',()=>({ConnectedBookingFormLoader:(props:{conditionalPublicationAvailable?:boolean})=><p>Conditional authoring: {String(props.conditionalPublicationAvailable)}</p>}));
const tenant='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function fixture(staging:boolean,role='BUSINESS_OWNER'){
 const json=(value:unknown)=>new Response(JSON.stringify(value));
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>{const url=String(input);if(url.includes('/auth/v1/token'))return json({access_token:'controlled-owner-test-token'});if(url.includes('/auth/v1/user'))return json({id:actor});if(url.includes('/tenant_members'))return json([{tenant_id:tenant,role}]);if(url.includes('/services?')||url.includes('/bookings?'))return json([]);throw Error('Unexpected read');});vi.stubGlobal('fetch',fetcher);
 render(<MemoryRouter initialEntries={['/embed']}><ConnectedPortal config={{url:'https://example.supabase.co',publishableKey:'sb_publishable_controlled',tenantId:'',bookingApiOrigin:'https://booking-lumin-api-staging.onrender.com'}} staging={staging}/></MemoryRouter>);
 fireEvent.change(screen.getByLabelText('Email'),{target:{value:'controlled@example.test'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'test-fixture-only'}});fireEvent.click(screen.getByText('Sign in'));await screen.findByText('Sign out');return fetcher;
}
it.each(['false','TRUE','',undefined])('keeps conditional authoring closed without exact staging opt-in %s',async flag=>{vi.stubEnv('VITE_CONDITIONAL_CUSTOMER_FIELD_PUBLICATION_STAGING',flag);vi.stubEnv('VITE_CUSTOMER_FIELD_PUBLICATION_STAGING','true');await fixture(true);await screen.findByText('Conditional authoring: false');});
it('enables only the independently gated staging owner surface without automatic writes',async()=>{vi.stubEnv('VITE_CONDITIONAL_CUSTOMER_FIELD_PUBLICATION_STAGING','true');vi.stubEnv('VITE_CUSTOMER_FIELD_PUBLICATION_STAGING','false');const calls=await fixture(true);await screen.findByText('Conditional authoring: true');expect(calls.mock.calls.some(([url])=>/\/publish|\/draft/.test(String(url)))).toBe(false);});
it('does not activate an owner editor in nonstaging or staff contexts',async()=>{vi.stubEnv('VITE_CONDITIONAL_CUSTOMER_FIELD_PUBLICATION_STAGING','true');await fixture(false);expect(screen.queryByText(/Conditional authoring:/)).toBeNull();cleanup();await fixture(true,'BUSINESS_STAFF');await screen.findByText('Only a business owner can publish a staging paid form.');expect(screen.queryByText(/Conditional authoring:/)).toBeNull();});
