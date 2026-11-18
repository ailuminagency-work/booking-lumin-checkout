import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Pool} from 'pg';

export const MIGRATION_ATTESTATION_HEAD='0131_owner_attention_reader_attestation' as const;
export const MIGRATION_ATTESTATION_EVIDENCE='core_schema_contract' as const;
export type MigrationAttestation=Readonly<{schemaVersion:1;migrationHead:typeof MIGRATION_ATTESTATION_HEAD;evidence:typeof MIGRATION_ATTESTATION_EVIDENCE}>;
type IdentityVerifier=(token:string)=>Promise<{userId:string}|null>;

/**
 * Reads the attestation row and a small core-schema contract through the
 * server-side service role. This proves the 0113 sentinel and the bounded 0101/0102/0104/0106/0108/0110/0112 payment contract and the listed
 * booking/payment objects are present; it deliberately does NOT claim that
 * every historical migration is present or unmodified. Full-chain replay
 * remains a separate disposable-Postgres/CI evidence gate. No tenant,
 * timestamp, or database detail is returned to the HTTP boundary.
 */
export function createMigrationAttestationReader(pool:Pool):()=>Promise<MigrationAttestation>{
 return async()=>{
  const client=await pool.connect();
  try{
   await client.query('begin');
   await client.query('set local role service_role');
   const result=await client.query<{
     migrationHead:string;
     evidence:string;
    tenants:boolean;
    services:boolean;
    bookings:boolean;
    payments:boolean;
    availabilityRules:boolean;
    availabilityOverrides:boolean;
    capacityHolds:boolean;
    resources:boolean;
    resourceReservations:boolean;
    confirmationAuthority:boolean;
    paymentReadinessContract:boolean;
   }>(
    `select migration_head as "migrationHead"
          ,evidence
          ,to_regclass('public.tenants') is not null as "tenants"
          ,to_regclass('public.services') is not null as "services"
          ,to_regclass('public.bookings') is not null as "bookings"
          ,to_regclass('public.payments') is not null as "payments"
          ,to_regclass('public.availability_rules') is not null as "availabilityRules"
          ,to_regclass('public.availability_overrides') is not null as "availabilityOverrides"
          ,to_regclass('public.capacity_holds') is not null as "capacityHolds"
          ,to_regclass('public.resources') is not null as "resources"
          ,to_regclass('public.resource_reservations') is not null as "resourceReservations"
          ,to_regprocedure('public.confirm_succeeded_payment(uuid)') is not null as "confirmationAuthority"
          ,lumin.payment_readiness_contract() as "paymentReadinessContract"
       from public.booking_lumin_schema_attestation
      where id=true`,
   );
   const row=result.rows[0];
   if(row?.migrationHead!==MIGRATION_ATTESTATION_HEAD||row.evidence!==MIGRATION_ATTESTATION_EVIDENCE)throw new Error('MIGRATION_ATTESTATION_MISMATCH');
   const coreSchema=[row.tenants,row.services,row.bookings,row.payments,row.availabilityRules,row.availabilityOverrides,row.capacityHolds,row.resources,row.resourceReservations,row.confirmationAuthority,row.paymentReadinessContract];
   if(coreSchema.some(value=>value!==true))throw new Error('MIGRATION_ATTESTATION_SCHEMA_MISMATCH');
   await client.query('commit');
   return Object.freeze({schemaVersion:1 as const,migrationHead:MIGRATION_ATTESTATION_HEAD,evidence:MIGRATION_ATTESTATION_EVIDENCE});
  }catch(error){
   await client.query('rollback').catch(()=>{});
   throw error;
  }finally{client.release();}
 };
}

function send(res:ServerResponse,status:number,value:unknown){
 res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 res.end(JSON.stringify(value));
}

/** Authenticated staging-only HTTP boundary; it never returns database errors. */
export function createMigrationAttestationHandler(options:{environment:string|undefined;verifyIdentity:IdentityVerifier;read:()=>Promise<MigrationAttestation>;onFailure?:()=>void}){
 return async(req:IncomingMessage,res:ServerResponse,path:string):Promise<boolean>=>{
  if(path!=='/api/staging/readiness/migration')return false;
  if(req.method!=='GET'||options.environment!=='staging'){send(res,404,{status:'not_found'});return true;}
  const authorization=req.headers.authorization;
  if(typeof authorization!=='string'||!/^Bearer [A-Za-z0-9._~-]{16,4096}$/.test(authorization)){send(res,401,{ok:false,code:'UNAUTHENTICATED'});return true;}
  try{
   const identity=await options.verifyIdentity(authorization.slice(7));
   if(!identity?.userId){send(res,401,{ok:false,code:'UNAUTHENTICATED'});return true;}
  }catch{send(res,401,{ok:false,code:'UNAUTHENTICATED'});return true;}
  try{send(res,200,await options.read());}
  catch{options.onFailure?.();send(res,503,{status:'unready',reason:'migration_attestation_unavailable'});}
  return true;
 };
}
