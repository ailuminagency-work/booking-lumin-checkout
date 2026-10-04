import {useLayoutEffect} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
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
