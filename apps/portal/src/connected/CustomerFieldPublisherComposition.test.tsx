import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {createRuntimeClient,type PaidSimpleFieldOwnerDraft,type ServiceRow} from '@lumin/runtime-client';
import {PaidSimplePublisher} from './PaidSimplePublisher';
const tenant='11111111-1111-4111-8111-111111111111',flow='22222222-2222-4222-8222-222222222222',serviceId='33333333-3333-4333-8333-333333333333',actor='44444444-4444-4444-8444-444444444444',installation='55555555-5555-4555-8555-555555555555';
const service:ServiceRow={id:serviceId,tenant_id:tenant,name:'Housekeeping',currency:'USD',duration_minutes:60,base_price:12500,active:true};
const draft:PaidSimpleFieldOwnerDraft={schemaVersion:2,flowId:flow,revision:3,serviceId,name:'Access visit',presentation:{accentColor:'#0f766e',layout:'compact'},customerFields:[{id:'custom_notes',kind:'text',label:'Access notes',required:false,maxLength:100}]};
const receipt={flowId:flow,draftRevision:3,publication:{versionId:actor,installationId:installation,renderSchemaVersion:5,hostedPath:'/checkout/flow/'+installation}};
const json=(value:unknown)=>new Response(JSON.stringify(value));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function fixture(){
 const calls=vi.fn<typeof fetch>(async(input,init)=>String(input).includes('/auth/v1/token')?json({access_token:'synthetic-owner-token'}):String(input).includes('/auth/v1/user')?json({id:actor}):String(input).includes('/draft?')?json({ok:true,data:draft}):init?.method==='POST'?Promise.reject(Error('private-error-secret')):json({ok:true,data:receipt}));
 const client=createRuntimeClient({url:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture',tenantId:tenant,bookingApiOrigin:'https://api.example.test'},calls);await client.signIn('owner@example.test','fixture');await client.loadPaidSimpleDraft(tenant,flow);return{client,calls};
}
const tab=(name:string)=>fireEvent.click(screen.getByRole('tab',{name}));
it('keeps owner draft/design/legacy writers locked across tabs and remount until exact V5 receipt recovery',async()=>{
 const {client,calls}=await fixture();const props={client,tenantId:tenant,role:'BUSINESS_OWNER',services:[service],staging:true,customerFieldPublicationAvailable:true};
 const first=render(<PaidSimplePublisher {...props}/>);tab('Publish');expect(screen.queryByText(/cannot yet be published/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Publish saved informational fields'}));await screen.findByText(/Publication outcome is unverified/);expect(client.paidCustomerFieldPublicationState(tenant).phase).toBe('unknown');
 tab('Build');expect(screen.getByLabelText('Draft name')).toBeDisabled();expect(screen.getByRole('button',{name:'Save draft'})).toBeDisabled();tab('Design');expect(screen.getByLabelText('Draft accent color')).toBeDisabled();tab('Install & Health');expect(screen.queryByRole('button',{name:'Check publication receipt'})).toBeNull();expect(calls).toHaveBeenCalledTimes(4);
 first.unmount();render(<PaidSimplePublisher {...props}/>);expect(screen.getByRole('tab',{name:'Publish'})).toHaveAttribute('aria-selected','true');expect(screen.queryByRole('button',{name:'Publish staging test form'})).toBeNull();expect(calls).toHaveBeenCalledTimes(4);fireEvent.click(screen.getByRole('button',{name:"Check this session's field publication state"}));expect(client.paidCustomerFieldPublicationState(tenant).phase).toBe('unknown');expect(calls).toHaveBeenCalledTimes(4);
 fireEvent.click(screen.getByRole('button',{name:'Check field publication receipt'}));await screen.findByText('Informational-field publication verified at the last check.');await waitFor(()=>expect(client.paidCustomerFieldPublicationState(tenant).phase).toBe('published'));tab('Build');expect(screen.getByLabelText('Draft name')).toBeEnabled();expect(calls.mock.calls.slice(3).map(([,init])=>init?.method)).toEqual(['POST','GET']);expect(document.body.textContent).not.toContain('private-error-secret');
});
it('leaves V2 draft editing available while the hosted publication activation flag is off',async()=>{
 const {client,calls}=await fixture();render(<PaidSimplePublisher client={client} tenantId={tenant} role="BUSINESS_OWNER" services={[service]} staging/>);expect(screen.getByLabelText('Draft name')).toBeEnabled();tab('Publish');expect(screen.getByRole('button',{name:'Publish saved informational fields'})).toBeDisabled();expect(screen.getByText(/awaiting staging runtime activation/)).toBeTruthy();expect(calls).toHaveBeenCalledTimes(3);
});
