import {useLayoutEffect} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import type {ConnectedBookingDetail,RuntimeClient} from '@lumin/runtime-client';
import {ConnectedBookingRecord} from './ConnectedBookingDetail';

const tenant='11111111-1111-4111-8111-111111111111',booking='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
type Client=Pick<RuntimeClient,'bookingDetail'>;
const fixture=(name:string):ConnectedBookingDetail=>({id:booking,tenantId:tenant,reference:name,state:'confirmed',slotStart:'2026-10-24T17:00:00Z',slotEnd:'2026-10-24T18:00:00Z',createdAt:'2026-10-04T18:00:00Z',serviceId:other,customer:{name,email:name+'@example.test',phone:null},selection:{serviceId:other},address:null,notes:null,total:{amount:12500,currency:'USD'},deposit:{amount:0,currency:'USD'},payment:{id:other,state:'succeeded',amount:{amount:12500,currency:'USD'},provider:'staging_mock'},history:[]});
afterEach(cleanup);
function Observed({client,tenantId=tenant,bookingId=booking,observations}:{client:Client;tenantId?:string;bookingId?:string;observations:string[]}){
 // Observe the committed screen before the record's passive reset/fetch effect.
 useLayoutEffect(()=>{observations.push(document.body.textContent??'');},[client,tenantId,bookingId]);
 return <ConnectedBookingRecord client={client} tenantId={tenantId} bookingId={bookingId} services={[]}/>;
}
const view=(client:Client,observations:string[],tenantId=tenant,bookingId=booking)=><MemoryRouter><Observed client={client} observations={observations} tenantId={tenantId} bookingId={bookingId}/></MemoryRouter>;

it.each(['client','tenant','booking'] as const)('withholds the previous customer before passive effects when %s context changes',async change=>{
 const observations:string[]=[];
 const first:Client={bookingDetail:vi.fn(async()=>fixture('STAGING_PRIVATE_CUSTOMER_A'))};
 const second:Client={bookingDetail:vi.fn(()=>new Promise<ConnectedBookingDetail|null>(()=>{}))};
 const mounted=render(view(first,observations));await screen.findByText('STAGING_PRIVATE_CUSTOMER_A');
 observations.length=0;
 mounted.rerender(view(change==='client'?second:first,observations,change==='tenant'?other:tenant,change==='booking'?other:booking));
 expect(observations).toHaveLength(1);
 expect(observations[0]).not.toContain('STAGING_PRIVATE_CUSTOMER_A');
 expect(observations[0]).toContain('Loading booking');
});

it('does not carry a failed old client read into a replacement client context',async()=>{
 const observations:string[]=[];
 const first:Client={bookingDetail:vi.fn(async()=>{throw Error('PRIVATE_PROVIDER_FAILURE');})};
 const second:Client={bookingDetail:vi.fn(()=>new Promise<ConnectedBookingDetail|null>(()=>{}))};
 const mounted=render(view(first,observations));await screen.findByRole('alert');
 expect(document.body.textContent).not.toContain('PRIVATE_PROVIDER_FAILURE');observations.length=0;
 mounted.rerender(view(second,observations));
 expect(observations[0]).not.toContain('Booking details could not be loaded');
 expect(observations[0]).toContain('Loading booking');
});

