import {describe,expect,it,vi} from 'vitest';
import {planNotifications} from '../../../packages/notifications/src/index.js';
import {baseConfig,bookingContext} from '../../../packages/notifications/test/fixtures.js';
import {
  createConfirmationOutboxWorker,confirmationDeliveryKey,
  type ConfirmationLease,type ConfirmationQueue,type ConfirmationDeliveryProvider,
} from './confirmation-outbox-worker.js';

const tenant='11111111-1111-1111-1111-111111111111';
const booking='22222222-2222-2222-2222-222222222222';
const other='99999999-9999-9999-9999-999999999999';
const stamp=Date.parse('2026-03-10T12:00:00Z');
function lease(overrides:Partial<ConfirmationLease>={}):ConfirmationLease {
  return {id:'33333333-3333-3333-3333-333333333333',tenant_id:tenant,booking_id:booking,dedup_key:booking,
    event_type:'booking.confirmed',payload:{},state:'leased',lease_token:'44444444-4444-4444-4444-444444444444',
    generation:1,lease_until:new Date(stamp+60_000).toISOString(),attempts:1,max_attempts:5,...overrides};
}
function setup(rows:unknown[]=[lease()]) {
  let time=stamp;
  let current=true;
  const delivered=new Set<string>();
  const queue:ConfirmationQueue={
    leaseConfirmed:vi.fn(async()=>rows),
    isCurrent:vi.fn(async()=>current),
    isDelivered:vi.fn(async key=>delivered.has(key)),
    recordDelivered:vi.fn(async(_lease,key)=>{if(!current)return false;delivered.add(key);return true;}),
    ack:vi.fn(async()=>{if(!current)return false;current=false;return true;}),
    retry:vi.fn(async()=>true),
  };
  const provider:ConfirmationDeliveryProvider={send:vi.fn(async()=>({kind:'sent' as const}))};
  const context=bookingContext({id:booking,state:'confirmed'});
  const config=baseConfig();
  const loadContext=vi.fn(async(_tenantId:string,_bookingId:string)=>({bookingTenantId:tenant,context,config}));
  const worker=createConfirmationOutboxWorker({queue,provider,loadContext,
    plan:(ctx,cfg,now)=>planNotifications('booking.confirmed',ctx,cfg,now),now:()=>time});
  return {queue,provider,loadContext,worker,delivered,rows,context,config,
    expire:()=>{time=stamp+60_000;},fence:()=>{current=false;},reclaim:(generation=2)=>{
      current=true;time=stamp;rows[0]=lease({generation,attempts:generation,lease_token:other});
    }};
}

