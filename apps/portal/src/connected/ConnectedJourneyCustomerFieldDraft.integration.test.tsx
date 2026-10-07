import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {ConnectedPaidJourneyDraft,type JourneyDraftClient} from './ConnectedPaidJourneyDraft';
const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',service='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const props={tenantId:tenant,role:'BUSINESS_OWNER',staging:true,services:[{id:service,tenant_id:tenant,name:'Cleaning',currency:'USD',duration_minutes:60,base_price:100,active:true}],catalogLoading:false};
afterEach(()=>{cleanup();sessionStorage.clear();});
function fixture(){
 let auth=1,locked=false;
 const client:JourneyDraftClient={authContextRevision:()=>auth,businessProfile:vi.fn(async()=>({status:'initialized' as const,profile:{schemaVersion:1 as const,tenantId:tenant,businessType:'HOUSEKEEPING' as const,templateVersion:1 as const}})),simpleOfferLocked:()=>locked,paidJourneyDraftState:()=>({phase:'ready'}),savePaidJourneyDraft:vi.fn(),loadPaidJourneyDraft:vi.fn(),paidJourneyCustomerFieldDraftState:()=>({phase:'ready'}),loadPaidJourneyCustomerFieldDraft:vi.fn(),savePaidJourneyCustomerFieldDraft:vi.fn(async()=>{locked=true;return new Promise<never>(()=>{});})};
 return{client,changeAuth:()=>auth++};
}
async function dispatch(){
 fireEvent.click(screen.getByRole('button',{name:'Check customer questions editor'}));await screen.findByRole('form',{name:'Save conditional journey draft'});
 fireEvent.change(screen.getByLabelText('Customer questions service'),{target:{value:service}});fireEvent.change(screen.getByLabelText('Customer questions form name'),{target:{value:'Private in-flight owner draft'}});fireEvent.submit(screen.getByRole('form',{name:'Save conditional journey draft'}));
}
it('the real Booking Form wrapper preserves unknown dispatch fences and hides drafts through auth A-B-A',async()=>{
 const f=fixture(),view=render(<ConnectedPaidJourneyDraft {...props} client={f.client}/>);await dispatch();expect(f.client.savePaidJourneyCustomerFieldDraft).toHaveBeenCalledTimes(1);
 f.changeAuth();view.rerender(<ConnectedPaidJourneyDraft {...props} client={f.client}/>);f.changeAuth();view.rerender(<ConnectedPaidJourneyDraft {...props} client={f.client}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Check customer questions editor'})).toBeDisabled());expect(document.body.textContent).not.toContain('Private in-flight owner draft');expect(f.client.savePaidJourneyCustomerFieldDraft).toHaveBeenCalledTimes(1);expect(f.client.savePaidJourneyDraft).not.toHaveBeenCalled();
});
it('the real wrapper preserves a dispatched fence when the connected client is replaced',async()=>{
 const first=fixture(),second=fixture(),view=render(<ConnectedPaidJourneyDraft {...props} client={first.client}/>);await dispatch();view.rerender(<ConnectedPaidJourneyDraft {...props} client={second.client}/>);
 expect(screen.getByRole('alert').textContent).toContain('earlier Booking Form write');expect(screen.queryByRole('button',{name:'Check customer questions editor'})).toBeNull();expect(screen.queryByRole('button',{name:'Check journey editor availability'})).toBeNull();expect(document.body.textContent).not.toContain('Private in-flight owner draft');expect(second.client.savePaidJourneyCustomerFieldDraft).not.toHaveBeenCalled();expect(second.client.businessProfile).not.toHaveBeenCalled();
});
it('capability removal and further client replacements cannot escape a prior dispatched write',async()=>{
 const first=fixture(),second=fixture(),third=fixture(),view=render(<ConnectedPaidJourneyDraft {...props} client={first.client}/>);await dispatch();delete second.client.savePaidJourneyCustomerFieldDraft;view.rerender(<ConnectedPaidJourneyDraft {...props} client={second.client}/>);view.rerender(<ConnectedPaidJourneyDraft {...props} client={third.client}/>);
 expect(screen.getByRole('alert').textContent).toContain('earlier Booking Form write');expect(screen.queryByRole('button',{name:'Check journey editor availability'})).toBeNull();expect(third.client.savePaidJourneyDraft).not.toHaveBeenCalled();expect(third.client.businessProfile).not.toHaveBeenCalled();
});
it('keeps existing ordered forms available when the new optional client capability is absent',()=>{
 const f=fixture();delete f.client.savePaidJourneyCustomerFieldDraft;render(<ConnectedPaidJourneyDraft {...props} client={f.client}/>);expect(screen.queryByRole('button',{name:'Check customer questions editor'})).toBeNull();expect(screen.getByRole('button',{name:'Check journey editor availability'})).toBeEnabled();expect(f.client.savePaidJourneyDraft).not.toHaveBeenCalled();
});