it('drops a late old-client receipt while showing the new verified record',async()=>{
 let finish!:(data:ConnectedBookingDetail)=>void;
 const observations:string[]=[];
 const first:Client={bookingDetail:vi.fn(()=>new Promise<ConnectedBookingDetail>(resolve=>finish=resolve))};
 const second:Client={bookingDetail:vi.fn(async()=>fixture('STAGING_CURRENT_CUSTOMER_B'))};
 const mounted=render(view(first,observations));await waitFor(()=>expect(finish).toBeTypeOf('function'));
 mounted.rerender(view(second,observations));await screen.findByText('STAGING_CURRENT_CUSTOMER_B');
 finish(fixture('STAGING_PRIVATE_CUSTOMER_A'));
 await waitFor(()=>expect(screen.queryByText('STAGING_PRIVATE_CUSTOMER_A')).toBeNull());
 expect(screen.getByText('STAGING_CURRENT_CUSTOMER_B')).toBeVisible();
 expect(screen.getByText('STAGING TEST — simulated payment')).toBeVisible();
});
it('integrates confirmation receipt records only into a verified booking and keeps refresh explicit',async()=>{
 const readConfirmationReceiptStatus=vi.fn(async()=>({schemaVersion:1 as const,tenantId:tenant,bookingId:booking,channels:[{channel:'email' as const,receiptRecorded:true},{channel:'sms' as const,receiptRecorded:false}] as [{channel:'email';receiptRecorded:boolean},{channel:'sms';receiptRecorded:boolean}]}));
 const client={bookingDetail:vi.fn(async()=>fixture('STAGING_BOUND_BOOKING')),authContextRevision:vi.fn(()=>0),readConfirmationReceiptStatus};
 render(<MemoryRouter><ConnectedBookingRecord client={client} tenantId={tenant} bookingId={booking} services={[]}/></MemoryRouter>);await screen.findByText('STAGING_BOUND_BOOKING');expect(screen.getByRole('region',{name:'Confirmation receipt records'})).toBeTruthy();expect(readConfirmationReceiptStatus).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Refresh confirmation receipts'}));await screen.findByRole('table');expect(readConfirmationReceiptStatus).toHaveBeenCalledWith(tenant,booking);expect(screen.getByText('Successful-send receipt recorded')).toBeTruthy();expect(screen.getByText('No successful-send receipt recorded')).toBeTruthy();
});
it('does not expose a receipt refresh for an unavailable booking',async()=>{
 const readConfirmationReceiptStatus=vi.fn();render(<MemoryRouter><ConnectedBookingRecord client={{bookingDetail:vi.fn(async()=>null),authContextRevision:vi.fn(()=>0),readConfirmationReceiptStatus}} tenantId={tenant} bookingId={booking} services={[]}/></MemoryRouter>);await screen.findByText('No booking is available for this business and reference.');expect(screen.queryByRole('region',{name:'Confirmation receipt records'})).toBeNull();expect(readConfirmationReceiptStatus).not.toHaveBeenCalled();
});
it('withholds the prior private booking before passive effects after same-client authentication changes',async()=>{
 let auth=0,observed='';const client={bookingDetail:vi.fn(async()=>fixture('STAGING_PREVIOUS_ACCOUNT')),authContextRevision:vi.fn(()=>auth)};
 function Observer(){useLayoutEffect(()=>{observed=document.body.textContent??'';});return <ConnectedBookingRecord client={client} tenantId={tenant} bookingId={booking} services={[]}/>;}
 const view=render(<MemoryRouter><Observer/></MemoryRouter>);await screen.findByText('STAGING_PREVIOUS_ACCOUNT');vi.mocked(client.bookingDetail).mockImplementation(()=>new Promise(()=>{}));auth++;
 view.rerender(<MemoryRouter><Observer/></MemoryRouter>);expect(observed).not.toContain('STAGING_PREVIOUS_ACCOUNT');expect(observed).toContain('Loading booking');expect(screen.queryByRole('region',{name:'Confirmation receipt records'})).toBeNull();
});