describe('bounded confirmation consumer (mock dependencies, no hosted delivery)',()=>{
  it('sends configured required channels with stable keys before fenced acknowledgement',async()=>{
    const h=setup();
    expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['completed']});
    expect(h.provider.send).toHaveBeenCalledTimes(2);
    expect(h.provider.send).toHaveBeenNthCalledWith(1,expect.objectContaining({tenantId:tenant,channel:'email',template:'booking_confirmed'}),confirmationDeliveryKey(tenant,booking,'email'));
    expect(h.provider.send).toHaveBeenNthCalledWith(2,expect.objectContaining({channel:'sms'}),confirmationDeliveryKey(tenant,booking,'sms'));
    expect(h.queue.recordDelivered).toHaveBeenCalledTimes(2);
    expect(h.queue.ack).toHaveBeenCalledWith(lease());
    expect(h.queue.retry).not.toHaveBeenCalled();
    expect(h.queue.leaseConfirmed).toHaveBeenCalledWith(tenant,10,60);
  });
  it('retains successful channels after partial failure and retries only the missing channel',async()=>{
    const h=setup();
    vi.mocked(h.provider.send).mockResolvedValueOnce({kind:'sent'}).mockResolvedValueOnce({kind:'transient'});
    expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['retry']});
    expect(h.queue.ack).not.toHaveBeenCalled();
    expect([...h.delivered]).toEqual([confirmationDeliveryKey(tenant,booking,'email')]);
    h.reclaim();
    const restarted=createConfirmationOutboxWorker({queue:h.queue,provider:h.provider,loadContext:h.loadContext,
      plan:(ctx,cfg,now)=>planNotifications('booking.confirmed',ctx,cfg,now),now:()=>stamp});
    expect(await restarted.runBatch(tenant)).toEqual({outcomes:['completed']});
    expect(h.provider.send).toHaveBeenCalledTimes(3);
    expect(vi.mocked(h.provider.send).mock.calls.map(([input])=>input.channel)).toEqual(['email','sms','sms']);
    expect(h.queue.retry).toHaveBeenCalledWith(lease(),'transient');
  });
  it('suppresses duplicate rows concurrently and completed replay without delivery',async()=>{
    const h=setup([lease(),lease()]);
    expect(await h.worker.runBatch(tenant,{concurrency:2})).toEqual({outcomes:['completed','duplicate']});
    expect(h.provider.send).toHaveBeenCalledTimes(2);
    expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['stale','duplicate']});
    expect(h.provider.send).toHaveBeenCalledTimes(2);
    expect(h.queue.ack).toHaveBeenCalledTimes(1);
  });
  it.each(['tenant','bookingTenant','booking','config','state'] as const)('rejects unbound or unconfirmed %s context before any send',async mismatch=>{
    const h=setup();
    if(mismatch==='tenant')h.context.tenant.id=other;
    if(mismatch==='booking')h.context.booking.id=other;
    if(mismatch==='config')h.config.tenantId=other;
    if(mismatch==='state')h.context.booking.state='cancelled';
    if(mismatch==='bookingTenant')vi.mocked(h.loadContext).mockResolvedValue({bookingTenantId:other,context:h.context,config:h.config});
    expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['dead']});
    expect(h.queue.retry).toHaveBeenCalledWith(lease(),'permanent');
    expect(h.provider.send).not.toHaveBeenCalled();expect(h.queue.ack).not.toHaveBeenCalled();
  });
  it('never sends or settles an expired or authoritatively superseded lease',async()=>{
    for(const expire of [true,false]){
      const h=setup();if(expire)h.expire();else h.fence();
      expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['stale']});
      expect(h.provider.send).not.toHaveBeenCalled();expect(h.queue.retry).not.toHaveBeenCalled();expect(h.queue.ack).not.toHaveBeenCalled();
    }
  });
  it('rechecks expiry after context loading and before delivery',async()=>{
    const h=setup();vi.mocked(h.loadContext).mockImplementation(async()=>{h.expire();return {bookingTenantId:tenant,context:h.context,config:h.config};});
    expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['stale']});expect(h.provider.send).not.toHaveBeenCalled();
  });
  it('rejects a lease that expires while its authoritative freshness read is awaiting',async()=>{
    const h=setup();vi.mocked(h.queue.isCurrent).mockImplementationOnce(async()=>{h.expire();return true;});
    expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['stale']});expect(h.loadContext).not.toHaveBeenCalled();expect(h.provider.send).not.toHaveBeenCalled();
  });
  it('does not claim an external send was recorded after losing the lease',async()=>{
    const h=setup();vi.mocked(h.provider.send).mockImplementationOnce(async()=>{h.fence();return {kind:'sent'};});
    expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['stale']});
    expect(h.queue.recordDelivered).not.toHaveBeenCalled();expect(h.queue.ack).not.toHaveBeenCalled();
    h.reclaim();expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['completed']});
    // A provider without idempotency can send twice in this crash window.
    expect(vi.mocked(h.provider.send).mock.calls[0]![1]).toEqual(vi.mocked(h.provider.send).mock.calls[1]![1]);
  });
  it('rejects payload or dedup mismatch without exposing their contents',async()=>{
    for(const row of [lease({payload:{email:'secret@example.test'}}),lease({dedup_key:other})]){
      const h=setup([row]);const result=await h.worker.runBatch(tenant);
      expect(result).toEqual({outcomes:['dead']});expect(JSON.stringify(result)).not.toContain('secret');
      expect(h.provider.send).not.toHaveBeenCalled();expect(h.loadContext).not.toHaveBeenCalled();
    }
  });
  it('leaves unsupported events, foreign rows and malformed lease results unsettled',async()=>{
    const h=setup([lease({event_type:'booking.requested'}),lease({tenant_id:other}),{payload:{email:'private@example.test'}}]);
    expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['unsupported','invalid','invalid']});
    expect(h.queue.isCurrent).not.toHaveBeenCalled();expect(h.queue.retry).not.toHaveBeenCalled();expect(h.queue.ack).not.toHaveBeenCalled();expect(h.provider.send).not.toHaveBeenCalled();
  });
  it('does not silently complete when the standard planner skips a required recipient/template',async()=>{
    const h=setup();h.context.booking.customerPhone=undefined;
    expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['dead']});
    expect(h.provider.send).not.toHaveBeenCalled();expect(h.queue.ack).not.toHaveBeenCalled();
  });
  it.each(['transient','rate_limited','permanent'] as const)('delegates %s classification to the fenced retry RPC contract',async kind=>{
    const h=setup();vi.mocked(h.provider.send).mockResolvedValue({kind});
    expect(await h.worker.runBatch(tenant)).toEqual({outcomes:[kind==='permanent'?'dead':'retry']});
    expect(h.queue.retry).toHaveBeenCalledWith(lease(),kind);expect(h.queue.ack).not.toHaveBeenCalled();
  });
  it('permits the final leased attempt; failure asks the retry RPC to dead-letter, success can ack',async()=>{
    const exhausted=lease({attempts:5,max_attempts:5});
    const failed=setup([exhausted]);vi.mocked(failed.provider.send).mockResolvedValue({kind:'transient'});
    expect(await failed.worker.runBatch(tenant)).toEqual({outcomes:['dead']});
    expect(failed.queue.retry).toHaveBeenCalledWith(exhausted,'transient');
    const succeeded=setup([exhausted]);expect(await succeeded.worker.runBatch(tenant)).toEqual({outcomes:['completed']});
  });
  it('treats false retry/ack/ledger fences as stale',async()=>{
    const ack=setup();vi.mocked(ack.queue.ack).mockResolvedValue(false);
    expect(await ack.worker.runBatch(tenant)).toEqual({outcomes:['stale']});
    const retry=setup();vi.mocked(retry.provider.send).mockResolvedValue({kind:'transient'});vi.mocked(retry.queue.retry).mockResolvedValue(false);
    expect(await retry.worker.runBatch(tenant)).toEqual({outcomes:['stale']});
    const ledger=setup();vi.mocked(ledger.queue.recordDelivered).mockResolvedValue(false);
    expect(await ledger.worker.runBatch(tenant)).toEqual({outcomes:['stale']});expect(ledger.queue.ack).not.toHaveBeenCalled();
  });
  it('returns only safe outcomes for thrown provider and queue errors',async()=>{
    const h=setup();vi.mocked(h.provider.send).mockRejectedValue(new Error('token-private@example.test'));
    expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['retry']});
    vi.mocked(h.queue.retry).mockRejectedValue(new Error('raw connection credentials'));
    expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['unavailable']});
    vi.mocked(h.queue.leaseConfirmed).mockRejectedValue(new Error('raw queue secret'));
    expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['unavailable']});
  });
  it('enforces batch/concurrency/lease limits before queue access',async()=>{
    const h=setup();for(const options of [{limit:101},{limit:0},{concurrency:9},{concurrency:0},{leaseSeconds:301},{leaseSeconds:0}]){
      await expect(h.worker.runBatch(tenant,options)).rejects.toThrow('INVALID_CONFIRMATION_WORKER_OPTIONS');
    }
    expect(h.queue.leaseConfirmed).not.toHaveBeenCalled();
    vi.mocked(h.queue.leaseConfirmed).mockResolvedValue([lease(),lease()]);
    expect(await h.worker.runBatch(tenant,{limit:1})).toEqual({outcomes:['invalid']});expect(h.provider.send).not.toHaveBeenCalled();
  });
  it('bounds concurrent context/provider work across different bookings',async()=>{
    const rows=Array.from({length:6},(_,n)=>lease({id:`33333333-3333-3333-3333-${String(n).padStart(12,'0')}`,booking_id:`22222222-2222-2222-2222-${String(n).padStart(12,'0')}`,dedup_key:`22222222-2222-2222-2222-${String(n).padStart(12,'0')}`}));
    const h=setup(rows);vi.mocked(h.queue.ack).mockResolvedValue(true);
    let inFlight=0,peak=0;
    vi.mocked(h.loadContext).mockImplementation(async(_,id)=>{inFlight++;peak=Math.max(peak,inFlight);await new Promise(resolve=>setTimeout(resolve,2));inFlight--;return {bookingTenantId:tenant,context:bookingContext({id,state:'confirmed'}),config:baseConfig()};});
    expect(await h.worker.runBatch(tenant,{concurrency:2})).toEqual({outcomes:Array(6).fill('completed')});expect(peak).toBe(2);
  });
  it('does not lease another batch when polling overlaps, and releases the guard after completion',async()=>{
    const h=setup();let release!:()=>void;
    vi.mocked(h.queue.leaseConfirmed).mockImplementationOnce(async()=>{await new Promise<void>(resolve=>{release=resolve;});return h.rows;});
    const first=h.worker.runBatch(tenant);
    expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['busy']});expect(h.queue.leaseConfirmed).toHaveBeenCalledTimes(1);
    release();expect(await first).toEqual({outcomes:['completed']});
    expect(await h.worker.runBatch(tenant)).toEqual({outcomes:['stale']});expect(h.queue.leaseConfirmed).toHaveBeenCalledTimes(2);
  });
});
