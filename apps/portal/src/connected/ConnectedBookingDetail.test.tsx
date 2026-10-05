import {useLayoutEffect} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
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