it('describes saved initial and changed statuses with readable labels and the saved reason',async()=>{
 const detail=fixture('Readable activity');detail.history=[
  {from:null,to:'draft',reason:null,at:'2026-10-04T18:00:00Z'},
  {from:'draft',to:'pending_payment',reason:'Customer requested a later appointment.',at:'2026-10-04T18:01:00Z'},
  {from:'pending_payment',to:'confirmed',reason:null,at:'2026-10-04T18:02:00Z'}
 ];
 render(view({bookingDetail:vi.fn(async()=>detail)},[]));
 const list=await screen.findByRole('list');const entries=within(list).getAllByRole('listitem');
 expect(entries).toHaveLength(3);
 expect(entries[0]).toHaveTextContent('Status set to Draft. Recorded');
 expect(entries[1]).toHaveTextContent('Status changed from Draft to Pending payment. Recorded');
 expect(entries[1]).toHaveTextContent('Saved reason: Customer requested a later appointment.');
 expect(entries[2]).toHaveTextContent('Status changed from Pending payment to Confirmed. Recorded');
 expect(within(list).queryAllByText(/Saved reason:/)).toHaveLength(1);
 expect(list.textContent).not.toMatch(/[\uFFFD\u001A]/);
});
it('explains an empty saved status history without implying a missing booking or payment',async()=>{
 render(view({bookingDetail:vi.fn(async()=>fixture('No saved changes'))},[]));
 expect(await screen.findByText('No saved status changes are recorded for this booking.')).toBeVisible();
 expect(screen.queryByRole('list')).toBeNull();
 expect(screen.getByText('Status: confirmed')).toBeVisible();
 expect(screen.getByText('Amounts come from the saved booking and payment records. Refund totals and outstanding balances are not available on this page yet.')).toBeVisible();
});
it('keeps long saved private text complete inside an inherited wrapping boundary',async()=>{
 const reference='R'.repeat(200),name='N'.repeat(200),email='e'.repeat(240)+'@example.test',service='S'.repeat(200),reason='A'.repeat(2000);
 const detail=fixture(reference);detail.customer={name,email,phone:'1'.repeat(100)};detail.history=[{from:'confirmed',to:'completed',reason,at:'2026-10-24T18:00:00Z'}];
 render(<MemoryRouter><ConnectedBookingRecord client={{bookingDetail:vi.fn(async()=>detail)}} tenantId={tenant} bookingId={booking} services={[{id:other,tenant_id:tenant,name:service} as Parameters<typeof ConnectedBookingRecord>[0]['services'][number]]}/></MemoryRouter>);
 const heading=await screen.findByRole('heading',{name:`Booking ${reference}`});const boundary=heading.closest('section');
 expect(boundary).toHaveStyle({minWidth:'0',maxWidth:'100%',overflowWrap:'anywhere'});
 for(const value of [name,email,service,'1'.repeat(100)])expect(screen.getByText(value)).toBeVisible();
 expect(screen.getByText(`Saved reason: ${reason}`)).toBeVisible();
 expect(heading.textContent).toBe(`Booking ${reference}`);
 expect(boundary?.style.textOverflow).toBe('');expect(boundary?.style.overflow).toBe('');expect(boundary?.style.whiteSpace).toBe('');
});

