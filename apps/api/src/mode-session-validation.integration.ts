/** Standalone disposable-DB proof using a raw local test pool. Run only after
 * local migrations and the mode_session_validation_candidate.sql fixture are
 * installed in the disposable DB. This checks the adapter's own bounded read,
 * not pool-wide admission or hosted routing.
 */
import assert from 'node:assert/strict';
import {localPool,prepared,issueArgs,issue,profile,snapshot,transaction} from './mode-flow-session-fixtures.js';
import {createExistingModeSessionValidator,EXISTING_SESSION_VALIDATION_SQL} from './mode-session-validation.js';

const pool=localPool();
try{
 const installed=await pool.query("select to_regprocedure('public.mode_validate_existing_flow_session(text,uuid,uuid,text,text,text,uuid,bigint,bigint,timestamp with time zone,timestamp with time zone)') is not null as installed");
 assert.equal(installed.rows[0]?.installed,true,'Disposable validation RPC fixture is required');
 const p=await prepared(pool,'hosted');
 const args=issueArgs(p);
 const receipt=await transaction(pool,client=>issue(client,args));
 const input={tokenHash:String(args[1]),request:{installationId:p.installed.installationId,deploymentProfileVersion:profile.profileVersion,rendererOrigin:profile.rendererOrigin,parentOrigin:null,expectedVersionId:p.published.versionId,expectedTargetRevision:p.installed.targetRevision,expectedPolicyRevision:p.installed.policyRevision},baseline:{sessionId:receipt.sessionId,issuedAt:receipt.issuedAt,expiresAt:receipt.expiresAt}};
 const before=await snapshot(pool,p.f.tenant);
 const validator=createExistingModeSessionValidator({pool,profiles:[profile]});
 try{
  const out=await validator.validateExisting(input);
  assert.equal(out.kind,'completed');
  assert.equal(out.kind==='completed'&&out.delivery,'data');
  if(out.kind==='completed'&&out.delivery==='data')assert.deepEqual(out.data,receipt);
  assert.deepEqual(await snapshot(pool,p.f.tenant),before,'Validation must leave booking and session state unchanged');
  const denied=await validator.validateExisting({...input,tokenHash:'f'.repeat(64)});
  assert.deepEqual(denied,{kind:'failed',code:'FORBIDDEN',data:null,transaction:'no_commit_submitted',backendMayStillRun:true});
  assert.deepEqual(await snapshot(pool,p.f.tenant),before,'Denied validation must leave state unchanged');
  assert.match(EXISTING_SESSION_VALIDATION_SQL,/^SELECT public\.mode_validate_existing_flow_session\(/);
  console.log('PASS existing-session validation disposable DB, bound tuple and no state change');
 }finally{validator.close();}
}finally{await pool.end();}
