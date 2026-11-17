import type {Pool,PoolClient} from 'pg';
import type {ConfirmationQueue,ConfirmationLease} from './confirmation-outbox-worker.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid=()=>new Error('CONFIRMATION_QUEUE_INVALID_BINDING');
// Unwired server adapter. The supplied pool is trusted server infrastructure;
// each operation uses only service-role RPCs, never raw table access or PII logs.
export function createConfirmationOutboxQueue(pool:Pool,tenantId:string):ConfirmationQueue {
  if(!uuid.test(tenantId))throw invalid();
  function bind(lease:ConfirmationLease){
    if(lease.tenant_id!==tenantId || lease.event_type!=='booking.confirmed' || lease.dedup_key!==lease.booking_id ||
      !uuid.test(lease.id) || !uuid.test(lease.booking_id) || !uuid.test(lease.lease_token) ||
      !Number.isSafeInteger(lease.generation) || lease.generation<1)throw invalid();
    return [tenantId,lease.booking_id,lease.id,lease.lease_token,lease.generation];
  }
  function key(value:string){
    const [tenant,booking,event,channel,...extra]=value.split(':');
    if(tenant!==tenantId || !booking || !uuid.test(booking) || event!=='booking.confirmed' ||
      (channel!=='email' && channel!=='sms') || extra.length)throw invalid();
    return {booking,channel};
  }
  async function rpc(sql:string,values:unknown[]){
    let client:PoolClient|undefined;
    try{
      client=await pool.connect();await client.query('begin');
      await client.query("set local statement_timeout='10s'");await client.query('set local role service_role');
      const result=await client.query(sql,values);await client.query('commit');return result;
    }catch{
      await client?.query('rollback').catch(()=>{});
      throw new Error('CONFIRMATION_QUEUE_UNAVAILABLE');
    }finally{client?.release();}
  }
  async function flag(sql:string,values:unknown[]){return (await rpc(sql,values)).rows[0]?.result===true;}
  return {
    async leaseConfirmed(tenant,limit,seconds){
      if(tenant!==tenantId || !Number.isInteger(limit) || limit<1 || limit>100 || !Number.isInteger(seconds) || seconds<1 || seconds>300)throw invalid();
      const result=await rpc('select * from public.outbox_lease_confirmed($1::uuid,$2::integer,$3::integer)',[tenantId,limit,seconds]);
      return result.rows.map(row=>{
        const generation=Number(row.generation);
        if(row.tenant_id!==tenantId || row.event_type!=='booking.confirmed' || !Number.isSafeInteger(generation) || generation<1)throw invalid();
        return {...row,generation,lease_until:row.lease_until instanceof Date?row.lease_until.toISOString():row.lease_until};
      });
    },
    async isCurrent(lease){return flag('select public.outbox_confirmation_current($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint) result',bind(lease));},
    async isDelivered(value){const parsed=key(value);return flag('select public.outbox_confirmation_delivered($1::uuid,$2::uuid,$3::text) result',[tenantId,parsed.booking,parsed.channel]);},
    async recordDelivered(lease,value){const parsed=key(value);const binding=bind(lease);if(parsed.booking!==lease.booking_id)throw invalid();return flag('select public.outbox_confirmation_record($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint,$6::text) result',[...binding,parsed.channel]);},
    async ack(lease){return flag('select case when public.outbox_confirmation_current($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint) then public.outbox_ack($1::uuid,$3::uuid,$4::uuid,$5::bigint) else false end result',bind(lease));},
    async retry(lease,reason){if(!['transient','permanent','rate_limited'].includes(reason))throw invalid();return flag('select case when public.outbox_confirmation_current($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint) then public.outbox_retry($1::uuid,$3::uuid,$4::uuid,$5::bigint,$6::text) else false end result',[...bind(lease),reason]);},
  };
}