it('shows individual persisted selection choices and quantities without inferring current catalog labels',async()=>{
 const detail=fixture('Saved selection');detail.selection={serviceId:other,answers:{package:{choiceIds:['interior_saved']},vehicle:{choiceIds:['sedan_saved','long_vehicle_reference']},quantity:{quantity:0},empty:{choiceIds:[]}},addonIds:['saved_addon'],rentalPeriods:3};
 render(view({bookingDetail:vi.fn(async()=>detail)},[]));await screen.findByText('Saved selection');
 for(const key of ['package','vehicle','quantity','empty'])expect(screen.getByText(key,{selector:'dt'})).toBeVisible();
 for(const choice of ['interior_saved','sedan_saved','long_vehicle_reference'])expect(screen.getByText(choice,{selector:'li'})).toBeVisible();
 expect(screen.getByText('Quantity: 0')).toBeVisible();expect(screen.getByText('No choice references recorded.')).toBeVisible();
 expect(screen.getByText(/historical question and choice labels and separate customer-form answers are not available here/)).toBeVisible();
 expect(screen.getByText('["saved_addon"]')).toBeVisible();expect(screen.getByText('rentalPeriods',{selector:'dt'}).nextElementSibling).toHaveTextContent('3');
 expect(screen.queryByText(JSON.stringify(detail.selection.answers))).toBeNull();
});
it.each([undefined,{}])('explains absent or empty selection answers without inventing a submitted form',async answers=>{
 const detail=fixture('No selection answers');if(answers!==undefined)detail.selection.answers=answers;
 render(view({bookingDetail:vi.fn(async()=>detail)},[]));expect(await screen.findByText('No selection answers are recorded for this booking.')).toBeVisible();
 expect(screen.getByText(/separate customer-form answers are not available here/)).toBeVisible();
});
it('retains unfamiliar saved answer shapes and fields without silently normalizing or dropping them',async()=>{
 const detail=fixture('Unfamiliar answers');detail.selection.answers={extended:{choiceIds:['saved'],extra:'PRIVATE_SAVED_VALUE'},invalid:{quantity:-2},primitive:false};
 render(view({bookingDetail:vi.fn(async()=>detail)},[]));await screen.findByText('Unfamiliar answers');
 expect(screen.getByText('{"choiceIds":["saved"],"extra":"PRIVATE_SAVED_VALUE"}')).toBeVisible();
 expect(screen.getByText('{"quantity":-2}')).toBeVisible();expect(screen.getByText('false')).toBeVisible();
 expect(screen.queryByText('Quantity: -2')).toBeNull();
});
it('withholds private saved answers before effects on authentication change and rejects late old-context data',async()=>{
 let auth=0,observed='',finish!:(data:ConnectedBookingDetail)=>void;
 const old=fixture('Previous answers');old.selection.answers={access:{choiceIds:['PRIVATE_ACCESS_REFERENCE']}};
 const client={bookingDetail:vi.fn(async()=>old),authContextRevision:vi.fn(()=>auth)};
 function Observer(){useLayoutEffect(()=>{observed=document.body.textContent??'';});return <ConnectedBookingRecord client={client} tenantId={tenant} bookingId={booking} services={[]}/>;}
 const mounted=render(<MemoryRouter><Observer/></MemoryRouter>);await screen.findByText('PRIVATE_ACCESS_REFERENCE');
 client.bookingDetail.mockImplementation(()=>new Promise(resolve=>finish=resolve));auth++;
 mounted.rerender(<MemoryRouter><Observer/></MemoryRouter>);expect(observed).not.toContain('PRIVATE_ACCESS_REFERENCE');expect(observed).toContain('Loading booking');
 client.bookingDetail.mockImplementation(async()=>fixture('Current answers'));auth++;
 mounted.rerender(<MemoryRouter><Observer/></MemoryRouter>);await screen.findByText('Current answers');finish(old);
 await waitFor(()=>expect(screen.queryByText('PRIVATE_ACCESS_REFERENCE')).toBeNull());
});

it('renders saved answer text as text without activating markup',async()=>{
 const unsafe='<img src=x onerror="PRIVATE_CANARY">',key='<script>PRIVATE_KEY</script>';
 const detail=fixture('Escaped answers');detail.selection.answers={[key]:{choiceIds:[unsafe]},extended:{extra:'<svg onload="PRIVATE_EXTRA">'}};
 render(view({bookingDetail:vi.fn(async()=>detail)},[]));
 expect(await screen.findByText(unsafe,{selector:'li'})).toBeVisible();expect(screen.getByText(key,{selector:'dt'})).toBeVisible();
 expect(document.querySelector('img,script,svg')).toBeNull();expect(screen.getByText(JSON.stringify({extra:'<svg onload="PRIVATE_EXTRA">'}))).toBeVisible();
});
it.each(['tenant','booking'] as const)('hides saved answer references immediately on %s replacement',async context=>{
 const old=fixture('Old selection');old.selection.answers={access:{choiceIds:['PRIVATE_SAVED_ACCESS']}};
 const client:Client={bookingDetail:vi.fn(async()=>old)};const observations:string[]=[];
 const mounted=render(view(client,observations));await screen.findByText('PRIVATE_SAVED_ACCESS');observations.length=0;
 vi.mocked(client.bookingDetail).mockImplementation(()=>new Promise(()=>{}));
 mounted.rerender(view(client,observations,context==='tenant'?other:tenant,context==='booking'?other:booking));
 expect(observations[0]).not.toContain('PRIVATE_SAVED_ACCESS');expect(observations[0]).toContain('Loading booking');
});
