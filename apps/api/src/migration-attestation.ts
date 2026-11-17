import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Pool} from 'pg';

export const MIGRATION_ATTESTATION_HEAD='0099_migration_attestation' as const;
export type MigrationAttestation=Readonly<{schemaVersion:1;migrationHead:typeof MIGRATION_ATTESTATION_HEAD}>;
type IdentityVerifier=(token:string)=>Promise<{userId:string}|null>;

/**
 * Reads the attestation row through the server-side service role. The checked-in
 * migration creates the row only after the full chain reaches 0099, so a missing
 * table/row or stale value fails closed. No tenant, timestamp, or database detail
 * is returned to the HTTP boundary.
 */
export function createMigrationAttestationReader(pool:Pool):()=>Promise<MigrationAttestation>{
 return async()=>{
  const client=await pool.connect();
  try{
   await client.query('begin');
   await client.query('set local role service_role');
   const result=await client.query<{migrationHead:string}>(
    `select migration_head as "migrationHead"
       from public.booking_lumin_schema_attestation
      where id=true`,
   );
   const row=result.rows[0];
   if(row?.migrationHead!==MIGRATION_ATTESTATION_HEAD)throw new Error('MIGRATION_ATTESTATION_MISMATCH');
   await client.query('commit');
   return Object.freeze({schemaVersion:1 as const,migrationHead:MIGRATION_ATTESTATION_HEAD});
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

