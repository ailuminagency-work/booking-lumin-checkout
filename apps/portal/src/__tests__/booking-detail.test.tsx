import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {ConnectedBookingRecord} from '../connected/ConnectedBookingDetail';
import type {ConnectedBookingDetail} from '@lumin/runtime-client';
afterEach(cleanup);
const detail=(tenant:string):ConnectedBookingDetail=>({id:'booking',tenantId:tenant,reference:'LMN-'+tenant,state:'confirmed',slotStart:'2030-01-01T12:00:00Z',slotEnd:'2030-01-01T13:00:00Z',createdAt:'2029-01-01T12:00:00Z',serviceId:'service',customer:{name:'Customer '+tenant,email:'owner@example.test',phone:null},selection:{serviceId:'service'},address:null,notes:null,total:{amount:12500,currency:'USD'},deposit:{amount:0,currency:'USD'},payment:{id:'payment',state:'succeeded',amount:{amount:12500,currency:'USD'},provider:'staging_mock'},history:[]});
describe('connected record',()=>{
 it('shows stored customer, price and explicit simulated payment label',async()=>{render(<MemoryRouter><ConnectedBookingRecord client={{bookingDetail:vi.fn().mockResolvedValue(detail('A'))}} tenantId="A" bookingId="booking" services={[]}/></MemoryRouter>);expect(await screen.findByText('Customer A')).toBeInTheDocument();expect(screen.getAllByText('$125.00')).toHaveLength(2);expect(screen.getByText('STAGING TEST — simulated payment')).toBeInTheDocument()});
 it('clears previous tenant and ignores a late response after switching',async()=>{let resolveA!:(v:ConnectedBookingDetail)=>void;const client={bookingDetail:vi.fn((tenant:string)=>tenant==='A'?new Promise<ConnectedBookingDetail>(resolve=>{resolveA=resolve}):Promise.resolve(detail('B')))};const props={client,bookingId:'booking',services:[]};const view=render(<MemoryRouter><ConnectedBookingRecord {...props} tenantId="A"/></MemoryRouter>);view.rerender(<MemoryRouter><ConnectedBookingRecord {...props} tenantId="B"/></MemoryRouter>);expect(await screen.findByText('Customer B')).toBeInTheDocument();resolveA(detail('A'));await waitFor(()=>expect(screen.queryByText('Customer A')).not.toBeInTheDocument());expect(screen.getByText('Customer B')).toBeInTheDocument()});
 it('shows missing records without sample booking data',async()=>{render(<MemoryRouter><ConnectedBookingRecord client={{bookingDetail:vi.fn().mockResolvedValue(null)}} tenantId="A" bookingId="booking" services={[]}/></MemoryRouter>);expect(await screen.findByText('No booking is available for this business and reference.')).toBeInTheDocument();expect(screen.queryByText('$125.00')).not.toBeInTheDocument()});
});

