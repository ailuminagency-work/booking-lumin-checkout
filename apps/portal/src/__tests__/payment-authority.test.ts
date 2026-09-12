import {it,expect} from 'vitest';
import {createStore,demoContext} from '../data/mockTenant';
import {listBookings,transitionBooking,legalNextStates} from '../data/api';
it('denies member confirmation, payment and refund transitions without changing history or state',()=>{
 for(const [from,to] of [['pending_payment','confirmed'],['confirmed','refunded'],['draft','pending_payment'],['pending_payment','failed']] as const){
  const s=createStore(),b=listBookings(demoContext,{},s)[0]!;b.state=from;b.paymentId=null;
  const version=s.getVersion();expect(()=>transitionBooking(demoContext,b.id,to,undefined,s)).toThrow();
  expect(b.state).toBe(from);expect(s.getVersion()).toBe(version);expect(legalNextStates(from)).not.toContain(to);
 }
});
