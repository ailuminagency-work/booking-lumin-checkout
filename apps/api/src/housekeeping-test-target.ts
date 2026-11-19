import assert from 'node:assert/strict';
import {isIP} from 'node:net';

/** Test-only routing contract. CI host must come from the inspected job service, not SQL discovery. */
export function housekeepingDatabaseTarget(env:NodeJS.ProcessEnv){
 for(const key of ['PGHOST','PGUSER','PGPORT','PGDATABASE','POSTGRES_SERVICE_ID','HOUSEKEEPING_CI_DATABASE_HOST'])if(env[key]!==undefined)assert.ok(!/\s/.test(env[key]!));
 assert.equal(env.PGHOST,'127.0.0.1');assert.equal(env.PGUSER,'postgres');
 assert.match(env.PGPORT??'',/^\d{4,5}$/);
 assert.match(env.PGDATABASE??'',/^lumin_housekeeping_proof_[a-z0-9_]+$/);
 for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.equal(env[key],undefined);
 let host='127.0.0.1';
 if(env.CI==='true'||env.GITHUB_ACTIONS==='true'){
  assert.equal(env.CI,'true');assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.PGPORT,'5432');
  assert.match(env.POSTGRES_SERVICE_ID??'',/^[a-f0-9]{12,64}$/);
  host=env.HOUSEKEEPING_CI_DATABASE_HOST??'';
  assert.equal(isIP(host),4);assert.match(host,/^(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)/);
 }else assert.equal(env.HOUSEKEEPING_CI_DATABASE_HOST,undefined);
 return{db:env.PGDATABASE,actor:'postgres',host,port:Number(env.PGPORT)};
}
